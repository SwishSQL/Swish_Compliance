import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import {
  getCheck,
  listCheckResults,
  listLinkedChecklistItems,
} from "@/features/checks/repository";
import { recordResultAction } from "@/features/checks/actions";
import FilePicker from "@/features/sops/FilePicker";
import { queryAll, queryOne } from "@/lib/db";
import {
  CHECK_STATUS_LABEL,
  CHECK_STATUS_TONE,
  FREQUENCY_LABEL,
} from "@/features/checks/types";

export default async function CheckDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id: idStr } = await params;
  const id = Number(idStr);
  const check = await getCheck(id);
  if (!check) notFound();
  const [results, linkedItems] = await Promise.all([
    listCheckResults(id, 50),
    listLinkedChecklistItems(id),
  ]);

  // Active checklists for the "Record a new result" dropdown.
  const checklists = await queryAll<{ id: number; name: string; category: string | null }>(
    `SELECT id, name, category
     FROM checklist_templates
     WHERE is_active = 1
     ORDER BY name`
  );

  // Lineage for the header: this test's control → framework → domain.
  const lineage = check.control_id
    ? await queryOne<{
        framework_id: number | null;
        framework_name: string | null;
        domain_id: number | null;
        domain_name: string | null;
      }>(
        `SELECT f.id AS framework_id, f.name AS framework_name,
                d.id AS domain_id, d.name AS domain_name
         FROM controls c
         LEFT JOIN frameworks f ON f.id = c.framework_id
         LEFT JOIN domains d ON d.id = f.domain_id
         WHERE c.id = $1`,
        [check.control_id]
      )
    : null;

  return (
    <Workspace
      section="Compliance Library / Tests"
      subtitle={check.name}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4">
        <div className="flex items-center gap-3 mb-2">
          {check.last_status ? (
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${CHECK_STATUS_TONE[check.last_status]}`}>
              {CHECK_STATUS_LABEL[check.last_status]}
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs text-gray-500 bg-gray-100">Never run</span>
          )}
          <span className="text-xs text-gray-500">{FREQUENCY_LABEL[check.frequency]}</span>
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-1">{check.name}</h2>
        {check.description && <p className="text-sm text-gray-600 mb-3">{check.description}</p>}
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm pt-3 border-t border-gray-100">
          <Field label="Domain">
            {lineage?.domain_id ? (
              <Link href={`/domains/${lineage.domain_id}`} className="text-brand-700 hover:underline">{lineage.domain_name}</Link>
            ) : "—"}
          </Field>
          <Field label="Framework">
            {lineage?.framework_id ? (
              <Link href={`/frameworks/${lineage.framework_id}`} className="text-brand-700 hover:underline">{lineage.framework_name}</Link>
            ) : "—"}
          </Field>
          {/* Control is intentionally NOT shown here (user spec: on a
              test, max the framework and domain). */}
          <Field label="Checklist">
            {check.checklist_template_id ? (
              <Link
                href={`/checklists/templates/${check.checklist_template_id}`}
                className="text-brand-700 hover:underline"
              >
                {check.checklist_template_name}
              </Link>
            ) : "—"}
          </Field>
          <Field label="Results recorded">{check.result_count}</Field>
          <Field label="Next due">{check.next_due_date ? new Date(check.next_due_date).toLocaleDateString() : "—"}</Field>
        </dl>
      </div>

      {/* GRC details — procedure, evidence needed, method, performer/reviewer,
          pass/fail criteria, and the original auditor cadence label. Shown
          only when at least one field is filled (i.e. tests imported from
          the ECS GRC bundle or seeded from framework.xlsx). */}
      {(check.procedure_steps || check.evidence_needed || check.method || check.performer_role || check.reviewer_role || check.pass_criteria || check.fail_criteria || check.frequency_label) && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-1">
            How to perform this test
          </h3>
          {check.procedure_steps && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-1">
                Mandatory action / steps
              </div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap">{check.procedure_steps}</div>
            </div>
          )}
          {(check.evidence_needed || check.evidence_code) && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-1 flex items-center gap-2">
                <span>Evidence needed</span>
                {check.evidence_code && (
                  <span className="font-mono text-[10px] text-brand-700 bg-brand-50 border border-brand-200 px-1.5 py-0.5 rounded normal-case">
                    {check.evidence_code}
                  </span>
                )}
              </div>
              {check.evidence_needed && (
                <div className="text-sm text-gray-800 whitespace-pre-wrap">{check.evidence_needed}</div>
              )}
            </div>
          )}
          {/* Pass / Fail criteria — side-by-side card pair so the auditor
              can compare the two outcomes at a glance. */}
          {(check.pass_criteria || check.fail_criteria) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-gray-100">
              {check.pass_criteria && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-700 font-semibold mb-1">
                    Pass criteria
                  </div>
                  <div className="text-sm text-emerald-900 whitespace-pre-wrap">
                    {check.pass_criteria}
                  </div>
                </div>
              )}
              {check.fail_criteria && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-red-700 font-semibold mb-1">
                    Fail criteria
                  </div>
                  <div className="text-sm text-red-900 whitespace-pre-wrap">
                    {check.fail_criteria}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2 border-t border-gray-100">
            {check.method && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-1">
                  Method
                </div>
                <div className="text-sm text-gray-800">{check.method}</div>
              </div>
            )}
            {check.performer_role && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-1">
                  Performed by
                </div>
                <div className="text-sm text-gray-800">{check.performer_role}</div>
              </div>
            )}
            {check.reviewer_role && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-1">
                  Reviewed by
                </div>
                <div className="text-sm text-gray-800">{check.reviewer_role}</div>
              </div>
            )}
            {check.frequency_label && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-1">
                  Cadence (source)
                </div>
                <div className="text-sm text-gray-800">{check.frequency_label}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Linked checklists — each checklist is a dropdown; clicking it
          expands its questions inline (user spec: questions appear only
          on click, no separate page navigation). */}
      {linkedItems.length > 0 && (
        <div className="mb-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
            Linked checklists (
            {new Set(linkedItems.map((i) => i.template_id)).size})
          </h3>
          <div className="space-y-2">
            {linkedItems
              .filter(
                (item, idx) =>
                  idx === 0 ||
                  linkedItems[idx - 1].template_id !== item.template_id
              )
              .map((tpl) => {
                const group = linkedItems.filter(
                  (i) => i.template_id === tpl.template_id
                );
                const critical = group.filter((i) => i.is_critical).length;
                const totalWeight = group.reduce(
                  (s, i) => s + Number(i.weight ?? 0),
                  0
                );
                return (
                  <details
                    key={tpl.template_id}
                    className="group bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
                  >
                    <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 flex-wrap hover:bg-gray-50">
                      <span className="transition-transform group-open:rotate-90 text-gray-400 shrink-0">▶</span>
                      {tpl.template_code && (
                        <span className="font-mono text-xs text-brand-800 bg-brand-50 border border-brand-200 px-2 py-0.5 rounded whitespace-nowrap">
                          {tpl.template_code}
                        </span>
                      )}
                      <span className="text-sm font-medium text-gray-900">
                        {tpl.template_name.replace(/ checklist$/i, "")}
                      </span>
                      <span className="ml-auto flex items-center gap-3 text-xs text-gray-500">
                        <span>{group.length} question{group.length === 1 ? "" : "s"}</span>
                        {critical > 0 && (
                          <span className="text-red-600 font-semibold">{critical} critical</span>
                        )}
                        <span>weight {totalWeight}</span>
                      </span>
                    </summary>
                    <div className="border-t border-gray-100">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
                          <tr>
                            <th className="text-left px-4 py-2 font-medium w-14">#</th>
                            <th className="text-left px-4 py-2 font-medium">Question</th>
                            <th className="text-right px-4 py-2 font-medium w-20">Weight</th>
                            <th className="text-right px-4 py-2 font-medium w-24">Critical?</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.map((q, idx) => (
                            <tr key={q.item_id} className="border-t border-gray-100">
                              <td className="px-4 py-2 text-xs text-gray-400 tabular-nums">{idx + 1}</td>
                              <td className="px-4 py-2 text-gray-900">{q.question}</td>
                              <td className="px-4 py-2 text-right text-gray-600 tabular-nums">×{q.weight}</td>
                              <td className="px-4 py-2 text-right">
                                {q.is_critical ? (
                                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded">
                                    Critical
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-400">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="px-4 py-2 bg-gray-50/60 border-t border-gray-100 text-right">
                        <Link
                          href={`/checklists/templates/${tpl.template_id}`}
                          className="text-xs text-brand-700 hover:underline"
                        >
                          Open full checklist →
                        </Link>
                      </div>
                    </div>
                  </details>
                );
              })}
          </div>
        </div>
      )}

      {/* Record new result — collapsed by default (native <details>) so the
          form + evidence dropzone don't sit open taking a full screen. */}
      <details className="group bg-white rounded-2xl border border-gray-200 shadow-sm mb-4">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          <span className="transition-transform group-open:rotate-90 text-gray-400">▶</span>
          ➕ Record a new result
        </summary>
        <form action={recordResultAction} className="space-y-4 px-4 pb-4 pt-1 border-t border-gray-100">
          <input type="hidden" name="check_id" value={check.id} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {(["passing", "failing", "pending_review", "accepted_risk"] as const).map((s) => (
              <label key={s} className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 has-checked:border-brand-500 has-checked:bg-brand-50">
                <input type="radio" name="status" value={s} required className="accent-brand-700" />
                <span className="text-sm font-medium">{CHECK_STATUS_LABEL[s]}</span>
              </label>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Checklist used
              {check.checklist_template_id && (
                <span className="ml-1 text-[10px] text-gray-400 normal-case">
                  (defaults to this test&rsquo;s checklist)
                </span>
              )}
            </label>
            <select
              name="checklist_template_id"
              defaultValue={
                check.checklist_template_id ? String(check.checklist_template_id) : ""
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">— No checklist —</option>
              {checklists.map((cl) => (
                <option key={cl.id} value={cl.id}>
                  {cl.name}
                  {cl.category ? ` · ${cl.category}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Notes <span className="text-red-500">*</span>
            </label>
            <textarea
              name="notes"
              required
              rows={3}
              placeholder="Describe what you observed and any context for this result. Required."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Evidence (photo / file)
            </label>
            <FilePicker name="evidence_file" />
            <p className="text-[11px] text-gray-400 mt-1">
              PDF, Word, Excel, PowerPoint, image or text up to 10 MB.
            </p>
          </div>
          <label className="flex items-start gap-3 p-3 border border-amber-200 bg-amber-50 rounded-lg cursor-pointer text-sm">
            <input type="checkbox" name="spawn_capa" defaultChecked className="accent-amber-600 mt-0.5" />
            <div>
              <div className="font-medium text-amber-900">Auto-create CAPA on failure</div>
              <div className="text-xs text-amber-700">If status = failing, open a high-severity corrective action with a 7-day due date.</div>
            </div>
          </label>
          <button type="submit" className="bg-brand-700 hover:bg-brand-800 text-white px-5 py-2.5 rounded-lg text-sm font-medium">Record result</button>
        </form>
      </details>

      {/* History */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Result history ({results.length})</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3 font-medium">When</th>
              <th className="text-left px-5 py-3 font-medium">By</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-left px-5 py-3 font-medium">Checklist</th>
              <th className="text-left px-5 py-3 font-medium">Notes</th>
              <th className="text-left px-5 py-3 font-medium">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-400">No results recorded yet.</td></tr>
            )}
            {results.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-5 py-3 text-gray-600">{r.performed_by_name ?? "—"}</td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${CHECK_STATUS_TONE[r.status]}`}>
                    {CHECK_STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td className="px-5 py-3 text-xs">
                  {r.checklist_template_id ? (
                    <Link
                      href={`/checklists/templates/${r.checklist_template_id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {r.checklist_template_name}
                    </Link>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-5 py-3 text-gray-600 text-xs max-w-md truncate">{r.notes ?? "—"}</td>
                <td className="px-5 py-3 text-xs">
                  {r.evidence_url ? (
                    <a
                      href={r.evidence_url}
                      target="_blank"
                      rel="noreferrer"
                      download={r.evidence_name ?? undefined}
                      className="text-brand-700 hover:underline inline-flex items-center gap-1"
                      title={r.evidence_name ?? "Evidence"}
                    >
                      <span>{iconForMime(r.evidence_mime)}</span>
                      <span className="truncate max-w-[180px]">
                        {r.evidence_name ?? "Open"}
                      </span>
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Link href="/tests" className="inline-block mt-4 text-sm text-gray-500 hover:text-gray-700">
        ← Back to all tests
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

function iconForMime(mime: string | null): string {
  if (!mime) return "📎";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📄";
  if (mime.includes("word")) return "📝";
  if (mime.includes("excel") || mime.includes("spreadsheet")) return "📊";
  if (mime.includes("powerpoint") || mime.includes("presentation")) return "📑";
  if (mime.startsWith("text/")) return "📃";
  return "📎";
}
