import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { queryAll, queryOne } from "@/lib/db";
import {
  AUDIT_RESPONSE_ANSWERED_SQL,
  AUDIT_RESPONSE_PERFORMANCE_SQL,
  AUDIT_RESPONSE_SHORTFALL_SQL,
} from "@/features/audits/types";
import {
  CAPA_STATUS_LABEL,
  CAPA_STATUS_TONE,
  CAPA_UNASSIGNED_TONE,
  CAPA_UNASSIGNED_LABEL,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  type CapaStatus,
  type CapaSeverity,
} from "@/features/capa/types";

type FrameworkRow = {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  total_controls: number;
  healthy: number;
  at_risk: number;
  failing: number;
  unknown: number;
  open_capas: number;
  draft_sops: number;
};

type FrameworkAuditScore = {
  framework_id: number;
  total_w: number;
  passed_w: number;
  remediated_w: number;
  passed_n: number;
  remediated_n: number;
  open_failed_n: number;
};

type OpenFindingRow = {
  audit_id: number;
  framework_name: string | null;
  control_name: string | null;
  item_id: number;
  question: string;
  is_critical: boolean;
  capa_id: number | null;
  capa_code: string | null;
  capa_status: CapaStatus | null;
  capa_severity: CapaSeverity | null;
  capa_due_date: string | null;
  assigned_to_name: string | null;
};

type TestResultEvent = {
  id: number;
  check_id: number;
  check_code: string | null;
  check_name: string;
  control_code: string | null;
  control_name: string | null;
  framework_code: string | null;
  framework_name: string | null;
  status: "passing" | "failing" | "pending_review" | "accepted_risk";
  notes: string | null;
  performed_by_name: string | null;
  created_at: string;
};

// Default window for the timeline when the user hasn't picked dates.
const DEFAULT_DAYS_BACK = 30;

