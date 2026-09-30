import "server-only";
import { queryAll, queryOne, execute } from "@/lib/db";
import {
  AUDIT_RESPONSE_SHORTFALL_SQL,
  AUDIT_RESPONSE_PERFORMANCE_SQL,
} from "@/features/audits/types";
import type {
  Capa,
  CapaSeverity,
  CapaStatus,
  AuditFinding,
  CapaEvidence,
  CapaAuditorContext,
} from "./types";

/** What counts as a finding on an audit response aliased `r` — see
 *  AUDIT_RESPONSE_SHORTFALL_SQL (migration 054) for the exact rule. */
const SHORTFALL_SQL = AUDIT_RESPONSE_SHORTFALL_SQL;

const CAPA_SELECT = `
  c.id, c.code, c.title, c.description, c.severity, c.status,
  c.source_audit_id, c.source_item_id,
  c.brand_id, b.name AS brand_name,
  c.department_id, d.name AS department_name,
  c.assigned_to, u_a.display_name AS assigned_to_name,
  c.created_by, u_c.display_name AS created_by_name,
  c.verified_by, u_v.display_name AS verified_by_name,
  c.due_date, c.resolution_note, c.evidence_url,
  c.submitted_at, c.verified_at, c.closed_at,
  c.created_at, c.updated_at,
  c.start_date, c.assignment_note,
  c.reviewer_id, u_r.display_name AS reviewer_name,
  c.root_cause, c.corrective_action_taken, c.preventive_action_taken,
  c.completion_note, c.rejection_reason
FROM corrective_actions c
LEFT JOIN brands       b   ON b.id = c.brand_id
LEFT JOIN departments  d   ON d.id = c.department_id
LEFT JOIN users        u_a ON u_a.id = c.assigned_to
LEFT JOIN users        u_c ON u_c.id = c.created_by
LEFT JOIN users        u_v ON u_v.id = c.verified_by
LEFT JOIN users        u_r ON u_r.id = c.reviewer_id
`;

