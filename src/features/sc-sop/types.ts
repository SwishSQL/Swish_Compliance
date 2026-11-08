/** Supply Chain SOP review — process docket v1.0 (As-is 2026 → To-be 2027). */

export type ScProcess = {
  id: string;
  grp: string;
  name: string;
  lead: string;
  depts: string;
  steps: number;
  new: number;
  modify: number;
  keepRetire: string;
  fit: string;
  open: number;
  desc: string;
};

export type ScStep = {
  id: string;
  pa: string;
  phase: string;
  scor?: string;
  stype?: string;
  asis?: string;
  asisActor?: string;
  asisSys?: string;
  gapFlag?: string;
  gapDesc?: string;
  change: "New" | "Modify" | "Keep" | "Retire";
  tobe?: string;
  dept?: string;
  role?: string;
  sys?: string;
  input?: string;
  output?: string;
  pillars?: string;
  refs?: string;
  fit?: "Covered" | "Partial" | "Non-system" | "Not covered";
  erpReq?: string;
  ricefw?: string;
  moscow?: string;
  prev?: string;
  next?: string;
  evId?: string;
  evQuote?: string;
  taskId?: string;
  taskDesc?: string;
  solType?: string;
  openPoint?: string;
  confirmWith?: string;
};

/** Controls, policies, KPIs, reports, approval levels and docket-review items. */
export type ScRef = { t: string } & Record<string, string>;

export type ScMeta = {
  meta: { purpose: string; scope: string; approach: string };
  polsumm: [string, string][];
  phasing: [string, string][];
  openitems: string[];
  depts: string[];
  roles: Record<string, string>;
};

export type ScRegister = {
  meta: ScMeta;
  procs: ScProcess[];
  steps: ScStep[];
  refs: Record<string, ScRef>;
};

export type ScFeedback = {
  id: number;
  ref_code: string | null;
  source: "app" | "register";
  user_id: number | null;
  reviewer_name: string;
  reviewer_dept: string | null;
  reviewer_role: string | null;
  step_ref: string;
  fb_type: string;
  comment: string;
  proposed: string | null;
  evidence: string | null;
  status: "Open" | "Closed";
  response: string | null;
  response_note: string | null;
  responder_name: string | null;
  responded_at: Date | null;
  created_at: Date;
};

export const FEEDBACK_TYPES = [
  "Correction to as-is",
  "Change to to-be",
  "Role / responsibility",
  "Control / approval",
  "Time limit (SLA)",
  "ERP requirement",
  "Question / clarification",
  "Implementation input",
  "Agree — no change",
  "Other",
] as const;

export const FEEDBACK_RESPONSES = [
  "Accepted",
  "Accepted with change",
  "Not accepted",
  "Needs discussion",
  "Answered",
] as const;

export const CHANGE_TYPES = ["New", "Modify", "Keep", "Retire"] as const;

export const CHANGE_TONE: Record<string, string> = {
  New: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Modify: "bg-blue-50 text-blue-800 border-blue-200",
  Keep: "bg-gray-100 text-gray-700 border-gray-200",
  Retire: "bg-red-50 text-red-800 border-red-200",
};

export const FIT_TONE: Record<string, string> = {
  Covered: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Partial: "bg-amber-50 text-amber-800 border-amber-200",
  "Non-system": "bg-gray-100 text-gray-700 border-gray-200",
  "Not covered": "bg-red-50 text-red-800 border-red-200",
};

/** Who can respond to / close review feedback. */
export function canTriageScFeedback(role: string): boolean {
  return ["admin", "compliance", "opex", "business_excellence"].includes(role);
}

export const STEP_RX = /\bPA-\d{2}-S\d{3}\b/;
export const REF_RX = /\b(?:CTL-[A-Z0-9]+(?:-\d+)?|POL-[DR]\d+|K-[A-Z0-9]+(?:-\d+)?|RPT-[A-Z0-9]+|AM-\d+|DR-\d+)\b/g;
/** A step id ("PA-04-S230"), a whole process ("PA-04") or "General". */
export const STEP_REF_RX = /^(PA-\d{2}(-S\d{3})?|General)$/;
