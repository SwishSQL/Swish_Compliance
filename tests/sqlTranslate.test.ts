import { test } from "node:test";
import assert from "node:assert/strict";
import { translateQuery, MAX_EXPANDED_LIST } from "../src/lib/sqlTranslate.ts";

/* ─── Plain placeholders ─────────────────────────────────────────── */

test("rewrites $n to @pn and binds the value", () => {
  const q = translateQuery("SELECT * FROM users WHERE id = $1", [7]);
  assert.equal(q.text, "SELECT * FROM users WHERE id = @p1");
  assert.deepEqual(q.params, [{ name: "p1", value: 7 }]);
});

test("keeps multi-digit placeholders intact", () => {
  const values = Array.from({ length: 12 }, (_, i) => i);
  const q = translateQuery("SELECT $1, $10, $11, $12", values);
  assert.equal(q.text, "SELECT @p1, @p10, @p11, @p12");
});

test("$1 followed by a digit-like character is not merged", () => {
  // "$1," and "$12" must not be confused.
  const q = translateQuery("SELECT $1, $2", ["a", "b"]);
  assert.equal(q.text, "SELECT @p1, @p2");
});

test("a placeholder reused several times binds exactly one parameter", () => {
  const q = translateQuery(
    "SELECT * FROM t WHERE a ILIKE $1 OR b ILIKE $1 OR c ILIKE $1",
    ["%x%"]
  );
  assert.equal(
    q.text,
    "SELECT * FROM t WHERE a ILIKE @p1 OR b ILIKE @p1 OR c ILIKE @p1"
  );
  assert.deepEqual(q.params, [{ name: "p1", value: "%x%" }]);
});

test("parameters come back in placeholder order regardless of use order", () => {
  const q = translateQuery("SELECT $3, $1, $2", ["a", "b", "c"]);
  assert.deepEqual(
    q.params.map((p) => p.name),
    ["p1", "p2", "p3"]
  );
});

/* ─── Regions that must be left alone ────────────────────────────── */

test("leaves $ inside a string literal untouched", () => {
  const q = translateQuery("SELECT '$5.00 total', $1", ["x"]);
  assert.equal(q.text, "SELECT '$5.00 total', @p1");
  assert.deepEqual(q.params, [{ name: "p1", value: "x" }]);
});

test("handles doubled quotes inside a string literal", () => {
  const q = translateQuery("SELECT 'it''s $9', $1", ["x"]);
  assert.equal(q.text, "SELECT 'it''s $9', @p1");
});

test("leaves $ inside a line comment untouched", () => {
  const q = translateQuery("SELECT $1 -- not a param: $2\n, $2", ["a", "b"]);
  assert.equal(q.text, "SELECT @p1 -- not a param: $2\n, @p2");
  assert.equal(q.params.length, 2);
});

test("leaves $ inside a block comment untouched", () => {
  const q = translateQuery("SELECT /* $9 ignored */ $1", ["a"]);
  assert.equal(q.text, "SELECT /* $9 ignored */ @p1");
  assert.deepEqual(q.params, [{ name: "p1", value: "a" }]);
});

test("leaves $ inside a bracketed identifier untouched", () => {
  const q = translateQuery("SELECT [odd$name] FROM t WHERE id = $1", [1]);
  assert.equal(q.text, "SELECT [odd$name] FROM t WHERE id = @p1");
});

test("leaves $ inside a double-quoted identifier untouched", () => {
  const q = translateQuery('SELECT "odd$col" FROM t WHERE id = $1', [1]);
  assert.equal(q.text, 'SELECT "odd$col" FROM t WHERE id = @p1');
});

/* ─── Array comparisons ──────────────────────────────────────────── */

test("expands = ANY($n) into an IN list", () => {
  const q = translateQuery("SELECT id FROM domains WHERE department_id = ANY($1)", [
    [4, 5, 6],
  ]);
  assert.equal(
    q.text,
    "SELECT id FROM domains WHERE department_id IN (@p1_0, @p1_1, @p1_2)"
  );
  assert.deepEqual(q.params, [
    { name: "p1_0", value: 4 },
    { name: "p1_1", value: 5 },
    { name: "p1_2", value: 6 },
  ]);
});

test("expands = ANY($n::int[]) including the cast", () => {
  const q = translateQuery(
    "SELECT id FROM checks WHERE is_active AND control_id = ANY($1::int[])",
    [[1, 2]]
  );
  assert.equal(
    q.text,
    "SELECT id FROM checks WHERE is_active AND control_id IN (@p1_0, @p1_1)"
  );
});

