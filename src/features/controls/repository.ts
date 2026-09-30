import "server-only";
import { queryAll, queryOne, execute } from "@/lib/db";
import type { Control, ControlHealth } from "./types";

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
 * Recompute a single control's health from linked checks + open CAPAs.
 * Rules:
 *   - any failing check OR any critical open CAPA → 'failing'
 *   - any pending_review check OR any open CAPA → 'at_risk'
 *   - all checks passing (and at least one check exists) → 'healthy'
 *   - otherwise → 'unknown'
 */
export async function recomputeControlHealth(controlId: number): Promise<ControlHealth> {
  const row = await queryOne<{
    failing: number;
    passing: number;
    pending: number;
    total: number;
    critical_open_capas: number;
    open_capas: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN ch.last_status = 'failing'        THEN 1 ELSE 0 END),0) AS failing,
       COALESCE(SUM(CASE WHEN ch.last_status = 'passing'        THEN 1 ELSE 0 END),0) AS passing,
       COALESCE(SUM(CASE WHEN ch.last_status = 'pending_review' THEN 1 ELSE 0 END),0) AS pending,
       COUNT(*)                                                                      AS total,
       (SELECT COUNT(*) FROM corrective_actions ca
        JOIN control_links cl ON cl.entity_type = 'capa' AND cl.entity_id = ca.id
        WHERE cl.control_id = $1 AND ca.severity = 'critical'
          AND ca.status IN ('open','in_progress','submitted'))                                AS critical_open_capas,
       (SELECT COUNT(*) FROM corrective_actions ca
        JOIN control_links cl ON cl.entity_type = 'capa' AND cl.entity_id = ca.id
        WHERE cl.control_id = $1 AND ca.status IN ('open','in_progress','submitted'))         AS open_capas
     FROM checks ch
     WHERE ch.control_id = $1 AND ch.is_active = 1`,
    [controlId]
  );

  let next: ControlHealth = "unknown";
  if (row) {
    if (row.failing > 0 || row.critical_open_capas > 0) next = "failing";
    else if (row.pending > 0 || row.open_capas > 0) next = "at_risk";
    else if (row.total > 0 && row.passing === row.total) next = "healthy";
  }
  await execute(
    `UPDATE controls SET health_status = $2, health_updated_at = SYSUTCDATETIME() WHERE id = $1`,
    [controlId, next]
  );
  return next;
}
