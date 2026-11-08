"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { execute, queryOne } from "@/lib/db";
import { notify } from "@/features/notifications/service";
import {
  createSopFeedback,
  deleteOwnSopFeedback,
  getSopFeedback,
  respondSopFeedback,
} from "./repository";
import {
  FEEDBACK_RESPONSES,
  FEEDBACK_SECTIONS,
  FEEDBACK_TYPES,
  canTriageSopFeedback,
  sectionLabel,
} from "./types";

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const FeedbackSchema = z.object({
  sopId: z.coerce.number().int().positive(),
  sectionKey: z.string().refine((k) => FEEDBACK_SECTIONS.some((s) => s.key === k), "Choose a section."),
  fbType: z.enum(FEEDBACK_TYPES, { errorMap: () => ({ message: "Choose a feedback type." }) }),
  comment: z.string().trim().min(3, "Write your comment.").max(8000),
  proposed: opt(8000),
  evidence: opt(500),
  reviewerDept: opt(120),
  reviewerRole: opt(120),
});

/** Only same-app paths are accepted as a return target. */
const safeBack = (v: FormDataEntryValue | null, fallback: string) => {
  const s = String(v ?? "");
  return s.startsWith("/sops") ? s : fallback;
};
const withParam = (url: string, kv: string) => {
  const [path, hash] = url.split("#");
  return `${path}${path.includes("?") ? "&" : "?"}${kv}${hash ? "#" + hash : ""}`;
};

async function audit(userId: number, email: string, action: string, id: number, details: unknown) {
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, $3, 'sop_feedback', $4, $5)`,
    [userId, email, action, id, JSON.stringify(details)]
  );
}

export async function createSopFeedbackAction(formData: FormData) {
  const user = await requireUser();
  const back = safeBack(formData.get("returnTo"), "/sops/feedback");
  const parsed = FeedbackSchema.safeParse({
    sopId: formData.get("sopId"),
    sectionKey: formData.get("sectionKey") ?? "",
    fbType: formData.get("fbType") ?? "",
    comment: formData.get("comment") ?? "",
    proposed: formData.get("proposed") ?? "",
    evidence: formData.get("evidence") ?? "",
    reviewerDept: formData.get("reviewerDept") ?? "",
    reviewerRole: formData.get("reviewerRole") ?? "",
  });
  if (!parsed.success) {
    redirect(withParam(back, `error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the form.")}`));
  }
  const d = parsed.data;
  const sop = await queryOne<{ id: number; title: string; owner_id: number | null }>(
    `SELECT id, title, owner_id FROM sops WHERE id = $1`,
    [d.sopId]
  );
  if (!sop) redirect(withParam(back, `error=${encodeURIComponent("That SOP no longer exists.")}`));

  const id = await createSopFeedback({
    sopId: d.sopId,
    sectionKey: d.sectionKey,
    userId: user.id,
    reviewerName: user.displayName,
    reviewerDept: d.reviewerDept ?? null,
    reviewerRole: d.reviewerRole ?? null,
    fbType: d.fbType,
    comment: d.comment,
    proposed: d.proposed ?? null,
    evidence: d.evidence ?? null,
  });
  await audit(user.id, user.email, "sop_feedback:created", id, {
    sop_id: d.sopId,
    section: d.sectionKey,
    type: d.fbType,
  });

  // The SOP owner hears about review comments on their SOP.
  if (sop.owner_id && sop.owner_id !== user.id) {
    await notify({
      audience: { userIds: [sop.owner_id] },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "sop_feedback_created",
      title: `New review comment on "${sop.title}" (${sectionLabel(d.sectionKey)})`,
      body: d.comment.slice(0, 280),
      severity: "info",
      entity: { type: "sop", id: sop.id, href: `/sops/${sop.id}?tab=feedback` },
    });
  }

  revalidatePath("/sops", "layout");
  redirect(withParam(back, "saved=1"));
}

const RespondSchema = z.object({
  id: z.coerce.number().int().positive(),
  response: z
    .union([z.enum(FEEDBACK_RESPONSES), z.literal("")])
    .transform((v) => (v === "" ? null : v)),
  note: opt(8000),
  status: z.enum(["Open", "Closed"]),
});

export async function respondSopFeedbackAction(formData: FormData) {
  const user = await requireUser();
  const back = safeBack(formData.get("returnTo"), "/sops/feedback?view=all");
  if (!canTriageSopFeedback(user.role)) redirect(back);
  const d = RespondSchema.parse({
    id: formData.get("id"),
    response: formData.get("response") ?? "",
    note: formData.get("note") ?? "",
    status: formData.get("status") ?? "Open",
  });
  const before = await getSopFeedback(d.id);
  if (!before) redirect(back);

  await respondSopFeedback({
    id: d.id,
    responderId: user.id,
    response: d.response,
    note: d.note ?? null,
    status: d.status,
  });
  await audit(user.id, user.email, "sop_feedback:responded", d.id, {
    sop_id: before.sop_id,
    response: d.response,
    status: d.status,
  });

  if (before.user_id && before.user_id !== user.id && d.response) {
    await notify({
      audience: { userIds: [before.user_id] },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "sop_feedback_responded",
      title: `Your comment on "${before.sop_title}": ${d.response}`,
      body: d.note ?? `${user.displayName} responded to your comment.`,
      severity: d.response === "Not accepted" ? "warning" : "info",
      entity: { type: "sop", id: before.sop_id, href: `/sops/${before.sop_id}?tab=feedback` },
    });
  }

  revalidatePath("/sops", "layout");
  redirect(back);
}

export async function deleteSopFeedbackAction(formData: FormData) {
  const user = await requireUser();
  const back = safeBack(formData.get("returnTo"), "/sops/feedback");
  const id = Number(formData.get("id"));
  if (Number.isInteger(id) && id > 0) {
    const n = await deleteOwnSopFeedback(id, user.id);
    if (n > 0) await audit(user.id, user.email, "sop_feedback:withdrawn", id, {});
  }
  revalidatePath("/sops", "layout");
  redirect(back);
}
