import Link from "next/link";
import type { ReactNode } from "react";
import { CHANGE_TONE, FIT_TONE, type ScRef, type ScStep } from "./types";

/* Shared, server-rendered building blocks for the SC SOP review pages. */

export function ScTabs({ active, feedbackCount }: { active: string; feedbackCount?: number }) {
  const tabs = [
    { key: "overview", href: "/sc-sop", label: "Overview" },
    { key: "processes", href: "/sc-sop/processes", label: "Processes" },
    { key: "ask", href: "/sc-sop/ask", label: "Ask the SOP" },
    { key: "feedback", href: "/sc-sop/feedback", label: "Feedback" },
  ];
  return (
    <nav className="flex flex-wrap gap-1 mb-5 border-b border-gray-200" aria-label="Supply Chain SOP views">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
            active === t.key
              ? "border-brand-700 text-brand-700"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          {t.label}
          {t.key === "feedback" && feedbackCount ? (
            <span className="ml-1.5 inline-flex min-w-5 justify-center rounded-full bg-brand-700 px-1.5 text-[11px] text-white">
              {feedbackCount}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

export function Pill({ tone, children }: { tone?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${
        tone ?? "bg-gray-100 text-gray-700 border-gray-200"
      }`}
    >
      {children}
    </span>
  );
}

export const stepHref = (id: string) => {
  const pa = id.slice(0, 5);
  return id.length > 5 ? `/sc-sop/processes?pa=${pa}#${id}` : `/sc-sop/processes?pa=${pa}`;
};

const REF_LABELS: Record<string, string> = {
  risk: "Risk",
  text: "Text",
  type: "Type",
  steps: "Steps",
  scope: "Scope",
  owner: "Owner",
  source: "Source",
  q: "Question",
  proc: "Process",
  name: "Name",
  how: "How measured",
  target: "Target",
  at: "Produced at",
  used: "Used at",
  freq: "Frequency",
  within: "Within limit",
  level: "Level",
  above: "Above limit",
  step: "Step",
  confirm: "Confirm with",
  tobe: "To-be",
  status: "Status",
};

export function RefDetail({ id, r }: { id: string; r: ScRef }) {
  return (
    <div className="text-xs space-y-1">
      <div className="font-semibold text-gray-900">
        {r.t} · <span className="font-mono">{id}</span>
      </div>
      {Object.entries(r)
        .filter(([k, v]) => k !== "t" && v)
        .map(([k, v]) => (
          <div key={k}>
            <span className="text-gray-500">{REF_LABELS[k] ?? k}: </span>
            <span className="text-gray-800 whitespace-pre-line">{v}</span>
          </div>
        ))}
    </div>
  );
}

export function RefChip({ id, r }: { id: string; r: ScRef }) {
  return (
    <details className="relative inline-block align-baseline group">
      <summary className="list-none cursor-pointer inline font-mono text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 hover:bg-indigo-100">
        {id}
      </summary>
      <div className="absolute z-30 left-0 mt-1 w-80 max-w-[80vw] rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
        <RefDetail id={id} r={r} />
      </div>
    </details>
  );
}

const TOKEN_RX =
  /\b(PA-\d{2}-S\d{3}|CTL-[A-Z0-9]+(?:-\d+)?|POL-[DR]\d+|K-[A-Z0-9]+(?:-\d+)?|RPT-[A-Z0-9]+|AM-\d+|DR-\d+)\b|(?<=^|[\s(;,/])(S\d{3})(?=[\s).,;/–-]|$)/g;

/** Text with Step IDs turned into links and references into detail chips. */
export function Linked({
  text,
  refs,
  stepIds,
  ctxPa,
}: {
  text?: string | null;
  refs: Record<string, ScRef>;
  stepIds: Set<string>;
  ctxPa?: string;
}) {
  if (!text) return null;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RX)) {
    const tok = m[1] ?? m[2];
    const at = m.index!;
    const full = m[2] && ctxPa ? `${ctxPa}-${m[2]}` : tok;
    let node: ReactNode = null;
    if (stepIds.has(full)) {
      node = (
        <Link key={at} href={stepHref(full)} className="font-mono text-[0.92em] text-brand-700 hover:underline">
          {tok}
        </Link>
      );
    } else if (refs[tok]) {
      node = <RefChip key={at} id={tok} r={refs[tok]} />;
    }
    if (node) {
      out.push(text.slice(last, at), node);
      last = at + m[0].length;
    }
  }
  out.push(text.slice(last));
  return <span className="whitespace-pre-line">{out}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-[13px] text-gray-800">{children}</div>
    </div>
  );
}

export function StepCard({
  s,
  refs,
  stepIds,
  feedbackCount,
  showProcess,
  processName,
}: {
  s: ScStep;
  refs: Record<string, ScRef>;
  stepIds: Set<string>;
  feedbackCount?: number;
  showProcess?: boolean;
  processName?: string;
}) {
  const L = (t?: string) => <Linked text={t} refs={refs} stepIds={stepIds} ctxPa={s.pa} />;
  return (
    <article id={s.id} className="scroll-mt-24 bg-white rounded-2xl border border-gray-200 shadow-sm">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
        <span className="font-mono text-sm font-semibold text-gray-900">{s.id}</span>
        {showProcess && processName && (
          <Link href={stepHref(s.pa)} className="text-xs text-brand-700 hover:underline">
            {s.pa} · {processName}
          </Link>
        )}
        <span className="text-xs text-gray-500">{s.phase}</span>
        {s.stype && <Pill>{s.stype}</Pill>}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <Pill tone={CHANGE_TONE[s.change]}>{s.change}</Pill>
          {s.fit && <Pill tone={FIT_TONE[s.fit]}>ERP: {s.fit}</Pill>}
          {s.moscow && <Pill>{s.moscow}</Pill>}
        </span>
      </header>
      <div className="grid md:grid-cols-2 gap-0 md:divide-x divide-gray-100">
        <section className="p-4 space-y-2 bg-gray-50/60 rounded-bl-2xl">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">As-is 2026</div>
          <div className="text-[13px] text-gray-800">{L(s.asis) ?? <span className="text-gray-400">— (new step)</span>}</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Who">{s.asisActor}</Field>
            <Field label="System">{s.asisSys}</Field>
          </div>
          {s.gapFlag && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              <b>{s.gapFlag}:</b> {L(s.gapDesc)}
            </div>
          )}
        </section>
        <section className="p-4 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">To-be 2027</div>
          <div className="text-[13px] text-gray-900">{L(s.tobe)}</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Department / role">{[s.dept, s.role].filter(Boolean).join(" · ")}</Field>
            <Field label="System">{s.sys}</Field>
            <Field label="Input">{L(s.input)}</Field>
            <Field label="Output">{L(s.output)}</Field>
            <Field label="Controls & policies">{L(s.refs)}</Field>
            <Field label="Pillars">{s.pillars}</Field>
          </div>
          {(s.erpReq || s.ricefw || s.solType) && (
            <div className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] space-y-0.5">
              {s.erpReq && (
                <div>
                  <span className="text-gray-500">ERP requirement: </span>
                  {L(s.erpReq)}
                </div>
              )}
              <div className="text-gray-500">
                {[s.ricefw && `RICEFW: ${s.ricefw}`, s.solType && `Solution: ${s.solType}`, s.taskId && `Task ${s.taskId}`]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          )}
        </section>
      </div>
      <footer className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-t border-gray-100 text-xs text-gray-500">
        {s.evId && (
          <details className="max-w-full">
            <summary className="cursor-pointer hover:text-gray-800">Evidence {s.evId}</summary>
            <blockquote className="mt-1 border-l-2 border-gray-300 pl-2 italic text-gray-700">{s.evQuote}</blockquote>
          </details>
        )}
        {s.openPoint && (
          <span className="text-amber-800">
            Open point: {L(s.openPoint)}
            {s.confirmWith ? ` (confirm with ${s.confirmWith})` : ""}
          </span>
        )}
        <span className="ml-auto flex items-center gap-3">
          {s.prev && stepIds.has(s.prev) && (
            <Link href={stepHref(s.prev)} className="hover:text-gray-800">← {s.prev.slice(-4)}</Link>
          )}
          {s.next && stepIds.has(s.next) && (
            <Link href={stepHref(s.next)} className="hover:text-gray-800">{s.next.slice(-4)} →</Link>
          )}
          <Link
            href={`/sc-sop/feedback?step=${s.id}`}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 font-medium text-white hover:bg-brand-800"
          >
            Comment{feedbackCount ? ` (${feedbackCount})` : ""}
          </Link>
        </span>
      </footer>
    </article>
  );
}