export async function listCapas(filters: {
  status?: CapaStatus;
  assigned_to?: number;
  search?: string;
  /** When set, restricts to CAPAs in this department. Used for the DM
   *  role on the main register. */
  scopedToDepartmentId?: number;
  /** When set, restricts to CAPAs assigned to OR created by this user.
   *  Used for non-privileged roles so they only see their own work. */
  scopedToUserId?: number;
} = {}): Promise<Capa[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`c.status = $${params.length}`);
  }
  if (filters.assigned_to) {
    params.push(filters.assigned_to);
    conditions.push(`c.assigned_to = $${params.length}`);
  }
  if (filters.scopedToDepartmentId) {
    params.push(filters.scopedToDepartmentId);
    conditions.push(`c.department_id = $${params.length}`);
  }
  if (filters.scopedToUserId) {
    params.push(filters.scopedToUserId);
    conditions.push(
      `(c.assigned_to = $${params.length} OR c.created_by = $${params.length})`
    );
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(c.title ILIKE $${params.length} OR c.code ILIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return queryAll<Capa>(
    `SELECT ${CAPA_SELECT} ${where}
     ORDER BY
       CASE c.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'submitted' THEN 2 ELSE 3 END,
       c.due_date NULLS LAST, c.id DESC
     LIMIT 200`,
    params
  );
}

/**
 * Fetches the FINDING context for a CAPA — the audit + control + test
 * + question + auditor answer/note/evidence that spawned it. Read-only
 * on the CAPA page so the owner knows exactly what they're fixing.
 * Returns undefined when the CAPA wasn't spawned from an audit
 * (standalone CAPAs).
 */
export async function getCapaAuditorContext(
  capaId: number
): Promise<CapaAuditorContext | undefined> {
  return queryOne<CapaAuditorContext>(
    `SELECT
       a.id            AS audit_id,
       a.audit_date,
       br.name         AS brand_name,
       d.name          AS department_name,
       a.location,
       f.code          AS framework_code, f.name AS framework_name,
       ctrl.code       AS control_code,   ctrl.name AS control_name,
       -- Pick the FIRST test that surfaced this item for this audit
       (SELECT ch.code FROM audit_tests at
        JOIN check_checklist_items cci ON cci.check_id = at.check_id
        JOIN checks ch ON ch.id = at.check_id
        WHERE at.audit_id = a.id AND cci.checklist_item_id = i.id
        ORDER BY ch.id LIMIT 1) AS test_code,
       (SELECT ch.name FROM audit_tests at
        JOIN check_checklist_items cci ON cci.check_id = at.check_id
        JOIN checks ch ON ch.id = at.check_id
        WHERE at.audit_id = a.id AND cci.checklist_item_id = i.id
        ORDER BY ch.id LIMIT 1) AS test_name,
       i.question,
       r.response      AS auditor_response,
       r.yes_percent, r.no_percent, r.na_percent,
       -- NULL when there's no linked response at all (standalone CAPA) or
       -- the question was 100% N-A, same "excluded" meaning as elsewhere.
       CASE WHEN r.yes_percent IS NOT NULL AND (r.yes_percent + r.no_percent) > 0
            THEN ROUND(r.yes_percent * 100.0 / (r.yes_percent + r.no_percent))::int
            ELSE NULL END AS performance_percent,
       r.notes         AS auditor_note,
       r.evidence_url  AS auditor_evidence_url,
       r.evidence_name AS auditor_evidence_name,
       r.evidence_mime AS auditor_evidence_mime
     FROM corrective_actions c
     JOIN audits             a    ON a.id  = c.source_audit_id
     JOIN checklist_items    i    ON i.id  = c.source_item_id
     LEFT JOIN audit_responses r
       ON r.audit_id = c.source_audit_id AND r.item_id = c.source_item_id
     LEFT JOIN brands        br   ON br.id = a.brand_id
     LEFT JOIN departments   d    ON d.id  = a.department_id
     LEFT JOIN frameworks    f    ON f.id  = a.framework_id
     LEFT JOIN controls      ctrl ON ctrl.id = a.control_id
     WHERE c.id = $1`,
    [capaId]
  );
}

/**
 * Update the owner's execution fields on a CAPA. Doesn't touch status
 * — status transitions live in their own action so we can log them
 * separately. Called by the "Save progress" button on the owner view.
 */
export async function saveCapaExecution(input: {
  id: number;
  root_cause: string | null;
  corrective_action_taken: string | null;
  preventive_action_taken: string | null;
  completion_note: string | null;
}): Promise<void> {
  await execute(
    `UPDATE corrective_actions SET
       root_cause              = $2,
       corrective_action_taken = $3,
       preventive_action_taken = $4,
       completion_note         = $5
     WHERE id = $1::int`,
    [
      input.id,
      input.root_cause,
      input.corrective_action_taken,
      input.preventive_action_taken,
      input.completion_note,
    ]
  );
}

/**
 * Set the rejection reason when a reviewer sends the CAPA back to the
 * owner. Written alongside the status transition (rejected) so the
 * owner sees the reason without opening the audit log.
 */
export async function setCapaRejectionReason(
  id: number,
  reason: string | null
): Promise<void> {
  await execute(
    `UPDATE corrective_actions SET rejection_reason = $2 WHERE id = $1::int`,
    [id, reason]
  );
}

/* ─── CAPA evidences (migration 041) ─────────────────────────── */

export async function listCapaEvidences(
  capaId: number
): Promise<CapaEvidence[]> {
  return queryAll<CapaEvidence>(
    `SELECT
       ev.id, ev.capa_id, ev.file_url, ev.file_name, ev.file_mime,
       ev.file_size, ev.uploaded_by, u.display_name AS uploaded_by_name,
       ev.uploaded_at
     FROM capa_evidences ev
     LEFT JOIN users u ON u.id = ev.uploaded_by
     WHERE ev.capa_id = $1
     ORDER BY ev.uploaded_at DESC, ev.id DESC`,
    [capaId]
  );
}

export async function addCapaEvidence(input: {
  capa_id: number;
  file_url: string;
  file_name: string;
  file_mime: string | null;
  file_size: number | null;
  uploaded_by: number;
}): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO capa_evidences
       (capa_id, file_url, file_name, file_mime, file_size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.capa_id,
      input.file_url,
      input.file_name,
      input.file_mime,
      input.file_size,
      input.uploaded_by,
    ]
  );
  return row!.id;
}

/** Delete a single CAPA evidence file. Returns the parent capa_id so */
/** the action layer can revalidate the right page. */
export async function deleteCapaEvidence(
  evidenceId: number
): Promise<number | null> {
  const row = await queryOne<{ capa_id: number }>(
    `DELETE FROM capa_evidences WHERE id = $1 RETURNING capa_id`,
    [evidenceId]
  );
  return row?.capa_id ?? null;
}

