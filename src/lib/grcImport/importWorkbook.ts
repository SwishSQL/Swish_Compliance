import "server-only";
import * as XLSX from "xlsx";
import { withTransaction } from "@/lib/db";

/**
 * In-app version of scripts/import_sop_grc_workbook.mjs — same sheet
 * shape, same field mappings, same idempotent upsert-by-code behaviour,
 * but driven from an uploaded file through the admin UI instead of a
 * CLI run against a local path. Kept as a single module so the two never
 * drift apart; if the CLI script needs a fix, port it here too (and vice
 * versa) until one is retired.
 *
 * Import is always additive: every insert upserts on the row's natural
 * code (ON CONFLICT DO UPDATE), and nothing is ever deleted. Uploading a
 * template with new SOPs links them into the existing domain/framework/
 * control tree by matching codes and department names already in the
 * system — it does not replace or remove anything the template doesn't
 * mention.
 */

export type ImportResult = {
  dryRun: boolean;
  committed: boolean;
  log: string[];
  warnings: string[];
  error: string | null;
};

const txt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

// "15/01/2026" -> "2026-01-15"
const parseDate = (v: unknown): string | null => {
  const s = txt(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

const reviewDateFrom = (effectiveISO: string | null, label: string | null): string | null => {
  if (!effectiveISO || !label) return null;
  const l = label.toLowerCase();
  let months: number | null = null;
  const every = l.match(/every\s+(\d+)\s+month/);
  if (every) months = Number(every[1]);
  else if (/\bmonthly\b/.test(l)) months = 1;
  else if (/\bquarterly\b/.test(l)) months = 3;
  else if (/\bannual|yearly\b/.test(l)) months = 12;
  if (months === null) return null;
  const [y, m, d] = effectiveISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
};

const versionOf = (v: unknown): string => {
  const s = txt(v);
  if (!s) return "1.0";
  const m = s.match(/^\s*(\d+(?:\.\d+)*)/);
  return m ? m[1] : s.slice(0, 20);
};

const joinLines = (...parts: (string | null)[]): string | null => {
  const kept = parts.filter(Boolean) as string[];
  return kept.length ? kept.join("\n") : null;
};

type Row = Record<string, unknown>;

/**
 * Parse the workbook up front so the caller (the server action) can show
 * a quick sheet-shape summary before even opening a transaction — most
 * "wrong file" mistakes (missing a sheet, empty Questions) are obvious
 * from this alone.
 */
export function readWorkbookSheets(buffer: Buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = (name: string): Row[] =>
    wb.Sheets[name] ? XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { defval: null }) : [];
  return {
    departments: sheet("Departments"),
    domains: sheet("Domains"),
    sops: sheet("SOPs"),
    frameworks: sheet("Frameworks"),
    controls: sheet("Controls"),
    tests: sheet("Tests & Evidences"),
    checklists: sheet("Checklists"),
    questions: sheet("Questions").filter((r) => r["CHECKLIST ID"] || r["QUESTION"]),
    htmlMaps: sheet("HTML Maps"),
  };
}

export async function importGrcWorkbook(
  buffer: Buffer,
  opts: { dryRun: boolean; importUserId: number }
): Promise<ImportResult> {
  const log: string[] = [];
  const warnings: string[] = [];
  let rows: ReturnType<typeof readWorkbookSheets>;

  try {
    rows = readWorkbookSheets(buffer);
  } catch (e) {
    return {
      dryRun: opts.dryRun,
      committed: false,
      log: [],
      warnings: [],
      error: `Could not read the file as an Excel workbook: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  const requiredSheets: [string, unknown[]][] = [
    ["Departments", rows.departments],
    ["SOPs", rows.sops],
    ["Domains", rows.domains],
  ];
  const missing = requiredSheets.filter(([, r]) => r.length === 0).map(([n]) => n);
  if (missing.length === requiredSheets.length) {
    return {
      dryRun: opts.dryRun,
      committed: false,
      log: [],
      warnings: [],
      error:
        "This doesn't look like a SOP_GRC workbook — Departments, SOPs and Domains are all empty or missing.",
    };
  }

  try {
    const result = await withTransaction(async (client) => {
      // Departments are pre-existing reference data — resolve by name,
      // never create. A department not yet in the system blocks the whole
      // import rather than silently dropping its rows.
      const deptByCode = new Map<string, number>();
      for (const r of rows.departments) {
        const name = txt(r["DEPARTMENT NAME"]);
        const res = await client.query<{ id: number }>(
          "SELECT id FROM departments WHERE name = $1",
          [name]
        );
        if (!res.rows.length) {
          throw new Error(
            `Department not found in the system: "${name}" (code ${txt(r["DEPARTMENT ID"])}). ` +
              `Add it under Administration → Departments first, then re-upload.`
          );
        }
        deptByCode.set(txt(r["DEPARTMENT ID"])!, res.rows[0].id);
      }
      log.push(`Departments resolved: ${[...deptByCode.keys()].join(", ") || "(none in file)"}`);

      const domainIdByCode = new Map<string, number>();
      for (const [i, r] of rows.domains.entries()) {
        const code = txt(r["DOMAIN ID"]);
        if (!code) continue;
        const res = await client.query<{ id: number }>(
          `INSERT INTO domains (code, name, description, sort_order, is_active, department_id,
                                review_scope_method, evidence_to_obtain, review_focus, how_to_verify)
           VALUES ($1, $2, $3, $4, TRUE, $5, $6, $7, $8, $9)
           ON CONFLICT (code) DO UPDATE SET
             name = EXCLUDED.name, description = EXCLUDED.description,
             sort_order = EXCLUDED.sort_order, is_active = TRUE,
             department_id = EXCLUDED.department_id,
             review_scope_method = EXCLUDED.review_scope_method,
             evidence_to_obtain = EXCLUDED.evidence_to_obtain,
             review_focus = EXCLUDED.review_focus,
             how_to_verify = EXCLUDED.how_to_verify
           RETURNING id`,
          [
            code,
            txt(r["DOMAIN NAME"]),
            txt(r["DOMAIN DESCRIPTION"]),
            i + 1,
            deptByCode.get(txt(r["DEPARTMENT ID"]) ?? "") ?? null,
            txt(r["DOMAIN REVIEW SCOPE & METHOD"]),
            txt(r["GO TO / OBTAIN"]),
            txt(r["REVIEW"]),
            txt(r["HOW TO VERIFY"]),
          ]
        );
        domainIdByCode.set(code, res.rows[0].id);
      }
      log.push(`Domains: ${domainIdByCode.size}`);

      // SOPs sheet carries no department of its own — derive it from the
      // first domain that names the SOP (see importer script's comment;
      // sops.department_id is singular, domains.department_id carries the
      // full multi-department picture that audit scoping actually walks).
      const sopDeptByCode = new Map<string, number>();
      for (const r of rows.domains) {
        const sopCode = txt(r["RELATED SOP CODE"]);
        if (!sopCode || sopDeptByCode.has(sopCode)) continue;
        const deptId = deptByCode.get(txt(r["DEPARTMENT ID"]) ?? "");
        if (deptId) sopDeptByCode.set(sopCode, deptId);
      }

      const sopUrlByCode = new Map<string, { url: string; isPrimary: boolean }>();
      for (const r of rows.htmlMaps) {
        const code = txt(r["SOP CODE"]);
        const url = txt(r["DRIVE URL"]);
        if (!code || !url) continue;
        const isPrimary = (txt(r.STATUS) ?? "").toLowerCase() === "current";
        const existing = sopUrlByCode.get(code);
        if (!existing || (isPrimary && !existing.isPrimary)) {
          sopUrlByCode.set(code, { url, isPrimary });
        }
      }
      if (rows.htmlMaps.length) {
        log.push(`HTML review maps: ${sopUrlByCode.size} SOPs with a Drive URL`);
      }

      const sopIdByCode = new Map<string, number>();
      const sopReviewNotes: string[] = [];
      for (const r of rows.sops) {
        const code = txt(r.CODE);
        if (!code) continue;
        const effective = parseDate(r["EFFECTIVE DATE"]);
        const reviewLabel = txt(r["NEXT REVIEW DATE"]);
        const review = reviewDateFrom(effective, reviewLabel);
        if (reviewLabel && !review) {
          sopReviewNotes.push(`${code}: "${reviewLabel}" (no interval — review_date left empty)`);
        }

        let ownership = txt(r["OWNERSHIP & REVIEW"]);
        if (
          reviewLabel &&
          (!ownership || !ownership.toLowerCase().includes(reviewLabel.toLowerCase().slice(0, 25)))
        ) {
          ownership = joinLines(ownership, `Review cycle: ${reviewLabel}`);
        }

        const res = await client.query<{ id: number }>(
          `INSERT INTO sops (
             code, title, description, version, status,
             brand_id, department_id, brand_is_function, is_all_departments,
             owner_id, created_by, approved_by, approved_at,
             effective_date, review_date,
             purpose, scope, process_flow, roles_responsibilities, inputs_outputs,
             tools_forms, kpis, ownership_review, appendices, signatures_approval,
             file_url
           ) VALUES (
             $1,$2,$3,$4,'approved',
             NULL,$5,TRUE,FALSE,
             $6,$6,$6,NOW(),
             $7,$8,
             $9,$10,$11,$12,$13,
             $14,$15,$16,$17,$18,
             $19
           )
           ON CONFLICT (code) DO UPDATE SET
             title = EXCLUDED.title, description = EXCLUDED.description,
             version = EXCLUDED.version, status = EXCLUDED.status,
             department_id = EXCLUDED.department_id,
             brand_is_function = EXCLUDED.brand_is_function,
             effective_date = EXCLUDED.effective_date, review_date = EXCLUDED.review_date,
             purpose = EXCLUDED.purpose, scope = EXCLUDED.scope,
             process_flow = EXCLUDED.process_flow,
             roles_responsibilities = EXCLUDED.roles_responsibilities,
             inputs_outputs = EXCLUDED.inputs_outputs, tools_forms = EXCLUDED.tools_forms,
             kpis = EXCLUDED.kpis, ownership_review = EXCLUDED.ownership_review,
             appendices = EXCLUDED.appendices, signatures_approval = EXCLUDED.signatures_approval,
             file_url = COALESCE(EXCLUDED.file_url, sops.file_url)
           RETURNING id`,
          [
            code,
            txt(r.TITLE),
            txt(r.DESCRIPTION) ?? txt(r.PURPOSE),
            versionOf(r.VERSION),
            sopDeptByCode.get(code) ?? deptByCode.get(txt(r["DEPARTMENT ID"]) ?? "") ?? null,
            opts.importUserId,
            effective,
            review,
            txt(r.PURPOSE),
            txt(r.SCOPE),
            txt(r["PROCESS FLOW"]),
            txt(r["ROLES & RESPONSIBILITIES"]),
            txt(r["INPUTS & OUTPUTS"]),
            txt(r["TOOLS & FORMS"]),
            txt(r["KEY PERFORMANCE INDICATORS (KPIS)"]),
            ownership,
            txt(r["APPENDICES - READY TO USE FORMS"]),
            txt(r["SIGNATURES & APPROVAL"]),
            sopUrlByCode.get(code)?.url ?? null,
          ]
        );
        const sopId = res.rows[0].id;
        sopIdByCode.set(code, sopId);

        // The workbook names exactly one department per SOP, but
        // sop_departments (migration 052) is what access scoping and the
        // acknowledgement queue read. Keep it in step with department_id
        // or imported SOPs would be invisible to non-admins.
        await client.query(
          `INSERT INTO sop_departments (sop_id, department_id)
           SELECT id, department_id FROM sops
           WHERE id = $1 AND department_id IS NOT NULL
           ON CONFLICT DO NOTHING`,
          [sopId]
        );
      }
      log.push(`SOPs: ${sopIdByCode.size} (status=approved)`);
      warnings.push(...sopReviewNotes.map((n) => `Review cycle: ${n}`));

      let domainSopLinks = 0;
      for (const r of rows.domains) {
        const sopId = sopIdByCode.get(txt(r["RELATED SOP CODE"]) ?? "");
        const code = txt(r["DOMAIN ID"]);
        if (!sopId || !code) continue;
        await client.query("UPDATE domains SET sop_id = $1 WHERE code = $2", [sopId, code]);
        domainSopLinks += 1;
      }
      log.push(`Domains linked to SOPs: ${domainSopLinks}`);

      const fwIdByCode = new Map<string, number>();
      for (const r of rows.frameworks) {
        const code = txt(r["FRAMEWORK ID"]);
        if (!code) continue;
        const sopCode = txt(r["RELATED SOP CODE"]);
        const res = await client.query<{ id: number }>(
          `INSERT INTO frameworks (code, name, description, category, domain_id, is_active,
                                   reference_source, sop_id, department_id)
           VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7,$8)
           ON CONFLICT (code) DO UPDATE SET
             name = EXCLUDED.name, description = EXCLUDED.description,
             category = EXCLUDED.category, domain_id = EXCLUDED.domain_id,
             is_active = TRUE, reference_source = EXCLUDED.reference_source,
             sop_id = EXCLUDED.sop_id, department_id = EXCLUDED.department_id
           RETURNING id`,
          [
            code,
            txt(r["FRAMEWORK NAME"]),
            txt(r["FRAMEWORK DESCRIPTION"]),
            txt(r["DOMAIN NAME"]),
            domainIdByCode.get(txt(r["DOMAIN ID"]) ?? "") ?? null,
            sopCode ? `${sopCode} — ${txt(r["RELATED SOP TITLE"])}` : null,
            sopIdByCode.get(sopCode ?? "") ?? null,
            deptByCode.get(txt(r["DEPARTMENT ID"]) ?? "") ?? null,
          ]
        );
        fwIdByCode.set(code, res.rows[0].id);
      }
      log.push(`Frameworks: ${fwIdByCode.size}`);

      const ctlIdByCode = new Map<string, number>();
      for (const r of rows.controls) {
        const code = txt(r["CONTROL ID"]);
        if (!code) continue;
        const risk = txt(r["RISK / ISSUE COVERED"]);
        const description = joinLines(
          txt(r["CONTROL DESCRIPTION"]),
          risk ? `Risk / issue covered: ${risk}` : null
        );
        const res = await client.query<{ id: number }>(
          `INSERT INTO controls (code, name, description, framework_id, category, is_active,
                                 health_status, requirement, clause_reference, reviewer_prompt)
           VALUES ($1,$2,$3,$4,$5,TRUE,'unknown',$6,$7,$8)
           ON CONFLICT (code) DO UPDATE SET
             name = EXCLUDED.name, description = EXCLUDED.description,
             framework_id = EXCLUDED.framework_id, category = EXCLUDED.category,
             is_active = TRUE, requirement = EXCLUDED.requirement,
             clause_reference = EXCLUDED.clause_reference,
             reviewer_prompt = EXCLUDED.reviewer_prompt
           RETURNING id`,
          [
            code,
            txt(r["CONTROL NAME"]),
            description,
            fwIdByCode.get(txt(r["FRAMEWORK ID"]) ?? "") ?? null,
            txt(r["CONTROL OWNER"]),
            txt(r["CONTROL OBJECTIVE"]),
            txt(r["RELATED PROCESS STEP"]),
            txt(r["REVIEWER PROMPT / WHAT TO ASK FOR"]),
          ]
        );
        ctlIdByCode.set(code, res.rows[0].id);

        const sopId = sopIdByCode.get(txt(r["RELATED SOP CODE"]) ?? "");
        if (sopId) {
          await client.query(
            `INSERT INTO control_links (control_id, entity_type, entity_id, created_by)
             VALUES ($1,'sop',$2,$3) ON CONFLICT DO NOTHING`,
            [res.rows[0].id, sopId, opts.importUserId]
          );
        }
      }
      log.push(`Controls: ${ctlIdByCode.size}`);

      const tplIdByCode = new Map<string, number>();
      for (const r of rows.checklists) {
        const code = txt(r["CHECKLIST ID"]);
        if (!code) continue;
        const res = await client.query<{ id: number }>(
          `INSERT INTO checklist_templates (code, name, description, category, is_active, created_by)
           VALUES ($1,$2,$3,$4,TRUE,$5)
           ON CONFLICT (code) DO UPDATE SET
             name = EXCLUDED.name, description = EXCLUDED.description,
             category = EXCLUDED.category, is_active = TRUE
           RETURNING id`,
          [code, txt(r["CHECKLIST NAME"]), txt(r["CHECKLIST DESCRIPTION"]), txt(r["DOMAIN NAME"]), opts.importUserId]
        );
        tplIdByCode.set(code, res.rows[0].id);
      }
      log.push(`Checklist templates: ${tplIdByCode.size}`);

      const itemIdByCode = new Map<string, number>();
      const sortByTemplate = new Map<string, number>();
      const questionItemIds: { testCode: string | null; itemId: number }[] = [];
      for (const r of rows.questions) {
        const tplCode = txt(r["CHECKLIST ID"]);
        if (!tplCode) continue;
        const templateId = tplIdByCode.get(tplCode);
        if (!templateId) {
          throw new Error(`Question references unknown checklist "${tplCode}".`);
        }
        const sort = (sortByTemplate.get(tplCode) ?? 0) + 1;
        sortByTemplate.set(tplCode, sort);

        // QUESTION ID is optional — synthesise a stable code from the
        // checklist code + position when blank, same as the CLI importer,
        // so a re-upload of the same file stays idempotent instead of
        // duplicating every unlabeled question.
        const code = txt(r["QUESTION ID"]) ?? `${tplCode}-Q${String(sort).padStart(2, "0")}`;

        const guidance = joinLines(
          txt(r["ANSWER TYPE"]) ? `Answer type: ${txt(r["ANSWER TYPE"])}` : null,
          txt(r["EXPECTED ANSWER"]) ? `Expected answer: ${txt(r["EXPECTED ANSWER"])}` : null,
          txt(r["EVIDENCE REQUIRED"]) ? `Evidence required: ${txt(r["EVIDENCE REQUIRED"])}` : null,
          txt(r["FINDING TRIGGER"]) ? `Finding trigger: ${txt(r["FINDING TRIGGER"])}` : null,
          txt(r["REVIEW NOTE"]) ? `Note: ${txt(r["REVIEW NOTE"])}` : null
        );

        const res = await client.query<{ id: number }>(
          `INSERT INTO checklist_items (template_id, code, sort_order, question, guidance, weight, is_critical, section)
           VALUES ($1,$2,$3,$4,$5,1,$6,$7)
           ON CONFLICT (code) DO UPDATE SET
             template_id = EXCLUDED.template_id, sort_order = EXCLUDED.sort_order,
             question = EXCLUDED.question, guidance = EXCLUDED.guidance,
             is_critical = EXCLUDED.is_critical, section = EXCLUDED.section
           RETURNING id`,
          [
            templateId,
            code,
            sort,
            txt(r.QUESTION),
            guidance,
            txt(r.MANDATORY)?.toLowerCase() === "yes",
            txt(r.SECTION),
          ]
        );
        itemIdByCode.set(code, res.rows[0].id);
        questionItemIds.push({ testCode: txt(r["TEST ID"]), itemId: res.rows[0].id });
      }
      log.push(`Questions: ${itemIdByCode.size}`);

      const failTrigger = txt(rows.questions[0]?.["FINDING TRIGGER"]);
      const checkIdByCode = new Map<string, number>();
      for (const r of rows.tests) {
        const code = txt(r["TEST ID"]);
        if (!code) continue;
        const tplCode = rows.checklists.find((c) => txt(c["TEST ID"]) === code)?.["CHECKLIST ID"];
        const evidence = joinLines(
          txt(r["EVIDENCE NAME"]) ? `${txt(r["EVIDENCE NAME"])}:` : null,
          txt(r["EVIDENCE DESCRIPTION"])
        );
        const res = await client.query<{ id: number }>(
          `INSERT INTO checks (code, name, control_id, frequency, is_active, checklist_template_id,
                               procedure_steps, frequency_label, evidence_code, evidence_needed,
                               performer_role, fail_criteria)
           VALUES ($1,$2,$3,'on_demand',TRUE,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (code) DO UPDATE SET
             name = EXCLUDED.name, control_id = EXCLUDED.control_id,
             checklist_template_id = EXCLUDED.checklist_template_id,
             procedure_steps = EXCLUDED.procedure_steps,
             frequency_label = EXCLUDED.frequency_label,
             evidence_code = EXCLUDED.evidence_code, evidence_needed = EXCLUDED.evidence_needed,
             performer_role = EXCLUDED.performer_role, fail_criteria = EXCLUDED.fail_criteria,
             is_active = TRUE
           RETURNING id`,
          [
            code,
            txt(r["TEST NAME"]),
            ctlIdByCode.get(txt(r["CONTROL ID"]) ?? "") ?? null,
            tplIdByCode.get(txt(tplCode) ?? "") ?? null,
            txt(r["TEST PROCEDURE"]),
            txt(r["TEST FREQUENCY"]),
            txt(r["EVIDENCE ID"]),
            evidence,
            txt(r["EVIDENCE OWNER"]),
            failTrigger,
          ]
        );
        checkIdByCode.set(code, res.rows[0].id);

        const ctlId = ctlIdByCode.get(txt(r["CONTROL ID"]) ?? "");
        if (ctlId) {
          await client.query(
            `INSERT INTO control_links (control_id, entity_type, entity_id, created_by)
             VALUES ($1,'check',$2,$3) ON CONFLICT DO NOTHING`,
            [ctlId, res.rows[0].id, opts.importUserId]
          );
        }
      }
      log.push(`Tests: ${checkIdByCode.size}`);

      let links = 0;
      for (const { testCode, itemId } of questionItemIds) {
        const checkId = checkIdByCode.get(testCode ?? "");
        if (!checkId || !itemId) continue;
        await client.query(
          `INSERT INTO check_checklist_items (check_id, checklist_item_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [checkId, itemId]
        );
        links += 1;
      }
      log.push(`Test ↔ question links: ${links}`);

      if (opts.dryRun) {
        throw { __dryRunAbort: true };
      }
      return true;
    }).catch((e) => {
      if (e && typeof e === "object" && "__dryRunAbort" in e) return false;
      throw e;
    });

    return {
      dryRun: opts.dryRun,
      committed: result === true,
      log,
      warnings,
      error: null,
    };
  } catch (e) {
    return {
      dryRun: opts.dryRun,
      committed: false,
      log,
      warnings,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
