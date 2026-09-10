"use client";

import { useEffect, useState, useTransition } from "react";
import { useBulkSelection } from "./BulkSelection";
import { assignBulkCapasAction } from "./actions";

type UserOpt = { id: number; display_name: string; role?: string | null };

/**
 * Floating action bar that appears once at least one FindingCheckbox
 * (anywhere on the /capa page, across any control/test/audit) is ticked.
 * Opens a modal collecting the same fields as a single assignment, then
 * applies them to every selected finding in one call.
 */
export default function BulkAssignBar({
  assignableUsers,
  reviewers,
}: {
  assignableUsers: UserOpt[];
  reviewers: UserOpt[];
}) {
  const { selected, clear } = useBulkSelection();
  const [open, setOpen] = useState(false);
  const [severity, setSeverity] = useState<string>("medium");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [reviewerId, setReviewerId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const count = selected.size;

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
    const items = Array.from(selected.values()).map((f) => ({
      audit_id: f.auditId,
      item_id: f.itemId,
      title: f.question.slice(0, 250),
    }));
    const fd = new FormData();
    fd.append("items", JSON.stringify(items));
    fd.append("severity", severity);
    fd.append("assigned_to", assignedTo);
    if (reviewerId) fd.append("reviewer_id", reviewerId);
    if (startDate) fd.append("start_date", startDate);
    if (dueDate) fd.append("due_date", dueDate);
    if (note.trim()) fd.append("assignment_note", note.trim());

    startTransition(async () => {
      try {
        const result = await assignBulkCapasAction(fd);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setOpen(false);
        clear();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Assignment failed.");
      }
    });
  }

  if (count === 0) return null;

  return (
    <>
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-gray-900 text-white rounded-full shadow-2xl px-5 py-2.5 flex items-center gap-4 animate-[fadeIn_120ms_ease-out]">
        <span className="text-sm font-medium">
          {count} finding{count === 1 ? "" : "s"} selected
        </span>
        <button
          type="button"
          onClick={clear}
          className="text-xs text-gray-300 hover:text-white"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold px-3.5 py-1.5 rounded-full"
        >
          Assign selected
        </button>
      </div>

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
                  Assign {count} Corrective Action{count === 1 ? "" : "s"}
                </h2>
                <div className="text-xs text-gray-500 mt-0.5">
                  Every selected finding gets a CAPA with these choices.
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
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-40 overflow-y-auto">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">
                  Selected findings
                </div>
                <ul className="space-y-1">
                  {Array.from(selected.values()).map((f) => (
                    <li key={f.itemId} className="text-xs text-gray-700 truncate">
                      • {f.question}
                    </li>
                  ))}
                </ul>
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
                  {pending ? "Assigning…" : `Assign ${count} & Notify`}
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
