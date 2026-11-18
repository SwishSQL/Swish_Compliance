"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, type AuthUser } from "@/lib/auth/guard";
import { departmentManagerIds } from "@/lib/auth/people";
import {
  canWorkOnCapa,
  canManagerReviewCapa,
  canVerifyCloseCapa,
  canAssignCapa,
  submitTarget,
  isCapaClosed,
  type CapaActor,
} from "./workflow";
import { getUserScope } from "@/lib/auth/access";
import { execute, queryAll } from "@/lib/db";
import {
  createCapa,
  transitionCapa,
  getCapa,
  setCapaAssignee,
  upsertCapaFromFinding,
  listBulkAssignableFindings,
  getAuditScope,
  getAuditScopesMap,
  saveCapaExecution,
  setCapaRejectionReason,
  addCapaEvidence,
  deleteCapaEvidence,
  listCapaEvidences,
} from "./repository";
import { extractAttachments } from "@/lib/attachments";
import type { CapaStatus } from "./types";
import { notify } from "@/features/notifications/service";

const CreateSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().optional().nullable(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  brand_id: z.coerce.number().int().positive().optional().nullable(),
  department_id: z.coerce.number().int().positive().optional().nullable(),
  assigned_to: z.coerce.number().int().positive().optional().nullable(),
  due_date: z.string().optional().nullable(),
});

/** The CAPA workflow actor: permissions + departments in scope. */
async function capaActor(user: AuthUser): Promise<CapaActor> {
  const scope = await getUserScope(user.id, user);
  return { id: user.id, permissions: user.permissions, departmentIds: scope.departmentIds };
}

/**
 * Assignment rule (docs/RBAC.md §7): Compliance / IBE assign anywhere; a
 * department manager assigns CAPAs of their own department, to people in
 * that department. Returns an error message, or null when allowed.
 */
async function assignBlocker(
  user: AuthUser,
  departmentIds: (number | null | undefined)[],
  assigneeId: number | null | undefined
): Promise<string | null> {
  const actor = await capaActor(user);
  if (departmentIds.some((d) => !canAssignCapa(actor, d ?? null))) {
    return "Only Compliance, the IBE Manager, or the department's own manager can assign these CAPAs.";
  }
  if (!user.permissions.has("capa.assign_any") && assigneeId) {
    const rows = await queryAll<{ id: number }>(
      `SELECT u.id FROM users u
       WHERE u.id = $1 AND u.is_active = 1
         AND (u.department_id = ANY($2::int[])
              OR EXISTS (SELECT 1 FROM user_departments ud
                         WHERE ud.user_id = u.id AND ud.department_id = ANY($2::int[])))`,
      [assigneeId, departmentIds.filter((d): d is number => d != null)]
    );
    if (rows.length === 0) return "A department manager can only assign CAPAs to members of that department.";
  }
  return null;
}

const TransitionSchema = z.object({
  id: z.coerce.number().int().positive(),
  status: z.enum(["pending_compliance_verification", "closed"]),
  resolution_note: z.string().optional().nullable(),
  evidence_url: z.string().optional().nullable(),
});

