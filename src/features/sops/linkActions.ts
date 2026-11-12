"use server";

import { revalidatePath } from "next/cache";
import { requireUser, canEditSops } from "@/lib/auth/guard";
import { execute } from "@/lib/db";

/**
 * Link / unlink a domain or framework to a SOP (domains.sop_id,
 * frameworks.sop_id — the same link the New Domain / New Framework forms
 * set). This is not SOP content, so it is allowed on an approved SOP too.
 * Linking only takes a record that has no SOP yet, so it can never silently
 * move one away from another SOP.
 */
const TABLE = { domain: "domains", framework: "frameworks" } as const;
type Kind = keyof typeof TABLE;

async function setLink(formData: FormData, kind: Kind, link: boolean) {
  const user = await requireUser();
  if (!canEditSops(user.role)) throw new Error("Not authorized.");
  const sopId = Number(formData.get("sop_id"));
  const targetId = Number(formData.get("target_id"));
  if (!Number.isInteger(sopId) || sopId <= 0) throw new Error("Invalid SOP.");
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new Error(`Choose a ${kind} first.`);
  }

  const changed = link
    ? await execute(
        `UPDATE ${TABLE[kind]} SET sop_id = $1
         WHERE id = $2 AND sop_id IS NULL AND EXISTS (SELECT 1 FROM sops WHERE id = $1)`,
        [sopId, targetId]
      )
    : await execute(
        `UPDATE ${TABLE[kind]} SET sop_id = NULL WHERE id = $2 AND sop_id = $1`,
        [sopId, targetId]
      );
  if (!changed) {
    throw new Error(
      link
        ? `That ${kind} is already linked to a SOP.`
        : `That ${kind} is not linked to this SOP.`
    );
  }

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, $3, 'sop', $4, $5)`,
    [
      user.id,
      user.email,
      `sop:${kind}_${link ? "linked" : "unlinked"}`,
      sopId,
      JSON.stringify({ [`${kind}_id`]: targetId, user_name: user.displayName, user_role: user.role }),
    ]
  );
  revalidatePath(`/sops/${sopId}`);
  revalidatePath(`/${TABLE[kind]}`);
}

export async function linkDomainToSopAction(formData: FormData) {
  await setLink(formData, "domain", true);
}
export async function unlinkDomainFromSopAction(formData: FormData) {
  await setLink(formData, "domain", false);
}
export async function linkFrameworkToSopAction(formData: FormData) {
  await setLink(formData, "framework", true);
}
export async function unlinkFrameworkFromSopAction(formData: FormData) {
  await setLink(formData, "framework", false);
}
