import { requireAdmin } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { queryAll } from "@/lib/db";

type Row = {
  id: number;
  user_email: string | null;
  action: string;
  entity: string | null;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

const ACTION_TONE: Record<string, string> = {
  login: "bg-sky-50 text-sky-700",
  logout: "bg-gray-50 text-gray-600",
  create: "bg-emerald-50 text-emerald-700",
  update: "bg-indigo-50 text-indigo-700",
  reset_password: "bg-rose-50 text-rose-700",
};

function actionTone(action: string): string {
  if (action.includes("approved")) return "bg-emerald-50 text-emerald-700";
  if (action.includes("rejected")) return "bg-red-50 text-red-700";
  if (action.includes("archived")) return "bg-gray-50 text-gray-600";
  if (action.includes("pending_review")) return "bg-amber-50 text-amber-700";
  return ACTION_TONE[action] ?? "bg-gray-50 text-gray-600";
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const me = await requireAdmin();
  const sp = await searchParams;

  const rows = sp.search
    ? await queryAll<Row>(
        `SELECT TOP (200) id, user_email, action, entity, entity_id,
                details AS details__json, created_at
         FROM audit_logs
         WHERE user_email LIKE $1 OR action LIKE $1 OR entity LIKE $1
         ORDER BY created_at DESC`,
        [`%${sp.search}%`]
      )
    : await queryAll<Row>(
        `SELECT TOP (200) id, user_email, action, entity, entity_id,
                details AS details__json, created_at
         FROM audit_logs ORDER BY created_at DESC`
      );

  return (
    <Workspace
      section="Administration / Audit Logs"
      subtitle={`Activity trail (latest 200 events)`}
      sessionLabel="Session"
      userLabel={me.displayName}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4">
        <form method="get" className="flex items-center gap-2 max-w-md">
          <input
            type="text"
            name="search"
            defaultValue={sp.search ?? ""}
            placeholder="Filter by user, action or entity…"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">
            Filter
          </button>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3 font-medium">When</th>
              <th className="text-left px-5 py-3 font-medium">User</th>
              <th className="text-left px-5 py-3 font-medium">Action</th>
              <th className="text-left px-5 py-3 font-medium">Entity</th>
              <th className="text-left px-5 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-gray-400">
                  No audit events match.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-5 py-3 text-gray-700">{r.user_email ?? "—"}</td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${actionTone(r.action)}`}
                  >
                    {r.action}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-600 text-xs">
                  {r.entity ?? "—"}
                </td>
                <td className="px-5 py-3 font-mono text-[11px] text-gray-500 max-w-md truncate">
                  {r.details ? JSON.stringify(r.details) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Workspace>
  );
}
