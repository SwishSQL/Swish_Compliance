import "server-only";
import { queryAll, queryOne, execute } from "@/lib/db";
import {
  AUDIT_RESPONSE_ANSWERED_SQL,
  AUDIT_RESPONSE_PERFORMANCE_SQL,
  AUDIT_RESPONSE_SHORTFALL_SQL,
} from "./types";
import type {
  Audit,
  AuditAttachment,
  AuditResponse,
  AuditScopeRow,
  AuditStatus,
} from "./types";
import type { ChecklistItem } from "../checklists/types";

const AUDIT_SELECT = `
  a.id, a.template_id, t.name AS template_name, t.category AS template_category,
  a.brand_id, b.name AS brand_name,
  a.department_id, d.name AS department_name,
  a.location, a.auditor_id, u.display_name AS auditor_name,
  a.audit_date, a.status, a.score, a.max_score, a.critical_failed, a.summary,
  a.submitted_at, a.closed_at, a.created_at, a.updated_at,
  a.policy_id, p.title AS policy_title, p.code AS policy_code,
  -- Every SOP this audit covers (migration 055). policy_id above is still
  -- the first of these, kept for the joins that predate the junction.
  COALESCE(
    (SELECT array_agg(asop.sop_id ORDER BY sp.title)
       FROM audit_sops asop JOIN sops sp ON sp.id = asop.sop_id
       WHERE asop.audit_id = a.id),
    ARRAY[]::int[]
  ) AS policy_ids,
  COALESCE(
    (SELECT array_agg(sp.title ORDER BY sp.title)
       FROM audit_sops asop JOIN sops sp ON sp.id = asop.sop_id
       WHERE asop.audit_id = a.id),
    ARRAY[]::text[]
  ) AS policy_titles,
  a.framework_id, f.name AS framework_name, f.code AS framework_code,
  -- Scope chain (migration 028) + window/assignee (029)
  a.domain_id,  dom.name  AS domain_name,  dom.code  AS domain_code,
  a.control_id, ctrl.name AS control_name, ctrl.code AS control_code,
  a.assigned_to, u_at.display_name AS assigned_to_name,
  a.start_at, a.end_at,
  -- SOP-first scoping + wider cast (migration 042)
  a.scope_type, a.objective, a.notes,
  a.auditee_id,  a.auditee_custom_name,
  COALESCE(a.auditee_custom_name, u_ae.display_name) AS auditee_name,
  a.reviewer_id, u_rv.display_name AS reviewer_name,
  -- How many tests are pinned to this audit (audit_tests rows).
  -- Used by the list page so we can render the scope summary without
  -- a per-row follow-up query.
  (SELECT COUNT(*)::int FROM audit_tests at WHERE at.audit_id = a.id) AS test_count
FROM audits a
-- LEFT JOIN templates: template_id is nullable since migration 038. The
-- previous INNER JOIN would have hidden every audit created from the
-- new tests-first flow.
LEFT JOIN checklist_templates t   ON t.id   = a.template_id
LEFT JOIN brands       b   ON b.id   = a.brand_id
LEFT JOIN departments  d   ON d.id   = a.department_id
LEFT JOIN users        u   ON u.id   = a.auditor_id
LEFT JOIN sops         p   ON p.id   = a.policy_id
LEFT JOIN frameworks   f   ON f.id   = a.framework_id
LEFT JOIN domains      dom ON dom.id = a.domain_id
LEFT JOIN controls    ctrl ON ctrl.id = a.control_id
LEFT JOIN users      u_at  ON u_at.id = a.assigned_to
LEFT JOIN users      u_ae  ON u_ae.id = a.auditee_id
LEFT JOIN users      u_rv  ON u_rv.id = a.reviewer_id
`;

