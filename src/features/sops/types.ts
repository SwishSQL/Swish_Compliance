export type SopStatus =
  | "draft"
  | "pending_compliance"
  | "returned_to_dm"
  | "pending_business_excellence"
  | "returned_to_compliance"
  | "pending_ceo"
  | "returned_to_be"
  | "approved"
  | "archived";

export const SOP_STATUSES: SopStatus[] = [
  "draft",
  "pending_compliance",
  "returned_to_dm",
  "pending_business_excellence",
  "returned_to_compliance",
  "pending_ceo",
  "returned_to_be",
  "approved",
  "archived",
];

export type Sop = {
  id: number;
  code: string | null;
  title: string;
  description: string | null;
  version: string;
  status: SopStatus;
  file_url: string | null;
  attachment_data_url: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  brand_id: number | null;
  brand_name: string | null;
  department_id: number | null;
  department_name: string | null;
  owner_id: number | null;
  owner_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  approved_by: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  effective_date: string | null;
  review_date: string | null;
  created_at: string;
  updated_at: string;
  // Scope flags (migration 020)
  brand_is_function: boolean;
  is_all_departments: boolean;
  /** Every department this SOP applies to (migration 052). Empty when
   *  is_all_departments is set, or when no department was chosen.
   *  department_id above is the first of these. */
  department_ids: number[];
  department_names: string[];
  // ─── 10 structured sections from the Universal SOP Template ──────────
  purpose: string | null;
  scope: string | null;
  process_flow: string | null;
  roles_responsibilities: string | null;
  inputs_outputs: string | null;
  tools_forms: string | null;
  kpis: string | null;
  ownership_review: string | null;
  appendices: string | null;
  signatures_approval: string | null;
};

/**
 * The 10 standard SOP sections — used by both the create form and the
 * detail page so labels, numbering, and DB column names stay in sync.
 */
export const SOP_SECTIONS = [
  { key: "purpose",                num: "1",  label: "PURPOSE",                          hint: "Why this SOP exists. What it is intended to achieve." },
  { key: "scope",                  num: "2",  label: "SCOPE",                            hint: "Who and what this SOP applies to. Inclusions, exclusions, departments involved." },
  { key: "process_flow",           num: "3",  label: "PROCESS FLOW",                     hint: "Step-by-step process with responsibilities and SLAs." },
  { key: "roles_responsibilities", num: "4",  label: "ROLES & RESPONSIBILITIES",         hint: "RACI matrix - Responsible / Accountable / Consulted / Informed." },
  { key: "inputs_outputs",         num: "5",  label: "INPUTS & OUTPUTS",                 hint: "What's needed to start, and what's produced at the end." },
  { key: "tools_forms",            num: "6",  label: "TOOLS & FORMS",                    hint: "Systems, templates, forms and references used." },
  { key: "kpis",                   num: "7",  label: "KEY PERFORMANCE INDICATORS (KPIs)", hint: "2-3 measurable targets with thresholds." },
  { key: "ownership_review",       num: "9",  label: "OWNERSHIP & REVIEW",               hint: "Process Owner, review cycle, and version control log." },
  { key: "appendices",             num: "10", label: "APPENDICES - READY TO USE FORMS",  hint: "Linked forms, templates, sample data and references." },
  { key: "signatures_approval",    num: "11", label: "SIGNATURES & APPROVAL",            hint: "Approval chain: Preparer, Heads, IBE, Compliance, Deputy CEO, CEO." },
] as const;

export type SopSectionKey = (typeof SOP_SECTIONS)[number]["key"];

export const SOP_STATUS_LABEL: Record<SopStatus, string> = {
  draft: "Draft",
  pending_compliance: "Pending Compliance review",
  returned_to_dm: "Returned to Department Manager",
  pending_business_excellence: "Pending Business Excellence",
  returned_to_compliance: "Returned to Compliance",
  pending_ceo: "Pending CEO approval",
  returned_to_be: "Returned to Business Excellence",
  approved: "Approved (locked)",
  archived: "Archived",
};