/** Change who a CAPA is assigned to. The notify on the action layer */
/** picks up the new assignee separately. */
export async function setCapaAssignee(
  id: number,
  assigneeId: number | null
): Promise<void> {
  await execute(
    `UPDATE corrective_actions SET assigned_to = $2 WHERE id = $1`,
    [id, assigneeId]
  );
}

export async function getCapa(id: number): Promise<Capa | undefined> {
  return queryOne<Capa>(`SELECT ${CAPA_SELECT} WHERE c.id = $1`, [id]);
}

/**
 * Every failed audit finding, joined with its scope chain and the CAPA
 * currently linked to it (if any). Returns one row per failed
 * checklist item. The page groups them into Audit → Control → Test →
 * Item cards.
 *
 * The check → item link uses check_checklist_items so we can attribute
 * each failed question to the SPECIFIC test that surfaced it. When an
 * item isn't linked to a test yet (legacy template-only audits),
 * test_id comes back NULL and the UI renders it under a "No test"
 * bucket.
 */
export async function listAuditFindings(filters: {
  audit_id?: number;
  department_id?: number;
  brand_id?: number;
  severity?: CapaSeverity;
  status?: CapaStatus | "unassigned";
  assigned_to?: number;
  due_date_before?: string;
  location?: string;
} = {}): Promise<AuditFinding[]> {
  const cond: string[] = [SHORTFALL_SQL];
  const params: unknown[] = [];

  if (filters.audit_id) {
    params.push(filters.audit_id);
    cond.push(`a.id = $${params.length}`);
  }
  if (filters.department_id) {
    params.push(filters.department_id);
    cond.push(`a.department_id = $${params.length}`);
  }
  if (filters.brand_id) {
    params.push(filters.brand_id);
    cond.push(`a.brand_id = $${params.length}`);
  }
  if (filters.severity) {
    params.push(filters.severity);
    cond.push(`ca.severity = $${params.length}`);
  }
  if (filters.status === "unassigned") {
    cond.push(`(ca.id IS NULL OR ca.assigned_to IS NULL)`);
  } else if (filters.status) {
    params.push(filters.status);
    cond.push(`ca.status = $${params.length}`);
  }
  if (filters.assigned_to) {
    params.push(filters.assigned_to);
    cond.push(`ca.assigned_to = $${params.length}`);
  }
  if (filters.due_date_before) {
    params.push(filters.due_date_before);
    cond.push(`ca.due_date <= $${params.length}`);
  }
  if (filters.location) {
    params.push(`%${filters.location}%`);
    cond.push(`a.location ILIKE $${params.length}`);
  }

  return queryAll<AuditFinding>(
    `SELECT
       a.id      AS audit_id,
       a.status  AS audit_status,
       a.score::text AS audit_score,
       a.audit_date,
       b.name    AS audit_brand_name,
       a.department_id AS audit_department_id,
       d.name    AS audit_department_name,
       a.location AS audit_location,
       f.code    AS framework_code, f.name AS framework_name,
       ctrl.id   AS control_id, ctrl.code AS control_code, ctrl.name AS control_name,
       -- Pick the FIRST test that links to this item for this audit. A
       -- question could theoretically appear under two tests; the audit
       -- resolves it once. First subquery just uses at.check_id so we
       -- don't need to JOIN checks (that was the bug); the other two
       -- do JOIN because they need code + name off checks.
       (SELECT at.check_id
        FROM audit_tests at
        JOIN check_checklist_items cci ON cci.check_id = at.check_id
        WHERE at.audit_id = a.id AND cci.checklist_item_id = i.id
        ORDER BY at.check_id LIMIT 1) AS test_id,
       (SELECT ch.code FROM audit_tests at
        JOIN check_checklist_items cci ON cci.check_id = at.check_id
        JOIN checks ch ON ch.id = at.check_id
        WHERE at.audit_id = a.id AND cci.checklist_item_id = i.id
        ORDER BY ch.id LIMIT 1) AS test_code,
       (SELECT ch.name FROM audit_tests at
        JOIN check_checklist_items cci ON cci.check_id = at.check_id
        JOIN checks ch ON ch.id = at.check_id
        WHERE at.audit_id = a.id AND cci.checklist_item_id = i.id
        ORDER BY ch.id LIMIT 1) AS test_name,
       i.id AS item_id, i.code AS item_code, i.question, i.is_critical,
       r.yes_percent, r.no_percent, r.na_percent,
       ROUND(${AUDIT_RESPONSE_PERFORMANCE_SQL})::int AS performance_percent,
       r.notes        AS auditor_note,
       r.evidence_url, r.evidence_name, r.evidence_mime,
       ca.id          AS capa_id,
       ca.code        AS capa_code,
       ca.status      AS capa_status,
       ca.severity    AS capa_severity,
       ca.assigned_to AS capa_assigned_to,
       u.display_name AS capa_assigned_to_name,
       ca.due_date    AS capa_due_date
     FROM audit_responses r
     JOIN audits             a    ON a.id  = r.audit_id
     JOIN checklist_items    i    ON i.id  = r.item_id
     LEFT JOIN brands        b    ON b.id  = a.brand_id
     LEFT JOIN departments   d    ON d.id  = a.department_id
     LEFT JOIN frameworks    f    ON f.id  = a.framework_id
     LEFT JOIN controls      ctrl ON ctrl.id = a.control_id
     LEFT JOIN corrective_actions ca
       ON ca.source_audit_id = a.id AND ca.source_item_id = i.id
     LEFT JOIN users         u    ON u.id  = ca.assigned_to
     WHERE ${cond.join(" AND ")}
       AND a.status IN ('submitted','closed')
     ORDER BY a.id DESC, ctrl.id NULLS LAST, i.sort_order, i.id
     LIMIT 500`,
    params
  );
}

