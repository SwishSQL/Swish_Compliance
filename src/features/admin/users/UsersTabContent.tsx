import { ROLE_LABELS } from "@/lib/auth/permissions";
import Link from "next/link";
import { listUsers } from "./repository";

const ROLE_LABEL: Record<string, string> = ROLE_LABELS;

const ROLE_TONE: Record<string, string> = {
  admin: "bg-rose-50 text-rose-700 border-rose-200",
  ceo: "bg-purple-50 text-purple-700 border-purple-200",
  business_excellence: "bg-indigo-50 text-indigo-700 border-indigo-200",
  compliance: "bg-emerald-50 text-emerald-700 border-emerald-200",
  opex: "bg-teal-50 text-teal-700 border-teal-200",
  department_manager: "bg-sky-50 text-sky-700 border-sky-200",
  auditor: "bg-amber-50 text-amber-700 border-amber-200",
  viewer: "bg-gray-50 text-gray-600 border-gray-200",
  department_member: "bg-gray-50 text-gray-700 border-gray-200",
};

function chips(names: string[]) {
  if (names.length === 0) return <span className="text-xs text-gray-400">—</span>;
  if (names.length <= 2) {
    return (
      <div className="flex flex-wrap gap-1">
        {names.map((n) => (
          <span key={n} className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
            {n}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1" title={names.join(", ")}>
      {names.slice(0, 2).map((n) => (
        <span key={n} className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
          {n}
        </span>
      ))}
      <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
        +{names.length - 2}
      </span>
    </div>
  );
}

/** Users tab body — was the whole /admin/users page before the admin
 *  pages were consolidated into /admin/config's tabs (user spec
 *  2026-08-17). /admin/users/new and /admin/users/[id] stay their own
 *  routes; only the list view moved. */
export default async function UsersTabContent({
  meId,
  search,
}: {
  meId: number;
  search?: string;
}) {
  const users = await listUsers(search);

  return (
    <div>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4 flex items-center gap-3 justify-between">
        <form method="get" className="flex items-center gap-2 flex-1 max-w-md">
          <input type="hidden" name="tab" value="users" />
          <input
            type="text"
            name="search"
            defaultValue={search ?? ""}
            placeholder="Search by email or name…"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">
            Filter
          </button>
        </form>
        <Link
          href="/admin/users/new"
          className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
        >
          + New User
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Email</th>
              <th className="text-left px-5 py-3 font-medium">Name</th>
              <th className="text-left px-5 py-3 font-medium">Role</th>
              <th className="text-left px-5 py-3 font-medium">Brands</th>
              <th className="text-left px-5 py-3 font-medium">Departments</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-left px-5 py-3 font-medium">Last Login</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                  No users found.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-5 py-3">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {u.email}
                  </Link>
                  {u.id === meId && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider bg-brand-50 text-brand-700 px-1.5 py-0.5 rounded">
                      You
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-gray-700">{u.display_name}</td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${ROLE_TONE[u.role] ?? ROLE_TONE.viewer}`}
                  >
                    {ROLE_LABEL[u.role] ?? u.role}
                  </span>
                </td>
                <td className="px-5 py-3">{chips(u.brand_names)}</td>
                <td className="px-5 py-3">{chips(u.department_names)}</td>
                <td className="px-5 py-3">
                  {u.is_active ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                      Inactive
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-xs text-gray-500">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
