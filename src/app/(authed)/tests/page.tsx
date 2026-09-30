import Link from "next/link";
import { requireUser, canEditSops } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { listChecks } from "@/features/checks/repository";
import { CHECK_STATUS_LABEL, CHECK_STATUS_TONE, FREQUENCY_LABEL, type CheckStatus } from "@/features/checks/types";
import { queryAll } from "@/lib/db";
import { getUserScope, getScopedIds } from "@/lib/auth/access";
import { createCheckAction } from "@/features/checks/actions";

export default async function TestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: CheckStatus; checklist?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const checklistFilter = sp.checklist ? Number(sp.checklist) : undefined;
  const allChecks = await listChecks({
    status: sp.status,
    checklistTemplateId:
      Number.isFinite(checklistFilter) && checklistFilter ? checklistFilter : undefined,
  });
  // Access scoping: non-privileged users only see tests whose control is
  // under a framework in their mapped domains.
  const scope = await getUserScope(user.id, user.role);
  const scopedIds = await getScopedIds(scope);
  const checks = scopedIds
    ? allChecks.filter(
        (ch) => ch.control_id != null && scopedIds.controlIds.includes(ch.control_id)
      )
    : allChecks;
  const canEdit = canEditSops(user.role);
  const controls = canEdit
    ? await queryAll<{ id: number; name: string }>(
        `SELECT id, name FROM controls WHERE is_active = 1 ORDER BY name`
      )
    : [];

  // Always load active checklist templates — they power both the create
  // form's dropdown (for admins) and the filter dropdown (for everyone).
  const checklists = await queryAll<{ id: number; name: string; category: string | null }>(
    `SELECT id, name, category
     FROM checklist_templates
     WHERE is_active = 1
     ORDER BY name`
  );

  const today = new Date().toISOString().split("T")[0];

  return (
    <Workspace
      section="Compliance Library / Tests"
      subtitle={`Compliance tests (${checks.length})`}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* Filter chips — status */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {(["failing", "pending_review", "passing", "accepted_risk"] as CheckStatus[]).map((s) => {
          // Preserve the checklist filter when toggling status
          const params = new URLSearchParams();
          if (sp.status !== s) params.set("status", s);
          if (checklistFilter) params.set("checklist", String(checklistFilter));
          const href = params.toString() ? `/tests?${params.toString()}` : "/tests";
          return (
            <Link
              key={s}
              href={href}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                sp.status === s
                  ? CHECK_STATUS_TONE[s]
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {CHECK_STATUS_LABEL[s]}
            </Link>
          );
        })}
        {(sp.status || checklistFilter) && (
          <Link href="/tests" className="text-xs text-gray-500 self-center hover:text-gray-700">
            Clear all
          </Link>
        )}
      </div>

      {/* Checklist filter — GET form so the choice is just a query param */}
      <form method="GET" action="/tests" className="flex items-center gap-2 mb-4 flex-wrap">
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        <label className="text-xs font-medium text-gray-600 uppercase tracking-wider">
          Checklist
        </label>
        <select
          name="checklist"
          defaultValue={checklistFilter ? String(checklistFilter) : ""}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">— All checklists —</option>
          {checklists.map((cl) => (
            <option key={cl.id} value={cl.id}>
              {cl.name}
              {cl.category ? ` · ${cl.category}` : ""}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="px-3 py-1.5 text-xs font-medium text-brand-700 border border-brand-200 bg-brand-50 hover:bg-brand-100 rounded-lg"
        >
          Apply
        </button>
        {checklistFilter && (
          <Link
            href={sp.status ? `/tests?status=${sp.status}` : "/tests"}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Reset checklist
          </Link>
        )}
      </form>

      {/* List */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Name</th>
              <th className="text-left px-5 py-3 font-medium">Checklist</th>
              <th className="text-left px-5 py-3 font-medium">Control</th>
              <th className="text-left px-5 py-3 font-medium">Frequency</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-left px-5 py-3 font-medium">Last run</th>
              <th className="text-left px-5 py-3 font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {checks.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                  No checks yet. {canEdit && "Use the form below to create the first one."}
                </td>
              </tr>
            )}
            {checks.map((ch) => {
              const overdue = ch.next_due_date && ch.next_due_date < today;
              return (
                <tr key={ch.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <Link href={`/tests/${ch.id}`} className="font-medium text-brand-700 hover:underline">
                      {ch.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-600 text-xs">
                    {ch.checklist_template_id ? (
                      <Link
                        href={`/checklists/templates/${ch.checklist_template_id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {ch.checklist_template_name}
                      </Link>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-600 text-xs">{ch.control_name ?? "—"}</td>
                  <td className="px-5 py-3 text-gray-600 text-xs">{FREQUENCY_LABEL[ch.frequency]}</td>
                  <td className="px-5 py-3">
                    {ch.last_status ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${CHECK_STATUS_TONE[ch.last_status]}`}>
                        {CHECK_STATUS_LABEL[ch.last_status]}
                      </span>
                    ) : <span className="text-xs text-gray-400">Never run</span>}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">{ch.last_result_at ? new Date(ch.last_result_at).toLocaleDateString() : "—"}</td>
                  <td className="px-5 py-3 text-xs">
                    {ch.next_due_date ? (
                      <span className={overdue ? "text-red-700 font-medium" : "text-gray-600"}>
                        {new Date(ch.next_due_date).toLocaleDateString()}
                        {overdue && <span className="block text-[10px] uppercase tracking-wider">Overdue</span>}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Inline create */}
      {canEdit && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Create a new check</h3>
          <form action={createCheckAction} className="space-y-4">
            <input name="name" required placeholder="Name * (e.g. Weekly fridge temperature log)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <input name="description" placeholder="Description (optional)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Control</label>
                <select name="control_id" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="">— No control —</option>
                  {controls.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Checklist</label>
                <select
                  name="checklist_template_id"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  defaultValue={checklistFilter ? String(checklistFilter) : ""}
                >
                  <option value="">— No checklist —</option>
                  {checklists.map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {cl.name}
                      {cl.category ? ` · ${cl.category}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Frequency</label>
                <select name="frequency" defaultValue="monthly" required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                  <option value="on_demand">On demand</option>
                </select>
              </div>
              <button type="submit" className="bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-sm font-medium px-4 py-2">
                + Create check
              </button>
            </div>
          </form>
        </div>
      )}
    </Workspace>
  );
}
