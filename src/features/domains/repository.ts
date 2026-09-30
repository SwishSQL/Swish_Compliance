import "server-only";
import { queryAll, queryOne } from "@/lib/db";
import type { Domain, DomainFramework } from "./types";

const DOMAIN_SELECT = `
  d.id, d.code, d.name, d.description, d.sort_order,
  d.is_active, d.created_at, d.updated_at,
  d.review_scope_method, d.evidence_to_obtain, d.review_focus, d.how_to_verify,
  (SELECT COUNT(*) FROM frameworks f WHERE f.domain_id = d.id) AS framework_count
FROM domains d
`;

export async function listDomains(includeInactive = false): Promise<Domain[]> {
  const where = includeInactive ? "" : "WHERE d.is_active = 1";
  return queryAll<Domain>(
    `SELECT ${DOMAIN_SELECT} ${where} ORDER BY d.sort_order, d.name`
  );
}

export async function getDomain(id: number): Promise<Domain | undefined> {
  return queryOne<Domain>(
    `SELECT ${DOMAIN_SELECT} WHERE d.id = $1`,
    [id]
  );
}

export async function createDomain(input: {
  code: string;
  name: string;
  description: string | null;
  sort_order: number | null;
  /** SOP-first audit scoping (migration 046) — a domain names at most one
   *  SOP + department, so the audit scope picker can walk SOP → domain. */
  sop_id: number | null;
  department_id: number | null;
}): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO domains (code, name, description, sort_order, sop_id, department_id, is_active)
     OUTPUT INSERTED.id
     VALUES ($1, $2, $3, COALESCE(CAST($4 AS INT), 0), $5, $6, 1)`,
    [
      input.code,
      input.name,
      input.description,
      input.sort_order,
      input.sop_id,
      input.department_id,
    ]
  );
  return row!.id;
}

/**
 * All frameworks attached to a given domain, ordered by code so the
 * numeric suffix (FW-001, FW-002, …) reads naturally on the page.
 */
export async function listFrameworksForDomain(
  domainId: number
): Promise<DomainFramework[]> {
  return queryAll<DomainFramework>(
    `SELECT id, code, name, description, category, is_active
     FROM frameworks
     WHERE domain_id = $1
     ORDER BY code, name`,
    [domainId]
  );
}

export type DomainFrameworkRow = DomainFramework & { domain_id: number };
export type DomainSopRow = {
  domain_id: number;
  id: number;
  code: string | null;
  title: string;
  department_id: number | null;
  department_name: string | null;
};

/**
 * Frameworks and SOPs for every domain in one round trip each, keyed by
 * domain_id. Backs the domains list page's inline accordion — expanding a
 * card needs no extra fetch, everything is already in hand.
 */
export async function listFrameworksByDomain(): Promise<
  Map<number, DomainFramework[]>
> {
  const rows = await queryAll<DomainFrameworkRow>(
    `SELECT id, domain_id, code, name, description, category, is_active
     FROM frameworks
     WHERE domain_id IS NOT NULL
     ORDER BY code, name`
  );
  const map = new Map<number, DomainFramework[]>();
  for (const { domain_id, ...fw } of rows) {
    (map.get(domain_id) ?? map.set(domain_id, []).get(domain_id)!).push(fw);
  }
  return map;
}

/**
 * SOPs per domain via home_domain_id (migration 045: each SOP has exactly
 * ONE home domain, derived from its owning department) — same rule the
 * per-domain detail page already applies, just for every domain at once.
 */
export async function listSopsByDomain(): Promise<Map<number, DomainSopRow[]>> {
  const rows = await queryAll<DomainSopRow>(
    `SELECT s.home_domain_id AS domain_id, s.id, s.code, s.title,
            d.id AS department_id, d.name AS department_name
     FROM sops s
     LEFT JOIN departments d ON d.id = s.department_id
     WHERE s.home_domain_id IS NOT NULL
     ORDER BY CASE WHEN s.code IS NULL THEN 1 ELSE 0 END, s.code, s.title`
  );
  const map = new Map<number, DomainSopRow[]>();
  for (const r of rows) {
    (map.get(r.domain_id) ?? map.set(r.domain_id, []).get(r.domain_id)!).push(r);
  }
  return map;
}