test("expands = ANY($n::text[]) including the cast", () => {
  const q = translateQuery(
    "SELECT id, name FROM departments WHERE name = ANY($1::text[])",
    [["HR", "IT"]]
  );
  assert.equal(q.text, "SELECT id, name FROM departments WHERE name IN (@p1_0, @p1_1)");
  assert.deepEqual(q.params, [
    { name: "p1_0", value: "HR" },
    { name: "p1_1", value: "IT" },
  ]);
});

test("tolerates whitespace and casing around ANY", () => {
  const q = translateQuery("WHERE id  =  any (  $1 :: int [ ]  )", [[1]]);
  assert.equal(q.text, "WHERE id  IN (@p1_0)");
});

test("expands <> ALL($n) into NOT IN", () => {
  const q = translateQuery("WHERE id <> ALL($1::int[])", [[3, 4]]);
  assert.equal(q.text, "WHERE id NOT IN (@p1_0, @p1_1)");
});

test("expands != ALL($n) into NOT IN", () => {
  const q = translateQuery("WHERE id != ALL($1)", [[3]]);
  assert.equal(q.text, "WHERE id NOT IN (@p1_0)");
});

test("an empty array in ANY matches nothing, as Postgres does", () => {
  const q = translateQuery("WHERE department_id = ANY($1)", [[]]);
  assert.equal(q.text, "WHERE department_id IN (SELECT NULL WHERE 1 = 0)");
  assert.deepEqual(q.params, []);
});

test("an empty array in ALL matches everything, as Postgres does", () => {
  const q = translateQuery("WHERE id <> ALL($1)", [[]]);
  assert.equal(q.text, "WHERE id NOT IN (SELECT NULL WHERE 1 = 0)");
  assert.deepEqual(q.params, []);
});

test("a very large array is passed as one JSON parameter", () => {
  const ids = Array.from({ length: MAX_EXPANDED_LIST + 1 }, (_, i) => i + 1);
  const q = translateQuery("WHERE id = ANY($1) AND x = $2", [ids, "z"]);
  assert.equal(q.text, "WHERE id IN (SELECT value FROM OPENJSON(@p1)) AND x = @p2");
  assert.deepEqual(q.params, [
    { name: "p1", value: JSON.stringify(ids) },
    { name: "p2", value: "z" },
  ]);
});

test("mixes an array parameter with scalar ones correctly", () => {
  const q = translateQuery(
    "SELECT * FROM t WHERE sop_id = $1 AND user_id = ANY($2::int[]) AND x = $3",
    [10, [1, 2], "z"]
  );
  assert.equal(
    q.text,
    "SELECT * FROM t WHERE sop_id = @p1 AND user_id IN (@p2_0, @p2_1) AND x = @p3"
  );
  assert.deepEqual(q.params, [
    { name: "p1", value: 10 },
    { name: "p2_0", value: 1 },
    { name: "p2_1", value: 2 },
    { name: "p3", value: "z" },
  ]);
});

/* ─── Failure modes: refuse rather than guess ────────────────────── */

test("throws when an array is passed outside ANY/ALL", () => {
  assert.throws(
    () => translateQuery("SELECT * FROM t WHERE id = $1", [[1, 2]]),
    /array.*not used as/i
  );
});

test("throws when ANY receives a non-array", () => {
  assert.throws(
    () => translateQuery("WHERE id = ANY($1)", [5]),
    /not an array/i
  );
});

test("throws when a placeholder has no matching parameter", () => {
  assert.throws(
    () => translateQuery("SELECT $1, $2", ["only-one"]),
    /\$2 has no matching parameter/
  );
});

/* ─── A real query lifted from the codebase ──────────────────────── */

test("translates a real multi-line repository query", () => {
  const original = `
    SELECT id, email, display_name, role, brand_id, department_id, is_active
     FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`;
  const q = translateQuery(original, ["a@b.com"]);
  assert.ok(q.text.includes("LOWER(email) = LOWER(@p1)"));
  assert.ok(!q.text.includes("$1"));
  assert.deepEqual(q.params, [{ name: "p1", value: "a@b.com" }]);
});

test("translates a query with no parameters unchanged", () => {
  const original = "SELECT id, name FROM brands WHERE is_active ORDER BY name";
  const q = translateQuery(original);
  assert.equal(q.text, original);
  assert.deepEqual(q.params, []);
});
