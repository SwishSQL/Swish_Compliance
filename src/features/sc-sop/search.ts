import type { ScRef, ScRegister, ScStep } from "./types";

/*
 * "Ask the SOP": a keyword search over the register, run on the server.
 * No AI and no external calls — every answer is a set of steps and
 * references that cite their own IDs.
 */

const STOP = new Set(
  "a an and are as at be by can do does for from how i in is it its of on or the this to what when where which who whom why will with should must after before about any there their they them we our you your step steps process".split(
    " "
  )
);

export function tokenize(q: string): string[] {
  return [
    ...new Set(
      q
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .map((w) => w.replace(/^-+|-+$/g, ""))
        .filter((w) => w.length > 1 && !STOP.has(w))
    ),
  ];
}

const STEP_WEIGHTS: [keyof ScStep, number][] = [
  ["tobe", 3],
  ["role", 3],
  ["dept", 2],
  ["phase", 2],
  ["asis", 2],
  ["erpReq", 2],
  ["refs", 2],
  ["sys", 1],
  ["asisActor", 1],
  ["asisSys", 1],
  ["gapDesc", 1],
  ["taskDesc", 1],
  ["openPoint", 1],
  ["input", 1],
  ["output", 1],
  ["pillars", 1],
];

function scoreText(text: string | undefined, words: string[], w: number): number {
  if (!text) return 0;
  const t = text.toLowerCase();
  let s = 0;
  for (const word of words) if (t.includes(word)) s += w;
  return s;
}

export type StepHit = { step: ScStep; score: number };
export type RefHit = { id: string; ref: ScRef; score: number };

export function searchRegister(
  reg: ScRegister,
  q: string,
  limits = { steps: 8, refs: 5 }
): { words: string[]; steps: StepHit[]; refs: RefHit[] } {
  const ids = new Set(q.toUpperCase().match(/\b(?:PA-\d{2}(?:-S\d{3})?|CTL-[A-Z0-9]+(?:-\d+)?|POL-[DR]\d+|K-[A-Z0-9]+(?:-\d+)?|RPT-[A-Z0-9]+|AM-\d+|DR-\d+)\b/g) ?? []);
  const words = tokenize(q).filter((w) => !ids.has(w.toUpperCase()));
  const procName = Object.fromEntries(reg.procs.map((p) => [p.id, p.name.toLowerCase()]));

  const steps: StepHit[] = [];
  for (const step of reg.steps) {
    let score = 0;
    if (ids.has(step.id)) score += 100;
    if (ids.has(step.pa)) score += 5;
    if (step.refs) for (const id of ids) if (step.refs.includes(id)) score += 20;
    for (const [k, w] of STEP_WEIGHTS) score += scoreText(step[k] as string | undefined, words, w);
    score += scoreText(procName[step.pa], words, 2);
    // Prefer steps that match more of the distinct words.
    const covered = words.filter((w) =>
      STEP_WEIGHTS.some(([k]) => String(step[k] ?? "").toLowerCase().includes(w))
    ).length;
    if (words.length > 1) score *= 1 + covered / words.length;
    if (score > 0) steps.push({ step, score });
  }
  steps.sort((a, b) => b.score - a.score);

  const refs: RefHit[] = [];
  for (const [id, ref] of Object.entries(reg.refs)) {
    let score = ids.has(id) ? 100 : 0;
    const text = Object.values(ref).join(" ");
    score += scoreText(text, words, 1);
    if (words.length > 1) {
      const covered = words.filter((w) => text.toLowerCase().includes(w)).length;
      if (covered < Math.ceil(words.length / 2) && !ids.has(id)) score = 0;
    }
    if (score > 0) refs.push({ id, ref, score });
  }
  refs.sort((a, b) => b.score - a.score);

  return { words, steps: steps.slice(0, limits.steps), refs: refs.slice(0, limits.refs) };
}

/** Filters for the Processes view. */
export function filterSteps(
  steps: ScStep[],
  f: { dept?: string; chg?: string; q?: string }
): ScStep[] {
  const words = f.q ? tokenize(f.q) : [];
  const idQ = f.q?.trim().toUpperCase();
  return steps.filter((s) => {
    if (f.dept && s.dept !== f.dept) return false;
    if (f.chg && s.change !== f.chg) return false;
    if (idQ && words.length) {
      if (s.id === idQ || s.id.endsWith("-" + idQ)) return true;
      const hay = Object.values(s).join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    }
    return true;
  });
}
