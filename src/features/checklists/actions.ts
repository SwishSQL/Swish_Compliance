"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, canEditSops, canDeleteOrArchive } from "@/lib/auth/guard";
import { execute } from "@/lib/db";
import {
  createTemplate,
  updateTemplate,
  addItem,
  deleteItem,
  recordItemAnswer,
} from "./repository";

const CreateTplSchema = z.object({
  code: z.string().trim().optional().nullable(),
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional().nullable(),
  category: z.string().trim().optional().nullable(),
});

const UpdateTplSchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  category: z.string().trim().optional().nullable(),
  is_active: z.coerce.boolean().optional(),
});

const ItemSchema = z.object({
  template_id: z.coerce.number().int().positive(),
  question: z.string().trim().min(1, "Question is required"),
  guidance: z.string().trim().optional().nullable(),
  weight: z.coerce.number().int().min(1).max(10).default(1),
  is_critical: z.string().optional(),
});

function nullEmpty<T extends Record<string, FormDataEntryValue>>(o: T) {
  const out: Record<string, unknown> = { ...o };
  for (const k of Object.keys(out)) {
    if (out[k] === "") out[k] = null;
  }
  return out;
}

export async function createTemplateAction(formData: FormData) {
  const user = await requireUser();
  if (!canEditSops(user)) throw new Error("Not authorized.");
  const parsed = CreateTplSchema.parse(nullEmpty(Object.fromEntries(formData.entries())));
  const id = await createTemplate({ ...parsed, created_by: user.id });
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'create', 'checklist_template', $3, $4)`,
    [user.id, user.email, id, JSON.stringify({ name: parsed.name })]
  );
  revalidatePath("/checklists/templates");
  redirect(`/checklists/templates/${id}`);
}

export async function updateTemplateAction(formData: FormData) {
  const user = await requireUser();
  // Header edits (name / description / category / active=archive) ripple
  // into every audit that's ever used this template. Gated to admin +
  // compliance (user spec).
  if (!canDeleteOrArchive(user)) throw new Error("Only admin or compliance can edit a template's header.");
  const raw = Object.fromEntries(formData.entries());
  const parsed = UpdateTplSchema.parse({
    ...raw,
    description: raw.description === "" ? null : raw.description,
    category: raw.category === "" ? null : raw.category,
    is_active: raw.is_active === "on" || raw.is_active === "true",
  });
  await updateTemplate(parsed.id, parsed);
  revalidatePath(`/checklists/templates/${parsed.id}`);
  revalidatePath("/checklists/templates");
}

export async function addItemAction(formData: FormData) {
  const user = await requireUser();
  if (!canEditSops(user)) throw new Error("Not authorized.");
  const raw = Object.fromEntries(formData.entries());
  const parsed = ItemSchema.parse({
    ...raw,
    guidance: raw.guidance === "" ? null : raw.guidance,
  });
  await addItem({
    template_id: parsed.template_id,
    question: parsed.question,
    guidance: parsed.guidance ?? null,
    weight: parsed.weight,
    is_critical: parsed.is_critical === "on" || parsed.is_critical === "true",
  });
  revalidatePath(`/checklists/templates/${parsed.template_id}`);
}

const AnswerSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  template_id: z.coerce.number().int().positive(),
  answer: z.enum(["yes", "no", "na"]),
  note: z.string().trim().optional().nullable(),
});

export async function recordChecklistItemAnswerAction(formData: FormData) {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = AnswerSchema.parse({
    ...raw,
    note: raw.note === "" ? null : raw.note,
  });
  await recordItemAnswer({
    item_id: parsed.item_id,
    answer: parsed.answer,
    note: parsed.note ?? null,
    answered_by: user.id,
  });
  revalidatePath(`/checklists/templates/${parsed.template_id}`);
}

export async function deleteItemAction(formData: FormData) {
  const user = await requireUser();
  // Hard-deletes a question — gated to admin + compliance (user spec).
  if (!canDeleteOrArchive(user)) throw new Error("Only admin or compliance can delete a question.");
  const id = Number(formData.get("id"));
  const templateId = Number(formData.get("template_id"));
  await deleteItem(id);
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'checklist_item:deleted', 'checklist_item', $3, $4)`,
    [user.id, user.email, id, JSON.stringify({ template_id: templateId, by_user_name: user.displayName })]
  );
  revalidatePath(`/checklists/templates/${templateId}`);
}
