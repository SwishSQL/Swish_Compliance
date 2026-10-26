import Link from "next/link";
import { requireUser, canEditSops } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { listControls, listControlRates } from "@/features/controls/repository";
import ControlRatesBadges from "@/features/controls/ControlRatesBadges";
import { listFrameworks } from "@/features/frameworks/repository";
import { getUserScope, getScopedIds } from "@/lib/auth/access";
import { recomputeAllControlsAction } from "@/features/controls/actions";
import {
  HEALTH_LABEL,
  HEALTH_TONE,
  HEALTH_DOT,
  type ControlHealth,
} from "@/features/controls/types";

export default async function ControlsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; health?: ControlHealth; framework?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const allControls = await listControls({
    search: sp.search,
    health: sp.health,
    framework_id: sp.framework ? Number(sp.framework) : undefined,
  });
  // Access scoping: non-privileged users only see controls under
  // frameworks in their mapped domains.
  const scope = await getUserScope(user.id, user.role);
  const scopedIds = await getScopedIds(scope);
  const controls = scopedIds
    ? allControls.filter(
        (c) => c.framework_id != null && scopedIds.frameworkIds.includes(c.framework_id)
      )
    : allControls;
  const frameworks = await listFrameworks();
  const rates = await listControlRates();

  return (
    <Workspace
      section="Compliance Library / Controls"
      subtitle={`Reusable compliance controls (${controls.length})`}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4 flex items-center gap-3 justify-between flex-wrap">
        <form method="get" className="flex items-center gap-2 flex-1 max-w-2xl">
          <input
            type="text"
            name="search"
            defaultValue={sp.search ?? ""}
            placeholder="Search…"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <select
            name="framework"
            defaultValue={sp.framework ?? ""}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All frameworks</option>
            {frameworks.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <select
            name="health"
            defaultValue={sp.health ?? ""}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All health</option>
            <option value="failing">Failing</option>
            <option value="at_risk">At risk</option>
            <option value="healthy">Healthy</option>
            <option value="unknown">Not measured</option>
          </select>
          <button className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">Filter</button>
        </form>
        <div className="flex gap-2">
          <form action={recomputeAllControlsAction}>
            <button className="px-3 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg text-sm">
              ↻ Recompute health
            </button>
          </form>
          {canEditSops(user.role) && (
            <Link
              href="/controls/new"
              className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              + New Control
            </Link>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Name</th>
              <th className="text-left px-5 py-3 font-medium">Framework</th>
              <th className="text-left px-5 py-3 font-medium">Owner</th>
              <th className="text-left px-5 py-3 font-medium">Health</th>
              <th className="text-left px-5 py-3 font-medium">Success / Failure / N/A</th>
              <th className="text-left px-5 py-3 font-medium">Linked</th>
            </tr>
          </thead>
          <tbody>
            {controls.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-gray-400">
                  No controls match the filter.
                </td>
              </tr>
            )}
            {controls.map((c) => (
              <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-5 py-3">
                  <Link href={`/controls/${c.id}`} className="font-medium text-brand-700 hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-5 py-3 text-gray-600 text-xs">
                  {c.framework_name ? (
                    <Link href={`/frameworks/${c.framework_id}`} className="hover:underline">{c.framework_name}</Link>
                  ) : "—"}
                </td>
                <td className="px-5 py-3 text-gray-600">{c.owner_name ?? "—"}</td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${HEALTH_TONE[c.health_status]}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${HEALTH_DOT[c.health_status]}`} />
                    {HEALTH_LABEL[c.health_status]}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <ControlRatesBadges rates={rates.get(c.id)} />
                </td>
                <td className="px-5 py-3 text-xs text-gray-500">
                  {c.linked_sops} SOPs · {c.linked_checks} checks · {c.open_capas} CAPAs
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Workspace>
  );
}
