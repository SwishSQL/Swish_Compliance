import Link from "next/link";
import { requireUser, canEditSops } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { listTemplates } from "@/features/checklists/repository";
import FilterBar, { STATUS_OPTIONS } from "@/features/filters/FilterBar";
import { anyFrameworkMatches, idParam, loadLineage } from "@/features/filters/lineage";

type Search = {
  search?: string;
  domain?: string;
  framework?: string;
  category?: string;
  status?: string;
  department?: string;
  brand?: string;
};

export default async function ChecklistTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const [all, lin] = await Promise.all([listTemplates(sp.search), loadLineage()]);

  // Filters (user spec 2026-11-08). A checklist belongs to the frameworks
  // (and so the domains, departments and brands) of the tests that use it.
  const filt = {
    domain: idParam(sp.domain),
    framework: idParam(sp.framework),
    department: idParam(sp.department),
    brand: idParam(sp.brand),
  };
  const categories = [...new Set(all.map((t) => t.category).filter((c): c is string => !!c))].sort();
  const templates = all.filter(
    (t) =>
      (!sp.category || t.category === sp.category) &&
      (!sp.status || (sp.status === "active" ? t.is_active : !t.is_active)) &&
      anyFrameworkMatches(lin, lin.templateFrameworks.get(t.id) ?? [], filt)
  );
  const frameworkOptions = lin.frameworks.filter((f) => !filt.domain || f.domain_id === filt.domain);

  return (
    <Workspace
      section="Compliance Library / Checklists"
      subtitle={`Audit checklist templates (${templates.length})`}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <FilterBar
        action="/checklists/templates"
        search={sp.search}
        searchPlaceholder="Search by name, code or category…"
        selects={[
          { name: "domain", label: "Domain", options: lin.domains, value: sp.domain },
          { name: "framework", label: "Framework", options: frameworkOptions, value: sp.framework },
          { name: "category", label: "Category", options: categories.map((c) => ({ id: c, name: c })), value: sp.category },
          { name: "status", label: "Status", options: STATUS_OPTIONS, value: sp.status },
          { name: "department", label: "Department", options: lin.departments, value: sp.department },
          { name: "brand", label: "Brand", options: lin.brands, value: sp.brand },
        ]}
        count={{ shown: templates.length, total: all.length, noun: "checklists" }}
      />
      <div className="flex items-center gap-3 justify-end mb-4">
        {canEditSops(user.role) && (
          <Link
            href="/checklists/templates/new"
            className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            + New Template
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.length === 0 && (
          <div className="col-span-full bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center text-gray-400 text-sm">
            No checklist templates yet. Create the first one to start auditing.
          </div>
        )}
        {templates.map((t) => (
          <Link
            key={t.id}
            href={`/checklists/templates/${t.id}`}
            className="block bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300 transition-all p-6"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              {!t.is_active && (
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                  Inactive
                </span>
              )}
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{t.name}</h3>
            {t.category && (
              <div className="text-xs text-brand-700 mb-2">{t.category}</div>
            )}
            {t.description && (
              <p className="text-sm text-gray-500 line-clamp-2 mb-3">{t.description}</p>
            )}
            <div className="text-xs text-gray-400 pt-3 border-t border-gray-100 flex justify-between">
              <span>{t.item_count} items</span>
              <span>Updated {new Date(t.updated_at).toLocaleDateString()}</span>
            </div>
          </Link>
        ))}
      </div>
    </Workspace>
  );
}
