import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, canEditSops } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { queryAll } from "@/lib/db";
import { createFrameworkAction } from "@/features/frameworks/actions";
import { listOptions } from "@/features/config/repository";

export default async function NewFrameworkPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string }>;
}) {
  const user = await requireUser();
  if (!canEditSops(user.role)) redirect("/frameworks");
  const sp = await searchParams;
  const presetDomain = sp.domain ? Number(sp.domain) : null;

  const [domains, sops, departments, users, categories] = await Promise.all([
    queryAll<{ id: number; code: string; name: string }>(
      `SELECT id, code, name FROM domains WHERE is_active = 1 ORDER BY sort_order, name`
    ),
    queryAll<{ id: number; code: string | null; title: string }>(
      `SELECT id, code, title FROM sops WHERE status = 'approved' ORDER BY CASE WHEN code IS NULL THEN 1 ELSE 0 END, code, title`
    ),
    queryAll<{ id: number; name: string }>(
      `SELECT id, name FROM departments WHERE is_active = 1 ORDER BY name`
    ),
    queryAll<{ id: number; display_name: string }>(
      `SELECT id, display_name FROM users WHERE is_active = 1 ORDER BY display_name`
    ),
    listOptions("framework_category", true),
  ]);

  return (
    <Workspace
      section="Compliance Library / Frameworks"
      subtitle="New framework"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 max-w-2xl">
        <form action={createFrameworkAction} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              name="name"
              required
              placeholder="e.g. Escalation Handling Framework"
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
              placeholder="What this framework covers."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Domain
              </label>
              <select
                name="domain_id"
                defaultValue={presetDomain ?? ""}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">— None —</option>
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Owner
              </label>
              <select
                name="owner_user_id"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">— None —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Category
              </label>
              {categories.length > 0 ? (
                <select
                  name="category"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">— None —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.label}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name="category"
                  placeholder="e.g. Customer Experience"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Audit frequency
              </label>
              <input
                name="audit_frequency"
                placeholder="e.g. Monthly / Quarterly"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Owner label{" "}
              <span className="text-gray-400 font-normal">(role/team, if not a specific user)</span>
            </label>
            <input
              name="owner_label"
              placeholder="e.g. Complaints Operations Manager"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              name="is_active"
              value="true"
              defaultChecked
              className="rounded border-gray-300 accent-brand-700"
            />
            Active — immediately in scope for controls, reporting and audits
          </label>

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
              Only needed when this framework's SOP/department differs from
              its domain's — a Framework Audit resolves them from the domain
              when left empty here.
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="bg-brand-700 hover:bg-brand-800 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
            >
              Create framework
            </button>
            <Link href="/frameworks" className="text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </Workspace>
  );
}
