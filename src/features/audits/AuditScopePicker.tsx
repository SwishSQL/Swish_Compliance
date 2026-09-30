"use client";

import { useMemo, useState } from "react";
import MultiSelect from "@/features/admin/users/MultiSelect";
import type {
  ScopeGraph,
  ScopeGraphFramework,
  ScopeType,
} from "./scope";

type Policy = {
  id: number;
  code: string | null;
  title: string;
  department_id: number | null;
};

const SCOPE_TYPE_LABEL: Record<ScopeType, string> = {
  full_sop: "Full SOP Audit",
  framework: "Framework Audit",
  domain: "Domain Audit",
};

const SCOPE_TYPE_HINT: Record<ScopeType, string> = {
  full_sop:
    "Audits the entire SOP for the selected department — every domain, framework, control and test under it.",
  framework:
    "Audits a single framework inside the SOP. This is the usual choice.",
  domain:
    "Audits every framework under one domain. Broad — prefer a Framework Audit unless you really need the whole domain.",
};

/**
 * SOP-first scope picker.
 *
 * The auditor picks one or more Policies first (migration 055 — several
 * SOPs can be audited together as one Full SOP Audit covering the whole
 * department, instead of one audit per SOP). Framework/Domain scoping
 * only makes sense against a single SOP, so those pickers — and the
 * Scope Type choice itself — only appear once exactly one is selected;
 * picking more forces a combined Full SOP Audit across all of them.
 *
 * Controls, tests, checklists and questions are never selected by hand —
 * they are derived, and the server re-derives them on submit so this
 * preview can only ever be informational.
 */