export async function createCapaAction(formData: FormData) {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = CreateSchema.parse({
    ...raw,
    description: raw.description === "" ? null : raw.description,
    brand_id: raw.brand_id === "" ? null : raw.brand_id,
    department_id: raw.department_id === "" ? null : raw.department_id,
    assigned_to: raw.assigned_to === "" ? null : raw.assigned_to,
    due_date: raw.due_date === "" ? null : raw.due_date,
  });
  const blocker = await assignBlocker(user, [parsed.department_id ?? null], parsed.assigned_to);
  if (blocker) throw new Error(blocker);
  const id = await createCapa({ ...parsed, created_by: user.id });
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'create', 'capa', $3, $4)`,
    [user.id, user.email, id, JSON.stringify({ title: parsed.title })]
  );

  // Notify the assignee (or admins if none) about the new CAPA.
  await notify({
    audience: parsed.assigned_to
      ? { userIds: [parsed.assigned_to] }
      : { roles: ["admin", "compliance"] },
    actor: { id: user.id, name: user.displayName, role: user.role },
    kind: "capa:created",
    title: parsed.assigned_to
      ? `New CAPA assigned to you: "${parsed.title}"`
      : `New CAPA pending assignment: "${parsed.title}"`,
    body: `Severity: ${parsed.severity}${parsed.due_date ? `. Due ${parsed.due_date}` : ""}.`,
    severity: parsed.severity === "critical" ? "critical" : "info",
    entity: { type: "capa", id, href: `/capa/${id}` },
  });

  revalidatePath("/capa");
  redirect(`/capa/${id}`);
}

/* ─── Execution flow (Owner view) ────────────────────────────── */

const ExecutionSchema = z.object({
  id: z.coerce.number().int().positive(),
  root_cause: z.string().trim().optional().nullable(),
  corrective_action_taken: z.string().trim().optional().nullable(),
  preventive_action_taken: z.string().trim().optional().nullable(),
  completion_note: z.string().trim().optional().nullable(),
});

/**
 * The four owner completion fields, in display order. Used to enforce
 * that all of them are answered — both when the owner saves and again
 * (against the STORED row) before submit-for-review, so a CAPA can
 * never reach the reviewer with an unanswered question.
 */
const EXECUTION_REQUIRED_FIELDS = [
  { key: "root_cause", label: "Root cause" },
  { key: "corrective_action_taken", label: "Corrective action taken" },
  { key: "preventive_action_taken", label: "Preventive action taken" },
  { key: "completion_note", label: "Completion note" },
] as const;

/**
 * Save from the owner's execution form. Only the assignee (or an
 * admin) can save execution fields; that keeps compliance from
 * accidentally overwriting the owner's work. Status is not touched.
 * ALL four completion questions are mandatory — the form marks them
 * required, and this re-checks server-side.
 */
export async function saveCapaExecutionAction(formData: FormData) {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = ExecutionSchema.parse({
    ...raw,
    root_cause: raw.root_cause === "" ? null : raw.root_cause,
    corrective_action_taken:
      raw.corrective_action_taken === "" ? null : raw.corrective_action_taken,
    preventive_action_taken:
      raw.preventive_action_taken === "" ? null : raw.preventive_action_taken,
    completion_note: raw.completion_note === "" ? null : raw.completion_note,
  });

  const missing = EXECUTION_REQUIRED_FIELDS.filter(
    (f) => !(parsed[f.key] ?? "").trim()
  ).map((f) => f.label);
  if (missing.length > 0) {
    throw new Error(
      `All completion questions must be answered. Missing: ${missing.join(", ")}.`
    );
  }

  const capa = await getCapa(parsed.id);
  if (!capa) throw new Error("CAPA not found.");
  if (!canWorkOnCapa(await capaActor(user), capa)) {
    throw new Error(
      capa.assigned_to === user.id
        ? "This CAPA is under review or closed — execution fields are locked."
        : "Only the CAPA owner (assignee) can save execution fields."
    );
  }

  await saveCapaExecution({
    id: parsed.id,
    root_cause: parsed.root_cause ?? null,
    corrective_action_taken: parsed.corrective_action_taken ?? null,
    preventive_action_taken: parsed.preventive_action_taken ?? null,
    completion_note: parsed.completion_note ?? null,
  });
  // Saving progress means work has started.
  if (capa.status !== "in_progress") {
    await transitionCapa(parsed.id, "in_progress", {});
  }

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'capa:execution_saved', 'capa', $3, $4)`,
    [
      user.id,
      user.email,
      parsed.id,
      JSON.stringify({ by_user_name: user.displayName }),
    ]
  );
  revalidatePath(`/capa/${parsed.id}`);
}

/**
 * Owner uploads one or more CAPA-side evidence files ("proof the fix
 * happened"). Only the assignee or admin can upload. Same 10 MB /
 * whitelisted-mime rules as audit attachments.
 */
