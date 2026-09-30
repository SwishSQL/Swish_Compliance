"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, canDeleteOrArchive } from "@/lib/auth/guard";
import { execute } from "@/lib/db";
import {
  createAudit,
  insertAuditSops,
  upsertResponse,
  submitAudit,
  closeAudit,
  cancelAudit,
  reopenAudit,
  getAudit,
  addAuditAttachment,
  deleteAuditAttachment,
} from "./repository";
import { autoCreateCapasForAudit } from "../capa/repository";
import { resolveScope } from "./scope";
import { notify } from "@/features/notifications/service";
import { extractAttachment, extractAttachments } from "@/lib/attachments";

const CreateSchema = z.object({
  // template_id is now optional (migration 038). The audit's checklist
  // items come from the selected tests' linked items, not a pre-picked
  // template. Older audits with a template still work because the
  // detail page falls back to the template when no tests are linked.
  template_id: z.coerce.number().int().positive().optional().nullable(),
  brand_id: z.coerce.number().int().positive().optional().nullable(),
  // The audited department drives the whole scope walk, so it is required
  // (migration 042): a SOP can span departments and each gets its own audit.
  department_id: z.coerce.number().int().positive({
    message: "Audited department is required.",
  }),
  location: z.string().trim().optional().nullable(),
  audit_date: z.string().optional().nullable(),
  // sop_ids (one or more) are read separately via selectedSopIds() — a
  // repeated form field, not a single coercible value.
  // Scope selection. Controls and tests are NOT accepted from the client —
  // resolveScope() derives them from these three fields so a tampered form
  // can't widen an audit beyond what its scope covers.
  scope_type: z.enum(["full_sop", "framework", "domain"]),
  domain_id: z.coerce.number().int().positive().optional().nullable(),
  framework_id: z.coerce.number().int().positive().optional().nullable(),
  // Audit window + people.
  start_at: z.string().optional().nullable(),
  end_at: z.string().optional().nullable(),
  assigned_to: z.coerce.number().int().positive({
    message: "Assigned auditor is required.",
  }),
  auditee_id: z.coerce.number().int().positive().optional().nullable(),
  auditee_custom_name: z.string().trim().max(200).optional().nullable(),
  reviewer_id: z.coerce.number().int().positive().optional().nullable(),
  objective: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

const ResponseSchema = z.object({
  audit_id: z.coerce.number().int().positive(),
  item_id: z.coerce.number().int().positive(),
  response: z.enum(["pass", "fail", "na"]).optional().nullable(),
  /** How the sampled interactions broke down (migration 054). */
  yes_percent: z.coerce.number().int().min(0).max(100).optional().nullable(),
  no_percent: z.coerce.number().int().min(0).max(100).optional().nullable(),
  na_percent: z.coerce.number().int().min(0).max(100).optional().nullable(),
  // Notes are now optional. The Test → Checklist quick-answer UI lets
  // the auditor click Yes/No/N/A and move on; they only have to type
  // a note when they actually want to capture context.
  notes: z.string().trim().optional().nullable(),
});

const AnswerSplitSchema = z
  .object({
    itemId: z.coerce.number().int().positive(),
    response: z.enum(["pass", "fail", "na"]),
    yesPercent: z.coerce.number().int().min(0).max(100),
    noPercent: z.coerce.number().int().min(0).max(100),
    naPercent: z.coerce.number().int().min(0).max(100),
    notes: z.string().trim(),
  })
  .refine((a) => a.yesPercent + a.noPercent + a.naPercent === 100, {
    message: "Yes/No/N-A percentages must add up to 100.",
  });

const BulkResponsesSchema = z.object({
  auditId: z.coerce.number().int().positive(),
  answers: z.array(AnswerSplitSchema).max(2000),
});

const SubmitSchema = z.object({
  id: z.coerce.number().int().positive(),
  summary: z.string().optional().nullable(),
  spawn_capa: z.string().optional(),
});

/** Pull every selected SOP out of the multi-select — one or more repeated
 *  "sop_ids" form entries (migration 055). */
function selectedSopIds(formData: FormData): number[] {
  const out: number[] = [];
  for (const v of formData.getAll("sop_ids")) {
    if (typeof v === "string" && v !== "") {
      const n = Number(v);
      if (Number.isInteger(n) && n > 0) out.push(n);
    }
  }
  return Array.from(new Set(out));
}

/**
 * Editing rules for audits:
 *   1. Only the auditor (creator), the current assignee, or an admin may
 *      edit the audit. Re-assigning the audit transfers edit rights —
 *      previous assignees lose access (matches what we told the user).
 *   2. Once the audit is closed, no further edits are allowed by anyone.
 */
type AuditGuardSubject = {
  auditor_id: number | null;
  assigned_to: number | null;
  status: string;
};
type AuditGuardActor = { id: number; role: string };

/**
 * Pick a human-readable title for an audit in notifications / logs.
 * template_name is NULL in the tests-first flow (no pre-picked template),
 * so a fallback chain stops the UI from rendering "Audit "null"".
 */
function auditTitle(audit: {
  template_name?: string | null;
  control_name?: string | null;
  framework_name?: string | null;
  department_name?: string | null;
  audit_date?: string | null;
}): string {
  return (
    audit.template_name ||
    audit.control_name ||
    audit.framework_name ||
    `Audit — ${audit.department_name ?? "Unscoped"}${
      audit.audit_date ? ` (${new Date(audit.audit_date).toLocaleDateString()})` : ""
    }`
  );
}

function assertCanEditAudit(audit: AuditGuardSubject, actor: AuditGuardActor): void {
  if (audit.status === "closed") {
    throw new Error("This audit is closed and can't be edited anymore.");
  }
  const isOwner = audit.auditor_id === actor.id;
  const isAssignee = audit.assigned_to === actor.id;
  const isAdmin = actor.role === "admin";
  if (!isOwner && !isAssignee && !isAdmin) {
    throw new Error(
      "Only the auditor who created this audit, the user it's assigned to, or an admin can edit it."
    );
  }
}

export async function createAuditAction(formData: FormData) {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());

  const blank = (v: FormDataEntryValue | undefined) =>
    v === "" || v === undefined ? null : v;
  const parsed = CreateSchema.parse({
    ...raw,
    template_id: blank(raw.template_id),
    brand_id: blank(raw.brand_id),
    location: blank(raw.location),
    audit_date: blank(raw.audit_date),
    domain_id: blank(raw.domain_id),
    framework_id: blank(raw.framework_id),
    start_at: blank(raw.start_at),
    end_at: blank(raw.end_at),
    auditee_id: blank(raw.auditee_id),
    auditee_custom_name: blank(raw.auditee_custom_name),
    reviewer_id: blank(raw.reviewer_id),
    objective: blank(raw.objective),
    notes: blank(raw.notes),
  });

  const sopIds = selectedSopIds(formData);
  if (sopIds.length === 0) {
    throw new Error("Pick at least one Policy / SOP.");
  }
  // Selecting several SOPs only makes sense as "audit everything under
  // them" — force Full SOP regardless of what the (hidden, now-disabled)
  // scope-type field carried over from a single-SOP selection.
  const scopeType = sopIds.length > 1 ? "full_sop" : parsed.scope_type;

  // Derive the scope server-side. This is the authoritative walk — the
  // form only ever sends the *selection*, never the resulting rows.
  const scope = await resolveScope({
    sopIds,
    departmentId: parsed.department_id,
    scopeType,
    domainId: parsed.domain_id,
    frameworkId: parsed.framework_id,
  });

  if (scope.tests.length === 0) {
    throw new Error(
      "This scope has no tests linked to it yet, so there would be nothing to audit. " +
        "Pick a different scope, or link tests to the controls underneath it first."
    );
  }

  // A Framework Audit pins one framework; the broader types cover many, so
  // only record framework_id when it's genuinely singular.
  const frameworkId =
    scopeType === "framework"
      ? parsed.framework_id
      : scope.frameworkIds.length === 1
      ? scope.frameworkIds[0]
      : null;

  const id = await createAudit({
    template_id: parsed.template_id ?? null,
    brand_id: parsed.brand_id,
    department_id: parsed.department_id,
    location: parsed.location,
    audit_date: parsed.audit_date,
    // policy_id stays the first selected SOP for backward compat — the
    // full list lives in audit_sops (migration 055), written just below.
    policy_id: sopIds[0],
    framework_id: frameworkId,
    domain_id: parsed.domain_id,
    // control_id stays single-valued for backwards compatibility: it only
    // means something when the scope resolved to exactly one control.
    control_id: scope.controls.length === 1 ? scope.controls[0].id : null,
    start_at: parsed.start_at,
    end_at: parsed.end_at,
    assigned_to: parsed.assigned_to,
    auditor_id: user.id,
    scope_type: scopeType,
    // A typed-in name overrides picking a system user as the auditee.
    auditee_id: parsed.auditee_custom_name ? null : parsed.auditee_id,
    auditee_custom_name: parsed.auditee_custom_name,
    reviewer_id: parsed.reviewer_id,
    objective: parsed.objective,
    notes: parsed.notes,
  });

  // Every SOP this audit covers (migration 055) — policy_id above is just
  // the first of these.
  await insertAuditSops(id, sopIds);

  // Populate the audit_tests junction — this is what the audit detail page
  // reads to build the question list. Bulk-insert via a single VALUES list
  // so we don't fire N round-trips on the happy path.
  const testIds = scope.tests.map((t) => t.id);
  const placeholders = testIds.map((_, i) => `($1, $${i + 2})`).join(", ");
  await execute(
    `INSERT INTO audit_tests (audit_id, check_id) VALUES ${placeholders}
     ON CONFLICT DO NOTHING`,
    [id, ...testIds]
  );

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'create', 'audit', $3, $4)`,
    [
      user.id,
      user.email,
      id,
      JSON.stringify({
        sop_ids: sopIds,
        scope_type: scopeType,
        domain_id: parsed.domain_id ?? null,
        framework_id: frameworkId,
        framework_count: scope.frameworkIds.length,
        control_count: scope.controls.length,
        test_count: testIds.length,
        question_count: scope.questionCount,
        start_at: parsed.start_at ?? null,
        end_at: parsed.end_at ?? null,
        assigned_to: parsed.assigned_to,
        auditee_id: parsed.auditee_id ?? null,
        reviewer_id: parsed.reviewer_id ?? null,
      }),
    ]
  );

  // If the creator picked an assignee, ping them. notify() swallows its
  // own errors so a flaky notification can't take the audit insert down.
  if (parsed.assigned_to && parsed.assigned_to !== user.id) {
    const windowBits = [
      parsed.start_at ? `Starts ${new Date(parsed.start_at).toLocaleString()}` : null,
      parsed.end_at   ? `Ends ${new Date(parsed.end_at).toLocaleString()}`     : null,
    ].filter(Boolean);
    const windowLine = windowBits.length ? windowBits.join(" · ") + ". " : "";
    await notify({
      audience: { userIds: [parsed.assigned_to] },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "audit:assigned",
      title: `📋 You've been assigned a new audit`,
      body:
        `Assigned by ${user.displayName}. ` +
        windowLine +
        `Open the audit to start recording responses.`,
      severity: "info",
      entity: { type: "audit", id, href: `/audits/${id}` },
    });
  }

  revalidatePath("/audits");
  redirect(`/audits/${id}`);
}

