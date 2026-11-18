import "server-only";
import { queryAll } from "@/lib/db";

/**
 * Department managers of the given departments: the department's
 * designated manager (departments.manager_id) plus every active user who
 * holds the department_manager role and is scoped to one of them
 * (user_departments or the legacy users.department_id).
 */
export async function departmentManagerIds(departmentIds: readonly number[]): Promise<number[]> {
  const ids = departmentIds.filter((d) => Number.isInteger(d));
  if (ids.length === 0) return [];
  const rows = await queryAll<{ id: number }>(
    `SELECT d.manager_id AS id FROM departments d
     JOIN users u ON u.id = d.manager_id AND u.is_active = 1
     WHERE d.id = ANY($1::int[]) AND d.manager_id IS NOT NULL
     UNION
     SELECT u.id FROM users u
     WHERE u.is_active = 1
       AND (u.role = 'department_manager'
            OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'department_manager'))
       AND (u.department_id = ANY($1::int[])
            OR EXISTS (SELECT 1 FROM user_departments ud
                       WHERE ud.user_id = u.id AND ud.department_id = ANY($1::int[])))`,
    [ids]
  );
  return rows.map((r) => r.id);
}

/** Departments an SOP applies to (sop_departments + legacy department_id). */
export async function sopDepartmentIds(sopId: number): Promise<number[]> {
  const rows = await queryAll<{ id: number }>(
    `SELECT department_id AS id FROM sop_departments WHERE sop_id = $1
     UNION
     SELECT department_id FROM sops WHERE id = $1 AND department_id IS NOT NULL`,
    [sopId]
  );
  return rows.map((r) => r.id);
}
