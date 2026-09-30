"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, canEditSops } from "@/lib/auth/guard";
import { execute, queryOne } from "@/lib/db";
import { createCheck, recordResult, getCheck } from "./repository";
import { recomputeControlHealth } from "../controls/repository";
import { createCapa } from "../capa/repository";
import { notify } from "@/features/notifications/service";
import { extractAttachment } from "@/lib/attachments";

const CreateSchema = z.object({
  code: z.string().trim().optional().nullable(),
  name: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  control_id: z.coerce.number().int().positive().optional().nullable(),
  owner_user_id: z.coerce.number().int().positive().optional().nullable(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual", "on_demand"]),
  checklist_template_id: z.coerce.number().int().positive().optional().nullable(),
});

const ResultSchema = z.object({
  check_id: z.coerce.number().int().positive(),
  status: z.enum(["passing", "failing", "pending_review", "accepted_risk"]),
  notes: z.string().trim().min(1, "Notes are required when recording a result."),
  spawn_capa: z.string().optional(),
  checklist_template_id: z.coerce.number().int().positive().optional().nullable(),
});

const AssignSchema = z.object({
  check_id: z.coerce.number().int().positive(),
  assigned_user_id: z.coerce.number().int().positive(),
  assigned_role: z.enum(["auditor", "dm"]),
  brand_id: z.coerce.number().int().positive().optional().nullable(),
  department_id: z.coerce.number().int().positive().optional().nullable(),
  org_unit_id: z.coerce.number().int().positive().optional().nullable(),
  comment: z.string().trim().min(1, "Comment is required.").max(2000),
});

function nullEmpty<T extends Record<string, FormDataEntryValue>>(o: T) {
  const out: Record<string, unknown> = { ...o };
  for (const k of Object.keys(out)) if (out[k] === "") out[k] = null;
  return out;
}

export async function createCheckAction(formData: FormData) {
  const user = await requireUser();
  if (!canEditSops(user.role)) throw new Error("Not authorized.");
  const parsed = CreateSchema.parse(nullEmpty(Object.fromEntries(formData.entries())));
  const id = await createCheck(parsed);
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'create', 'check', $3, $4)`,
    [user.id, user.email, id, JSON.stringify({ name: parsed.name })]
  );
  if (parsed.control_id) {
    await execute(
      `IF NOT EXISTS (SELECT 1 FROM control_links WHERE control_id = $1 AND entity_type = 'check' AND entity_id = $2)
         INSERT INTO control_links (control_id, entity_type, entity_id, created_by)
         VALUES ($1, 'check', $2, $3)`,
      [parsed.control_id, id, user.id]
    );
  }
  revalidatePath("/tests");
  redirect(`/tests/${id}`);
}

/**
 * Set (or clear) a test's owner from its detail page. When no explicit
 * owner is set, the pages display the department head derived from the
 * test's control → SOP → department chain as the DEFAULT owner; this
 * action stores an explicit override.
 */
export async function setCheckOwnerAction(formData: FormData) {
  const user = await requireUser();
  if (!canEditSops(user.role) && user.role !== "compliance") {
    throw new Error("Only admin, Business Excellence, or Compliance can change the test owner.");
  }
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid test id.");
  const raw = (formData.get("owner_user_id") ?? "").toString();
  const ownerId = raw === "" ? null : Number(raw);
  if (ownerId !== null && (!Number.isFinite(ownerId) || ownerId <= 0)) {
    throw new Error("Invalid owner.");
  }
  await execute(
    `UPDATE checks SET owner_user_id = $2 WHERE id = $1`,
    [id, ownerId]
  );
  revalidatePath(`/tests/${id}`);
  revalidatePath("/tests");
}

export async function recordResultAction(formData: FormData) {
  const user = await requireUser();

  // Pull the File entry out BEFORE Zod parsing — Zod treats it as a string.
  const file = await extractAttachment(formData, "evidence_file");

  const raw = Object.fromEntries(formData.entries());
  delete (raw as Record<string, unknown>).evidence_file;

  const parsed = ResultSchema.parse(raw);

  await recordResult({
    check_id: parsed.check_id,
    status: parsed.status,
    notes: parsed.notes,
    evidence_url: file?.dataUrl ?? null,
    evidence_name: file?.name ?? null,
    evidence_mime: file?.mime ?? null,
    performed_by: user.id,
    checklist_template_id: parsed.checklist_template_id ?? null,
  });

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, $3, 'check', $4, $5)`,
    [
      user.id,
      user.email,
      `check_result:${parsed.status}`,
      parsed.check_id,
      JSON.stringify({ status: parsed.status }),
    ]
  );

  // Recompute the linked control's health, and optionally spawn a CAPA on failure
  const check = await getCheck(parsed.check_id);
  if (check?.control_id) {
    await recomputeControlHealth(check.control_id);
  }
  if (parsed.status === "failing" && parsed.spawn_capa === "on") {
    const capaId = await createCapa({
      title: `Remediation: ${check?.name ?? "failing check"}`,
      description: `Auto-generated from failing test "${check?.name ?? "unknown"}".${parsed.notes ? "\n\nNote: " + parsed.notes : ""}`,
      severity: "high",
      source_audit_id: null,
      source_item_id: null,
      created_by: user.id,
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    });
    if (check?.control_id) {
      await execute(
        `IF NOT EXISTS (SELECT 1 FROM control_links WHERE control_id = $1 AND entity_type = 'capa' AND entity_id = $2)
           INSERT INTO control_links (control_id, entity_type, entity_id, created_by)
           VALUES ($1, 'capa', $2, $3)`,
        [check.control_id, capaId, user.id]
      );
    }
  }

  // Notify on failing results — owner and admins should know immediately.
  if (parsed.status === "failing") {
    await notify({
      audience: {
        userIds: check?.owner_user_id ? [check.owner_user_id] : [],
        roles: ["admin"],
      },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "check:failing",
      title: `🔴 Check "${check?.name ?? "Test"}" is failing`,
      body: parsed.notes
        ? `Note: "${parsed.notes}"`
        : `Recorded by ${user.displayName}.`,
      severity: "critical",
      entity: { type: "check", id: parsed.check_id, href: `/tests/${parsed.check_id}` },
    });
  }

  revalidatePath("/tests");
  revalidatePath(`/tests/${parsed.check_id}`);
  revalidatePath("/controls");
}

