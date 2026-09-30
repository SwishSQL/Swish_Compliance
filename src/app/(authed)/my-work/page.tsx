import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import EmptyState from "@/features/shell/EmptyState";
import { queryOne, queryAll } from "@/lib/db";
import { listSopsAwaitingAck } from "@/features/sops/acknowledgments/repository";

/* ────────────────────────────────────────────────────────────────── */
/*  Types                                                             */
/* ────────────────────────────────────────────────────────────────── */

type CountRow = {
  pending_sops_for_me: number;
  my_capas_open: number;
  my_capas_overdue: number;
  audits_in_progress: number;
  audits_submitted: number;
  sops_owned_draft: number;
  failed_critical_today: number;
};

type CapaItem = {
  id: number;
  code: string | null;
  title: string;
  status: string;
  due_date: string | null;
  severity: string;
};

type AuditItem = {
  id: number;
  template_name: string | null;
  domain_name: string | null;
  framework_code: string | null;
  framework_name: string | null;
  control_code: string | null;
  control_name: string | null;
  brand_name: string | null;
  department_name: string | null;
  location: string | null;
  status: string;
  audit_date: string;
  // Submitted/closed audits already carry the score on the row; for
  // in_progress we compute answered/total via the same UNION used by
  // listItemsWithResponses so the progress matches what the auditor sees.
  score: string | null;
  answered_count: number;
  total_count: number;
  // Whether the current viewer is the creator or assignee — drives the
  // little chip in the UI ("Created" vs "Assigned").
  is_owner: boolean;
  is_assignee: boolean;
};

type SopAckPending = {
  id: number;
  code: string | null;
  title: string;
  approved_at: string | null;
};

type SopOwned = {
  id: number;
  code: string | null;
  title: string;
  status: string;
};

/* ────────────────────────────────────────────────────────────────── */
/*  Page                                                              */
/* ────────────────────────────────────────────────────────────────── */