export async function addCapaEvidenceAction(formData: FormData) {
  const user = await requireUser();
  const capaId = Number(formData.get("capa_id"));
  if (!Number.isFinite(capaId) || capaId <= 0) throw new Error("Invalid CAPA id.");
  const capa = await getCapa(capaId);
  if (!capa) throw new Error("CAPA not found.");
  if (!canWorkOnCapa(await capaActor(user), capa)) {
    throw new Error("Only the CAPA owner can upload evidence, and only while the CAPA is with them.");
  }

  const files = await extractAttachments(formData, "files");
  if (files.length === 0) throw new Error("Pick at least one file to upload.");
  for (const f of files) {
    await addCapaEvidence({
      capa_id: capaId,
      file_url: f.dataUrl,
      file_name: f.name,
      file_mime: f.mime,
      file_size: f.size,
      uploaded_by: user.id,
    });
  }
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'capa:evidence_added', 'capa', $3, $4)`,
    [
      user.id,
      user.email,
      capaId,
      JSON.stringify({ count: files.length, names: files.map((f) => f.name) }),
    ]
  );
  revalidatePath(`/capa/${capaId}`);
}

export async function deleteCapaEvidenceAction(formData: FormData) {
  const user = await requireUser();
  const capaId = Number(formData.get("capa_id"));
  const evidenceId = Number(formData.get("evidence_id"));
  if (
    !Number.isFinite(capaId) || capaId <= 0 ||
    !Number.isFinite(evidenceId) || evidenceId <= 0
  ) {
    throw new Error("Invalid CAPA or evidence id.");
  }
  const capa = await getCapa(capaId);
  if (!capa) throw new Error("CAPA not found.");
  // Submitted evidence is a compliance record: only the owner may remove
  // their own upload, and only while the CAPA is still with them.
  if (!canWorkOnCapa(await capaActor(user), capa)) {
    throw new Error("Evidence can only be removed by the CAPA owner while the CAPA is with them.");
  }
  await deleteCapaEvidence(evidenceId);
  revalidatePath(`/capa/${capaId}`);
}

/**
 * Owner submits the CAPA for reviewer verification. HARD requirements
 * (validated against the stored row, not the form, so they can't be
 * bypassed by skipping "Save progress"): all four completion questions
 * answered AND at least one CAPA evidence file uploaded. Status flips
 * to "submitted" and the reviewer (or compliance role) gets notified.
 */
export async function submitCapaForReviewAction(formData: FormData) {
  const user = await requireUser();
  const capaId = Number(formData.get("id"));
  if (!Number.isFinite(capaId) || capaId <= 0) throw new Error("Invalid CAPA id.");
  const capa = await getCapa(capaId);
  if (!capa) throw new Error("CAPA not found.");
  if (!canWorkOnCapa(await capaActor(user), capa)) {
    throw new Error(
      capa.assigned_to === user.id
        ? `CAPA is already ${capa.status} — it can't be resubmitted.`
        : "Only the CAPA owner (assignee) can submit for review."
    );
  }

  const missing: string[] = EXECUTION_REQUIRED_FIELDS.filter(
    (f) => !(capa[f.key] ?? "").trim()
  ).map((f) => f.label);
  const evidences = await listCapaEvidences(capaId);
  if (evidences.length === 0) {
    missing.push("At least one CAPA evidence file");
  }
  if (missing.length > 0) {
    throw new Error(
      `This CAPA isn't ready for review yet. Still missing: ${missing.join(", ")}.`
    );
  }

  // Department manager reviews first (when there is one who isn't the
  // assignee), then Compliance verifies.
  const managers = await departmentManagerIds(capa.department_id ? [capa.department_id] : []);
  const target = submitTarget(managers, capa.assigned_to);
  // Clear any previous return reason so it doesn't linger in the UI.
  await execute(
    `UPDATE corrective_actions
       SET status = $2,
           submitted_at = SYSUTCDATETIME(),
           rejection_reason = NULL
     WHERE id = $1`,
    [capaId, target]
  );

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'capa:submitted_for_review', 'capa', $3, $4)`,
    [
      user.id,
      user.email,
      capaId,
      JSON.stringify({
        from: capa.status,
        to: target,
        by_user_name: user.displayName,
        by_user_role: user.role,
      }),
    ]
  );

  await notify({
    audience:
      target === "pending_manager_review"
        ? { userIds: managers }
        : { userIds: capa.reviewer_id ? [capa.reviewer_id] : [], roles: ["compliance"] },
    actor: { id: user.id, name: user.displayName, role: user.role },
    kind: "capa:submitted_for_review",
    title:
      target === "pending_manager_review"
        ? `CAPA "${capa.title}" submitted — awaiting your review`
        : `CAPA "${capa.title}" submitted for verification`,
    body: `${user.displayName} completed the corrective action. Review the evidence and forward, close or return it.`,
    severity: "info",
    entity: { type: "capa", id: capaId, href: `/capa/${capaId}` },
  });

  revalidatePath("/capa");
  revalidatePath(`/capa/${capaId}`);
}

/**
 * Reviewer rejects a submitted CAPA. Requires a rejection reason,
 * flips status back to "rejected", stashes the reason on the CAPA so
 * the owner reads it inline, and notifies the owner.
 */
export async function rejectCapaAction(formData: FormData) {
  const user = await requireUser();
  const capaId = Number(formData.get("id"));
  const reasonRaw = (formData.get("reason") ?? "").toString().trim();
  if (!Number.isFinite(capaId) || capaId <= 0) throw new Error("Invalid CAPA id.");
  if (reasonRaw.length === 0) {
    throw new Error("A rejection reason is required so the owner knows what to fix.");
  }
  const reason = reasonRaw.slice(0, 2000);

  const capa = await getCapa(capaId);
  if (!capa) throw new Error("CAPA not found.");
  // Return for correction: the department manager (at manager review) or
  // Compliance (at verification). Never the assignee.
  const actor = await capaActor(user);
  if (!canManagerReviewCapa(actor, capa) && !canVerifyCloseCapa(actor, capa)) {
    throw new Error(
      "Only the department manager (at manager review) or Compliance (at verification) can return this CAPA."
    );
  }

  await execute(
    `UPDATE corrective_actions
       SET status = 'returned',
           rejection_reason = $2,
           submitted_at = NULL
     WHERE id = $1`,
    [capaId, reason]
  );

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'capa:returned', 'capa', $3, $4)`,
    [
      user.id,
      user.email,
      capaId,
      JSON.stringify({ from: capa.status, to: "returned", reason, by_user_name: user.displayName, by_user_role: user.role }),
    ]
  );

  if (capa.assigned_to) {
    await notify({
      audience: { userIds: [capa.assigned_to] },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "capa:returned",
      title: `CAPA "${capa.title}" was returned for correction`,
      body: `Reason: "${reason}"`,
      severity: "warning",
      entity: { type: "capa", id: capaId, href: `/capa/${capaId}` },
    });
  }
  // Silence unused-import warning for setCapaRejectionReason — kept in
  // the repository for future callers that need to null it out without
  // a status change. (The UPDATE above already writes the reason.)
  void setCapaRejectionReason;

  revalidatePath("/capa");
  revalidatePath(`/capa/${capaId}`);
}

