import Link from "next/link";
import { requireUser, canEditSops } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import Workspace from "@/features/shell/Workspace";
import { createTemplateAction } from "@/features/checklists/actions";
import { CHECKLIST_CATEGORIES_FALLBACK } from "@/features/checklists/types";
import { listOptions } from "@/features/config/repository";

export default async function NewTemplatePage() {
  const user = await requireUser();
  if (!canEditSops(user)) redirect("/checklists/templates");

  const dbCategories = await listOptions("checklist_category", true);
  const categories =
    dbCategories.length > 0
      ? dbCategories.map((o) => o.label)
      : CHECKLIST_CATEGORIES_FALLBACK;

  return (
    <Workspace
      section="Compliance Library / Checklists"
      subtitle="New checklist template"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 max-w-2xl">
        <form action={createTemplateAction} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              name="name"
              required
              placeholder="Weekly Kitchen Deep-Clean Audit"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Category
            </label>
            <select
              name="category"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Description
            </label>
            <textarea
              name="description"
              rows={4}
              placeholder="What this audit covers and how often it should be run."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="bg-brand-700 hover:bg-brand-800 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
            >
              Create template
            </button>
            <Link href="/checklists/templates" className="text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </Link>
          </div>

          <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">
            You will add the checklist items (questions) on the next screen.
          </p>
        </form>
      </div>
    </Workspace>
  );
}
