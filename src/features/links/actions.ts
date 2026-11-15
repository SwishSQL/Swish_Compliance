"use server";

import { revalidatePath } from "next/cache";
import { requireUser, canEditSops } from "@/lib/auth/guard";
import { execute } from "@/lib/db";
import { recomputeControlHealth } from "../controls/repository";

/**
 * Hierarchy links used by audit scoping:
 *   framework ← controls.framework_id
 *   control   ← checks.control_id
 *   test      ← check_checklist_items (every item of the checklist)
 * These write the same columns the audit scope walk reads, so a link made
 * here immediately makes the item auditable.
 */

function ids(formData: FormData, ...keys: string[]): number[] {
  return keys.map((k) => {
    const n = Number(formData.get(k));
    if (!Number.isInteger(n) || n <= 0) throw new Error("Pick an item to link.");
    return n;
  });
}

async function requireEditor() {
  const user = await requireUser();
  if (!canEditSops(user.role)) throw new Error("Not authorized.");
  return user;
}

export async function linkControlToFrameworkAction(formData: FormData) {
  await requireEditor();
  const [frameworkId, controlId] = ids(formData, "framework_id", "control_id");
  await execute(
    `UPDATE controls SET framework_id = $1, updated_at = SYSUTCDATETIME() WHERE id = $2`,
    [frameworkId, controlId]
  );
  revalidatePath(`/frameworks/${frameworkId}`);
  revalidatePath(`/controls/${controlId}`);
  revalidatePath("/controls");
  // Also used from the domain page (control → one of the domain's frameworks).
  const domainId = Number(formData.get("domain_id"));
  if (Number.isInteger(domainId) && domainId > 0) revalidatePath(`/domains/${domainId}`);
}

export async function linkFrameworkToDomainAction(formData: FormData) {
  await requireEditor();
  const [domainId, frameworkId] = ids(formData, "domain_id", "framework_id");
  await execute(
    `UPDATE frameworks SET domain_id = $1, updated_at = SYSUTCDATETIME() WHERE id = $2`,
    [domainId, frameworkId]
  );
  revalidatePath(`/domains/${domainId}`);
  revalidatePath(`/frameworks/${frameworkId}`);
  revalidatePath("/domains");
  revalidatePath("/frameworks");
}

export async function linkTestToControlAction(formData: FormData) {
  await requireEditor();
  const [controlId, checkId] = ids(formData, "control_id", "check_id");
  await execute(
    `UPDATE checks SET control_id = $1, updated_at = SYSUTCDATETIME() WHERE id = $2`,
    [controlId, checkId]
  );
  await recomputeControlHealth(controlId);
  revalidatePath(`/controls/${controlId}`);
  revalidatePath(`/tests/${checkId}`);
  revalidatePath("/tests");
}

export async function linkChecklistToTestAction(formData: FormData) {
  await requireEditor();
  const [checkId, templateId] = ids(formData, "check_id", "template_id");
  await execute(
    `INSERT INTO check_checklist_items (check_id, checklist_item_id)
     SELECT $1, i.id FROM checklist_items i
     WHERE i.template_id = $2
       AND NOT EXISTS (SELECT 1 FROM check_checklist_items x
                       WHERE x.check_id = $1 AND x.checklist_item_id = i.id)`,
    [checkId, templateId]
  );
  // Make it the test's default checklist if it doesn't have one yet.
  await execute(
    `UPDATE checks SET checklist_template_id = $2
     WHERE id = $1 AND checklist_template_id IS NULL`,
    [checkId, templateId]
  );
  revalidatePath(`/tests/${checkId}`);
}
