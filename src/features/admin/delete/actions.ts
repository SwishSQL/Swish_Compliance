"use server";

import { requireUser, canDeleteOrArchive } from "@/lib/auth/guard";
import {
  getDeleteImpact,
  deleteEntityWithBackup,
  ENTITY_LIST_PATH,
  type EntityType,
  type DeleteImpact,
} from "@/lib/admin/deleteEntity";

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
  if (!canDeleteOrArchive(user)) {
    return { allowed: false, exists: false, title: "", rows: [], blockedReason: null };
  }
  const impact = await getDeleteImpact(type, id);
  return { allowed: true, ...impact };
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
  if (!canDeleteOrArchive(user)) {
    return { ok: false, error: "Only admin or compliance can delete this." };
  }
  try {
    await deleteEntityWithBackup(type, id, { id: user.id, email: user.email });
    return { ok: true, redirectTo: ENTITY_LIST_PATH[type] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}
