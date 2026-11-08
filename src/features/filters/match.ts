import type { Lineage } from "./lineage";

/* ─── Matching (pure — unit tested) ─────────────────────────────────── */

export type Filters = {
  domain?: number;
  framework?: number;
  department?: number;
  brand?: number;
};

type LineageLike = Pick<Lineage, "frameworks" | "domainDepts" | "domainBrands" | "frameworkDept">;

export function domainMatches(lin: LineageLike, domainId: number | null, f: Filters): boolean {
  if (f.domain && domainId !== f.domain) return false;
  if (f.department && !(domainId != null && lin.domainDepts.get(domainId)?.has(f.department))) return false;
  if (f.brand && !(domainId != null && lin.domainBrands.get(domainId)?.has(f.brand))) return false;
  return true;
}

export function frameworkMatches(lin: LineageLike, frameworkId: number, f: Filters): boolean {
  if (f.framework && frameworkId !== f.framework) return false;
  const fw = lin.frameworks.find((x) => x.id === frameworkId);
  const domainId = fw?.domain_id ?? null;
  if (f.domain && domainId !== f.domain) return false;
  if (f.department) {
    const own = lin.frameworkDept.get(frameworkId) === f.department;
    const viaDomain = domainId != null && !!lin.domainDepts.get(domainId)?.has(f.department);
    if (!own && !viaDomain) return false;
  }
  if (f.brand && !(domainId != null && lin.domainBrands.get(domainId)?.has(f.brand))) return false;
  return true;
}

/** True when any of the given frameworks matches (no parent filter set → true). */
export function anyFrameworkMatches(lin: LineageLike, frameworkIds: Iterable<number>, f: Filters): boolean {
  if (!f.domain && !f.framework && !f.department && !f.brand) return true;
  for (const id of frameworkIds) if (frameworkMatches(lin, id, f)) return true;
  return false;
}

/** Read a numeric id from a query-string value. */
export const idParam = (v?: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
