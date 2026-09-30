import { queryAll } from "@/lib/db";
import {
  createDepartmentAction,
  renameDepartmentAction,
  toggleDepartmentAction,
} from "./actions";
import DepartmentManagerSelect from "./DepartmentManagerSelect";
import DeleteEntityButton from "@/features/admin/delete/DeleteEntityButton";

type Row = {
  id: number;
  name: string;
  code: string | null;
  is_active: boolean;
  created_at: string;
  division_name: string | null;
  division_code: string | null;
  parent_name: string | null;
  manager_id: number | null;
  manager_name: string | null;
};
type Staff = { department_id: number; id: number; display_name: string; role: string };

/** Departments tab body — was the whole /admin/departments page before
 *  the admin pages were consolidated into /admin/config's tabs (user
 *  spec 2026-08-17). */
export default async function DepartmentsTabContent() {
  const rows = await queryAll<Row>(
    `SELECT d.id, d.name, d.code, d.is_active, d.created_at,
            dv.name AS division_name, dv.code AS division_code,
            pd.name AS parent_name,
            d.manager_id, mu.display_name AS manager_name
     FROM departments d
     LEFT JOIN divisions dv ON dv.id = d.division_id
     LEFT JOIN departments pd ON pd.id = d.parent_department_id
     LEFT JOIN users mu ON mu.id = d.manager_id
     ORDER BY dv.sort_order NULLS LAST, d.name`
  );
  // Staff mapped to each department (from the user_departments junction).
  const staff = await queryAll<Staff>(
    `SELECT ud.department_id, u.id, u.display_name, u.role
     FROM user_departments ud JOIN users u ON u.id = ud.user_id
     WHERE u.is_active
     ORDER BY u.display_name`
  );
  const staffByDept = new Map<number, Staff[]>();
  for (const s of staff) {
    const list = staffByDept.get(s.department_id) ?? [];
    list.push(s);
    staffByDept.set(s.department_id, list);
  }
  // Candidate managers: prefer department_manager role, but any active
  // user can be picked (some departments are represented by a compliance
  // or BE lead instead).
  const allUsers = await queryAll<{ id: number; display_name: string; role: string }>(
    `SELECT id, display_name, role FROM users WHERE is_active ORDER BY
       (role = 'department_manager') DESC, display_name`
  );

  return (
    <div>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4">
        <form action={createDepartmentAction} className="flex items-end gap-3 max-w-2xl">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              New department name
            </label>
            <input
              type="text"
              name="name"
              required
              placeholder="e.g. Logistics"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <button
            type="submit"
            className="bg-brand-700 hover:bg-brand-800 text-white px-5 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap"
          >
            + Add Department
          </button>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Division</th>
              <th className="text-left px-5 py-3 font-medium">Name</th>
              <th className="text-left px-5 py-3 font-medium">Manager</th>
              <th className="text-left px-5 py-3 font-medium">Staff</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-right px-5 py-3 font-medium w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-gray-400">
                  No departments yet — add the first one above.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const deptStaff = staffByDept.get(row.id) ?? [];
              return (
              <tr key={row.id} className="border-t border-gray-100 align-top">
                <td className="px-5 py-3 text-xs text-gray-600">
                  {row.division_name ? (
                    <span>
                      {row.division_code && (
                        <span className="font-mono text-[10px] text-gray-400 mr-1">{row.division_code}</span>
                      )}
                      {row.division_name}
                    </span>
                  ) : (
                    <span className="text-gray-300">— unassigned —</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <form action={renameDepartmentAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={row.id} />
                    <input
                      type="text"
                      name="name"
                      defaultValue={row.name}
                      className="px-2 py-1 border border-transparent hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 rounded text-sm w-full"
                    />
                    <button type="submit" className="text-xs text-brand-700 hover:underline whitespace-nowrap">
                      Save
                    </button>
                  </form>
                  {row.parent_name && (
                    <div className="text-[10px] text-gray-400 mt-0.5 px-2">↳ under {row.parent_name}</div>
                  )}
                </td>
                <td className="px-5 py-3">
                  <DepartmentManagerSelect
                    departmentId={row.id}
                    managerId={row.manager_id}
                    users={allUsers}
                  />
                </td>
                <td className="px-5 py-3">
                  {deptStaff.length === 0 ? (
                    <span className="text-xs text-gray-300">No staff</span>
                  ) : (
                    <details className="group">
                      <summary className="cursor-pointer list-none text-xs text-brand-700 hover:underline">
                        {deptStaff.length} staff
                      </summary>
                      <ul className="mt-1 space-y-0.5">
                        {deptStaff.map((s) => (
                          <li key={s.id} className="text-xs text-gray-600">
                            {s.display_name}
                            <span className="text-gray-400"> · {s.role.replace("_", " ")}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className="px-5 py-3">
                  {row.is_active ? (
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
                <td className="px-5 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <form action={toggleDepartmentAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="is_active" value={row.is_active ? "" : "on"} />
                      <button
                        type="submit"
                        className={`text-xs px-3 py-1 rounded-lg border transition-colors ${
                          row.is_active
                            ? "border-gray-300 text-gray-600 hover:bg-gray-100"
                            : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        }`}
                      >
                        {row.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </form>
                    <DeleteEntityButton
                      entityType="department"
                      entityId={row.id}
                      label="Department"
                    />
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
