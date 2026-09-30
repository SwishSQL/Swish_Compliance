import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { queryAll } from "@/lib/db";
import { updateSopAction } from "@/features/sops/actions";
import { getSopById } from "@/features/sops/repository";
import FilePicker from "@/features/sops/FilePicker";
import MultiSelect from "@/features/admin/users/MultiSelect";
import {
  SOP_SECTIONS,
  SOP_STATUS_LABEL,
  SOP_STATUS_TONE,
  canEditSopFields,
} from "@/features/sops/types";

export default async function EditSopPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id: idStr } = await params;
  const id = Number(idStr);
  const sop = await getSopById(id);
  if (!sop) notFound();
  if (!canEditSopFields(user.role, sop.status)) {
    redirect(`/sops/${id}`);
  }

  const brands = await queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM brands WHERE is_active ORDER BY name`
  );
  const departments = await queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM departments WHERE is_active ORDER BY name`
  );

  return (
    <Workspace
      section="Compliance Library / SOPs & Policies"
      subtitle={`Edit: ${sop.title}`}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 max-w-4xl">
        <div className="flex items-center gap-3 mb-5">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${SOP_STATUS_TONE[sop.status]}`}
          >
            {SOP_STATUS_LABEL[sop.status]}
          </span>
          <span className="text-xs text-gray-500">v{sop.version}</span>
        </div>

        <form action={updateSopAction} className="space-y-5">
          <input type="hidden" name="id" value={sop.id} />
          {/* Code isn't shown or editable in the UI anymore, but round-trip
              its existing value so saving other fields doesn't clear it. */}
          {sop.code && <input type="hidden" name="code" value={sop.code} />}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              name="title"
              required
              defaultValue={sop.title}
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
              defaultValue={sop.description ?? ""}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Brand
              </label>
              <select
                name="brand_id"
                defaultValue={
                  sop.brand_is_function
                    ? "__function__"
                    : sop.brand_id
                    ? String(sop.brand_id)
                    : ""
                }
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
                defaultSelected={sop.department_ids}
                placeholder="Select departments…"
              />
              <label className="flex items-center gap-2 text-xs text-gray-600 mt-2">
                <input
                  type="checkbox"
                  name="department_id"
                  value="__all__"
                  defaultChecked={sop.is_all_departments}
                  className="accent-brand-700"
                />
                ✦ Applies to all departments
              </label>
              <p className="text-[11px] text-gray-400 mt-1">
                Ticking &ldquo;all departments&rdquo; covers the whole
                company — including ones added later — and ignores the
                selection above.
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
                defaultValue={sop.effective_date ?? ""}
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
                defaultValue={sop.review_date ?? ""}
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
              defaultValue={sop.file_url ?? ""}
              placeholder="https://swish.sharepoint.com/..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Attachment
            </label>
            {sop.attachment_name && (
              <div className="mb-2 flex items-center gap-3 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <span>📎</span>
                <span className="truncate flex-1">{sop.attachment_name}</span>
                <label className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-800 cursor-pointer">
                  <input
                    type="checkbox"
                    name="remove_attachment"
                    value="true"
                    className="accent-red-600"
                  />
                  Remove on save
                </label>
              </div>
            )}
            <FilePicker name="attachment_file" />
            <p className="text-xs text-gray-500 mt-1">
              Upload a new file to replace the existing one. Leave empty to keep it.
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
                  Edit any of the 10 sections. Each one is optional.
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
                    defaultValue={
                      (sop[sec.key as keyof typeof sop] as string | null) ?? ""
                    }
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
              Save changes
            </button>
            <Link
              href={`/sops/${sop.id}`}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </Link>
            <p className="ml-auto text-[11px] text-gray-400">
              Saving keeps the current status — pick a workflow action from the
              SOP page to move it forward.
            </p>
          </div>
        </form>
      </div>
    </Workspace>
  );
}
