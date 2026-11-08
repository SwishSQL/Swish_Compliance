import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { searchRegister, filterSteps, tokenize } from "../src/features/sc-sop/search.ts";
import { splitBatches } from "../scripts/splitBatches.mjs";

/* The register as the migration seeds it (sql/004_sc_sop_review.sql). */
const sqlText = fs.readFileSync(new URL("../sql/004_sc_sop_review.sql", import.meta.url), "utf8");
const json = (table: string) =>
  sqlText
    .split("\n")
    .filter((l) => l.includes(` INSERT INTO dbo.${table} `))
    .map((l) => {
      const m = /, N'((?:[^']|'')*)'\);$/.exec(l);
      assert.ok(m, `no JSON payload in: ${l.slice(0, 80)}`);
      return { line: l, data: JSON.parse(m[1].replace(/''/g, "'")) };
    });

const steps = json("sc_sop_steps").map((r) => r.data);
const procs = json("sc_sop_processes").map((r) => r.data);
const refs = Object.fromEntries(
  json("sc_sop_refs").map((r) => [/VALUES \(N'([^']+)'/.exec(r.line)![1], r.data])
);
const reg = { meta: {} as never, procs, steps, refs };

test("seed carries the full docket", () => {
  assert.equal(procs.length, 28);
  assert.equal(steps.length, 423);
  assert.equal(Object.keys(refs).length, 173);
  assert.equal(sqlText.split("\n").filter((l) => l.includes(" INSERT INTO dbo.sc_sop_feedback ")).length, 27);
  assert.equal(new Set(steps.map((s) => s.id)).size, 423, "step ids are unique");
  assert.ok(steps.every((s) => procs.some((p) => p.id === s.pa)), "every step belongs to a process");
});

test("seed splits into batches the migration runner accepts", () => {
  const batches = splitBatches(sqlText);
  assert.ok(batches.length > 5);
  assert.ok(batches[0].includes("CREATE TABLE dbo.sc_sop_feedback"));
});

test("tokenize drops stop words and punctuation", () => {
  assert.deepEqual(tokenize("Who approves the store additional order?"), ["approves", "store", "additional", "order"]);
});

test("a Step ID in the question ranks that step first", () => {
  const r = searchRegister(reg, "what is PA-04-S230");
  assert.equal(r.steps[0].step.id, "PA-04-S230");
});

test("a reference ID returns the reference", () => {
  const r = searchRegister(reg, "CTL-R01");
  assert.equal(r.refs[0].id, "CTL-R01");
  assert.ok(r.steps.some((h) => h.step.refs?.includes("CTL-R01")));
});

test("keyword questions find relevant steps", () => {
  const r = searchRegister(reg, "batch expiry");
  assert.ok(r.steps.length > 0);
  const hay = JSON.stringify(r.steps[0].step).toLowerCase();
  assert.ok(hay.includes("batch") && hay.includes("expir"));
});

test("filterSteps applies department, change type and search together", () => {
  const wh = filterSteps(steps, { dept: "Warehouse", chg: "New" });
  assert.ok(wh.length > 0);
  assert.ok(wh.every((s) => s.dept === "Warehouse" && s.change === "New"));
  assert.deepEqual(filterSteps(steps, { q: "S230" }).map((s) => s.id).includes("PA-04-S230"), true);
});

test("seed is safe to run twice (every create and insert is guarded)", () => {
  const lines = sqlText.split(/\r?\n/);
  const unguarded = lines.filter(
    (l, i) => /^(CREATE TABLE|CREATE INDEX|INSERT INTO)/.test(l) && !lines[i - 1]?.startsWith("IF ")
  );
  assert.deepEqual(unguarded, [], "no unguarded statements");
  assert.equal(lines.filter((l) => l.startsWith("IF OBJECT_ID(")).length, 5);
  assert.equal(lines.filter((l) => l.startsWith("IF NOT EXISTS")).length, 3 + 6 + 28 + 423 + 173 + 27);
});
