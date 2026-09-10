"use client";

import { useEffect, useState, useTransition } from "react";
import { assignControlCapasAction } from "./actions";

type UserOpt = { id: number; display_name: string; role?: string | null };

type ControlContext = {
  auditId: number;
  controlId: number | null;
  controlCode: string | null;
  controlName: string | null;
  auditTitle: string;
  /** Findings under this control with no assignee yet. */
  unassignedCount: number;
  /** Findings under this control that already have an assignee. */
  assignedCount: number;
};

/**
 * Bulk assignment popup bound to a whole CONTROL inside one audit.
 * Same fields as the per-finding AssignCapaModal; on save, every
 * still-unassigned finding under the control gets a CAPA with these
 * choices. Findings already assigned to someone are never touched.
 */
export default function AssignControlModal({
  control,
  assignableUsers,
  reviewers,
}: {
  control: ControlContext;
  assignableUsers: UserOpt[];
  reviewers: UserOpt[];
}) {
  const [open, setOpen] = useState(false);
  const [severity, setSeverity] = useState<string>("medium");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [reviewerId, setReviewerId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
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
    fd.append("audit_id", String(control.auditId));
    if (control.controlId != null)
      fd.append("control_id", String(control.controlId));
    fd.append(
      "control_label",
      [control.controlCode, control.controlName].filter(Boolean).join(" ") ||
        control.auditTitle
    );
    fd.append("severity", severity);
    fd.append("assigned_to", assignedTo);
    if (reviewerId) fd.append("reviewer_id", reviewerId);
    if (startDate) fd.append("start_date", startDate);
    if (dueDate) fd.append("due_date", dueDate);
    if (note.trim()) fd.append("assignment_note", note.trim());

    startTransition(async () => {
      try {
        const result = await assignControlCapasAction(fd);
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

  // Nothing left to assign — no button, the per-finding "Edit
  // assignment" buttons are the right tool from here on.
  if (control.unassignedCount === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors"
      >
        Assign control ({control.unassignedCount})
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
                  Assign Whole Control
                </h2>
                <div className="text-xs text-gray-500 mt-0.5">
                  {control.unassignedCount} finding
                  {control.unassignedCount === 1 ? "" : "s"} will get a CAPA
                  with these choices
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
                    {control.auditTitle}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
                    Control
                  </div>
                  <div className="text-sm text-gray-900">
                    {control.controlCode && (
                      <span className="font-mono text-xs text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded mr-2">
                        {control.controlCode}
                      </span>
                    )}
                    {control.controlName ?? "— No control linked —"}
                  </div>
                </div>
                <div className="text-xs text-gray-600">
                  Applies to the{" "}
                  <span className="font-semibold">
                    {control.unassignedCount} unassigned
                  </span>{" "}
                  finding{control.unassignedCount === 1 ? "" : "s"} under this
                  control.
                  {control.assignedCount > 0 && (
                    <>
                      {" "}
                      The {control.assignedCount} already-assigned finding
                      {control.assignedCount === 1 ? "" : "s"} will NOT be
                      changed.
                    </>
                  )}
                </div>
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
                  className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
                >
                  {pending
                    ? "Assigning…"
                    : `Assign ${control.unassignedCount} & Notify`}
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