/**
 * The failed findings under one audit's control that can still be
 * bulk-assigned: no CAPA row yet, or a CAPA nobody is assigned to.
 * Findings whose CAPA already has an assignee are deliberately
 * excluded — bulk assign must never steal work from someone.
 *
 * The control filter uses IS NOT DISTINCT FROM because legacy audits
 * can have control_id NULL and the UI still shows them under a
 * "No control linked" group that should be bulk-assignable too.
 */
export async function listBulkAssignableFindings(
  auditId: number,
  controlId: number | null
): Promise<{ item_id: number; question: string }[]> {
  return queryAll<{ item_id: number; question: string }>(
    `SELECT i.id AS item_id, i.question
     FROM audit_responses r
     JOIN audits          a ON a.id = r.audit_id
     JOIN checklist_items i ON i.id = r.item_id
     LEFT JOIN corrective_actions ca
       ON ca.source_audit_id = a.id AND ca.source_item_id = i.id
     WHERE ${SHORTFALL_SQL}
       AND a.id = $1::int
       AND a.control_id IS NOT DISTINCT FROM $2::int
       AND a.status IN ('submitted','closed')
       AND (ca.id IS NULL OR ca.assigned_to IS NULL)
     ORDER BY i.sort_order, i.id`,
    [auditId, controlId]
  );
}

/**
 * Auto-create an 'open' unassigned CAPA for every failed finding of an
 * audit that doesn't have one yet (per user spec: "any failed question
 * must become a CAPA"). Called right after audit submit. Set-based and
 * idempotent — the NOT EXISTS anti-join makes re-runs no-ops, and the
 * per-audit code sequence continues from the existing count.
 *
 * Severity defaults: critical questions → 'critical', the rest →
 * 'medium'. Whoever later assigns the CAPA picks the real severity in
 * the assignment modal (upsert overwrites it).
 */
/**
 * Auto-created CAPAs land directly on the audited department's manager
 * (departments.manager_id) — user spec: a CAPA should reach the
 * department manager without anyone having to assign it by hand.
 * Departments with no manager set still fall back to 'open'/unassigned.
 */
export async function autoCreateCapasForAudit(
  auditId: number,
  createdBy: number | null
): Promise<{ count: number; assignedManagerIds: number[] }> {
  const rows = await queryAll<{ id: number; assigned_to: number | null }>(
    `INSERT INTO corrective_actions
       (code, title, severity, source_audit_id, source_item_id,
        brand_id, department_id, assigned_to, created_by, status)
     SELECT
       'CAPA-AUD' || a.id || '-' ||
         LPAD((base.n + ROW_NUMBER() OVER (ORDER BY i.sort_order, i.id))::text, 3, '0'),
       LEFT(i.question, 250),
       CASE WHEN i.is_critical THEN 'critical' ELSE 'medium' END,
       a.id, i.id, a.brand_id, a.department_id, d.manager_id, $2::int,
       CASE WHEN d.manager_id IS NOT NULL THEN 'in_progress' ELSE 'open' END
     FROM audits a
     JOIN audit_responses r ON r.audit_id = a.id AND ${SHORTFALL_SQL}
     JOIN checklist_items i ON i.id = r.item_id
     LEFT JOIN departments d ON d.id = a.department_id
     CROSS JOIN (SELECT COUNT(*)::int AS n
                 FROM corrective_actions WHERE source_audit_id = $1) base
     WHERE a.id = $1
       AND NOT EXISTS (SELECT 1 FROM corrective_actions ca
                       WHERE ca.source_audit_id = a.id
                         AND ca.source_item_id = i.id)
     RETURNING id, assigned_to`,
    [auditId, createdBy]
  );
  const assignedManagerIds = [
    ...new Set(
      rows.map((r) => r.assigned_to).filter((id): id is number => id != null)
    ),
  ];
  return { count: rows.length, assignedManagerIds };
}