export default async function MyWorkPage() {
  const user = await requireUser();

  // The user's department lives in DB, not the session, so we read it once.
  const me = await queryOne<{ department_id: number | null; brand_id: number | null }>(
    `SELECT department_id, brand_id FROM users WHERE id = $1`,
    [user.id]
  );
  const myDeptId = me?.department_id ?? null;

  // SOP status the user can act on right now (based on their role).
  const pendingStatusForRole: Record<string, string> = {
    compliance: "pending_compliance",
    business_excellence: "pending_business_excellence",
    ceo: "pending_ceo",
    department_manager: "returned_to_dm",
  };
  const pendingStatus = pendingStatusForRole[user.role] ?? null;

  /* ── Single aggregated counts query ─────────────────────────── */
  const counts = await queryOne<CountRow>(
    `SELECT
       (SELECT COUNT(*) FROM sops
        WHERE status = COALESCE($2, ''))                                                   AS pending_sops_for_me,
       -- CAPA counts widen for the privileged roles (compliance / BE /
       -- admin see everything; DM sees their own department; everyone
       -- else still scopes to "assigned to me"). $3 carries the role,
       -- $4 the dept id so the predicate stays a pure WHERE on the same
       -- aggregate query.
       (SELECT COUNT(*) FROM corrective_actions
        WHERE status IN ('open','in_progress')
          AND (
            $3 IN ('admin','compliance','business_excellence')
            OR ($3 = 'department_manager' AND department_id = $4)
            OR ($3 NOT IN ('admin','compliance','business_excellence','department_manager')
                AND assigned_to = $1)
          ))                                                                                AS my_capas_open,
       (SELECT COUNT(*) FROM corrective_actions
        WHERE due_date < CAST(SYSUTCDATETIME() AS DATE)
          AND status IN ('open','in_progress','submitted')
          AND (
            $3 IN ('admin','compliance','business_excellence')
            OR ($3 = 'department_manager' AND department_id = $4)
            OR ($3 NOT IN ('admin','compliance','business_excellence','department_manager')
                AND assigned_to = $1)
          ))                                                                                AS my_capas_overdue,
       -- Both creator AND assignee count as "mine" (matches the audit
       -- visibility gate we shipped — anyone who can edit shows up here).
       (SELECT COUNT(*) FROM audits
        WHERE (auditor_id = $1 OR assigned_to = $1) AND status = 'in_progress') AS audits_in_progress,
       (SELECT COUNT(*) FROM audits
        WHERE (auditor_id = $1 OR assigned_to = $1) AND status = 'submitted')   AS audits_submitted,
       (SELECT COUNT(*) FROM sops
        WHERE (created_by = $1 OR owner_id = $1)
          AND status IN ('draft','returned_to_dm','returned_to_compliance','returned_to_be')) AS sops_owned_draft,
       (SELECT COUNT(*) FROM audits
        WHERE CAST(submitted_at AS DATE) = CAST(SYSUTCDATETIME() AS DATE) AND critical_failed > 0)                   AS failed_critical_today`,
    [user.id, pendingStatus, user.role, myDeptId ?? -1]
  );

  /* ── Lists ──────────────────────────────────────────────────── */
  const [myCapas, myAudits, sopsAwaitingAck, mySopsInWip] = await Promise.all([
    queryAll<CapaItem>(
      // Same role-scoped visibility as the counts above. Privileged
      // roles get the full register on My Work; DM sees only their
      // department; everyone else still sees "assigned to me".
      `SELECT TOP (6) id, code, title, status, due_date, severity
       FROM corrective_actions
       WHERE status IN ('open','in_progress','submitted')
         AND (
           $2 IN ('admin','compliance','business_excellence')
           OR ($2 = 'department_manager' AND department_id = $3)
           OR ($2 NOT IN ('admin','compliance','business_excellence','department_manager')
               AND assigned_to = $1)
         )
       ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, id DESC`,
      [user.id, user.role, myDeptId ?? -1]
    ),
    queryAll<AuditItem>(
      // LEFT JOIN templates: template_id is NULL in the new tests-first
      // flow, the previous INNER JOIN would have hidden those audits.
      // Domain/framework/control are surfaced so the auditor reads the
      // SAME scope chain here as on the audit detail page.
      //
      // answered_count + total_count use the same UNION as
      // listItemsWithResponses so the progress matches the page exactly:
      //   answered = distinct items with response IN (pass,fail,na)
      //   total    = distinct items from template OR via audit_tests links
      `SELECT TOP (8) a.id,
              t.name   AS template_name,
              dom.name AS domain_name,
              f.code   AS framework_code, f.name AS framework_name,
              ctrl.code AS control_code,  ctrl.name AS control_name,
              b.name   AS brand_name,
              d.name   AS department_name,
              a.location, a.status, a.audit_date,
              CAST(a.score AS NVARCHAR(20)) AS score,
              (SELECT COUNT(DISTINCT r.item_id)
                 FROM audit_responses r
                 WHERE r.audit_id = a.id
                   AND r.response IN ('pass','fail','na'))        AS answered_count,
              (SELECT COUNT(*) FROM (
                 SELECT ci.id FROM checklist_items ci
                 WHERE ci.template_id = a.template_id
                 UNION
                 SELECT cci.checklist_item_id
                 FROM audit_tests at
                 JOIN check_checklist_items cci ON cci.check_id = at.check_id
                 WHERE at.audit_id = a.id
               ) AS items)                                         AS total_count,
              CAST(CASE WHEN a.auditor_id = $1 THEN 1 WHEN a.auditor_id IS NULL THEN NULL ELSE 0 END AS BIT) AS is_owner,
              CAST(CASE WHEN a.assigned_to = $1 THEN 1 WHEN a.assigned_to IS NULL THEN NULL ELSE 0 END AS BIT) AS is_assignee
       FROM audits a
       LEFT JOIN checklist_templates t   ON t.id   = a.template_id
       LEFT JOIN brands       b   ON b.id   = a.brand_id
       LEFT JOIN departments  d   ON d.id   = a.department_id
       LEFT JOIN domains      dom ON dom.id = a.domain_id
       LEFT JOIN frameworks   f   ON f.id   = a.framework_id
       LEFT JOIN controls    ctrl ON ctrl.id = a.control_id
       WHERE (a.auditor_id = $1 OR a.assigned_to = $1)
         AND a.status IN ('in_progress','submitted')
       ORDER BY a.audit_date DESC`,
      [user.id]
    ),
    listSopsAwaitingAck(user.id, user.role, myDeptId, 6),
    queryAll<SopOwned>(
      `SELECT TOP (5) id, code, title, status FROM sops
       WHERE (created_by = $1 OR owner_id = $1)
         AND status IN ('draft','returned_to_dm','returned_to_compliance','returned_to_be')
       ORDER BY updated_at DESC`,
      [user.id]
    ),
  ]);

  /* ── Greeting based on time of day ──────────────────────────── */
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Total open items - drives the "you have N things to do" headline
  const totalOpen =
    (counts?.pending_sops_for_me ?? 0) +
    (counts?.my_capas_open ?? 0) +
    (counts?.audits_in_progress ?? 0) +
    sopsAwaitingAck.length +
    mySopsInWip.length;

  return (
    <Workspace
      section="Workspace / My Work"
      subtitle="Your personal command centre"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* ── HERO ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl border border-emerald-700/30 dark:border-white/10 bg-gradient-to-br from-[#10523a] via-[#0d4730] to-[#0a3a28] dark:from-[#1a1a1a] dark:via-[#141414] dark:to-[#0d0d0d] text-white p-6 md:p-8 mb-6 shadow-xl">
        <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-emerald-500/20 blur-3xl pointer-events-none" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="flex-1 min-w-[260px]">
            <div className="text-[10px] uppercase tracking-[0.3em] font-semibold text-emerald-300/80 mb-2">
              {greeting}
            </div>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight bg-gradient-to-b from-white to-emerald-200/80 bg-clip-text text-transparent">
              {user.displayName.split(" ")[0]}
            </h2>
            <p className="text-sm text-emerald-100/70 mt-2 max-w-xl">
              {totalOpen === 0
                ? "Your inbox is clear. Nothing requires your action right now — nice work."
                : `You have ${totalOpen} open item${totalOpen === 1 ? "" : "s"} that need attention today.`}
            </p>
          </div>

          {/* Quick stat chips */}
          <div className="flex flex-wrap gap-2">
            {(counts?.pending_sops_for_me ?? 0) > 0 && (
              <HeroChip
                href={`/sops?status=${pendingStatus}`}
                emoji="📝"
                label="SOPs to review"
                value={counts?.pending_sops_for_me ?? 0}
              />
            )}
            {(counts?.my_capas_overdue ?? 0) > 0 && (
              <HeroChip
                href="/capa"
                emoji="🚨"
                label="Overdue CAPAs"
                value={counts?.my_capas_overdue ?? 0}
                tone="danger"
              />
            )}
            {(counts?.audits_in_progress ?? 0) > 0 && (
              <HeroChip
                href="/audits?status=in_progress"
                emoji="🔍"
                label="Audits in progress"
                value={counts?.audits_in_progress ?? 0}
              />
            )}
            {sopsAwaitingAck.length > 0 && (
              <HeroChip
                href={`/sops/${sopsAwaitingAck[0].id}`}
                emoji="📖"
                label="SOPs to acknowledge"
                value={sopsAwaitingAck.length}
                tone="warn"
              />
            )}
          </div>
        </div>
      </section>

      {/* ── KPI strip ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {pendingStatus && (
          <StatCard
            icon="📝"
            label={
              user.role === "department_manager"
                ? "SOPs returned to me"
                : user.role === "ceo"
                  ? "SOPs awaiting CEO"
                  : "SOPs awaiting review"
            }
            value={counts?.pending_sops_for_me ?? 0}
            href={`/sops?status=${pendingStatus}`}
            tone="amber"
          />
        )}
        <StatCard
          icon="✏️"
          label="My SOPs in WIP"
          value={counts?.sops_owned_draft ?? 0}
          href="/sops"
          tone="indigo"
        />
        <StatCard
          icon="📖"
          label="To acknowledge"
          value={sopsAwaitingAck.length}
          href="/sops"
          tone="brand"
        />
        <StatCard
          icon="🔧"
          label="My open CAPAs"
          value={counts?.my_capas_open ?? 0}
          href="/capa"
          tone="indigo"
        />
        <StatCard
          icon="🚨"
          label="My overdue CAPAs"
          value={counts?.my_capas_overdue ?? 0}
          href="/capa"
          tone="red"
          emphasize={(counts?.my_capas_overdue ?? 0) > 0}
        />
        <StatCard
          icon="🔍"
          label="Audits in progress"
          value={counts?.audits_in_progress ?? 0}
          href="/audits?status=in_progress"
          tone="brand"
        />
      </div>

      {/* ── Main content grid ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* SOPs awaiting acknowledgment */}
        <Card
          title="SOPs awaiting your acknowledgment"
          eyebrow="Newly approved"
          icon="📖"
          actionLabel={sopsAwaitingAck.length > 0 ? "View all SOPs →" : undefined}
          actionHref="/sops"
        >
          {sopsAwaitingAck.length === 0 ? (
            <EmptyState icon="✓" text="You've acknowledged every active SOP." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {sopsAwaitingAck.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/sops/${s.id}`}
                    className="flex items-start gap-3 px-3 py-3 -mx-3 rounded-lg hover:bg-amber-50/40 transition-colors group"
                  >
                    <span className="shrink-0 w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-sm">
                      📖
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 group-hover:text-brand-700 truncate">
                        {s.title}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                        {s.approved_at && (
                          <span>
                            approved {new Date(s.approved_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-amber-700 font-medium shrink-0 self-center">
                      Read →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* My CAPAs */}
        <Card
          title="My corrective actions"
          eyebrow="Assigned to me"
          icon="🔧"
          actionLabel="View all CAPAs →"
          actionHref="/capa"
        >
          {myCapas.length === 0 ? (
            <EmptyState icon="🎉" text="No CAPAs assigned to you." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {myCapas.map((c) => {
                const today = new Date().toISOString().split("T")[0];
                const overdue = c.due_date && c.due_date < today;
                return (
                  <li key={c.id}>
                    <Link
                      href={`/capa/${c.id}`}
                      className="flex items-start gap-3 px-3 py-3 -mx-3 rounded-lg hover:bg-gray-50 transition-colors group"
                    >
                      <span
                        className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
                          c.severity === "critical"
                            ? "bg-red-100"
                            : c.severity === "high"
                              ? "bg-orange-100"
                              : c.severity === "medium"
                                ? "bg-amber-100"
                                : "bg-gray-100"
                        }`}
                      >
                        ⚠️
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 group-hover:text-brand-700 truncate">
                          {c.title}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                          {c.code && <span className="font-mono">{c.code}</span>}
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium ${
                              c.severity === "critical"
                                ? "bg-red-100 text-red-700"
                                : c.severity === "high"
                                  ? "bg-orange-100 text-orange-700"
                                  : c.severity === "medium"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {c.severity}
                          </span>
                          {c.due_date && (
                            <span className={overdue ? "text-red-700 font-medium" : ""}>
                              {overdue ? "Overdue · " : "Due "}
                              {new Date(c.due_date).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* My audits */}
        <Card
          title="My audits"
          eyebrow="In progress / submitted"
          icon="🔍"
          actionLabel="View all audits →"
          actionHref="/audits"
        >
          {myAudits.length === 0 ? (
            <EmptyState icon="📋" text="No active audits assigned to you." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {myAudits.map((a) => {
                // Title fallback chain: template_name → control_name →
                // framework_name → department + date. Mirrors auditTitle()
                // in features/audits/actions.ts so my-work reads the same.
                const title =
                  a.template_name ||
                  a.control_name ||
                  a.framework_name ||
                  `Audit — ${a.department_name ?? "Unscoped"} (${new Date(a.audit_date).toLocaleDateString()})`;
                // Final score for submitted/closed; live progress for
                // in_progress. Submitted always renders a number even if
                // score is "0", so check status, not the value.
                const isFinal = a.status === "submitted";
                const finalPct =
                  isFinal && a.score != null ? Number(a.score) : null;
                const progressPct =
                  !isFinal && a.total_count > 0
                    ? Math.round((a.answered_count / a.total_count) * 100)
                    : null;
                const pctValue = finalPct ?? progressPct;
                const pctTone =
                  pctValue == null
                    ? "bg-gray-100 text-gray-500"
                    : pctValue >= 90
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : pctValue >= 70
                    ? "bg-amber-50 text-amber-700 border border-amber-200"
                    : pctValue > 0
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : "bg-gray-100 text-gray-600 border border-gray-200";

                return (
                  <li key={a.id}>
                    <Link
                      href={`/audits/${a.id}`}
                      className="flex items-start gap-3 px-3 py-3 -mx-3 rounded-lg hover:bg-gray-50 transition-colors group"
                    >
                      <span className="shrink-0 w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-sm">
                        🔍
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-gray-900 group-hover:text-brand-700 truncate">
                            {title}
                          </span>
                          {a.is_assignee && !a.is_owner && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200 shrink-0">
                              Assigned
                            </span>
                          )}
                          {a.is_owner && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">
                              Created
                            </span>
                          )}
                        </div>
                        {/* Scope chain — Domain · Framework · Control */}
                        {(a.domain_name || a.framework_code || a.control_code) && (
                          <div className="flex flex-wrap items-center gap-1 mt-0.5 text-[10px]">
                            {a.domain_name && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                                {a.domain_name}
                              </span>
                            )}
                            {a.framework_code && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono">
                                {a.framework_code}
                              </span>
                            )}
                            {a.control_code && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-mono">
                                {a.control_code}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-1">
                          {a.brand_name && <span>{a.brand_name}</span>}
                          {a.department_name && <span>· {a.department_name}</span>}
                          {a.location && <span>· {a.location}</span>}
                          <span>· {new Date(a.audit_date).toLocaleDateString()}</span>
                          {!isFinal && a.total_count > 0 && (
                            <span className="text-gray-400">
                              · {a.answered_count}/{a.total_count} answered
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0 self-center">
                        {pctValue != null && (
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${pctTone}`}
                            title={
                              isFinal
                                ? `Final score: ${pctValue}%`
                                : `Progress: ${a.answered_count}/${a.total_count} answered`
                            }
                          >
                            {pctValue}%
                          </span>
                        )}
                        <span
                          className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-medium ${
                            a.status === "in_progress"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-indigo-50 text-indigo-700"
                          }`}
                        >
                          {a.status.replace("_", " ")}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* My SOPs in WIP */}
        <Card
          title="My SOPs in progress"
          eyebrow="Drafts & returned to me"
          icon="✏️"
          actionLabel="View all SOPs →"
          actionHref="/sops"
        >
          {mySopsInWip.length === 0 ? (
            <EmptyState icon="✓" text="No SOPs need your action." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {mySopsInWip.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/sops/${s.id}`}
                    className="flex items-start gap-3 px-3 py-3 -mx-3 rounded-lg hover:bg-gray-50 transition-colors group"
                  >
                    <span className="shrink-0 w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-sm">
                      ✏️
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 group-hover:text-brand-700 truncate">
                        {s.title}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                        <span className="capitalize">{s.status.replace(/_/g, " ")}</span>
                      </div>
                    </div>
                    <span className="text-xs text-indigo-700 font-medium shrink-0 self-center">
                      Edit →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Workspace>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Sub-components                                                    */
/* ────────────────────────────────────────────────────────────────── */

function HeroChip({
  href,
  emoji,
  label,
  value,
  tone = "default",
}: {
  href: string;
  emoji: string;
  label: string;
  value: number;
  tone?: "default" | "warn" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "bg-red-500/20 border-red-400/30 hover:bg-red-500/30"
      : tone === "warn"
        ? "bg-amber-500/20 border-amber-400/30 hover:bg-amber-500/30"
        : "bg-white/10 border-white/20 hover:bg-white/15";
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2.5 backdrop-blur-sm border rounded-xl px-3 py-2 transition-colors ${toneClass}`}
    >
      <span className="text-xl">{emoji}</span>
      <div>
        <div className="text-lg font-bold leading-none">{value}</div>
        <div className="text-[10px] uppercase tracking-wider text-emerald-100/70 mt-0.5">
          {label}
        </div>
      </div>
    </Link>
  );
}

function StatCard({
  icon,
  label,
  value,
  href,
  tone,
  emphasize,
}: {
  icon: string;
  label: string;
  value: number;
  href: string;
  tone: "amber" | "indigo" | "red" | "brand";
  emphasize?: boolean;
}) {
  const tones: Record<typeof tone, string> = {
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-100",
    red: "bg-red-50 text-red-700 border-red-100",
    brand: "bg-brand-50 text-brand-700 border-brand-100",
  };
  return (
    <Link
      href={href}
      className={`block bg-white rounded-xl border border-gray-200 shadow-sm p-3.5 hover:shadow-md transition-shadow ${
        emphasize ? "ring-2 ring-red-300 ring-offset-2" : ""
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm border ${tones[tone]}`}
        >
          <span>{icon}</span>
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-900 leading-tight tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-gray-400 font-medium mt-1 truncate">
        {label}
      </div>
    </Link>
  );
}

function Card({
  title,
  eyebrow,
  icon,
  actionLabel,
  actionHref,
  children,
}: {
  title: string;
  eyebrow?: string;
  icon?: string;
  actionLabel?: string;
  actionHref?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-end justify-between mb-3 gap-3">
        <div>
          {eyebrow && (
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-0.5">
              {eyebrow}
            </div>
          )}
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            {icon && <span>{icon}</span>}
            {title}
          </h3>
        </div>
        {actionLabel && actionHref && (
          <Link
            href={actionHref}
            className="text-xs text-brand-700 hover:underline shrink-0"
          >
            {actionLabel}
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