export default async function RoadmapPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  // Default to the last 30 days when no range is picked. We render the
  // ISO strings back into the date inputs so the form remembers state.
  const today = new Date();
  const defaultFrom = new Date(today.getTime() - DEFAULT_DAYS_BACK * 86400e3);
  const fromStr = sp.from || defaultFrom.toISOString().split("T")[0];
  const toStr = sp.to || today.toISOString().split("T")[0];

  // Per-framework readiness (projection over controls / CAPAs / SOPs)
  const frameworks = await queryAll<FrameworkRow>(
    `SELECT
       f.id, f.code, f.name, f.is_active,
       COALESCE(SUM(CASE WHEN c.is_active THEN 1 ELSE 0 END), 0)::int AS total_controls,
       COALESCE(SUM(CASE WHEN c.health_status = 'healthy' THEN 1 ELSE 0 END), 0)::int AS healthy,
       COALESCE(SUM(CASE WHEN c.health_status = 'at_risk' THEN 1 ELSE 0 END), 0)::int AS at_risk,
       COALESCE(SUM(CASE WHEN c.health_status = 'failing' THEN 1 ELSE 0 END), 0)::int AS failing,
       COALESCE(SUM(CASE WHEN c.health_status = 'unknown' THEN 1 ELSE 0 END), 0)::int AS unknown,
       -- Open CAPAs reachable from this framework two ways: manually
       -- linked via control_links, OR born from an audit finding
       -- (source_audit_id → audits.framework_id). Audit-born CAPAs
       -- never get a control_links row, so without the second arm the
       -- count reads zero for them.
       (SELECT COUNT(*)::int FROM corrective_actions ca
        WHERE ca.status IN ('open','in_progress','submitted')
          AND (
            EXISTS (SELECT 1 FROM control_links cl
                    JOIN controls cc ON cc.id = cl.control_id
                    WHERE cl.entity_type = 'capa' AND cl.entity_id = ca.id
                      AND cc.framework_id = f.id)
            OR EXISTS (SELECT 1 FROM audits a
                       WHERE a.id = ca.source_audit_id
                         AND a.framework_id = f.id)
          )) AS open_capas,
       (SELECT COUNT(*)::int FROM sops s
        JOIN control_links cl ON cl.entity_type = 'sop' AND cl.entity_id = s.id
        JOIN controls cc ON cc.id = cl.control_id
        WHERE cc.framework_id = f.id AND s.status IN ('draft','pending_review')) AS draft_sops
     FROM frameworks f
     LEFT JOIN controls c ON c.framework_id = f.id
     GROUP BY f.id
     ORDER BY f.is_active DESC, f.name`
  );

  // Per-framework COMPLIANCE SCORE from actual audit answers (user
  // spec: failed questions deduct their weight; the weight comes back
  // once the finding's CAPA is verified/closed). Only the LATEST audit
  // per (framework, control) counts — a fresh audit resets the slate.
  // Same weight semantics as computeAuditScore: pass+fail only, N/A
  // excluded.
  const auditScores = await queryAll<FrameworkAuditScore>(
    `WITH latest AS (
       SELECT DISTINCT ON (a.framework_id, a.control_id) a.id, a.framework_id
       FROM audits a
       WHERE a.status IN ('submitted','closed') AND a.framework_id IS NOT NULL
       ORDER BY a.framework_id, a.control_id, a.audit_date DESC, a.id DESC
     )
     -- Answers are graded 0-100 (migration 054): weight is earned in
     -- proportion to Yes's share of the applicable (Yes+No) samples, and
     -- anything below the threshold is a finding — a 100%-N-A question
     -- counts toward neither total nor passed weight.
     SELECT l.framework_id,
       COALESCE(SUM(CASE WHEN ${AUDIT_RESPONSE_ANSWERED_SQL} THEN i.weight ELSE 0 END),0)::int AS total_w,
       COALESCE(SUM(
         CASE WHEN ${AUDIT_RESPONSE_ANSWERED_SQL}
              THEN i.weight * ${AUDIT_RESPONSE_PERFORMANCE_SQL} / 100.0
              ELSE 0 END),0)::float                                                            AS passed_w,
       COALESCE(SUM(CASE WHEN ${AUDIT_RESPONSE_SHORTFALL_SQL}
                          AND ca.status IN ('verified','closed')
                         THEN i.weight ELSE 0 END),0)::int                                    AS remediated_w,
       (COUNT(*) FILTER (WHERE ${AUDIT_RESPONSE_ANSWERED_SQL} AND NOT (${AUDIT_RESPONSE_SHORTFALL_SQL})))::int AS passed_n,
       (COUNT(*) FILTER (WHERE ${AUDIT_RESPONSE_SHORTFALL_SQL}
                          AND ca.status IN ('verified','closed')))::int                       AS remediated_n,
       (COUNT(*) FILTER (WHERE ${AUDIT_RESPONSE_SHORTFALL_SQL}
                          AND (ca.id IS NULL OR ca.status NOT IN ('verified','closed'))))::int AS open_failed_n
     FROM latest l
     JOIN audit_responses r ON r.audit_id = l.id
     JOIN checklist_items i ON i.id = r.item_id
     LEFT JOIN corrective_actions ca
       ON ca.source_audit_id = l.id AND ca.source_item_id = r.item_id
     GROUP BY l.framework_id`
  );
  const scoreByFramework = new Map(
    auditScores.map((s) => [s.framework_id, s])
  );

  // Cross-program blockers
  const blockers = await queryOne<{
    overdue_capas: number;
    overdue_checks: number;
    critical_capas: number;
    pending_sops: number;
    failing_checks: number;
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM corrective_actions
         WHERE due_date < CURRENT_DATE AND status IN ('open','in_progress','submitted'))    AS overdue_capas,
       (SELECT COUNT(*)::int FROM checks
         WHERE next_due_date < CURRENT_DATE AND is_active)                                  AS overdue_checks,
       (SELECT COUNT(*)::int FROM corrective_actions
         WHERE severity = 'critical' AND status IN ('open','in_progress','submitted'))      AS critical_capas,
       (SELECT COUNT(*)::int FROM sops WHERE status = 'pending_review')                     AS pending_sops,
       (SELECT COUNT(*)::int FROM checks WHERE last_status = 'failing')                     AS failing_checks`
  );

  // Open audit findings — every failed audit question whose CAPA is
  // still unresolved (or was never assigned). This is CURRENT state,
  // not history, so it deliberately ignores the timeline date filter.
  // Overdue first, then by severity, then nearest due date.
  const openFindings = await queryAll<OpenFindingRow>(
    `SELECT
       a.id AS audit_id,
       fw.name AS framework_name,
       ctrl.name AS control_name,
       i.id AS item_id, i.question, i.is_critical,
       ca.id AS capa_id, ca.code AS capa_code,
       ca.status AS capa_status, ca.severity AS capa_severity,
       ca.due_date AS capa_due_date,
       u.display_name AS assigned_to_name
     FROM audit_responses r
     JOIN audits          a    ON a.id  = r.audit_id
     JOIN checklist_items i    ON i.id  = r.item_id
     LEFT JOIN frameworks fw   ON fw.id = a.framework_id
     LEFT JOIN controls   ctrl ON ctrl.id = a.control_id
     LEFT JOIN corrective_actions ca
       ON ca.source_audit_id = a.id AND ca.source_item_id = i.id
     LEFT JOIN users      u    ON u.id  = ca.assigned_to
     WHERE ${AUDIT_RESPONSE_SHORTFALL_SQL}
       AND a.status IN ('submitted','closed')
       AND (ca.id IS NULL
            OR ca.status IN ('open','in_progress','submitted','rejected'))
     ORDER BY
       CASE WHEN ca.due_date < CURRENT_DATE THEN 0 ELSE 1 END,
       CASE ca.severity
         WHEN 'critical' THEN 0 WHEN 'high' THEN 1
         WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
       ca.due_date ASC NULLS LAST,
       a.id DESC, i.sort_order, i.id
     LIMIT 100`
  );

  // Test results timeline — every check_result inside the chosen window,
  // joined back to its check / control / framework so the row can show
  // the full lineage without per-row follow-ups. Order newest first.
  // toStr + " 23:59:59" makes the upper bound inclusive of the whole day.
  const testEvents = await queryAll<TestResultEvent>(
    `SELECT
       r.id, r.check_id,
       ch.code AS check_code, ch.name AS check_name,
       ctrl.code AS control_code, ctrl.name AS control_name,
       f.code   AS framework_code, f.name AS framework_name,
       r.status, r.notes,
       u.display_name AS performed_by_name,
       r.created_at
     FROM check_results r
     JOIN checks      ch   ON ch.id   = r.check_id
     LEFT JOIN controls    ctrl ON ctrl.id = ch.control_id
     LEFT JOIN frameworks  f    ON f.id    = ctrl.framework_id
     LEFT JOIN users       u    ON u.id    = r.performed_by
     WHERE r.created_at >= $1::timestamptz
       AND r.created_at <  ($2::date + INTERVAL '1 day')
     ORDER BY r.created_at DESC
     LIMIT 200`,
    [fromStr, toStr]
  );

  // Group events by date for the timeline render — heading per day with
  // its rows clustered underneath. Sort keys descending so today is up.
  const eventsByDay = new Map<string, TestResultEvent[]>();
  for (const ev of testEvents) {
    const day = new Date(ev.created_at).toISOString().split("T")[0];
    const list = eventsByDay.get(day) ?? [];
    list.push(ev);
    eventsByDay.set(day, list);
  }
  const dayKeys = Array.from(eventsByDay.keys()).sort().reverse();

  return (
    <Workspace
      section="Workspace / Roadmap"
      subtitle="Program readiness and active blockers across all frameworks"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* Blockers strip */}
      <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-3">Top blockers right now</h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <Block href="/capa?status=open" label="Critical CAPAs open" value={blockers?.critical_capas ?? 0} tone="red" />
        <Block href="/capa" label="Overdue CAPAs" value={blockers?.overdue_capas ?? 0} tone="red" />
        <Block href="/tests?status=failing" label="Failing checks" value={blockers?.failing_checks ?? 0} tone="red" />
        <Block href="/tests" label="Overdue checks" value={blockers?.overdue_checks ?? 0} tone="amber" />
        <Block href="/sops?status=pending_review" label="SOPs awaiting approval" value={blockers?.pending_sops ?? 0} tone="amber" />
      </div>

      {/* Per-framework readiness — collapsed by default (user spec) */}
      <details className="group mb-4">
        <summary className="cursor-pointer list-none flex items-center gap-2 mb-3">
          <span className="transition-transform group-open:rotate-90 text-gray-400 text-xs">▶</span>
          <span className="text-xs uppercase tracking-widest text-gray-500">Framework readiness ({frameworks.length})</span>
        </summary>
      <div className="space-y-3">
        {frameworks.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center text-gray-400 text-sm">
            No frameworks defined. Add one from <Link href="/frameworks" className="text-brand-700 hover:underline">Frameworks</Link>.
          </div>
        )}
        {frameworks.map((f) => {
          // Compliance score from the latest audits: failed questions
          // deduct their weight; verified/closed CAPAs give it back.
          const s = scoreByFramework.get(f.id);
          const audited = !!s && s.total_w > 0;
          const scorePct = audited
            ? Math.round(((s.passed_w + s.remediated_w) / s.total_w) * 100)
            : null;
          const openW = audited ? s.total_w - s.passed_w - s.remediated_w : 0;
          return (
            <Link
              key={f.id}
              href={`/frameworks/${f.id}`}
              className={`block bg-white rounded-2xl border shadow-sm p-5 hover:shadow-md transition-all ${
                f.is_active ? "border-gray-200" : "border-gray-200 opacity-70"
              }`}
            >
              <div className="flex items-center justify-between mb-3 gap-4">
                <div className="flex items-center gap-3">
                  <h4 className="text-base font-semibold text-gray-900">{f.name}</h4>
                  {!f.is_active && <span className="text-xs text-gray-400">(inactive)</span>}
                </div>
                <div className="text-right">
                  <div className={`text-2xl font-bold ${
                    scorePct == null ? "text-gray-300" :
                    scorePct >= 80 ? "text-emerald-600" :
                    scorePct >= 50 ? "text-amber-600" :
                    "text-red-600"
                  }`}>{scorePct == null ? "—" : `${scorePct}%`}</div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Compliance score</div>
                </div>
              </div>

              {/* Stacked progress bar over question WEIGHTS: green =
                  passed, blue = failed but remediated (CAPA closed),
                  red = failed and still open. */}
              {audited ? (
                <>
                  <div className="flex h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
                    {s.passed_w > 0 && <div className="bg-emerald-500" style={{ width: `${(s.passed_w / s.total_w) * 100}%` }} />}
                    {s.remediated_w > 0 && <div className="bg-sky-500" style={{ width: `${(s.remediated_w / s.total_w) * 100}%` }} />}
                    {openW > 0 && <div className="bg-red-500" style={{ width: `${(openW / s.total_w) * 100}%` }} />}
                  </div>
                  <div className="flex gap-3 text-xs text-gray-600 flex-wrap">
                    <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />{s.passed_n} passed</span>
                    <span><span className="inline-block w-2 h-2 rounded-full bg-sky-500 mr-1" />{s.remediated_n} remediated</span>
                    <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />{s.open_failed_n} open finding{s.open_failed_n === 1 ? "" : "s"}</span>
                    {f.open_capas > 0 && <span className="text-red-700 font-medium">· {f.open_capas} open CAPAs</span>}
                    {f.draft_sops > 0 && <span className="text-amber-700">· {f.draft_sops} draft SOPs</span>}
                  </div>
                </>
              ) : (
                <div className="text-xs text-gray-400">
                  Not audited yet — the score appears after the first audit is
                  submitted.
                </div>
              )}
            </Link>
          );
        })}
      </div>
      </details>

      {/* ─── Open audit findings (failed questions + their CAPAs) —
          collapsed by default (user spec) ─── */}
      <details className="group mt-6">
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3 flex-wrap mb-3">
          <span className="flex items-center gap-2">
            <span className="transition-transform group-open:rotate-90 text-gray-400 text-xs">▶</span>
            <span className="text-xs uppercase tracking-widest text-gray-500">
              Open audit findings &amp; CAPAs ({openFindings.length})
            </span>
          </span>
        </summary>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-xs uppercase tracking-widest text-gray-500 sr-only">
          Open audit findings &amp; CAPAs
        </h3>
        <Link
          href="/capa"
          className="text-xs text-brand-700 hover:underline"
        >
          Open Corrective Actions →
        </Link>
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-2">
        {openFindings.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">
            No open audit findings — every failed question is resolved. 🎉
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {openFindings.map((f) => {
              const overdue =
                f.capa_due_date != null &&
                new Date(f.capa_due_date) <
                  new Date(new Date().toDateString());
              return (
                <li
                  key={`${f.audit_id}-${f.item_id}`}
                  className="px-5 py-3 hover:bg-gray-50 flex items-start gap-3 group"
                >
                  <span
                    className={`shrink-0 w-2.5 h-2.5 rounded-full mt-1.5 ${
                      overdue || f.capa_severity === "critical"
                        ? "bg-red-500"
                        : f.capa_id && f.assigned_to_name
                        ? "bg-amber-500"
                        : "bg-gray-300"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <Link
                        href={
                          f.capa_id
                            ? `/capa/${f.capa_id}`
                            : `/capa?audit_id=${f.audit_id}`
                        }
                        className="text-sm font-medium text-gray-900 group-hover:text-brand-700"
                      >
                        {f.question}
                      </Link>
                      {f.is_critical && (
                        <span className="text-[10px] font-medium bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                          CRITICAL
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
                      {f.framework_name && (
                        <span className="text-emerald-700">
                          {f.framework_name}
                        </span>
                      )}
                      {f.control_name && (
                        <span className="text-amber-700">
                          {f.control_name}
                        </span>
                      )}
                      {f.capa_code && (
                        <span className="font-mono text-gray-500">
                          {f.capa_code}
                        </span>
                      )}
                      {f.capa_status ? (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${CAPA_STATUS_TONE[f.capa_status]}`}
                        >
                          {CAPA_STATUS_LABEL[f.capa_status]}
                        </span>
                      ) : (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${CAPA_UNASSIGNED_TONE}`}>
                          {CAPA_UNASSIGNED_LABEL}
                        </span>
                      )}
                      {f.capa_severity && (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${SEVERITY_TONE[f.capa_severity]}`}
                        >
                          {SEVERITY_LABEL[f.capa_severity]}
                        </span>
                      )}
                      {f.assigned_to_name && (
                        <span className="text-gray-600">
                          → {f.assigned_to_name}
                        </span>
                      )}
                      {f.capa_due_date && (
                        <span
                          className={
                            overdue ? "text-red-600 font-semibold" : ""
                          }
                        >
                          due{" "}
                          {new Date(f.capa_due_date).toLocaleDateString()}
                          {overdue && " · OVERDUE"}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {openFindings.length === 100 && (
        <div className="text-[11px] text-gray-400 mb-2">
          Showing the 100 most urgent findings —{" "}
          <Link href="/capa" className="text-brand-700 hover:underline">
            see all on the Corrective Actions page
          </Link>
          .
        </div>
      )}
      </details>

      {/* ─── Test results timeline — collapsed by default (user spec) ─── */}
      <details className="group mt-6">
        <summary className="cursor-pointer list-none flex items-center gap-2 mb-3">
          <span className="transition-transform group-open:rotate-90 text-gray-400 text-xs">▶</span>
          <span className="text-xs uppercase tracking-widest text-gray-500">
            Test results timeline ({testEvents.length})
          </span>
        </summary>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-xs uppercase tracking-widest text-gray-500 sr-only">
          Test results timeline
        </h3>
        <form method="get" className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
              From
            </label>
            <input
              type="date"
              name="from"
              defaultValue={fromStr}
              className="px-2 py-1 text-xs border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
              To
            </label>
            <input
              type="date"
              name="to"
              defaultValue={toStr}
              className="px-2 py-1 text-xs border border-gray-300 rounded-md"
            />
          </div>
          <button
            type="submit"
            className="bg-brand-700 hover:bg-brand-800 text-white text-xs px-3 py-1.5 rounded-md"
          >
            Apply
          </button>
          {(sp.from || sp.to) && (
            <Link
              href="/roadmap"
              className="text-xs text-gray-500 hover:text-gray-700 self-center"
            >
              Reset
            </Link>
          )}
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {testEvents.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400 text-sm">
            No test results in this range. Pick a wider date window to see
            history.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {dayKeys.map((day) => {
              const dayEvents = eventsByDay.get(day) ?? [];
              return (
                <div key={day}>
                  <div className="bg-gray-50 px-5 py-2 text-[11px] uppercase tracking-wider text-gray-500 font-semibold border-b border-gray-100 flex items-center justify-between">
                    <span>
                      {new Date(day).toLocaleDateString(undefined, {
                        weekday: "short",
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="text-gray-400">
                      {dayEvents.length} result
                      {dayEvents.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul>
                    {dayEvents.map((ev) => {
                      const tone =
                        ev.status === "passing"
                          ? {
                              dot: "bg-emerald-500",
                              chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
                              label: "PASS",
                            }
                          : ev.status === "failing"
                          ? {
                              dot: "bg-red-500",
                              chip: "bg-red-50 text-red-700 border-red-200",
                              label: "FAIL",
                            }
                          : ev.status === "pending_review"
                          ? {
                              dot: "bg-amber-500",
                              chip: "bg-amber-50 text-amber-700 border-amber-200",
                              label: "REVIEW",
                            }
                          : {
                              dot: "bg-indigo-500",
                              chip: "bg-indigo-50 text-indigo-700 border-indigo-200",
                              label: "RISK",
                            };
                      return (
                        <li
                          key={ev.id}
                          className="px-5 py-3 hover:bg-gray-50 flex items-start gap-3 group"
                        >
                          <span
                            className={`shrink-0 w-2.5 h-2.5 rounded-full mt-1.5 ${tone.dot}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${tone.chip}`}
                              >
                                {tone.label}
                              </span>
                              <Link
                                href={`/tests/${ev.check_id}`}
                                className="text-sm font-medium text-gray-900 group-hover:text-brand-700 truncate"
                              >
                                {ev.check_name}
                              </Link>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
                              {ev.framework_name && (
                                <span className="text-emerald-700">
                                  {ev.framework_name}
                                </span>
                              )}
                              {ev.control_name && (
                                <>
                                  <span className="text-gray-300">·</span>
                                  <span className="text-amber-700">
                                    {ev.control_name}
                                  </span>
                                </>
                              )}
                              <span className="text-gray-300">·</span>
                              <span>{ev.performed_by_name ?? "—"}</span>
                              <span className="text-gray-300">·</span>
                              <span>
                                {new Date(ev.created_at).toLocaleTimeString(
                                  undefined,
                                  { hour: "2-digit", minute: "2-digit" }
                                )}
                              </span>
                            </div>
                            {ev.notes && (
                              <div className="text-xs text-gray-600 mt-1 italic truncate">
                                &ldquo;{ev.notes}&rdquo;
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </details>
    </Workspace>
  );
}

function Block({
  href, label, value, tone,
}: {
  href: string; label: string; value: number; tone: "red" | "amber" | "brand";
}) {
  const tones = {
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    brand: "border-brand-200 bg-brand-50 text-brand-700",
  };
  return (
    <Link href={href} className={`block rounded-xl border p-4 hover:shadow-md transition-shadow ${tones[tone]}`}>
      <div className="text-[10px] uppercase tracking-widest opacity-70 mb-1">{label}</div>
      <div className="text-3xl font-bold">{value}</div>
    </Link>
  );
}
