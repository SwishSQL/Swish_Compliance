export type SopStatus =
  | "draft"
  | "pending_opex"
  | "pending_dept_validation"
  | "pending_compliance"
  | "returned_to_dm"
  | "pending_business_excellence"
  | "returned_to_compliance"
  | "pending_ceo"
  | "returned_to_be"
  | "approved"
  | "rejected"
  | "archived";

export const SOP_STATUSES: SopStatus[] = [
  "draft",
  "pending_opex",
  "pending_dept_validation",
  "pending_compliance",
  "returned_to_dm",
  "pending_business_excellence",
  "returned_to_compliance",
  "pending_ceo",
  "returned_to_be",
  "approved",
  "rejected",
  "archived",
];

export type Sop = {
  id: number;
  code: string | null;
  title: string;
  description: string | null;
  version: string;
  status: SopStatus;
  /** Set on a draft that revises an approved SOP (migration 006). */
  revision_of_id: number | null;
  /** Approval route (migration 007): "standard" | "opex_authored" | null (legacy). */
  workflow_route: string | null;
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
  pending_opex: "Pending OPEX review",
  pending_dept_validation: "Pending department validation",
  pending_compliance: "Pending Compliance review",
  returned_to_dm: "Returned to author",
  pending_business_excellence: "Pending IBE review",
  returned_to_compliance: "Returned to Compliance",
  pending_ceo: "Pending CEO approval",
  returned_to_be: "Returned to IBE",
  approved: "Approved (locked)",
  rejected: "Rejected",
  archived: "Archived",
};

export const SOP_STATUS_TONE: Record<SopStatus, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  pending_opex: "bg-sky-50 text-sky-700 border-sky-200",
  pending_dept_validation: "bg-sky-50 text-sky-700 border-sky-200",
  pending_compliance: "bg-amber-50 text-amber-700 border-amber-200",
  returned_to_dm: "bg-red-50 text-red-700 border-red-200",
  pending_business_excellence: "bg-indigo-50 text-indigo-700 border-indigo-200",
  returned_to_compliance: "bg-red-50 text-red-700 border-red-200",
  pending_ceo: "bg-purple-50 text-purple-700 border-purple-200",
  returned_to_be: "bg-red-50 text-red-700 border-red-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-100 text-red-800 border-red-300",
  archived: "bg-gray-50 text-gray-500 border-gray-200",
};

/** Locked = no editing of any field is allowed. */
export function isSopLocked(status: SopStatus): boolean {
  return status === "approved" || status === "archived" || status === "rejected";
}

/** Next minor version: "1.0" → "1.1", "1.9" → "1.10", "2" → "2.1". */
export function nextSopVersion(v: string): string {
  const m = /^(\d+)(?:\.(\d+))?/.exec(v.trim());
  if (!m) return `${v}.1`;
  return `${m[1]}.${m[2] ? Number(m[2]) + 1 : 1}`;
}

// ---------------------------------------------------------------------------
// RBAC workflow (docs/RBAC.md §4). Pure: callers pass the actor (permissions
// + the departments they're scoped to) and the SOP.
// ---------------------------------------------------------------------------

/**
 * standard      DM / Compliance / IBE author → OPEX → Compliance → IBE → CEO
 * opex_authored OPEX author → Department Manager validation → Compliance → IBE → CEO
 * legacy (NULL) SOPs already in flight before RBAC → Compliance → IBE → CEO
 */
export type SopRoute = "standard" | "opex_authored";

export type SopActor = {
  id: number;
  permissions: ReadonlySet<string>;
  /** Departments in the actor's scope (empty for organisation-wide users). */
  departmentIds: readonly number[];
};

export type SopRef = {
  status: SopStatus;
  created_by: number | null;
  owner_id: number | null;
  workflow_route?: string | null;
  department_id?: number | null;
  department_ids?: readonly number[];
  is_all_departments?: boolean;
};

/** Route a new SOP follows, from its author's permissions. */
export function routeForAuthor(author: { permissions: ReadonlySet<string> }): SopRoute {
  return author.permissions.has("sop.review_opex") ? "opex_authored" : "standard";
}

/** First review stage of a route (what "Submit" moves a draft to). */
export function firstReviewStage(route: string | null | undefined): SopStatus {
  if (route === "standard") return "pending_opex";
  if (route === "opex_authored") return "pending_dept_validation";
  return "pending_compliance";
}