const AssignFromFindingSchema = z.object({
  audit_id: z.coerce.number().int().positive(),
  item_id: z.coerce.number().int().positive(),
  title: z.string().trim().min(1, "Title is required"),
  severity: z.enum(["low", "medium", "high", "critical"]),
  assigned_to: z.coerce.number().int().positive(),
  reviewer_id: z.coerce.number().int().positive().optional().nullable(),
  brand_id: z.coerce.number().int().positive().optional().nullable(),
  department_id: z.coerce.number().int().positive().optional().nullable(),
  start_date: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  assignment_note: z.string().trim().optional().nullable(),
});

/**
 * Called from the "Assign CAPA" popup on the hierarchical /capa page.
 * Creates the CAPA if none exists for this (audit, item) pair,
 * otherwise updates the existing one with the new assignment metadata.
 * Fires "capa:assigned" notifications to the assignee and reviewer.
 *
 * Gated to compliance / BE / admin (assign is a reviewer prerogative), plus
 * department managers assigning within their own department (user spec
 * 2026-09-10) — verified against the audit's actual department server-side
 * via getAuditScope, never trusting the client-supplied department_id.
 *
 * Returns {ok,error} instead of throwing: a thrown Server Action error gets
 * redacted by Next.js in production into a generic digest-only message, so
 * every failure path here must return instead (see saveResponsesBulkAction
 * for the same established pattern).
 */
