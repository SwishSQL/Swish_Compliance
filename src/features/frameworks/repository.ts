import "server-only";
import { queryAll, queryOne, execute } from "@/lib/db";
import type { Framework } from "./types";

const FW_SELECT = `
  f.id, f.code, f.name, f.description, f.category, f.is_active,
  f.activated_by, u_a.display_name AS activated_by_name, f.activated_at,
  f.owner_user_id, u_o.display_name AS owner_name,
  f.created_at, f.updated_at,
  f.reference_source, f.scope, f.review_frequency,
  f.owner_label, f.audit_frequency,
  (SELECT COUNT(*) FROM controls c WHERE c.framework_id = f.id)                          AS control_count,
  (SELECT COUNT(*) FROM controls c WHERE c.framework_id = f.id AND c.is_active = 1)      AS active_control_count
FROM frameworks f
LEFT JOIN users u_a ON u_a.id = f.activated_by
LEFT JOIN users u_o ON u_o.id = f.owner_user_id
`;

export async function listFrameworks(): Promise<Framework[]> {
  return queryAll<Framework>(`SELECT ${FW_SELECT} ORDER BY f.is_active DESC, f.name`);
}

export async function getFramework(id: number): Promise<Framework | undefined> {
  return queryOne<Framework>(`SELECT ${FW_SELECT} WHERE f.id = $1`, [id]);
}

export async function setFrameworkActive(
  id: number,
  active: boolean,
  userId: number
): Promise<void> {
  if (active) {
    await execute(
      `UPDATE frameworks SET is_active = 1, activated_by = $2, activated_at = SYSUTCDATETIME() WHERE id = $1`,
      [id, userId]
    );
  } else {
    await execute(`UPDATE frameworks SET is_active = 0 WHERE id = $1`, [id]);
  }
}

export async function setFrameworkOwner(id: number, ownerId: number | null): Promise<void> {
  await execute(`UPDATE frameworks SET owner_user_id = $2 WHERE id = $1`, [id, ownerId]);
}

export async function createFramework(input: {
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  domain_id: number | null;
  owner_user_id: number | null;
  owner_label: string | null;
  audit_frequency: string | null;
  is_active: boolean;
  created_by: number;
  /** SOP-first audit scoping (migration 046). Defaults to the parent
   *  domain's SOP/department when the domain has one and these are left
   *  unset — see the ALTER TABLE comment in sql/046. */
  sop_id: number | null;
  department_id: number | null;
}): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO frameworks
       (code, name, description, category, domain_id, owner_user_id,
        owner_label, audit_frequency, is_active, activated_by, activated_at,
        sop_id, department_id)
     OUTPUT INSERTED.id
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             CASE WHEN $9 = 1 THEN $10 ELSE NULL END,
             CASE WHEN $9 = 1 THEN SYSUTCDATETIME() ELSE NULL END,
             $11, $12)`,
    [
      input.code,
      input.name,
      input.description,
      input.category,
      input.domain_id,
      input.owner_user_id,
      input.owner_label,
      input.audit_frequency,
      input.is_active,
      input.created_by,
      input.sop_id,
      input.department_id,
    ]
  );
  return row!.id;
}
