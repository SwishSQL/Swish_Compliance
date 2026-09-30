export type AuditStatus =
  | "in_progress"
  | "submitted"
  | "closed"
  | "cancelled"; // assignment was cancelled by creator/admin — no execution

/**
 * An answer at or above this percentage is treated as compliant. Below it
 * the question becomes a finding: it counts as a critical failure when the
 * question is flagged critical, and a corrective action is raised for it
 * on submission (user spec 2026-08-30).
 *
 * Single source of truth — it is interpolated into the SQL that scores an
 * audit and that spawns CAPAs, so changing it here changes both.
 */
export const FINDING_THRESHOLD_PERCENT = 90;

/**
 * SQL fragments shared by every query that scores an audit response or
 * decides whether it's a finding (migration 054). An answer is recorded as
 * three sample-distribution percentages — Yes / No / N-A, summing to 100
 * — rather than one "how compliant" number, so that a question sampled
 * partly N-A doesn't drag the score down for something not applicable.
 *
 * Assumes the audit_responses row is aliased `r` in the query, which every
 * current call site does.
 *
 *   ANSWERED  — the question was answered AND at least one sample was
 *               actually applicable (not 100% N-A).
 *   PERFORMANCE — Yes as a share of the applicable (Yes + No) samples,
 *               only meaningful where ANSWERED holds.
 *   SHORTFALL — ANSWERED and below the finding threshold; this is what
 *               "is this a finding" means everywhere in the app.
 */
export const AUDIT_RESPONSE_ANSWERED_SQL =
  `r.yes_percent IS NOT NULL AND (r.yes_percent + r.no_percent) > 0`;
export const AUDIT_RESPONSE_PERFORMANCE_SQL =
  `(r.yes_percent * 100.0 / (r.yes_percent + r.no_percent))`;
export const AUDIT_RESPONSE_SHORTFALL_SQL =
  `${AUDIT_RESPONSE_ANSWERED_SQL} AND ${AUDIT_RESPONSE_PERFORMANCE_SQL} < ${FINDING_THRESHOLD_PERCENT}`;

export type Audit = {
  id: number;
  // template_id is nullable since migration 038 — new audits scope by
  // tests, not a single template. template_name/category are NULL for
  // those audits.
  template_id: number | null;
  template_name: string | null;
  template_category: string | null;
  brand_id: number | null;
  brand_name: string | null;
  department_id: number | null;
  department_name: string | null;
  location: string | null;
  auditor_id: number | null;
  auditor_name: string | null;
  audit_date: string;
  status: AuditStatus;
  score: string | null;          // numeric returned as string by pg
  max_score: number | null;
  critical_failed: number;
  summary: string | null;
  submitted_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  // Policy & Framework the audit is performed against (migration 019)
  policy_id: number | null;
  policy_title: string | null;
  policy_code: string | null;
  /** Every SOP this audit covers (migration 055). Empty only for audits
   *  predating the junction with no policy_id at all. */
  policy_ids: number[];
  policy_titles: string[];
  framework_id: number | null;
  framework_name: string | null;
  framework_code: string | null;
  // Scope chain (migration 028) + window/assignee (029)
  domain_id: number | null;
  domain_name: string | null;
  domain_code: string | null;
  control_id: number | null;
  control_name: string | null;
  control_code: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  start_at: string | null;
  end_at: string | null;
  /** SOP-first scoping + the wider cast (migration 042). */
  scope_type: string | null;
  objective: string | null;
  notes: string | null;
  auditee_id: number | null;
  auditee_custom_name: string | null;
  /** COALESCE(auditee_custom_name, <linked user's display name>). */
  auditee_name: string | null;
  reviewer_id: number | null;
  reviewer_name: string | null;
  /** Count of audit_tests rows (migration 028) — how many tests were
   *  pinned at creation. 0 for legacy audits driven by template_id. */
  test_count: number;
};

/**
 * One row per (test, item) pair for an audit. The same item can appear
 * under multiple tests when it's linked to several of them via the
 * check_checklist_items junction — that's intentional, the auditor
 * sees the question in the context of each test.
 */
export type AuditScopeRow = {
  test_id: number;
  test_code: string | null;
  test_name: string;
  template_id: number;
  template_code: string | null;
  template_name: string;
  item_id: number;
  item_code: string | null;
  item_sort_order: number;
  question: string;
  weight: number;
  is_critical: boolean;
  // Latest response on this item for this audit (shared across all
  // instances of the same item under different tests).
  response: "pass" | "fail" | "na" | null;
  /** How the sampled interactions actually broke down (migration 054).
   *  Sum to 100 together when set; all three null when unanswered. */
  yes_percent: number | null;
  no_percent: number | null;
  na_percent: number | null;
  notes: string | null;
  evidence_url: string | null;
  evidence_name: string | null;
  evidence_mime: string | null;
};

export type AuditResponse = {
  id: number;
  audit_id: number;
  item_id: number;
  response: "pass" | "fail" | "na" | null;
  /** How the sampled interactions actually broke down (migration 054).
   *  Sum to 100 together when set; all three null when unanswered. */
  yes_percent: number | null;
  no_percent: number | null;
  na_percent: number | null;
  notes: string | null;
  evidence_url: string | null;
  evidence_name: string | null;
  evidence_mime: string | null;
};

/** One file attached at the audit level (migration 039). */
export type AuditAttachment = {
  id: number;
  audit_id: number;
  file_url: string;
  file_name: string;
  file_mime: string | null;
  file_size: number | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
};

export const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
  in_progress: "In progress",
  submitted: "Submitted",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const AUDIT_STATUS_TONE: Record<AuditStatus, string> = {
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  submitted: "bg-indigo-50 text-indigo-700 border-indigo-200",
  closed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-gray-100 text-gray-600 border-gray-300",
};
