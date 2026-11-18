import "server-only";
import { execute, queryAll } from "@/lib/db";

/**
 * Due-date reminders and overdue escalations (docs/RBAC.md §9). Runs on a
 * timer started at server boot (instrumentation-node.ts). Each reminder is
 * sent once per record per window — reminders_sent (migration 007)
 * de-duplicates — so restarts and repeated runs never spam.
 *
 *   capa:due_soon       assignee                         due within 3 days
 *   capa:overdue        assignee + creator + dept managers, weekly while overdue
 *   audit:due_soon      assigned auditor                 ends within 2 days
 *   audit:overdue       auditor + creator, weekly while overdue
 *   sop:review_due      owner                            review date within 30 days
 */

type Due = { id: number; title: string; recipients: string | null };

const OPEN_CAPA =
  "('open','assigned','in_progress','pending_manager_review','pending_compliance_verification','returned','submitted','rejected')";

/** Claim a (kind, entity, window) slot; true if this run should send. */
async function claim(kind: string, entityType: string, id: number, windowStart: string): Promise<boolean> {
  const inserted = await execute(
    `INSERT INTO reminders_sent (kind, entity_type, entity_id, sent_on)
     SELECT $1, $2, $3, CAST($4 AS DATE)
     WHERE NOT EXISTS (SELECT 1 FROM reminders_sent
                       WHERE kind = $1 AND entity_type = $2 AND entity_id = $3 AND sent_on >= CAST($4 AS DATE))`,
    [kind, entityType, id, windowStart]
  );
  return inserted > 0;
}

async function send(
  rows: Due[],
  kind: string,
  entityType: string,
  href: (id: number) => string,
  title: (r: Due) => string,
  body: string,
  severity: "info" | "warning" | "critical",
  windowStart: string
): Promise<number> {
  let sent = 0;
  for (const r of rows) {
    const userIds = Array.from(
      new Set((r.recipients ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))
    );
    if (userIds.length === 0) continue;
    if (!(await claim(kind, entityType, r.id, windowStart))) continue;
    await execute(
      `INSERT INTO notifications
         (user_id, actor_id, actor_name, actor_role, kind, title, body, severity, entity_type, entity_id, href)
       SELECT CAST(j.value AS INT), NULL, N'System', N'system', $2, $3, $4, $5, $6, $7, $8
       FROM OPENJSON($1) j`,
      [JSON.stringify(userIds), kind, title(r), body, severity, entityType, r.id, href(r.id)]
    );
    sent++;
  }
  return sent;
}

const DEPT_MANAGERS = (deptCol: string) => `
  COALESCE((SELECT STRING_AGG(CAST(x.id AS NVARCHAR(12)), ',') FROM (
     SELECT d.manager_id AS id FROM departments d WHERE d.id = ${deptCol} AND d.manager_id IS NOT NULL
     UNION
     SELECT u.id FROM users u
     WHERE u.is_active = 1
       AND (u.role = 'department_manager'
            OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'department_manager'))
       AND (u.department_id = ${deptCol}
            OR EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = u.id AND ud.department_id = ${deptCol}))
  ) x), '')`;

export async function runReminders(now = new Date()): Promise<Record<string, number>> {
  const weekAgo = new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const farPast = "2000-01-01";
  const out: Record<string, number> = {};

  const capaDueSoon = await queryAll<Due>(
    `SELECT c.id, c.title, CAST(c.assigned_to AS NVARCHAR(12)) AS recipients
     FROM corrective_actions c
     WHERE c.status IN ${OPEN_CAPA} AND c.assigned_to IS NOT NULL
       AND c.due_date >= CAST(SYSUTCDATETIME() AS DATE)
       AND c.due_date <= DATEADD(day, 3, CAST(SYSUTCDATETIME() AS DATE))`
  );
  out.capa_due_soon = await send(capaDueSoon, "capa:due_soon", "capa", (id) => `/capa/${id}`,
    (r) => `CAPA "${r.title}" is due soon`, "The due date is within 3 days.", "warning", farPast);

  const capaOverdue = await queryAll<Due>(
    `SELECT c.id, c.title,
            CONCAT(COALESCE(CAST(c.assigned_to AS NVARCHAR(12)), ''), ',',
                   COALESCE(CAST(c.created_by AS NVARCHAR(12)), ''), ',',
                   ${DEPT_MANAGERS("c.department_id")}) AS recipients
     FROM corrective_actions c
     WHERE c.status IN ${OPEN_CAPA}
       AND c.due_date < CAST(SYSUTCDATETIME() AS DATE)`
  );
  out.capa_overdue = await send(capaOverdue, "capa:overdue", "capa", (id) => `/capa/${id}`,
    (r) => `⚠ CAPA "${r.title}" is overdue`, "The due date has passed and the CAPA is not closed.", "critical", weekAgo);

  const auditDueSoon = await queryAll<Due>(
    `SELECT a.id, CONCAT(N'Audit #', a.id) AS title, CAST(a.assigned_to AS NVARCHAR(12)) AS recipients
     FROM audits a
     WHERE a.status = 'in_progress' AND a.assigned_to IS NOT NULL AND a.end_at IS NOT NULL
       AND a.end_at >= SYSUTCDATETIME() AND a.end_at <= DATEADD(day, 2, SYSUTCDATETIME())`
  );
  out.audit_due_soon = await send(auditDueSoon, "audit:due_soon", "audit", (id) => `/audits/${id}`,
    (r) => `${r.title} is due soon`, "The audit window ends within 2 days.", "warning", farPast);

  const auditOverdue = await queryAll<Due>(
    `SELECT a.id, CONCAT(N'Audit #', a.id) AS title,
            CONCAT(COALESCE(CAST(a.assigned_to AS NVARCHAR(12)), ''), ',',
                   COALESCE(CAST(a.auditor_id AS NVARCHAR(12)), '')) AS recipients
     FROM audits a
     WHERE a.status = 'in_progress' AND a.end_at IS NOT NULL AND a.end_at < SYSUTCDATETIME()`
  );
  out.audit_overdue = await send(auditOverdue, "audit:overdue", "audit", (id) => `/audits/${id}`,
    (r) => `⚠ ${r.title} is overdue`, "The audit window has ended and it hasn't been submitted.", "critical", weekAgo);

  const sopReview = await queryAll<Due>(
    `SELECT s.id, s.title, CAST(COALESCE(s.owner_id, s.created_by) AS NVARCHAR(12)) AS recipients
     FROM sops s
     WHERE s.status = 'approved' AND s.review_date IS NOT NULL
       AND s.review_date <= DATEADD(day, 30, CAST(SYSUTCDATETIME() AS DATE))`
  );
  out.sop_review_due = await send(sopReview, "sop:review_due", "sop", (id) => `/sops/${id}`,
    (r) => `SOP "${r.title}" is due for review`, "Its next review date is within 30 days (or has passed). Start a new version if it needs changes.", "info", farPast);

  return out;
}

let started = false;

/** Start the hourly reminder loop once per server process. */
export function startReminderLoop(): void {
  if (started || process.env.REMINDERS_DISABLED === "true") return;
  started = true;
  const tick = async () => {
    try {
      const sent = await runReminders();
      const total = Object.values(sent).reduce((a, n) => a + n, 0);
      if (total > 0) console.log("[reminders] sent", sent);
    } catch (err) {
      console.error("[reminders] run failed:", err);
    }
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 60 * 60_000).unref?.();
}
