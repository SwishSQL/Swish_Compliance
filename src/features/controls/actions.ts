"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, canEditSops, canDeleteOrArchive } from "@/lib/auth/guard";
import { execute, queryAll } from "@/lib/db";
import {
  createControl,
  linkControl,
  unlinkControl,
  recomputeControlHealth,
} from "./repository";

const CreateSchema = z.object({
  code: z.string().trim().optional().nullable(),
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional().nullable(),
  framework_id: z.coerce.number().int().positive().optional().nullable(),
  category: z.string().trim().optional().nullable(),
  owner_user_id: z.coerce.number().int().positive().optional().nullable(),
});

const LinkSchema = z.object({
  control_id: z.coerce.number().int().positive(),
  entity_type: z.enum(["sop", "document", "audit", "check", "capa"]),
  entity_id: z.coerce.number().int().positive(),
});

function nullEmpty<T extends Record<string, FormDataEntryValue>>(o: T) {
  const out: Record<string, unknown> = { ...o };
  for (const k of Object.keys(out)) if (out[k] === "") out[k] = null;
  return out;
}

const UpdateSchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional().nullable(),
  category: z.string().trim().optional().nullable(),
  control_type: z.string().trim().optional().nullable(),
  frequency: z.string().trim().optional().nullable(),
  risk_weight: z.coerce.number().int().min(1).max(5).optional().nullable(),
  owner_user_id: z.coerce.number().int().positive().optional().nullable(),
  requirement: z.string().trim().optional().nullable(),
  clause_reference: z.string().trim().optional().nullable(),
  evidence_required: z.string().trim().optional().nullable(),
  reviewer_prompt: z.string().trim().optional().nullable(),
});

/**
 * Edit a control's details from its detail page (user request: an Edit
 * button "from inside"). Framework and code are deliberately NOT
 * editable here — they define the control's identity in the GRC tree;
 * moving a control between frameworks is a restructure, not an edit.
 */
export async function updateControlAction(formData: FormData) {
  const user = await requireUser();
  if (!canEditSops(user.role) && user.role !== "compliance") {
    throw new Error("Only admin, Business Excellence, or Compliance can edit controls.");
  }
  const parsed = UpdateSchema.parse(
    nullEmpty(Object.fromEntries(formData.entries()))
  );
  await execute(
    `UPDATE controls SET
       name = $2, description = $3, category = $4, control_type = $5,
       frequency = $6, risk_weight = $7::int, owner_user_id = $8::int,
       requirement = $9, clause_reference = $10, evidence_required = $11,
       reviewer_prompt = $12
     WHERE id = $1::int`,
    [
      parsed.id, parsed.name, parsed.description ?? null,
      parsed.category ?? null, parsed.control_type ?? null,
      parsed.frequency ?? null, parsed.risk_weight ?? null,
      parsed.owner_user_id ?? null,
      parsed.requirement ?? null, parsed.clause_reference ?? null,
      parsed.evidence_required ?? null,
      parsed.reviewer_prompt ?? null,
    ]
  );
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'control:updated', 'control', $3, $4)`,
    [user.id, user.email, parsed.id, JSON.stringify({ name: parsed.name, by_user_name: user.displayName })]
  );
  revalidatePath(`/controls/${parsed.id}`);
  revalidatePath("/controls");
}

export async function createControlAction(formData: FormData) {
  const user = await requireUser();
  if (!canEditSops(user.role)) throw new Error("Not authorized.");
  const parsed = CreateSchema.parse(nullEmpty(Object.fromEntries(formData.entries())));
  const id = await createControl({ ...parsed, created_by: user.id });
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'create', 'control', $3, $4)`,
    [user.id, user.email, id, JSON.stringify({ name: parsed.name })]
  );
  revalidatePath("/controls");
  redirect(`/controls/${id}`);
}

export async function linkControlAction(formData: FormData) {
  const user = await requireUser();
  if (!canEditSops(user.role)) throw new Error("Not authorized.");
  const parsed = LinkSchema.parse(Object.fromEntries(formData.entries()));
  await linkControl({ ...parsed, created_by: user.id });
  await recomputeControlHealth(parsed.control_id);
  revalidatePath(`/controls/${parsed.control_id}`);
  revalidatePath("/controls");
}

export async function unlinkControlAction(formData: FormData) {
  const user = await requireUser();
  // Removing a control link is destructive — admin + compliance only.
  if (!canDeleteOrArchive(user.role)) throw new Error("Only admin or compliance can remove links.");
  const linkId = Number(formData.get("link_id"));
  const controlId = Number(formData.get("control_id"));
  await unlinkControl(linkId);
  await recomputeControlHealth(controlId);
  revalidatePath(`/controls/${controlId}`);
}

export async function recomputeAllControlsAction() {
  await requireUser();
  const rows = await queryAll<{ id: number }>(
    `SELECT id FROM controls WHERE is_active`
  );
  for (const r of rows) {
    await recomputeControlHealth(r.id);
  }
  revalidatePath("/controls");
  revalidatePath("/reports");
}
