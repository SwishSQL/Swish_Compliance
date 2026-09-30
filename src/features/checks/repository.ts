import "server-only";
import { queryAll, queryOne, execute } from "@/lib/db";
import type {
  Check,
  CheckResult,
  CheckStatus,
  CheckFrequency,
  LinkedChecklistItem,
} from "./types";

const CHECK_SELECT = `
  ch.id, ch.code, ch.name, ch.description,
  ch.control_id, c.name AS control_name,
  ch.owner_user_id, u.display_name AS owner_name,
  ch.frequency, ch.is_active, ch.last_status, ch.last_result_at, ch.next_due_date,
  ch.checklist_template_id, t.name AS checklist_template_name,
  ch.created_at, ch.updated_at,
  ch.procedure_steps, ch.evidence_needed, ch.method,
  ch.performer_role, ch.reviewer_role,
  ch.pass_criteria, ch.fail_criteria, ch.frequency_label, ch.evidence_code,
  (SELECT COUNT(*) FROM check_results r WHERE r.check_id = ch.id) AS result_count
FROM checks ch
LEFT JOIN controls            c ON c.id = ch.control_id
LEFT JOIN users               u ON u.id = ch.owner_user_id
LEFT JOIN checklist_templates t ON t.id = ch.checklist_template_id
`;

export async function listChecks(filters: {
  status?: CheckStatus;
  checklistTemplateId?: number;
} = {}): Promise<Check[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`ch.last_status = $${params.length}`);
  }
  if (filters.checklistTemplateId) {
    params.push(filters.checklistTemplateId);
    conditions.push(`ch.checklist_template_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return queryAll<Check>(
    `SELECT ${CHECK_SELECT}
     ${where}
     ORDER BY
       CASE ch.last_status WHEN 'failing' THEN 0 WHEN 'pending_review' THEN 1 WHEN 'accepted_risk' THEN 2 WHEN 'passing' THEN 3 ELSE 4 END,
       CASE WHEN ch.next_due_date IS NULL THEN 1 ELSE 0 END, ch.next_due_date, ch.name`,
    params
  );
}

export async function getCheck(id: number): Promise<Check | undefined> {
  return queryOne<Check>(`SELECT ${CHECK_SELECT} WHERE ch.id = $1`, [id]);
}

/**
 * All checklist items linked to a test via the check_checklist_items
 * junction. Items come back grouped by template, ordered by section then
 * sort_order, so the page can render them as one continuous list.
 */
export async function listLinkedChecklistItems(
  checkId: number
): Promise<LinkedChecklistItem[]> {
  return queryAll<LinkedChecklistItem>(
    `SELECT
       ci.id           AS item_id,
       ci.code         AS item_code,
       ci.sort_order   AS item_no,
       ci.section      AS section,
       ci.question     AS question,
       ci.weight       AS weight,
       ci.is_critical  AS is_critical,
       t.id            AS template_id,
       t.code          AS template_code,
       t.name          AS template_name
     FROM check_checklist_items cci
     JOIN checklist_items     ci ON ci.id = cci.checklist_item_id
     JOIN checklist_templates t  ON t.id  = ci.template_id
     WHERE cci.check_id = $1
     ORDER BY t.name, CASE WHEN ci.section IS NULL THEN 1 ELSE 0 END, ci.section, ci.sort_order, ci.id`,
    [checkId]
  );
}

export async function listCheckResults(checkId: number, limit = 25): Promise<CheckResult[]> {
  return queryAll<CheckResult>(
    `SELECT TOP ($2) r.id, r.check_id, r.status, r.notes,
            r.evidence_url, r.evidence_name, r.evidence_mime,
            r.performed_by, u.display_name AS performed_by_name,
            r.checklist_template_id, t.name AS checklist_template_name,
            r.created_at
     FROM check_results r
     LEFT JOIN users               u ON u.id = r.performed_by
     LEFT JOIN checklist_templates t ON t.id = r.checklist_template_id
     WHERE r.check_id = $1
     ORDER BY r.created_at DESC`,
    [checkId, limit]
  );
}

export async function createCheck(input: {
  code?: string | null;
  name: string;
  description?: string | null;
  control_id?: number | null;
  owner_user_id?: number | null;
  frequency: CheckFrequency;
  checklist_template_id?: number | null;
}): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO checks
       (code, name, description, control_id, owner_user_id, frequency, checklist_template_id)
     OUTPUT INSERTED.id
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.code ?? null,
      input.name,
      input.description ?? null,
      input.control_id ?? null,
      input.owner_user_id ?? null,
      input.frequency,
      input.checklist_template_id ?? null,
    ]
  );
  return row!.id;
}

function nextDueFor(frequency: CheckFrequency): string | null {
  const now = new Date();
  const days: Record<CheckFrequency, number | null> = {
    daily: 1, weekly: 7, monthly: 30, quarterly: 90, annual: 365, on_demand: null,
  };
  const d = days[frequency];
  if (d == null) return null;
  const next = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
  return next.toISOString().split("T")[0];
}

export async function recordResult(input: {
  check_id: number;
  status: CheckStatus;
  notes: string;
  evidence_url?: string | null;
  evidence_name?: string | null;
  evidence_mime?: string | null;
  performed_by: number;
  checklist_template_id?: number | null;
}): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO check_results
       (check_id, status, notes, evidence_url, evidence_name, evidence_mime, performed_by, checklist_template_id)
     OUTPUT INSERTED.id
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.check_id,
      input.status,
      input.notes,
      input.evidence_url ?? null,
      input.evidence_name ?? null,
      input.evidence_mime ?? null,
      input.performed_by,
      input.checklist_template_id ?? null,
    ]
  );

  // Update cached fields on the check itself
  const check = await getCheck(input.check_id);
  const next = check ? nextDueFor(check.frequency) : null;
  await execute(
    `UPDATE checks SET last_status = $2, last_result_at = SYSUTCDATETIME(), next_due_date = $3 WHERE id = $1`,
    [input.check_id, input.status, next]
  );

  return row!.id;
}
