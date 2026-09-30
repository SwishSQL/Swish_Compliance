import Link from "next/link";
import { requireAdmin, USER_ROLES } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { queryAll } from "@/lib/db";
import { createUserAction } from "@/features/admin/users/actions";
import MultiSelect from "@/features/admin/users/MultiSelect";

export default async function NewUserPage() {
  const me = await requireAdmin();
  const departments = await queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM departments WHERE is_active = 1 ORDER BY name`
  );

  return (
    <Workspace
      section="Administration / Users"
      subtitle="Create a new user"
      sessionLabel="Session"
      userLabel={me.displayName}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 max-w-3xl">
        <form action={createUserAction} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                name="email"
                required
                placeholder="user@swish.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Full name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="display_name"
                required
                placeholder="Mohamed Ahmed"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Initial password <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="password"
              required
              minLength={6}
              placeholder="At least 6 characters"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
            />
            <p className="text-xs text-gray-500 mt-1">
              The user should change this from their account after first login.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Role <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              {USER_ROLES.map((r) => (
                <label
                  key={r.value}
                  className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 has-checked:bg-brand-50 has-checked:border-brand-300"
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.value}
                    defaultChecked={r.value === "viewer"}
                    className="mt-0.5 accent-brand-700"
                    required
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{r.label}</div>
                    <div className="text-xs text-gray-500">{r.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <MultiSelect
            name="department_ids"
            label="Departments (multi-select)"
            options={departments}
            placeholder="Select one or more departments…"
          />
          <p className="text-xs text-gray-500 -mt-2">
            Department defines what a non-privileged user can see — their
            domains, frameworks, controls and tests all follow from it
            automatically. Brands are unrestricted unless assigned
            elsewhere. Leave empty for admin / compliance / viewer roles
            that don&apos;t need scoping.
          </p>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="bg-brand-700 hover:bg-brand-800 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
            >
              Create user
            </button>
            <Link
              href="/admin/config?tab=users"
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </Workspace>
  );
}