/**
 * Upload one or more files (photos / PDFs / docs) at the audit level.
 * Reuses the per-item evidence gate: only the auditor or admin can
 * attach, and never on a closed audit.
 */
export async function addAuditAttachmentsAction(formData: FormData) {
  const user = await requireUser();
  const auditId = Number(formData.get("audit_id"));
  if (!Number.isFinite(auditId) || auditId <= 0) {
    throw new Error("Invalid audit id.");
  }
  const audit = await getAudit(auditId);
  if (!audit) throw new Error("Audit not found.");
  assertCanEditAudit(audit, user);

  const files = await extractAttachments(formData, "files");
  if (files.length === 0) {
    throw new Error("Pick at least one file to upload.");
  }
  for (const f of files) {
    await addAuditAttachment({
      audit_id: auditId,
      file_url: f.dataUrl,
      file_name: f.name,
      file_mime: f.mime,
      file_size: f.size,
      uploaded_by: user.id,
    });
  }
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'audit:attachment_added', 'audit', $3, $4)`,
    [
      user.id,
      user.email,
      auditId,
      JSON.stringify({ count: files.length, names: files.map((f) => f.name) }),
    ]
  );
  revalidatePath(`/audits/${auditId}`);
}

/**
 * Remove one attachment. Same edit gate as the upload — auditor / admin,
 * not closed.
 */
export async function deleteAuditAttachmentAction(formData: FormData) {
  const user = await requireUser();
  const attachmentId = Number(formData.get("attachment_id"));
  const auditId = Number(formData.get("audit_id"));
  if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
    throw new Error("Invalid attachment id.");
  }
  const audit = await getAudit(auditId);
  if (!audit) throw new Error("Audit not found.");
  // Owner/assignee/admin may manage their audit's evidence; compliance
  // may also remove it (governance). Others blocked.
  if (!canDeleteOrArchive(user.role)) assertCanEditAudit(audit, user);

  await deleteAuditAttachment(attachmentId);
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'audit:attachment_removed', 'audit', $3, $4)`,
    [user.id, user.email, auditId, JSON.stringify({ attachment_id: attachmentId })]
  );
  revalidatePath(`/audits/${auditId}`);
}

