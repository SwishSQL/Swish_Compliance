"use server";

import { promises as fs } from "fs";
import path from "path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { execute, queryAll, queryOne } from "@/lib/db";
import { createSop } from "@/features/sops/repository";

/* ────────────────────────────────────────────────────────────────── */
/*  ECS GRC Framework Bundle import                                   */
/*                                                                    */
/*  Loads public/seeds/ecs_grc.json (24 frameworks, 49 controls,      */
/*  147 tests) into the system. Idempotent: upserts on code (MERGE),  */
/*  so re-running is safe and counts only NEW inserts.                */
/* ────────────────────────────────────────────────────────────────── */

type EcsBundle = {
  meta: {
    source: string;
    extracted_at: string;
    counts: { frameworks: number; controls: number; tests: number };
  };
  frameworks: Array<Record<string, string>>;
  controls: Array<Record<string, string>>;
  tests: Array<Record<string, string>>;
};

/** Pick the first non-empty value, trimmed; return null if all empty. */
function pick(row: Record<string, string>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim().length > 0) return String(v).trim();
  }
  return null;
}

/** Map the xlsx frequency strings to our check.frequency enum.
 *  When the cell lists multiple ("Daily / Weekly"), pick the FIRST -
 *  the more conservative (frequent) one. */
function mapFrequency(raw: string | null): string {
  if (!raw) return "monthly";
  const lower = raw.toLowerCase();
  if (lower.includes("daily")) return "daily";
  if (lower.includes("weekly")) return "weekly";
  if (lower.includes("monthly")) return "monthly";
  if (lower.includes("quarterly")) return "quarterly";
  if (lower.includes("annual") || lower.includes("yearly")) return "annual";
  if (lower.includes("on demand") || lower.includes("ad-hoc") || lower.includes("ad hoc"))
    return "on_demand";
  return "monthly";
}

