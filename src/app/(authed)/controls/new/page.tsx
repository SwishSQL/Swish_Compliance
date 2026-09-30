import Link from "next/link";
import { requireUser, canEditSops } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import Workspace from "@/features/shell/Workspace";
import { queryAll } from "@/lib/db";
import { createControlAction } from "@/features/controls/actions";
import { listOptions } from "@/features/config/repository";

export default async function NewControlPage({
  searchParams,
}: {
  searchParams: Promise<{ framework?: string }>;
}) {
  const user = await requireUser();
  if (!canEditSops(user.role)) redirect("/controls");
  const sp = await searchParams;
  const presetFramework = sp.framework ? Number(sp.framework) : null;

  const frameworks = await queryAll<{ id: number; name: string; code: string }>(
    `SELECT id, name, code FROM frameworks ORDER BY is_active DESC, name`
  );
  const users = await queryAll<{ id: number; display_name: string }>(
    `SELECT id, display_name FROM users WHERE is_active = 1 ORDER BY display_name`
  );
  const categories = await listOptions("control_category", true);

  return (
    <Workspace
      section="Compliance Library / Controls"
      subtitle="New control"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 max-w-2xl">
        <form action={createControlAction} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Name <span className="text-red-500">*</span>
            </label>
            <input name="name" required placeholder="e.g. Maintain cold chain integrity" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Description</label>
            <textarea name="description" rows={3} placeholder="What this control requires." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Framework</label>
              <select name="framework_id" defaultValue={presetFramework ?? ""} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">— None —</option>
                {frameworks.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Owner</label>
              <select name="owner_user_id" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">— Me —</option>
                {users.map((u) => (<option key={u.id} value={u.id}>{u.display_name}</option>))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Category</label>
            {categories.length > 0 ? (
              <select name="category" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">— None —</option>
                {categories.map((c) => (<option key={c.id} value={c.label}>{c.label}</option>))}
              </select>
            ) : (
              <input name="category" placeholder="e.g. Preventive" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            )}
            <p className="text-[11px] text-gray-400 mt-1">
              Manage the list of categories from <span className="font-medium">Admin → Config</span>.
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button type="submit" className="bg-brand-700 hover:bg-brand-800 text-white px-5 py-2.5 rounded-lg text-sm font-medium">Create control</button>
            <Link href="/controls" className="text-sm text-gray-500 hover:text-gray-700">Cancel</Link>
          </div>
        </form>
      </div>
    </Workspace>
  );
}
