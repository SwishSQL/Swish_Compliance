import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import EmptyState from "@/features/shell/EmptyState";
import { queryAll, queryOne } from "@/lib/db";

/* ────────────────────────────────────────────────────────────────── */
/*  Server-side data layer                                            */
/* ────────────────────────────────────────────────────────────────── */

type Overview = {
  total_sops: number;
  approved_sops: number;
  pending_sops: number;
  total_audits: number;
  audits_this_week: number;
  audits_last_week: number;
  avg_score: string | null;
  avg_score_last_30: string | null;
  total_capas: number;
  open_capas: number;
  closed_capas: number;
  overdue_capas: number;
  capas_this_week: number;
  total_checks: number;
  failing_checks: number;
  passing_checks: number;
  total_controls: number;
  healthy_controls: number;
  failing_controls: number;
  total_frameworks: number;
  active_frameworks: number;
  total_checklists: number;
  total_users: number;
};

type DailyAudit = { day: string; audits: number; avg_score: string };
type StatusBreakdown = { label: string; n: number };
type BrandRow = { brand_name: string | null; audits: number; avg_score: string | null; critical: number };
type ControlRisk = { id: number; name: string; code: string | null; open_capas: number; health_status: string };
type ActivityRow = {
  action: string;
  entity: string | null;
  entity_id: number | null;
  user_name: string;
  created_at: string;
};
type FrameworkRow = {
  id: number;
  name: string;
  category: string | null;
  is_active: boolean;
  total_controls: number;
  healthy_controls: number;
};
type ChecklistUsage = {
  id: number;
  name: string;
  category: string | null;
  audit_count: number;
};

