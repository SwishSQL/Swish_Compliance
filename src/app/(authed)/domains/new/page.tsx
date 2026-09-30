import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, canEditSops } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { queryAll } from "@/lib/db";
import { createDomainAction } from "@/features/domains/actions";

export default async function NewDomainPage() {
  const user = await requireUser();
  if (!canEditSops(user.role)) redirect("/domains");

  const [sops, departments] = await Promise.all([
    queryAll<{ id: number; code: string | null; title: string }>(
      `SELECT id, code, title FROM sops WHERE status = 'approved' ORDER BY CASE WHEN code IS NULL THEN 1 ELSE 0 END, code, title`
    ),
    queryAll<{ id: number; name: string }>(
      `SELECT id, name FROM departments WHERE is_active = 1 ORDER BY name`
    ),
  ]);

  return (
    <Workspace
      section="Compliance Library / Domains"
      subtitle="New domain"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 max-w-2xl">
        <form action={createDomainAction} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              name="name"
              required
              placeholder="e.g. Customer Escalation Management"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Description
            </label>
            <textarea
              name="description"
              rows={3}
              placeholder="What this domain covers."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="border-t border-gray-100 pt-5">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              SOP-first audit scoping{" "}
              <span className="text-gray-400 normal-case font-normal">(optional)</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Policy / SOP
                </label>
                <select
                  name="sop_id"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">— None —</option>
                  {sops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Department
                </label>
                <select
                  name="department_id"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">— None —</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Set both to make this domain selectable when starting a new audit
              scoped to that SOP + department. Leave empty and the domain still
              works everywhere else — it just won't appear in the audit scope
              picker.
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="bg-brand-700 hover:bg-brand-800 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
            >
              Create domain
            </button>
            <Link href="/domains" className="text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </Workspace>
  );
}
