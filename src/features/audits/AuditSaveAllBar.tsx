"use client";

import { useAuditAnswers } from "./AuditAnswersContext";

/**
 * The single Save for the whole question set, shown once under the last
 * checklist. Sticks to the bottom of the viewport while there's unsaved
 * work so the auditor doesn't have to scroll back down after answering.
 */
export default function AuditSaveAllBar() {
  const {
    canEdit,
    dirtyIds,
    invalidIds,
    answeredCount,
    totalCount,
    saving,
    error,
    savedAt,
    saveAll,
  } = useAuditAnswers();

  if (!canEdit) return null;

  const unsaved = dirtyIds.length;
  const hasInvalid = invalidIds.length > 0;

  return (
    <div
      className={`sticky bottom-0 z-10 mt-3 rounded-2xl border shadow-sm px-5 py-3 flex flex-wrap items-center gap-3 backdrop-blur ${
        unsaved > 0
          ? "border-amber-300 bg-amber-50/95"
          : "border-gray-200 bg-white/95"
      }`}
    >
      <div className="text-sm text-gray-700">
        Answered{" "}
        <span className="font-semibold tabular-nums">{answeredCount}</span> of{" "}
        <span className="tabular-nums">{totalCount}</span>
        {unsaved > 0 && (
          <span className="text-amber-800">
            {" "}
            · <span className="font-semibold tabular-nums">{unsaved}</span>{" "}
            unsaved
          </span>
        )}
      </div>

      {!error && hasInvalid && (
        <span className="text-xs text-red-600">
          {invalidIds.length} question{invalidIds.length === 1 ? "" : "s"} don&apos;t
          add up to 100% — fix the highlighted total before saving.
        </span>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}

      {!error && savedAt && unsaved === 0 && (
        <span className="text-xs text-emerald-700">All answers saved ✓</span>
      )}

      <button
        type="button"
        onClick={() => void saveAll()}
        disabled={saving || unsaved === 0 || hasInvalid}
        className="ml-auto bg-brand-700 hover:bg-brand-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium"
      >
        {saving
          ? "Saving…"
          : unsaved > 0
          ? `Save all answers (${unsaved})`
          : "All answers saved"}
      </button>
    </div>
  );
}
