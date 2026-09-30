"use client";

import { useEffect, useState, useTransition } from "react";
import { assignCapaFromFindingAction } from "./actions";

type UserOpt = { id: number; display_name: string; role?: string | null };

type FindingContext = {
  auditId: number;
  itemId: number;
  auditTitle: string; // e.g. "Audit #13 · Fire Safety · Head Office Ardiya"
  question: string;
  auditorNote: string | null;
  proposedCode: string; // e.g. CAPA-AUD13-001 (or existing code if reassign)
  brandId: number | null;
  departmentId: number | null;
  // Pre-fill if the CAPA already exists.
  initialSeverity?: string | null;
  initialAssignedTo?: number | null;
  initialDueDate?: string | null;
};

/**
 * Compact assignment popup. Bound to a single failed finding. Handles
 * both "first time assign" (creates the CAPA) and "reassign / edit"
 * (updates the existing one) — same action, upsert semantics live in
 * upsertCapaFromFinding.
 */
export default function AssignCapaModal({
  finding,
  assignableUsers,
  reviewers,
}: {
  finding: FindingContext;
  assignableUsers: UserOpt[];
  reviewers: UserOpt[];
}) {
  const [open, setOpen] = useState(false);
  const [severity, setSeverity] = useState<string>(
    finding.initialSeverity ?? "medium"
  );
  const [assignedTo, setAssignedTo] = useState<string>(
    finding.initialAssignedTo ? String(finding.initialAssignedTo) : ""
  );
  const [reviewerId, setReviewerId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>(
    finding.initialDueDate ?? ""
  );
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!assignedTo) {
      setError("Assignee is required.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.append("audit_id", String(finding.auditId));
    fd.append("item_id", String(finding.itemId));
    fd.append("title", finding.question.slice(0, 250));
    fd.append("severity", severity);
    fd.append("assigned_to", assignedTo);
    if (reviewerId) fd.append("reviewer_id", reviewerId);
    if (finding.brandId) fd.append("brand_id", String(finding.brandId));
    if (finding.departmentId)
      fd.append("department_id", String(finding.departmentId));
    if (startDate) fd.append("start_date", startDate);
    if (dueDate) fd.append("due_date", dueDate);
    if (note.trim()) fd.append("assignment_note", note.trim());

    startTransition(async () => {
      try {
        const result = await assignCapaFromFindingAction(fd);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Assignment failed.");
      }
    });
  }

  const isReassign = !!finding.initialAssignedTo;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          isReassign
            ? "bg-white text-brand-700 border border-brand-200 hover:bg-brand-50"
            : "bg-brand-700 text-white hover:bg-brand-800"
        }`}
      >
        {isReassign ? "Edit assignment" : "Assign CAPA"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]"
          onClick={close}
        >
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl my-8 max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-900">
                  Assign Corrective Action
                </h2>
                <div className="text-xs text-gray-500 mt-0.5 font-mono">
                  {finding.proposedCode}
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="shrink-0 w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center disabled:opacity-50 text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={submit} className="px-6 py-5 space-y-4">
              {/* Read-only context */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
                    Source
                  </div>
                  <div className="text-xs text-gray-800">
                    {finding.auditTitle}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
                    Failed question
                  </div>
                  <div className="text-sm text-gray-900">
                    {finding.question}
                  </div>
                </div>
                {finding.auditorNote && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
                      Auditor note
                    </div>
                    <div className="text-xs text-gray-700 italic">
                      &ldquo;{finding.auditorNote}&rdquo;
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Severity <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    disabled={pending}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Assign to <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    disabled={pending}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">— Choose user —</option>
                    {assignableUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name}
                        {u.role ? ` · ${u.role}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Start date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    disabled={pending}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Due date
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    disabled={pending}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Reviewer (Compliance / BE / GRC)
                </label>
                <select
                  value={reviewerId}
                  onChange={(e) => setReviewerId(e.target.value)}
                  disabled={pending}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">— None —</option>
                  {reviewers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name}
                      {u.role ? ` · ${u.role}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Assignment note (optional)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  disabled={pending}
                  placeholder="Why this person, deadline reasoning, extra context…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              {error && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={close}
                  disabled={pending}
                  className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="bg-brand-700 hover:bg-brand-800 text-white px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
                >
                  {pending
                    ? "Assigning…"
                    : isReassign
                    ? "Save & Notify"
                    : "Assign & Notify"}
                </button>
              </div>
            </form>
          </div>

          <style>{`
            @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
          `}</style>
        </div>
      )}
    </>
  );
}
