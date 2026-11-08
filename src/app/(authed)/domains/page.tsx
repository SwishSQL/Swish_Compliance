import Link from "next/link";
import { requireUser, canEditSops, canDeleteOrArchive } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import {
  listDomains,
  listFrameworksByDomain,
  listSopsByDomain,
} from "@/features/domains/repository";
import { getUserScope } from "@/lib/auth/access";
import DomainAccordionGrid from "@/features/domains/DomainAccordionGrid";
import FilterBar, { STATUS_OPTIONS } from "@/features/filters/FilterBar";
import { domainMatches, idParam, loadLineage } from "@/features/filters/lineage";

type Search = { search?: string; status?: string; department?: string; brand?: string };

export default async function DomainsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [allDomains, frameworksByDomain, sopsByDomain, lin] = await Promise.all([
    listDomains(true),
    listFrameworksByDomain(),
    listSopsByDomain(),
    loadLineage(),
  ]);

  // Access scoping: non-privileged users only see their mapped domains.
  const scope = await getUserScope(user.id, user.role);
  const scoped = scope.full
    ? allDomains
    : allDomains.filter((d) => scope.domainIds.includes(d.id));

  // Filters (user spec 2026-11-08). Inactive domains were never listed;
  // they show only when "Inactive" or "Any status" is picked.
  const status = sp.status === "inactive" ? "inactive" : sp.status === "all" ? "all" : "active";
  const q = sp.search?.trim().toLowerCase();
  const filt = { department: idParam(sp.department), brand: idParam(sp.brand) };
  const domains = scoped.filter(
    (d) =>
      (status === "all" || (status === "active" ? d.is_active : !d.is_active)) &&
      (!q || [d.code, d.name, d.description].some((v) => v?.toLowerCase().includes(q))) &&
      domainMatches(lin, d.id, filt)
  );

  // Assemble each domain's expand-in-place data once here, server-side,
  // so DomainAccordionGrid only ever renders — it never fetches.
  const domainsWithDetail = domains.map((d) => {
    const sops = sopsByDomain.get(d.id) ?? [];
    const departments = [
      ...new Map(
        sops
          .filter((s) => s.department_id != null)
          .map((s) => [s.department_id as number, { id: s.department_id as number, name: s.department_name! }])
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name));

    return {
      ...d,
      frameworks: frameworksByDomain.get(d.id) ?? [],
      sops,
      departments,
    };
  });

  return (
    <Workspace
      section="Compliance Library / Domains"
      subtitle={`Compliance domains (${domains.length})`}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <p className="text-sm text-gray-600 max-w-2xl">
          Domains group frameworks by responsibility area. Click a domain to
          expand it and see every framework, SOP and department linked to it.
        </p>
        {canEditSops(user.role) && (
          <Link
            href="/domains/new"
            className="shrink-0 inline-flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            + New Domain
          </Link>
        )}
      </div>

      <FilterBar
        action="/domains"
        search={sp.search}
        searchPlaceholder="Search by domain name, code or description…"
        selects={[
          { name: "status", label: "Status", options: [...STATUS_OPTIONS, { id: "all", name: "Any status" }], value: sp.status },
          { name: "department", label: "Department", options: lin.departments, value: sp.department },
          { name: "brand", label: "Brand", options: lin.brands, value: sp.brand },
        ]}
        count={{ shown: domains.length, total: scoped.length, noun: "domains" }}
      />

      {domains.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center text-gray-400">
          No domains yet. Create the first one to start grouping frameworks by
          responsibility area.
        </div>
      )}

      <DomainAccordionGrid
        domains={domainsWithDetail}
        canEdit={canEditSops(user.role)}
        canDelete={canDeleteOrArchive(user.role)}
      />
    </Workspace>
  );
}