export async function listAudits(filters: {
  search?: string;
  status?: AuditStatus;
  brandId?: number;
  /** When set, restricts to audits where the user is creator or assignee.
   *  Admins should leave this off to see everything. */
  scopedToUserId?: number;
} = {}): Promise<Audit[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.scopedToUserId) {
    params.push(filters.scopedToUserId);
    conditions.push(
      `(a.auditor_id = $${params.length} OR a.assigned_to = $${params.length})`
    );
  }
  if (filters.search) {
    // template name is NULL for the new tests-first flow, so also match
    // against control/framework/domain names so the search still finds
    // recent audits by their scope.
    params.push(`%${filters.search}%`);
    const i = params.length;
    conditions.push(
      `(t.name ILIKE $${i} OR a.location ILIKE $${i}
        OR ctrl.name ILIKE $${i} OR f.name ILIKE $${i} OR dom.name ILIKE $${i})`
    );
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`a.status = $${params.length}`);
  } else {
    // Cancelled audits don't belong in the default register — they
    // litter "audits in progress" counts and search results. Surface
    // only when the user explicitly filters by status=cancelled.
    conditions.push(`a.status <> 'cancelled'`);
  }
  if (filters.brandId) {
    params.push(filters.brandId);
    conditions.push(`a.brand_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return queryAll<Audit>(
    `SELECT ${AUDIT_SELECT} ${where} ORDER BY a.audit_date DESC, a.id DESC LIMIT 100`,
    params
  );
}

export async function getAudit(id: number): Promise<Audit | undefined> {
  return queryOne<Audit>(`SELECT ${AUDIT_SELECT} WHERE a.id = $1`, [id]);
}

/** Audit-level attachments — many files per audit (migration 039). */
export async function listAuditAttachments(
  auditId: number
): Promise<AuditAttachment[]> {
  return queryAll<AuditAttachment>(
    `SELECT
       att.id, att.audit_id, att.file_url, att.file_name, att.file_mime,
       att.file_size, att.uploaded_by, u.display_name AS uploaded_by_name,
       att.uploaded_at
     FROM audit_attachments att
     LEFT JOIN users u ON u.id = att.uploaded_by
     WHERE att.audit_id = $1
     ORDER BY att.uploaded_at DESC, att.id DESC`,
    [auditId]
  );
}

export async function addAuditAttachment(input: {
  audit_id: number;
  file_url: string;
  file_name: string;
  file_mime: string | null;
  file_size: number | null;
  uploaded_by: number;
}): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO audit_attachments
       (audit_id, file_url, file_name, file_mime, file_size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.audit_id,
      input.file_url,
      input.file_name,
      input.file_mime,
      input.file_size,
      input.uploaded_by,
    ]
  );
  return row!.id;
}

export async function deleteAuditAttachment(
  attachmentId: number
): Promise<number | null> {
  // Returns the parent audit_id so the action can revalidate the right
  // page without an extra round-trip.
  const row = await queryOne<{ audit_id: number }>(
    `DELETE FROM audit_attachments WHERE id = $1 RETURNING audit_id`,
    [attachmentId]
  );
  return row?.audit_id ?? null;
}

/**
 * Items for the audit grouped by Test → Template. Same item appears
 * once per test it's linked to — the auditor sees the question in the
 * context of every test that needs it, not just once.
 *
 * Ordered by test (so the page can group them in order they were
 * picked), then template name, then sort_order within the template.
 *
 * The latest response per item is LEFT JOINed; since the
 * audit_responses UNIQUE constraint is (audit_id, item_id), the same
 * response repeats across every instance of the item — answering it
 * under Test A updates the read-back under Test B.
 */
export async function listAuditScopeItems(
  auditId: number
): Promise<AuditScopeRow[]> {
  return queryAll<AuditScopeRow>(
    `SELECT
       ch.id    AS test_id,    ch.code AS test_code, ch.name AS test_name,
       t.id     AS template_id, t.code AS template_code, t.name AS template_name,
       i.id     AS item_id,    i.code AS item_code, i.sort_order AS item_sort_order,
       i.question, i.weight, i.is_critical,
       r.response, r.yes_percent, r.no_percent, r.na_percent,
       r.notes, r.evidence_url, r.evidence_name, r.evidence_mime
     FROM audit_tests at
     JOIN checks                ch  ON ch.id = at.check_id
     JOIN check_checklist_items cci ON cci.check_id = at.check_id
     JOIN checklist_items       i   ON i.id  = cci.checklist_item_id
     JOIN checklist_templates   t   ON t.id  = i.template_id
     LEFT JOIN audit_responses  r   ON r.audit_id = at.audit_id AND r.item_id = i.id
     WHERE at.audit_id = $1
     ORDER BY ch.code NULLS LAST, ch.id, t.name, i.sort_order, i.id`,
    [auditId]
  );
}

export async function getAuditItems(
  auditId: number
): Promise<(ChecklistItem & AuditResponse)[]> {
  // The auditable items come from TWO places, unioned:
  //   1. Legacy: every item under the audit's checklist_template_id.
  //      Some older audits were created with a single template attached.
  //   2. New (migration 038): items linked to any test in audit_tests,
  //      via the check_checklist_items junction. This is the path the
  //      new /audits/new flow uses since it no longer asks for a
  //      template up-front.
  // An audit may carry both. UNION dedupes so an item that satisfies
  // both paths shows up exactly once.
  return queryAll(
    `SELECT
       i.id, i.template_id, i.sort_order, i.question, i.guidance, i.weight, i.is_critical,
       COALESCE(r.id, 0)         AS id,
       $1::int                   AS audit_id,
       i.id                      AS item_id,
       r.response, r.yes_percent, r.no_percent, r.na_percent,
       r.notes, r.evidence_url, r.evidence_name, r.evidence_mime
     FROM checklist_items i
     LEFT JOIN audit_responses r ON r.item_id = i.id AND r.audit_id = $1
     WHERE i.id IN (
       SELECT ci.id FROM checklist_items ci
       WHERE ci.template_id = (SELECT template_id FROM audits WHERE id = $1)
       UNION
       SELECT cci.checklist_item_id
       FROM audit_tests at
       JOIN check_checklist_items cci ON cci.check_id = at.check_id
       WHERE at.audit_id = $1
     )
     ORDER BY i.template_id NULLS LAST, i.sort_order ASC, i.id ASC`,
    [auditId]
  );
}

export async function createAudit(input: {
  /** Optional since migration 038 — audits now scope by tests, not a
   *  single template. Kept around so legacy audits keep working. */
  template_id?: number | null;
  brand_id?: number | null;
  department_id?: number | null;
  location?: string | null;
  auditor_id: number;
  audit_date?: string | null;
  policy_id?: number | null;
  framework_id?: number | null;
  /** Audit scope — domain → framework → control. Added in migration 028. */
  domain_id?: number | null;
  control_id?: number | null;
  /** Planned execution window + assignee. Added in migration 029. */
  start_at?: string | null;
  end_at?: string | null;
  assigned_to?: number | null;
  /** SOP-first scoping + the wider cast. Added in migration 042. */
  scope_type?: string | null;
  auditee_id?: number | null;
  /** Free-text override — takes priority over auditee_id when set. */
  auditee_custom_name?: string | null;
  reviewer_id?: number | null;
  objective?: string | null;
  notes?: string | null;
}): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO audits
       (template_id, brand_id, department_id, location, auditor_id, audit_date,
        policy_id, framework_id, domain_id, control_id,
        start_at, end_at, assigned_to,
        scope_type, auditee_id, reviewer_id, objective, notes, auditee_custom_name)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7, $8, $9, $10, $11, $12, $13,
             $14, $15, $16, $17, $18, $19)
     RETURNING id`,
    [
      input.template_id ?? null,
      input.brand_id ?? null,
      input.department_id ?? null,
      input.location ?? null,
      input.auditor_id,
      input.audit_date ?? null,
      input.policy_id ?? null,
      input.framework_id ?? null,
      input.domain_id ?? null,
      input.control_id ?? null,
      input.start_at ?? null,
      input.end_at ?? null,
      input.assigned_to ?? null,
      input.scope_type ?? null,
      input.auditee_id ?? null,
      input.reviewer_id ?? null,
      input.objective ?? null,
      input.notes ?? null,
      input.auditee_custom_name ?? null,
    ]
  );
  return row!.id;
}

