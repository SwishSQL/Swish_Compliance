import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { listAuditFindings } from "@/features/capa/repository";
import {
  CAPA_STATUS_LABEL,
  CAPA_STATUS_TONE,
  CAPA_UNASSIGNED_TONE,
  CAPA_UNASSIGNED_LABEL,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  type CapaStatus,
  type CapaSeverity,
  type AuditFinding,
} from "@/features/capa/types";
import { queryAll } from "@/lib/db";
import { getUserScope } from "@/lib/auth/access";
import AssignCapaModal from "@/features/capa/AssignCapaModal";
import AssignControlModal from "@/features/capa/AssignControlModal";
import { BulkSelectionProvider } from "@/features/capa/BulkSelection";
import FindingCheckbox from "@/features/capa/FindingCheckbox";
import BulkAssignBar from "@/features/capa/BulkAssignBar";

/**
 * Corrective Actions page — hierarchical view driven by the audit that
 * SURFACED each finding (per user spec):
 *
 *   Filters bar
 *   ├─ Audit #13 · Fire Safety · Head Office Ardiya · 60% · N open
 *   │   └─ Control · CTRL code · Control name
 *   │       └─ Test · TEST code · Test name
 *   │           └─ Failed Question 1 (question, answer, note, evidence)
 *   │              [Assign CAPA] or [Edit assignment]
 *   │           └─ Failed Question 2 …
 *   └─ Audit #14 …
 */
type SP = {
  audit_id?: string;
  status?: string;
  department_id?: string;
  brand_id?: string;
  severity?: string;
  assigned_to?: string;
  due_before?: string;
  location?: string;
};

