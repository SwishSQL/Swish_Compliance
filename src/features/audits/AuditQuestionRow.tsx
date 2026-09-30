"use client";

import { useAuditAnswers, type AnswerValue } from "./AuditAnswersContext";
import { FINDING_THRESHOLD_PERCENT } from "./types";

/**
 * One question row: Yes / No / N/A radios (a shortcut for the clean,
 * no-nuance case) plus three percentage boxes underneath that record how
 * the sampled interactions actually broke down. Performance is Yes's
 * share of the applicable (Yes + No) samples — N/A is excluded so a
 * partly-inapplicable question doesn't drag the auditee's score down.
 *
 * Deliberately has no Save button of its own — every answer lives in
 * AuditAnswersProvider and is written by the single "Save all answers"
 * bar at the end of the questions (or by Submit, which flushes first).
 * An unsaved row is marked instead, so the auditor can see at a glance
 * what the next save will write.
 */
export default function AuditQuestionRow({
  itemId,
  question,
  weight,
  isCritical,
  itemNo,
}: {
  itemId: number;
  question: string;
  weight: number;
  isCritical: boolean;
  itemNo: number;
}) {
  const { get, setResponse, setSplit, setNotes, canEdit, dirtyIds, invalidIds, saving } =
    useAuditAnswers();

  const { response, yesPercent, noPercent, naPercent, notes } = get(itemId);
  const isDirty = dirtyIds.includes(itemId);
  const isInvalid = invalidIds.includes(itemId);
  const showSplit = response !== null;

  const sum = (yesPercent ?? 0) + (noPercent ?? 0) + (naPercent ?? 0);
  const applicable = (yesPercent ?? 0) + (noPercent ?? 0);
  const performance = applicable > 0 ? ((yesPercent ?? 0) / applicable) * 100 : null;
  const isShortfall = performance !== null && performance < FINDING_THRESHOLD_PERCENT;

  // pass/fail/na is the DB enum; Yes/No/N/A is what the auditor reads.
  const labels: Record<AnswerValue, string> = {
    pass: "Yes",
    fail: "No",
    na: "N/A",
  };

  const boxClass =
    "w-12 px-1 py-0.5 bg-transparent border-0 text-xs text-right tabular-nums focus:outline-none disabled:opacity-60";

  return (
    <tr
      className={`border-t border-gray-100 align-top ${
        isDirty ? "bg-amber-50/40" : ""
      }`}
    >
      <td className="px-3 py-2.5 text-xs text-gray-400 w-12">{itemNo}</td>
      <td className="px-3 py-2.5">
        <div className="text-sm text-gray-900">
          {question}
          {isCritical && (
            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 rounded">
              CRITICAL
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-500 w-16 tabular-nums">
        ×{weight}
      </td>
      <td className="px-3 py-2.5 min-w-[420px]">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              {(["pass", "fail", "na"] as const).map((r) => (
                <label
                  key={r}
                  className={`inline-flex items-center gap-1 px-2 py-1 border rounded cursor-pointer text-xs transition-colors ${
                    response === r
                      ? r === "pass"
                        ? "bg-emerald-50 border-emerald-400 text-emerald-800"
                        : r === "fail"
                        ? "bg-red-50 border-red-400 text-red-800"
                        : "bg-gray-100 border-gray-400 text-gray-800"
                      : "border-gray-200 text-gray-700 hover:bg-gray-50"
                  } ${!canEdit ? "opacity-60 cursor-not-allowed" : ""}`}
                  title="Shortcut — sets a clean 100% split, which you can still break down below."
                >
                  <input
                    type="radio"
                    name={`r-${itemId}`}
                    value={r}
                    checked={response === r}
                    onChange={() => setResponse(itemId, r)}
                    disabled={!canEdit || saving}
                    className="accent-brand-700"
                  />
                  <span className="font-medium">{labels[r]}</span>
                </label>
              ))}
            </div>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(itemId, e.target.value)}
              placeholder="Note (optional)"
              disabled={!canEdit || saving}
              className="flex-1 min-w-[140px] px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
            />
            {isDirty && !isInvalid && (
              <span className="text-[10px] text-amber-700 whitespace-nowrap">
                Unsaved
              </span>
            )}
          </div>

          {showSplit && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                {(
                  [
                    ["yes", "Yes", yesPercent],
                    ["no", "No", noPercent],
                    ["na", "N/A", naPercent],
                  ] as const
                ).map(([field, label, value]) => (
                  <label
                    key={field}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-gray-200 rounded text-xs text-gray-600"
                  >
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">
                      {label}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={value ?? ""}
                      onChange={(e) =>
                        setSplit(
                          itemId,
                          field,
                          e.target.value === "" ? null : Number(e.target.value)
                        )
                      }
                      disabled={!canEdit || saving}
                      className={boxClass}
                    />
                    <span className="text-gray-400">%</span>
                  </label>
                ))}
              </div>

              <span
                className={`text-[10px] whitespace-nowrap ${
                  sum === 100 ? "text-gray-400" : "text-red-600 font-medium"
                }`}
              >
                {sum === 100 ? "✓ 100%" : `Total ${sum}% — must equal 100%`}
              </span>

              {performance !== null && (
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                    isShortfall
                      ? "bg-amber-100 text-amber-800"
                      : "bg-emerald-50 text-emerald-700"
                  }`}
                  title="Yes's share of the applicable (Yes + No) samples — N/A is excluded."
                >
                  {Math.round(performance)}% performance
                </span>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