/** Record every SOP an audit covers (migration 055) — policy_id on the
 *  audits row itself is just the first of these, for backward-compat. */
export async function insertAuditSops(auditId: number, sopIds: number[]): Promise<void> {
  if (sopIds.length === 0) return;
  const placeholders = sopIds.map((_, i) => `($1, $${i + 2})`).join(", ");
  await execute(
    `INSERT INTO audit_sops (audit_id, sop_id) VALUES ${placeholders}
     ON CONFLICT DO NOTHING`,
    [auditId, ...sopIds]
  );
}

/**
 * Upsert a response.
 *
 * The evidence columns are write-PROTECTED by default:
 *   - When `update_evidence` is false (or omitted), the SQL keeps the old
 *     evidence_url / evidence_name / evidence_mime even if the caller passes
 *     nulls. This is what lets the auto-save flow re-fire on every Pass /
 *     Fail / notes-blur without wiping the file the user already attached.
 *   - When `update_evidence` is true, the caller is explicitly replacing the
 *     evidence with whatever values are passed (including null = remove).
 */
export async function upsertResponse(input: {
  audit_id: number;
  item_id: number;
  response: "pass" | "fail" | "na" | null;
  /** How the sampled interactions broke down (migration 054). Must be
   *  given together — either all three, summing to 100, or none (in
   *  which case a clean 100/0/0 in the picked direction is assumed). */
  yes_percent?: number | null;
  no_percent?: number | null;
  na_percent?: number | null;
  notes?: string | null;
  evidence_url?: string | null;
  evidence_name?: string | null;
  evidence_mime?: string | null;
  update_evidence?: boolean;
}): Promise<void> {
  const updateEv = !!input.update_evidence;

  let yesPct: number | null = null;
  let noPct: number | null = null;
  let naPct: number | null = null;
  if (input.response) {
    yesPct = input.yes_percent ?? (input.response === "pass" ? 100 : 0);
    noPct = input.no_percent ?? (input.response === "fail" ? 100 : 0);
    naPct = input.na_percent ?? (input.response === "na" ? 100 : 0);
    if (yesPct + noPct + naPct !== 100) {
      throw new Error(
        `Yes/No/N-A percentages must add up to 100 (got ${yesPct + noPct + naPct}).`
      );
    }
  }

  await execute(
    `INSERT INTO audit_responses
       (audit_id, item_id, response, yes_percent, no_percent, na_percent,
        notes, evidence_url, evidence_name, evidence_mime)
     VALUES ($1, $2, $3, $9, $10, $11, $4, $5, $6, $7)
     ON CONFLICT (audit_id, item_id) DO UPDATE SET
       response      = EXCLUDED.response,
       yes_percent   = EXCLUDED.yes_percent,
       no_percent    = EXCLUDED.no_percent,
       na_percent    = EXCLUDED.na_percent,
       notes         = EXCLUDED.notes,
       evidence_url  = CASE WHEN $8 THEN EXCLUDED.evidence_url  ELSE audit_responses.evidence_url  END,
       evidence_name = CASE WHEN $8 THEN EXCLUDED.evidence_name ELSE audit_responses.evidence_name END,
       evidence_mime = CASE WHEN $8 THEN EXCLUDED.evidence_mime ELSE audit_responses.evidence_mime END`,
    [
      input.audit_id,
      input.item_id,
      input.response,
      input.notes ?? null,
      input.evidence_url ?? null,
      input.evidence_name ?? null,
      input.evidence_mime ?? null,
      updateEv,
      yesPct,
      noPct,
      naPct,
    ]
  );
}

