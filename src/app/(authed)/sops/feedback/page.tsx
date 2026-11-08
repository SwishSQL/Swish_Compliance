import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { listSopFeedback, type FeedbackView } from "@/features/sops/feedback/repository";
import { visibleSops } from "@/features/sops/feedback/scope";
import { canTriageSopFeedback } from "@/features/sops/feedback/types";
import { FeedbackList, SopRegisterTabs } from "@/features/sops/feedback/ui";

type Search = { view?: string; q?: string; status?: string };

/** Review feedback across every SOP the user can see. */
export default async function SopFeedbackPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const triage = canTriageSopFeedback(user.role);
  const view: FeedbackView = sp.view === "mine" ? "mine" : "all";
  const status = sp.status ?? (view === "all" ? "Open" : "");

  const [sops, rowsAll] = await Promise.all([
    visibleSops(user),
    listSopFeedback({ view, userId: user.id, q: sp.q, status }),
  ]);
  const ids = new Set(sops.map((s) => s.id));
  const rows = rowsAll.filter((r) => ids.has(r.sop_id) || r.user_id === user.id);
  const openTotal = (await listSopFeedback({ view: "all", userId: user.id, status: "Open" })).filter((r) =>
    ids.has(r.sop_id)
  ).length;

  const qs = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ view, q: sp.q, status, ...over })) if (v) p.set(k, String(v));
    return p.toString();
  };
  const here = `/sops/feedback?${qs({})}`;

  return (
    <Workspace
      section="Compliance Library / SOPs & Policies"
      subtitle="Review feedback"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      <SopRegisterTabs active="feedback" openFeedback={openTotal} />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {(["all", "mine"] as const).map((v) => (
            <Link
              key={v}
              href={`/sops/feedback?${qs({ view: v, status: v === "all" ? "Open" : "" })}`}
              className={`px-3 py-1.5 rounded-md text-sm ${view === v ? "bg-brand-700 text-white" : "text-gray-600 hover:bg-gray-50"}`}
            >
              {v === "all" ? (triage ? "All SOPs (triage)" : "All SOPs") : "Mine"}
            </Link>
          ))}
        </div>
        <form method="get" className="flex gap-2 ml-auto">
          <input type="hidden" name="view" value={view} />
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Filter by SOP, type, text"
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          />
          <select name="status" defaultValue={status} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="">Any status</option>
            <option>Open</option>
            <option>Closed</option>
          </select>
          <button className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">Filter</button>
        </form>
        <a
          href={`/sops/feedback/export?${qs({})}`}
          className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50"
        >
          Download CSV
        </a>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        To add a comment, open an SOP and press <b>Comment</b> on a section.
      </p>
      <FeedbackList
        rows={rows}
        userId={user.id}
        triage={triage}
        returnTo={here}
        showSop
        empty={view === "mine" ? "You have not commented on any SOP yet." : "No comments match."}
      />
    </Workspace>
  );
}
