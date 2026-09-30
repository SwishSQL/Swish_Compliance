import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, canDeleteOrArchive } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import {
  getDomain,
  listFrameworksForDomain,
} from "@/features/domains/repository";
import { queryAll } from "@/lib/db";
import DeleteEntityButton from "@/features/admin/delete/DeleteEntityButton";

export default async function DomainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id: idStr } = await params;
  const id = Number(idStr);
  const domain = await getDomain(id);
  if (!domain) notFound();
  const frameworks = await listFrameworksForDomain(id);

  // Cross-references (user spec): each SOP has ONE home domain (derived
  // from its owning department), so a domain shows only its own SOPs +
  // their departments — not every SOP loosely linked via controls.
  const sops = await queryAll<{ id: number; code: string | null; title: string }>(
    `SELECT id, code, title FROM sops WHERE home_domain_id = $1
     ORDER BY CASE WHEN code IS NULL THEN 1 ELSE 0 END, code, title`,
    [id]
  );
  const departments = await queryAll<{ id: number; name: string }>(
    `SELECT DISTINCT d.id, d.name
     FROM sops s JOIN departments d ON d.id = s.department_id
     WHERE s.home_domain_id = $1
     ORDER BY d.name`,
    [id]
  );

  return (
    <Workspace
      section="Compliance Library / Domains"
      subtitle={domain.name}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* Domain header */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-1">
              Domain
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {domain.name}
            </h2>
            {domain.description && (
              <p className="text-sm text-gray-600 max-w-3xl">
                {domain.description}
              </p>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-3">
            <Link
              href="/domains"
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← All domains
            </Link>
            {canDeleteOrArchive(user.role) && (
              <DeleteEntityButton entityType="domain" entityId={domain.id} label="Domain" />
            )}
          </div>
        </div>
      </div>

      {/* How to audit this domain — the workbook's review guidance
          (migration 049). Only rendered for domains that carry it; hand-
          created domains have none. */}
      {(domain.review_scope_method ||
        domain.evidence_to_obtain ||
        domain.review_focus ||
        domain.how_to_verify) && (
        <details className="group bg-white rounded-2xl border border-gray-200 shadow-sm mb-4">
          <summary className="cursor-pointer list-none px-6 py-4 flex items-center gap-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-2xl">
            <span className="transition-transform group-open:rotate-90 text-gray-400">
              ▶
            </span>
            How to audit this domain
          </summary>
          <div className="px-6 pb-5 pt-1 border-t border-gray-100 space-y-4">
            {(
              [
                ["Review scope & method", domain.review_scope_method],
                ["Go to / obtain", domain.evidence_to_obtain],
                ["Review", domain.review_focus],
                ["How to verify", domain.how_to_verify],
              ] as const
            )
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-1.5">
                    {label}
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                    {value}
                  </p>
                </div>
              ))}
          </div>
        </details>
      )}

      {/* Frameworks table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            Frameworks ({frameworks.length})
          </h3>
          <Link
            href={`/frameworks/new?domain=${domain.id}`}
            className="text-sm text-brand-700 hover:underline"
          >
            + New Framework
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Name</th>
              <th className="text-left px-5 py-3 font-medium w-40">Category</th>
              <th className="text-left px-5 py-3 font-medium w-24">Status</th>
            </tr>
          </thead>
          <tbody>
            {frameworks.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-5 py-12 text-center text-gray-400"
                >
                  No frameworks linked to this domain yet.
                </td>
              </tr>
            )}
            {frameworks.map((fw) => (
              <tr
                key={fw.id}
                className={`border-t border-gray-100 hover:bg-gray-50 ${
                  fw.is_active ? "" : "opacity-60"
                }`}
              >
                <td className="px-5 py-3">
                  <Link
                    href={`/frameworks/${fw.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {fw.name}
                  </Link>
                  {fw.description && (
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                      {fw.description}
                    </div>
                  )}
                </td>
                <td className="px-5 py-3 text-xs text-gray-600">
                  {fw.category ?? "—"}
                </td>
                <td className="px-5 py-3">
                  {fw.is_active ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                      Inactive
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cross-reference panels — SOPs + Departments in this domain */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <details className="group bg-white rounded-xl border border-gray-200 shadow-sm">
          <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <span className="transition-transform group-open:rotate-90 text-gray-400">▶</span>
            SOPs ({sops.length})
          </summary>
          <ul className="border-t border-gray-100 divide-y divide-gray-100">
            {sops.length === 0 && <li className="px-4 py-3 text-xs text-gray-400">No linked SOPs.</li>}
            {sops.map((s) => (
              <li key={s.id} className="px-4 py-2 text-sm">
                <Link href={`/sops/${s.id}`} className="text-brand-700 hover:underline">
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </details>
        <details className="group bg-white rounded-xl border border-gray-200 shadow-sm">
          <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <span className="transition-transform group-open:rotate-90 text-gray-400">▶</span>
            Departments ({departments.length})
          </summary>
          <ul className="border-t border-gray-100 divide-y divide-gray-100">
            {departments.length === 0 && <li className="px-4 py-3 text-xs text-gray-400">No linked departments.</li>}
            {departments.map((d) => (
              <li key={d.id} className="px-4 py-2 text-sm text-gray-800">{d.name}</li>
            ))}
          </ul>
        </details>
      </div>
    </Workspace>
  );
}
