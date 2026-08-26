import { test } from "node:test";
import assert from "node:assert/strict";
import { splitBatches } from "../scripts/splitBatches.mjs";

test("a script with no GO is a single batch", () => {
  const text = "CREATE TABLE t (id INT);\nINSERT INTO t VALUES (1);";
  assert.deepEqual(splitBatches(text), [text]);
});

test("splits on a GO line", () => {
  const batches = splitBatches("SELECT 1\nGO\nSELECT 2");
  assert.deepEqual(batches, ["SELECT 1", "SELECT 2"]);
});

test("GO is case-insensitive and tolerates indentation and trailing spaces", () => {
  const batches = splitBatches("SELECT 1\n   go   \nSELECT 2\nGo\nSELECT 3");
  assert.deepEqual(batches, ["SELECT 1", "SELECT 2", "SELECT 3"]);
});

test("handles CRLF line endings", () => {
  const batches = splitBatches("SELECT 1\r\nGO\r\nSELECT 2");
  assert.deepEqual(batches, ["SELECT 1", "SELECT 2"]);
});

test("a trailing GO does not produce an empty batch", () => {
  assert.deepEqual(splitBatches("SELECT 1\nGO\n"), ["SELECT 1"]);
});

test("consecutive GOs do not produce empty batches", () => {
  assert.deepEqual(splitBatches("SELECT 1\nGO\nGO\nSELECT 2"), ["SELECT 1", "SELECT 2"]);
});

test("does not split on GO inside a string literal", () => {
  const text = "INSERT INTO t VALUES ('line1\nGO\nline2')";
  assert.deepEqual(splitBatches(text), [text]);
});

test("does not split on a word merely starting with GO", () => {
  const text = "SELECT * FROM goals\nGOTO done";
  assert.deepEqual(splitBatches(text), [text]);
});

test("does not split on GO inside a line comment", () => {
  const text = "SELECT 1\n-- GO\nSELECT 2";
  assert.deepEqual(splitBatches(text), [text]);
});

test("does not split on GO inside a block comment", () => {
  const text = "SELECT 1\n/*\nGO\n*/\nSELECT 2";
  assert.deepEqual(splitBatches(text), [text]);
});

test("does not split on GO inside a bracketed identifier", () => {
  const text = "SELECT [odd\nGO\ncol] FROM t";
  assert.deepEqual(splitBatches(text), [text]);
});

test("keeps a trigger in its own batch, which is the whole point", () => {
  const text = [
    "ALTER TABLE sops ADD updated_at DATETIMEOFFSET;",
    "GO",
    "CREATE TRIGGER trg_sops_updated ON sops AFTER UPDATE AS",
    "BEGIN SET NOCOUNT ON; END;",
    "GO",
    "CREATE INDEX ix_sops ON sops(id);",
  ].join("\n");
  const batches = splitBatches(text);
  assert.equal(batches.length, 3);
  assert.ok(batches[1].startsWith("CREATE TRIGGER"));
});

test("an empty or whitespace-only script yields no batches", () => {
  assert.deepEqual(splitBatches(""), []);
  assert.deepEqual(splitBatches("\n\n   \n"), []);
  assert.deepEqual(splitBatches("GO\n"), []);
});

test("rejects a GO repeat count rather than silently running it once", () => {
  assert.throws(() => splitBatches("SELECT 1\nGO 5\nSELECT 2"), /repeat count/i);
});

test("preserves doubled quotes inside string literals", () => {
  const text = "SELECT 'it''s fine'";
  assert.deepEqual(splitBatches(text), [text]);
});
