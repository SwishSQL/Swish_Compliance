import { getUserScope } from "@/lib/auth/access";
import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { listAudits } from "@/features/audits/repository";
import {
  AUDIT_STATUS_LABEL,
  AUDIT_STATUS_TONE,
  type AuditStatus,
} from "@/features/audits/types";

export default async function AuditsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: AuditStatus }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  // Compliance / BE / admin have full visibility over every audit so
  // they can monitor the whole register. Everyone else still sees only
  // audits they created or are assigned to.
  // docs/RBAC.md §8: organisation-wide users see every audit; department
  // managers also see their departments' audits; everyone else sees the
  // audits they created, perform, or are the auditee / reviewer of.
  const scope = await getUserScope(user.id, user);
  const audits = await listAudits({
    search: sp.search,
    status: sp.status,
    scopedToUserId: scope.full ? undefined : user.id,
    scopedDepartmentIds:
      !scope.full && user.permissions.has("capa.monitor") ? scope.departmentIds : undefined,
  });

  return (
    <Workspace
      section="Assurance / Audits"
      subtitle={`Audit executions (${audits.length})`}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4 flex items-center gap-3 justify-between">
        <form method="get" className="flex items-center gap-2 flex-1 max-w-md">
          <input
            type="text"
            name="search"
            defaultValue={sp.search ?? ""}
            placeholder="Search by template, location, control, framework, or domain…"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All statuses</option>
            {(Object.keys(AUDIT_STATUS_LABEL) as AuditStatus[]).map((s) => (
              <option key={s} value={s}>{AUDIT_STATUS_LABEL[s]}</option>
            ))}
          </select>
          <button className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">
            Filter
          </button>
        </form>
        {user.permissions.has("audit.create") && (
          <Link
            href="/audits/new"
            className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            + New Audit
          </Link>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Audit Scope</th>
              <th className="text-left px-5 py-3 font-medium">Brand / Dept</th>
              <th className="text-left px-5 py-3 font-medium">Location</th>
              <th className="text-left px-5 py-3 font-medium">Auditor</th>
              <th className="text-left px-5 py-3 font-medium">Date</th>
              <th className="text-left px-5 py-3 font-medium">Score</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {audits.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                  No audits yet. Click <span className="font-medium text-brand-700">+ New Audit</span> to start one.
                </td>
              </tr>
            )}
            {audits.map((a) => (
              <tr key={a.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-5 py-3">
                  {/* Two render paths depending on how the audit was
                      created:
                       - New flow (post-migration 038): show the
                         Domain → Framework → Control chain + test count
                         as the primary label; template_name is NULL.
                       - Legacy flow: fall back to the template name,
                         like the old column. */}
                  <Link
                    href={`/audits/${a.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {a.control_name ?? a.framework_name ?? a.template_name ??
                      `Audit — ${a.department_name ?? "Unscoped"} (${new Date(a.audit_date).toLocaleDateString()})`}
                  </Link>
                  {(a.domain_name || a.framework_code || a.test_count > 0) ? (
                    <div className="text-[11px] text-gray-500 mt-0.5 truncate max-w-md">
                      {[
                        a.domain_code ?? a.domain_name,
                        a.framework_code ?? a.framework_name,
                        a.test_count > 0
                          ? `${a.test_count} test${a.test_count === 1 ? "" : "s"}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  ) : a.template_category ? (
                    <div className="text-[11px] text-gray-500">{a.template_category}</div>
                  ) : null}
                </td>
                <td className="px-5 py-3 text-gray-600 text-xs">
                  {a.brand_name ?? "—"}
                  {a.department_name && <div className="text-gray-400">{a.department_name}</div>}
                </td>
                <td className="px-5 py-3 text-gray-600 text-xs">{a.location ?? "—"}</td>
                <td className="px-5 py-3 text-gray-600 text-xs">{a.auditor_name ?? "—"}</td>
                <td className="px-5 py-3 text-gray-500 text-xs">{new Date(a.audit_date).toLocaleDateString()}</td>
                <td className="px-5 py-3">
                  {a.score !== null ? (
                    <span
                      className={`font-semibold ${
                        Number(a.score) >= 90 ? "text-emerald-700" :
                        Number(a.score) >= 70 ? "text-amber-700" :
                        "text-red-700"
                      }`}
                    >
                      {Number(a.score).toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-gray-400 text-xs">—</span>
                  )}
                  {a.critical_failed > 0 && (
                    <div className="text-[10px] text-red-600 uppercase tracking-wider mt-0.5">
                      {a.critical_failed} critical
                    </div>
                  )}
                </td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${AUDIT_STATUS_TONE[a.status]}`}>
                    {AUDIT_STATUS_LABEL[a.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Workspace>
  );
}
