import Link from "next/link";
import { requireUser, canCreateSops } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import Workspace from "@/features/shell/Workspace";
import { queryAll } from "@/lib/db";
import { createSopAction } from "@/features/sops/actions";
import FilePicker from "@/features/sops/FilePicker";
import MultiSelect from "@/features/admin/users/MultiSelect";
import { SOP_SECTIONS } from "@/features/sops/types";

export default async function NewSopPage() {
  const user = await requireUser();
  if (!canCreateSops(user.role)) redirect("/sops");

  const brands = await queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM brands WHERE is_active ORDER BY name`
  );
  const departments = await queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM departments WHERE is_active ORDER BY name`
  );

  return (
    <Workspace
      section="Compliance Library / SOPs & Policies"
      subtitle="Create a new Standard Operating Procedure"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 max-w-4xl">
        <form action={createSopAction} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              name="title"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Description
            </label>
            <textarea
              name="description"
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Version
              </label>
              <input
                name="version"
                defaultValue="1.0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Brand
              </label>
              <select
                name="brand_id"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">—</option>
                <option value="__function__">✦ Brand / Function (cross-brand)</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <MultiSelect
                name="department_ids"
                label="Departments"
                options={departments}
                placeholder="Select departments…"
              />
              <label className="flex items-center gap-2 text-xs text-gray-600 mt-2">
                <input
                  type="checkbox"
                  name="department_id"
                  value="__all__"
                  className="accent-brand-700"
                />
                ✦ Applies to all departments
              </label>
              <p className="text-[11px] text-gray-400 mt-1">
                Pick every department this SOP applies to, or tick
                &ldquo;all departments&rdquo; to cover the whole company —
                including ones added later.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Effective date
              </label>
              <input
                type="date"
                name="effective_date"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Next review date
              </label>
              <input
                type="date"
                name="review_date"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              File URL (SharePoint / OneDrive link)
            </label>
            <input
              type="url"
              name="file_url"
              placeholder="https://swish.sharepoint.com/..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Attachment (optional)
            </label>
            <FilePicker name="attachment_file" />
            <p className="text-xs text-gray-500 mt-1">
              Upload the actual SOP document (Word / PDF / Excel) or a reference image. Max 10 MB.
            </p>
          </div>

          {/* ── Structured SOP content (Universal Template) ──────────── */}
          <details className="border border-gray-200 rounded-xl overflow-hidden" open>
            <summary className="cursor-pointer select-none px-5 py-4 bg-gradient-to-r from-brand-50 to-emerald-50/50 hover:from-brand-100 hover:to-emerald-50 transition-colors flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-brand-800">
                  📝 SOP structured content (Universal Template)
                </div>
                <div className="text-[11px] text-brand-700/80 mt-0.5">
                  Fill in any sections you have ready. Each one is optional — leave blank if you only want to upload the document above.
                </div>
              </div>
              <span className="text-xs text-brand-700 font-medium">click to collapse</span>
            </summary>

            <div className="p-5 space-y-5 border-t border-gray-200 bg-white">
              {SOP_SECTIONS.map((sec) => (
                <div key={sec.key}>
                  <label className="block mb-1.5">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-7 h-7 rounded-md bg-brand-700 text-white text-xs font-bold flex items-center justify-center shrink-0">
                        {sec.num}
                      </span>
                      <span className="text-sm font-semibold text-gray-800 tracking-wide">
                        {sec.label}
                      </span>
                    </span>
                    <span className="block text-[11px] text-gray-500 mt-1 ml-9">
                      {sec.hint}
                    </span>
                  </label>
                  <textarea
                    name={sec.key}
                    rows={5}
                    placeholder={`Paste the ${sec.label.toLowerCase()} content here...`}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono leading-relaxed"
                  />
                </div>
              ))}
            </div>
          </details>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="bg-brand-700 hover:bg-brand-800 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
            >
              Create SOP
            </button>
            <Link
              href="/sops"
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