export async function saveResponseAction(formData: FormData) {
  const user = await requireUser();

  // 1) Pull the File entry out BEFORE Zod parsing (Zod treats files as strings).
  const file = await extractAttachment(formData, "evidence_file");

  // 2) Look at all the other form fields.
  const raw = Object.fromEntries(formData.entries());
  delete (raw as Record<string, unknown>).evidence_file;

  // The client sets update_evidence = "true" only when there's actually a
  // new file in the input. Otherwise we keep whatever evidence is on file.
  const updateEvidence = raw.update_evidence === "true";
  delete (raw as Record<string, unknown>).update_evidence;
  const explicitRemove = raw.remove_evidence === "true";
  delete (raw as Record<string, unknown>).remove_evidence;

  const parsed = ResponseSchema.parse({
    ...raw,
    response: raw.response === "" ? null : raw.response,
  });

  // 3) Enforce the edit rules before touching the responses table.
  const audit = await getAudit(parsed.audit_id);
  if (!audit) throw new Error("Audit not found.");
  assertCanEditAudit(audit, user);

  await upsertResponse({
    audit_id: parsed.audit_id,
    item_id: parsed.item_id,
    response: parsed.response ?? null,
    yes_percent: parsed.yes_percent ?? null,
    no_percent: parsed.no_percent ?? null,
    na_percent: parsed.na_percent ?? null,
    notes: parsed.notes ?? null,
    // Only touch the evidence columns when the client says it has something
    // new to write (file uploaded OR explicit removal). Plain Pass / notes
    // re-saves leave existing evidence untouched.
    evidence_url: file?.dataUrl ?? null,
    evidence_name: file?.name ?? null,
    evidence_mime: file?.mime ?? null,
    update_evidence: updateEvidence || explicitRemove,
  });
  revalidatePath(`/audits/${parsed.audit_id}`);
}