/** Brand/department scope of an audit — copied onto bulk-created CAPAs. */
export async function getAuditScope(
  auditId: number
): Promise<{ brand_id: number | null; department_id: number | null } | undefined> {
  return queryOne<{ brand_id: number | null; department_id: number | null }>(
    `SELECT brand_id, department_id FROM audits WHERE id = $1`,
    [auditId]
  );
}

/**
 * Same as getAuditScope but for many audits at once — used by the
 * cross-audit bulk-assign action, which needs to re-verify (server-side)
 * the real department of every selected finding's audit, not just one.
 */
export async function getAuditScopesMap(
  auditIds: number[]
): Promise<Map<number, { brand_id: number | null; department_id: number | null }>> {
  if (auditIds.length === 0) return new Map();
  const rows = await queryAll<{
    id: number;
    brand_id: number | null;
    department_id: number | null;
  }>(
    `SELECT id, brand_id, department_id FROM audits WHERE id = ANY($1::int[])`,
    [[...new Set(auditIds)]]
  );
  return new Map(rows.map((r) => [r.id, { brand_id: r.brand_id, department_id: r.department_id }]));
}

/**
 * Create OR update the CAPA linked to a specific (audit, item) pair.
 * The upsert key is (source_audit_id, source_item_id) — a finding can
 * only ever have ONE CAPA row.
 *
 * New CAPAs get an AUD-scoped code (CAPA-AUD<id>-NNN) so ops teams can
 * eyeball the audit each CAPA came from without opening it.
 */
