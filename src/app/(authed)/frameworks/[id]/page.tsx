import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, canAccessAdmin, canDeleteOrArchive } from "@/lib/auth/guard";
import DeleteEntityButton from "@/features/admin/delete/DeleteEntityButton";
import Workspace from "@/features/shell/Workspace";
import { getFramework } from "@/features/frameworks/repository";
import { listControls } from "@/features/controls/repository";
import { toggleFrameworkAction } from "@/features/frameworks/actions";
import { queryAll, queryOne } from "@/lib/db";
import { HEALTH_LABEL, HEALTH_TONE, HEALTH_DOT } from "@/features/controls/types";

export default async function FrameworkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id: idStr } = await params;
  const id = Number(idStr);
  const fw = await getFramework(id);
  if (!fw) notFound();
  const controls = await listControls({ framework_id: id });
  const isAdmin = canAccessAdmin(user.role);

  // Lineage: which domain this framework belongs to.
  const domain = await queryOne<{ id: number; name: string }>(
    `SELECT d.id, d.name FROM domains d
     JOIN frameworks f ON f.domain_id = d.id WHERE f.id = $1`,
    [id]
  );

  // Cross-references (user spec): SOPs whose home domain is this
  // framework's domain (one-home-domain-per-SOP model) + their departments.
  const fwSops = await queryAll<{ id: number; code: string | null; title: string }>(
    `SELECT s.id, s.code, s.title
     FROM sops s
     WHERE s.home_domain_id = (SELECT domain_id FROM frameworks WHERE id = $1)
     ORDER BY CASE WHEN s.code IS NULL THEN 1 ELSE 0 END, s.code, s.title`,
    [id]
  );
  const fwDepartments = await queryAll<{ id: number; name: string }>(
    `SELECT DISTINCT d.id, d.name
     FROM sops s JOIN departments d ON d.id = s.department_id
     WHERE s.home_domain_id = (SELECT domain_id FROM frameworks WHERE id = $1)
     ORDER BY d.name`,
    [id]
  );

  return (
    <Workspace
      section="Compliance Library / Frameworks"
      subtitle={fw.name}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* Header */}
      <div className={`bg-white rounded-2xl border shadow-sm p-6 mb-4 ${
        fw.is_active ? "border-emerald-300 ring-1 ring-emerald-200" : "border-gray-200"
      }`}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <div className="flex items-center gap-3 mb-2">
              {fw.is_active ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                </span>
              ) : (
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Inactive</span>
              )}
              {fw.category && <span className="text-xs text-brand-700">{fw.category}</span>}
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">{fw.name}</h2>
            {fw.description && <p className="text-sm text-gray-600 max-w-3xl">{fw.description}</p>}
          </div>

          <div className="flex items-center gap-2">
            {isAdmin && (
              <form action={toggleFrameworkAction}>
                <input type="hidden" name="id" value={fw.id} />
                <input type="hidden" name="activate" value={fw.is_active ? "" : "true"} />
                <button
                  type="submit"
                  className={`px-4 py-2 text-sm font-medium rounded-lg ${
                    fw.is_active
                      ? "bg-gray-100 hover:bg-gray-200 text-gray-700"
                      : "bg-brand-700 hover:bg-brand-800 text-white"
                  }`}
                >
                  {fw.is_active ? "Deactivate" : "Activate"}
                </button>
              </form>
            )}
            {canDeleteOrArchive(user.role) && (
              <DeleteEntityButton entityType="framework" entityId={fw.id} label="Framework" />
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm pt-3 border-t border-gray-100">
          <Field label="Domain">
            {domain ? (
              <Link href={`/domains/${domain.id}`} className="text-brand-700 hover:underline">
                {domain.name}
              </Link>
            ) : "—"}
          </Field>
          <Field label="Controls">{fw.control_count} ({fw.active_control_count} active)</Field>
          {/* Prefer audit_frequency (from migration 031) over the legacy
              review_frequency. Fall back so older imported frameworks
              that only have review_frequency still display something. */}
          <Field label="Audit frequency">
            {fw.audit_frequency ?? fw.review_frequency ?? "—"}
          </Field>
          <Field label="Activated">
            {fw.activated_at ? new Date(fw.activated_at).toLocaleDateString() : "—"}
            {fw.activated_by_name && <div className="text-xs text-gray-500">by {fw.activated_by_name}</div>}
          </Field>
        </dl>
      </div>

      {/* Reference / scope panel — shown only when populated */}
      {(fw.reference_source || fw.scope) && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4 space-y-4">
          {fw.reference_source && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-1">
                Reference source / standard
              </div>
              <div className="text-sm text-gray-800">{fw.reference_source}</div>
            </div>
          )}
          {fw.scope && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-1">
                Scope / main controls
              </div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap">{fw.scope}</div>
            </div>
          )}
        </div>
      )}

      {/* Linked controls */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            Controls under this framework ({controls.length})
          </h3>
          <Link
            href={`/controls/new?framework=${fw.id}`}
            className="text-sm text-brand-700 hover:underline"
          >
            + Add control
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Name</th>
              <th className="text-left px-5 py-3 font-medium">Health</th>
              <th className="text-left px-5 py-3 font-medium">Links</th>
            </tr>
          </thead>
          <tbody>
            {controls.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-10 text-center text-gray-400">
                  No controls under this framework yet.
                </td>
              </tr>
            )}
            {controls.map((c) => (
              <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-5 py-3">
                  <Link href={`/controls/${c.id}`} className="font-medium text-brand-700 hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${HEALTH_TONE[c.health_status]}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${HEALTH_DOT[c.health_status]}`} />
                    {HEALTH_LABEL[c.health_status]}
                  </span>
                </td>
                <td className="px-5 py-3 text-xs text-gray-500">
                  {c.linked_sops} SOPs · {c.linked_checks} checks · {c.open_capas} open CAPAs
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cross-reference panels — SOPs + Departments under this framework */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <details className="group bg-white rounded-xl border border-gray-200 shadow-sm">
          <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <span className="transition-transform group-open:rotate-90 text-gray-400">▶</span>
            SOPs ({fwSops.length})
          </summary>
          <ul className="border-t border-gray-100 divide-y divide-gray-100">
            {fwSops.length === 0 && <li className="px-4 py-3 text-xs text-gray-400">No linked SOPs.</li>}
            {fwSops.map((s) => (
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
            Departments ({fwDepartments.length})
          </summary>
          <ul className="border-t border-gray-100 divide-y divide-gray-100">
            {fwDepartments.length === 0 && <li className="px-4 py-3 text-xs text-gray-400">No linked departments.</li>}
            {fwDepartments.map((d) => (
              <li key={d.id} className="px-4 py-2 text-sm text-gray-800">{d.name}</li>
            ))}
          </ul>
        </details>
      </div>

      <Link href="/frameworks" className="inline-block mt-4 text-sm text-gray-500 hover:text-gray-700">
        ← Back to all frameworks
      </Link>
    </Workspace>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-gray-500 mb-0.5">{label}</dt>
      <dd className="text-gray-900">{children}</dd>
    </div>
  );
}