export default async function CapaPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  // Access scoping: admin/compliance/BE see everything; everyone else
  // (incl. department managers) is scoped to their mapped department(s)
  // from the junction. Filtered in-memory to support multi-department.
  const scope = await getUserScope(user.id, user.role);

  const findingsAll = await listAuditFindings({
    audit_id: sp.audit_id ? Number(sp.audit_id) : undefined,
    department_id: sp.department_id ? Number(sp.department_id) : undefined,
    brand_id: sp.brand_id ? Number(sp.brand_id) : undefined,
    severity: (sp.severity as CapaSeverity) || undefined,
    status: (sp.status as CapaStatus | "unassigned") || undefined,
    assigned_to: sp.assigned_to ? Number(sp.assigned_to) : undefined,
    due_date_before: sp.due_before || undefined,
    location: sp.location || undefined,
  });
  const findings = scope.full
    ? findingsAll
    : findingsAll.filter(
        (f) =>
          f.audit_department_id != null &&
          scope.departmentIds.includes(f.audit_department_id)
      );
  const fullVisibility = scope.full;
  const scopedDepartmentId = fullVisibility ? undefined : -1; // hides dept filter dropdown

  // Lookup lists for the filters + modal
  const [brands, departments, assignableUsers, reviewers] = await Promise.all([
    queryAll<{ id: number; name: string }>(
      `SELECT id, name FROM brands WHERE is_active = 1 ORDER BY name`
    ),
    queryAll<{ id: number; name: string }>(
      `SELECT id, name FROM departments WHERE is_active = 1 ORDER BY name`
    ),
    queryAll<{ id: number; display_name: string; role: string }>(
      `SELECT id, display_name, role FROM users
       WHERE is_active = 1
       ORDER BY role, display_name`
    ),
    queryAll<{ id: number; display_name: string; role: string }>(
      `SELECT id, display_name, role FROM users
       WHERE is_active = 1
         AND role IN ('compliance','business_excellence','admin')
       ORDER BY role, display_name`
    ),
  ]);

  // Group findings: audit → control → test → items
  const audits = groupFindings(findings);

  const totalOpenCapas = findings.filter(
    (f) => f.capa_id && f.capa_status && f.capa_status !== "closed"
  ).length;
  const totalUnassigned = findings.filter(
    (f) => !f.capa_id || !f.capa_assigned_to
  ).length;

  return (
    <Workspace
      section="Assurance / Corrective Actions"
      subtitle={`${findings.length} failed findings · ${totalOpenCapas} open CAPAs · ${totalUnassigned} unassigned`}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* ── Filters ────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4">
        <form
          method="get"
          className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 text-xs"
        >
          {/* audit_id stays a supported query param for deep links from
              other pages (e.g. Roadmap's "Audit" link) — just no manual
              ID-entry box in the filter bar (user spec: no visible IDs). */}
          {sp.audit_id && <input type="hidden" name="audit_id" value={sp.audit_id} />}
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="px-2 py-1.5 border border-gray-300 rounded"
          >
            <option value="">All statuses</option>
            <option value="unassigned">Unassigned</option>
            {(Object.keys(CAPA_STATUS_LABEL) as CapaStatus[]).map((s) => (
              <option key={s} value={s}>
                {CAPA_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {!scopedDepartmentId && (
            <select
              name="department_id"
              defaultValue={sp.department_id ?? ""}
              className="px-2 py-1.5 border border-gray-300 rounded"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <select
            name="brand_id"
            defaultValue={sp.brand_id ?? ""}
            className="px-2 py-1.5 border border-gray-300 rounded"
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            name="location"
            defaultValue={sp.location ?? ""}
            placeholder="Location"
            className="px-2 py-1.5 border border-gray-300 rounded"
          />
          <select
            name="severity"
            defaultValue={sp.severity ?? ""}
            className="px-2 py-1.5 border border-gray-300 rounded"
          >
            <option value="">All severities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <select
            name="assigned_to"
            defaultValue={sp.assigned_to ?? ""}
            className="px-2 py-1.5 border border-gray-300 rounded"
          >
            <option value="">All assignees</option>
            {assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="due_before"
            defaultValue={sp.due_before ?? ""}
            placeholder="Due before"
            className="px-2 py-1.5 border border-gray-300 rounded"
          />
          <div className="col-span-2 md:col-span-4 lg:col-span-8 flex gap-2">
            <button className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-1.5 rounded text-xs">
              Filter
            </button>
            <Link
              href="/capa"
              className="px-4 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-50"
            >
              Reset
            </Link>
          </div>
        </form>
      </div>

      {/* ── Findings tree ─────────────────────────────────────── */}
      {audits.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center text-gray-400 text-sm">
          No failed audit findings match these filters.
        </div>
      )}
      <BulkSelectionProvider>
      <div className="space-y-4">
        {audits.map((audit) => {
          const scorePct =
            audit.audit_score != null ? Number(audit.audit_score) : null;
          const openHere = audit.controls
            .flatMap((c) => c.tests.flatMap((t) => t.items))
            .filter(
              (f) => f.capa_id && f.capa_status && f.capa_status !== "closed"
            ).length;
          return (
            // <details> is native browser collapse — no client JS needed.
            // Header sits in <summary>, everything below (controls, tests,
            // findings) is hidden until the user clicks. Empty findings are
            // implicit — you wouldn't be here without at least one fail.
            <details
              key={audit.audit_id}
              className="group bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
            >
              {/* Summary is the green audit header. Clicking it toggles
                  the whole block. A separate "Open audit →" chip lives
                  inside so the user can still jump to /audits/[id]
                  without expanding first. */}
              <summary className="cursor-pointer list-none px-5 py-3 border-b border-transparent group-open:border-gray-100 bg-gradient-to-r from-brand-50 to-white hover:from-brand-100">
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Rotating caret — HTML details toggle indicator */}
                  <span className="text-gray-400 transition-transform group-open:rotate-90 select-none">
                    ▶
                  </span>
                  {audit.framework_code && (
                    <span className="text-xs font-mono text-emerald-700">
                      {audit.framework_code}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-gray-900">
                    {audit.framework_name ?? "—"}
                  </span>
                  {audit.audit_brand_name && (
                    <span className="text-xs text-gray-600">
                      · {audit.audit_brand_name}
                    </span>
                  )}
                  {audit.audit_department_name && (
                    <span className="text-xs text-gray-600">
                      · {audit.audit_department_name}
                    </span>
                  )}
                  {audit.audit_location && (
                    <span className="text-xs text-gray-600">
                      · {audit.audit_location}
                    </span>
                  )}
                  {scorePct != null && (
                    <span
                      className={`ml-auto text-xs font-bold px-2 py-0.5 rounded ${
                        scorePct >= 90
                          ? "bg-emerald-100 text-emerald-800"
                          : scorePct >= 70
                          ? "bg-amber-100 text-amber-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      Score {scorePct}%
                    </span>
                  )}
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-medium">
                    {openHere} open CAPA{openHere === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <div className="text-[11px] text-gray-500">
                    {new Date(audit.audit_date).toLocaleDateString()}
                  </div>
                  {/* Second-level action — jumps to the audit page.
                      No stopPropagation() (Server Components can't pass
                      event handlers). Clicking will BOTH toggle the
                      details AND navigate; the navigation wins visually. */}
                  <Link
                    href={`/audits/${audit.audit_id}`}
                    className="text-[11px] text-brand-700 hover:underline ml-auto"
                  >
                    Open audit →
                  </Link>
                </div>
              </summary>

              {/* Controls */}
              <div className="divide-y divide-gray-100">
                {audit.controls.map((control) => {
                  const controlItems = control.tests.flatMap((t) => t.items);
                  const unassignedHere = controlItems.filter(
                    (f) => !f.capa_id || !f.capa_assigned_to
                  ).length;
                  return (
                  <div key={`${audit.audit_id}-c-${control.control_id ?? 0}`}>
                    <div className="px-5 py-2 bg-gray-50/60 flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                        Control
                      </span>
                      {control.control_code && (
                        <span className="font-mono text-xs text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                          {control.control_code}
                        </span>
                      )}
                      <span className="text-sm font-medium text-gray-800">
                        {control.control_name ?? "— No control linked —"}
                      </span>
                      <span className="ml-auto">
                        <AssignControlModal
                          control={{
                            auditId: audit.audit_id,
                            controlId: control.control_id,
                            controlCode: control.control_code,
                            controlName: control.control_name,
                            auditTitle: buildAuditTitle(audit),
                            unassignedCount: unassignedHere,
                            assignedCount:
                              controlItems.length - unassignedHere,
                          }}
                          assignableUsers={assignableUsers}
                          reviewers={reviewers}
                        />
                      </span>
                    </div>

                    {control.tests.map((test) => (
                      <div key={`t-${test.test_id ?? 0}`} className="pl-4">
                        <div className="px-5 py-2 flex items-center gap-2 bg-gray-50/30">
                          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                            Test
                          </span>
                          {test.test_code && (
                            <span className="font-mono text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                              {test.test_code}
                            </span>
                          )}
                          <span className="text-sm text-gray-800">
                            {test.test_name ?? "— No test —"}
                          </span>
                        </div>

                        <ul className="divide-y divide-gray-100">
                          {test.items.map((f, idx) => (
                            <FindingRow
                              key={`f-${f.item_id}`}
                              finding={f}
                              index={idx + 1}
                              auditTitle={buildAuditTitle(audit)}
                              assignableUsers={assignableUsers}
                              reviewers={reviewers}
                            />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
      <BulkAssignBar assignableUsers={assignableUsers} reviewers={reviewers} />
      </BulkSelectionProvider>
    </Workspace>
  );
}

/* ─── Grouping ──────────────────────────────────────────────── */

type TestGroup = {
  test_id: number | null;
  test_code: string | null;
  test_name: string | null;
  items: AuditFinding[];
};

type ControlGroup = {
  control_id: number | null;
  control_code: string | null;
  control_name: string | null;
  tests: TestGroup[];
};

type AuditGroup = {
  audit_id: number;
  audit_status: string;
  audit_score: string | null;
  audit_date: string;
  audit_brand_name: string | null;
  audit_department_id: number | null;
  audit_department_name: string | null;
  audit_location: string | null;
  framework_code: string | null;
  framework_name: string | null;
  controls: ControlGroup[];
};

function groupFindings(rows: AuditFinding[]): AuditGroup[] {
  const audits: AuditGroup[] = [];
  const auditIdx = new Map<number, number>();
  const controlIdx = new Map<string, number>();
  const testIdx = new Map<string, number>();

  for (const r of rows) {
    let ai = auditIdx.get(r.audit_id);
    if (ai === undefined) {
      ai = audits.length;
      auditIdx.set(r.audit_id, ai);
      audits.push({
        audit_id: r.audit_id,
        audit_status: r.audit_status,
        audit_score: r.audit_score,
        audit_date: r.audit_date,
        audit_brand_name: r.audit_brand_name,
        audit_department_id: r.audit_department_id,
        audit_department_name: r.audit_department_name,
        audit_location: r.audit_location,
        framework_code: r.framework_code,
        framework_name: r.framework_name,
        controls: [],
      });
    }
    const audit = audits[ai];

    const cKey = `${r.audit_id}-${r.control_id ?? "null"}`;
    let ci = controlIdx.get(cKey);
    if (ci === undefined) {
      ci = audit.controls.length;
      controlIdx.set(cKey, ci);
      audit.controls.push({
        control_id: r.control_id,
        control_code: r.control_code,
        control_name: r.control_name,
        tests: [],
      });
    }
    const control = audit.controls[ci];

    const tKey = `${cKey}-${r.test_id ?? "null"}`;
    let ti = testIdx.get(tKey);
    if (ti === undefined) {
      ti = control.tests.length;
      testIdx.set(tKey, ti);
      control.tests.push({
        test_id: r.test_id,
        test_code: r.test_code,
        test_name: r.test_name,
        items: [],
      });
    }
    control.tests[ti].items.push(r);
  }

  return audits;
}

function buildAuditTitle(audit: AuditGroup): string {
  const bits = [
    audit.framework_name ?? `Audit (${new Date(audit.audit_date).toLocaleDateString()})`,
    audit.audit_brand_name ?? "",
    audit.audit_department_name ?? "",
    audit.audit_location ?? "",
  ].filter(Boolean);
  return bits.join(" · ");
}

/* ─── Single finding row ───────────────────────────────────── */

function FindingRow({
  finding,
  index,
  auditTitle,
  assignableUsers,
  reviewers,
}: {
  finding: AuditFinding;
  index: number;
  auditTitle: string;
  assignableUsers: { id: number; display_name: string; role: string }[];
  reviewers: { id: number; display_name: string; role: string }[];
}) {
  const proposedCode =
    finding.capa_code ??
    `CAPA-AUD${finding.audit_id}-${String(index).padStart(3, "0")}`;

  return (
    <li className="px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <FindingCheckbox
          finding={{
            itemId: finding.item_id,
            auditId: finding.audit_id,
            question: finding.question,
          }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
            Finding #{index}
            <span
              className="ml-2 inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-800 rounded"
              title={`Yes ${finding.yes_percent}% · No ${finding.no_percent}% · N/A ${finding.na_percent}%`}
            >
              {finding.performance_percent}% achieved
            </span>
            {finding.na_percent > 0 && (
              <span className="ml-2 text-[10px] text-gray-400">
                ({finding.na_percent}% N/A excluded)
              </span>
            )}
            {finding.is_critical && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 rounded">
                CRITICAL
              </span>
            )}
          </div>
          <div className="text-sm font-medium text-gray-900 mb-2">
            {finding.question}
          </div>
          {finding.auditor_note && (
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
                Auditor note
              </div>
              <div className="text-xs text-gray-700 italic">
                &ldquo;{finding.auditor_note}&rdquo;
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 text-xs flex-wrap">
            {finding.evidence_url && (
              <a
                href={finding.evidence_url}
                target="_blank"
                rel="noreferrer"
                download={finding.evidence_name ?? undefined}
                className="text-brand-700 hover:underline inline-flex items-center gap-1"
              >
                📎 {finding.evidence_name ?? "View evidence"}
              </a>
            )}
            <span className="font-mono text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
              {proposedCode}
            </span>
            {finding.capa_status ? (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${CAPA_STATUS_TONE[finding.capa_status]}`}
              >
                {CAPA_STATUS_LABEL[finding.capa_status]}
              </span>
            ) : (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${CAPA_UNASSIGNED_TONE}`}>
                {CAPA_UNASSIGNED_LABEL}
              </span>
            )}
            {finding.capa_severity && (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${SEVERITY_TONE[finding.capa_severity]}`}
              >
                {SEVERITY_LABEL[finding.capa_severity]}
              </span>
            )}
            {finding.capa_assigned_to_name && (
              <span className="text-[11px] text-gray-600">
                → {finding.capa_assigned_to_name}
              </span>
            )}
            {finding.capa_due_date && (
              <span className="text-[11px] text-gray-500">
                due {new Date(finding.capa_due_date).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex flex-col gap-1 items-end">
          <AssignCapaModal
            finding={{
              auditId: finding.audit_id,
              itemId: finding.item_id,
              auditTitle,
              question: finding.question,
              auditorNote: finding.auditor_note,
              proposedCode,
              brandId: null,
              departmentId: finding.audit_department_id,
              initialSeverity: finding.capa_severity,
              initialAssignedTo: finding.capa_assigned_to,
              initialDueDate: finding.capa_due_date,
            }}
            assignableUsers={assignableUsers}
            reviewers={reviewers}
          />
          {finding.capa_id && (
            <Link
              href={`/capa/${finding.capa_id}`}
              className="text-[10px] text-gray-500 hover:text-brand-700"
            >
              Open CAPA →
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
