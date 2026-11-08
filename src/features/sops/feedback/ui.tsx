import Link from "next/link";
import type { ReactNode } from "react";
import { createSopFeedbackAction, deleteSopFeedbackAction, respondSopFeedbackAction } from "./actions";
import { FEEDBACK_RESPONSES, FEEDBACK_SECTIONS, FEEDBACK_TYPES, sectionLabel, type SopFeedback } from "./types";

/* Server-rendered building blocks for the SOP review template. */

export function Pill({ tone, children }: { tone?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${
        tone ?? "bg-gray-100 text-gray-700 border-gray-200"
      }`}
    >
      {children}
    </span>
  );
}

function TabBar({ tabs, active }: { tabs: { key: string; href: string; label: string; n?: number }[]; active: string }) {
  return (
    <nav className="flex flex-wrap gap-1 mb-4 border-b border-gray-200">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
            active === t.key ? "border-brand-700 text-brand-700" : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          {t.label}
          {t.n ? (
            <span className="ml-1.5 inline-flex min-w-5 justify-center rounded-full bg-brand-700 px-1.5 text-[11px] text-white">{t.n}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

/** Views of the SOPs & Policies register. */
export function SopRegisterTabs({ active, openFeedback }: { active: "register" | "ask" | "feedback"; openFeedback?: number }) {
  return (
    <TabBar
      active={active}
      tabs={[
        { key: "register", href: "/sops", label: "Register" },
        { key: "ask", href: "/sops/ask", label: "Ask the SOPs" },
        { key: "feedback", href: "/sops/feedback", label: "Review feedback", n: openFeedback },
      ]}
    />
  );
}

/** Views of one SOP. */
export function SopDetailTabs({ sopId, active, feedback }: { sopId: number; active: string; feedback: number }) {
  return (
    <TabBar
      active={active}
      tabs={[
        { key: "content", href: `/sops/${sopId}`, label: "Content" },
        { key: "overview", href: `/sops/${sopId}?tab=overview`, label: "Approval & details" },
        { key: "feedback", href: `/sops/${sopId}?tab=feedback`, label: "Feedback", n: feedback },
      ]}
    />
  );
}

export function Flash({ saved, error, savedText }: { saved?: string; error?: string; savedText?: string }) {
  return (
    <>
      {saved && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {savedText ?? "Saved."}
        </div>
      )}
      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
    </>
  );
}

const input =
  "mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

export function FeedbackForm({
  sopId,
  sectionKey,
  returnTo,
  departments,
  myDept,
  userName,
}: {
  sopId: number;
  sectionKey: string;
  returnTo: string;
  departments: string[];
  myDept: string;
  userName: string;
}) {
  return (
    <form id="comment" action={createSopFeedbackAction} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3 scroll-mt-24">
      <input type="hidden" name="sopId" value={sopId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div>
        <div className="text-[11px] uppercase tracking-widest text-gray-500">One entry per comment</div>
        <h3 className="text-base font-semibold text-gray-900">Record feedback</h3>
        <div className="text-xs text-gray-500 mt-0.5">As {userName}</div>
      </div>
      <label className="block text-sm">
        <span className="text-xs text-gray-500">Section</span>
        <select name="sectionKey" defaultValue={sectionKey} className={input}>
          {FEEDBACK_SECTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.num === "—" ? s.label : `${s.num}. ${s.label}`}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="text-xs text-gray-500">Your department</span>
          <select name="reviewerDept" defaultValue={myDept} className={input}>
            <option value="">Select…</option>
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs text-gray-500">Role / designation</span>
          <input name="reviewerRole" maxLength={120} placeholder="e.g. Warehouse Manager" className={input} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-xs text-gray-500">Feedback type</span>
        <select name="fbType" required defaultValue="" className={input}>
          <option value="" disabled>
            Select…
          </option>
          {FEEDBACK_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-xs text-gray-500">Comment</span>
        <textarea name="comment" required minLength={3} rows={4} placeholder="What should change, and why?" className={input} />
      </label>
      <label className="block text-sm">
        <span className="text-xs text-gray-500">Proposed wording (optional)</span>
        <textarea name="proposed" rows={2} className={input} />
      </label>
      <label className="block text-sm">
        <span className="text-xs text-gray-500">Evidence / reference (optional)</span>
        <input name="evidence" maxLength={500} placeholder="Document, email, policy ref…" className={input} />
      </label>
      <button type="submit" className="w-full bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
        Add feedback
      </button>
    </form>
  );
}

export function FeedbackList({
  rows,
  userId,
  triage,
  returnTo,
  showSop,
  empty,
}: {
  rows: SopFeedback[];
  userId: number;
  triage: boolean;
  returnTo: string;
  showSop?: boolean;
  empty: string;
}) {
  if (rows.length === 0) {
    return <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-sm text-gray-400">{empty}</div>;
  }
  return (
    <div className="space-y-3">
      {rows.map((f) => (
        <article key={f.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-2">
          <header className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {showSop && (
              <Link href={`/sops/${f.sop_id}?tab=feedback`} className="font-medium text-brand-700 hover:underline">
                {f.sop_code ? `${f.sop_code} · ` : ""}
                {f.sop_title}
              </Link>
            )}
            <Link href={`/sops/${f.sop_id}#sec-${f.section_key}`} className="text-gray-700 hover:underline">
              {sectionLabel(f.section_key)}
            </Link>
            <Pill>{f.fb_type}</Pill>
            <span>
              {f.reviewer_name}
              {f.reviewer_dept ? ` · ${f.reviewer_dept}` : ""}
              {f.reviewer_role ? ` · ${f.reviewer_role}` : ""}
            </span>
            <span>{new Date(f.created_at).toLocaleDateString()}</span>
            <span className="ml-auto flex items-center gap-1.5">
              {f.response && <Pill tone="bg-blue-50 text-blue-800 border-blue-200">{f.response}</Pill>}
              <Pill
                tone={
                  f.status === "Open"
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : "bg-emerald-50 text-emerald-800 border-emerald-200"
                }
              >
                {f.status}
              </Pill>
            </span>
          </header>
          <p className="text-sm text-gray-900 whitespace-pre-line">{f.comment}</p>
          {f.proposed && (
            <div className="text-[13px] text-gray-700 whitespace-pre-line">
              <span className="text-gray-500">Proposed wording: </span>
              {f.proposed}
            </div>
          )}
          {f.evidence && (
            <div className="text-[13px] text-gray-700">
              <span className="text-gray-500">Evidence: </span>
              {f.evidence}
            </div>
          )}
          {f.response_note && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-[13px] text-gray-700 whitespace-pre-line">
              <span className="text-gray-500">Response{f.responder_name ? ` (${f.responder_name})` : ""}: </span>
              {f.response_note}
            </div>
          )}
          {triage && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-brand-700">Respond</summary>
              <form action={respondSopFeedbackAction} className="mt-2 grid sm:grid-cols-[180px_110px_minmax(0,1fr)_auto] gap-2 items-start">
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <select name="response" defaultValue={f.response ?? ""} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                  <option value="">No response yet</option>
                  {FEEDBACK_RESPONSES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <select name="status" defaultValue={f.status} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                  <option>Open</option>
                  <option>Closed</option>
                </select>
                <textarea
                  name="note"
                  rows={1}
                  defaultValue={f.response_note ?? ""}
                  placeholder="Note to the reviewer"
                  className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                />
                <button className="px-3 py-1.5 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-sm">Save</button>
              </form>
            </details>
          )}
          {f.user_id === userId && !f.response && (
            <form action={deleteSopFeedbackAction}>
              <input type="hidden" name="id" value={f.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button className="text-xs text-red-700 hover:underline">Withdraw</button>
            </form>
          )}
        </article>
      ))}
    </div>
  );
}
