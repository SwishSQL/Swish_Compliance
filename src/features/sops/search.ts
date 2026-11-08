/*
 * "Ask the SOPs": keyword search over the template sections of every SOP
 * the user can see. No AI and no external calls — each answer is a list of
 * SOP sections, with the passage that matched.
 */

const STOP = new Set(
  "a an and are as at be by can do does for from how i in is it its of on or the this to what when where which who whom why will with should must after before about any there their they them we our you your sop sops".split(
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

export type SearchSection = { key: string; label: string; num: string };

export type SearchDoc = {
  id: number;
  code: string | null;
  title: string;
  description?: string | null;
} & Record<string, unknown>;

export type SectionHit = { key: string; label: string; num: string; score: number; snippet: string };
export type DocHit<D> = { doc: D; score: number; sections: SectionHit[] };

/** The passage (≈ 240 chars) around the first matched word. */
export function snippet(text: string, words: string[], size = 240): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.slice(0, size).trim() + (text.length > size ? "…" : "");
  const start = Math.max(0, at - Math.floor(size / 3));
  const end = Math.min(text.length, start + size);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

function count(hay: string, w: string): number {
  let n = 0;
  for (let i = hay.indexOf(w); i >= 0 && n < 10; i = hay.indexOf(w, i + w.length)) n++;
  return n;
}

export function searchSops<D extends SearchDoc>(
  docs: D[],
  sections: readonly SearchSection[],
  q: string,
  limit = 10
): { words: string[]; hits: DocHit<D>[] } {
  const words = tokenize(q);
  if (!words.length) return { words, hits: [] };

  const hits: DocHit<D>[] = [];
  for (const doc of docs) {
    const title = `${doc.code ?? ""} ${doc.title} ${doc.description ?? ""}`.toLowerCase();
    let titleScore = 0;
    for (const w of words) if (title.includes(w)) titleScore += 5;

    const found = new Set<string>(words.filter((w) => title.includes(w)));
    const secHits: SectionHit[] = [];
    for (const s of sections) {
      const text = doc[s.key];
      if (typeof text !== "string" || !text.trim()) continue;
      const lower = text.toLowerCase();
      let score = 0;
      for (const w of words) {
        const n = count(lower, w);
        if (n) {
          score += 1 + Math.log2(n);
          found.add(w);
        }
      }
      if (score > 0) secHits.push({ ...s, score, snippet: snippet(text, words) });
    }
    secHits.sort((a, b) => b.score - a.score);

    const coverage = found.size / words.length;
    // With several words, a document must match at least half of them.
    if (words.length > 1 && coverage < 0.5) continue;
    const score = (titleScore + secHits.reduce((a, h) => a + h.score, 0)) * (1 + coverage);
    if (score > 0) hits.push({ doc, score, sections: secHits.slice(0, 3) });
  }
  hits.sort((a, b) => b.score - a.score);
  return { words, hits: hits.slice(0, limit) };
}