export async function assignCapaFromFindingAction(
  formData: FormData
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = AssignFromFindingSchema.parse({
    ...raw,
    reviewer_id: raw.reviewer_id === "" ? null : raw.reviewer_id,
    brand_id: raw.brand_id === "" ? null : raw.brand_id,
    department_id: raw.department_id === "" ? null : raw.department_id,
    start_date: raw.start_date === "" ? null : raw.start_date,
    due_date: raw.due_date === "" ? null : raw.due_date,
    assignment_note:
      raw.assignment_note === "" ? null : raw.assignment_note,
  });

  // Department is taken from the audit, never from the client.
  const auditScope = await getAuditScope(parsed.audit_id);
  const blocker = await assignBlocker(user, [auditScope?.department_id ?? null], parsed.assigned_to);
  if (blocker) return { ok: false, error: blocker };

  const { id, code, created } = await upsertCapaFromFinding({
    audit_id: parsed.audit_id,
    item_id: parsed.item_id,
    title: parsed.title,
    severity: parsed.severity,
    brand_id: parsed.brand_id,
    department_id: parsed.department_id,
    assigned_to: parsed.assigned_to,
    reviewer_id: parsed.reviewer_id,
    start_date: parsed.start_date,
    due_date: parsed.due_date,
    assignment_note: parsed.assignment_note,
    created_by: user.id,
  });

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, $3, 'capa', $4, $5)`,
    [
      user.id,
      user.email,
      created ? "capa:created_from_finding" : "capa:assigned_from_finding",
      id,
      JSON.stringify({
        audit_id: parsed.audit_id,
        item_id: parsed.item_id,
        assigned_to: parsed.assigned_to,
        reviewer_id: parsed.reviewer_id,
        severity: parsed.severity,
        by_user_name: user.displayName,
      }),
    ]
  );

  // Notify the new assignee.
  if (parsed.assigned_to !== user.id) {
    await notify({
      audience: { userIds: [parsed.assigned_to] },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "capa:assigned",
      title: `CAPA "${parsed.title}" assigned to you (${code})`,
      body:
        `Severity: ${parsed.severity}.` +
        (parsed.due_date ? ` Due ${parsed.due_date}.` : "") +
        (parsed.assignment_note
          ? ` Note: "${parsed.assignment_note}"`
          : ""),
      severity: parsed.severity === "critical" ? "critical" : "info",
      entity: { type: "capa", id, href: `/capa/${id}` },
    });
  }
  // Notify the reviewer (if any and not the actor).
  if (
    parsed.reviewer_id &&
    parsed.reviewer_id !== user.id &&
    parsed.reviewer_id !== parsed.assigned_to
  ) {
    await notify({
      audience: { userIds: [parsed.reviewer_id] },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "capa:reviewer_assigned",
      title: `You're the reviewer on CAPA ${code}`,
      body: `${user.displayName} assigned you to verify this CAPA once the fix is submitted.`,
      severity: "info",
      entity: { type: "capa", id, href: `/capa/${id}` },
    });
  }

  revalidatePath("/capa");
  revalidatePath(`/capa/${id}`);
  return { ok: true, id };
}

