import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { listAllQuestions } from "@/features/checklists/repository";
import { queryAll } from "@/lib/db";
import { getUserScope, getScopedIds } from "@/lib/auth/access";
import FilterBar from "@/features/filters/FilterBar";
import { anyFrameworkMatches, idParam, loadLineage } from "@/features/filters/lineage";

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
  searchParams: Promise<{
    search?: string;
    checklist?: string;
    domain?: string;
    framework?: string;
    critical?: string;
    department?: string;
    brand?: string;
  }>;
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
  const scopedQuestions = scopedIds
    ? allQuestions.filter(
        (q) =>
          q.control_ids.length === 0 ||
          q.control_ids.some((id) => scopedIds.controlIds.includes(id))
      )
    : allQuestions;

  // Filters (user spec 2026-11-08). A question belongs to the frameworks of
  // the controls it is tested under, or else to its checklist's frameworks.
  const lin = await loadLineage();
  const filt = {
    domain: idParam(sp.domain),
    framework: idParam(sp.framework),
    department: idParam(sp.department),
    brand: idParam(sp.brand),
  };
  const questionFrameworks = (q: (typeof scopedQuestions)[number]): Iterable<number> => {
    const fromControls = q.control_ids
      .map((id) => lin.controlFramework.get(id))
      .filter((x): x is number => x != null);
    return fromControls.length ? fromControls : lin.templateFrameworks.get(q.template_id) ?? [];
  };
  const questions = scopedQuestions.filter(
    (q) =>
      (!sp.critical || (sp.critical === "yes" ? !!q.is_critical : !q.is_critical)) &&
      anyFrameworkMatches(lin, questionFrameworks(q), filt)
  );
  const frameworkOptions = lin.frameworks.filter((f) => !filt.domain || f.domain_id === filt.domain);

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
      <FilterBar
        action="/questions"
        search={sp.search}
        searchPlaceholder="Search by question or checklist…"
        selects={[
          { name: "domain", label: "Domain", options: lin.domains, value: sp.domain },
          { name: "framework", label: "Framework", options: frameworkOptions, value: sp.framework },
          { name: "checklist", label: "Checklist", options: checklists, value: sp.checklist },
          { name: "critical", label: "Critical", options: [{ id: "yes", name: "Critical only" }, { id: "no", name: "Not critical" }], value: sp.critical },
          { name: "department", label: "Department", options: lin.departments, value: sp.department },
          { name: "brand", label: "Brand", options: lin.brands, value: sp.brand },
        ]}
        count={{ shown: questions.length, total: scopedQuestions.length, noun: "questions" }}
      />

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
