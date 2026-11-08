import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { listSopFeedback } from "@/features/sops/feedback/repository";
import { visibleSops } from "@/features/sops/feedback/scope";
import { Pill, SopRegisterTabs } from "@/features/sops/feedback/ui";
import { searchSops } from "@/features/sops/search";
import { SOP_SECTIONS, SOP_STATUS_LABEL, SOP_STATUS_TONE, type SopStatus } from "@/features/sops/types";

const SUGGESTIONS = [
  "Who approves this process?",
  "Time limit for responding to a complaint",
  "Which forms are used for recruitment?",
  "KPIs and targets",
  "Roles and responsibilities of the department manager",
  "Review cycle and process owner",
];

/** "Ask the SOPs": search the template sections of every visible SOP. */
export default async function SopAskPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 300);
  const sops = await visibleSops(user);
  const ids = new Set(sops.map((s) => s.id));
  const openTotal = (await listSopFeedback({ view: "all", userId: user.id, status: "Open" })).filter((r) =>
    ids.has(r.sop_id)
  ).length;
  const { hits } = q ? searchSops(sops, SOP_SECTIONS, q) : { hits: [] };

  return (
    <Workspace
      section="Compliance Library / SOPs & Policies"
      subtitle="Ask the SOPs"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <SopRegisterTabs active="ask" openFeedback={openTotal} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-5">
        <section className="space-y-4 min-w-0">
          <form method="get" className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              autoFocus
              placeholder="Ask about any SOP: who does what, approvals, time limits, forms, KPIs…"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium">Ask</button>
          </form>

          {!q && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 text-sm text-gray-700 space-y-2">
              <p className="font-medium text-gray-900">Ask anything about the SOPs you can see.</p>
              <p>
                Answers come from the sections of {sops.length} SOP{sops.length === 1 ? "" : "s"} (purpose, scope,
                process flow, roles, inputs and outputs, tools, KPIs, ownership, appendices and approvals). Each answer
                links to the section it came from.
              </p>
            </div>
          )}

          {q && hits.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 text-sm text-gray-700">
              Nothing in the SOPs matches “{q}”. Try other words.
            </div>
          )}

          {hits.map(({ doc, sections }) => (
            <article key={doc.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              <header className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
                <Link href={`/sops/${doc.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
                  {doc.code ? `${doc.code} · ` : ""}
                  {doc.title}
                </Link>
                {doc.department_names.length > 0 && (
                  <span className="text-xs text-gray-500">{doc.department_names.join(", ")}</span>
                )}
                <span className="ml-auto">
                  <Pill tone={SOP_STATUS_TONE[doc.status as SopStatus]}>{SOP_STATUS_LABEL[doc.status as SopStatus] ?? doc.status}</Pill>
                </span>
              </header>
              <div className="divide-y divide-gray-100">
                {sections.length === 0 && (
                  <div className="px-4 py-3 text-[13px] text-gray-600">Matched on the SOP title.</div>
                )}
                {sections.map((s) => (
                  <div key={s.key} className="px-4 py-3">
                    <Link href={`/sops/${doc.id}#sec-${s.key}`} className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 hover:text-brand-700">
                      {s.num}. {s.label}
                    </Link>
                    <p className="text-[13px] text-gray-800 mt-1 whitespace-pre-line">{s.snippet}</p>
                  </div>
                ))}
              </div>
              <footer className="flex justify-end px-4 py-2.5 border-t border-gray-100">
                <Link
                  href={`/sops/${doc.id}?tab=feedback&section=${sections[0]?.key ?? "general"}#comment`}
                  className="text-xs text-brand-700 hover:underline"
                >
                  Answer not right? Comment on this SOP
                </Link>
              </footer>
            </article>
          ))}
        </section>

        <aside className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Try asking</h3>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <Link key={s} href={`/sops/ask?q=${encodeURIComponent(s)}`} className="text-sm text-brand-700 hover:underline">
                  {s}
                </Link>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-500 px-1">
            Search runs on this server over the SOP text only. No AI and no external service is used.
          </p>
        </aside>
      </div>
    </Workspace>
  );
}
