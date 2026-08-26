import "server-only";
import bcrypt from "bcryptjs";
import { queryAll, queryOne, execute, withTransaction } from "@/lib/db";

export type UserRow = {
  id: number;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  brand_ids: number[];
  brand_names: string[];
  department_ids: number[];
  department_names: string[];
  domain_ids: number[];
  domain_names: string[];
};

// Aggregates the user's brand + department scope from the junction tables.
const USER_SELECT = `
  u.id, u.email, u.display_name, u.role, u.is_active, u.created_at, u.last_login_at,
  COALESCE(
    (SELECT array_agg(b.id ORDER BY b.name)
       FROM user_brands ub JOIN brands b ON b.id = ub.brand_id
       WHERE ub.user_id = u.id),
    ARRAY[]::int[]
  ) AS brand_ids,
  COALESCE(
    (SELECT array_agg(b.name ORDER BY b.name)
       FROM user_brands ub JOIN brands b ON b.id = ub.brand_id
       WHERE ub.user_id = u.id),
    ARRAY[]::text[]
  ) AS brand_names,
  COALESCE(
    (SELECT array_agg(d.id ORDER BY d.name)
       FROM user_departments ud JOIN departments d ON d.id = ud.department_id
       WHERE ud.user_id = u.id),
    ARRAY[]::int[]
  ) AS department_ids,
  COALESCE(
    (SELECT array_agg(d.name ORDER BY d.name)
       FROM user_departments ud JOIN departments d ON d.id = ud.department_id
       WHERE ud.user_id = u.id),
    ARRAY[]::text[]
  ) AS department_names,
  COALESCE(
    (SELECT array_agg(dm.id ORDER BY dm.name)
       FROM user_domains udm JOIN domains dm ON dm.id = udm.domain_id
       WHERE udm.user_id = u.id),
    ARRAY[]::int[]
  ) AS domain_ids,
  COALESCE(
    (SELECT array_agg(dm.name ORDER BY dm.name)
       FROM user_domains udm JOIN domains dm ON dm.id = udm.domain_id
       WHERE udm.user_id = u.id),
    ARRAY[]::text[]
  ) AS domain_names
FROM users u
`;

export async function listUsers(search?: string): Promise<UserRow[]> {
  if (search && search.trim()) {
    return queryAll<UserRow>(
      `SELECT ${USER_SELECT}
       WHERE u.email ILIKE $1 OR u.display_name ILIKE $1
       ORDER BY u.created_at DESC`,
      [`%${search.trim()}%`]
    );
  }
  return queryAll<UserRow>(`SELECT ${USER_SELECT} ORDER BY u.created_at DESC`);
}

export async function getUserById(id: number): Promise<UserRow | undefined> {
  return queryOne<UserRow>(`SELECT ${USER_SELECT} WHERE u.id = $1`, [id]);
}

export type CreateUserInput = {
  email: string;
  password: string;
  display_name: string;
  role: string;
  brand_ids?: number[];
  department_ids?: number[];
  domain_ids?: number[];
};

export async function createUser(input: CreateUserInput): Promise<number> {
  const hash = bcrypt.hashSync(input.password, 10);
  // Set the legacy primary columns to the first brand/department (if any) so
  // any existing code that still reads them keeps working.
  const primaryBrand = input.brand_ids?.[0] ?? null;
  const primaryDept = input.department_ids?.[0] ?? null;

  const row = await queryOne<{ id: number }>(
    `INSERT INTO users (email, password_hash, display_name, role, brand_id, department_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)
     RETURNING id`,
    [
      input.email.toLowerCase(),
      hash,
      input.display_name,
      input.role,
      primaryBrand,
      primaryDept,
    ]
  );
  const newId = row!.id;

  await replaceUserBrands(newId, input.brand_ids ?? []);
  await replaceUserDepartments(newId, input.department_ids ?? []);
  await replaceUserDomains(newId, input.domain_ids ?? []);

  return newId;
}

export type UpdateUserInput = {
  id: number;
  display_name?: string;
  role?: string;
  is_active?: boolean;
  brand_ids?: number[];
  department_ids?: number[];
  domain_ids?: number[];
};

export async function updateUser(input: UpdateUserInput): Promise<void> {
  const primaryBrand = input.brand_ids?.[0] ?? null;
  const primaryDept = input.department_ids?.[0] ?? null;

  await execute(
    `UPDATE users SET
       display_name  = COALESCE($2, display_name),
       role          = COALESCE($3, role),
       brand_id      = $4,
       department_id = $5,
       is_active     = COALESCE($6, is_active)
     WHERE id = $1`,
    [
      input.id,
      input.display_name ?? null,
      input.role ?? null,
      primaryBrand,
      primaryDept,
      input.is_active ?? null,
    ]
  );

  if (input.brand_ids !== undefined) {
    await replaceUserBrands(input.id, input.brand_ids);
  }
  if (input.department_ids !== undefined) {
    await replaceUserDepartments(input.id, input.department_ids);
  }
  if (input.domain_ids !== undefined) {
    await replaceUserDomains(input.id, input.domain_ids);
  }
}

/**
 * Replace a user's rows in one of the user_* junction tables. All three
 * have the same shape — (user_id, <target>_id) — so they share one body.
 *
 * `table` and `column` are interpolated, but they are compile-time literal
 * unions rather than anything caller-supplied, so this stays injection-safe.
 */
async function replaceUserLinks(
  table: "user_brands" | "user_departments" | "user_domains",
  column: "brand_id" | "department_id" | "domain_id",
  userId: number,
  ids: number[]
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
    for (const id of ids) {
      // On Postgres this was ON CONFLICT DO NOTHING. SQL Server has no
      // such clause, and the DELETE above already cleared this user's
      // rows, so the guard only has to cope with a repeated id in `ids`.
      await client.query(
        `INSERT INTO ${table} (user_id, ${column})
         SELECT $1, $2
         WHERE NOT EXISTS (
           SELECT 1 FROM ${table} WHERE user_id = $1 AND ${column} = $2
         )`,
        [userId, id]
      );
    }
  });
}

async function replaceUserBrands(userId: number, brandIds: number[]): Promise<void> {
  await replaceUserLinks("user_brands", "brand_id", userId, brandIds);
}

async function replaceUserDepartments(userId: number, deptIds: number[]): Promise<void> {
  await replaceUserLinks("user_departments", "department_id", userId, deptIds);
}

async function replaceUserDomains(userId: number, domainIds: number[]): Promise<void> {
  await replaceUserLinks("user_domains", "domain_id", userId, domainIds);
}

export async function resetUserPassword(id: number, newPassword: string): Promise<void> {
  const hash = bcrypt.hashSync(newPassword, 10);
  await execute(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, id]);
}

export async function emailExists(email: string): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)) AS exists`,
    [email]
  );
  return !!row?.exists;
}
