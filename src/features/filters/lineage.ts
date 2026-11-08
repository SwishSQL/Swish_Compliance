import "server-only";
import { queryAll } from "@/lib/db";

/*
 * How the Compliance Library hangs together, flattened for list filters:
 *
 *   Domain ── Framework ── Control ── Test (check) ── Checklist ── Question
 *     │
 *     ├─ department: domains.department_id + departments of its SOPs
 *     └─ brand:      brands of its SOPs
 *
 * A framework also carries its own department_id. Departments and brands
 * flow down: a checklist belongs to the departments/brands of the domains
 * its tests' controls sit under.
 */

export type Option = { id: number; name: string };

export type Lineage = {
  domains: Option[];
  frameworks: (Option & { domain_id: number | null })[];
  departments: Option[];
  brands: Option[];
  /** domain id → department ids / brand ids */
  domainDepts: Map<number, Set<number>>;
  domainBrands: Map<number, Set<number>>;
  /** framework id → its own department id (if any) */
  frameworkDept: Map<number, number>;
  /** checklist template id → framework ids (via tests → controls) */
  templateFrameworks: Map<number, Set<number>>;
  /** control id → framework id */
  controlFramework: Map<number, number>;
};

const add = (m: Map<number, Set<number>>, k: number | null, v: number | null) => {
  if (k == null || v == null) return;
  (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);
};

export async function loadLineage(): Promise<Lineage> {
  const [domains, frameworks, departments, brands, domDept, domBrand, tplFw, ctlFw] = await Promise.all([
    queryAll<Option>(`SELECT id, name FROM domains ORDER BY sort_order, name`),
    queryAll<Option & { domain_id: number | null; department_id: number | null }>(
      `SELECT id, name, domain_id, department_id FROM frameworks ORDER BY name`
    ),
    queryAll<Option>(`SELECT id, name FROM departments WHERE is_active = 1 ORDER BY name`),
    queryAll<Option>(`SELECT id, name FROM brands ORDER BY name`),
    queryAll<{ k: number; v: number }>(
      `SELECT id AS k, department_id AS v FROM domains WHERE department_id IS NOT NULL
       UNION
       SELECT s.home_domain_id, sd.department_id
       FROM sops s JOIN sop_departments sd ON sd.sop_id = s.id
       WHERE s.home_domain_id IS NOT NULL`
    ),
    queryAll<{ k: number; v: number }>(
      `SELECT DISTINCT home_domain_id AS k, brand_id AS v FROM sops
       WHERE home_domain_id IS NOT NULL AND brand_id IS NOT NULL`
    ),
    queryAll<{ k: number; v: number }>(
      `SELECT ch.checklist_template_id AS k, c.framework_id AS v
       FROM checks ch JOIN controls c ON c.id = ch.control_id
       WHERE ch.checklist_template_id IS NOT NULL AND c.framework_id IS NOT NULL
       UNION
       SELECT ci.template_id, c.framework_id
       FROM check_checklist_items cci
       JOIN checklist_items ci ON ci.id = cci.checklist_item_id
       JOIN checks ch ON ch.id = cci.check_id
       JOIN controls c ON c.id = ch.control_id
       WHERE c.framework_id IS NOT NULL`
    ),
    queryAll<{ k: number; v: number }>(`SELECT id AS k, framework_id AS v FROM controls WHERE framework_id IS NOT NULL`),
  ]);

  const lin: Lineage = {
    domains,
    frameworks,
    departments,
    brands,
    domainDepts: new Map(),
    domainBrands: new Map(),
    frameworkDept: new Map(),
    templateFrameworks: new Map(),
    controlFramework: new Map(ctlFw.map((r) => [r.k, r.v])),
  };
  for (const r of domDept) add(lin.domainDepts, r.k, r.v);
  for (const r of domBrand) add(lin.domainBrands, r.k, r.v);
  for (const f of frameworks) if (f.department_id != null) lin.frameworkDept.set(f.id, f.department_id);
  for (const r of tplFw) add(lin.templateFrameworks, r.k, r.v);
  return lin;
}

export * from "./match";