/**
 * Save many answers at once — what the single "Save all answers" button
 * (and Submit) calls, instead of one round-trip per question.
 *
 * Evidence columns are deliberately untouched here: this path only ever
 * carries the Yes/No/N-A choice and the note. Per-question evidence is
 * uploaded through saveResponseAction, and upsertResponse's
 * update_evidence flag defaults to false so a bulk save can't wipe a file
 * the auditor already attached.
 *
 * The auth/status gate is checked ONCE for the audit rather than per
 * answer — they all belong to the same audit, so re-fetching it for each
 * row would just be N identical queries.
 */
export async function saveResponsesBulkAction(input: {
  auditId: number;
  answers: {
    itemId: number;
    response: "pass" | "fail" | "na";
    yesPercent: number;
    noPercent: number;
    naPercent: number;
    notes: string;
  }[];
}): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const user = await requireUser();

  const parsed = BulkResponsesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Some answers were not in a valid format.",
    };
  }

  const audit = await getAudit(parsed.data.auditId);
  if (!audit) return { ok: false, error: "Audit not found." };
  try {
    assertCanEditAudit(audit, user);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Not allowed." };
  }
  if (audit.status !== "in_progress") {
    return { ok: false, error: "This audit is no longer in progress." };
  }

  try {
    for (const a of parsed.data.answers) {
      await upsertResponse({
        audit_id: parsed.data.auditId,
        item_id: a.itemId,
        response: a.response,
        yes_percent: a.yesPercent,
        no_percent: a.noPercent,
        na_percent: a.naPercent,
        notes: a.notes || null,
      });
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }

  revalidatePath(`/audits/${parsed.data.auditId}`);
  return { ok: true, saved: parsed.data.answers.length };
}

