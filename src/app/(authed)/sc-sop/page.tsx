import { Fragment } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { feedbackCounts, getRegister } from "@/features/sc-sop/repository";
import { ScTabs, Linked } from "@/features/sc-sop/ui";

export default async function ScSopOverviewPage() {
  const user = await requireUser();
  const [reg, counts] = await Promise.all([getRegister(), feedbackCounts(user.id)]);
  const stepIds = new Set(reg.steps.map((s) => s.id));

  const by = (k: "change" | "fit") =>
    reg.steps.reduce<Record<string, number>>((acc, s) => {
      const v = (s[k] as string) || "—";
      acc[v] = (acc[v] ?? 0) + 1;
      return acc;
    }, {});
  const chg = by("change");
  const fit = by("fit");
  const total = reg.steps.length;
  const stats = [
    { n: reg.procs.length, l: "Processes" },
    { n: total, l: "Steps" },
    { n: chg.New ?? 0, l: "New in To-be" },
    { n: chg.Modify ?? 0, l: "Modified" },
    { n: Object.values(reg.refs).filter((r) => r.t === "Control").length, l: "Controls" },
    { n: counts.open, l: "Open feedback" },
  ];
  const bar = (data: Record<string, number>, order: [string, string][]) => (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
      {order.map(([k, c]) =>
        data[k] ? (
          <div key={k} className={c} style={{ width: `${(data[k] / total) * 100}%` }} title={`${k}: ${data[k]}`} />
        ) : null
      )}
    </div>
  );
  const groups = [...new Set(reg.procs.map((p) => p.grp))];

  return (
    <Workspace
      section="Supply Chain / SOP Review"
      subtitle="Supply Chain SOP — process docket v1.0 · As-is 2026 → To-be 2027"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <ScTabs active="overview" feedbackCount={counts.mine} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
        <section className="space-y-5 min-w-0">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
            <div className="text-[11px] uppercase tracking-widest text-gray-500">Corporate process register · issued 31-Oct-2026</div>
            <h2 className="text-lg font-semibold text-gray-900">
              How Swish supply chain and production work today, and how they must work after the ERP
            </h2>
            <p className="text-sm text-gray-700">{reg.meta.meta.purpose}</p>
            <details className="text-sm text-gray-700">
              <summary className="cursor-pointer text-brand-700">Scope and approach</summary>
              <p className="mt-2">{reg.meta.meta.scope}</p>
              <p className="mt-2">{reg.meta.meta.approach}</p>
            </details>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {stats.map((s) => (
                <div key={s.l} className="rounded-xl border border-gray-200 p-3">
                  <div className="text-xl font-semibold text-gray-900 tabular-nums">{s.n}</div>
                  <div className="text-[11px] text-gray-500">{s.l}</div>
                </div>
              ))}
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Change from today</span>
                  <span>
                    New {chg.New ?? 0} · Modify {chg.Modify ?? 0} · Keep {chg.Keep ?? 0} · Retire {chg.Retire ?? 0}
                  </span>
                </div>
                {bar(chg, [["New", "bg-emerald-600"], ["Modify", "bg-blue-600"], ["Keep", "bg-gray-400"], ["Retire", "bg-red-600"]])}
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>ERP fit</span>
                  <span>
                    Covered {fit.Covered ?? 0} · Partial {fit.Partial ?? 0} · Non-system {fit["Non-system"] ?? 0} · Not covered {fit["Not covered"] ?? 0}
                  </span>
                </div>
                {bar(fit, [["Covered", "bg-emerald-600"], ["Partial", "bg-amber-500"], ["Non-system", "bg-gray-400"], ["Not covered", "bg-red-600"]])}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Process</th>
                  <th className="text-left px-4 py-3 font-medium">Lead</th>
                  <th className="text-right px-4 py-3 font-medium">Steps</th>
                  <th className="text-right px-4 py-3 font-medium">New</th>
                  <th className="text-right px-4 py-3 font-medium">Modify</th>
                  <th className="text-left px-4 py-3 font-medium" title="Covered / Partial / Not covered / Non-system">ERP fit</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g}>
                    <tr className="border-t border-gray-100 bg-gray-50/60">
                      <td colSpan={6} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                        {g}
                      </td>
                    </tr>
                    {reg.procs
                      .filter((p) => p.grp === g)
                      .map((p) => (
                        <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-2">
                            <Link href={`/sc-sop/processes?pa=${p.id}`} className="text-brand-700 hover:underline">
                              <span className="font-mono text-xs text-gray-500 mr-2">{p.id}</span>
                              {p.name}
                            </Link>
                          </td>
                          <td className="px-4 py-2 text-gray-600">{p.lead}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{p.steps}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{p.new}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{p.modify}</td>
                          <td className="px-4 py-2 text-gray-600 tabular-nums">{p.fit}</td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-brand-100 bg-brand-50 p-5 text-sm text-gray-800">
            <h3 className="font-semibold text-brand-800 mb-2">How to review</h3>
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>Open <b>Processes</b> and pick your department to see only your steps, or open a process.</li>
              <li>Each step shows <b>As-is 2026</b> beside <b>To-be 2027</b>, with role, system, controls and ERP fit.</li>
              <li>Not sure what something means? Use <b>Ask the SOP</b>. Answers cite their Step IDs.</li>
              <li>Press <b>Comment</b> on any step. Feedback is saved here and reviewed by the register owner; you are notified when they respond.</li>
            </ol>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Key management decisions</h3>
            <dl className="space-y-2 text-[13px]">
              {reg.meta.polsumm.map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-xs text-gray-500">{k}</dt>
                  <dd className="text-gray-800">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Programme phasing</h3>
            <dl className="space-y-2 text-[13px]">
              {reg.meta.phasing.map(([k, v]) => (
                <div key={k}>
                  <dt className="font-medium text-gray-900">{k}</dt>
                  <dd className="text-gray-700">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Open items for stakeholder attention</h3>
            <ol className="list-decimal pl-5 space-y-1.5 text-[13px] text-gray-800">
              {reg.meta.openitems.map((t) => (
                <li key={t}>
                  <Linked text={t} refs={reg.refs} stepIds={stepIds} />
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </Workspace>
  );
}
