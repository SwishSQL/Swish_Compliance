import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { searchSops, snippet, tokenize } from "../src/features/sops/search.ts";
import { splitBatches } from "../scripts/splitBatches.mjs";

const SECTIONS = [
  { key: "purpose", num: "1", label: "PURPOSE" },
  { key: "process_flow", num: "3", label: "PROCESS FLOW" },
  { key: "kpis", num: "7", label: "KPIS" },
];

const docs = [
  {
    id: 1,
    code: "HRD-REC-01",
    title: "Recruitment",
    purpose: "Hire the right people on time.",
    process_flow: "1. Manager raises a requisition form.\n2. HR screens candidates within 5 working days.",
    kpis: "Time to hire under 30 days.",
  },
  {
    id: 2,
    code: "CC-CMP-01",
    title: "Customer complaints",
    purpose: "Resolve complaints quickly.",
    process_flow: "Agent logs the complaint and responds within 24 hours. Supervisor approves refunds.",
    kpis: "",
  },
];

test("tokenize drops stop words", () => {
  assert.deepEqual(tokenize("Who approves the refunds?"), ["approves", "refunds"]);
});

test("search ranks the SOP whose sections match", () => {
  const { hits } = searchSops(docs, SECTIONS, "complaint respond time");
  assert.equal(hits[0].doc.id, 2);
  assert.equal(hits[0].sections[0].key, "process_flow");
});

test("search matches on title and code", () => {
  assert.equal(searchSops(docs, SECTIONS, "HRD-REC-01").hits[0].doc.id, 1);
  assert.equal(searchSops(docs, SECTIONS, "recruitment").hits[0].doc.id, 1);
});

test("multi-word questions need at least half the words to match", () => {
  assert.equal(searchSops(docs, SECTIONS, "warehouse forklift battery refunds").hits.length, 0);
});

test("snippet centres on the first match", () => {
  const s = snippet("a".repeat(500) + " forklift " + "b".repeat(500), ["forklift"], 100);
  assert.ok(s.includes("forklift"));
  assert.ok(s.startsWith("…") && s.endsWith("…"));
});

test("migration 005 drops the SC SOP tables and is safe to run twice", () => {
  const text = fs.readFileSync(new URL("../sql/005_sop_review_feedback.sql", import.meta.url), "utf8");
  for (const t of ["sc_sop_feedback", "sc_sop_steps", "sc_sop_processes", "sc_sop_refs", "sc_sop_meta"]) {
    assert.match(text, new RegExp(`IF OBJECT_ID\\(N'dbo\\.${t}', N'U'\\) IS NOT NULL DROP TABLE dbo\\.${t};`));
  }
  const lines = text.split(/\r?\n/);
  const unguarded = lines.filter((l, i) => /^(CREATE TABLE|CREATE INDEX)/.test(l) && !lines[i - 1]?.startsWith("IF "));
  assert.deepEqual(unguarded, []);
  assert.equal(splitBatches(text).length, 2);
});