const AssignControlSchema = z.object({
  audit_id: z.coerce.number().int().positive(),
  control_id: z.coerce.number().int().positive().optional().nullable(),
  control_label: z.string().trim().optional().nullable(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  assigned_to: z.coerce.number().int().positive(),
  reviewer_id: z.coerce.number().int().positive().optional().nullable(),
  start_date: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  assignment_note: z.string().trim().optional().nullable(),
});

/**
 * "Assign control" button on the /capa page: one form, applied to every
 * failed finding under the control that has NO assignee yet. Findings
 * whose CAPA is already assigned to someone are left untouched — the
 * query in listBulkAssignableFindings filters them out, so a re-run
 * after a partial manual pass only fills the gaps.
 *
 * Each finding still goes through upsertCapaFromFinding, so codes,
 * status transitions and upsert semantics stay identical to the
 * per-finding flow. Notifications are collapsed into ONE summary per
 * recipient instead of one per CAPA.
 */
export async function assignControlCapasAction(
  formData: FormData
): Promise<
  { ok: true; assigned: number } | { ok: false; error: string }
> {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = AssignControlSchema.parse({
    ...raw,
    control_id: raw.control_id === "" ? null : raw.control_id,
    reviewer_id: raw.reviewer_id === "" ? null : raw.reviewer_id,
    start_date: raw.start_date === "" ? null : raw.start_date,
    due_date: raw.due_date === "" ? null : raw.due_date,
    assignment_note: raw.assignment_note === "" ? null : raw.assignment_note,
  });

  const auditScope = await getAuditScope(parsed.audit_id);

  const blocker = await assignBlocker(user, [auditScope?.department_id ?? null], parsed.assigned_to);
  if (blocker) return { ok: false, error: blocker };

  const findings = await listBulkAssignableFindings(
    parsed.audit_id,
    parsed.control_id ?? null
  );
  if (findings.length === 0) {
    return {
      ok: false,
      error:
        "Nothing to assign — every finding under this control already has an assignee.",
    };
  }

  const scope = auditScope;

  const capas: { id: number; code: string }[] = [];
  for (const f of findings) {
    const { id, code } = await upsertCapaFromFinding({
      audit_id: parsed.audit_id,
      item_id: f.item_id,
      title: f.question.slice(0, 250),
      severity: parsed.severity,
      brand_id: scope?.brand_id ?? null,
      department_id: scope?.department_id ?? null,
      assigned_to: parsed.assigned_to,
      reviewer_id: parsed.reviewer_id,
      start_date: parsed.start_date,
      due_date: parsed.due_date,
      assignment_note: parsed.assignment_note,
      created_by: user.id,
    });
    capas.push({ id, code });
  }

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'capa:bulk_assigned_from_control', 'audit', $3, $4)`,
    [
      user.id,
      user.email,
      parsed.audit_id,
      JSON.stringify({
        control_id: parsed.control_id,
        control_label: parsed.control_label,
        assigned_to: parsed.assigned_to,
        reviewer_id: parsed.reviewer_id,
        severity: parsed.severity,
        capa_count: capas.length,
        capa_ids: capas.map((c) => c.id),
        by_user_name: user.displayName,
      }),
    ]
  );

  const controlLabel = parsed.control_label || "this audit";
  const capaListHref = `/capa?audit_id=${parsed.audit_id}`;

  if (parsed.assigned_to !== user.id) {
    await notify({
      audience: { userIds: [parsed.assigned_to] },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "capa:assigned",
      title: `${capas.length} CAPA${capas.length === 1 ? "" : "s"} assigned to you — ${controlLabel}`,
      body:
        `Severity: ${parsed.severity}.` +
        (parsed.due_date ? ` Due ${parsed.due_date}.` : "") +
        (parsed.assignment_note ? ` Note: "${parsed.assignment_note}"` : "") +
        ` (${capas.map((c) => c.code).join(", ")})`,
      severity: parsed.severity === "critical" ? "critical" : "info",
      entity: { type: "audit", id: parsed.audit_id, href: capaListHref },
    });
  }
  if (
    parsed.reviewer_id &&
    parsed.reviewer_id !== user.id &&
    parsed.reviewer_id !== parsed.assigned_to
  ) {
    await notify({
      audience: { userIds: [parsed.reviewer_id] },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "capa:reviewer_assigned",
      title: `You're the reviewer on ${capas.length} CAPA${capas.length === 1 ? "" : "s"} — ${controlLabel}`,
      body: `${user.displayName} assigned you to verify these CAPAs once the fixes are submitted.`,
      severity: "info",
      entity: { type: "audit", id: parsed.audit_id, href: capaListHref },
    });
  }

  revalidatePath("/capa");
  return { ok: true, assigned: capas.length };
}

const BulkSelectionItemSchema = z.object({
  audit_id: z.number().int().positive(),
  item_id: z.number().int().positive(),
  title: z.string().trim().min(1),
});

const AssignBulkSchema = z.object({
  items: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  assigned_to: z.coerce.number().int().positive(),
  reviewer_id: z.coerce.number().int().positive().optional().nullable(),
  start_date: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  assignment_note: z.string().trim().optional().nullable(),
});

/**
 * "Assign selected" button on the /capa page: the user hand-picks any mix
 * of findings (via checkboxes, possibly spanning several audits/controls)
 * and assigns them all at once with one set of choices. Unlike
 * assignControlCapasAction (which grabs every unassigned finding under ONE
 * control), the finding list here is exactly what the client selected —
 * sent as a JSON array of {audit_id, item_id, title} in the `items` field.
 *
 * Gated the same as the other two assign actions: compliance / BE / admin,
 * plus a department manager whose own department covers EVERY selected
 * finding's audit (verified server-side via getAuditScopesMap against
 * getUserScope — never trusting the client). Fails closed: if even one
 * selected finding is outside the department manager's scope, the whole
 * batch is rejected rather than silently dropping it.
 */
