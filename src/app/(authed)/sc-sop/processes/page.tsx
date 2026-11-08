import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { feedbackCountByStep, feedbackCounts, getRegister } from "@/features/sc-sop/repository";
import { filterSteps } from "@/features/sc-sop/search";
import { CHANGE_TYPES } from "@/features/sc-sop/types";
import { ScTabs, StepCard } from "@/features/sc-sop/ui";

type Search = { pa?: string; dept?: string; chg?: string; q?: string };

export default async function ScSopProcessesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [reg, counts, perStep] = await Promise.all([getRegister(), feedbackCounts(user.id), feedbackCountByStep()]);
  const stepIds = new Set(reg.steps.map((s) => s.id));
  const procName = Object.fromEntries(reg.procs.map((p) => [p.id, p.name]));

  const filters = { dept: sp.dept || undefined, chg: sp.chg || undefined, q: sp.q?.trim() || undefined };
  const matching = filterSteps(reg.steps, filters);
  const perProc = matching.reduce<Record<string, number>>((a, s) => ((a[s.pa] = (a[s.pa] ?? 0) + 1), a), {});

  const searching = !!filters.q;
  const pa = reg.procs.some((p) => p.id === sp.pa)
    ? sp.pa!
    : reg.procs.find((p) => perProc[p.id])?.id ?? reg.procs[0].id;
  const proc = reg.procs.find((p) => p.id === pa)!;
  const shown = searching ? matching : matching.filter((s) => s.pa === pa);

  const qs = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged = { ...sp, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/sc-sop/processes?${p.toString()}`;
  };
  const groups = [...new Set(reg.procs.map((p) => p.grp))];

  return (
    <Workspace
      section="Supply Chain / SOP Review"
      subtitle="Processes — As-is 2026 → To-be 2027"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <ScTabs active="processes" feedbackCount={counts.mine} />
      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-5">
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <form method="get" className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3 text-sm">
            {sp.pa && <input type="hidden" name="pa" value={sp.pa} />}
            <label className="block">
              <span className="text-xs text-gray-500">Search all steps</span>
              <input
                type="search"
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder="e.g. batch expiry, three-way match, S230"
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">My department</span>
              <select name="dept" defaultValue={sp.dept ?? ""} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">All departments</option>
                {reg.meta.depts.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Change type</span>
              <select name="chg" defaultValue={sp.chg ?? ""} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">All</option>
                {CHANGE_TYPES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="submit" className="flex-1 bg-brand-700 hover:bg-brand-800 text-white px-3 py-2 rounded-lg font-medium">
                Apply
              </button>
              {(sp.q || sp.dept || sp.chg) && (
                <Link href={sp.pa ? `/sc-sop/processes?pa=${sp.pa}` : "/sc-sop/processes"} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">
                  Clear
                </Link>
              )}
            </div>
          </form>

          <nav className="bg-white rounded-2xl border border-gray-200 shadow-sm p-2 text-[13px]" aria-label="Processes">
            {groups.map((g) => (
              <div key={g} className="mb-1">
                <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{g}</div>
                {reg.procs
                  .filter((p) => p.grp === g)
                  .map((p) => {
                    const n = perProc[p.id] ?? 0;
                    const active = !searching && p.id === pa;
                    return (
                      <Link
                        key={p.id}
                        href={qs({ pa: p.id, q: undefined })}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                          active ? "bg-brand-50 text-brand-800 font-medium" : n ? "text-gray-700 hover:bg-gray-50" : "text-gray-400 hover:bg-gray-50"
                        }`}
                      >
                        <span className="font-mono text-[11px] text-gray-500">{p.id}</span>
                        <span className="flex-1 truncate">{p.name}</span>
                        <span className="tabular-nums text-[11px] text-gray-500">{n}</span>
                      </Link>
                    );
                  })}
              </div>
            ))}
          </nav>
        </aside>

        <section className="space-y-4 min-w-0">
          {searching ? (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <div className="text-[11px] uppercase tracking-widest text-gray-500">Search across all processes</div>
              <h2 className="text-lg font-semibold text-gray-900">
                {shown.length} step{shown.length === 1 ? "" : "s"} match “{filters.q}”
              </h2>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-2">
              <div className="text-[11px] uppercase tracking-widest text-gray-500">
                {proc.id} · {proc.grp}
              </div>
              <h2 className="text-lg font-semibold text-gray-900">{proc.name}</h2>
              <p className="text-sm text-gray-700 whitespace-pre-line">{proc.desc}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
                <span>Lead: <b className="text-gray-700">{proc.lead}</b></span>
                <span>{proc.steps} steps · {proc.new} new · {proc.modify} modified · keep/retire {proc.keepRetire}</span>
                <span>ERP fit (C/P/N/NS): {proc.fit}</span>
                {perStep[proc.id] ? <span>{perStep[proc.id]} comment(s) on the whole process</span> : null}
                <Link href={`/sc-sop/feedback?step=${proc.id}`} className="text-brand-700 hover:underline">
                  Comment on the whole process
                </Link>
              </div>
              <div className="text-xs text-gray-500">Departments involved: {proc.depts}</div>
            </div>
          )}

          {shown.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-sm text-gray-400">
              No steps match. Try fewer words or clear the filters.
            </div>
          )}
          {shown.map((s) => (
            <StepCard
              key={s.id}
              s={s}
              refs={reg.refs}
              stepIds={stepIds}
              feedbackCount={perStep[s.id]}
              showProcess={searching}
              processName={procName[s.pa]}
            />
          ))}
        </section>
      </div>
    </Workspace>
  );
}
