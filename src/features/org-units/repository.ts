import "server-only";
import { queryAll, queryOne, execute } from "@/lib/db";
import type { OrgUnit, OrgUnitOption } from "./types";

/**
 * Walk the tree top-down using a recursive CTE so siblings stay in
 * sort_order and ancestors always come before descendants. Returns a
 * flat array — the caller decides how to render it.
 */
export async function listOrgUnitsAsTree(
  includeInactive = false
): Promise<OrgUnit[]> {
  const filter = includeInactive ? "" : "WHERE is_active = 1";
  // path = one fixed-width 20-digit segment per level: sort_order shifted
  // by 2^31 (so negatives sort correctly) then id, each zero-padded to 10.
  // Comparing these strings orders rows exactly like PG's int[] path did.
  return queryAll<OrgUnit>(
    `WITH tree AS (
       SELECT u.*,
              CAST(RIGHT('0000000000' + CAST(CAST(u.sort_order AS BIGINT) + 2147483648 AS VARCHAR(10)), 10)
                 + RIGHT('0000000000' + CAST(u.id AS VARCHAR(10)), 10) AS VARCHAR(MAX)) AS path
       FROM org_units u
       WHERE u.parent_id IS NULL
       UNION ALL
       SELECT c.*,
              CAST(t.path
                 + RIGHT('0000000000' + CAST(CAST(c.sort_order AS BIGINT) + 2147483648 AS VARCHAR(10)), 10)
                 + RIGHT('0000000000' + CAST(c.id AS VARCHAR(10)), 10) AS VARCHAR(MAX))
       FROM org_units c
       JOIN tree t ON c.parent_id = t.id
     )
     SELECT id, code, name, parent_id, level, sort_order,
            is_active, created_at, updated_at
     FROM tree
     ${filter}
     ORDER BY path`
  );
}

/**
 * Same tree, but each row already has its indented display label baked
 * in. Used by every form that needs a hierarchical dropdown — the form
 * just maps to <option value={id}>{display_label}</option>.
 */
export async function listOrgUnitOptions(): Promise<OrgUnitOption[]> {
  const rows = await listOrgUnitsAsTree(false);
  // 3 em-spaces per level beyond the root (root has no indent). em-space
  // (U+2003) renders consistently inside <option> across browsers — plain
  // spaces collapse to one.
  const pad = (level: number) => "   ".repeat(Math.max(0, level - 1));
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    level: r.level,
    parent_id: r.parent_id,
    display_label: `${pad(r.level)}${r.code}  ${r.name}`,
  }));
}

export async function getOrgUnit(id: number): Promise<OrgUnit | undefined> {
  return queryOne<OrgUnit>(
    `SELECT id, code, name, parent_id, level, sort_order,
            is_active, created_at, updated_at
     FROM org_units WHERE id = $1`,
    [id]
  );
}

export async function createOrgUnit(input: {
  code: string;
  name: string;
  parent_id: number | null;
  sort_order?: number;
}): Promise<number> {
  // Derive level from the parent so callers can't get it wrong.
  let level = 1;
  if (input.parent_id) {
    const parent = await getOrgUnit(input.parent_id);
    if (!parent) throw new Error("Parent org_unit not found.");
    level = parent.level + 1;
  }
  // If no sort_order provided, put it last among its siblings.
  let sortOrder = input.sort_order ?? 0;
  if (input.sort_order == null) {
    const row = await queryOne<{ next_order: number }>(
      input.parent_id == null
        ? `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
           FROM org_units WHERE parent_id IS NULL`
        : `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
           FROM org_units WHERE parent_id = $1`,
      input.parent_id == null ? [] : [input.parent_id]
    );
    sortOrder = row?.next_order ?? 1;
  }
  const row = await queryOne<{ id: number }>(
    `INSERT INTO org_units (code, name, parent_id, level, sort_order)
     OUTPUT INSERTED.id
     VALUES ($1, $2, $3, $4, $5)`,
    [input.code, input.name, input.parent_id, level, sortOrder]
  );
  return row!.id;
}

export async function updateOrgUnit(
  id: number,
  input: { name?: string; sort_order?: number; is_active?: boolean }
): Promise<void> {
  await execute(
    `UPDATE org_units SET
       name       = COALESCE($2, name),
       sort_order = COALESCE(CAST($3 AS INT), sort_order),
       is_active  = COALESCE(CAST($4 AS BIT), is_active)
     WHERE id = $1`,
    [id, input.name ?? null, input.sort_order ?? null, input.is_active ?? null]
  );
}

export async function deleteOrgUnit(id: number): Promise<void> {
  // ON DELETE CASCADE on parent_id handles descendants automatically.
  await execute(`DELETE FROM org_units WHERE id = $1`, [id]);
}