function sopDepartmentIds(sop: SopRef): number[] {
  const ids = [...(sop.department_ids ?? [])];
  if (sop.department_id != null && !ids.includes(sop.department_id)) ids.push(sop.department_id);
  return ids;
}

/** The actor's departments overlap the SOP's (an all-departments SOP matches any). */
export function inSopDepartment(actor: SopActor, sop: SopRef): boolean {
  if (sop.is_all_departments) return actor.departmentIds.length > 0;
  const ids = sopDepartmentIds(sop);
  return ids.some((d) => actor.departmentIds.includes(d));
}

export function isSopAuthor(actor: { id: number }, sop: SopRef): boolean {
  return sop.created_by === actor.id || sop.owner_id === actor.id;
}

/**
 * May act as the SOP's author (edit while with the author, submit,
 * resubmit, manage file/link, start a revision): the creator / owner,
 * anyone allowed to edit every department's drafts, or a department
 * manager of the SOP's department.
 */
export function canActAsAuthor(actor: SopActor, sop: SopRef): boolean {
  if (actor.permissions.has("sop.edit_any_draft")) return true;
  if (isSopAuthor(actor, sop)) return true;
  return actor.permissions.has("sop.create_own_dept") && inSopDepartment(actor, sop);
}

/** File / link / new-version management (content stays locked when approved). */
export function canManageSop(actor: SopActor, sop: SopRef): boolean {
  return canActAsAuthor(actor, sop);
}

/** Statuses where the document sits with its author for changes. */
const AUTHOR_STATUSES: SopStatus[] = ["draft", "returned_to_dm"];

/**
 * Can this actor edit the SOP's content at its current status? Shared by
 * the UI and the server action. The CEO never edits content.
 */
export function canEditSopFields(actor: SopActor, sop: SopRef): boolean {
  if (isSopLocked(sop.status)) return false;
  if (actor.permissions.has("sop.edit_any_draft")) return true;
  if (!canActAsAuthor(actor, sop)) return false;
  return AUTHOR_STATUSES.includes(sop.status) || sop.status === "returned_to_compliance";
}

type Who =
  | { kind: "author" }
  | { kind: "dept_validator" }
  | { kind: "permission"; permission: string };

export type SopDecision = "submit" | "approve" | "return" | "reject" | "archive" | "reopen";

export type SopTransition = {
  from: SopStatus;
  to: SopStatus;
  who: Who;
  decision: SopDecision;
  /** Only for SOPs on these routes ("legacy" = workflow_route NULL). */
  routes?: ("standard" | "opex_authored" | "legacy")[];
  commentRequired: boolean;
  label: string;
  description: string;
  tone: string;
};

const T_SUBMIT = "bg-amber-600 hover:bg-amber-700";
const T_APPROVE = "bg-emerald-600 hover:bg-emerald-700";
const T_RETURN = "bg-orange-600 hover:bg-orange-700";
const T_REJECT = "bg-red-700 hover:bg-red-800";

const OPEX: Who = { kind: "permission", permission: "sop.review_opex" };
const COMPLIANCE: Who = { kind: "permission", permission: "sop.review_compliance" };
const IBE: Who = { kind: "permission", permission: "sop.review_ibe" };
const CEO: Who = { kind: "permission", permission: "sop.review_ceo" };
const AUTHOR: Who = { kind: "author" };
const VALIDATOR: Who = { kind: "dept_validator" };

function reject(from: SopStatus, who: Who): SopTransition {
  return {
    from,
    to: "rejected",
    who,
    decision: "reject",
    commentRequired: true,
    label: "Reject",
    description: "End this submission. The reason is recorded; the author can reopen it as a new draft.",
    tone: T_REJECT,
  };
}