export async function importEcsGrcBundleAction(): Promise<void> {
  const admin = await requireAdmin();

  // 1) Load the pre-extracted JSON shipped under public/seeds/. The file is
  //    written by PowerShell with a UTF-8 BOM, which JSON.parse rejects -
  //    strip it before parsing.
  const jsonPath = path.join(process.cwd(), "public", "seeds", "ecs_grc.json");
  let raw: string;
  try {
    raw = await fs.readFile(jsonPath, "utf-8");
  } catch (e) {
    throw new Error(
      `Could not read seed file ${jsonPath}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  let bundle: EcsBundle;
  try {
    bundle = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Seed JSON is malformed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // 2) Insert frameworks. UPSERT pattern:
  //    - First import: row is inserted with all fields populated.
  //    - Re-import: only fields that are currently NULL get backfilled
  //      (COALESCE). Anything the user has edited in the UI is preserved.
  //    MERGE's $action tells us if this was a fresh insert.
  let fwInserted = 0;
  let fwExisting = 0;
  const fwIdByCode = new Map<string, number>();

  for (const f of bundle.frameworks) {
    const code = pick(f, "Framework ID");
    const name = pick(f, "Framework / Standard", "Framework/Standard");
    if (!code || !name) continue;

    const description = pick(f, "Framework Definition");
    const category = pick(f, "Pillar / Area", "Pillar/Area");
    const isActive = (pick(f, "Status") ?? "").toLowerCase() !== "inactive";
    const referenceSource = pick(f, "Reference Source / Standard");
    const scope = pick(f, "Scope / Main Controls");
    const reviewFrequency = pick(f, "Review Frequency");

    const row = await queryOne<{ id: number; inserted: boolean }>(
      `DECLARE @out TABLE (id INT, merge_action NVARCHAR(10));
       MERGE INTO frameworks WITH (HOLDLOCK) AS tgt
       USING (SELECT $1 AS code, $2 AS name, $3 AS description, $4 AS category,
                     $5 AS is_active, $6 AS reference_source, $7 AS scope,
                     $8 AS review_frequency) AS src
         ON tgt.code = src.code
       WHEN MATCHED THEN UPDATE SET
         reference_source = COALESCE(tgt.reference_source, src.reference_source),
         scope            = COALESCE(tgt.scope,            src.scope),
         review_frequency = COALESCE(tgt.review_frequency, src.review_frequency)
       WHEN NOT MATCHED THEN INSERT
         (code, name, description, category, is_active,
          reference_source, scope, review_frequency)
       VALUES (src.code, src.name, src.description, src.category, src.is_active,
               src.reference_source, src.scope, src.review_frequency)
       OUTPUT INSERTED.id, $action INTO @out (id, merge_action);
       SELECT id, CAST(CASE WHEN merge_action = 'INSERT' THEN 1 ELSE 0 END AS BIT) AS inserted
       FROM @out`,
      [code, name, description, category, isActive, referenceSource, scope, reviewFrequency]
    );
    if (!row) continue;
    fwIdByCode.set(code, row.id);
    if (row.inserted) fwInserted++;
    else fwExisting++;
  }

  // 3) Insert controls.
  let ctrlInserted = 0;
  let ctrlExisting = 0;
  const ctrlIdByCode = new Map<string, number>();

  for (const c of bundle.controls) {
    const code = pick(c, "Control ID");
    const name = pick(c, "Control Name");
    if (!code || !name) continue;

    const description =
      pick(c, "Control Definition") ?? pick(c, "Requirement / Checkpoint");
    const category = pick(c, "Pillar / Area", "Pillar/Area");
    const fwCode = pick(c, "Framework ID");
    const frameworkId = fwCode ? fwIdByCode.get(fwCode) ?? null : null;

    const requirement = pick(c, "Requirement / Checkpoint");
    const clauseRef = pick(c, "Clause / Reference Area");
    const evidenceReq = pick(c, "Evidence Required");
    const riskWeightRaw = pick(c, "Risk Weight");
    const riskWeight = riskWeightRaw ? parseInt(riskWeightRaw, 10) : null;
    const controlType = pick(c, "Control Type");
    const frequency = pick(c, "Frequency");

    const row = await queryOne<{ id: number; inserted: boolean }>(
      `DECLARE @out TABLE (id INT, merge_action NVARCHAR(10));
       MERGE INTO controls WITH (HOLDLOCK) AS tgt
       USING (SELECT $1 AS code, $2 AS name, $3 AS description,
                     CAST($4 AS INT) AS framework_id, $5 AS category,
                     $6 AS requirement, $7 AS clause_reference, $8 AS evidence_required,
                     CAST($9 AS INT) AS risk_weight, $10 AS control_type,
                     $11 AS frequency) AS src
         ON tgt.code = src.code
       WHEN MATCHED THEN UPDATE SET
         requirement       = COALESCE(tgt.requirement,       src.requirement),
         clause_reference  = COALESCE(tgt.clause_reference,  src.clause_reference),
         evidence_required = COALESCE(tgt.evidence_required, src.evidence_required),
         risk_weight       = COALESCE(tgt.risk_weight,       src.risk_weight),
         control_type      = COALESCE(tgt.control_type,      src.control_type),
         frequency         = COALESCE(tgt.frequency,         src.frequency)
       WHEN NOT MATCHED THEN INSERT
         (code, name, description, framework_id, category, health_status,
          requirement, clause_reference, evidence_required,
          risk_weight, control_type, frequency)
       VALUES (src.code, src.name, src.description, src.framework_id, src.category, 'unknown',
               src.requirement, src.clause_reference, src.evidence_required,
               src.risk_weight, src.control_type, src.frequency)
       OUTPUT INSERTED.id, $action INTO @out (id, merge_action);
       SELECT id, CAST(CASE WHEN merge_action = 'INSERT' THEN 1 ELSE 0 END AS BIT) AS inserted
       FROM @out`,
      [
        code,
        name,
        description,
        frameworkId,
        category,
        requirement,
        clauseRef,
        evidenceReq,
        Number.isFinite(riskWeight as number) ? riskWeight : null,
        controlType,
        frequency,
      ]
    );
    if (!row) continue;
    ctrlIdByCode.set(code, row.id);
    if (row.inserted) ctrlInserted++;
    else ctrlExisting++;
  }

  // 4) Insert tests (our "checks" table).
  let testInserted = 0;
  let testExisting = 0;
  for (const t of bundle.tests) {
    const code = pick(t, "Test ID");
    const name = pick(t, "Test Name");
    if (!code || !name) continue;

    const description =
      pick(t, "Test Definition") ?? pick(t, "Mandatory Action / How to Perform");
    const ctrlCode = pick(t, "Control ID");
    const controlId = ctrlCode ? ctrlIdByCode.get(ctrlCode) ?? null : null;
    const frequency = mapFrequency(pick(t, "Frequency"));

    const procedureSteps = pick(t, "Mandatory Action / How to Perform");
    const evidenceNeeded = pick(t, "Evidence Needed");
    const method = pick(t, "Method");
    const performerRole = pick(t, "Performer");
    const reviewerRole = pick(t, "Reviewer");

    const row = await queryOne<{ inserted: boolean }>(
      `DECLARE @out TABLE (merge_action NVARCHAR(10));
       MERGE INTO checks WITH (HOLDLOCK) AS tgt
       USING (SELECT $1 AS code, $2 AS name, $3 AS description,
                     CAST($4 AS INT) AS control_id, $5 AS frequency,
                     $6 AS procedure_steps, $7 AS evidence_needed, $8 AS method,
                     $9 AS performer_role, $10 AS reviewer_role) AS src
         ON tgt.code = src.code
       WHEN MATCHED THEN UPDATE SET
         procedure_steps = COALESCE(tgt.procedure_steps, src.procedure_steps),
         evidence_needed = COALESCE(tgt.evidence_needed, src.evidence_needed),
         method          = COALESCE(tgt.method,          src.method),
         performer_role  = COALESCE(tgt.performer_role,  src.performer_role),
         reviewer_role   = COALESCE(tgt.reviewer_role,   src.reviewer_role)
       WHEN NOT MATCHED THEN INSERT
         (code, name, description, control_id, frequency,
          procedure_steps, evidence_needed, method,
          performer_role, reviewer_role)
       VALUES (src.code, src.name, src.description, src.control_id, src.frequency,
               src.procedure_steps, src.evidence_needed, src.method,
               src.performer_role, src.reviewer_role)
       OUTPUT $action INTO @out (merge_action);
       SELECT CAST(CASE WHEN merge_action = 'INSERT' THEN 1 ELSE 0 END AS BIT) AS inserted
       FROM @out`,
      [
        code,
        name,
        description,
        controlId,
        frequency,
        procedureSteps,
        evidenceNeeded,
        method,
        performerRole,
        reviewerRole,
      ]
    );
    if (!row) continue;
    if (row.inserted) testInserted++;
    else testExisting++;
  }

  // 5) Audit trail entry summarizing the import.
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'import:ecs_grc_bundle', 'system', 0, $3)`,
    [
      admin.id,
      admin.email,
      JSON.stringify({
        source: bundle.meta.source,
        extracted_at: bundle.meta.extracted_at,
        frameworks_inserted: fwInserted,
        frameworks_already_existed: fwExisting,
        controls_inserted: ctrlInserted,
        controls_already_existed: ctrlExisting,
        tests_inserted: testInserted,
        tests_already_existed: testExisting,
      }),
    ]
  );

  // 6) Refresh the obvious surfaces.
  revalidatePath("/frameworks");
  revalidatePath("/controls");
  revalidatePath("/tests");
  revalidatePath("/reports");
}

/**
 * The 9 departments referenced by the SOPs Wave 1 & 2 Playbook (June 2026)
 * that aren't part of the original seed. Order matches the playbook's
 * table of contents.
 */
const PLAYBOOK_DEPARTMENTS = [
  "L&D",
  "CPU",
  "Warehouse",
  "Procurement",
  "Cost Control",
  "Maintenance",
  "Customer Care",
  "IT",
  "OPEX",
];

/**
 * Bulk-create the departments above. Skips names that already exist, so the
 * action is idempotent — re-running it is safe and will simply skip the
 * departments that already exist.
 *
 * Returns silently to keep server-action behaviour; the page revalidates
 * itself so the user immediately sees the new rows.
 */
export async function seedPlaybookDepartmentsAction(): Promise<void> {
  const admin = await requireAdmin();

  // 1) Find which ones don't exist yet so we can audit only the creations.
  const existing = await queryAll<{ name: string }>(
    `SELECT name FROM departments`
  );
  const existingNames = new Set(existing.map((r) => r.name.toLowerCase()));

  const toCreate = PLAYBOOK_DEPARTMENTS.filter(
    (n) => !existingNames.has(n.toLowerCase())
  );

  if (toCreate.length === 0) {
    // Nothing to do — every department is already present.
    revalidatePath("/admin/config");
    return;
  }

  // 2) Insert them in a single statement for speed and atomicity.
  await execute(
    `INSERT INTO departments (name)
     SELECT DISTINCT n.value FROM OPENJSON($1) AS n
     WHERE NOT EXISTS (SELECT 1 FROM departments d WHERE d.name = n.value)`,
    [JSON.stringify(toCreate)]
  );

  // 3) Audit each one. We re-query to grab the IDs assigned by Postgres.
  const created = await queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM departments WHERE name = ANY($1::text[])`,
    [toCreate]
  );
  for (const row of created) {
    await execute(
      `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
       VALUES ($1, $2, 'department:create', 'department', $3, $4)`,
      [
        admin.id,
        admin.email,
        row.id,
        JSON.stringify({ name: row.name, source: "playbook_seed" }),
      ]
    );
  }

  revalidatePath("/admin/config");
  revalidatePath("/sops");
}

/**
 * Read public/seeds/recruitment-sop.xlsx, convert to a base64 data URL,
 * and create a SOP draft pre-filled with the metadata from the source
 * Excel template. After running, the SOP appears in /sops as a Draft —
 * the workflow (Compliance → BE → CEO) then proceeds as normal.
 *
 * Re-running is safe: we check whether a SOP with the same code already
 * exists and bail out early to avoid duplicates.
 */
export async function importRecruitmentSopAction(): Promise<void> {
  const user = await requireAdmin();

  // 1) Guard against duplicates so a double-click doesn't create two rows.
  const SEED_CODE = "HRD-REC-01";
  const existing = await queryOne<{ id: number }>(
    `SELECT TOP (1) id FROM sops WHERE code = $1`,
    [SEED_CODE]
  );
  if (existing) {
    // Already there — just take the admin to the existing SOP.
    revalidatePath("/sops");
    redirect(`/sops/${existing.id}`);
  }

  // 2) Read the template xlsx from disk and inline it as a data URL.
  //    `process.cwd()` resolves to the project root at runtime.
  const filePath = path.join(process.cwd(), "public", "seeds", "recruitment-sop.xlsx");
  const buffer = await fs.readFile(filePath);
  const base64 = buffer.toString("base64");
  const mime =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const dataUrl = `data:${mime};base64,${base64}`;

  // 3) Look up the HR department if it exists; otherwise leave null.
  //    We try a few common spellings ("Human Resources", "HR", "People & Culture").
  const dept = await queryOne<{ id: number }>(
    `SELECT TOP (1) id FROM departments
     WHERE name LIKE 'Human Resources' OR name LIKE 'HR' OR name LIKE 'People%'
     ORDER BY is_active DESC, id ASC`
  );

  // 4) Insert the SOP with the metadata pulled straight from the template.
  const description =
    "Universal SOP for Recruitment, Selection and Onboarding within SWiSH Group. " +
    "Covers Workforce Planning, Sourcing, Screening, Interview & Selection, Offer " +
    "Management, Onboarding & Orientation, Probation, and the Employee Referral " +
    "Program. ISO-aligned and compliant with Kuwait labour regulations.";

  const sopId = await createSop({
    code: SEED_CODE,
    title: "Recruitment SOP",
    description,
    version: "1.0",
    attachment_data_url: dataUrl,
    attachment_name: "Recruitment_SOP_Universal_Template.xlsx",
    attachment_mime: mime,
    department_id: dept?.id ?? null,
    effective_date: "2026-06-01",
    review_date: "2026-12-01",
    created_by: user.id,
  });

  // 5) Log the import so it shows up in the activity feed.
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'create', 'sop', $3, $4)`,
    [
      user.id,
      user.email,
      sopId,
      JSON.stringify({
        source: "admin_import",
        template: "Recruitment_SOP_Universal_Template.xlsx",
      }),
    ]
  );

  revalidatePath("/sops");
  redirect(`/sops/${sopId}`);
}
