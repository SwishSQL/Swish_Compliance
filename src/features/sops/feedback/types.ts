import { SOP_SECTIONS } from "../types";

/** Review feedback on an SOP, recorded against one template section. */
export type SopFeedback = {
  id: number;
  sop_id: number;
  sop_title: string;
  sop_code: string | null;
  section_key: string;
  user_id: number | null;
  reviewer_name: string;
  reviewer_dept: string | null;
  reviewer_role: string | null;
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
  "Correction",
  "Proposed change",
  "Role / responsibility",
  "Control / approval",
  "Time limit (SLA)",
  "System / tool",
  "Question / clarification",
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

/** Feedback can target one template section or the SOP as a whole. */
export const FEEDBACK_SECTIONS: { key: string; label: string; num: string }[] = [
  { key: "general", label: "Whole SOP", num: "—" },
  ...SOP_SECTIONS.map((s) => ({ key: s.key, label: s.label, num: s.num })),
];

export const sectionLabel = (key: string) =>
  FEEDBACK_SECTIONS.find((s) => s.key === key)?.label ?? key;

/** Who can respond to / close review feedback. */
export function canTriageSopFeedback(role: string): boolean {
  return ["admin", "compliance", "opex", "business_excellence"].includes(role);
}
