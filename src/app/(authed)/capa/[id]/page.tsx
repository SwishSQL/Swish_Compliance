import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, canDeleteOrArchive } from "@/lib/auth/guard";
import DeleteEntityButton from "@/features/admin/delete/DeleteEntityButton";
import Workspace from "@/features/shell/Workspace";
import {
  getCapa,
  getCapaAuditorContext,
  listCapaEvidences,
} from "@/features/capa/repository";
import {
  transitionCapaAction,
  saveCapaExecutionAction,
  submitCapaForReviewAction,
  rejectCapaAction,
} from "@/features/capa/actions";
import CapaEvidenceUploader from "@/features/capa/CapaEvidenceUploader";
import {
  CAPA_STATUS_LABEL,
  CAPA_STATUS_TONE,
  SEVERITY_LABEL,
  SEVERITY_TONE,
} from "@/features/capa/types";
import {
  canWorkOnCapa,
  canManagerReviewCapa,
  canVerifyCloseCapa,
  canViewCapa,
} from "@/features/capa/workflow";
import { getUserScope } from "@/lib/auth/access";

/**
 * CAPA detail page — role-aware. The owner sees an execution-first
 * layout (root cause + actions + CAPA-side evidence upload). The
 * reviewer sees a comparison layout (Auditor evidence next to CAPA
 * evidence + Verify / Close / Reject). Everyone sees the read-only
 * "Source information" pane so the CAPA reads like a self-contained
 * work order.
 */
