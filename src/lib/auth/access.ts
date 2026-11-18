import "server-only";
import { queryAll } from "@/lib/db";

/**
 * Access scoping (user spec 2026-07-09): non-privileged users only see the
 * departments + domains they are mapped to. admin / compliance /
 * business_excellence have full visibility.
 *
 * Department scope comes from user_departments (falling back to the legacy
 * users.department_id), domain scope from user_domains, brand scope from
 * user_brands. Everything else (frameworks/controls/tests/questions) is
 * scoped through its domain; SOPs/audits/CAPAs through department.
 */

/**
 * Organisation-wide visibility is the `records.view_all` permission
 * (System Admin, IBE Manager, Compliance, CEO and OPEX by default —
 * docs/RBAC.md). Accepts the AuthUser from requireUser().
 */
export function hasFullVisibility(user: { permissions: ReadonlySet<string> }): boolean {
  return user.permissions.has("records.view_all");
}

export type UserScope = {
  full: boolean;
  departmentIds: number[];
  domainIds: number[];
  /** Empty means NO restriction — every brand is in scope — not "no
   *  brands visible". Only a non-empty list narrows it. Callers must
   *  branch on `.length === 0`, not use it as a plain filter set. */
  brandIds: number[];
};

/**
 * Resolve a user's access scope from the mapping tables. Full-visibility
 * roles short-circuit (no filtering). One round-trip.
 *
 * Domain scope is no longer assigned by hand (user spec 2026-08-17): the
 * user admin UI dropped its Domains picker, so domainIds is derived
 * automatically from departmentIds via domains.department_id — a
 * department manager's domains follow their department the moment either
 * changes, instead of needing a parallel manual mapping kept in sync.
 * Any pre-existing user_domains rows still count too (belt-and-braces for
 * data written before this change), but new grants never come from there.
 *
 * Brand scope works the opposite way on purpose: an EMPTY brandIds means
 * "no brand restriction" (all brands), not "no brands visible" — see the
 * brandIds doc comment below and the one call site that reads it
 * (audits/new). Assigning specific brands narrows it; the admin UI no
 * longer offers that picker either, so in practice this is always empty
 * and always means "all".
 */
export async function getUserScope(
  userId: number,
  user: { permissions: ReadonlySet<string> }
): Promise<UserScope> {
  if (hasFullVisibility(user)) {
    return { full: true, departmentIds: [], domainIds: [], brandIds: [] };
  }
  const rows = await queryAll<{ kind: string; id: number }>(
    `SELECT 'dept' AS kind, department_id AS id FROM user_departments WHERE user_id = $1
     UNION ALL
     SELECT 'dept', department_id FROM users WHERE id = $1 AND department_id IS NOT NULL
     UNION ALL
     SELECT 'domain', domain_id FROM user_domains WHERE user_id = $1
     UNION ALL
     SELECT 'brand', brand_id FROM user_brands WHERE user_id = $1`,
    [userId]
  );
  const dep = new Set<number>();
  const dom = new Set<number>();
  const br = new Set<number>();
  for (const r of rows) {
    if (r.kind === "dept") dep.add(r.id);
    else if (r.kind === "domain") dom.add(r.id);
    else if (r.kind === "brand") br.add(r.id);
  }

  // Auto-derive domain scope from department scope.
  if (dep.size > 0) {
    const autoDomains = await queryAll<{ id: number }>(
      `SELECT id FROM domains WHERE department_id = ANY($1)`,
      [[...dep]]
    );
    for (const d of autoDomains) dom.add(d.id);
  }

  return {
    full: false,
    departmentIds: [...dep],
    domainIds: [...dom],
    brandIds: [...br],
  };
}

export type ScopedIds = {
  departmentIds: number[];
  domainIds: number[];
  frameworkIds: number[];
  controlIds: number[];
};

/**
 * Resolve the concrete id sets a scoped user may see across the GRC tree:
 * frameworks whose domain is in scope, and controls under those frameworks.
 * Returns null for full-visibility users (no filtering). Lets list pages
 * filter their already-fetched rows in memory by id / framework_id /
 * control_id / department_id without editing every repository select.
 */
export async function getScopedIds(scope: UserScope): Promise<ScopedIds | null> {
  if (scope.full) return null;
  const frameworks = scope.domainIds.length
    ? await queryAll<{ id: number }>(
        `SELECT id FROM frameworks WHERE domain_id = ANY($1)`,
        [scope.domainIds]
      )
    : [];
  const frameworkIds = frameworks.map((r) => r.id);
  const controls = frameworkIds.length
    ? await queryAll<{ id: number }>(
        `SELECT id FROM controls WHERE framework_id = ANY($1)`,
        [frameworkIds]
      )
    : [];
  return {
    departmentIds: scope.departmentIds,
    domainIds: scope.domainIds,
    frameworkIds,
    controlIds: controls.map((r) => r.id),
  };
}

/**
 * Build a SQL "IN (...)" fragment for a scoped id list, or a guaranteed-empty
 * predicate when the user has no ids of that kind. Returns null when access
 * is full (caller should apply no filter). The column is trusted (caller
 * supplies a literal), ids are numbers so safe to inline.
 */
export function scopeInClause(
  column: string,
  ids: number[],
  scope: UserScope
): string | null {
  if (scope.full) return null;
  if (ids.length === 0) return `${column} = -1`; // empty set → nothing matches
  return `${column} IN (${ids.map((n) => Number(n)).join(",")})`;
}
