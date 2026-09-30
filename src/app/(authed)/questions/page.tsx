import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { listAllQuestions } from "@/features/checklists/repository";
import { queryAll } from "@/lib/db";
import { getUserScope, getScopedIds } from "@/lib/auth/access";

/**
 * Questions — the last hop of the Compliance Library hierarchy (SOP ->
 * Domain -> Framework -> Control -> Test -> Checklist -> Question). Every
 * question lives on a checklist template's page too; this view exists so
 * the whole question bank can be searched and filtered in one place
 * instead of opening each checklist individually.
 */
export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; checklist?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const checklistFilter = sp.checklist ? Number(sp.checklist) : undefined;

  const allQuestions = await listAllQuestions({
    search: sp.search,
    templateId: Number.isFinite(checklistFilter) ? checklistFilter : undefined,
  });

  // Access scoping: non-privileged users only see questions whose
  // checklist is wired to a control in their mapped domains. A question
  // isn't wired to any control yet (checklist authored but not linked to
  // a test) stays visible to everyone — hiding it would make newly
  // authored content silently disappear instead of just being unscored.
  const scope = await getUserScope(user.id, user.role);
  const scopedIds = await getScopedIds(scope);
  const questions = scopedIds
    ? allQuestions.filter(
        (q) =>
          q.control_ids.length === 0 ||
          q.control_ids.some((id) => scopedIds.controlIds.includes(id))
      )
    : allQuestions;

  const checklists = await queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM checklist_templates WHERE is_active = 1 ORDER BY name`
  );

  return (
    <Workspace
      section="Compliance Library / Questions"
      subtitle={`Questions (${questions.length})`}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <form className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          name="search"
          defaultValue={sp.search ?? ""}
          placeholder="Search by question or checklist…"
          className="flex-1 min-w-[220px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select
          name="checklist"
          defaultValue={checklistFilter ?? ""}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">— All checklists —</option>
          {checklists.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          Apply
        </button>
        {(sp.search || checklistFilter) && (
          <Link href="/questions" className="text-sm text-gray-500 hover:text-gray-700">
            Reset
          </Link>
        )}
      </form>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Question</th>
              <th className="text-left px-4 py-3 font-medium w-56">Checklist</th>
              <th className="text-left px-4 py-3 font-medium w-32">Section</th>
              <th className="text-left px-4 py-3 font-medium w-24">Critical</th>
            </tr>
          </thead>
          <tbody>
            {questions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-gray-400">
                  No questions match this filter.
                </td>
              </tr>
            )}
            {questions.map((q) => (
              <tr key={q.id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                <td className="px-4 py-3 text-gray-900">{q.question}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/checklists/templates/${q.template_id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {q.template_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">{q.section ?? "—"}</td>
                <td className="px-4 py-3">
                  {q.is_critical ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 rounded">
                      CRITICAL
                    </span>
                  ) : (
                    <span className="text-gray-300 text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Workspace>
  );
}