export default async function CapaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id: idStr } = await params;
  const id = Number(idStr);

  const capa = await getCapa(id);
  if (!capa) notFound();
  const scope = await getUserScope(user.id, user);
  const actor = { id: user.id, permissions: user.permissions, departmentIds: scope.departmentIds };
  // Record-level access: a URL to another department's CAPA is a 404.
  if (!canViewCapa({ ...actor, fullScope: scope.full }, capa)) notFound();

  const [auditor, evidences] = await Promise.all([
    getCapaAuditorContext(id),
    listCapaEvidences(id),
  ]);

  // docs/RBAC.md §7: owner works & submits; the department manager
  // reviews; Compliance verifies and closes. Nobody reviews their own CAPA.
  const isOwner = capa.assigned_to === user.id;
  const isLocked = capa.status === "closed" || capa.status === "verified";
  const canEditExecution = canWorkOnCapa(actor, capa);
  const canSubmit = canEditExecution;
  const managerReview = canManagerReviewCapa(actor, capa);
  const complianceReview = canVerifyCloseCapa(actor, capa);
  const canReview = managerReview || complianceReview;

  return (
    <Workspace
      section="Assurance / Corrective Actions"
      subtitle={capa.title}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* ─── Header ─── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
            {capa.code}
          </span>
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${CAPA_STATUS_TONE[capa.status]}`}
          >
            {CAPA_STATUS_LABEL[capa.status]}
          </span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${SEVERITY_TONE[capa.severity]}`}
          >
            {SEVERITY_LABEL[capa.severity]} severity
          </span>
          {isOwner && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
              Assigned to you
            </span>
          )}
          {canDeleteOrArchive(user) && (
            <span className="ml-auto">
              <DeleteEntityButton entityType="capa" entityId={capa.id} label="Corrective action" />
            </span>
          )}
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-3">{capa.title}</h2>

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
          <Field label="Assigned to">
            {capa.assigned_to_name ?? "— Not assigned —"}
          </Field>
          <Field label="Reviewer">{capa.reviewer_name ?? "—"}</Field>
          <Field label="Start date">
            {capa.start_date
              ? new Date(capa.start_date).toLocaleDateString()
              : "—"}
          </Field>
          <Field label="Due date">
            {capa.due_date
              ? new Date(capa.due_date).toLocaleDateString()
              : "—"}
          </Field>
          {capa.source_audit_id && (
            <Field label="Source">
              <Link
                href={`/audits/${capa.source_audit_id}`}
                className="text-brand-700 hover:underline"
              >
                {auditor?.framework_name ?? "View source audit"} →
              </Link>
            </Field>
          )}
          <Field label="Location">{auditor?.location ?? "—"}</Field>
          <Field label="Created by">{capa.created_by_name ?? "—"}</Field>
          {capa.verified_by_name && (
            <Field label="Verified by">{capa.verified_by_name}</Field>
          )}
        </dl>

        {capa.assignment_note && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
            <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold mb-1">
              Assignment note
            </div>
            <div className="text-amber-900">{capa.assignment_note}</div>
          </div>
        )}

        {/* Rejection reason — surfaced prominently for the owner. */}
        {capa.status === "rejected" && capa.rejection_reason && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-[10px] uppercase tracking-wider text-red-700 font-semibold mb-1">
              Reviewer rejected this CAPA
            </div>
            <div className="text-sm text-red-900 italic">
              &ldquo;{capa.rejection_reason}&rdquo;
            </div>
            <div className="text-[11px] text-red-700 mt-2">
              Update your work below and resubmit for review.
            </div>
          </div>
        )}
      </div>

      {/* ─── Source information (from the audit) ─── */}
      {auditor && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Source information
          </h3>
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-sm mb-4">
            <Field label="Framework">
              {auditor.framework_code
                ? `${auditor.framework_code} · ${auditor.framework_name ?? ""}`
                : "—"}
            </Field>
            <Field label="Control">
              {auditor.control_code
                ? `${auditor.control_code} · ${auditor.control_name ?? ""}`
                : "—"}
            </Field>
            <Field label="Test">
              {auditor.test_code
                ? `${auditor.test_code} · ${auditor.test_name ?? ""}`
                : "—"}
            </Field>
            <Field label="Achievement">
              {auditor.performance_percent != null ? (
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800"
                  title={`Yes ${auditor.yes_percent ?? 0}% · No ${auditor.no_percent ?? 0}% · N/A ${auditor.na_percent ?? 0}%`}
                >
                  {auditor.performance_percent}% achieved
                </span>
              ) : (
                "—"
              )}
              {(auditor.na_percent ?? 0) > 0 && (
                <span className="ml-2 text-xs text-gray-400">
                  ({auditor.na_percent}% N/A excluded)
                </span>
              )}
            </Field>
          </dl>

          <div className="border-t border-gray-100 pt-4 space-y-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
                Question
              </div>
              <div className="text-sm text-gray-900">{auditor.question}</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
                  Auditor answer
                </div>
                <div className="text-sm">
                  {auditor.auditor_response === "fail" ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-300">
                      No / Fail
                    </span>
                  ) : (
                    <span className="text-gray-500">
                      {auditor.auditor_response ?? "—"}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
                  Auditor evidence (view only)
                </div>
                {auditor.auditor_evidence_url ? (
                  <a
                    href={auditor.auditor_evidence_url}
                    target="_blank"
                    rel="noreferrer"
                    download={auditor.auditor_evidence_name ?? undefined}
                    className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline"
                  >
                    📎 {auditor.auditor_evidence_name ?? "View attachment"}
                  </a>
                ) : (
                  <span className="text-sm text-gray-400">—</span>
                )}
              </div>
            </div>
            {auditor.auditor_note && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
                  Auditor note
                </div>
                <div className="text-sm text-gray-700 italic">
                  &ldquo;{auditor.auditor_note}&rdquo;
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Owner completion fields ─── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
            Owner completion fields
          </h3>
          {!canEditExecution && (
            <span className="text-[11px] text-gray-500">
              {isLocked
                ? "Locked — CAPA is complete."
                : "Read-only — only the assignee can edit."}
            </span>
          )}
        </div>

        <form
          action={saveCapaExecutionAction}
          className="space-y-4"
          id="execution-form"
        >
          <input type="hidden" name="id" value={capa.id} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Root cause <span className="text-red-500">*</span>
              </label>
              <textarea
                name="root_cause"
                defaultValue={capa.root_cause ?? ""}
                disabled={!canEditExecution}
                required
                rows={3}
                placeholder="Explain why this failure happened — the underlying reason, not just the symptom."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Corrective action taken <span className="text-red-500">*</span>
              </label>
              <textarea
                name="corrective_action_taken"
                defaultValue={capa.corrective_action_taken ?? ""}
                disabled={!canEditExecution}
                required
                rows={3}
                placeholder="Describe exactly what was done to fix this specific finding."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Preventive action taken <span className="text-red-500">*</span>
              </label>
              <textarea
                name="preventive_action_taken"
                defaultValue={capa.preventive_action_taken ?? ""}
                disabled={!canEditExecution}
                required
                rows={3}
                placeholder="Describe what was changed so this failure cannot happen again."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Completion note <span className="text-red-500">*</span>
              </label>
              <textarea
                name="completion_note"
                defaultValue={capa.completion_note ?? ""}
                disabled={!canEditExecution}
                required
                rows={3}
                placeholder="Summarize the outcome and anything else the reviewer should know."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
              />
            </div>
          </div>

          {canEditExecution && (
            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Save progress
              </button>
              <p className="text-[11px] text-gray-500">
                All questions marked <span className="text-red-500">*</span>{" "}
                are required. Saving does not change the CAPA status.
              </p>
            </div>
          )}
        </form>

        {/* CAPA evidence — separate from the execution form so the
            uploader can act on its own without saving the textareas. */}
        <div className="mt-6 pt-5 border-t border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-0.5">
                CAPA evidence (proof the fix happened)
              </div>
              <p className="text-[11px] text-gray-500">
                Different from the auditor&rsquo;s evidence above. Upload
                photos / documents that prove the corrective action was
                implemented.
              </p>
            </div>
            <span className="text-xs text-gray-500">
              {evidences.length} file{evidences.length === 1 ? "" : "s"}
            </span>
          </div>
          <CapaEvidenceUploader
            capaId={capa.id}
            evidences={evidences}
            canEdit={canEditExecution}
          />
        </div>
      </div>

      {/* ─── Owner: submit for review ─── */}
      {canSubmit &&
        (() => {
          // Mirror of the server-side gate in submitCapaForReviewAction:
          // all four completion questions answered on the STORED row, and
          // at least one CAPA evidence file. The action re-checks anyway;
          // this just tells the owner what's left before they try.
          const missing: string[] = [];
          if (!capa.root_cause?.trim()) missing.push("Root cause");
          if (!capa.corrective_action_taken?.trim())
            missing.push("Corrective action taken");
          if (!capa.preventive_action_taken?.trim())
            missing.push("Preventive action taken");
          if (!capa.completion_note?.trim()) missing.push("Completion note");
          if (evidences.length === 0)
            missing.push("At least one CAPA evidence file");

          if (missing.length > 0) {
            return (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 mb-4">
                <h3 className="text-sm font-semibold text-amber-800 uppercase tracking-wider mb-2">
                  Not ready for review yet
                </h3>
                <p className="text-xs text-amber-800 mb-2">
                  Submitting for review unlocks once every required question
                  is answered (and saved) and the evidence is uploaded. Still
                  missing:
                </p>
                <ul className="text-xs text-amber-900 list-disc list-inside space-y-0.5">
                  {missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            );
          }
          return (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 mb-4">
              <h3 className="text-sm font-semibold text-emerald-800 uppercase tracking-wider mb-2">
                Ready to hand it off?
              </h3>
              <p className="text-xs text-emerald-800 mb-4">
                All required questions are answered and the evidence is
                uploaded. The reviewer will get a notification and can
                approve or reject with feedback.
              </p>
              <form action={submitCapaForReviewAction}>
                <input type="hidden" name="id" value={capa.id} />
                <button
                  type="submit"
                  className="bg-brand-700 hover:bg-brand-800 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
                >
                  Submit for review
                </button>
              </form>
            </div>
          );
        })()}

      {/* ─── Reviewer: Verify / Close / Reject ─── */}
      {canReview && (
        <div className="bg-white border border-brand-300 rounded-2xl p-6 mb-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
            {managerReview ? "Department manager review" : "Compliance verification"}
          </h3>
          <p className="text-xs text-gray-600">
            Compare the auditor&rsquo;s evidence above with the CAPA evidence
            below. Approve if the fix is complete; reject with a clear reason
            if it isn&rsquo;t.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <form action={transitionCapaAction}>
              <input type="hidden" name="id" value={capa.id} />
              <input
                type="hidden"
                name="status"
                value={managerReview ? "pending_compliance_verification" : "closed"}
              />
              <textarea
                name="resolution_note"
                placeholder="Verification note (optional)"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg mb-2"
              />
              <button
                type="submit"
                className="w-full bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-semibold"
              >
                {managerReview ? "✓ Forward to Compliance" : "✓ Verify & formally close"}
              </button>
            </form>
            <form action={rejectCapaAction}>
              <input type="hidden" name="id" value={capa.id} />
              <textarea
                name="reason"
                placeholder="Reason (required) — tell the owner what to correct"
                required
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg mb-2"
              />
              <button
                type="submit"
                className="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-semibold"
              >
                ✕ Return for correction
              </button>
            </form>
          </div>
        </div>
      )}

      <Link
        href="/capa"
        className="inline-block mt-2 text-sm text-gray-500 hover:text-gray-700"
      >
        ← Back to list
      </Link>
    </Workspace>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-gray-500 mb-0.5">
        {label}
      </dt>
      <dd className="text-gray-900">{children}</dd>
    </div>
  );
}