/** Compute score (% of weighted passes excluding N/A) and critical fails. */
export async function computeAuditScore(auditId: number): Promise<{
  scorePct: number;
  maxScore: number;
  criticalFailed: number;
}> {
  const row = await queryOne<{
    total_weight: number;
    earned_weight: number;
    critical_failed: number;
  }>(
    // Same union as listItemsWithResponses — score over the full set of
    // items the audit covers (legacy template + new test links), not just
    // the template. Otherwise audits created from the new tests-first
    // flow would always score 0.
    // Graded answers (migration 054): a question earns its weight in
    // proportion to Yes's share of the APPLICABLE (Yes+No) samples — a
    // question sampled partly N-A isn't penalized for the N-A share.
    // A 100%-N-A question contributes to neither total nor earned weight,
    // same as the old plain "na" response did.
    `SELECT
       COALESCE(SUM(CASE WHEN ${AUDIT_RESPONSE_ANSWERED_SQL} THEN i.weight ELSE 0 END), 0)::int AS total_weight,
       COALESCE(SUM(
         CASE WHEN ${AUDIT_RESPONSE_ANSWERED_SQL}
              THEN i.weight * ${AUDIT_RESPONSE_PERFORMANCE_SQL} / 100.0
              ELSE 0 END
       ), 0)::float AS earned_weight,
       COALESCE(SUM(
         CASE WHEN i.is_critical AND ${AUDIT_RESPONSE_SHORTFALL_SQL}
              THEN 1 ELSE 0 END
       ), 0)::int AS critical_failed
     FROM checklist_items i
     LEFT JOIN audit_responses r ON r.item_id = i.id AND r.audit_id = $1
     WHERE i.id IN (
       SELECT ci.id FROM checklist_items ci
       WHERE ci.template_id = (SELECT template_id FROM audits WHERE id = $1)
       UNION
       SELECT cci.checklist_item_id
       FROM audit_tests at
       JOIN check_checklist_items cci ON cci.check_id = at.check_id
       WHERE at.audit_id = $1
     )`,
    [auditId]
  );
  const total = row?.total_weight ?? 0;
  const earned = row?.earned_weight ?? 0;
  const scorePct = total > 0 ? Math.round((earned / total) * 100 * 100) / 100 : 0;
  return {
    scorePct,
    maxScore: total,
    criticalFailed: row?.critical_failed ?? 0,
  };
}

