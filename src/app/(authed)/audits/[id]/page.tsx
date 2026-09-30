import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, canDeleteOrArchive } from "@/lib/auth/guard";
import DeleteEntityButton from "@/features/admin/delete/DeleteEntityButton";
import Workspace from "@/features/shell/Workspace";
import {
  getAudit,
  listAuditScopeItems,
  listAuditAttachments,
} from "@/features/audits/repository";
import {
  closeAuditAction,
  reopenAuditAction,
  cancelAuditAction,
} from "@/features/audits/actions";
import AuditQuestionRow from "@/features/audits/AuditQuestionRow";
import AuditAttachments from "@/features/audits/AuditAttachments";
import { AuditAnswersProvider } from "@/features/audits/AuditAnswersContext";
import AuditSaveAllBar from "@/features/audits/AuditSaveAllBar";
import AuditSubmitSection from "@/features/audits/AuditSubmitSection";
import {
  AUDIT_STATUS_LABEL,
  AUDIT_STATUS_TONE,
} from "@/features/audits/types";
import { FINDING_THRESHOLD_PERCENT } from "@/features/audits/types";
import type { AuditScopeRow } from "@/features/audits/types";

/** How the audit was scoped (migration 042). Legacy audits have no value. */
const SCOPE_TYPE_LABEL: Record<string, string> = {
  full_sop: "Full SOP Audit",
  framework: "Framework Audit",
  domain: "Domain Audit",
};

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id: idStr } = await params;
  const id = Number(idStr);
  const audit = await getAudit(id);
  if (!audit) notFound();

  // Visibility gate: creator, assignee, admin, AND the reviewer roles
  // (compliance / business_excellence / ceo). Reviewers get notified
  // about submissions and closures; they need to OPEN the audit to act
  // on the notification. Edit rights stay narrower — only
  // creator/assignee/admin can record/edit responses (see below).
  const isOwner = audit.auditor_id === user.id;
  const isAssignee = audit.assigned_to === user.id;
  const isAdmin = user.role === "admin";
  const isReviewer =
    user.role === "compliance" ||
    user.role === "business_excellence" ||
    user.role === "ceo";
  if (!isOwner && !isAssignee && !isAdmin && !isReviewer) notFound();

  const [scopeRows, attachments] = await Promise.all([
    listAuditScopeItems(id),
    listAuditAttachments(id),
  ]);

  // Editing rules: creator + assignee + admin can edit; never edit a
  // closed audit. Reviewers see the audit read-only — the radio buttons
  // and Save controls in AuditQuestionRow are disabled for them.
  const isClosed = audit.status === "closed";
  const canEdit = !isClosed && (isOwner || isAssignee || isAdmin);
  const isOpen = audit.status === "in_progress" && canEdit;

  // Group scope rows: test → template → items. Same item can appear under
  // multiple tests on purpose — the auditor sees the question in the
  // context of each test it belongs to.
  const grouped = groupByTestAndTemplate(scopeRows);

  // Progress is computed over UNIQUE item ids (a question that appears
  // under three tests is still one answer in the underlying response row).
  const uniqueAnswered = new Set(
    scopeRows.filter((r) => r.response).map((r) => r.item_id)
  ).size;
  const uniqueTotal = new Set(scopeRows.map((r) => r.item_id)).size;
  // A "finding" is any applicable answer under the threshold, not just an
  // outright No, and not one that was entirely N-A (migration 054).
  const uniqueFailed = new Set(
    scopeRows
      .filter((r) => {
        const applicable = (r.yes_percent ?? 0) + (r.no_percent ?? 0);
        if (applicable === 0) return false;
        return ((r.yes_percent ?? 0) / applicable) * 100 < FINDING_THRESHOLD_PERCENT;
      })
      .map((r) => r.item_id)
  ).size;

  // Seed for the shared answer state — one entry per DISTINCT item, for the
  // same reason the progress counters dedupe: audit_responses is unique on
  // (audit_id, item_id), so a question shown under three tests is still a
  // single answer. Feeding duplicates in would make the "answered X of Y"
  // counter overcount.
  const answerSeed = [
    ...new Map(
      scopeRows.map((r) => [
        r.item_id,
        {
          itemId: r.item_id,
          response: r.response as "pass" | "fail" | "na" | null,
          yesPercent: r.yes_percent,
          noPercent: r.no_percent,
          naPercent: r.na_percent,
          notes: r.notes,
        },
      ])
    ).values(),
  ];

  const auditFallbackLabel = `Audit — ${audit.department_name ?? "Unscoped"} (${new Date(audit.audit_date).toLocaleDateString()})`;
  const headerTitle = audit.template_name
    ? `${audit.template_name} — ${audit.department_name ?? "Unscoped"}`
    : auditFallbackLabel;

  return (
    <Workspace
      section="Assurance / Audits"
      subtitle={headerTitle}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* ─── Header card ─── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${AUDIT_STATUS_TONE[audit.status]}`}
              >
                {AUDIT_STATUS_LABEL[audit.status]}
              </span>
              <span className="text-xs text-gray-500">
                {new Date(audit.audit_date).toLocaleDateString()}
              </span>
              {audit.template_category && (
                <span className="text-xs text-brand-700">{audit.template_category}</span>
              )}
            </div>

            {/* Scope chain (biggest → smallest). Renders even when some  */}
            {/* levels are missing on legacy audits — the empty ones show */}
            {/* a dash.                                                   */}
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-2">
              Audit scope
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <Field label={audit.policy_ids.length > 1 ? "Policies / SOPs" : "Policy / SOP"}>
                {audit.policy_ids.length > 1 ? (
                  <span className="flex flex-wrap gap-x-1.5 gap-y-1">
                    {audit.policy_ids.map((id, i) => (
                      <Link
                        key={id}
                        href={`/sops/${id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {audit.policy_titles[i]}
                        {i < audit.policy_ids.length - 1 ? "," : ""}
                      </Link>
                    ))}
                  </span>
                ) : audit.policy_id ? (
                  <Link
                    href={`/sops/${audit.policy_id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {audit.policy_code ? `${audit.policy_code} · ` : ""}
                    {audit.policy_title}
                  </Link>
                ) : "—"}
              </Field>
              <Field label="Scope type">
                {audit.scope_type ? SCOPE_TYPE_LABEL[audit.scope_type] ?? audit.scope_type : "—"}
              </Field>
              <Field label="Domain">
                {audit.domain_id ? (
                  <Link
                    href={`/domains/${audit.domain_id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {audit.domain_name}
                  </Link>
                ) : "—"}
              </Field>
              <Field label="Framework">
                {audit.framework_id ? (
                  <Link
                    href={`/frameworks/${audit.framework_id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {audit.framework_code} · {audit.framework_name}
                  </Link>
                ) : "—"}
              </Field>
              <Field label="Control">
                {audit.control_id ? (
                  <Link
                    href={`/controls/${audit.control_id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {audit.control_code ? `${audit.control_code} · ` : ""}
                    {audit.control_name}
                  </Link>
                ) : "—"}
              </Field>
              <Field label="Tests">
                {grouped.length > 0
                  ? `${grouped.length} test${grouped.length === 1 ? "" : "s"}`
                  : "—"}
              </Field>
            </div>

            {/* Operational + ownership row */}
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-2">
              Context & ownership
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Field label="Brand">{audit.brand_name ?? "—"}</Field>
              <Field label="Department">{audit.department_name ?? "—"}</Field>
              <Field label="Location">{audit.location ?? "—"}</Field>
              <Field label="Auditor (creator)">{audit.auditor_name ?? "—"}</Field>
              <Field label="Assigned to">
                {audit.assigned_to_name ?? (
                  <span className="text-gray-400">No one yet</span>
                )}
              </Field>
              <Field label="Start at">
                {audit.start_at
                  ? new Date(audit.start_at).toLocaleString()
                  : "—"}
              </Field>
              <Field label="End at">
                {audit.end_at ? new Date(audit.end_at).toLocaleString() : "—"}
              </Field>
              <Field label="Auditee (dept. rep)">
                {audit.auditee_name ?? "—"}
              </Field>
              <Field label="Reviewer / approver">
                {audit.reviewer_name ?? "—"}
              </Field>
            </div>

            {(audit.objective || audit.notes) && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {audit.objective && (
                  <Field label="Objective">{audit.objective}</Field>
                )}
                {audit.notes && <Field label="Notes">{audit.notes}</Field>}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-3 shrink-0">
            {canDeleteOrArchive(user.role) && (
              <DeleteEntityButton entityType="audit" entityId={audit.id} label="Audit" />
            )}
            {audit.score !== null && (
              <div className="text-right">
              <div
                className={`text-4xl font-bold ${
                  Number(audit.score) >= 90
                    ? "text-emerald-600"
                    : Number(audit.score) >= 70
                    ? "text-amber-600"
                    : "text-red-600"
                }`}
              >
                {Number(audit.score).toFixed(1)}%
              </div>
              <div className="text-xs uppercase tracking-wider text-gray-500">
                Score
              </div>
              {audit.critical_failed > 0 && (
                <div className="text-xs text-red-700 mt-1 font-medium">
                  {audit.critical_failed} critical fail
                  {audit.critical_failed > 1 ? "s" : ""}
                </div>
              )}
              </div>
            )}
          </div>
        </div>

        <div className="text-xs text-gray-500 pt-3 border-t border-gray-100">
          {isOpen
            ? `Answered ${uniqueAnswered} of ${uniqueTotal} unique items${
                uniqueFailed > 0
                  ? ` — ${uniqueFailed} below ${FINDING_THRESHOLD_PERCENT}%`
                  : ""
              }`
            : audit.summary
            ? (
              <span>
                <span className="font-medium text-gray-700">Summary:</span>{" "}
                {audit.summary}
              </span>
            )
            : "Submitted with no summary."}
        </div>
      </div>

      {/* Edit-rights notice */}
      {isClosed && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
          <span className="text-xl leading-none">🔒</span>
          <div className="text-sm text-emerald-900">
            <div className="font-semibold mb-0.5">This audit is closed</div>
            <div className="text-xs text-emerald-800">
              No further changes are allowed by any user.
            </div>
          </div>
        </div>
      )}
      {/* Reviewer view: compliance / BE / CEO landed here from a
          notification but can't edit responses. We tell them why
          (they're not the auditor or assignee) so they don't go
          hunting for missing Save buttons. */}
      {!isClosed && !canEdit && isReviewer && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
          <span className="text-xl leading-none">👁️</span>
          <div className="text-sm text-amber-900">
            <div className="font-semibold mb-0.5">Read-only view</div>
            <div className="text-xs text-amber-800">
              You can review this audit but only the auditor who created it
              {audit.auditor_name ? <> ({audit.auditor_name})</> : null}
              {audit.assigned_to_name ? <>, the user it&rsquo;s assigned to ({audit.assigned_to_name}),</> : null} or an admin can record responses.
            </div>
          </div>
        </div>
      )}

      {/* ─── Tests → Checklists → Questions ───
          Everything from here down shares one AuditAnswersProvider so a
          single "Save all answers" bar (and Submit) can write every
          answer at once, instead of a Save per question. */}
      <AuditAnswersProvider
        auditId={audit.id}
        canEdit={isOpen}
        initial={answerSeed}
      >
      {grouped.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center text-gray-400">
          No tests linked to this audit. Pick tests when creating the audit
          so the checklists appear here.
        </div>
      ) : (
        <div className="space-y-3 mb-4">
          {grouped.map((test) => (
            <div
              key={test.test_id}
              className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
            >
              {/* Test header */}
              <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
                <div className="flex items-center gap-3">
                  {test.test_code && (
                    <span className="font-mono text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                      {test.test_code}
                    </span>
                  )}
                  <h3 className="text-sm font-semibold text-gray-800">
                    {test.test_name}
                  </h3>
                  <span className="text-xs text-gray-500 ml-auto">
                    {test.templates.length} checklist
                    {test.templates.length === 1 ? "" : "s"} ·{" "}
                    {test.templates.reduce(
                      (acc, t) => acc + t.items.length,
                      0
                    )}{" "}
                    question
                    {test.templates.reduce(
                      (acc, t) => acc + t.items.length,
                      0
                    ) === 1
                      ? ""
                      : "s"}
                  </span>
                </div>
              </div>

              {/* Each checklist is a <details> so the user clicks to expand */}
              {test.templates.map((tpl) => (
                <details
                  key={`${test.test_id}-${tpl.template_id}`}
                  className="group border-b border-gray-100 last:border-b-0"
                >
                  <summary className="px-5 py-3 cursor-pointer flex items-center gap-3 hover:bg-gray-50">
                    <span className="text-gray-400 group-open:rotate-90 transition-transform">
                      ▶
                    </span>
                    <span className="text-sm font-medium text-gray-800">
                      {tpl.template_name}
                    </span>
                    {tpl.template_code && (
                      <span className="font-mono text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                        {tpl.template_code}
                      </span>
                    )}
                    <span className="text-xs text-gray-500 ml-auto">
                      {tpl.items.length} question
                      {tpl.items.length === 1 ? "" : "s"}
                    </span>
                  </summary>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 text-[10px] uppercase tracking-wider">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium w-12">
                          #
                        </th>
                        <th className="text-left px-3 py-2 font-medium">
                          Question
                        </th>
                        <th className="text-left px-3 py-2 font-medium w-16">
                          Weight
                        </th>
                        <th className="text-left px-3 py-2 font-medium">
                          Answer
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {tpl.items.map((item, idx) => (
                        <AuditQuestionRow
                          key={`${test.test_id}-${item.item_id}`}
                          itemId={item.item_id}
                          question={item.question}
                          weight={item.weight}
                          isCritical={item.is_critical}
                          itemNo={idx + 1}
                        />
                      ))}
                    </tbody>
                  </table>
                </details>
              ))}
            </div>
          ))}

          {/* The one Save for every question above. */}
          <AuditSaveAllBar />
        </div>
      )}

      {/* ─── Actions ─── */}
      {isOpen && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
          <h3 className="text-sm font-semibold text-gray-700">Submit audit</h3>

          {/* Multi-file attachments — sits ABOVE the form so files persist
              even if the auditor doesn't submit yet. AuditAttachments owns
              its own server actions; the Submit form below stays isolated. */}
          <AuditAttachments
            auditId={audit.id}
            attachments={attachments}
            canEdit={canEdit}
          />

          {/* Submit flushes any unsaved answers first — see
              AuditSubmitSection. */}
          <AuditSubmitSection
            auditId={audit.id}
            canCancel={
              isOwner ||
              user.role === "admin" ||
              user.role === "compliance" ||
              user.role === "business_excellence"
            }
            cancelAction={cancelAuditAction}
          />
        </div>
      )}
      </AuditAnswersProvider>

      {/* Cancelled banner — replaces all action UI. */}
      {audit.status === "cancelled" && (
        <div className="bg-gray-50 border border-gray-300 rounded-2xl p-6 mb-4 text-center">
          <div className="text-3xl mb-2">🚫</div>
          <div className="text-sm font-semibold text-gray-800">
            This audit was cancelled
          </div>
          <div className="text-xs text-gray-500 mt-1">
            No responses, scores, or further actions can be recorded.
          </div>
        </div>
      )}

      {/* Read-only attachments for submitted/closed audits — so reviewers
          can still download the files the auditor uploaded. */}
      {!isOpen && attachments.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4">
          <AuditAttachments
            auditId={audit.id}
            attachments={attachments}
            canEdit={false}
          />
        </div>
      )}

      {audit.status === "submitted" && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-600 flex-1 min-w-[260px]">
            Submitted{" "}
            {audit.submitted_at && new Date(audit.submitted_at).toLocaleString()}
            .{" "}
            {canEdit
              ? "You can edit until the audit is closed, or close it when all CAPAs are addressed."
              : "Only the auditor who created this audit can edit or close it."}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <form action={reopenAuditAction}>
                <input type="hidden" name="id" value={audit.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Edit audit
                </button>
              </form>
              <form action={closeAuditAction}>
                <input type="hidden" name="id" value={audit.id} />
                <button
                  type="submit"
                  className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Close audit
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </Workspace>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

type GroupedTemplate = {
  template_id: number;
  template_code: string | null;
  template_name: string;
  items: AuditScopeRow[];
};

type GroupedTest = {
  test_id: number;
  test_code: string | null;
  test_name: string;
  templates: GroupedTemplate[];
};

/**
 * Walks the flat (test, item) pair list once, building a tree where
 * each test holds its templates and each template holds its items in
 * source order. Linear in row count — no nested sorts.
 */
function groupByTestAndTemplate(rows: AuditScopeRow[]): GroupedTest[] {
  const tests: GroupedTest[] = [];
  const testIdx = new Map<number, number>();
  const tplIdx = new Map<string, number>(); // key: testId-tplId

  for (const r of rows) {
    let ti = testIdx.get(r.test_id);
    if (ti === undefined) {
      ti = tests.length;
      testIdx.set(r.test_id, ti);
      tests.push({
        test_id: r.test_id,
        test_code: r.test_code,
        test_name: r.test_name,
        templates: [],
      });
    }
    const test = tests[ti];

    const tk = `${r.test_id}-${r.template_id}`;
    let pi = tplIdx.get(tk);
    if (pi === undefined) {
      pi = test.templates.length;
      tplIdx.set(tk, pi);
      test.templates.push({
        template_id: r.template_id,
        template_code: r.template_code,
        template_name: r.template_name,
        items: [],
      });
    }
    test.templates[pi].items.push(r);
  }
  return tests;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">
        {label}
      </div>
      <div className="text-sm text-gray-900 truncate">{children}</div>
    </div>
  );
}