/**
 * Assign a test to an Auditor and/or a Department Manager with an
 * accompanying comment. Each selected user gets an in-app notification
 * carrying the test name, comment, sender, and timestamp - exactly the
 * fields the spec calls for. The assignment itself is also written to
 * audit_logs so it shows up in the activity feed and we have a
 * tamper-evident record of who asked whom to look at what, and when.
 */
export async function assignTestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const blank = (v: FormDataEntryValue | undefined) =>
    v === "" || v === undefined ? null : v;

  const parsed = AssignSchema.parse({
    check_id: raw.check_id,
    assigned_user_id: raw.assigned_user_id,
    assigned_role: raw.assigned_role,
    brand_id: blank(raw.brand_id),
    department_id: blank(raw.department_id),
    org_unit_id: blank(raw.org_unit_id),
    comment: raw.comment,
  });

  const check = await getCheck(parsed.check_id);
  if (!check) throw new Error("Test not found.");

  // Resolve optional brand + department + org_unit labels so the
  // notification body carries human-readable context, not just opaque IDs.
  const brand = parsed.brand_id
    ? await queryOne<{ name: string }>(
        `SELECT name FROM brands WHERE id = $1`,
        [parsed.brand_id]
      )
    : null;
  const department = parsed.department_id
    ? await queryOne<{ name: string }>(
        `SELECT name FROM departments WHERE id = $1`,
        [parsed.department_id]
      )
    : null;
  const orgUnit = parsed.org_unit_id
    ? await queryOne<{ code: string; name: string }>(
        `SELECT code, name FROM org_units WHERE id = $1`,
        [parsed.org_unit_id]
      )
    : null;

  const roleLabel =
    parsed.assigned_role === "auditor" ? "Auditor" : "Department Manager";
  const contextBits = [
    brand ? `Brand: ${brand.name}` : null,
    department ? `Department: ${department.name}` : null,
    orgUnit ? `Org Unit: ${orgUnit.code} ${orgUnit.name}` : null,
  ].filter(Boolean);
  const contextLine = contextBits.length > 0 ? contextBits.join(" · ") + ". " : "";

  await notify({
    audience: { userIds: [parsed.assigned_user_id], excludeActorId: user.id },
    actor: { id: user.id, name: user.displayName, role: user.role },
    kind: "check:assigned",
    title: `📋 You've been assigned (${roleLabel}) to test: "${check.name}"`,
    body:
      `Assigned by ${user.displayName}. ` +
      contextLine +
      `Comment: "${parsed.comment}". ` +
      `Sent ${new Date().toLocaleString()}.`,
    severity: "info",
    entity: {
      type: "check",
      id: parsed.check_id,
      href: `/tests/${parsed.check_id}`,
    },
  });

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'check:assigned', 'check', $3, $4)`,
    [
      user.id,
      user.email,
      parsed.check_id,
      JSON.stringify({
        check_name: check.name,
        comment: parsed.comment,
        assigned_user_id: parsed.assigned_user_id,
        assigned_role: parsed.assigned_role,
        brand_id: parsed.brand_id ?? null,
        brand_name: brand?.name ?? null,
        department_id: parsed.department_id ?? null,
        department_name: department?.name ?? null,
        org_unit_id: parsed.org_unit_id ?? null,
        org_unit_code: orgUnit?.code ?? null,
        org_unit_name: orgUnit?.name ?? null,
        assigned_by: user.displayName,
        assigned_by_role: user.role,
      }),
    ]
  );

  revalidatePath("/tests");
  revalidatePath(`/tests/${parsed.check_id}`);
}
