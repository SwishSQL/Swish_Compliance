import Link from "next/link";
import { requireUser, canEditSops } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { listFrameworks } from "@/features/frameworks/repository";
import { getUserScope, getScopedIds } from "@/lib/auth/access";
import FilterBar, { STATUS_OPTIONS } from "@/features/filters/FilterBar";
import { frameworkMatches, idParam, loadLineage } from "@/features/filters/lineage";

type Search = {
  search?: string;
  domain?: string;
  category?: string;
  status?: string;
  department?: string;
  brand?: string;
};

export default async function FrameworksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [allFrameworks, lin] = await Promise.all([listFrameworks(), loadLineage()]);
  // Access scoping: non-privileged users only see frameworks in their
  // mapped domains.
  const scope = await getUserScope(user.id, user.role);
  const scopedIds = await getScopedIds(scope);
  const scoped = scopedIds
    ? allFrameworks.filter((f) => scopedIds.frameworkIds.includes(f.id))
    : allFrameworks;

  // Filters (user spec 2026-11-08).
  const q = sp.search?.trim().toLowerCase();
  const filt = { domain: idParam(sp.domain), department: idParam(sp.department), brand: idParam(sp.brand) };
  const categories = [...new Set(scoped.map((f) => f.category).filter((c): c is string => !!c))].sort();
  const frameworks = scoped.filter(
    (f) =>
      (!q || [f.code, f.name, f.category, f.description, f.owner_name].some((v) => v?.toLowerCase().includes(q))) &&
      (!sp.category || f.category === sp.category) &&
      (!sp.status || (sp.status === "active" ? f.is_active : !f.is_active)) &&
      frameworkMatches(lin, f.id, filt)
  );
  const active = frameworks.filter((f) => f.is_active);
  const available = frameworks.filter((f) => !f.is_active);
  const domainOf = new Map(lin.frameworks.map((f) => [f.id, f.domain_id]));
  const visibleDomainIds = new Set(scoped.map((f) => domainOf.get(f.id)));

  // NOTE: the old ECS GRC bundle importer banner is gone (2026-07-07,
  // user decision). It re-imported a legacy 24-framework demo bundle
  // that conflicted with the SOP_GRC workbook GRC: clicking it created
  // duplicate domains (ECS-DOM / HR-DOM / IT-DOM), re-parented 42
  // frameworks away from their workbook domains, and injected 23
  // duplicate checklists with 383 questions. The GRC source of truth
  // is the workbook import now.

  return (
    <Workspace
      section="Compliance Library / Frameworks"
      subtitle={`Compliance programs (${active.length} active / ${frameworks.length} available)`}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {canEditSops(user.role) && (
        <div className="flex justify-end mb-4">
          <Link
            href="/frameworks/new"
            className="inline-flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            + New Framework
          </Link>
        </div>
      )}

      <FilterBar
        action="/frameworks"
        search={sp.search}
        searchPlaceholder="Search by framework name, code, category or owner…"
        selects={[
          { name: "domain", label: "Domain", options: lin.domains.filter((d) => visibleDomainIds.has(d.id)), value: sp.domain },
          { name: "category", label: "Category", options: categories.map((c) => ({ id: c, name: c })), value: sp.category },
          { name: "status", label: "Status", options: STATUS_OPTIONS, value: sp.status },
          { name: "department", label: "Department", options: lin.departments, value: sp.department },
          { name: "brand", label: "Brand", options: lin.brands, value: sp.brand },
        ]}
        count={{ shown: frameworks.length, total: scoped.length, noun: "frameworks" }}
      />

      {/* Active frameworks */}
      <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-3">
        Active frameworks
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {active.length === 0 && (
          <div className="col-span-full bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center text-gray-400 text-sm">
            No active frameworks. Activate one below to start governing controls.
          </div>
        )}
        {active.map((f) => (
          <Card key={f.id} f={f} active />
        ))}
      </div>

      {/* Available */}
      {available.length > 0 && (
        <>
          <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-3">
            Available to activate
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {available.map((f) => (
              <Card key={f.id} f={f} />
            ))}
          </div>
        </>
      )}
    </Workspace>
  );
}

function Card({
  f,
  active,
}: {
  f: Awaited<ReturnType<typeof listFrameworks>>[number];
  active?: boolean;
}) {
  return (
    <Link
      href={`/frameworks/${f.id}`}
      className={`block bg-white rounded-2xl border shadow-sm p-6 hover:shadow-md transition-all ${
        active ? "border-emerald-300 ring-1 ring-emerald-200" : "border-gray-200 hover:border-gray-300"
      }`}
    >
      <div className="flex items-start justify-end gap-3 mb-2">
        {active && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Active
          </span>
        )}
      </div>
      <h3 className="text-base font-semibold text-gray-900 mb-1">{f.name}</h3>
      {f.category && <div className="text-xs text-brand-700 mb-2">{f.category}</div>}
      {f.description && <p className="text-xs text-gray-500 line-clamp-2 mb-3">{f.description}</p>}
      <div className="flex items-center justify-between text-xs text-gray-400 pt-3 border-t border-gray-100">
        <span>{f.control_count} controls</span>
        {f.owner_name && <span>Owner: {f.owner_name}</span>}
      </div>
    </Link>
  );
}