export async function submitAudit(
  id: number,
  summary: string | null
): Promise<{ scorePct: number; criticalFailed: number; failedItemIds: number[] }> {
  const { scorePct, maxScore, criticalFailed } = await computeAuditScore(id);

  await execute(
    `UPDATE audits SET
       status       = 'submitted',
       score        = $2,
       max_score    = $3,
       critical_failed = $4,
       summary      = $5,
       submitted_at = NOW()
     WHERE id = $1`,
    [id, scorePct, maxScore, criticalFailed, summary]
  );

  // Return the failed item IDs so the caller can spawn CAPAs. A finding is
  // any applicable answer that fell short of the threshold (migration 054)
  // — not just an outright "No", and not one that was entirely N-A.
  const failed = await queryAll<{ item_id: number }>(
    `SELECT item_id FROM audit_responses r WHERE audit_id = $1 AND ${AUDIT_RESPONSE_SHORTFALL_SQL}`,
    [id]
  );
  return {
    scorePct,
    criticalFailed,
    failedItemIds: failed.map((r) => r.item_id),
  };
}

export async function closeAudit(id: number): Promise<void> {
  await execute(
    `UPDATE audits SET status = 'closed', closed_at = NOW() WHERE id = $1`,
    [id]
  );
}

/**
 * Mark an audit as cancelled — used when the assignment is called off
 * before any work happens (no responses, no score). Filtered out of
 * default audit lists; My Work hides them via the same status filter.
 */
export async function cancelAudit(id: number): Promise<void> {
  await execute(
    `UPDATE audits SET status = 'cancelled' WHERE id = $1`,
    [id]
  );
}

/**
 * Reopen a submitted audit back to 'in_progress' so the auditor can edit
 * responses. Clears the computed score / submitted_at fields — they'll be
 * recomputed the next time the audit is submitted. Responses themselves are
 * preserved untouched.
 */
export async function reopenAudit(id: number): Promise<void> {
  await execute(
    `UPDATE audits SET
       status          = 'in_progress',
       score           = NULL,
       max_score       = NULL,
       critical_failed = 0,
       submitted_at    = NULL
     WHERE id = $1 AND status = 'submitted'`,
    [id]
  );
}
