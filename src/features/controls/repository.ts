import "server-only";
import { queryAll, queryOne, execute } from "@/lib/db";
import {
  AUDIT_RESPONSE_ANSWERED_SQL,
  AUDIT_RESPONSE_SHORTFALL_SQL,
} from "@/features/audits/types";
import { ratesFromSums, type Control, type ControlHealth, type ControlRates } from "./types";

const CTRL_SELECT = `
  c.id, c.code, c.name, c.description, c.framework_id, f.name AS framework_name, f.code AS framework_code,
  c.category, c.owner_user_id, u.display_name AS owner_name,
  c.is_active, c.health_status, c.health_updated_at, c.created_at, c.updated_at,
  c.requirement, c.clause_reference, c.evidence_required, c.reviewer_prompt,
  c.risk_weight, c.control_type, c.frequency,
  (SELECT COUNT(*) FROM control_links cl WHERE cl.control_id = c.id AND cl.entity_type = 'sop')   AS linked_sops,
  (SELECT COUNT(*) FROM checks ch WHERE ch.control_id = c.id)                                     AS linked_checks,
  (SELECT COUNT(*) FROM corrective_actions ca
    JOIN control_links cl ON cl.entity_type = 'capa' AND cl.entity_id = ca.id
    WHERE cl.control_id = c.id AND ca.status IN ('open','in_progress','submitted'))                     AS open_capas
FROM controls c
LEFT JOIN frameworks f ON f.id = c.framework_id
LEFT JOIN users      u ON u.id = c.owner_user_id
`;

export async function listControls(filters: {
  search?: string;
  framework_id?: number;
  health?: ControlHealth;
} = {}): Promise<Control[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(c.name LIKE $${params.length} OR c.code LIKE $${params.length})`);
  }
  if (filters.framework_id) {
    params.push(filters.framework_id);
    conditions.push(`c.framework_id = $${params.length}`);
  }
  if (filters.health) {
    params.push(filters.health);
    conditions.push(`c.health_status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return queryAll<Control>(
    `SELECT ${CTRL_SELECT} ${where}
     ORDER BY CASE c.health_status
                WHEN 'failing' THEN 0
                WHEN 'at_risk' THEN 1
                WHEN 'unknown' THEN 2
                ELSE 3
              END,
              c.name`,
    params
  );
}

export async function getControl(id: number): Promise<Control | undefined> {
  return queryOne<Control>(`SELECT ${CTRL_SELECT} WHERE c.id = $1`, [id]);
}

