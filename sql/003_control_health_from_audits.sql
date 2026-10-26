/*
 * Control health now also listens to audit findings and their CAPAs.
 *
 * Until now controls.health_status only moved when someone recorded a test
 * result, so a control that failed an audit (and had open CAPAs for it) kept
 * showing "unknown" and the Reports page read 0% healthy / 0 failing.
 *
 * From here on the app recomputes it after an audit is submitted/reopened/
 * cancelled, a CAPA is verified/closed/reopened, or something is deleted
 * (src/features/controls/repository.ts, recomputeHealth). This one-off pass
 * applies the same rules to the audits that already happened.
 *
 *   failing : a test is failing, OR a critical linked CAPA is open, OR an
 *             audit finding on the control still has an unresolved CAPA
 *   at_risk : a test awaits review, OR a linked CAPA is open
 *   healthy : all tests pass, OR the control was audited (>= 1 answered
 *             question in a submitted/closed audit) and every finding's CAPA
 *             is verified/closed
 *   unknown : nothing has measured it yet
 *
 * A finding reaches its control through the test it was asked under
 * (audit_tests -> check_checklist_items -> checks.control_id).
 */
WITH audit_findings AS (
  SELECT DISTINCT ch.control_id, a.id AS audit_id, r.item_id,
         CASE WHEN r.yes_percent IS NOT NULL AND (r.yes_percent + r.no_percent) > 0
                   AND (CAST(r.yes_percent * 100 AS DECIMAL(5,0))
                        / CAST(NULLIF(r.yes_percent + r.no_percent, 0) AS DECIMAL(18,0))) < 90
              THEN 1 ELSE 0 END AS is_finding,
         CASE WHEN ca.id IS NULL OR ca.status NOT IN ('verified','closed')
              THEN 1 ELSE 0 END AS unresolved
  FROM audit_responses r
  JOIN audits a ON a.id = r.audit_id AND a.status IN ('submitted','closed')
  JOIN audit_tests at ON at.audit_id = a.id
  JOIN check_checklist_items cci
    ON cci.check_id = at.check_id AND cci.checklist_item_id = r.item_id
  JOIN checks ch ON ch.id = at.check_id AND ch.control_id IS NOT NULL
  LEFT JOIN corrective_actions ca
    ON ca.source_audit_id = a.id AND ca.source_item_id = r.item_id
  WHERE r.yes_percent IS NOT NULL AND (r.yes_percent + r.no_percent) > 0
),
audit_agg AS (
  SELECT control_id,
         COUNT(*) AS answered,
         SUM(CASE WHEN is_finding = 1 AND unresolved = 1 THEN 1 ELSE 0 END) AS open_findings
  FROM audit_findings
  GROUP BY control_id
),
calc AS (
  SELECT c.id,
    CASE
      WHEN COALESCE(chk.failing, 0) > 0
        OR COALESCE(lc.critical_open, 0) > 0
        OR COALESCE(aa.open_findings, 0) > 0                    THEN 'failing'
      WHEN COALESCE(chk.pending, 0) > 0
        OR COALESCE(lc.open_capas, 0) > 0                       THEN 'at_risk'
      WHEN (COALESCE(chk.total, 0) > 0 AND chk.passing = chk.total)
        OR COALESCE(aa.answered, 0) > 0                         THEN 'healthy'
      ELSE 'unknown'
    END AS next_status
  FROM controls c
  LEFT JOIN (
    SELECT control_id,
           COUNT(*)                                                         AS total,
           SUM(CASE WHEN last_status = 'failing'        THEN 1 ELSE 0 END)  AS failing,
           SUM(CASE WHEN last_status = 'passing'        THEN 1 ELSE 0 END)  AS passing,
           SUM(CASE WHEN last_status = 'pending_review' THEN 1 ELSE 0 END)  AS pending
    FROM checks WHERE is_active = 1 GROUP BY control_id
  ) chk ON chk.control_id = c.id
  LEFT JOIN (
    SELECT cl.control_id,
           COUNT(*)                                                      AS open_capas,
           SUM(CASE WHEN ca.severity = 'critical' THEN 1 ELSE 0 END)     AS critical_open
    FROM control_links cl
    JOIN corrective_actions ca ON cl.entity_type = 'capa' AND cl.entity_id = ca.id
    WHERE ca.status IN ('open','in_progress','submitted')
    GROUP BY cl.control_id
  ) lc ON lc.control_id = c.id
  LEFT JOIN audit_agg aa ON aa.control_id = c.id
)
UPDATE c
   SET health_status = calc.next_status, health_updated_at = SYSUTCDATETIME()
  FROM controls c
  JOIN calc ON calc.id = c.id
 WHERE c.health_status <> calc.next_status;