export async function assignBulkCapasAction(
  formData: FormData
): Promise<{ ok: true; assigned: number } | { ok: false; error: string }> {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = AssignBulkSchema.parse({
    ...raw,
    reviewer_id: raw.reviewer_id === "" ? null : raw.reviewer_id,
    start_date: raw.start_date === "" ? null : raw.start_date,
    due_date: raw.due_date === "" ? null : raw.due_date,
    assignment_note: raw.assignment_note === "" ? null : raw.assignment_note,
  });

  let itemsRaw: unknown;
  try {
    itemsRaw = JSON.parse(parsed.items);
  } catch {
    return { ok: false, error: "Invalid selection payload." };
  }
  const itemsResult = z.array(BulkSelectionItemSchema).safeParse(itemsRaw);
  if (!itemsResult.success || itemsResult.data.length === 0) {
    return { ok: false, error: "No findings selected." };
  }
  const items = itemsResult.data;

  const auditIds = items.map((i) => i.audit_id);
  const scopesByAudit = await getAuditScopesMap(auditIds);

  const blocker = await assignBlocker(
    user,
    items.map((i) => scopesByAudit.get(i.audit_id)?.department_id ?? null),
    parsed.assigned_to
  );
  if (blocker) return { ok: false, error: blocker };

  const capas: { id: number; code: string }[] = [];
  for (const item of items) {
    const scope = scopesByAudit.get(item.audit_id);
    const { id, code } = await upsertCapaFromFinding({
      audit_id: item.audit_id,
      item_id: item.item_id,
      title: item.title.slice(0, 250),
      severity: parsed.severity,
      brand_id: scope?.brand_id ?? null,
      department_id: scope?.department_id ?? null,
      assigned_to: parsed.assigned_to,
      reviewer_id: parsed.reviewer_id,
      start_date: parsed.start_date,
      due_date: parsed.due_date,
      assignment_note: parsed.assignment_note,
      created_by: user.id,
    });
    capas.push({ id, code });
  }

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'capa:bulk_assigned_from_selection', 'capa', $3, $4)`,
    [
      user.id,
      user.email,
      capas[0]?.id ?? null,
      JSON.stringify({
        assigned_to: parsed.assigned_to,
        reviewer_id: parsed.reviewer_id,
        severity: parsed.severity,
        capa_count: capas.length,
        capa_ids: capas.map((c) => c.id),
        audit_ids: [...new Set(auditIds)],
        by_user_name: user.displayName,
      }),
    ]
  );

  const capaListHref = `/capa`;

  if (parsed.assigned_to !== user.id) {
    await notify({
      audience: { userIds: [parsed.assigned_to] },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "capa:assigned",
      title: `${capas.length} CAPA${capas.length === 1 ? "" : "s"} assigned to you`,
      body:
        `Severity: ${parsed.severity}.` +
        (parsed.due_date ? ` Due ${parsed.due_date}.` : "") +
        (parsed.assignment_note ? ` Note: "${parsed.assignment_note}"` : "") +
        ` (${capas.map((c) => c.code).join(", ")})`,
      severity: parsed.severity === "critical" ? "critical" : "info",
      entity: { type: "capa", id: capas[0]?.id ?? 0, href: capaListHref },
    });
  }
  if (
    parsed.reviewer_id &&
    parsed.reviewer_id !== user.id &&
    parsed.reviewer_id !== parsed.assigned_to
  ) {
    await notify({
      audience: { userIds: [parsed.reviewer_id] },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "capa:reviewer_assigned",
      title: `You're the reviewer on ${capas.length} CAPA${capas.length === 1 ? "" : "s"}`,
      body: `${user.displayName} assigned you to verify these CAPAs once the fixes are submitted.`,
      severity: "info",
      entity: { type: "capa", id: capas[0]?.id ?? 0, href: capaListHref },
    });
  }

  revalidatePath("/capa");
  return { ok: true, assigned: capas.length };
}

const AssignSchema = z.object({
  id: z.coerce.number().int().positive(),
  assigned_to: z.coerce.number().int().positive().optional().nullable(),
});

/**
 * Reassign a CAPA after creation. Allowed for the CAPA creator, the
 * compliance/BE/admin roles, and the previous assignee (so they can
 * hand it off). Everyone else gets blocked.
 */
