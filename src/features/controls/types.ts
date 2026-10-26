export type ControlHealth = "healthy" | "at_risk" | "failing" | "unknown";

export type Control = {
  id: number;
  code: string | null;
  name: string;
  description: string | null;
  framework_id: number | null;
  framework_name: string | null;
  framework_code: string | null;
  category: string | null;
  owner_user_id: number | null;
  owner_name: string | null;
  is_active: boolean;
  health_status: ControlHealth;
  health_updated_at: string | null;
  created_at: string;
  updated_at: string;
  linked_sops: number;
  linked_checks: number;
  open_capas: number;
  // GRC extended fields (migration 018)
  requirement: string | null;
  clause_reference: string | null;
  evidence_required: string | null;
  /** What the reviewer should ask the department for (migration 050). */
  reviewer_prompt: string | null;
  risk_weight: number | null;
  control_type: string | null;
  frequency: string | null;
};

export const HEALTH_LABEL: Record<ControlHealth, string> = {
  healthy: "Healthy",
  at_risk: "At risk",
  failing: "Failing",
  unknown: "Not measured",
};

export const HEALTH_TONE: Record<ControlHealth, string> = {
  healthy: "bg-emerald-50 text-emerald-700 border-emerald-200",
  at_risk: "bg-amber-50 text-amber-700 border-amber-200",
  failing: "bg-red-50 text-red-700 border-red-200",
  unknown: "bg-gray-50 text-gray-500 border-gray-200",
};

export const HEALTH_DOT: Record<ControlHealth, string> = {
  healthy: "bg-emerald-500",
  at_risk: "bg-amber-500",
  failing: "bg-red-500",
  unknown: "bg-gray-400",
};

/**
 * A control's answer rates from its audit answers. Every answered question
 * splits 100% into Yes / No / N-A (migration 054), so across a control's
 * questions: Success = average Yes, Failure = average No, N/A = average N/A
 * (the three add up to 100). The score leaves N/A out of the denominator —
 * Success ÷ (Success + Failure) — so N/A never counts against the control.
 */
export type ControlRates = {
  questions: number;
  sum_yes: number;
  sum_no: number;
  sum_na: number;
  success: number;
  failure: number;
  na: number;
  /** null when nothing applicable was answered (all N/A). */
  score: number | null;
};

export function ratesFromSums(
  questions: number,
  sumYes: number,
  sumNo: number,
  sumNa: number
): ControlRates {
  if (!questions) {
    return { questions: 0, sum_yes: 0, sum_no: 0, sum_na: 0, success: 0, failure: 0, na: 0, score: null };
  }
  const applicable = sumYes + sumNo;
  return {
    questions,
    sum_yes: sumYes,
    sum_no: sumNo,
    sum_na: sumNa,
    success: sumYes / questions,
    failure: sumNo / questions,
    na: sumNa / questions,
    score: applicable > 0 ? (sumYes / applicable) * 100 : null,
  };
}

/** The "Overall" rates: every control's answers pooled together. */
export function combineRates(list: Iterable<ControlRates>): ControlRates {
  let q = 0, y = 0, n = 0, a = 0;
  for (const r of list) {
    q += r.questions;
    y += r.sum_yes;
    n += r.sum_no;
    a += r.sum_na;
  }
  return ratesFromSums(q, y, n, a);
}
