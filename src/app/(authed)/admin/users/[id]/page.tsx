import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin, USER_ROLES } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { queryAll } from "@/lib/db";
import { getUserById, getUserRoles, getOutstandingWork } from "@/features/admin/users/repository";
import {
  updateUserAction,
  resetPasswordAction,
  reassignWorkAction,
} from "@/features/admin/users/actions";
import MultiSelect from "@/features/admin/users/MultiSelect";

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireAdmin();
  const { id } = await params;
  const u = await getUserById(Number(id));
  if (!u) notFound();

  const departments = await queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM departments WHERE is_active = 1 OR id = ANY($1) ORDER BY name`,
    [u.department_ids]
  );

  const isSelf = u.id === me.id;
  const [roles, brands, work, activeUsers] = await Promise.all([
    getUserRoles(u.id),
    queryAll<{ id: number; name: string }>(
      `SELECT id, name FROM brands WHERE is_active = 1 OR id = ANY($1) ORDER BY name`,
      [u.brand_ids.length > 0 ? u.brand_ids : [-1]]
    ),
    getOutstandingWork(u.id),
    queryAll<{ id: number; display_name: string }>(
      `SELECT id, display_name FROM users WHERE is_active = 1 AND id <> $1 ORDER BY display_name`,
      [u.id]
    ),
  ]);
  const extraRoles = roles.filter((r) => r !== u.role);
  const openWork = work.capas + work.audits + work.tests + work.sops;

  return (
    <Workspace
      section="Administration / Users"
      subtitle={u.email}
      sessionLabel="Session"
      userLabel={me.displayName}
    >
      {/* Edit form */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-5">
          Account
        </h3>
        <form action={updateUserAction} className="space-y-5">
          <input type="hidden" name="id" value={u.id} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
              <input
                type="email"
                value={u.email}
                disabled
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Email can&apos;t be changed. Create a new user instead.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Full name</label>
              <input
                type="text"
                name="display_name"
                required
                defaultValue={u.display_name}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Primary role</label>
            <select
              name="role"
              defaultValue={u.role}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              disabled={isSelf}
            >
              {USER_ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            {isSelf && (
              <p className="text-[11px] text-amber-700 mt-1">
                You can&apos;t change your own role.
              </p>
            )}
          </div>


          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Additional roles <span className="text-gray-400">(optional — a user can hold several)</span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {USER_ROLES.map((r) => (
                <label key={r.value} className="flex items-start gap-2 p-2 border border-gray-200 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    name="extra_roles"
                    value={r.value}
                    defaultChecked={extraRoles.includes(r.value)}
                    disabled={isSelf}
                    className="mt-0.5 accent-brand-700"
                  />
                  <span>
                    <span className="font-medium text-gray-900">{r.label}</span>
                    <span className="block text-xs text-gray-500">{r.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <input type="hidden" name="department_ids__present" value="1" />
          <MultiSelect
            name="department_ids"
            label="Departments (multi-select)"
            options={departments}
            defaultSelected={u.department_ids}
            placeholder="Select departments…"
          />
          <input type="hidden" name="brand_ids__present" value="1" />
          <MultiSelect
            name="brand_ids"
            label="Brands (optional — leave empty for all brands)"
            options={brands}
            defaultSelected={u.brand_ids}
            placeholder="All brands"
          />

          <p className="text-xs text-gray-500 -mt-2">
            Department defines what a non-privileged user can see — their
            domains, frameworks, controls and tests all follow from it
            automatically. Brands are unrestricted unless assigned
            elsewhere.
          </p>

          <div>
            <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer ${isSelf ? "opacity-60 cursor-not-allowed" : ""}`}>
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={u.is_active}
                disabled={isSelf}
                className="accent-brand-700"
              />
              <div>
                <div className="text-sm font-medium text-gray-900">Active</div>
                <div className="text-xs text-gray-500">
                  Inactive users can&apos;t sign in. Their history is preserved.
                </div>
              </div>
            </label>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="bg-brand-700 hover:bg-brand-800 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
            >
              Save changes
            </button>
            <Link href="/admin/config?tab=users" className="text-sm text-gray-500 hover:text-gray-700">
              Back to list
            </Link>
          </div>
        </form>
      </div>

      {/* Reset password */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-5">
          Reset password
        </h3>
        <form action={resetPasswordAction} className="flex items-end gap-3 max-w-lg">
          <input type="hidden" name="id" value={u.id} />
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              New password
            </label>
            <input
              type="text"
              name="new_password"
              required
              minLength={6}
              placeholder="At least 6 characters"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
            />
          </div>
          <button
            type="submit"
            className="bg-rose-600 hover:bg-rose-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
          >
            Reset
          </button>
        </form>
        <p className="text-xs text-gray-500 mt-3">
          The user will need to sign in with the new password. Tell them via secure channel.
        </p>
      </div>

      <div className="text-xs text-gray-400 mt-4 px-2 flex gap-6">
        <span>Created: {new Date(u.created_at).toLocaleString()}</span>
        <span>Last login: {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}</span>
      </div>
      {/* Outstanding work — hand it over before deactivating (docs/RBAC.md §10). */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 mt-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-2">
          Outstanding work
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          {work.capas} open CAPA(s) · {work.audits} audit(s) to perform · {work.tests} test(s) owned ·{" "}
          {work.sops} SOP(s) in the workflow
        </p>
        {openWork > 0 && (
          <form action={reassignWorkAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="from_user_id" value={u.id} />
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Reassign all of it to</label>
              <select name="to_user_id" required defaultValue="" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="" disabled>Choose an active user…</option>
                {activeUsers.map((x) => (
                  <option key={x.id} value={x.id}>{x.display_name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
              Reassign work
            </button>
          </form>
        )}
      </div>
    </Workspace>
  );
}