export async function upsertCapaFromFinding(input: {
  audit_id: number;
  item_id: number;
  title: string;
  severity: CapaSeverity;
  brand_id?: number | null;
  department_id?: number | null;
  assigned_to: number;
  reviewer_id?: number | null;
  start_date?: string | null;
  due_date?: string | null;
  assignment_note?: string | null;
  created_by: number;
}): Promise<{ id: number; code: string; created: boolean }> {
  const existing = await queryOne<{ id: number; code: string | null }>(
    `SELECT id, code FROM corrective_actions
     WHERE source_audit_id = $1 AND source_item_id = $2`,
    [input.audit_id, input.item_id]
  );

  if (existing) {
    // Two-step update to avoid Postgres 42P08 "inconsistent types
    // deduced for parameter" (same class of bug we hit earlier in
    // transitionCapa). $6 was appearing in "assigned_to = $6" AND in
    // "$6 IS NOT NULL" inside a CASE — the parser couldn't reconcile
    // int vs unknown. Splitting into two simple UPDATEs sidesteps
    // parameter-reuse entirely and is trivial cost-wise.
    await execute(
      `UPDATE corrective_actions SET
         title           = $2,
         severity        = $3::text,
         brand_id        = COALESCE($4::int, brand_id),
         department_id   = COALESCE($5::int, department_id),
         assigned_to     = $6::int,
         reviewer_id     = $7::int,
         start_date      = $8::date,
         due_date        = $9::date,
         assignment_note = $10
       WHERE id = $1::int`,
      [
        existing.id,
        input.title,
        input.severity,
        input.brand_id ?? null,
        input.department_id ?? null,
        input.assigned_to,
        input.reviewer_id ?? null,
        input.start_date ?? null,
        input.due_date ?? null,
        input.assignment_note ?? null,
      ]
    );
    // Auto-transition open → in_progress once someone is on it. Done
    // as a separate statement so it can't reintroduce the type clash.
    await execute(
      `UPDATE corrective_actions
         SET status = 'in_progress'
       WHERE id = $1::int
         AND status = 'open'
         AND assigned_to IS NOT NULL`,
      [existing.id]
    );
    return {
      id: existing.id,
      code: existing.code ?? `CAPA-${existing.id}`,
      created: false,
    };
  }

  // New CAPA. Code = CAPA-AUD<audit>-<seq> where seq is 1-based across
  // CAPAs for the same audit, including the row we're about to insert.
  const seqRow = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int + 1 AS n
       FROM corrective_actions WHERE source_audit_id = $1`,
    [input.audit_id]
  );
  const seq = (seqRow?.n ?? 1).toString().padStart(3, "0");
  const code = `CAPA-AUD${input.audit_id}-${seq}`;

  const row = await queryOne<{ id: number }>(
    // Explicit casts match the UPDATE branch above — belt and braces
    // against the same 42P08 class of bug (Postgres deducing the
    // wrong type for a parameter that's used in multiple contexts).
    `INSERT INTO corrective_actions
       (code, title, description, severity, source_audit_id, source_item_id,
        brand_id, department_id, assigned_to, reviewer_id,
        start_date, due_date, assignment_note, created_by, status)
     VALUES ($1, $2, NULL, $3::text, $4::int, $5::int,
             $6::int, $7::int, $8::int, $9::int,
             $10::date, $11::date, $12, $13::int, 'in_progress')
     RETURNING id`,
    [
      code,
      input.title,
      input.severity,
      input.audit_id,
      input.item_id,
      input.brand_id ?? null,
      input.department_id ?? null,
      input.assigned_to,
      input.reviewer_id ?? null,
      input.start_date ?? null,
      input.due_date ?? null,
      input.assignment_note ?? null,
      input.created_by,
    ]
  );
  return { id: row!.id, code, created: true };
}

export async function createCapa(input: {
  title: string;
  description?: string | null;
  severity: CapaSeverity;
  source_audit_id?: number | null;
  source_item_id?: number | null;
  brand_id?: number | null;
  department_id?: number | null;
  assigned_to?: number | null;
  due_date?: string | null;
  created_by: number;
}): Promise<number> {
  const code = `CAPA-${Date.now().toString().slice(-8)}`;
  const row = await queryOne<{ id: number }>(
    `INSERT INTO corrective_actions
       (code, title, description, severity, source_audit_id, source_item_id,
        brand_id, department_id, assigned_to, due_date, created_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open')
     RETURNING id`,
    [
      code,
      input.title,
      input.description ?? null,
      input.severity,
      input.source_audit_id ?? null,
      input.source_item_id ?? null,
      input.brand_id ?? null,
      input.department_id ?? null,
      input.assigned_to ?? null,
      input.due_date ?? null,
      input.created_by,
    ]
  );
  return row!.id;
}

export async function transitionCapa(
  id: number,
  next: CapaStatus,
  data: {
    resolution_note?: string | null;
    evidence_url?: string | null;
    verified_by?: number | null;
  } = {}
): Promise<void> {
  if (next === "submitted") {
    await execute(
      `UPDATE corrective_actions SET
         status = 'submitted',
         resolution_note = COALESCE($2, resolution_note),
         evidence_url = COALESCE($3, evidence_url),
         submitted_at = NOW()
       WHERE id = $1`,
      [id, data.resolution_note ?? null, data.evidence_url ?? null]
    );
  } else if (next === "verified" || next === "closed") {
    // $2 is used twice — once assigned to status (VARCHAR(30)) and once
    // compared against a TEXT literal ('closed'). Without the explicit
    // ::text cast Postgres throws 42P08 "inconsistent types deduced for
    // parameter" because it can't tell whether $2 should be VARCHAR or
    // TEXT. Casting both sides to text makes the type unambiguous; the
    // assignment then implicitly coerces back to VARCHAR(30).
    await execute(
      `UPDATE corrective_actions SET
         status = $2::text,
         verified_by = $3,
         verified_at = COALESCE(verified_at, NOW()),
         closed_at = CASE WHEN $2::text = 'closed' THEN NOW() ELSE closed_at END
       WHERE id = $1`,
      [id, next, data.verified_by ?? null]
    );
  } else if (next === "rejected") {
    await execute(
      `UPDATE corrective_actions SET
         status = 'rejected',
         resolution_note = COALESCE($2, resolution_note)
       WHERE id = $1`,
      [id, data.resolution_note ?? null]
    );
  } else if (next === "in_progress") {
    await execute(
      `UPDATE corrective_actions SET status = 'in_progress' WHERE id = $1`,
      [id]
    );
  } else if (next === "open") {
    await execute(`UPDATE corrective_actions SET status = 'open' WHERE id = $1`, [id]);
  }
}

export async function pendingCapaCount(): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM corrective_actions WHERE status IN ('open','in_progress','submitted')`
  );
  return row?.n ?? 0;
}
