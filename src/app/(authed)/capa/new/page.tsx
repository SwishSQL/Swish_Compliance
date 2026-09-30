import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { queryAll } from "@/lib/db";
import { createCapaAction } from "@/features/capa/actions";

export default async function NewCapaPage() {
  const user = await requireUser();
  const brands = await queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM brands WHERE is_active = 1 ORDER BY name`
  );
  const departments = await queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM departments WHERE is_active = 1 ORDER BY name`
  );
  const users = await queryAll<{ id: number; display_name: string; email: string }>(
    `SELECT id, display_name, email FROM users WHERE is_active = 1 ORDER BY display_name`
  );

  const due = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  return (
    <Workspace
      section="Assurance / Corrective Actions"
      subtitle="New corrective action"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 max-w-2xl">
        <form action={createCapaAction} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              name="title"
              required
              placeholder="e.g. Re-clean coffee machine and validate procedure"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Description</label>
            <textarea
              name="description"
              rows={3}
              placeholder="What needs to be done and why."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Severity <span className="text-red-500">*</span>
              </label>
              <select
                name="severity"
                required
                defaultValue="medium"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Due date</label>
              <input
                type="date"
                name="due_date"
                defaultValue={due}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Brand</label>
              <select name="brand_id" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">— None —</option>
                {brands.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Department</label>
              <select name="department_id" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">— None —</option>
                {departments.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Assign to</label>
            <select name="assigned_to" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">— Unassigned —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button type="submit" className="bg-brand-700 hover:bg-brand-800 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
              Create CAPA
            </button>
            <Link href="/capa" className="text-sm text-gray-500 hover:text-gray-700">Cancel</Link>
          </div>
        </form>
      </div>
    </Workspace>
  );
}