export default async function ReportsPage() {
  const user = await requireUser();

  /* ── Headline counts ──────────────────────────────────────────── */
  const overview = await queryOne<Overview>(
    `SELECT
       (SELECT COUNT(*) FROM sops)                                                   AS total_sops,
       (SELECT COUNT(*) FROM sops WHERE status = 'approved')                         AS approved_sops,
       (SELECT COUNT(*) FROM sops
         WHERE status IN ('pending_compliance','pending_business_excellence','pending_ceo',
                          'returned_to_dm','returned_to_compliance','returned_to_be')) AS pending_sops,

       (SELECT COUNT(*) FROM audits WHERE status IN ('submitted','closed'))          AS total_audits,
       (SELECT COUNT(*) FROM audits
         WHERE status IN ('submitted','closed')
           AND submitted_at >= DATEADD(day, -7, SYSUTCDATETIME()))                   AS audits_this_week,
       (SELECT COUNT(*) FROM audits
         WHERE status IN ('submitted','closed')
           AND submitted_at >= DATEADD(day, -14, SYSUTCDATETIME())
           AND submitted_at <  DATEADD(day, -7, SYSUTCDATETIME()))                   AS audits_last_week,
       (SELECT CAST(CAST(ROUND(AVG(CAST(score AS DECIMAL(18,4))), 1) AS DECIMAL(18,1)) AS NVARCHAR(40))
          FROM audits WHERE score IS NOT NULL)                                       AS avg_score,
       (SELECT CAST(CAST(ROUND(AVG(CAST(score AS DECIMAL(18,4))), 1) AS DECIMAL(18,1)) AS NVARCHAR(40))
          FROM audits
         WHERE score IS NOT NULL AND submitted_at >= DATEADD(day, -30, SYSUTCDATETIME())) AS avg_score_last_30,

       (SELECT COUNT(*) FROM corrective_actions)                                     AS total_capas,
       (SELECT COUNT(*) FROM corrective_actions
         WHERE status IN ('open','in_progress','submitted'))                         AS open_capas,
       (SELECT COUNT(*) FROM corrective_actions WHERE status = 'closed')             AS closed_capas,
       (SELECT COUNT(*) FROM corrective_actions
         WHERE due_date < CAST(SYSUTCDATETIME() AS DATE)
           AND status IN ('open','in_progress','submitted'))                         AS overdue_capas,
       (SELECT COUNT(*) FROM corrective_actions
         WHERE created_at >= DATEADD(day, -7, SYSUTCDATETIME()))                     AS capas_this_week,

       (SELECT COUNT(*) FROM checks WHERE is_active = 1)                             AS total_checks,
       (SELECT COUNT(*) FROM checks WHERE last_status = 'failing')                   AS failing_checks,
       (SELECT COUNT(*) FROM checks WHERE last_status = 'passing')                   AS passing_checks,

       (SELECT COUNT(*) FROM controls WHERE is_active = 1)                           AS total_controls,
       (SELECT COUNT(*) FROM controls WHERE health_status = 'healthy')               AS healthy_controls,
       (SELECT COUNT(*) FROM controls WHERE health_status = 'failing')               AS failing_controls,

       (SELECT COUNT(*) FROM frameworks)                                             AS total_frameworks,
       (SELECT COUNT(*) FROM frameworks WHERE is_active = 1)                         AS active_frameworks,

       (SELECT COUNT(*) FROM checklist_templates WHERE is_active = 1)                AS total_checklists,
       (SELECT COUNT(*) FROM users WHERE is_active = 1)                              AS total_users`
  );

  /* ── 30-day audit activity (one row per day, padded with zeros) ── */
  const dailyAudits = await queryAll<DailyAudit>(
    `WITH days AS (
       SELECT 29 AS n, DATEADD(day, -29, CAST(SYSUTCDATETIME() AS DATE)) AS d
       UNION ALL
       SELECT n - 1, DATEADD(day, 1, d) FROM days WHERE n > 0
     )
     SELECT
       CONVERT(NVARCHAR(10), d.d, 23)                                    AS day,
       COUNT(a.id)                                                       AS audits,
       COALESCE(CAST(CAST(ROUND(AVG(CAST(a.score AS DECIMAL(18,4))), 1) AS DECIMAL(18,1)) AS NVARCHAR(40)), '0') AS avg_score
     FROM days d
     LEFT JOIN audits a
       ON CAST(a.submitted_at AS DATE) = d.d
      AND a.status IN ('submitted','closed')
      AND a.score IS NOT NULL
     GROUP BY d.d
     ORDER BY d.d ASC`
  );

  /* ── SOP status breakdown ─────────────────────────────────────── */
  // INITCAP has no T-SQL equivalent: unmapped statuses come back with a
  // NULL label and are title-cased in JS (see initcap below).
  const sopByStatus = (await queryAll<StatusBreakdown & { status: string }>(
    `SELECT
       status,
       CASE status
         WHEN 'draft'                       THEN 'Draft'
         WHEN 'pending_compliance'          THEN 'Pending Compliance'
         WHEN 'pending_business_excellence' THEN 'Pending BE'
         WHEN 'pending_ceo'                 THEN 'Pending CEO'
         WHEN 'returned_to_dm'              THEN 'Returned → DM'
         WHEN 'returned_to_compliance'      THEN 'Returned → Compliance'
         WHEN 'returned_to_be'              THEN 'Returned → BE'
         WHEN 'approved'                    THEN 'Approved'
         WHEN 'archived'                    THEN 'Archived'
       END AS label,
       COUNT(*) AS n
     FROM sops
     GROUP BY status
     ORDER BY n DESC`
  )).map((r) => ({ label: r.label ?? initcap(r.status.replace(/_/g, " ")), n: r.n }));

  /* ── CAPA by severity (open only) ─────────────────────────────── */
  const capaBySeverity = (await queryAll<{ severity: string; n: number }>(
    `SELECT severity, COUNT(*) AS n
     FROM corrective_actions
     WHERE status NOT IN ('closed','rejected')
     GROUP BY severity
     ORDER BY
       CASE severity
         WHEN 'critical' THEN 1
         WHEN 'high' THEN 2
         WHEN 'medium' THEN 3
         WHEN 'low' THEN 4
         ELSE 5
       END`
  )).map((r) => ({ label: initcap(r.severity), n: r.n }));

  /* ── CAPA by status (all) ─────────────────────────────────────── */
  const capaByStatus = (await queryAll<{ status: string; n: number }>(
    `SELECT status, COUNT(*) AS n
     FROM corrective_actions GROUP BY status ORDER BY n DESC`
  )).map((r) => ({ label: initcap(r.status.replace(/_/g, " ")), n: r.n }));

  /* ── Audit score per brand ────────────────────────────────────── */
  const byBrand = await queryAll<BrandRow>(
    `SELECT
       b.name AS brand_name,
       COUNT(*)                                     AS audits,
       CAST(CAST(ROUND(AVG(CAST(a.score AS DECIMAL(18,4))), 1) AS DECIMAL(18,1)) AS NVARCHAR(40)) AS avg_score,
       COALESCE(SUM(a.critical_failed),0)           AS critical
     FROM audits a
     LEFT JOIN brands b ON b.id = a.brand_id
     WHERE a.status IN ('submitted','closed') AND a.score IS NOT NULL
     GROUP BY b.name
     ORDER BY AVG(CAST(a.score AS DECIMAL(18,4))) DESC`
  );

  const topBrands = byBrand.slice(0, 5);
  const bottomBrands = [...byBrand].reverse().slice(0, 5);

  /* ── Top controls needing attention ───────────────────────────── */
  const topFailingControls = await queryAll<ControlRisk>(
    `SELECT TOP (8) c.id, c.name, c.code, c.health_status,
       (SELECT COUNT(*) FROM corrective_actions ca
        JOIN control_links cl ON cl.entity_type = 'capa' AND cl.entity_id = ca.id
        WHERE cl.control_id = c.id AND ca.status IN ('open','in_progress','submitted')) AS open_capas
     FROM controls c
     WHERE c.is_active = 1 AND c.health_status IN ('failing','at_risk')
     ORDER BY CASE WHEN c.health_status = 'failing' THEN 1 ELSE 0 END DESC, open_capas DESC`
  );

  /* ── Recent activity (audit_logs) ─────────────────────────────── */
  const activity = await queryAll<ActivityRow>(
    `SELECT TOP (12) al.action, al.entity, al.entity_id,
            COALESCE(u.display_name, al.user_email, 'System') AS user_name,
            al.created_at
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ORDER BY al.created_at DESC`
  );

  /* ── Framework coverage ───────────────────────────────────────── */
  const frameworks = await queryAll<FrameworkRow>(
    `SELECT TOP (8) f.id, f.name, f.category, f.is_active,
       COUNT(c.id)                                                               AS total_controls,
       COALESCE(SUM(CASE WHEN c.health_status = 'healthy' THEN 1 ELSE 0 END), 0) AS healthy_controls
     FROM frameworks f
     LEFT JOIN controls c ON c.framework_id = f.id AND c.is_active = 1
     GROUP BY f.id, f.name, f.category, f.is_active
     ORDER BY f.is_active DESC, total_controls DESC, f.name`
  );

  /* ── Checklist usage (by audit count) ─────────────────────────── */
  const checklistUsage = await queryAll<ChecklistUsage>(
    `SELECT TOP (6) t.id, t.name, t.category,
       (SELECT COUNT(*) FROM audits a WHERE a.template_id = t.id) AS audit_count
     FROM checklist_templates t
     WHERE t.is_active = 1
     ORDER BY audit_count DESC, t.name ASC`
  );

  /* ── Computed composites ──────────────────────────────────────── */
  const approvedRate = pct(overview?.approved_sops, overview?.total_sops);
  const closureRate = pct(overview?.closed_capas, overview?.total_capas);
  const controlHealthRate = pct(overview?.healthy_controls, overview?.total_controls);
  const auditPassRate = overview?.avg_score ? Number(overview.avg_score) : 0;

  // Composite "compliance health" = simple average of the four percentages.
  const counted = [approvedRate, closureRate, controlHealthRate, auditPassRate].filter(
    (x) => Number.isFinite(x) && x > 0
  );
  const complianceHealth =
    counted.length > 0
      ? Math.round(counted.reduce((a, b) => a + b, 0) / counted.length)
      : 0;

  const auditsTrend =
    (overview?.audits_this_week ?? 0) - (overview?.audits_last_week ?? 0);

  return (
    <Workspace
      section="Workspace / Reports"
      subtitle="Executive rollups across SOPs, audits, CAPAs, tests, controls, frameworks"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* ──────────────────────────────────────────────────────────── */}
      {/*  HERO — Compliance Health                                    */}
      {/* ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl border border-emerald-700/30 dark:border-white/10 bg-gradient-to-br from-[#10523a] via-[#0d4730] to-[#0a3a28] dark:from-[#1a1a1a] dark:via-[#141414] dark:to-[#0d0d0d] text-white p-6 md:p-8 mb-6 shadow-xl">
        {/* Decorative orbs */}
        <div className="absolute -top-32 -right-32 w-80 h-80 rounded-full bg-emerald-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-brand-500/10 blur-3xl pointer-events-none" />

        <div className="relative grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6 items-center">
          {/* Left — big composite score */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] font-semibold text-emerald-300/80 mb-3">
              Compliance Health
            </div>
            <div className="flex items-end gap-3 mb-4">
              <div className="text-7xl md:text-8xl font-black tracking-tighter leading-none bg-gradient-to-b from-white to-emerald-200/80 bg-clip-text text-transparent">
                {complianceHealth}
              </div>
              <div className="text-3xl font-light text-emerald-300/70 pb-3">%</div>
              <div
                className={`mb-3 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-semibold ${
                  complianceHealth >= 80
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30"
                    : complianceHealth >= 60
                      ? "bg-amber-500/20 text-amber-300 border border-amber-400/30"
                      : "bg-red-500/20 text-red-300 border border-red-400/30"
                }`}
              >
                {complianceHealth >= 80 ? "Strong" : complianceHealth >= 60 ? "Watch" : "At risk"}
              </div>
            </div>
            <p className="text-sm text-emerald-100/70 max-w-md leading-relaxed">
              A weighted blend of SOP approvals, audit performance, control health and CAPA closure.
              The single number you watch month-to-month.
            </p>
          </div>

          {/* Right — 4 sub-scores */}
          <div className="grid grid-cols-2 gap-3">
            <HeroMetric label="SOPs approved" value={`${approvedRate}%`} caption={`${overview?.approved_sops ?? 0} / ${overview?.total_sops ?? 0}`} />
            <HeroMetric label="Audit avg" value={`${auditPassRate || 0}%`} caption={`${overview?.total_audits ?? 0} audits`} />
            <HeroMetric label="Control health" value={`${controlHealthRate}%`} caption={`${overview?.healthy_controls ?? 0} healthy`} />
            <HeroMetric label="CAPA closure" value={`${closureRate}%`} caption={`${overview?.closed_capas ?? 0} closed`} />
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────── */}
      {/*  KPI STRIP — small numbers across the system                 */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Kpi
          icon="📋"
          label="Total SOPs"
          value={overview?.total_sops ?? 0}
          sub={overview?.pending_sops ? `${overview.pending_sops} in review` : "all reviewed"}
          tint="indigo"
        />
        <Kpi
          icon="🔍"
          label="Audits done"
          value={overview?.total_audits ?? 0}
          sub={`${overview?.audits_this_week ?? 0} this week`}
          trend={auditsTrend}
          tint="emerald"
        />
        <Kpi
          icon="⚠️"
          label="Open CAPAs"
          value={overview?.open_capas ?? 0}
          sub={`${overview?.capas_this_week ?? 0} new this wk`}
          tint="amber"
        />
        <Kpi
          icon="🚨"
          label="Overdue"
          value={overview?.overdue_capas ?? 0}
          sub="past due date"
          tint={overview?.overdue_capas && overview.overdue_capas > 0 ? "red" : "slate"}
        />
        <Kpi
          icon="🧪"
          label="Failing tests"
          value={overview?.failing_checks ?? 0}
          sub={`${overview?.passing_checks ?? 0} passing`}
          tint={overview?.failing_checks && overview.failing_checks > 0 ? "red" : "emerald"}
        />
        <Kpi
          icon="🛡️"
          label="Controls"
          value={overview?.total_controls ?? 0}
          sub={`${overview?.failing_controls ?? 0} failing`}
          tint="slate"
        />
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/*  AUDIT ACTIVITY — 30-day bar chart                           */}
      {/* ──────────────────────────────────────────────────────────── */}
      <Section
        title="Audit activity"
        eyebrow="Last 30 days"
        right={
          <div className="text-xs text-gray-500">
            Avg score last 30d:{" "}
            <span className="font-semibold text-gray-800">
              {overview?.avg_score_last_30 ?? "—"}%
            </span>
          </div>
        }
      >
        <AuditBarChart data={dailyAudits} />
      </Section>

      {/* ──────────────────────────────────────────────────────────── */}
      {/*  CHARTS ROW — donuts + checklist usage                       */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <ChartCard title="SOPs by status" eyebrow="Workflow snapshot">
          <Donut
            data={sopByStatus}
            palette={["#10b981", "#f59e0b", "#6366f1", "#ec4899", "#a78bfa", "#64748b", "#0ea5e9"]}
          />
        </ChartCard>

        <ChartCard title="Open CAPAs by severity" eyebrow="Triage view">
          <Donut
            data={capaBySeverity}
            palette={["#dc2626", "#f97316", "#f59e0b", "#10b981"]}
            emptyLabel="No open CAPAs 🎉"
          />
        </ChartCard>

        <ChartCard title="Top checklists" eyebrow="Most-audited templates">
          <ChecklistUsageList rows={checklistUsage} />
        </ChartCard>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/*  LEADERBOARD — top vs bottom brands                          */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <BrandLeaderboard
          title="🏆 Strongest brands"
          eyebrow="Top by avg audit score"
          rows={topBrands}
          tone="good"
        />
        <BrandLeaderboard
          title="🚧 Needs attention"
          eyebrow="Lowest avg audit scores"
          rows={bottomBrands}
          tone="bad"
        />
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/*  AUDIT BY BRAND — full table                                 */}
      {/* ──────────────────────────────────────────────────────────── */}
      <Section title="Audit performance by brand" eyebrow="All brands">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Brand</th>
                <th className="text-left px-5 py-3 font-medium">Audits</th>
                <th className="text-left px-5 py-3 font-medium">Avg score</th>
                <th className="text-left px-5 py-3 font-medium">Score bar</th>
                <th className="text-left px-5 py-3 font-medium">Critical fails</th>
              </tr>
            </thead>
            <tbody>
              {byBrand.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-gray-400">
                    No completed audits yet.
                  </td>
                </tr>
              )}
              {byBrand.map((r, i) => {
                const score = r.avg_score ? Number(r.avg_score) : 0;
                return (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-5 py-3 font-medium text-gray-900">
                      {r.brand_name ?? "Unassigned"}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{r.audits}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`font-semibold ${
                          score >= 90
                            ? "text-emerald-700"
                            : score >= 70
                              ? "text-amber-700"
                              : score > 0
                                ? "text-red-700"
                                : "text-gray-400"
                        }`}
                      >
                        {r.avg_score ? `${r.avg_score}%` : "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3 min-w-[160px]">
                      <ScoreBar pct={score} />
                    </td>
                    <td className="px-5 py-3">
                      {r.critical > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                          {r.critical}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ──────────────────────────────────────────────────────────── */}
      {/*  RISK + ACTIVITY  — two columns                              */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4 mb-6">
        <ChartCard title="Controls needing attention" eyebrow="Risk register">
          {topFailingControls.length === 0 ? (
            <EmptyState icon="🛡️" text="All controls are healthy or not yet measured." />
          ) : (
            <ul className="space-y-2">
              {topFailingControls.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <Link
                    href={`/controls/${c.id}`}
                    className="text-sm text-gray-800 hover:text-brand-700 hover:underline flex-1 truncate"
                  >
                    {c.name}
                  </Link>
                  <span
                    className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-medium ${
                      c.health_status === "failing"
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : "bg-amber-50 text-amber-700 border border-amber-200"
                    }`}
                  >
                    {c.health_status === "failing" ? "Failing" : "At risk"}
                  </span>
                  <span className="text-xs font-medium text-gray-600 min-w-[60px] text-right">
                    {c.open_capas} CAPA{c.open_capas === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>

        <ChartCard title="Recent activity" eyebrow="Last events">
          {activity.length === 0 ? (
            <EmptyState icon="📡" text="Nothing logged yet." />
          ) : (
            <ul className="space-y-2.5">
              {activity.map((row, i) => {
                const { icon, label, tone } = describeActivity(row.action, row.entity);
                return (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span
                      className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs ${tone}`}
                    >
                      {icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-800 truncate">
                        <span className="font-medium">{row.user_name}</span>{" "}
                        <span className="text-gray-500">{label}</span>
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {timeAgo(row.created_at)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ChartCard>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/*  FRAMEWORK COVERAGE                                          */}
      {/* ──────────────────────────────────────────────────────────── */}
      <Section title="Framework coverage" eyebrow="Controls per framework">
        {frameworks.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center text-gray-400">
            No frameworks defined yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {frameworks.map((fw) => {
              const healthyPct = pct(fw.healthy_controls, fw.total_controls);
              return (
                <Link
                  key={fw.id}
                  href={`/frameworks/${fw.id}`}
                  className="group block bg-white rounded-2xl border border-gray-200 shadow-sm p-4 hover:shadow-md hover:border-brand-200 transition-all"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
                      {fw.category ?? "—"}
                    </div>
                    {fw.is_active ? (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Active
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200">
                        Draft
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-gray-900 mb-2 truncate group-hover:text-brand-700 transition-colors">
                    {fw.name}
                  </div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-2xl font-bold text-gray-900">{fw.total_controls}</span>
                    <span className="text-xs text-gray-500">controls</span>
                  </div>
                  <ScoreBar pct={healthyPct} />
                  <div className="text-[11px] text-gray-500 mt-1">
                    {fw.healthy_controls} healthy ({healthyPct}%)
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      {/* ──────────────────────────────────────────────────────────── */}
      {/*  CAPA STATUS — keep the simple list for reference            */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="CAPAs by status" eyebrow="Workflow distribution">
          {capaByStatus.length === 0 ? (
            <EmptyState icon="✅" text="No CAPAs in the system yet." />
          ) : (
            <ul className="space-y-2">
              {capaByStatus.map((r) => {
                const max = Math.max(...capaByStatus.map((x) => x.n));
                const w = Math.round((r.n / max) * 100);
                return (
                  <li key={r.label}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-700">{r.label}</span>
                      <span className="font-semibold tabular-nums">{r.n}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-700"
                        style={{ width: `${w}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ChartCard>

        <ChartCard title="System inventory" eyebrow="At a glance">
          <ul className="space-y-2.5 text-sm">
            <InventoryRow icon="📋" label="SOPs registered" n={overview?.total_sops ?? 0} />
            <InventoryRow icon="📑" label="Checklist templates" n={overview?.total_checklists ?? 0} />
            <InventoryRow icon="🔍" label="Audits performed" n={overview?.total_audits ?? 0} />
            <InventoryRow icon="🧪" label="Active tests" n={overview?.total_checks ?? 0} />
            <InventoryRow icon="🛡️" label="Controls" n={overview?.total_controls ?? 0} />
            <InventoryRow icon="🏛️" label="Frameworks (active)" n={`${overview?.active_frameworks ?? 0} / ${overview?.total_frameworks ?? 0}`} />
            <InventoryRow icon="👥" label="Active users" n={overview?.total_users ?? 0} />
          </ul>
        </ChartCard>
      </div>
    </Workspace>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Helpers                                                           */
/* ────────────────────────────────────────────────────────────────── */

function pct(num: number | undefined | null, den: number | undefined | null): number {
  if (!num || !den || den === 0) return 0;
  return Math.round((num / den) * 100);
}

// PostgreSQL INITCAP: first letter of each alphanumeric run upper-cased,
// the rest lower-cased.
function initcap(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[^a-z0-9])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function describeActivity(action: string, entity: string | null): {
  icon: string;
  label: string;
  tone: string;
} {
  // Status-flavored actions take priority
  if (action.startsWith("check_result:")) {
    const status = action.split(":")[1];
    if (status === "failing") return { icon: "🔴", label: "logged a failing test", tone: "bg-red-50 text-red-700" };
    if (status === "passing") return { icon: "🟢", label: "logged a passing test", tone: "bg-emerald-50 text-emerald-700" };
    return { icon: "🧪", label: `logged test (${status})`, tone: "bg-amber-50 text-amber-700" };
  }
  if (action === "audit:submitted") return { icon: "📤", label: "submitted an audit", tone: "bg-indigo-50 text-indigo-700" };
  if (action === "audit:closed") return { icon: "🔒", label: "closed an audit", tone: "bg-emerald-50 text-emerald-700" };
  if (action === "audit:reopened") return { icon: "🔓", label: "reopened an audit", tone: "bg-amber-50 text-amber-700" };
  if (action === "sop:approved") return { icon: "✅", label: "approved an SOP", tone: "bg-emerald-50 text-emerald-700" };
  if (action === "sop:rejected") return { icon: "✋", label: "rejected an SOP", tone: "bg-red-50 text-red-700" };
  if (action === "create") {
    const verb = `created ${entityLabel(entity)}`;
    return { icon: "✨", label: verb, tone: "bg-brand-50 text-brand-700" };
  }
  if (action === "update") return { icon: "✏️", label: `updated ${entityLabel(entity)}`, tone: "bg-gray-100 text-gray-700" };
  if (action === "delete") return { icon: "🗑️", label: `deleted ${entityLabel(entity)}`, tone: "bg-red-50 text-red-700" };
  return { icon: "•", label: action.replace(/[:_]/g, " "), tone: "bg-gray-100 text-gray-600" };
}

function entityLabel(entity: string | null): string {
  if (!entity) return "an item";
  return entity.replace(/_/g, " ");
}

/* ────────────────────────────────────────────────────────────────── */
/*  Subcomponents                                                     */
/* ────────────────────────────────────────────────────────────────── */

function HeroMetric({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="bg-white/[0.06] border border-white/[0.08] rounded-xl p-4 backdrop-blur-sm">
      <div className="text-[10px] uppercase tracking-widest text-emerald-200/70 font-medium mb-1.5">
        {label}
      </div>
      <div className="text-2xl font-bold text-white tracking-tight">{value}</div>
      <div className="text-[11px] text-emerald-200/50 mt-0.5">{caption}</div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  trend,
  tint = "slate",
}: {
  icon: string;
  label: string;
  value: string | number;
  sub?: string;
  trend?: number;
  tint?: "indigo" | "emerald" | "amber" | "red" | "slate";
}) {
  const tints: Record<string, string> = {
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    red: "bg-red-50 text-red-700 border-red-100",
    slate: "bg-slate-50 text-slate-700 border-slate-100",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3.5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm border ${tints[tint]}`}
        >
          <span>{icon}</span>
        </div>
        {typeof trend === "number" && trend !== 0 && (
          <span
            className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full ${
              trend > 0
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {trend > 0 ? "▲" : "▼"} {Math.abs(trend)}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-gray-900 leading-tight tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-gray-400 font-medium mt-1">
        {label}
      </div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function Section({
  title,
  eyebrow,
  right,
  children,
}: {
  title: string;
  eyebrow?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-end justify-between mb-3 gap-3">
        <div>
          {eyebrow && (
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-0.5">
              {eyebrow}
            </div>
          )}
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {children}
    </div>
  );
}

function ChartCard({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
      {eyebrow && (
        <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-0.5">
          {eyebrow}
        </div>
      )}
      <h3 className="text-sm font-semibold text-gray-800 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function InventoryRow({
  icon,
  label,
  n,
}: {
  icon: string;
  label: string;
  n: number | string;
}) {
  return (
    <li className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-gray-700 inline-flex items-center gap-2">
        <span className="text-base">{icon}</span> {label}
      </span>
      <span className="font-semibold text-gray-900 tabular-nums">{n}</span>
    </li>
  );
}

function ScoreBar({ pct: p }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, p));
  const tone =
    clamped >= 80
      ? "from-emerald-400 to-emerald-600"
      : clamped >= 60
        ? "from-amber-400 to-amber-600"
        : clamped > 0
          ? "from-red-400 to-red-600"
          : "from-gray-300 to-gray-400";
  return (
    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
      <div
        className={`h-full rounded-full bg-gradient-to-r ${tone} transition-all`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function BrandLeaderboard({
  title,
  eyebrow,
  rows,
  tone,
}: {
  title: string;
  eyebrow: string;
  rows: BrandRow[];
  tone: "good" | "bad";
}) {
  return (
    <ChartCard title={title} eyebrow={eyebrow}>
      {rows.length === 0 ? (
        <EmptyState icon="📊" text="No data yet." />
      ) : (
        <ol className="space-y-2.5">
          {rows.map((r, i) => {
            const score = r.avg_score ? Number(r.avg_score) : 0;
            return (
              <li key={i} className="flex items-center gap-3">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    tone === "good"
                      ? i === 0
                        ? "bg-amber-100 text-amber-700"
                        : "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {r.brand_name ?? "Unassigned"}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {r.audits} audit{r.audits === 1 ? "" : "s"}
                    {r.critical > 0 && (
                      <span className="ml-1.5 text-red-600">
                        · {r.critical} critical
                      </span>
                    )}
                  </div>
                </div>
                <div
                  className={`text-lg font-bold tabular-nums ${
                    score >= 90
                      ? "text-emerald-700"
                      : score >= 70
                        ? "text-amber-700"
                        : "text-red-700"
                  }`}
                >
                  {r.avg_score ?? "—"}%
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </ChartCard>
  );
}

function ChecklistUsageList({ rows }: { rows: ChecklistUsage[] }) {
  if (rows.length === 0) return <EmptyState icon="📑" text="No checklists in use yet." />;
  const max = Math.max(1, ...rows.map((r) => r.audit_count));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const w = Math.max(4, Math.round((r.audit_count / max) * 100));
        return (
          <li key={r.id}>
            <Link
              href={`/checklists/templates/${r.id}`}
              className="block group"
            >
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-sm font-medium text-gray-800 group-hover:text-brand-700 truncate">
                  {r.name}
                </span>
                <span className="text-xs font-semibold text-gray-600 tabular-nums shrink-0">
                  {r.audit_count}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all"
                  style={{ width: `${w}%` }}
                />
              </div>
              {r.category && (
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mt-0.5">
                  {r.category}
                </div>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Charts — pure SVG, no libraries                                   */
/* ────────────────────────────────────────────────────────────────── */

function Donut({
  data,
  palette,
  emptyLabel = "No data yet.",
}: {
  data: StatusBreakdown[];
  palette: string[];
  emptyLabel?: string;
}) {
  const total = data.reduce((a, b) => a + b.n, 0);
  if (total === 0) return <EmptyState icon="◯" text={emptyLabel} />;

  const radius = 60;
  const stroke = 16;
  const circ = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 160 160" className="w-32 h-32 shrink-0 -rotate-90">
        <circle cx="80" cy="80" r={radius} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
        {data.map((slice, i) => {
          const len = (slice.n / total) * circ;
          const seg = (
            <circle
              key={i}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={palette[i % palette.length]}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return seg;
        })}
        {/* Centre total */}
        <g transform="rotate(90 80 80)">
          <text
            x="80"
            y="76"
            textAnchor="middle"
            className="fill-gray-900"
            style={{ fontSize: 22, fontWeight: 700 }}
          >
            {total}
          </text>
          <text
            x="80"
            y="93"
            textAnchor="middle"
            className="fill-gray-400"
            style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase" }}
          >
            Total
          </text>
        </g>
      </svg>

      <ul className="flex-1 space-y-1.5 text-xs">
        {data.map((slice, i) => {
          const p = Math.round((slice.n / total) * 100);
          return (
            <li key={i} className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: palette[i % palette.length] }}
              />
              <span className="flex-1 text-gray-700 truncate">{slice.label}</span>
              <span className="text-gray-500 tabular-nums">{slice.n}</span>
              <span className="text-gray-400 tabular-nums w-9 text-right">{p}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AuditBarChart({ data }: { data: DailyAudit[] }) {
  const max = Math.max(1, ...data.map((d) => d.audits));

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-end gap-1 h-40 mb-2">
        {data.map((d, i) => {
          const h = d.audits === 0 ? 4 : Math.max(8, Math.round((d.audits / max) * 100));
          const score = Number(d.avg_score);
          const tone =
            d.audits === 0
              ? "bg-gray-100"
              : score >= 90
                ? "bg-gradient-to-t from-emerald-500 to-emerald-300"
                : score >= 70
                  ? "bg-gradient-to-t from-amber-500 to-amber-300"
                  : score > 0
                    ? "bg-gradient-to-t from-red-500 to-red-300"
                    : "bg-gradient-to-t from-brand-500 to-brand-300";
          return (
            <div
              key={i}
              className="group relative flex-1 flex flex-col items-stretch justify-end"
              title={`${d.day} · ${d.audits} audit${d.audits === 1 ? "" : "s"}${d.audits > 0 ? ` · avg ${d.avg_score}%` : ""}`}
            >
              <div
                className={`rounded-t-md transition-all duration-300 ${tone}`}
                style={{ height: `${h}%` }}
              />
              {/* Tooltip on hover */}
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap bg-gray-900 text-white text-[10px] px-2 py-1 rounded shadow-lg">
                {d.day} · {d.audits} audit{d.audits === 1 ? "" : "s"}
                {d.audits > 0 && <> · {d.avg_score}%</>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 px-1">
        <span>{data[0]?.day.slice(5) ?? "—"}</span>
        <span>{data[Math.floor(data.length / 2)]?.day.slice(5) ?? "—"}</span>
        <span>{data[data.length - 1]?.day.slice(5) ?? "—"}</span>
      </div>
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 text-[10px] uppercase tracking-wider text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-t from-emerald-500 to-emerald-300" />
          ≥ 90%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-t from-amber-500 to-amber-300" />
          70-89%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-t from-red-500 to-red-300" />
          &lt; 70%
        </span>
      </div>
    </div>
  );
}
