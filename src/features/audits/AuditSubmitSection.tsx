"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { submitAuditAction } from "./actions";
import { useAuditAnswers } from "./AuditAnswersContext";
import { FINDING_THRESHOLD_PERCENT } from "./types";

/**
 * Submit card. Flushes any unsaved answers BEFORE submitting, so the
 * auditor can answer everything and hit Submit directly without first
 * pressing Save — and so a forgotten Save can't silently drop answers
 * out of the score the submit computes.
 *
 * If the flush fails, the submit is aborted and the error is shown
 * rather than scoring a partial audit.
 */
export default function AuditSubmitSection({
  auditId,
  canCancel,
  cancelAction,
}: {
  auditId: number;
  canCancel: boolean;
  cancelAction: (formData: FormData) => void | Promise<void>;
}) {
  const {
    dirtyIds,
    saveAll,
    saving,
    error: flushError,
  } = useAuditAnswers();
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const unsaved = dirtyIds.length;
  const busy = saving || submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startSubmit(async () => {
      const flushed = await saveAll();
      if (!flushed) {
        setError(
          flushError ??
            "Your answers could not be saved, so the audit was not submitted. Fix the error above and try again."
        );
        return;
      }
      const fd = new FormData();
      fd.append("id", String(auditId));
      fd.append("summary", summary);
      try {
        await submitAuditAction(fd);
      } catch (err) {
        // redirect()/notFound() throw control-flow errors Next.js handles
        // itself — only surface real failures.
        if (
          err &&
          typeof err === "object" &&
          "digest" in err &&
          typeof (err as { digest?: unknown }).digest === "string" &&
          (err as { digest: string }).digest.startsWith("NEXT_")
        ) {
          throw err;
        }
        setError(err instanceof Error ? err.message : "Failed to submit.");
      }
    });
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-4">
      <textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="Summary / overall observations (optional)"
        rows={3}
        disabled={busy}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
      />

      {/* No longer a choice — every answer under the threshold ALWAYS
          becomes a CAPA on submit (compliance-score rule, migration 053:
          answers are graded 0-100%, not just Pass/Fail). Kept as an info
          box so the auditor knows what will happen. */}
      <div className="flex items-start gap-3 p-3 border border-amber-200 bg-amber-50 rounded-lg text-sm">
        <span className="mt-0.5">⚠️</span>
        <div>
          <div className="font-medium text-amber-900">
            Any answer below {FINDING_THRESHOLD_PERCENT}% becomes a CAPA automatically
          </div>
          <div className="text-xs text-amber-700">
            On submit, each answer under {FINDING_THRESHOLD_PERCENT}% opens a corrective
            action assigned to the department manager (critical questions →
            critical severity). They count against the compliance score
            until resolved.
          </div>
        </div>
      </div>

      {unsaved > 0 && (
        <p className="text-xs text-amber-800">
          {unsaved} unsaved answer{unsaved === 1 ? "" : "s"} will be saved
          automatically when you submit.
        </p>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="bg-brand-700 hover:bg-brand-800 disabled:bg-gray-300 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
        >
          {submitting ? "Submitting…" : "Submit audit"}
        </button>
        <Link
          href="/audits"
          className="text-sm text-gray-500 hover:text-gray-700 self-center"
        >
          Back to list
        </Link>
      </div>
    </form>

    {/* Cancel lives OUTSIDE the submit form — a nested <form> is invalid
        HTML and browsers drop the inner one, which would leave this
        button silently submitting the audit instead of cancelling it. */}
    {canCancel && (
      <form action={cancelAction} className="flex justify-end -mt-11">
        <input type="hidden" name="id" value={auditId} />
        <button
          type="submit"
          disabled={busy}
          className="text-sm text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 bg-white px-4 py-2 rounded-lg disabled:opacity-50"
          title="Mark this audit as cancelled. Cannot be undone."
        >
          Cancel audit
        </button>
      </form>
    )}
    </>
  );
}
