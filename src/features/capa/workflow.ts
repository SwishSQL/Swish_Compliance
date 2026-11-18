/**
 * CAPA workflow rules (docs/RBAC.md §7). Pure — unit-tested.
 *
 * Assignee (CAPA owner)   works on it and submits it.
 * Department Manager      reviews submissions of their department
 *                         (forward to Compliance, or return).
 * Compliance              verifies and formally closes (or returns).
 * Nobody verifies, reviews or closes a CAPA assigned to themselves.
 */
import type { CapaStatus } from "./types";

export type CapaActor = {
  id: number;
  permissions: ReadonlySet<string>;
  /** Departments in the actor's scope (empty = organisation-wide / none). */
  departmentIds: readonly number[];
};

export type CapaRef = {
  status: CapaStatus;
  assigned_to: number | null;
  created_by?: number | null;
  reviewer_id?: number | null;
  department_id: number | null;
};

/** Statuses in which the CAPA sits with its assignee. */
const WITH_ASSIGNEE: CapaStatus[] = ["open", "assigned", "in_progress", "returned", "rejected"];
/** Awaiting Compliance verification (new + legacy statuses). */
const WITH_COMPLIANCE: CapaStatus[] = ["pending_compliance_verification", "submitted", "verified"];

export const isWithAssignee = (s: CapaStatus) => WITH_ASSIGNEE.includes(s);
export const isWithCompliance = (s: CapaStatus) => WITH_COMPLIANCE.includes(s);
export const isCapaClosed = (s: CapaStatus) => s === "closed";

function inDept(actor: CapaActor, capa: CapaRef): boolean {
  return capa.department_id != null && actor.departmentIds.includes(capa.department_id);
}

/** Assignee may save progress, upload evidence and submit. */
export function canWorkOnCapa(actor: CapaActor, capa: CapaRef): boolean {
  return capa.assigned_to === actor.id && isWithAssignee(capa.status);
}

/** Department manager review of a submitted CAPA (forward or return). */
export function canManagerReviewCapa(actor: CapaActor, capa: CapaRef): boolean {
  return (
    capa.status === "pending_manager_review" &&
    capa.assigned_to !== actor.id &&
    actor.permissions.has("capa.manager_review") &&
    inDept(actor, capa)
  );
}

/** Compliance verification + formal closure (or return). */
export function canVerifyCloseCapa(actor: CapaActor, capa: CapaRef): boolean {
  return (
    isWithCompliance(capa.status) &&
    capa.assigned_to !== actor.id &&
    actor.permissions.has("capa.verify_close")
  );
}

/** Assign / reassign a CAPA of `departmentId`. */
export function canAssignCapa(actor: CapaActor, departmentId: number | null): boolean {
  if (actor.permissions.has("capa.assign_any")) return true;
  return (
    actor.permissions.has("capa.assign_own_dept") &&
    departmentId != null &&
    actor.departmentIds.includes(departmentId)
  );
}

/**
 * Where a submission goes: to the department manager first when the
 * department has one who isn't the assignee, else straight to Compliance.
 */
export function submitTarget(managerIds: readonly number[], assigneeId: number | null): CapaStatus {
  return managerIds.some((m) => m !== assigneeId)
    ? "pending_manager_review"
    : "pending_compliance_verification";
}

/** Record-level visibility. */
export function canViewCapa(actor: CapaActor & { fullScope: boolean }, capa: CapaRef): boolean {
  if (actor.fullScope) return true;
  if (capa.assigned_to === actor.id || capa.created_by === actor.id || capa.reviewer_id === actor.id) {
    return true;
  }
  return actor.permissions.has("capa.monitor") && inDept(actor, capa);
}
