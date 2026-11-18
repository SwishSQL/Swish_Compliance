/**
 * RBAC permission registry (pure — no DB / server imports, unit-testable).
 *
 * A user holds one or more ROLES (user_roles, migration 007; users.role is
 * kept as the primary role for backwards compatibility). Each role grants a
 * set of PERMISSIONS from DEFAULT_ROLE_PERMISSIONS below. An admin can
 * override any role × permission cell from the Permissions screen; those
 * overrides live in role_permissions and are applied on top of the
 * defaults by effectivePermissions().
 *
 * Record-level rules (own department, assigned record, not your own
 * submission, …) are NOT permissions — they're checked next to the record
 * in the workflow code. A permission only says "this role may do this kind
 * of thing at all".
 *
 * See docs/RBAC.md for the matrix and the business decisions behind it.
 */

export const ROLES = [
  "admin",
  "business_excellence", // IBE Manager (Head of Compliance)
  "compliance",
  "ceo",
  "opex",
  "department_manager",
  "department_member",
  // Legacy roles kept so existing accounts keep working. They grant no more
  // than a department member; auditing is now assignment-based.
  "auditor",
  "viewer",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "System Admin",
  business_excellence: "IBE Manager",
  compliance: "Compliance Officer",
  ceo: "CEO",
  opex: "OPEX",
  department_manager: "Department Manager",
  department_member: "Department Member",
  auditor: "Auditor (legacy)",
  viewer: "Viewer (legacy)",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Technical administration: users, roles, scope, settings, permissions. No business approvals.",
  business_excellence: "Head of Compliance: organisation-wide access, IBE approval stage, audits, CAPA monitoring.",
  compliance: "Main operational user: SOPs, GRC library, audits, CAPA verification and closure.",
  ceo: "Executive viewer with the final SOP approval stage.",
  opex: "Operational review of SOPs (OPEX approval stage); creates SOPs for any department.",
  department_manager: "Own department's SOPs, audit results and CAPAs (assign + review).",
  department_member: "Approved SOPs for their department and their own assigned CAPAs / audits.",
  auditor: "Legacy role — same access as a Department Member; can be assigned audits.",
  viewer: "Legacy role — same access as a Department Member.",
};

export const PERMISSIONS = {
  // Users & system
  "admin.users": "Create / edit / deactivate users, assign roles and scope",
  "admin.permissions": "Edit the role × permission matrix",
  "admin.settings": "Manage system settings, reference data and imports",
  "admin.audit_logs": "View the audit trail",
  "admin.reassign": "Reassign a user's outstanding work",
  // Visibility
  "records.view_all": "See every department and brand (organisation-wide scope)",
  "grc.view": "View the GRC library (domains, frameworks, controls, tests, checklists, questions)",
  "grc.edit": "Create / edit / link GRC library items",
  "grc.delete": "Delete or archive governed records",
  // SOPs
  "sop.create_any": "Create SOPs for any department",
  "sop.create_own_dept": "Create SOPs for own department(s)",
  "sop.edit_any_draft": "Edit draft / returned SOPs of any department",
  "sop.review_opex": "Approve / return / reject at the OPEX stage",
  "sop.validate_dept": "Validate an OPEX-authored SOP for own department",
  "sop.review_compliance": "Approve / return / reject at the Compliance stage",
  "sop.review_ibe": "Approve / return / reject at the IBE stage",
  "sop.review_ceo": "Final approve / return / reject at the CEO stage",
  "sop.archive": "Archive an approved SOP",
  // Audits
  "audit.create": "Create and assign audits",
  "audit.finalize": "Review submitted audit results and finalize (close) them",
  "audit.cancel": "Cancel an audit",
  // CAPAs
  "capa.assign_any": "Assign / reassign CAPAs in any department",
  "capa.assign_own_dept": "Assign CAPAs of own department to its members",
  "capa.manager_review": "Review submitted CAPAs of own department (forward or return)",
  "capa.verify_close": "Verify and formally close CAPAs (or return them)",
  "capa.monitor": "See CAPA progress across scope",
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

const MEMBER: Permission[] = [];

/** The spec's matrix (docs/RBAC.md §2). */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    "admin.users",
    "admin.permissions",
    "admin.settings",
    "admin.audit_logs",
    "admin.reassign",
    "records.view_all",
    "grc.view",
    "capa.monitor",
  ],
  business_excellence: [
    "records.view_all",
    "grc.view",
    "grc.edit",
    "sop.create_any",
    "sop.edit_any_draft",
    "sop.review_ibe",
    "audit.create",
    "audit.finalize",
    "capa.assign_any",
    "capa.monitor",
    "admin.reassign",
  ],
  compliance: [
    "records.view_all",
    "grc.view",
    "grc.edit",
    "grc.delete",
    "sop.create_any",
    "sop.edit_any_draft",
    "sop.review_compliance",
    "sop.archive",
    "audit.create",
    "audit.finalize",
    "audit.cancel",
    "capa.assign_any",
    "capa.verify_close",
    "capa.monitor",
  ],
  ceo: ["records.view_all", "grc.view", "sop.review_ceo", "capa.monitor"],
  opex: [
    "records.view_all",
    "grc.view",
    "sop.create_any",
    "sop.edit_any_draft",
    "sop.review_opex",
  ],
  department_manager: [
    "grc.view",
    "sop.create_own_dept",
    "sop.validate_dept",
    "capa.assign_own_dept",
    "capa.manager_review",
    "capa.monitor",
  ],
  department_member: MEMBER,
  auditor: MEMBER,
  viewer: MEMBER,
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export type PermissionOverride = { role: string; permission: string; allowed: boolean };

/**
 * Union of every role's permissions, after the admin's overrides.
 * Unknown roles / permissions are ignored (never grant by accident).
 */
export function effectivePermissions(
  roles: readonly string[],
  overrides: readonly PermissionOverride[] = []
): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) {
    if (!isRole(role)) continue;
    const set = new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role]);
    for (const o of overrides) {
      if (o.role !== role || !(o.permission in PERMISSIONS)) continue;
      const p = o.permission as Permission;
      if (o.allowed) set.add(p);
      else set.delete(p);
    }
    set.forEach((p) => out.add(p));
  }
  return out;
}

/** Anything carrying an effective permission set (SessionUser does). */
export type HasPermissions = { permissions: ReadonlySet<string> };

export function can(user: HasPermissions, permission: Permission): boolean {
  return user.permissions.has(permission);
}

export function canAny(user: HasPermissions, ...permissions: Permission[]): boolean {
  return permissions.some((p) => user.permissions.has(p));
}

/** Anything carrying role(s): either the full roles list or a single role. */
export type HasRoles = { role: string; roles?: readonly string[] };

export function hasRole(user: HasRoles, ...roles: string[]): boolean {
  const mine = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  return mine.some((r) => roles.includes(r));
}