export async function createControl(input: {
  code?: string | null;
  name: string;
  description?: string | null;
  framework_id?: number | null;
  category?: string | null;
  owner_user_id?: number | null;
  created_by: number;
}): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO controls (code, name, description, framework_id, category, owner_user_id, health_status)
     OUTPUT INSERTED.id
     VALUES ($1, $2, $3, $4, $5, $6, 'unknown')`,
    [
      input.code ?? null,
      input.name,
      input.description ?? null,
      input.framework_id ?? null,
      input.category ?? null,
      input.owner_user_id ?? input.created_by,
    ]
  );
  return row!.id;
}

export async function linkControl(input: {
  control_id: number;
  entity_type: "sop" | "document" | "audit" | "check" | "capa";
  entity_id: number;
  created_by: number;
}): Promise<void> {
  await execute(
    `IF NOT EXISTS (SELECT 1 FROM control_links WHERE control_id = $1 AND entity_type = $2 AND entity_id = $3)
       INSERT INTO control_links (control_id, entity_type, entity_id, created_by)
       VALUES ($1, $2, $3, $4)`,
    [input.control_id, input.entity_type, input.entity_id, input.created_by]
  );
}

export async function unlinkControl(linkId: number): Promise<void> {
  await execute(`DELETE FROM control_links WHERE id = $1`, [linkId]);
}

export async function listControlLinks(controlId: number): Promise<{
  id: number;
  entity_type: string;
  entity_id: number;
  label: string | null;
  status: string | null;
}[]> {
  return queryAll(
    `SELECT cl.id, cl.entity_type, cl.entity_id,
       CASE cl.entity_type
         WHEN 'sop'    THEN (SELECT title FROM sops WHERE id = cl.entity_id)
         WHEN 'check'  THEN (SELECT name  FROM checks WHERE id = cl.entity_id)
         WHEN 'capa'   THEN (SELECT title FROM corrective_actions WHERE id = cl.entity_id)
         WHEN 'audit'  THEN (SELECT 'Audit #' + CAST(cl.entity_id AS NVARCHAR(20)))
       END AS label,
       CASE cl.entity_type
         WHEN 'sop'    THEN (SELECT status FROM sops WHERE id = cl.entity_id)
         WHEN 'check'  THEN (SELECT last_status FROM checks WHERE id = cl.entity_id)
         WHEN 'capa'   THEN (SELECT status FROM corrective_actions WHERE id = cl.entity_id)
         WHEN 'audit'  THEN (SELECT status FROM audits WHERE id = cl.entity_id)
       END AS status
     FROM control_links cl
     WHERE cl.control_id = $1
     ORDER BY cl.entity_type, cl.entity_id`,
    [controlId]
  );
}

/**
 * Audit findings per control, one row per (control, audit, question): every
 * ANSWERED audit question that fell under a test belonging to the control,
 * whether it was a finding (below the pass threshold), and whether its
 * corrective action is still unresolved.
 *
 * A finding reaches its control through the test it was asked under
 * (audit_tests -> check_checklist_items -> checks.control_id) — NOT through
 * audits.control_id, which is empty for a Full SOP audit. "Unresolved" means
 * the CAPA is not yet verified/closed (a rejected fix is still unresolved).
 */
const AUDIT_FINDINGS_BY_CONTROL_CTE = `
  audit_findings AS (
    SELECT DISTINCT ch.control_id, a.id AS audit_id, r.item_id,
           CASE WHEN ${AUDIT_RESPONSE_SHORTFALL_SQL} THEN 1 ELSE 0 END AS is_finding,
           CASE WHEN ca.id IS NULL OR ca.status NOT IN ('verified','closed')
                THEN 1 ELSE 0 END AS unresolved
    FROM audit_responses r
    JOIN audits a ON a.id = r.audit_id AND a.status IN ('submitted','closed')
    JOIN audit_tests at ON at.audit_id = a.id
    JOIN check_checklist_items cci
      ON cci.check_id = at.check_id AND cci.checklist_item_id = r.item_id
    JOIN checks ch ON ch.id = at.check_id AND ch.control_id IS NOT NULL
    LEFT JOIN corrective_actions ca
      ON ca.source_audit_id = a.id AND ca.source_item_id = r.item_id
    WHERE ${AUDIT_RESPONSE_ANSWERED_SQL}
  )`;

/**
 * SQL expression: how many audit findings under the control referenced by
 * `controlRef` (e.g. "c.id") still have an unresolved CAPA. Same mapping as
 * the health calculation, for pages that list the open work next to a control.
 */
export function openAuditFindingsSql(controlRef: string): string {
  return `(SELECT COUNT(*) FROM (
      SELECT DISTINCT a.id AS audit_id, r.item_id
      FROM audit_responses r
      JOIN audits a ON a.id = r.audit_id AND a.status IN ('submitted','closed')
      JOIN audit_tests at ON at.audit_id = a.id
      JOIN check_checklist_items cci
        ON cci.check_id = at.check_id AND cci.checklist_item_id = r.item_id
      JOIN checks ch ON ch.id = at.check_id AND ch.control_id = ${controlRef}
      LEFT JOIN corrective_actions ca
        ON ca.source_audit_id = a.id AND ca.source_item_id = r.item_id
      WHERE ${AUDIT_RESPONSE_SHORTFALL_SQL}
        AND (ca.id IS NULL OR ca.status NOT IN ('verified','closed'))
    ) open_findings)`;
}

/**
 * Recompute control health (all controls, or just one) and store it.
 *
 * A control is:
 *   - 'failing'  when a test of it is failing, OR a critical linked CAPA is
 *                open, OR an audit finding on it still has an unresolved CAPA
 *   - 'at_risk'  when a test awaits review, OR a linked CAPA is open
 *   - 'healthy'  when all its tests pass, OR it was audited (at least one
 *                answered question in a submitted audit) with every finding's
 *                CAPA resolved
 *   - 'unknown'  when nothing has measured it yet
 *
 * Audit CAPAs never get control_links rows, which is why the audit-derived
 * part reads audit_responses directly. Only rows whose status actually
 * changes are written.
 */
async function recomputeHealth(controlId?: number): Promise<number> {
  const params: unknown[] = [];
  let only = "";
  if (controlId !== undefined) {
    params.push(controlId);
    only = `WHERE c.id = $1`;
  }
  return execute(
    `WITH ${AUDIT_FINDINGS_BY_CONTROL_CTE},
     audit_agg AS (
       SELECT control_id,
              COUNT(*)                                                     AS answered,
              SUM(CASE WHEN is_finding = 1 AND unresolved = 1 THEN 1 ELSE 0 END) AS open_findings
       FROM audit_findings
       GROUP BY control_id
     ),
     calc AS (
       SELECT c.id,
         CASE
           WHEN COALESCE(chk.failing, 0) > 0
             OR COALESCE(lc.critical_open, 0) > 0
             OR COALESCE(aa.open_findings, 0) > 0                    THEN 'failing'
           WHEN COALESCE(chk.pending, 0) > 0
             OR COALESCE(lc.open_capas, 0) > 0                       THEN 'at_risk'
           WHEN (COALESCE(chk.total, 0) > 0 AND chk.passing = chk.total)
             OR COALESCE(aa.answered, 0) > 0                         THEN 'healthy'
           ELSE 'unknown'
         END AS next_status
       FROM controls c
       LEFT JOIN (
         SELECT control_id,
                COUNT(*)                                                  AS total,
                SUM(CASE WHEN last_status = 'failing'        THEN 1 ELSE 0 END) AS failing,
                SUM(CASE WHEN last_status = 'passing'        THEN 1 ELSE 0 END) AS passing,
                SUM(CASE WHEN last_status = 'pending_review' THEN 1 ELSE 0 END) AS pending
         FROM checks WHERE is_active = 1 GROUP BY control_id
       ) chk ON chk.control_id = c.id
       LEFT JOIN (
         SELECT cl.control_id,
                COUNT(*)                                                           AS open_capas,
                SUM(CASE WHEN ca.severity = 'critical' THEN 1 ELSE 0 END)           AS critical_open
         FROM control_links cl
         JOIN corrective_actions ca ON cl.entity_type = 'capa' AND cl.entity_id = ca.id
         WHERE ca.status IN ('open','in_progress','submitted')
         GROUP BY cl.control_id
       ) lc ON lc.control_id = c.id
       LEFT JOIN audit_agg aa ON aa.control_id = c.id
       ${only}
     )
     UPDATE c
        SET health_status = calc.next_status, health_updated_at = SYSUTCDATETIME()
       FROM controls c
       JOIN calc ON calc.id = c.id
      WHERE c.health_status <> calc.next_status`,
    params
  );
}

/** Recompute one control's health (see recomputeHealth for the rules). */
export async function recomputeControlHealth(controlId: number): Promise<ControlHealth> {
  await recomputeHealth(controlId);
  const row = await queryOne<{ health_status: ControlHealth }>(
    `SELECT health_status FROM controls WHERE id = $1`,
    [controlId]
  );
  return row?.health_status ?? "unknown";
}

/**
 * Recompute every control's health. Cheap (one set-based statement), so call
 * it after anything that can change audit findings or their CAPAs: submitting
 * an audit, verifying/closing/reopening a CAPA, deleting an audit or CAPA.
 */
export async function recomputeAllControlHealth(): Promise<number> {
  return recomputeHealth();
}

/**
 * Success / Failure / N-A rates per control from the answers of every
 * submitted/closed audit (see ControlRates). A question reaches its control
 * through the test it was asked under, as in the health calculation. Pass a
 * control id for just that one.
 */
export async function listControlRates(
  controlId?: number
): Promise<Map<number, ControlRates>> {
  const params: unknown[] = [];
  let only = "";
  if (controlId !== undefined) {
    params.push(controlId);
    only = `AND ch.control_id = $1`;
  }
  const rows = await queryAll<{
    control_id: number;
    questions: number;
    sum_yes: number;
    sum_no: number;
    sum_na: number;
  }>(
    `SELECT control_id,
            COUNT(*)            AS questions,
            SUM(yes_percent) AS sum_yes,
            SUM(no_percent)  AS sum_no,
            SUM(na_percent)  AS sum_na
     FROM (
       SELECT DISTINCT ch.control_id, a.id AS audit_id, r.item_id,
              r.yes_percent, r.no_percent, r.na_percent
       FROM audit_responses r
       JOIN audits a ON a.id = r.audit_id AND a.status IN ('submitted','closed')
       JOIN audit_tests at ON at.audit_id = a.id
       JOIN check_checklist_items cci
         ON cci.check_id = at.check_id AND cci.checklist_item_id = r.item_id
       JOIN checks ch ON ch.id = at.check_id AND ch.control_id IS NOT NULL
       WHERE r.yes_percent IS NOT NULL ${only}
     ) answers
     GROUP BY control_id`,
    params
  );
  return new Map(
    rows.map((r) => [
      r.control_id,
      ratesFromSums(r.questions, r.sum_yes, r.sum_no, r.sum_na),
    ])
  );
}
