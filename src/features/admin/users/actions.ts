"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin, requirePermission } from "@/lib/auth/guard";
import { ROLES, ROLE_LABELS, isRole } from "@/lib/auth/permissions";
import { execute } from "@/lib/db";
import {
  createUser,
  updateUser,
  resetUserPassword,
  emailExists,
  getUserById,
  getUserRoles,
  setUserRoles,
  reassignOutstandingWork,
} from "./repository";
import { notify } from "@/features/notifications/service";

// The role catalog lives in src/lib/auth/permissions.ts (docs/RBAC.md).
const VALID_ROLES = ROLES;

/** Extra roles ticked on the form (any valid role), primary role first. */
function selectedRoles(formData: FormData, primary: string): string[] {
  const extra = formData
    .getAll("extra_roles")
    .map(String)
    .filter((r) => isRole(r));
  return Array.from(new Set([primary, ...extra]));
}

const label = (r: string) => (isRole(r) ? ROLE_LABELS[r] : r);

const CreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  display_name: z.string().trim().min(1, "Name is required"),
  role: z.enum(VALID_ROLES),
});

const UpdateSchema = z.object({
  id: z.coerce.number().int().positive(),
  display_name: z.string().trim().min(1),
  role: z.enum(VALID_ROLES),
  is_active: z.boolean(),
});

const ResetPasswordSchema = z.object({
  id: z.coerce.number().int().positive(),
  new_password: z.string().min(6),
});

/** Pull all values for a repeated form field name (e.g. brand_ids). */
function getAllNumeric(formData: FormData, name: string): number[] {
  const out: number[] = [];
  for (const v of formData.getAll(name)) {
    if (typeof v === "string" && v !== "") {
      const n = Number(v);
      if (Number.isInteger(n) && n > 0) out.push(n);
    }
  }
  return Array.from(new Set(out));
}

export async function createUserAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = CreateSchema.parse({
    email: formData.get("email"),
    password: formData.get("password"),
    display_name: formData.get("display_name"),
    role: formData.get("role"),
  });

  if (await emailExists(parsed.email)) {
    throw new Error(`Email "${parsed.email}" is already taken.`);
  }

  const brand_ids = getAllNumeric(formData, "brand_ids");
  const department_ids = getAllNumeric(formData, "department_ids");
  const domain_ids = getAllNumeric(formData, "domain_ids");
  const roles = selectedRoles(formData, parsed.role);

  const newId = await createUser({ ...parsed, brand_ids, department_ids, domain_ids });
  await setUserRoles(newId, roles);

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'create', 'user', $3, $4)`,
    [
      admin.id,
      admin.email,
      newId,
      JSON.stringify({
        email: parsed.email,
        role: parsed.role,
        roles,
        brand_ids,
        department_ids,
        domain_ids,
      }),
    ]
  );

  // Welcome the new user with a notification on their account.
  await notify({
    audience: { userIds: [newId] },
    actor: { id: admin.id, name: admin.displayName, role: admin.role },
    kind: "user:created",
    title: `Welcome to Swish Compliance, ${parsed.display_name}!`,
    body: `Your account was created by ${admin.displayName} with the role(s): ${roles.map(label).join(", ")}. Change your password from your profile after first login.`,
    severity: "info",
  });

  revalidatePath("/admin/config");
  redirect(`/admin/users/${newId}`);
}

export async function updateUserAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = UpdateSchema.parse({
    id: formData.get("id"),
    display_name: formData.get("display_name"),
    role: formData.get("role"),
    is_active: formData.get("is_active") === "on" || formData.get("is_active") === "true",
  });

  const before = await getUserById(parsed.id);
  if (!before) throw new Error("User not found.");
  const beforeRoles = await getUserRoles(parsed.id);
  const roles = selectedRoles(formData, parsed.role);

  // Safety: an admin can't remove their own admin role or deactivate themselves.
  if (before.id === admin.id && (!roles.includes("admin") || !parsed.is_active)) {
    throw new Error("You can't remove your own admin role or deactivate your own account.");
  }

  // A scope list is only replaced when the form actually carried its
  // picker (marker field) — otherwise saving would wipe it.
  const has = (name: string) => formData.has(`${name}__present`);
  const brand_ids = has("brand_ids") ? getAllNumeric(formData, "brand_ids") : undefined;
  const department_ids = has("department_ids") ? getAllNumeric(formData, "department_ids") : undefined;
  const domain_ids = has("domain_ids") ? getAllNumeric(formData, "domain_ids") : undefined;

  await updateUser({ ...parsed, brand_ids, department_ids, domain_ids });
  await setUserRoles(parsed.id, roles);

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'update', 'user', $3, $4)`,
    [
      admin.id,
      admin.email,
      parsed.id,
      JSON.stringify({
        before: {
          role: before.role,
          roles: beforeRoles,
          is_active: before.is_active,
          brand_ids: before.brand_ids,
          department_ids: before.department_ids,
          domain_ids: before.domain_ids,
        },
        after: {
          role: parsed.role,
          roles,
          is_active: parsed.is_active,
          brand_ids: brand_ids ?? before.brand_ids,
          department_ids: department_ids ?? before.department_ids,
          domain_ids: domain_ids ?? before.domain_ids,
        },
      }),
    ]
  );

  // If the roles changed, notify the affected user.
  const sameRoles =
    beforeRoles.length === roles.length && roles.every((r) => beforeRoles.includes(r));
  if (!sameRoles || before.role !== parsed.role) {
    await notify({
      audience: { userIds: [parsed.id] },
      actor: { id: admin.id, name: admin.displayName, role: admin.role },
      kind: "user:role_changed",
      title: `Your roles have changed`,
      body: `${admin.displayName} set your role(s) to: ${roles.map(label).join(", ")}.`,
      severity: "info",
    });
  }

  revalidatePath("/admin/config");
  revalidatePath(`/admin/users/${parsed.id}`);
}