export const SOP_STATUS_TONE: Record<SopStatus, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  pending_compliance: "bg-amber-50 text-amber-700 border-amber-200",
  returned_to_dm: "bg-red-50 text-red-700 border-red-200",
  pending_business_excellence: "bg-indigo-50 text-indigo-700 border-indigo-200",
  returned_to_compliance: "bg-red-50 text-red-700 border-red-200",
  pending_ceo: "bg-purple-50 text-purple-700 border-purple-200",
  returned_to_be: "bg-red-50 text-red-700 border-red-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  archived: "bg-gray-50 text-gray-500 border-gray-200",
};

/** Locked = no editing of any field is allowed. */
export function isSopLocked(status: SopStatus): boolean {
  return status === "approved" || status === "archived";
}

/**
 * Can this role edit the SOP's content (header + sections) at the given
 * status? Shared between the UI (decides whether to render the Edit
 * button) and the server action (enforces it at write time). The two
 * MUST stay in sync — keep them here.
 *
 * Returned_to_compliance is the special case the user asked for: BOTH
 * the DM and Compliance can edit (whichever acts first).
 */
export function canEditSopFields(role: string, status: SopStatus): boolean {
  if (status === "approved" || status === "archived") return false;
  if (role === "admin") return true;
  if (role === "department_manager") {
    return (
      status === "draft" ||
      status === "returned_to_dm" ||
      status === "returned_to_compliance"
    );
  }
  if (role === "compliance") {
    return status === "pending_compliance" || status === "returned_to_compliance";
  }
  if (role === "business_excellence") {
    return (
      status === "pending_business_excellence" || status === "returned_to_be"
    );
  }
  if (role === "ceo") return status === "pending_ceo";
  return false;
}

// ---------------------------------------------------------------------------
// Transition map — single source of truth for the workflow.
// Used by both the server action (validation) and the UI (which buttons
// to render). Every transition declares who may perform it and whether
// a comment is required.
// ---------------------------------------------------------------------------

export type SopTransition = {
  from: SopStatus;
  to: SopStatus;
  allowedRoles: string[];
  /** When true, the user MUST provide a non-empty comment. */
  commentRequired: boolean;
  /** Button label shown to the user. */
  label: string;
  /** One-liner description rendered next to the button. */
  description: string;
  /** Visual hint — Tailwind classes for the button. */
  tone: string;
};

