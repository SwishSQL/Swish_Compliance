import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, canEditSops, canDeleteOrArchive } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import {
  getTemplate,
  listTemplateItems,
  listLatestAnswersForTemplate,
} from "@/features/checklists/repository";
import {
  updateTemplateAction,
  addItemAction,
  recordChecklistItemAnswerAction,
} from "@/features/checklists/actions";
import DeleteItemButton from "@/features/checklists/DeleteItemButton";
import DeleteEntityButton from "@/features/admin/delete/DeleteEntityButton";
import { CHECKLIST_CATEGORIES_FALLBACK } from "@/features/checklists/types";
import { listOptions } from "@/features/config/repository";

export default async function ChecklistTemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("grc.view");
  const { id: idStr } = await params;
  const id = Number(idStr);
  const tpl = await getTemplate(id);
  if (!tpl) notFound();
  const [items, latestAnswers] = await Promise.all([
    listTemplateItems(id),
    listLatestAnswersForTemplate(id),
  ]);
  const answerByItem = new Map(latestAnswers.map((a) => [a.item_id, a]));
  const canEdit = canEditSops(user);
  const canDelete = canDeleteOrArchive(user);
  // Header edits (rename / category / deactivate=archive) and deleting a
  // question cascade into every audit that used this template, so they're
  // gated to admin + compliance. `isAdmin` here means "can edit header".
  const isAdmin = canDeleteOrArchive(user);

  const dbCategories = await listOptions("checklist_category", true);
  const categories =
    dbCategories.length > 0
      ? dbCategories.map((o) => o.label)
      : CHECKLIST_CATEGORIES_FALLBACK;

  return (
    <Workspace
      section="Compliance Library / Checklists"
      subtitle={tpl.name}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {canDelete && (
        <div className="flex justify-end mb-3">
          <DeleteEntityButton
            entityType="checklist_template"
            entityId={tpl.id}
            label="Checklist template"
          />
        </div>
      )}

      {/* Header — compact read-only card by default. Admins get an inline
          "Edit" toggle (native <details>, closed by default) so the form
          isn't sitting open all the time. */}
      {(() => {
        const readOnlyHead = (
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-gray-900">{tpl.name}</h2>
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] ${
                  tpl.is_active
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    tpl.is_active ? "bg-emerald-500" : "bg-gray-400"
                  }`}
                />
                {tpl.is_active ? "Active" : "Inactive"}
              </span>
              {tpl.category && (
                <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {tpl.category}
                </span>
              )}
            </div>
            {tpl.description && (
              <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">
                {tpl.description}
              </p>
            )}
          </div>
        );

        if (!isAdmin) {
          return (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-3">
              {readOnlyHead}
            </div>
          );
        }

        return (
          <details className="group bg-white rounded-xl border border-gray-200 shadow-sm mb-3">
            <summary className="cursor-pointer list-none p-4 flex items-start justify-between gap-3">
              {readOnlyHead}
              <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 border border-brand-200 rounded-lg px-2.5 py-1 hover:bg-brand-50">
                <span className="transition-transform group-open:rotate-90">▶</span>
                ✏️ Edit
              </span>
            </summary>
            <form
              action={updateTemplateAction}
              className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100"
            >
              <input type="hidden" name="id" value={tpl.id} />
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                  <input
                    name="name"
                    defaultValue={tpl.name}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                  <select
                    name="category"
                    defaultValue={tpl.category ?? ""}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">— None —</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <textarea
                  name="description"
                  defaultValue={tpl.description ?? ""}
                  rows={2}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="is_active" defaultChecked={tpl.is_active} className="accent-brand-700" />
                  Active
                </label>
                <button
                  type="submit"
                  className="ml-auto bg-brand-700 hover:bg-brand-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
                >
                  Save header
                </button>
              </div>
            </form>
          </details>
        );
      })()}

      {/* Items table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-3">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            Items ({items.length})
          </h3>
          <Link
            href={`/audits/new?template=${tpl.id}`}
            className="text-sm text-brand-700 hover:underline"
          >
            Run audit with this template →
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3 font-medium w-12">#</th>
              <th className="text-left px-5 py-3 font-medium">Question</th>
              <th className="text-left px-5 py-3 font-medium w-20">Weight</th>
              <th className="text-left px-5 py-3 font-medium w-24">Critical?</th>
              <th className="text-left px-5 py-3 font-medium">Answer</th>
              {canDelete && <th className="text-right px-5 py-3 font-medium w-20"></th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={canDelete ? 6 : 5} className="px-5 py-8 text-center text-gray-400">
                  No items yet. Add the first question below.
                </td>
              </tr>
            )}
            {items.map((item, idx) => {
              const latest = answerByItem.get(item.id);
              return (
                <tr key={item.id} className="border-t border-gray-100 align-top">
                  {/* # is the visible row position (1..N), not sort_order.
                      sort_order has gaps after deletions; the displayed
                      number should always be 1, 2, 3, … so the column
                      reads naturally to the auditor. */}
                  <td className="px-5 py-3 text-xs text-gray-400">{idx + 1}</td>
                  <td className="px-5 py-3">
                    {/* Guidance is deliberately NOT rendered here (user
                        spec: no description under each question). It still
                        exists on the item and can surface during audits. */}
                    <div className="text-gray-900">{item.question}</div>
                  </td>
                  <td className="px-5 py-3 text-gray-600">×{item.weight}</td>
                  <td className="px-5 py-3">
                    {item.is_critical ? (
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded">
                        Critical
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 min-w-[360px]">
                    {latest && (
                      <div
                        className={`mb-2 p-2 rounded-lg border text-xs ${
                          latest.answer === "yes"
                            ? "bg-emerald-50 border-emerald-200"
                            : latest.answer === "no"
                            ? "bg-red-50 border-red-200"
                            : "bg-gray-50 border-gray-200"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              latest.answer === "yes"
                                ? "bg-brand-700 text-white"
                                : latest.answer === "no"
                                ? "bg-red-600 text-white"
                                : "bg-gray-500 text-white"
                            }`}
                          >
                            {latest.answer === "na" ? "N/A" : latest.answer}
                          </span>
                          <span className="text-gray-600">
                            {latest.answered_by_name ?? "—"}
                          </span>
                          <span className="text-gray-400">
                            · {new Date(latest.answered_at).toLocaleString()}
                          </span>
                        </div>
                        {latest.note && (
                          <div className="text-gray-700 whitespace-pre-wrap mt-1">
                            {latest.note}
                          </div>
                        )}
                      </div>
                    )}
                    <form
                      action={recordChecklistItemAnswerAction}
                      className="flex flex-wrap items-start gap-2"
                    >
                      <input type="hidden" name="item_id" value={item.id} />
                      <input type="hidden" name="template_id" value={tpl.id} />
                      <div className="flex items-center gap-2">
                        {(["yes", "no", "na"] as const).map((a) => (
                          <label
                            key={a}
                            className="inline-flex items-center gap-1 px-2 py-1 border border-gray-200 rounded cursor-pointer text-xs has-checked:bg-brand-50 has-checked:border-brand-400"
                          >
                            <input
                              type="radio"
                              name="answer"
                              value={a}
                              required
                              className="accent-brand-700"
                            />
                            <span className="font-medium">
                              {a === "na" ? "N/A" : a === "yes" ? "Yes" : "No"}
                            </span>
                          </label>
                        ))}
                      </div>
                      <input
                        name="note"
                        placeholder="Note (optional)"
                        className="flex-1 min-w-[140px] px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      <button
                        type="submit"
                        className="bg-brand-700 hover:bg-brand-800 text-white px-3 py-1 rounded text-xs font-medium"
                      >
                        Save
                      </button>
                    </form>
                  </td>
                  {canDelete && (
                    <td className="px-5 py-3 text-right">
                      <DeleteItemButton
                        itemId={item.id}
                        templateId={tpl.id}
                        question={item.question}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add item — collapsed by default (native <details>). The form only
          appears once the user clicks "Add item", so the page isn't a wall
          of open inputs. */}
      {canEdit && (
        <details className="group bg-white rounded-xl border border-gray-200 shadow-sm">
          <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <span className="transition-transform group-open:rotate-90 text-gray-400">▶</span>
            ➕ Add a new item
          </summary>
          <form action={addItemAction} className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100">
            <input type="hidden" name="template_id" value={tpl.id} />
            <div>
              <input
                name="question"
                required
                placeholder="Question / criterion"
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <input
                name="guidance"
                placeholder="Optional guidance for the auditor"
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div className="flex items-end gap-3">
              <div className="w-24">
                <label className="block text-xs font-medium text-gray-600 mb-1">Weight</label>
                <input
                  type="number"
                  name="weight"
                  min={1}
                  max={10}
                  defaultValue={1}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <label className="flex items-center gap-2 text-sm pb-1.5">
                <input type="checkbox" name="is_critical" className="accent-brand-700" />
                Mark as critical
              </label>
              <button
                type="submit"
                className="ml-auto bg-brand-700 hover:bg-brand-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
              >
                + Add item
              </button>
            </div>
          </form>
        </details>
      )}
    </Workspace>
  );
}