export const SOP_TRANSITIONS: SopTransition[] = [
  // ── Author submits / resubmits to the first stage of the route ──────────
  { from: "draft", to: "pending_opex", who: AUTHOR, decision: "submit", routes: ["standard"], commentRequired: false,
    label: "Submit to OPEX", description: "Send this draft to OPEX for operational review.", tone: T_SUBMIT },
  { from: "draft", to: "pending_dept_validation", who: AUTHOR, decision: "submit", routes: ["opex_authored"], commentRequired: false,
    label: "Submit for department validation", description: "The department manager validates the department content first.", tone: T_SUBMIT },
  { from: "draft", to: "pending_compliance", who: AUTHOR, decision: "submit", routes: ["legacy"], commentRequired: false,
    label: "Submit to Compliance", description: "Send this draft to Compliance.", tone: T_SUBMIT },
  { from: "returned_to_dm", to: "pending_opex", who: AUTHOR, decision: "submit", routes: ["standard"], commentRequired: false,
    label: "Resubmit to OPEX", description: "After applying the requested changes, send it back for review.", tone: T_SUBMIT },
  { from: "returned_to_dm", to: "pending_dept_validation", who: AUTHOR, decision: "submit", routes: ["opex_authored"], commentRequired: false,
    label: "Resubmit for department validation", description: "After applying the requested changes, send it back for review.", tone: T_SUBMIT },
  { from: "returned_to_dm", to: "pending_compliance", who: AUTHOR, decision: "submit", routes: ["legacy"], commentRequired: false,
    label: "Resubmit to Compliance", description: "After applying the requested changes, send it back to Compliance.", tone: T_SUBMIT },
  { from: "rejected", to: "draft", who: AUTHOR, decision: "reopen", commentRequired: false,
    label: "Reopen as draft", description: "Start a new submission from this rejected SOP.", tone: "bg-gray-600 hover:bg-gray-700" },

  // ── OPEX stage (standard route) ─────────────────────────────────────────
  { from: "pending_opex", to: "pending_compliance", who: OPEX, decision: "approve", commentRequired: true,
    label: "Approve & forward to Compliance", description: "Approve at OPEX level. Comment required.", tone: T_APPROVE },
  { from: "pending_opex", to: "returned_to_dm", who: OPEX, decision: "return", commentRequired: true,
    label: "Return to author", description: "Send back for correction. Reason required.", tone: T_RETURN },
  reject("pending_opex", OPEX),

  // ── Department validation (OPEX-authored route) ─────────────────────────
  { from: "pending_dept_validation", to: "pending_compliance", who: VALIDATOR, decision: "approve", commentRequired: true,
    label: "Validate & forward to Compliance", description: "Confirm the department content is correct. Comment required.", tone: T_APPROVE },
  { from: "pending_dept_validation", to: "returned_to_dm", who: VALIDATOR, decision: "return", commentRequired: true,
    label: "Return to author (OPEX)", description: "Send back for correction. Reason required.", tone: T_RETURN },

  // ── Compliance stage ────────────────────────────────────────────────────
  { from: "pending_compliance", to: "pending_business_excellence", who: COMPLIANCE, decision: "approve", commentRequired: true,
    label: "Approve & forward to IBE", description: "Approve at Compliance level. Comment required.", tone: T_APPROVE },
  { from: "pending_compliance", to: "returned_to_dm", who: COMPLIANCE, decision: "return", commentRequired: true,
    label: "Return to author", description: "Send back for correction. Reason required.", tone: T_RETURN },
  reject("pending_compliance", COMPLIANCE),
  { from: "returned_to_compliance", to: "pending_business_excellence", who: COMPLIANCE, decision: "approve", commentRequired: true,
    label: "Approve & resubmit to IBE", description: "After applying IBE's feedback, send it back to IBE. Comment required.", tone: T_APPROVE },
  { from: "returned_to_compliance", to: "returned_to_dm", who: COMPLIANCE, decision: "return", commentRequired: true,
    label: "Return to author", description: "Bounce back to the author with required changes. Reason required.", tone: T_RETURN },
  { from: "returned_to_compliance", to: "pending_compliance", who: AUTHOR, decision: "submit", commentRequired: false,
    label: "Resubmit to Compliance", description: "The author edited the SOP and sends it back to Compliance.", tone: T_SUBMIT },

  // ── IBE stage ───────────────────────────────────────────────────────────
  { from: "pending_business_excellence", to: "pending_ceo", who: IBE, decision: "approve", commentRequired: true,
    label: "Approve & forward to CEO", description: "Approve at IBE level and send to the CEO. Comment required.", tone: T_APPROVE },
  { from: "pending_business_excellence", to: "returned_to_compliance", who: IBE, decision: "return", commentRequired: true,
    label: "Return to Compliance", description: "Send back to Compliance with required changes. Reason required.", tone: T_RETURN },
  reject("pending_business_excellence", IBE),
  { from: "returned_to_be", to: "pending_ceo", who: IBE, decision: "approve", commentRequired: false,
    label: "Resubmit to CEO", description: "After applying the CEO's feedback, send it back to the CEO.", tone: "bg-purple-600 hover:bg-purple-700" },

  // ── CEO stage ───────────────────────────────────────────────────────────
  { from: "pending_ceo", to: "approved", who: CEO, decision: "approve", commentRequired: true,
    label: "Final approval", description: "Approve as CEO. The SOP is published and locked.", tone: "bg-emerald-700 hover:bg-emerald-800" },
  { from: "pending_ceo", to: "returned_to_be", who: CEO, decision: "return", commentRequired: true,
    label: "Return to IBE", description: "Send back to IBE with required changes. Reason required.", tone: T_RETURN },
  reject("pending_ceo", CEO),

  // ── Archive ─────────────────────────────────────────────────────────────
  { from: "approved", to: "archived", who: { kind: "permission", permission: "sop.archive" }, decision: "archive", commentRequired: false,
    label: "Archive", description: "Move an approved SOP to the archive. History is preserved.", tone: "bg-gray-600 hover:bg-gray-700" },
];