export const SOP_TRANSITIONS: SopTransition[] = [
  // ------------------------------------------------------------ DM submits
  {
    from: "draft",
    to: "pending_compliance",
    allowedRoles: ["department_manager", "admin"],
    commentRequired: false,
    label: "Submit to Compliance",
    description: "Send this draft to the Compliance team for first-stage review.",
    tone: "bg-amber-600 hover:bg-amber-700",
  },
  {
    from: "returned_to_dm",
    to: "pending_compliance",
    allowedRoles: ["department_manager", "admin"],
    commentRequired: false,
    label: "Resubmit to Compliance",
    description: "After applying the requested changes, send the SOP back to Compliance.",
    tone: "bg-amber-600 hover:bg-amber-700",
  },

  // ------------------------------------------------------------ Compliance reviews
  {
    from: "pending_compliance",
    to: "pending_business_excellence",
    allowedRoles: ["compliance", "admin"],
    commentRequired: true,
    label: "Approve & forward to Business Excellence",
    description: "Approve at Compliance level. A comment is required and stored in the approval history.",
    tone: "bg-emerald-600 hover:bg-emerald-700",
  },
  {
    from: "pending_compliance",
    to: "returned_to_dm",
    allowedRoles: ["compliance", "admin"],
    commentRequired: true,
    label: "Reject — return to Department Manager",
    description: "Send back for changes. A reason is required so the DM knows what to fix.",
    tone: "bg-red-600 hover:bg-red-700",
  },
  {
    from: "returned_to_compliance",
    to: "pending_business_excellence",
    allowedRoles: ["compliance", "admin"],
    commentRequired: true,
    label: "Approve & Resubmit to Business Excellence",
    description: "After applying BE's feedback, send the SOP back to BE for review. Comment required.",
    tone: "bg-emerald-600 hover:bg-emerald-700",
  },
  {
    // NEW (workflow extension): Compliance can also bounce the SOP back
    // to the DM if the BE feedback needs deeper rework that the original
    // owner should handle.
    from: "returned_to_compliance",
    to: "returned_to_dm",
    allowedRoles: ["compliance", "admin"],
    commentRequired: true,
    label: "Reject — return to Department Manager",
    description: "Bounce back to the DM with required changes. Reason required.",
    tone: "bg-red-600 hover:bg-red-700",
  },
  {
    // NEW (workflow extension): when the SOP is back with Compliance after
    // BE rejection, the original DM can also choose to step in, edit the
    // content, and resubmit straight to Compliance (skipping their own
    // returned_to_dm bucket).
    from: "returned_to_compliance",
    to: "pending_compliance",
    allowedRoles: ["department_manager", "admin"],
    commentRequired: false,
    label: "Resubmit to Compliance",
    description: "DM edited the SOP and is sending it back to Compliance for review.",
    tone: "bg-amber-600 hover:bg-amber-700",
  },

  // ------------------------------------------------------------ BE reviews
  {
    from: "pending_business_excellence",
    to: "pending_ceo",
    allowedRoles: ["business_excellence", "admin"],
    commentRequired: true,
    label: "Approve & forward to CEO",
    description: "Approve at BE level and send to the CEO for final approval. Comment required.",
    tone: "bg-emerald-600 hover:bg-emerald-700",
  },
  {
    from: "pending_business_excellence",
    to: "returned_to_compliance",
    allowedRoles: ["business_excellence", "admin"],
    commentRequired: true,
    label: "Reject — return to Compliance",
    description: "Send back to Compliance with required changes. Reason required.",
    tone: "bg-red-600 hover:bg-red-700",
  },
  {
    from: "returned_to_be",
    to: "pending_ceo",
    allowedRoles: ["business_excellence", "admin"],
    commentRequired: false,
    label: "Resubmit to CEO",
    description: "After applying the CEO's feedback, send the SOP back to the CEO.",
    tone: "bg-purple-600 hover:bg-purple-700",
  },

  // ------------------------------------------------------------ CEO reviews
  {
    from: "pending_ceo",
    to: "approved",
    allowedRoles: ["ceo", "admin"],
    commentRequired: true,
    label: "Final Approval",
    description: "Approve as CEO. The SOP becomes locked and read-only across the system.",
    tone: "bg-emerald-700 hover:bg-emerald-800",
  },
  {
    from: "pending_ceo",
    to: "returned_to_be",
    allowedRoles: ["ceo", "admin"],
    commentRequired: true,
    label: "Reject — return to Business Excellence",
    description: "Send back to BE with required changes. Reason required.",
    tone: "bg-red-600 hover:bg-red-700",
  },

  // ------------------------------------------ Archive (admin + compliance)
  {
    from: "approved",
    to: "archived",
    allowedRoles: ["admin", "compliance"],
    commentRequired: false,
    label: "Archive",
    description: "Move an approved SOP to the archive. History is preserved.",
    tone: "bg-gray-600 hover:bg-gray-700",
  },
];

/** Get the transitions available to a given role from a given status. */
export function availableTransitions(
  role: string,
  status: SopStatus
): SopTransition[] {
  return SOP_TRANSITIONS.filter(
    (t) => t.from === status && t.allowedRoles.includes(role)
  );
}

/** Find a specific transition (used by the server action for validation). */
export function findTransition(
  from: SopStatus,
  to: SopStatus
): SopTransition | undefined {
  return SOP_TRANSITIONS.find((t) => t.from === from && t.to === to);
}
