import Link from "next/link";
import { requireUser, canCreateSops } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { listSops } from "@/features/sops/repository";
import { SOP_STATUS_LABEL, SOP_STATUS_TONE, type SopStatus } from "@/features/sops/types";
import { queryOne } from "@/lib/db";
import { getUserScope } from "@/lib/auth/access";
import { importRecruitmentSopAction } from "@/features/admin/seeds/actions";

type Search = { search?: string; status?: SopStatus };

export default async function SopsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const listed = await listSops({
    search: sp.search,
    status: sp.status,
  });
  // Access scoping (user spec): non-privileged users only see SOPs in
  // their department scope. is_all_departments SOPs stay visible to all.
  const scope = await getUserScope(user.id, user.role);
  const rows = scope.full
    ? listed.rows
    : listed.rows.filter(
        (r) =>
          r.is_all_departments ||
          // A SOP can name several departments (migration 052) — seeing any
          // one of them in scope is enough.
          r.department_ids.some((id) => scope.departmentIds.includes(id))
      );
  const total = rows.length;

  // Admin-only: surface the one-click Recruitment SOP importer right on
  // this page (in addition to Admin Home), so it's findable where SOPs
  // actually live. Hide entirely once the seed is in the system.
  const isAdmin = user.role === "admin";
  const seededSop = isAdmin
    ? await queryOne<{ id: number }>(
        `SELECT id FROM sops WHERE code = 'HRD-REC-01' LIMIT 1`
      )
    : null;
  const showImportButton = isAdmin && !seededSop;

  return (
    <Workspace
      section="Compliance Library / SOPs & Policies"
      subtitle="Standard Operating Procedures (SOPs) register"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* Toolbar */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4 flex flex-wrap items-center gap-3 justify-between">
        <form className="flex items-center gap-2 flex-1 max-w-md" method="get">
          <input
            type="text"
            name="search"
            defaultValue={sp.search ?? ""}
            placeholder="Search by title…"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All statuses</option>
            {(Object.keys(SOP_STATUS_LABEL) as SopStatus[]).map((s) => (
              <option key={s} value={s}>
                {SOP_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
          >
            Filter
          </button>
        </form>

        <div className="flex items-center gap-2">
          {showImportButton && (
            <form action={importRecruitmentSopAction}>
              <button
                type="submit"
                title="Import the Recruitment SOP Universal Template (xlsx) as a Draft"
                className="inline-flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-2 rounded-lg text-sm font-medium"
              >
                📥 Import Recruitment SOP
              </button>
            </form>
          )}
          {canCreateSops(user.role) && (
            <Link
              href="/sops/new"
              className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              + New SOP
            </Link>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Title</th>
              <th className="text-left px-5 py-3 font-medium">Brand</th>
              <th className="text-left px-5 py-3 font-medium">Department</th>
              <th className="text-left px-5 py-3 font-medium">Version</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-left px-5 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-gray-400">
                  No SOPs match the current filters.
                </td>
              </tr>
            )}
            {rows.map((sop) => (
              <tr key={sop.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-5 py-3">
                  <Link
                    href={`/sops/${sop.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {sop.title}
                  </Link>
                </td>
                <td className="px-5 py-3 text-gray-600">{sop.brand_name ?? "—"}</td>
                <td className="px-5 py-3 text-gray-600">
                  {sop.is_all_departments
                    ? "✦ All departments"
                    : sop.department_names.length > 0
                      ? sop.department_names.join(", ")
                      : "—"}
                </td>
                <td className="px-5 py-3 text-gray-600">{sop.version}</td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${SOP_STATUS_TONE[sop.status]}`}
                  >
                    {SOP_STATUS_LABEL[sop.status]}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-500 text-xs">
                  {new Date(sop.updated_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-400 mt-3 text-right">
        Showing {rows.length} of {total} SOPs
      </div>
    </Workspace>
  );
}
