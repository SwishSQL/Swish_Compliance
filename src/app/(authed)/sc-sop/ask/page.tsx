import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { feedbackCounts, getRegister } from "@/features/sc-sop/repository";
import { searchRegister } from "@/features/sc-sop/search";
import { CHANGE_TONE, FIT_TONE } from "@/features/sc-sop/types";
import { Linked, Pill, RefDetail, ScTabs, stepHref } from "@/features/sc-sop/ui";
import { createFeedbackAction } from "@/features/sc-sop/actions";

const SUGGESTIONS = [
  "Who approves a store additional order?",
  "What changes in goods receiving and QC?",
  "How is batch and expiry tracked?",
  "Three-way match before payment",
  "What happens to wastage recording?",
  "Which steps are not covered by the ERP?",
  "PA-04-S230",
  "Month-end close responsibilities",
];

export default async function ScSopAskPage({ searchParams }: { searchParams: Promise<{ q?: string; saved?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 300);
  const [reg, counts] = await Promise.all([getRegister(), feedbackCounts(user.id)]);
  const stepIds = new Set(reg.steps.map((s) => s.id));
  const procName = Object.fromEntries(reg.procs.map((p) => [p.id, p.name]));

  // "Which steps are not covered…" style questions read better as a filter.
  const notCovered = /not covered|gap/i.test(q) && /erp/i.test(q);
  const result = q ? searchRegister(reg, q) : null;
  const steps = notCovered
    ? reg.steps.filter((s) => s.fit === "Not covered").map((step) => ({ step, score: 1 }))
    : result?.steps ?? [];
  const refs = notCovered ? [] : result?.refs ?? [];
  const procHits = [...new Set(steps.map((h) => h.step.pa))];

  return (
    <Workspace
      section="Supply Chain / SOP Review"
      subtitle="Ask the SOP"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <ScTabs active="ask" feedbackCount={counts.mine} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-5">
        <section className="space-y-4 min-w-0">
          <form method="get" className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              autoFocus
              placeholder="Ask about any process, step, role, control, approval or policy…"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium">Ask</button>
          </form>

          {sp.saved && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Your question was added to your feedback for the register owner.
            </div>
          )}

          {!q && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 text-sm text-gray-700 space-y-2">
              <p className="font-medium text-gray-900">Ask anything about the Swish supply chain SOP.</p>
              <p>
                For example: who does a step, what changes from today, which control or approval applies, or whether
                the ERP covers it. You can also type a Step ID such as <span className="font-mono">PA-04-S230</span>.
              </p>
            </div>
          )}

          {q && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
              <div className="text-sm text-gray-700">
                {steps.length || refs.length ? (
                  <>
                    Found <b>{steps.length}</b> step{steps.length === 1 ? "" : "s"}
                    {procHits.length ? <> in {procHits.map((p) => `${p} ${procName[p]}`).slice(0, 4).join(", ")}{procHits.length > 4 ? "…" : ""}</> : null}
                    {refs.length ? <> and <b>{refs.length}</b> related reference{refs.length === 1 ? "" : "s"}</> : null}.
                  </>
                ) : (
                  <>Nothing in the register matches “{q}”. Try other words, or send the question to the register owner.</>
                )}
              </div>

              {steps.map(({ step: s }) => (
                <div key={s.id} className="rounded-xl border border-gray-200 p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={stepHref(s.id)} className="font-mono text-sm font-semibold text-brand-700 hover:underline">
                      {s.id}
                    </Link>
                    <span className="text-xs text-gray-500">
                      {procName[s.pa]} · {s.phase}
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      <Pill tone={CHANGE_TONE[s.change]}>{s.change}</Pill>
                      {s.fit && <Pill tone={FIT_TONE[s.fit]}>ERP: {s.fit}</Pill>}
                    </span>
                  </div>
                  <div className="text-[13px] text-gray-900">
                    <span className="text-gray-500">To-be: </span>
                    <Linked text={s.tobe} refs={reg.refs} stepIds={stepIds} ctxPa={s.pa} />
                  </div>
                  {s.asis && (
                    <div className="text-[13px] text-gray-600">
                      <span className="text-gray-500">As-is: </span>
                      <Linked text={s.asis} refs={reg.refs} stepIds={stepIds} ctxPa={s.pa} />
                    </div>
                  )}
                  <div className="text-xs text-gray-500">
                    {[s.dept, s.role, s.sys].filter(Boolean).join(" · ")}
                    {s.refs ? <> · <Linked text={s.refs} refs={reg.refs} stepIds={stepIds} ctxPa={s.pa} /></> : null}
                  </div>
                </div>
              ))}

              {refs.length > 0 && (
                <div className="grid sm:grid-cols-2 gap-3">
                  {refs.map((h) => (
                    <div key={h.id} className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
                      <RefDetail id={h.id} r={h.ref} />
                    </div>
                  ))}
                </div>
              )}

              <form action={createFeedbackAction} className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
                <input type="hidden" name="fbType" value="Question / clarification" />
                <input type="hidden" name="stepRef" value={steps[0]?.step.id ?? "General"} />
                <input type="hidden" name="comment" value={q} />
                <input type="hidden" name="returnTo" value={`/sc-sop/ask?q=${encodeURIComponent(q)}`} />
                <span className="text-xs text-gray-500">Answer not there?</span>
                <button className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm text-gray-800">
                  Send this question to the register owner
                </button>
              </form>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Try asking</h3>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <Link key={s} href={`/sc-sop/ask?q=${encodeURIComponent(s)}`} className="text-sm text-brand-700 hover:underline">
                  {s}
                </Link>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-500 px-1">
            Answers come from searching the register: {reg.steps.length} steps, policies, controls, KPIs and the approval
            matrix. Every answer cites the Step IDs it comes from.
          </p>
        </aside>
      </div>
    </Workspace>
  );
}
