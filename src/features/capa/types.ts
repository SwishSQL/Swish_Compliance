export type CapaStatus =
  | "open"
  | "in_progress"
  | "submitted"
  | "verified"
  | "closed"
  | "rejected";

export type CapaSeverity = "low" | "medium" | "high" | "critical";

export type Capa = {
  id: number;
  code: string | null;
  title: string;
  description: string | null;
  severity: CapaSeverity;
  status: CapaStatus;
  source_audit_id: number | null;
  source_item_id: number | null;
  brand_id: number | null;
  brand_name: string | null;
  department_id: number | null;
  department_name: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  verified_by: number | null;
  verified_by_name: string | null;
  due_date: string | null;
  resolution_note: string | null;
  evidence_url: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  // Migration 040 — the "planned" review + assignment metadata.
  start_date: string | null;
  reviewer_id: number | null;
  reviewer_name: string | null;
  assignment_note: string | null;
  // Migration 041 — execution fields written by the OWNER while
  // working the CAPA + rejection reason set by the reviewer.
  root_cause: string | null;
  corrective_action_taken: string | null;
  preventive_action_taken: string | null;
  completion_note: string | null;
  rejection_reason: string | null;
};

/** One CAPA-side evidence file (migration 041). */
export type CapaEvidence = {
  id: number;
  capa_id: number;
  file_url: string;
  file_name: string;
  file_mime: string | null;
  file_size: number | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
};

/**
 * The auditor-side context for a CAPA: the audit + control + test +
 * question + auditor's fail note + auditor's evidence. Read-only for
 * the CAPA owner; shown alongside the execution fields so they know
 * WHAT they're fixing.
 */
export type CapaAuditorContext = {
  audit_id: number;
  audit_date: string;
  brand_name: string | null;
  department_name: string | null;
  location: string | null;
  framework_code: string | null;
  framework_name: string | null;
  control_code: string | null;
  control_name: string | null;
  test_code: string | null;
  test_name: string | null;
  question: string;
  auditor_response: string | null;
  yes_percent: number | null;
  no_percent: number | null;
  na_percent: number | null;
  /** Yes's share of the applicable samples, 0-100. Null when there's no
   *  linked response, or the question was 100% N-A (migration 054). */
  performance_percent: number | null;
  auditor_note: string | null;
  auditor_evidence_url: string | null;
  auditor_evidence_name: string | null;
  auditor_evidence_mime: string | null;
};

/**
 * One failed audit finding — a row in audit_responses with
 * response = 'fail', joined back to its full lineage plus the CAPA
 * currently linked to it (if any). Powers the hierarchical /capa page.
 */
export type AuditFinding = {
  audit_id: number;
  audit_status: string;
  audit_score: string | null;
  audit_date: string;
  audit_brand_name: string | null;
  audit_department_id: number | null;
  audit_department_name: string | null;
  audit_location: string | null;
  framework_code: string | null;
  framework_name: string | null;
  control_id: number | null;
  control_code: string | null;
  control_name: string | null;
  // The test that surfaced this item. Null when the item comes from a
  // legacy template-only audit with no linked tests.
  test_id: number | null;
  test_code: string | null;
  test_name: string | null;
  item_id: number;
  item_code: string | null;
  question: string;
  is_critical: boolean;
  /** How the sampled interactions broke down (migration 054). Sum to 100. */
  yes_percent: number;
  no_percent: number;
  na_percent: number;
  /** Yes's share of the applicable (Yes+No) samples — below-threshold is
   *  why this finding exists at all. Always defined here: a finding is by
   *  definition an applicable, answered question. */
  performance_percent: number;
  auditor_note: string | null;
  evidence_url: string | null;
  evidence_name: string | null;
  evidence_mime: string | null;
  // CAPA (may not exist yet — findings without a CAPA get an
  // "Assign CAPA" button that CREATES one on submit).
  capa_id: number | null;
  capa_code: string | null;
  capa_status: CapaStatus | null;
  capa_severity: CapaSeverity | null;
  capa_assigned_to: number | null;
  capa_assigned_to_name: string | null;
  capa_due_date: string | null;
};

export const CAPA_STATUS_LABEL: Record<CapaStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  submitted: "Submitted",
  verified: "Verified",
  closed: "Closed",
  rejected: "Rejected",
};

export const CAPA_STATUS_TONE: Record<CapaStatus, string> = {
  open: "bg-gray-100 text-gray-700 border-gray-200",
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  submitted: "bg-indigo-50 text-indigo-700 border-indigo-200",
  verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-emerald-50 text-emerald-800 border-emerald-300",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

/** Tone for findings that have no CAPA/assignee yet — shared by the CAPA
 *  and Roadmap pages so the pill stays identical everywhere. */
export const CAPA_UNASSIGNED_TONE = "bg-gray-100 text-gray-600 border-gray-200";
export const CAPA_UNASSIGNED_LABEL = "Not Assigned";

export const SEVERITY_LABEL: Record<CapaSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const SEVERITY_TONE: Record<CapaSeverity, string> = {
  low: "bg-gray-50 text-gray-600 border-gray-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-red-50 text-red-700 border-red-200",
};
