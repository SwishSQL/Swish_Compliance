import "server-only";
import { queryAll } from "@/lib/db";

/**
 * SOP-first audit scoping.
 *
 * The auditor never hand-picks controls, tests or checklists. They choose
 * a Policy (SOP), a scope type, and — depending on the type — a domain or
 * framework. Everything below that point is loaded automatically:
 *
 *     SOP → Scope Type → (Domain) → (Framework) → Controls → Tests
 *         → Checklists → Questions
 *
 * `resolveScope()` is the single source of truth for that walk. The
 * client-side preview renders an estimate from `loadScopeGraph()`, but the
 * create action always re-resolves here — a tampered form can therefore
 * never widen an audit beyond what its scope genuinely covers.
 */

export type ScopeType = "full_sop" | "framework" | "domain";

export const SCOPE_TYPES: ScopeType[] = ["full_sop", "framework", "domain"];

export function isScopeType(v: unknown): v is ScopeType {
  return typeof v === "string" && (SCOPE_TYPES as string[]).includes(v);
}

export type ScopeGraphDomain = {
  id: number;
  code: string;
  name: string;
  sop_id: number | null;
  department_id: number | null;
};

export type ScopeGraphFramework = {
  id: number;
  code: string;
  name: string;
  domain_id: number | null;
  sop_id: number | null;
  department_id: number | null;
};

export type ScopeGraphControl = {
  id: number;
  code: string | null;
  name: string;
  framework_id: number | null;
};

export type ScopeGraphTest = {
  id: number;
  code: string | null;
  name: string;
  control_id: number | null;
  /** Distinct checklist templates this test pulls questions from. */
  template_ids: number[];
  /** How many checklist questions this test contributes. */
  question_count: number;
};

export type ScopeGraph = {
  domains: ScopeGraphDomain[];
  frameworks: ScopeGraphFramework[];
  controls: ScopeGraphControl[];
  tests: ScopeGraphTest[];
};

/**
 * The whole compliance graph, small enough (low thousands of rows at the
 * outside) to ship to the client once and filter in memory. That keeps the
 * scope preview instant instead of firing a round-trip on every dropdown
 * change.
 */
export async function loadScopeGraph(): Promise<ScopeGraph> {
  const [domains, frameworks, controls, tests] = await Promise.all([
    queryAll<ScopeGraphDomain>(
      `SELECT id, code, name, sop_id, department_id
       FROM domains WHERE is_active
       ORDER BY sort_order, name`
    ),
    queryAll<ScopeGraphFramework>(
      `SELECT id, code, name, domain_id, sop_id, department_id
       FROM frameworks WHERE is_active
       ORDER BY code, name`
    ),
    queryAll<ScopeGraphControl>(
      `SELECT id, code, name, framework_id
       FROM controls WHERE is_active
       ORDER BY code NULLS LAST, name
       LIMIT 2000`
    ),
    queryAll<ScopeGraphTest>(
      `SELECT ch.id, ch.code, ch.name, ch.control_id,
              COALESCE(
                ARRAY_AGG(DISTINCT i.template_id) FILTER (WHERE i.template_id IS NOT NULL),
                '{}'
              ) AS template_ids,
              COUNT(i.id)::int AS question_count
       FROM checks ch
       LEFT JOIN check_checklist_items cci ON cci.check_id = ch.id
       LEFT JOIN checklist_items i ON i.id = cci.checklist_item_id
       WHERE ch.is_active
       GROUP BY ch.id
       ORDER BY ch.code NULLS LAST, ch.name
       LIMIT 3000`
    ),
  ]);
  return { domains, frameworks, controls, tests };
}

export type ResolveScopeInput = {
  /** One SOP for Framework/Domain scoping; several for a Full SOP Audit
   *  that covers all of them at once (migration 055). */
  sopIds: number[];
  departmentId: number;
  scopeType: ScopeType;
  domainId?: number | null;
  frameworkId?: number | null;
};

export type ResolvedScope = {
  frameworkIds: number[];
  controls: { id: number; code: string | null; name: string }[];
  tests: { id: number; code: string | null; name: string }[];
  templateIds: number[];
  questionCount: number;
};

