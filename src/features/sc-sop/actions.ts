"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { execute } from "@/lib/db";
import { notify } from "@/features/notifications/service";
import {
  createFeedback,
  deleteOwnFeedback,
  getFeedback,
  getRegister,
  respondFeedback,
} from "./repository";
import { FEEDBACK_RESPONSES, FEEDBACK_TYPES, STEP_REF_RX, canTriageScFeedback } from "./types";

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const FeedbackSchema = z.object({
  stepRef: z.string().trim().toUpperCase().transform((v) => (v === "GENERAL" ? "General" : v)).pipe(z.string().regex(STEP_REF_RX, "Use a Step ID such as PA-04-S230, a process such as PA-04, or General.")),
  fbType: z.enum(FEEDBACK_TYPES),
  comment: z.string().trim().min(3, "Write your comment.").max(8000),
  proposed: opt(8000),
  evidence: opt(500),
  reviewerDept: opt(120),
  reviewerRole: opt(120),
});

async function audit(userId: number, email: string, action: string, id: number, details: unknown) {
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, $3, 'sc_sop_feedback', $4, $5)`,
    [userId, email, action, id, JSON.stringify(details)]
  );
}

export async function createFeedbackAction(formData: FormData) {
  const user = await requireUser();
  const parsed = FeedbackSchema.safeParse({
    stepRef: formData.get("stepRef") ?? "",
    fbType: formData.get("fbType") ?? "",
    comment: formData.get("comment") ?? "",
    proposed: formData.get("proposed") ?? "",
    evidence: formData.get("evidence") ?? "",
    reviewerDept: formData.get("reviewerDept") ?? "",
    reviewerRole: formData.get("reviewerRole") ?? "",
  });
  const stepParam = encodeURIComponent(String(formData.get("stepRef") ?? ""));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Check the form.";
    redirect(`/sc-sop/feedback?step=${stepParam}&error=${encodeURIComponent(msg)}`);
  }
  const d = parsed.data;

  const reg = await getRegister();
  const known =
    d.stepRef === "General" ||
    reg.steps.some((s) => s.id === d.stepRef) ||
    reg.procs.some((p) => p.id === d.stepRef);
  if (!known) {
    redirect(`/sc-sop/feedback?step=${stepParam}&error=${encodeURIComponent(`${d.stepRef} is not in the docket.`)}`);
  }

  const id = await createFeedback({
    userId: user.id,
    reviewerName: user.displayName,
    reviewerDept: d.reviewerDept ?? null,
    reviewerRole: d.reviewerRole ?? null,
    stepRef: d.stepRef,
    fbType: d.fbType,
    comment: d.comment,
    proposed: d.proposed ?? null,
    evidence: d.evidence ?? null,
  });
  await audit(user.id, user.email, "sc_sop_feedback:created", id, { step: d.stepRef, type: d.fbType });

  revalidatePath("/sc-sop", "layout");
  const back = String(formData.get("returnTo") ?? "");
  if (back.startsWith("/sc-sop/")) redirect(`${back}${back.includes("?") ? "&" : "?"}saved=1`);
  redirect(`/sc-sop/feedback?saved=1`);
}

const RespondSchema = z.object({
  id: z.coerce.number().int().positive(),
  response: z.union([z.enum(FEEDBACK_RESPONSES), z.literal("")]).transform((v) => (v === "" ? null : v)),
  note: opt(8000),
  status: z.enum(["Open", "Closed"]),
});

export async function respondFeedbackAction(formData: FormData) {
  const user = await requireUser();
  if (!canTriageScFeedback(user.role)) redirect("/sc-sop/feedback");
  const d = RespondSchema.parse({
    id: formData.get("id"),
    response: formData.get("response") ?? "",
    note: formData.get("note") ?? "",
    status: formData.get("status") ?? "Open",
  });
  const before = await getFeedback(d.id);
  if (!before) redirect("/sc-sop/feedback?view=all");

  await respondFeedback({
    id: d.id,
    responderId: user.id,
    response: d.response,
    note: d.note ?? null,
    status: d.status,
  });
  await audit(user.id, user.email, "sc_sop_feedback:responded", d.id, {
    response: d.response,
    status: d.status,
  });

  if (before.user_id && before.user_id !== user.id && d.response) {
    await notify({
      audience: { userIds: [before.user_id] },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "sc_sop_feedback_responded",
      title: `Your SC SOP feedback on ${before.step_ref}: ${d.response}`,
      body: d.note ?? `${user.displayName} responded to your comment.`,
      severity: d.response === "Not accepted" ? "warning" : "info",
      entity: { type: "sc_sop_feedback", id: d.id, href: "/sc-sop/feedback" },
    });
  }

  revalidatePath("/sc-sop", "layout");
  const back = String(formData.get("returnTo") ?? "/sc-sop/feedback?view=all");
  redirect(back.startsWith("/sc-sop/") ? back : "/sc-sop/feedback?view=all");
}

export async function deleteFeedbackAction(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id) && id > 0) {
    const n = await deleteOwnFeedback(id, user.id);
    if (n > 0) await audit(user.id, user.email, "sc_sop_feedback:withdrawn", id, {});
  }
  revalidatePath("/sc-sop", "layout");
  redirect("/sc-sop/feedback");
}