export default function AuditScopePicker({
  policies,
  graph,
  departmentId,
}: {
  policies: Policy[];
  graph: ScopeGraph;
  /** The audited department, owned by the parent form. Scoping is always
   *  department-limited: one SOP can span several departments and each is
   *  audited separately. */
  departmentId: string;
}) {
  const [sopIds, setSopIds] = useState<number[]>([]);
  const [scopeType, setScopeType] = useState<ScopeType>("framework");
  const [domainId, setDomainId] = useState("");
  const [frameworkId, setFrameworkId] = useState("");

  const deptNum = Number(departmentId) || null;
  const singleSop = sopIds.length === 1 ? sopIds[0] : null;
  // Several SOPs only makes sense as "audit everything under them" — the
  // Framework/Domain narrowing below is retired the moment a second SOP
  // joins the selection.
  const effectiveScopeType: ScopeType = sopIds.length > 1 ? "full_sop" : scopeType;

  // Only offer policies that actually have auditable content for this
  // department. Deliberately NOT filtered on sops.department_id: a SOP is
  // filed under its owning department but can govern domains elsewhere —
  // CC-SOP-004 is owned by Customer Care yet its refund domain belongs to
  // Complaints Operations, and that pairing is a legitimate audit.
  const availablePolicies = useMemo(() => {
    if (!deptNum) return [];
    const sopIdsWithContent = new Set(
      graph.domains
        .filter((d) => d.department_id === deptNum && d.sop_id != null)
        .map((d) => d.sop_id as number)
    );
    for (const f of graph.frameworks) {
      if (f.department_id === deptNum && f.sop_id != null) {
        sopIdsWithContent.add(f.sop_id);
      }
    }
    return policies.filter((p) => sopIdsWithContent.has(p.id));
  }, [policies, graph.domains, graph.frameworks, deptNum]);

  // Domains belonging to the single selected SOP *and* the audited
  // department. Only meaningful in the single-SOP case.
  const availableDomains = useMemo(() => {
    if (!singleSop || !deptNum) return [];
    return graph.domains.filter(
      (d) => d.sop_id === singleSop && d.department_id === deptNum
    );
  }, [graph.domains, singleSop, deptNum]);

  // A framework qualifies through its own SOP/department, or inherits them
  // from its parent domain — mirrors the COALESCE in resolveScope().
  const domainById = useMemo(
    () => new Map(graph.domains.map((d) => [d.id, d])),
    [graph.domains]
  );
  const sopOf = (f: ScopeGraphFramework): number | null => {
    const parent = f.domain_id != null ? domainById.get(f.domain_id) : undefined;
    return f.sop_id ?? parent?.sop_id ?? null;
  };
  const deptOf = (f: ScopeGraphFramework): number | null => {
    const parent = f.domain_id != null ? domainById.get(f.domain_id) : undefined;
    return f.department_id ?? parent?.department_id ?? null;
  };

  const frameworkMatchesSingle = useMemo(() => {
    return (f: ScopeGraphFramework) => sopOf(f) === singleSop && deptOf(f) === deptNum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainById, singleSop, deptNum]);

  const availableFrameworks = useMemo(() => {
    if (!singleSop || !deptNum) return [];
    const inScope = graph.frameworks.filter(frameworkMatchesSingle);
    // In domain mode the framework list narrows to the chosen domain.
    if (scopeType === "domain" && domainId) {
      return inScope.filter((f) => String(f.domain_id) === domainId);
    }
    return inScope;
  }, [graph.frameworks, frameworkMatchesSingle, singleSop, deptNum, scopeType, domainId]);

  // The domain shown alongside a chosen framework — read-only context, so
  // the auditor can see where the framework sits without picking it twice.
  const derivedDomain = useMemo(() => {
    if (!singleSop) return null;
    if (scopeType === "domain") {
      return graph.domains.find((d) => String(d.id) === domainId) ?? null;
    }
    if (scopeType === "framework" && frameworkId) {
      const f = graph.frameworks.find((x) => String(x.id) === frameworkId);
      if (!f?.domain_id) return null;
      return graph.domains.find((d) => d.id === f.domain_id) ?? null;
    }
    return null;
  }, [singleSop, scopeType, domainId, frameworkId, graph.domains, graph.frameworks]);

  // ── Live preview — the same walk resolveScope() does, in memory ────────
  const preview = useMemo(() => {
    let frameworks: ScopeGraphFramework[] = [];
    if (sopIds.length === 0 || !deptNum) {
      frameworks = [];
    } else if (sopIds.length > 1) {
      // Full SOP Audit across every selected SOP, unioned.
      const sopSet = new Set(sopIds);
      frameworks = graph.frameworks.filter(
        (f) => deptOf(f) === deptNum && sopOf(f) != null && sopSet.has(sopOf(f)!)
      );
    } else if (scopeType === "framework") {
      frameworks = frameworkId
        ? graph.frameworks.filter((f) => String(f.id) === frameworkId)
        : [];
    } else if (scopeType === "domain") {
      frameworks = domainId
        ? graph.frameworks.filter(
            (f) => String(f.domain_id) === domainId && frameworkMatchesSingle(f)
          )
        : [];
    } else {
      frameworks = graph.frameworks.filter(frameworkMatchesSingle);
    }

    const fwIds = new Set(frameworks.map((f) => f.id));
    const controls = graph.controls.filter(
      (c) => c.framework_id != null && fwIds.has(c.framework_id)
    );
    const controlIds = new Set(controls.map((c) => c.id));
    const tests = graph.tests.filter(
      (t) => t.control_id != null && controlIds.has(t.control_id)
    );
    const templateIds = new Set(tests.flatMap((t) => t.template_ids));
    const questions = tests.reduce((sum, t) => sum + t.question_count, 0);

    return {
      ready: frameworks.length > 0,
      controls,
      tests,
      checklists: templateIds.size,
      questions,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    graph, sopIds, deptNum, scopeType, domainId, frameworkId, frameworkMatchesSingle,
  ]);

  const needsDomain = effectiveScopeType === "domain";
  const needsFramework = effectiveScopeType === "framework";
  const blocked = sopIds.length === 0 || !departmentId;
  const multiSop = sopIds.length > 1;

  const selectClass =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400";

  return (
    <div className="space-y-4">
      {/* Hidden inputs carry the resolved scope to the server action. The
          server re-resolves from these, so they are inputs to a lookup —
          not a list of rows the client gets to choose. sop_ids itself is
          submitted by MultiSelect below, not here. */}
      <input type="hidden" name="scope_type" value={effectiveScopeType} />
      <input type="hidden" name="domain_id" value={multiSop ? "" : derivedDomain?.id ?? ""} />
      <input
        type="hidden"
        name="framework_id"
        value={!multiSop && needsFramework ? frameworkId : ""}
      />

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          Policy / SOP <span className="text-red-500">*</span>
        </label>
        {!departmentId ? (
          <div className={`${selectClass} bg-gray-50 text-gray-400`}>
            — Pick the audited department first —
          </div>
        ) : availablePolicies.length === 0 ? (
          <div className={`${selectClass} bg-gray-50 text-gray-400`}>
            — No policies mapped to this department yet —
          </div>
        ) : (
          <MultiSelect
            name="sop_ids"
            label=""
            options={availablePolicies.map((p) => ({ id: p.id, name: p.title }))}
            defaultSelected={[]}
            placeholder="Select one or more policies…"
            onChange={(ids) => {
              setSopIds(ids);
              setDomainId("");
              setFrameworkId("");
            }}
          />
        )}
        <p className="text-[11px] text-gray-400 mt-1">
          {multiSop
            ? `${sopIds.length} policies selected — this becomes one Full SOP Audit covering all of them.`
            : "Pick several to audit them together as one Full SOP Audit instead of one audit per policy."}
        </p>
      </div>

      {!multiSop && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Scope type — only meaningful for a single SOP */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Scope Type <span className="text-red-500">*</span>
            </label>
            <select
              value={scopeType}
              onChange={(e) => {
                setScopeType(e.target.value as ScopeType);
                setDomainId("");
                setFrameworkId("");
              }}
              disabled={blocked}
              className={selectClass}
            >
              <option value="full_sop">{SCOPE_TYPE_LABEL.full_sop}</option>
              <option value="framework">{SCOPE_TYPE_LABEL.framework}</option>
              <option value="domain">{SCOPE_TYPE_LABEL.domain}</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              {SCOPE_TYPE_HINT[scopeType]}
            </p>
          </div>

          {/* Domain — a real picker in domain mode, read-only context
              otherwise so the auditor still sees where they are. */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Domain{" "}
              {needsDomain ? (
                <span className="text-red-500">*</span>
              ) : (
                <span className="text-gray-400 font-normal">(if applicable)</span>
              )}
            </label>
            {needsDomain ? (
              <select
                value={domainId}
                onChange={(e) => {
                  setDomainId(e.target.value);
                  setFrameworkId("");
                }}
                disabled={blocked}
                required
                className={selectClass}
              >
                <option value="">
                  {availableDomains.length === 0
                    ? "— No domains for this policy + department —"
                    : "— Choose a domain —"}
                </option>
                {availableDomains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-sm text-gray-500 truncate">
                {derivedDomain
                  ? derivedDomain.name
                  : scopeType === "full_sop"
                  ? `All domains (${availableDomains.length})`
                  : "—"}
              </div>
            )}
          </div>

          {/* Framework */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Framework{" "}
              {needsFramework ? (
                <span className="text-red-500">*</span>
              ) : (
                <span className="text-gray-400 font-normal">
                  (if Framework Audit)
                </span>
              )}
            </label>
            <select
              value={frameworkId}
              onChange={(e) => setFrameworkId(e.target.value)}
              disabled={blocked || !needsFramework}
              required={needsFramework}
              className={selectClass}
            >
              <option value="">
                {!needsFramework
                  ? "— Loaded automatically —"
                  : availableFrameworks.length === 0
                  ? "— No frameworks for this policy + department —"
                  : "— Choose a framework —"}
              </option>
              {availableFrameworks.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* ── Scope preview ──────────────────────────────────────────────── */}
      <div className="border border-blue-200 bg-blue-50/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <svg
            className="w-4 h-4 text-blue-500 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" d="M12 11v5M12 8h.01" />
          </svg>
          <span className="text-xs font-semibold text-gray-700">
            Scope preview
          </span>
        </div>

        <p className="text-[11px] text-gray-500 mb-3">
          The system automatically includes the following based on your scope
          selection.
        </p>

        <div className="grid grid-cols-4 gap-2 text-center">
          {(
            [
              ["Controls", preview.controls.length],
              ["Tests", preview.tests.length],
              ["Checklists", preview.checklists],
              ["Questions", preview.questions],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-white rounded-lg py-2.5 border border-blue-100">
              <div className="text-[11px] text-gray-500">{label}</div>
              <div className="text-lg font-semibold text-gray-900 tabular-nums">
                {preview.ready ? value : "—"}
              </div>
            </div>
          ))}
        </div>

        {preview.ready ? (
          <div className="mt-3 bg-white rounded-lg border border-blue-100 divide-y divide-gray-100">
            <div className="px-3 py-2.5">
              <div className="text-[11px] font-semibold text-gray-500 mb-1.5">
                Included Control(s)
              </div>
              {preview.controls.length === 0 ? (
                <div className="text-[11px] text-amber-700">
                  No controls sit under this scope yet.
                </div>
              ) : (
                <ul className="space-y-1">
                  {preview.controls.map((c) => (
                    <li key={c.id} className="text-xs text-gray-700 flex gap-2">
                      <span className="text-green-600" aria-hidden="true">✓</span>
                      <span>{c.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-3 py-2.5">
              <div className="text-[11px] font-semibold text-gray-500 mb-1.5">
                Included Test(s)
              </div>
              {preview.tests.length === 0 ? (
                <div className="text-[11px] text-amber-700">
                  No tests are linked to these controls yet — the audit would
                  have nothing to answer.
                </div>
              ) : (
                <ul className="space-y-1">
                  {preview.tests.map((t) => (
                    <li key={t.id} className="text-xs text-gray-700 flex gap-2">
                      <span className="text-green-600" aria-hidden="true">✓</span>
                      <span>{t.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-gray-400">
            {blocked
              ? "Pick the audited department and at least one policy to see what this audit will cover."
              : needsFramework
              ? "Pick a framework to see what this audit will cover."
              : needsDomain
              ? "Pick a domain to see what this audit will cover."
              : "Nothing is mapped to this policy for the selected department yet."}
          </p>
        )}
      </div>
    </div>
  );
}