/**
 * Resolve a scope selection down to the concrete rows an audit covers.
 *
 * The department filter is the reason this is not a plain "everything under
 * the SOP" walk: one SOP can span several departments (CC-SOP-003 has both
 * a Customer Care and a Complaints Operations branch) and each department
 * is audited separately. A domain/framework qualifies when its OWN
 * department matches, falling back to its parent domain's when the
 * framework doesn't carry one.
 *
 * Framework and Domain audits narrow to exactly one SOP — picking several
 * only makes sense as "audit everything", i.e. a Full SOP Audit run across
 * all of them at once (migration 055), so that's the only mode that
 * accepts more than one sopId.
 */
export async function resolveScope(
  input: ResolveScopeInput
): Promise<ResolvedScope> {
  const { sopIds, departmentId, scopeType } = input;

  if (sopIds.length === 0) {
    throw new Error("Pick at least one Policy / SOP.");
  }
  if (scopeType !== "full_sop" && sopIds.length > 1) {
    throw new Error(
      "Framework and Domain audits can only scope to a single Policy / SOP — " +
        "pick Full SOP Audit to cover several at once."
    );
  }

  let frameworkRows: { id: number }[] = [];

  if (scopeType === "framework") {
    if (!input.frameworkId) {
      throw new Error("Pick a framework for a Framework Audit.");
    }
    // Verify the framework really sits under this SOP + department before
    // trusting the id that came off the form.
    frameworkRows = await queryAll<{ id: number }>(
      `SELECT f.id
       FROM frameworks f
       LEFT JOIN domains d ON d.id = f.domain_id
       WHERE f.id = $1
         AND f.is_active
         AND COALESCE(f.sop_id, d.sop_id) = $2
         AND COALESCE(f.department_id, d.department_id) = $3`,
      [input.frameworkId, sopIds[0], departmentId]
    );
    if (frameworkRows.length === 0) {
      throw new Error(
        "That framework doesn't belong to the selected policy and department."
      );
    }
  } else if (scopeType === "domain") {
    if (!input.domainId) {
      throw new Error("Pick a domain for a Domain Audit.");
    }
    frameworkRows = await queryAll<{ id: number }>(
      `SELECT f.id
       FROM frameworks f
       JOIN domains d ON d.id = f.domain_id
       WHERE d.id = $1
         AND f.is_active
         AND d.sop_id = $2
         AND d.department_id = $3`,
      [input.domainId, sopIds[0], departmentId]
    );
  } else {
    // full_sop — every framework under every domain of ANY of the chosen
    // SOPs that belongs to the audited department. One SOP or several,
    // the same union query covers both.
    frameworkRows = await queryAll<{ id: number }>(
      `SELECT DISTINCT f.id
       FROM frameworks f
       LEFT JOIN domains d ON d.id = f.domain_id
       WHERE f.is_active
         AND COALESCE(f.sop_id, d.sop_id) = ANY($1::int[])
         AND COALESCE(f.department_id, d.department_id) = $2`,
      [sopIds, departmentId]
    );
  }

  const frameworkIds = frameworkRows.map((r) => r.id);
  if (frameworkIds.length === 0) {
    return {
      frameworkIds: [],
      controls: [],
      tests: [],
      templateIds: [],
      questionCount: 0,
    };
  }

  const controls = await queryAll<{
    id: number;
    code: string | null;
    name: string;
  }>(
    `SELECT id, code, name FROM controls
     WHERE is_active AND framework_id = ANY($1::int[])
     ORDER BY code NULLS LAST, name`,
    [frameworkIds]
  );
  if (controls.length === 0) {
    return { frameworkIds, controls: [], tests: [], templateIds: [], questionCount: 0 };
  }

  const controlIds = controls.map((c) => c.id);
  const tests = await queryAll<{
    id: number;
    code: string | null;
    name: string;
  }>(
    `SELECT id, code, name FROM checks
     WHERE is_active AND control_id = ANY($1::int[])
     ORDER BY code NULLS LAST, name`,
    [controlIds]
  );
  if (tests.length === 0) {
    return { frameworkIds, controls, tests: [], templateIds: [], questionCount: 0 };
  }

  const testIds = tests.map((t) => t.id);
  const items = await queryAll<{ template_id: number; question_count: number }>(
    `SELECT i.template_id, COUNT(DISTINCT i.id)::int AS question_count
     FROM check_checklist_items cci
     JOIN checklist_items i ON i.id = cci.checklist_item_id
     WHERE cci.check_id = ANY($1::int[])
     GROUP BY i.template_id`,
    [testIds]
  );

  return {
    frameworkIds,
    controls,
    tests,
    templateIds: items.map((i) => i.template_id),
    questionCount: items.reduce((sum, i) => sum + i.question_count, 0),
  };
}