export async function submitAuditAction(formData: FormData) {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = SubmitSchema.parse({ ...raw });
  const audit = await getAudit(parsed.id);
  if (!audit) throw new Error("Audit not found.");
  // Editing rules: owner / admin only, and not closed.
  assertCanEditAudit(audit, user);
  if (audit.status !== "in_progress") throw new Error("Audit is no longer in progress.");

  const { scorePct, criticalFailed, failedItemIds } = await submitAudit(
    parsed.id,
    parsed.summary ?? null
  );

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'audit:submitted', 'audit', $3, $4)`,
    [
      user.id,
      user.email,
      parsed.id,
      JSON.stringify({ score: scorePct, critical_failed: criticalFailed }),
    ]
  );

  // Every failed question becomes a CAPA — ALWAYS (user spec), no
  // longer behind the spawn_capa checkbox. Idempotent set-based insert;
  // findings that already have a CAPA are skipped. CAPAs land assigned
  // to the audited department's manager (user spec) — unassigned only
  // when that department has no manager set yet.
  if (failedItemIds.length > 0) {
    const { count: spawned, assignedManagerIds } = await autoCreateCapasForAudit(
      parsed.id,
      user.id
    );
    if (spawned > 0) {
      await execute(
        `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
         VALUES ($1, $2, 'capa:auto_created_from_audit', 'audit', $3, $4)`,
        [
          user.id,
          user.email,
          parsed.id,
          JSON.stringify({ capa_count: spawned, assigned_manager_ids: assignedManagerIds }),
        ]
      );
    }
    for (const managerId of assignedManagerIds) {
      await notify({
        audience: { userIds: [managerId] },
        actor: { id: user.id, name: user.displayName, role: user.role },
        kind: "capa:assigned",
        title: `📋 New corrective action(s) for your department`,
        body: `Audit "${auditTitle(audit)}" failed one or more questions. As department manager you've been assigned to resolve them.`,
        severity: "warning",
        entity: { type: "audit", id: parsed.id, href: `/capa?audit_id=${parsed.id}` },
      });
    }
  }

  // Notify reviewers. Critical fails go to a wider audience.
  const hasCritical = criticalFailed > 0;
  await notify({
    audience: hasCritical
      ? { roles: ["compliance", "business_excellence", "ceo", "admin"] }
      : { roles: ["compliance", "admin"] },
    actor: { id: user.id, name: user.displayName, role: user.role },
    kind: hasCritical ? "audit:critical" : "audit:submitted",
    // template_name is NULL for the tests-first flow. Fall back to the
    // control name, then the audit id, so titles never read "null".
    title: hasCritical
      ? `🚨 Audit "${auditTitle(audit)}" submitted with ${criticalFailed} CRITICAL failure(s)`
      : `Audit "${auditTitle(audit)}" submitted (score ${scorePct}%)`,
    body: `${audit.brand_name ?? "Brand —"} · ${audit.department_name ?? "Department —"} · ${audit.location ?? "Location —"}. ${failedItemIds.length} total fails.`,
    severity: hasCritical ? "critical" : scorePct < 70 ? "warning" : "info",
    entity: { type: "audit", id: parsed.id, href: `/audits/${parsed.id}` },
  });

  revalidatePath("/audits");
  revalidatePath(`/audits/${parsed.id}`);
  revalidatePath("/capa");
}

