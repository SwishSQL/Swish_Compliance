import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import { queryOne } from "@/lib/db";
import Workspace from "@/features/shell/Workspace";
import { feedbackCounts, getRegister, listFeedback, type FeedbackView } from "@/features/sc-sop/repository";
import { FEEDBACK_RESPONSES, FEEDBACK_TYPES, canTriageScFeedback } from "@/features/sc-sop/types";
import { Linked, Pill, ScTabs, stepHref } from "@/features/sc-sop/ui";
import { createFeedbackAction, deleteFeedbackAction, respondFeedbackAction } from "@/features/sc-sop/actions";

type Search = { step?: string; view?: string; q?: string; status?: string; saved?: string; error?: string };

const input = "mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

export default async function ScSopFeedbackPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const triage = canTriageScFeedback(user.role);
  const view: FeedbackView = sp.view === "register" ? "register" : sp.view === "all" && triage ? "all" : "mine";

  const [reg, counts, rows, dept] = await Promise.all([
    getRegister(),
    feedbackCounts(user.id),
    listFeedback({ view, userId: user.id, q: sp.q, status: sp.status }),
    user.departmentId
      ? queryOne<{ name: string }>(`SELECT name FROM departments WHERE id = $1`, [user.departmentId])
      : Promise.resolve(undefined),
  ]);
  const stepIds = new Set(reg.steps.map((s) => s.id));
  const stepRef = (sp.step ?? "").toUpperCase();
  const picked = reg.steps.find((s) => s.id === stepRef);
  const pickedProc = reg.procs.find((p) => p.id === stepRef || p.id === picked?.pa);
  const myDept = reg.meta.depts.find((d) => d.toLowerCase() === dept?.name?.toLowerCase()) ?? "";

  const segs: { key: FeedbackView; label: string; n: number }[] = [
    { key: "mine", label: "Mine", n: counts.mine },
    { key: "register", label: "Already in register", n: counts.register },
    ...(triage ? [{ key: "all" as const, label: "All feedback (triage)", n: counts.all }] : []),
  ];
  const listQs = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ view, q: sp.q, status: sp.status, ...over })) if (v) p.set(k, String(v));
    return p.toString();
  };
  const here = `/sc-sop/feedback?${listQs({})}`;

  return (
    <Workspace
      section="Supply Chain / SOP Review"
      subtitle="Review feedback"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <ScTabs active="feedback" feedbackCount={counts.mine} />
      {sp.saved && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Saved. The register owner will see it and you will be notified when they respond.
        </div>
      )}
      {sp.error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{sp.error}</div>
      )}
      <div className="grid lg:grid-cols-[380px_minmax(0,1fr)] gap-5">
        <form action={createFeedbackAction} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-gray-500">One entry per comment</div>
            <h2 className="text-base font-semibold text-gray-900">Record feedback</h2>
          </div>
          <div className="text-xs text-gray-500">
            As <b className="text-gray-700">{user.displayName}</b> · {user.email}
          </div>
          <label className="block text-sm">
            <span className="text-xs text-gray-500">Step ID</span>
            <input name="stepRef" list="sc-steps" required defaultValue={stepRef} placeholder="PA-04-S230, PA-04 for the whole process, or General" className={input} />
            <datalist id="sc-steps">
              {reg.procs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              {reg.steps.map((s) => (
                <option key={s.id} value={s.id}>{s.phase}</option>
              ))}
            </datalist>
          </label>
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-[12px] text-gray-700">
            {picked ? (
              <>
                <Link href={stepHref(picked.id)} className="font-mono text-brand-700 hover:underline">{picked.id}</Link>
                {" · "}{pickedProc?.name}
                <div className="mt-1"><span className="text-gray-500">To-be: </span>{picked.tobe}</div>
              </>
            ) : pickedProc ? (
              <>Whole process: <b>{pickedProc.name}</b></>
            ) : (
              <>Open a step in <Link href="/sc-sop/processes" className="text-brand-700 hover:underline">Processes</Link> and press Comment to fill this in.</>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              <span className="text-xs text-gray-500">Your department</span>
              <select name="reviewerDept" defaultValue={myDept} className={input}>
                <option value="">Select…</option>
                {reg.meta.depts.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs text-gray-500">Role / designation</span>
              <input name="reviewerRole" list="sc-roles" maxLength={120} className={input} placeholder="e.g. Warehouse Manager" />
              <datalist id="sc-roles">
                {Object.entries(reg.meta.roles).flatMap(([d, list]) =>
                  list.split(",").map((r) => <option key={d + r} value={`${d} ${r.trim()}`} />)
                )}
              </datalist>
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-xs text-gray-500">Feedback type</span>
            <select name="fbType" required defaultValue="" className={input}>
              <option value="" disabled>Select…</option>
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

        <section className="space-y-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
              {segs.map((s) => (
                <Link
                  key={s.key}
                  href={`/sc-sop/feedback?${listQs({ view: s.key })}`}
                  className={`px-3 py-1.5 rounded-md text-sm ${view === s.key ? "bg-brand-700 text-white" : "text-gray-600 hover:bg-gray-50"}`}
                >
                  {s.label} ({s.n})
                </Link>
              ))}
            </div>
            <form method="get" className="flex gap-2 ml-auto">
              <input type="hidden" name="view" value={view} />
              <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Filter by step, type, text" className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
              <select name="status" defaultValue={sp.status ?? ""} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                <option value="">Any status</option>
                <option>Open</option>
                <option>Closed</option>
              </select>
              <button className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">Filter</button>
            </form>
            <a href={`/sc-sop/feedback/export?${listQs({})}`} className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50">
              Download CSV
            </a>
          </div>

          {rows.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-sm text-gray-400">
              {view === "mine" ? "You have not recorded any feedback yet." : "No feedback matches."}
            </div>
          )}

          {rows.map((f) => (
            <article key={f.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-2">
              <header className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span className="font-mono text-gray-700">{f.ref_code}</span>
                {f.step_ref === "General" ? (
                  <span className="font-mono">General</span>
                ) : (
                  <Link href={stepHref(f.step_ref)} className="font-mono text-brand-700 hover:underline">{f.step_ref}</Link>
                )}
                <Pill>{f.fb_type}</Pill>
                <span>
                  {f.reviewer_name}
                  {f.reviewer_dept ? ` · ${f.reviewer_dept}` : ""}
                  {f.reviewer_role ? ` · ${f.reviewer_role}` : ""}
                </span>
                <span>{new Date(f.created_at).toLocaleDateString()}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {f.response && <Pill tone="bg-blue-50 text-blue-800 border-blue-200">{f.response}</Pill>}
                  <Pill tone={f.status === "Open" ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"}>
                    {f.status}
                  </Pill>
                </span>
              </header>
              <div className="text-sm text-gray-900">
                <Linked text={f.comment} refs={reg.refs} stepIds={stepIds} />
              </div>
              {f.proposed && (
                <div className="text-[13px] text-gray-700"><span className="text-gray-500">Proposed wording: </span>{f.proposed}</div>
              )}
              {f.evidence && (
                <div className="text-[13px] text-gray-700"><span className="text-gray-500">Evidence: </span>{f.evidence}</div>
              )}
              {f.response_note && (
                <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-[13px] text-gray-700">
                  <span className="text-gray-500">Response{f.responder_name ? ` (${f.responder_name})` : ""}: </span>
                  {f.response_note}
                </div>
              )}

              {triage && f.source === "app" && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-xs text-brand-700">Respond</summary>
                  <form action={respondFeedbackAction} className="mt-2 grid sm:grid-cols-[180px_120px_minmax(0,1fr)_auto] gap-2 items-start">
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="returnTo" value={here} />
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
                    <textarea name="note" rows={1} defaultValue={f.response_note ?? ""} placeholder="Note to the reviewer (e.g. carried into PA-23)" className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                    <button className="px-3 py-1.5 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-sm">Save</button>
                  </form>
                </details>
              )}
              {f.user_id === user.id && f.source === "app" && !f.response && (
                <form action={deleteFeedbackAction}>
                  <input type="hidden" name="id" value={f.id} />
                  <button className="text-xs text-red-700 hover:underline">Withdraw</button>
                </form>
              )}
            </article>
          ))}
        </section>
      </div>
    </Workspace>
  );
}
