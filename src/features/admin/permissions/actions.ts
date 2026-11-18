"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { execute, queryAll, withTransaction } from "@/lib/db";
import {
  ROLES,
  PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  type PermissionOverride,
} from "@/lib/auth/permissions";

/**
 * Save the role × permission matrix. Only cells that differ from the
 * default matrix are stored (role_permissions), so the defaults in
 * permissions.ts stay the source of truth. Audit-logged with the diff.
 */
export async function savePermissionsAction(formData: FormData) {
  const admin = await requirePermission("admin.permissions");

  const overrides: PermissionOverride[] = [];
  for (const role of ROLES) {
    for (const perm of PERMISSION_KEYS) {
      const checked = formData.has(`${role}:${perm}`);
      const byDefault = DEFAULT_ROLE_PERMISSIONS[role].includes(perm);
      if (checked !== byDefault) overrides.push({ role, permission: perm, allowed: checked });
    }
  }
  // Never lock everyone out of this screen.
  if (overrides.some((o) => o.role === "admin" && o.permission === "admin.permissions" && !o.allowed)) {
    throw new Error("The System Admin role must keep the permission to manage permissions.");
  }

  const before = await queryAll<PermissionOverride>(
    `SELECT role, permission, allowed FROM role_permissions ORDER BY role, permission`
  );
  await withTransaction(async (tx) => {
    await tx.query(`DELETE FROM role_permissions`);
    for (const o of overrides) {
      await tx.query(
        `INSERT INTO role_permissions (role, permission, allowed, updated_by) VALUES ($1, $2, $3, $4)`,
        [o.role, o.permission, o.allowed ? 1 : 0, admin.id]
      );
    }
  });
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'permissions:updated', 'role_permissions', NULL, $3)`,
    [admin.id, admin.email, JSON.stringify({ before, after: overrides, by_user_name: admin.displayName })]
  );
  revalidatePath("/admin/permissions");
  redirect("/admin/permissions?saved=1");
}