/**
 * Reopen a submitted audit so the auditor can edit responses again.
 * Allowed for the auditor (owner) or admin, and ONLY when the audit is
 * currently 'submitted'. Closed audits stay closed.
 */
export async function reopenAuditAction(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid audit id.");

  const audit = await getAudit(id);
  if (!audit) throw new Error("Audit not found.");
  // The standard edit gate already blocks 'closed' and non-owners.
  assertCanEditAudit(audit, user);
  if (audit.status !== "submitted") {
    throw new Error("Only a submitted audit can be reopened.");
  }

  await reopenAudit(id);
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id)
     VALUES ($1, $2, 'audit:reopened', 'audit', $3)`,
    [user.id, user.email, id]
  );

  // Let compliance know the audit is being edited again — useful for the
  // audit trail and so anyone watching the result knows the score is stale.
  await notify({
    audience: { roles: ["compliance", "admin"] },
    actor: { id: user.id, name: user.displayName, role: user.role },
    kind: "audit:reopened",
    title: `Audit "${auditTitle(audit)}" reopened for editing`,
    body: `${audit.brand_name ?? "Brand —"} · ${audit.department_name ?? "Department —"}. Previous score (${audit.score ?? "—"}%) cleared; will be recomputed on resubmit.`,
    severity: "info",
    entity: { type: "audit", id, href: `/audits/${id}` },
  });

  revalidatePath("/audits");
  revalidatePath(`/audits/${id}`);
}

/**
 * Cancel an assigned audit. The creator, an admin, compliance, or BE
 * can call this off — typically because the assignment was wrong or no
 * longer needed. We block cancel after submission so a completed audit
 * with a score can't be erased; closed audits also stay closed.
 *
 * Notifies the previous assignee so they know the work has been
 * called off.
 */
export async function cancelAuditAction(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid audit id.");

  const audit = await getAudit(id);
  if (!audit) throw new Error("Audit not found.");

  if (audit.status === "closed" || audit.status === "submitted") {
    throw new Error(
      "This audit has already been submitted or closed — it can no longer be cancelled."
    );
  }
  if (audit.status === "cancelled") {
    throw new Error("This audit is already cancelled.");
  }

  // Cancel = archive of an audit; gated to admin + compliance (user spec).
  if (!canDeleteOrArchive(user.role)) {
    throw new Error("Only admin or compliance can cancel an audit.");
  }

  await cancelAudit(id);
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'audit:cancelled', 'audit', $3, $4)`,
    [
      user.id,
      user.email,
      id,
      JSON.stringify({
        by_user_name: user.displayName,
        prev_assigned_to: audit.assigned_to,
      }),
    ]
  );

  if (audit.assigned_to && audit.assigned_to !== user.id) {
    await notify({
      audience: { userIds: [audit.assigned_to] },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "audit:cancelled",
      title: `Audit "${auditTitle(audit)}" was cancelled`,
      body: `${user.displayName} cancelled this audit. You no longer need to act on it.`,
      severity: "warning",
      entity: { type: "audit", id, href: `/audits/${id}` },
    });
  }

  revalidatePath("/audits");
  revalidatePath(`/audits/${id}`);
}

export async function closeAuditAction(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));

  const audit = await getAudit(id);
  if (!audit) throw new Error("Audit not found.");
  // The same edit gate guards close: only the auditor/admin can close, and
  // a closed audit can't be 'closed' again (assertCanEditAudit throws on
  // closed).
  assertCanEditAudit(audit, user);
  if (audit.status !== "submitted") {
    throw new Error("Only a submitted audit can be closed.");
  }

  await closeAudit(id);
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id)
     VALUES ($1, $2, 'audit:closed', 'audit', $3)`,
    [user.id, user.email, id]
  );
  revalidatePath("/audits");
  revalidatePath(`/audits/${id}`);
}
