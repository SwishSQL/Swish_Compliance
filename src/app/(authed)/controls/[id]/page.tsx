import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, canEditSops, canDeleteOrArchive } from "@/lib/auth/guard";
import DeleteEntityButton from "@/features/admin/delete/DeleteEntityButton";
import Workspace from "@/features/shell/Workspace";
import {
  getControl,
  listControlLinks,
} from "@/features/controls/repository";
import {
  linkControlAction,
  unlinkControlAction,
  updateControlAction,
} from "@/features/controls/actions";
import {
  HEALTH_LABEL,
  HEALTH_TONE,
  HEALTH_DOT,
} from "@/features/controls/types";
import { queryAll, queryOne } from "@/lib/db";
import AssignTestModal from "@/features/checks/AssignTestModal";
import { listOrgUnitOptions } from "@/features/org-units/repository";

export default async function ControlDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id: idStr } = await params;
  const id = Number(idStr);
  const ctrl = await getControl(id);
  if (!ctrl) notFound();
  const links = await listControlLinks(id);
  const canEdit = canEditSops(user.role) || user.role === "compliance";

  // Full lineage for the header — the domain comes via the framework.
  const lineage = ctrl.framework_id
    ? await queryOne<{ domain_id: number | null; domain_name: string | null }>(
        `SELECT d.id AS domain_id, d.name AS domain_name
         FROM frameworks f LEFT JOIN domains d ON d.id = f.domain_id
         WHERE f.id = $1`,
        [ctrl.framework_id]
      )
    : null;

  const STANDARD_FREQUENCIES = [
    "Daily", "Weekly", "Monthly", "Quarterly", "Annual", "On demand",
  ];
  const frequencyOptions =
    ctrl.frequency && !STANDARD_FREQUENCIES.includes(ctrl.frequency)
      ? [ctrl.frequency, ...STANDARD_FREQUENCIES]
      : STANDARD_FREQUENCIES;

  // Option C fix: also fetch checks that are linked via the DIRECT
  // foreign key checks.control_id (this is how the ECS GRC import wires
  // them up), not just the control_links junction table.
  const directChecks = await queryAll<{
    id: number;
    code: string | null;
    name: string;
    description: string | null;
    frequency: string;
    last_status: string | null;
    question_count: number;
  }>(
    `SELECT TOP (100) ch.id, ch.code, ch.name, ch.description, ch.frequency, ch.last_status,
       (SELECT COUNT(*) FROM check_checklist_items cci WHERE cci.check_id = ch.id) AS question_count
     FROM checks ch
     WHERE ch.control_id = $1
     ORDER BY CASE WHEN ch.code IS NULL THEN 1 ELSE 0 END, ch.code, ch.name`,
    [id]
  );

  // Audiences for the per-row "Assign" modal on each Test in the table
  // below — Auditors and Department Managers, resolved once and passed
  // to every modal so opening one doesn't trigger a network round-trip.
  const [auditors, departmentManagers, modalBrands, modalDepartments, modalOrgUnits] =
    await Promise.all([
      queryAll<{ id: number; display_name: string }>(
        `SELECT id, display_name FROM users
         WHERE is_active = 1 AND role = 'auditor'
         ORDER BY display_name`
      ),
      queryAll<{ id: number; display_name: string }>(
        `SELECT id, display_name FROM users
         WHERE is_active = 1 AND role = 'department_manager'
         ORDER BY display_name`
      ),
      queryAll<{ id: number; name: string }>(
        `SELECT id, name FROM brands WHERE is_active = 1 ORDER BY name`
      ),
      queryAll<{ id: number; name: string }>(
        `SELECT id, name FROM departments WHERE is_active = 1 ORDER BY name`
      ),
      listOrgUnitOptions(),
    ]);

  const sops = canEdit
    ? await queryAll<{ id: number; title: string }>(
        `SELECT TOP (50) id, title FROM sops WHERE id NOT IN (
           SELECT entity_id FROM control_links WHERE control_id = $1 AND entity_type = 'sop'
         ) ORDER BY title`,
        [id]
      )
    : [];
  const checks = canEdit
    ? await queryAll<{ id: number; name: string }>(
        `SELECT TOP (50) id, name FROM checks WHERE id NOT IN (
           SELECT entity_id FROM control_links WHERE control_id = $1 AND entity_type = 'check'
         ) ORDER BY name`,
        [id]
      )
    : [];

  const linksByType = {
    sop: links.filter((l) => l.entity_type === "sop"),
    check: links.filter((l) => l.entity_type === "check"),
    audit: links.filter((l) => l.entity_type === "audit"),
    capa: links.filter((l) => l.entity_type === "capa"),
  };

  return (
    <Workspace
      section="Compliance Library / Controls"
      subtitle={ctrl.name}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${HEALTH_TONE[ctrl.health_status]}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${HEALTH_DOT[ctrl.health_status]}`} />
                {HEALTH_LABEL[ctrl.health_status]}
              </span>
              {ctrl.framework_name && (
                <Link href={`/frameworks/${ctrl.framework_id}`} className="text-xs text-brand-700 hover:underline">
                  {ctrl.framework_name}
                </Link>
              )}
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">{ctrl.name}</h2>
            {ctrl.description && <p className="text-xs text-gray-600 max-w-3xl">{ctrl.description}</p>}
          </div>
          {canDeleteOrArchive(user.role) && (
            <DeleteEntityButton entityType="control" entityId={ctrl.id} label="Control" />
          )}
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm pt-3 border-t border-gray-100">
          <Field label="Domain">
            {lineage?.domain_id ? (
              <Link href={`/domains/${lineage.domain_id}`} className="text-brand-700 hover:underline">
                {lineage.domain_name}
              </Link>
            ) : "—"}
          </Field>
          <Field label="Framework">
            {ctrl.framework_id ? (
              <Link href={`/frameworks/${ctrl.framework_id}`} className="text-brand-700 hover:underline">
                {ctrl.framework_name ?? ctrl.framework_code}
              </Link>
            ) : "—"}
          </Field>
          <Field label="Category">{ctrl.category ?? "—"}</Field>
          <Field label="Control type">{ctrl.control_type ?? "—"}</Field>
          <Field label="Frequency">{ctrl.frequency ?? "—"}</Field>
          <Field label="Risk weight">
            {ctrl.risk_weight ? (
              <span className={`inline-flex items-center gap-1.5`}>
                <span className="font-bold tabular-nums">{ctrl.risk_weight}</span>
                <span className="text-gray-400 text-xs">/ 5</span>
              </span>
            ) : "—"}
          </Field>
          <Field label="Linked SOPs">{ctrl.linked_sops}</Field>
          <Field label="Linked checks">{ctrl.linked_checks}</Field>
          <Field label="Open CAPAs">{ctrl.open_capas}</Field>
        </dl>
      </div>

      {/* Edit panel — native <details> collapse, no client JS. Gated to
          the same roles that may edit SOPs, plus compliance. */}
      {canEdit && (
        <details className="group bg-white rounded-2xl border border-gray-200 shadow-sm mb-4 overflow-hidden">
          <summary className="cursor-pointer list-none px-6 py-4 flex items-center gap-2 hover:bg-gray-50">
            <span className="text-gray-400 transition-transform group-open:rotate-90 select-none">▶</span>
            <span className="text-sm font-semibold text-gray-700">✏️ Edit control details</span>
          </summary>
          <form action={updateControlAction} className="px-6 pb-6 pt-2 space-y-4 border-t border-gray-100">
            <input type="hidden" name="id" value={ctrl.id} />
            {/* Owner isn't shown in the UI anymore, but round-trip its
                existing value so saving other fields doesn't clear it. */}
            {ctrl.owner_user_id != null && (
              <input type="hidden" name="owner_user_id" value={ctrl.owner_user_id} />
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  name="name"
                  defaultValue={ctrl.name}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Description</label>
                <textarea
                  name="description"
                  defaultValue={ctrl.description ?? ""}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Category</label>
                <input
                  name="category"
                  defaultValue={ctrl.category ?? ""}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Control type</label>
                <input
                  name="control_type"
                  defaultValue={ctrl.control_type ?? ""}
                  placeholder="Preventive / Detective / Corrective…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Frequency</label>
                <select
                  name="frequency"
                  defaultValue={ctrl.frequency ?? ""}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">— Not set —</option>
                  {frequencyOptions.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Risk weight</label>
                <select
                  name="risk_weight"
                  defaultValue={ctrl.risk_weight ?? ""}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">— Not set —</option>
                  <option value="1">1 — Very low</option>
                  <option value="2">2 — Low</option>
                  <option value="3">3 — Medium</option>
                  <option value="4">4 — High</option>
                  <option value="5">5 — Critical</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Requirement / Checkpoint</label>
                <textarea
                  name="requirement"
                  defaultValue={ctrl.requirement ?? ""}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Clause / Reference</label>
                <input
                  name="clause_reference"
                  defaultValue={ctrl.clause_reference ?? ""}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Evidence required</label>
                <input
                  name="evidence_required"
                  defaultValue={ctrl.evidence_required ?? ""}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Reviewer prompt · what to ask for
                </label>
                <textarea
                  name="reviewer_prompt"
                  rows={3}
                  defaultValue={ctrl.reviewer_prompt ?? ""}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="bg-brand-700 hover:bg-brand-800 text-white px-5 py-2 rounded-lg text-sm font-medium"
              >
                Save changes
              </button>
            </div>
          </form>
        </details>
      )}

      {/* What the reviewer asks for first — deliberately its own panel
          above the GRC details, since it's the opening move of a review
          rather than reference material read afterwards. */}
      {ctrl.reviewer_prompt && (
        <div className="bg-blue-50/60 rounded-2xl border border-blue-200 p-6 mb-4">
          <div className="text-[10px] uppercase tracking-[0.2em] text-blue-700 font-semibold mb-1.5">
            Reviewer prompt · what to ask for
          </div>
          <div className="text-sm text-gray-800 whitespace-pre-wrap">
            {ctrl.reviewer_prompt}
          </div>
        </div>
      )}

      {/* GRC details panel — requirement, clause, evidence */}
      {(ctrl.requirement || ctrl.clause_reference || ctrl.evidence_required) && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4 space-y-4">
          {ctrl.requirement && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-1">
                Requirement / Checkpoint
              </div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap">{ctrl.requirement}</div>
            </div>
          )}
          {ctrl.clause_reference && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-1">
                Clause / Reference
              </div>
              <div className="text-sm font-mono text-gray-700">{ctrl.clause_reference}</div>
            </div>
          )}
          {ctrl.evidence_required && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-1">
                Evidence required
              </div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap">{ctrl.evidence_required}</div>
            </div>
          )}
        </div>
      )}

      {/* Tests under this control — each test is a dropdown; clicking it
          expands its details inline (user spec: reduce page navigation).
          checks.control_id is how the ECS GRC import wires them. */}
      {directChecks.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Tests under this control ({directChecks.length})
            </h3>
            <Link href={`/tests?control=${ctrl.id}`} className="text-xs text-brand-700 hover:underline">
              View all →
            </Link>
          </div>
          <div className="space-y-2">
            {directChecks.map((t) => (
              <details
                key={t.id}
                className="group bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
              >
                <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 flex-wrap hover:bg-gray-50">
                  <span className="transition-transform group-open:rotate-90 text-gray-400 shrink-0">▶</span>
                  <span className="text-sm font-medium text-gray-900">{t.name}</span>
                  <span className="ml-auto flex items-center gap-3 text-xs">
                    <span className="text-gray-500 capitalize">{t.frequency.replace("_", " ")}</span>
                    {t.last_status ? (
                      <span className="capitalize text-gray-600">{t.last_status.replace("_", " ")}</span>
                    ) : (
                      <span className="text-gray-400">Never run</span>
                    )}
                  </span>
                </summary>
                <div className="border-t border-gray-100 px-4 py-3 space-y-3">
                  {t.description && (
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{t.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>{t.question_count} question{t.question_count === 1 ? "" : "s"}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <AssignTestModal
                      checkId={t.id}
                      checkName={t.name}
                      auditors={auditors}
                      departmentManagers={departmentManagers}
                      brands={modalBrands}
                      departments={modalDepartments}
                      orgUnits={modalOrgUnits}
                    />
                    <Link href={`/tests/${t.id}`} className="text-xs text-brand-700 hover:underline">
                      Open full test →
                    </Link>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* Linked things */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <LinkPanel title="SOPs" type="sop" links={linksByType.sop} controlId={ctrl.id} canEdit={canEdit} />
        <LinkPanel title="Checks (Tests)" type="check" links={linksByType.check} controlId={ctrl.id} canEdit={canEdit} />
        <LinkPanel title="Audits" type="audit" links={linksByType.audit} controlId={ctrl.id} canEdit={false} />
        <LinkPanel title="Corrective Actions" type="capa" links={linksByType.capa} controlId={ctrl.id} canEdit={false} />
      </div>

      {/* Add new links — collapsed by default (native <details>) so the
          link forms don't sit open taking space. */}
      {canEdit && (
        <details className="group bg-white rounded-2xl border border-gray-200 shadow-sm mb-4">
          <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <span className="transition-transform group-open:rotate-90 text-gray-400">▶</span>
            🔗 Link new records
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 pb-4 pt-1 border-t border-gray-100">
            {sops.length > 0 && (
              <form action={linkControlAction} className="flex items-end gap-2">
                <input type="hidden" name="control_id" value={ctrl.id} />
                <input type="hidden" name="entity_type" value="sop" />
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Add SOP</label>
                  <select name="entity_id" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    {sops.map((s) => (<option key={s.id} value={s.id}>{s.title}</option>))}
                  </select>
                </div>
                <button type="submit" className="bg-brand-700 hover:bg-brand-800 text-white px-3 py-2 rounded-lg text-sm">Link</button>
              </form>
            )}
            {checks.length > 0 && (
              <form action={linkControlAction} className="flex items-end gap-2">
                <input type="hidden" name="control_id" value={ctrl.id} />
                <input type="hidden" name="entity_type" value="check" />
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Add check</label>
                  <select name="entity_id" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    {checks.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </select>
                </div>
                <button type="submit" className="bg-brand-700 hover:bg-brand-800 text-white px-3 py-2 rounded-lg text-sm">Link</button>
              </form>
            )}
          </div>
        </details>
      )}

      <Link href="/controls" className="inline-block mt-2 text-sm text-gray-500 hover:text-gray-700">
        ← Back to all controls
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

function LinkPanel({
  title,
  type,
  links,
  controlId,
  canEdit,
}: {
  title: string;
  type: "sop" | "check" | "audit" | "capa";
  links: { id: number; entity_id: number; label: string | null; status: string | null }[];
  controlId: number;
  canEdit: boolean;
}) {
  const hrefBase: Record<typeof type, string> = {
    sop: "/sops", check: "/tests", audit: "/audits", capa: "/capa",
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
      <h4 className="text-xs uppercase tracking-wider text-gray-500 mb-3">{title} ({links.length})</h4>
      {links.length === 0 ? (
        <div className="text-xs text-gray-400 italic">No links yet.</div>
      ) : (
        <ul className="space-y-1.5">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
              <Link href={`${hrefBase[type]}/${l.entity_id}`} className="text-gray-800 hover:text-brand-700 hover:underline truncate">
                {l.label ?? "Untitled record"}
              </Link>
              <div className="flex items-center gap-2">
                {l.status && <span className="text-[10px] uppercase tracking-wider text-gray-500">{l.status}</span>}
                {canEdit && (
                  <form action={unlinkControlAction}>
                    <input type="hidden" name="link_id" value={l.id} />
                    <input type="hidden" name="control_id" value={controlId} />
                    <button type="submit" className="text-xs text-red-500 hover:underline">remove</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
