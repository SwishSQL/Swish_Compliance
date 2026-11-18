import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession, type SessionUser } from "@/lib/auth/session";
import { queryAll, queryOne } from "@/lib/db";
import {
  ROLES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  effectivePermissions,
  can,
  hasRole,
  type Permission,
  type PermissionOverride,
} from "@/lib/auth/permissions";

/**
 * The signed-in user, re-read from the database on every request (once per
 * request, via React cache). The JWT only proves identity: roles, active
 * flag and permissions always come from the DB, so a role change or a
 * deactivation takes effect immediately instead of when the 8 h token
 * expires.
 */
export type AuthUser = SessionUser & {
  /** Every role the user holds (user_roles), primary role included. */
  roles: string[];
  /** Effective permissions: union of the roles' defaults + admin overrides. */
  permissions: ReadonlySet<Permission>;
};

const loadAuthUser = cache(async (id: number): Promise<AuthUser | null> => {
  const row = await queryOne<{
    id: number;
    email: string;
    display_name: string;
    role: string;
    brand_id: number | null;
    department_id: number | null;
    is_active: boolean;
  }>(
    `SELECT id, email, display_name, role, brand_id, department_id, is_active
     FROM users WHERE id = $1`,
    [id]
  );
  if (!row || !row.is_active) return null;
  const [roleRows, overrides] = await Promise.all([
    queryAll<{ role: string }>(`SELECT role FROM user_roles WHERE user_id = $1`, [id]),
    loadPermissionOverrides(),
  ]);
  const roles = Array.from(new Set([row.role, ...roleRows.map((r) => r.role)])).filter(Boolean);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    brandId: row.brand_id,
    departmentId: row.department_id,
    roles,
    permissions: effectivePermissions(roles, overrides),
  };
});

/** Admin overrides of the default matrix (role_permissions, migration 007). */
export const loadPermissionOverrides = cache(async (): Promise<PermissionOverride[]> => {
  return queryAll<PermissionOverride>(
    `SELECT role, permission, allowed FROM role_permissions`
  );
});

/** For route handlers: the signed-in, active user, or null (no redirect). */
export async function getAuthUser(): Promise<AuthUser | null> {
  const session = await getSession();
  return session ? loadAuthUser(session.id) : null;
}

/** Use in server components / actions to require an authenticated user. */
export async function requireUser(): Promise<AuthUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await loadAuthUser(session.id);
  if (!user) redirect("/login");
  return user;
}

/** Require one of a set of roles, otherwise redirect to /my-work. */
export async function requireRole(roles: string[]): Promise<AuthUser> {
  const user = await requireUser();
  if (!hasRole(user, ...roles)) redirect("/my-work");
  return user;
}

/** Require a permission, otherwise redirect to /my-work. */
export async function requirePermission(permission: Permission): Promise<AuthUser> {
  const user = await requireUser();
  if (!can(user, permission)) redirect("/my-work");
  return user;
}

/** Throwing variant for server actions. */
export function assertPermission(user: AuthUser, permission: Permission, message?: string): void {
  if (!can(user, permission)) throw new Error(message ?? "Not authorized.");
}

/** Require the user-management permission (System Admin). */
export async function requireAdmin(): Promise<AuthUser> {
  return requirePermission("admin.users");
}

export { can, hasRole };
export type { Permission };

// ---------------------------------------------------------------------------
// Legacy helper names, now backed by permissions (docs/RBAC.md).
// They take the AuthUser (anything with a permission set).
// ---------------------------------------------------------------------------
type P = { permissions: ReadonlySet<string> };

/** Who can create a new SOP (any department, or their own). */
export function canCreateSops(user: P): boolean {
  return user.permissions.has("sop.create_any") || user.permissions.has("sop.create_own_dept");
}

/** GRC library edit: domains, frameworks, controls, tests, checklists, links. */
export function canEditSops(user: P): boolean {
  return user.permissions.has("grc.edit");
}

/** Whether the user can open /admin/*. */
export function canAccessAdmin(user: P): boolean {
  return (
    user.permissions.has("admin.users") ||
    user.permissions.has("admin.settings") ||
    user.permissions.has("admin.audit_logs") ||
    user.permissions.has("admin.permissions")
  );
}

/** Delete / archive of governed records. */
export function canDeleteOrArchive(user: P): boolean {
  return user.permissions.has("grc.delete");
}

/** All roles, for the user admin screens. */
export const USER_ROLES = ROLES.map((value) => ({
  value,
  label: ROLE_LABELS[value],
  desc: ROLE_DESCRIPTIONS[value],
}));
