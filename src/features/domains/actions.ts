"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireUser, canEditSops } from "@/lib/auth/guard";
import { execute } from "@/lib/db";
import { createDomain } from "./repository";

const CreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional().nullable(),
  sort_order: z.coerce.number().int().optional().nullable(),
  sop_id: z.coerce.number().int().positive().optional().nullable(),
  department_id: z.coerce.number().int().positive().optional().nullable(),
});

function nullEmpty<T extends Record<string, FormDataEntryValue>>(o: T) {
  const out: Record<string, unknown> = { ...o };
  for (const k of Object.keys(out)) if (out[k] === "") out[k] = null;
  return out;
}

export async function createDomainAction(formData: FormData) {
  const user = await requireUser();
  if (!canEditSops(user.role)) throw new Error("Not authorized.");

  const parsed = CreateSchema.parse(nullEmpty(Object.fromEntries(formData.entries())));

  // domains.code is NOT NULL/UNIQUE but is no longer a user-facing field
  // (user spec: no codes anywhere in the UI) — generate an opaque internal
  // one so the form never has to ask for it.
  const code = `AUTO-${randomUUID().replace(/-/g, "")}`;

  const id = await createDomain({
    code,
    name: parsed.name,
    description: parsed.description ?? null,
    sort_order: parsed.sort_order ?? null,
    sop_id: parsed.sop_id ?? null,
    department_id: parsed.department_id ?? null,
  });

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'create', 'domain', $3, $4)`,
    [user.id, user.email, id, JSON.stringify({ name: parsed.name })]
  );

  revalidatePath("/domains");
  redirect(`/domains/${id}`);
}