export async function assignCapaAction(formData: FormData) {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = AssignSchema.parse({
    id: raw.id,
    assigned_to: raw.assigned_to === "" ? null : raw.assigned_to,
  });

  const before = await getCapa(parsed.id);
  if (!before) throw new Error("CAPA not found.");

  if (isCapaClosed(before.status)) throw new Error("This CAPA is closed — the assignment is final.");
  const blocker = await assignBlocker(user, [before.department_id], parsed.assigned_to);
  if (blocker) throw new Error(blocker);

  await setCapaAssignee(parsed.id, parsed.assigned_to ?? null);
  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'capa:reassigned', 'capa', $3, $4)`,
    [
      user.id,
      user.email,
      parsed.id,
      JSON.stringify({
        from_user_id: before.assigned_to,
        to_user_id: parsed.assigned_to ?? null,
        by_user_name: user.displayName,
      }),
    ]
  );

  // Notify the new assignee they've picked it up (only when there IS one).
  if (parsed.assigned_to && parsed.assigned_to !== user.id) {
    await notify({
      audience: { userIds: [parsed.assigned_to] },
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: "capa:reassigned",
      title: `CAPA "${before.title}" assigned to you`,
      body: `${user.displayName} assigned this CAPA to you. Severity: ${before.severity}.`,
      severity: before.severity === "critical" ? "critical" : "info",
      entity: { type: "capa", id: parsed.id, href: `/capa/${parsed.id}` },
    });
  }

  revalidatePath("/capa");
  revalidatePath(`/capa/${parsed.id}`);
}

export async function transitionCapaAction(formData: FormData) {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = TransitionSchema.parse({
    ...raw,
    resolution_note: raw.resolution_note === "" ? null : raw.resolution_note,
    evidence_url: raw.evidence_url === "" ? null : raw.evidence_url,
  });

  const before = await getCapa(parsed.id);
  if (!before) throw new Error("CAPA not found.");

  // Manager forwards to Compliance; Compliance verifies and closes.
  // (Returns go through rejectCapaAction.) Never the assignee.
  const next = parsed.status;
  const actor = await capaActor(user);
  if (next === "pending_compliance_verification" && !canManagerReviewCapa(actor, before)) {
    throw new Error("Only the department manager can forward this CAPA, and only while it awaits manager review.");
  }
  if (next === "closed" && !canVerifyCloseCapa(actor, before)) {
    throw new Error("Only Compliance can verify and close this CAPA, and only once it awaits verification.");
  }

  await transitionCapa(parsed.id, next, {
    resolution_note: parsed.resolution_note ?? null,
    evidence_url: parsed.evidence_url ?? null,
    verified_by: next === "closed" ? user.id : null,
  });

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, $3, 'capa', $4, $5)`,
    [
      user.id,
      user.email,
      `capa:${next}`,
      parsed.id,
      JSON.stringify({
        from: before.status,
        to: next,
        note: parsed.resolution_note ?? null,
        by_user_name: user.displayName,
        by_user_role: user.role,
      }),
    ]
  );

  // Send the right notification per transition.
  const assignee = before.assigned_to ? [before.assigned_to] : [];
  const creator = before.created_by ? [before.created_by] : [];
  const plans: Record<
    string,
    { audience: { userIds?: number[]; roles?: string[] }; title: string; severity: "info" | "success" | "warning" | "critical" }
  > = {
    pending_compliance_verification: {
      audience: { roles: ["compliance"], userIds: [...assignee, ...(before.reviewer_id ? [before.reviewer_id] : [])] },
      title: `CAPA "${before.title}" reviewed by the department manager — awaiting Compliance verification`,
      severity: "info",
    },
    closed: {
      audience: { userIds: [...assignee, ...creator] },
      title: `CAPA "${before.title}" was verified and formally closed ✅`,
      severity: "success",
    },
  };
  const plan = plans[next];
  if (plan) {
    await notify({
      audience: plan.audience,
      actor: { id: user.id, name: user.displayName, role: user.role },
      kind: `capa:${next}`,
      title: plan.title,
      body: parsed.resolution_note ? `Note: "${parsed.resolution_note}"` : null,
      severity: plan.severity,
      entity: { type: "capa", id: parsed.id, href: `/capa/${parsed.id}` },
    });
  }

  revalidatePath("/capa");
  revalidatePath(`/capa/${parsed.id}`);
}