export async function resetPasswordAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = ResetPasswordSchema.parse(Object.fromEntries(formData.entries()));

  await resetUserPassword(parsed.id, parsed.new_password);

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id)
     VALUES ($1, $2, 'reset_password', 'user', $3)`,
    [admin.id, admin.email, parsed.id]
  );

  revalidatePath(`/admin/users/${parsed.id}`);
}

/**
 * Move a user's open work (CAPAs, audits being performed, test ownership,
 * SOPs in the workflow) to another active user — typically before
 * deactivating them. Audit-logged.
 */
export async function reassignWorkAction(formData: FormData) {
  const admin = await requirePermission("admin.reassign");
  const fromId = Number(formData.get("from_user_id"));
  const toId = Number(formData.get("to_user_id"));
  if (!Number.isInteger(fromId) || fromId <= 0 || !Number.isInteger(toId) || toId <= 0) {
    throw new Error("Pick the user to hand the work to.");
  }
  if (fromId === toId) throw new Error("Pick a different user.");
  const target = await getUserById(toId);
  if (!target || !target.is_active) throw new Error("The receiving user must be active.");

  const moved = await reassignOutstandingWork(fromId, toId);
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'user:work_reassigned', 'user', $3, $4)`,
    [admin.id, admin.email, fromId, JSON.stringify({ to_user_id: toId, moved, by_user_name: admin.displayName })]
  );
  await notify({
    audience: { userIds: [toId] },
    actor: { id: admin.id, name: admin.displayName, role: admin.role },
    kind: "user:work_reassigned",
    title: `Work was reassigned to you`,
    body: `${admin.displayName} handed you ${moved.capas} CAPA(s), ${moved.audits} audit(s), ${moved.tests} test(s) and ${moved.sops} SOP(s).`,
    severity: "info",
  });
  revalidatePath(`/admin/users/${fromId}`);
  revalidatePath("/admin/config");
}