function routeKey(sop: SopRef): "standard" | "opex_authored" | "legacy" {
  return sop.workflow_route === "standard" || sop.workflow_route === "opex_authored"
    ? sop.workflow_route
    : "legacy";
}

function whoAllows(who: Who, actor: SopActor, sop: SopRef): boolean {
  switch (who.kind) {
    case "author":
      return canActAsAuthor(actor, sop);
    case "dept_validator":
      return actor.permissions.has("sop.validate_dept") && inSopDepartment(actor, sop);
    case "permission":
      return actor.permissions.has(who.permission);
  }
}

/**
 * Why `actor` may not take transition `t` on `sop`, or null if allowed.
 * Segregation of duties: nobody approves at a review stage a SOP they
 * created or own — another holder of that stage's permission must do it.
 */
export function transitionBlocker(actor: SopActor, sop: SopRef, t: SopTransition): string | null {
  if (t.from !== sop.status) return "The SOP is no longer at that stage.";
  if (t.routes && !t.routes.includes(routeKey(sop))) return "That step isn't part of this SOP's approval route.";
  if (!whoAllows(t.who, actor, sop)) return "You are not allowed to take this action at this stage.";
  if (t.decision === "approve" && isSopAuthor(actor, sop)) {
    return "You can't approve a SOP you created or own — another authorised reviewer must approve it.";
  }
  return null;
}

/** Transitions the actor may take right now (drives the buttons). */
export function availableTransitions(actor: SopActor, sop: SopRef): SopTransition[] {
  return SOP_TRANSITIONS.filter((t) => transitionBlocker(actor, sop, t) === null);
}

/** The transition from the SOP's status to `to` that fits its route. */
export function findTransition(sop: SopRef, to: SopStatus): SopTransition | undefined {
  const rk = routeKey(sop);
  return SOP_TRANSITIONS.find(
    (t) => t.from === sop.status && t.to === to && (!t.routes || t.routes.includes(rk))
  );
}

/** The review stage a pending status belongs to (for "awaiting you" lists). */
export const SOP_STAGE_PERMISSION: Partial<Record<SopStatus, string>> = {
  pending_opex: "sop.review_opex",
  pending_dept_validation: "sop.validate_dept",
  pending_compliance: "sop.review_compliance",
  returned_to_compliance: "sop.review_compliance",
  pending_business_excellence: "sop.review_ibe",
  returned_to_be: "sop.review_ibe",
  pending_ceo: "sop.review_ceo",
};

/**
 * Record-level visibility (docs/RBAC.md §8). Organisation-wide users see
 * everything. Others see a SOP of their department (or an all-departments
 * SOP) once it is approved / archived, and — while it is in the workflow —
 * only if they can act as its author or validate it. The author always
 * sees their own SOP.
 */
export function canViewSop(actor: SopActor & { fullScope: boolean }, sop: SopRef): boolean {
  if (actor.fullScope) return true;
  if (isSopAuthor(actor, sop)) return true;
  const mine = sop.is_all_departments || inSopDepartment(actor, sop);
  if (!mine) return false;
  if (sop.status === "approved" || sop.status === "archived") return true;
  return canActAsAuthor(actor, sop) || actor.permissions.has("sop.validate_dept");
}
