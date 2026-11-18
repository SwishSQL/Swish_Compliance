"use server";

import { requireUser, canDeleteOrArchive } from "@/lib/auth/guard";
import {
  getDeleteImpact,
  deleteEntityWithBackup,
  ENTITY_LIST_PATH,
  type EntityType,
  type DeleteImpact,
} from "@/lib/admin/deleteEntity";
import { queryOne } from "@/lib/db";

/**
 * Finalized compliance records are never deleted (docs/RBAC.md §11):
 * approved / archived SOPs (archive instead), finalized audits and
 * closed CAPAs. Returns why, or null.
 */
/** Org structure (brands, departments) is System Admin territory; governed records are Compliance's. */
function mayDelete(user: { permissions: ReadonlySet<string> }, type: EntityType): boolean {
  if (type === "brand" || type === "department") return user.permissions.has("admin.settings");
  return canDeleteOrArchive(user);
}

async function finalizedReason(type: EntityType, id: number): Promise<string | null> {
  const table: Partial<Record<EntityType, [string, string[], string]>> = {
    sop: ["sops", ["approved", "archived"], "An approved or archived SOP is a published record — archive it instead of deleting it."],
    audit: ["audits", ["closed"], "A finalized audit is a locked compliance record and can't be deleted."],
    capa: ["corrective_actions", ["closed", "verified"], "A closed CAPA is a locked compliance record and can't be deleted."],
  };
  const t = table[type];
  if (!t) return null;
  const row = await queryOne<{ status: string }>(`SELECT status FROM ${t[0]} WHERE id = $1`, [id]);
  return row && t[1].includes(row.status) ? t[2] : null;
}

/**
 * Read-only impact preview, called directly from the confirm dialog (not
 * as a <form action>) so it can run as soon as the dialog opens. Gated the
 * same as the delete itself — no point showing a non-admin the shape of
 * data they can't remove anyway.
 */
export async function getDeleteImpactAction(
  type: EntityType,
  id: number
): Promise<DeleteImpact & { allowed: boolean }> {
  const user = await requireUser();
  if (!mayDelete(user, type)) {
    return { allowed: false, exists: false, title: "", rows: [], blockedReason: null };
  }
  const impact = await getDeleteImpact(type, id);
  const finalized = await finalizedReason(type, id);
  return { allowed: true, ...impact, blockedReason: finalized ?? impact.blockedReason };
}

/**
 * The actual delete. Called directly from the confirm dialog's button
 * (not a form submit) so the client can show a "Deleting…" state and
 * navigate itself afterward — redirect() inside a directly-invoked server
 * action still works (it throws the same NEXT_REDIRECT Next.js catches
 * for form actions), but returning the target path lets the client log
 * the outcome first if it wants to.
 */
export async function deleteEntityAction(
  type: EntityType,
  id: number
): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!mayDelete(user, type)) {
    return { ok: false, error: "You are not allowed to delete this." };
  }
  const finalized = await finalizedReason(type, id);
  if (finalized) return { ok: false, error: finalized };
  try {
    await deleteEntityWithBackup(type, id, { id: user.id, email: user.email });
    return { ok: true, redirectTo: ENTITY_LIST_PATH[type] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}
