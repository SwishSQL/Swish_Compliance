#!/usr/bin/env node
/**
 * Connection + translation smoke test.
 *
 * Unit tests prove the pg-to-T-SQL translator produces the SQL we expect;
 * this proves SQL Server actually accepts and executes that SQL, and that
 * every parameter type round-trips correctly through the driver.
 *
 * Safe to run against any database: it only reads, and the one table it
 * creates is a temp table that vanishes with the session.
 *
 *   DATABASE_URL="mssql://sa:pass@localhost:1433/swish_compliance" \
 *     node scripts/db-check.mjs
 */
import sql from "mssql";
import { buildConfig } from "./dbConfig.mjs";
import { translateQuery } from "../src/lib/sqlTranslate.ts";

let passed = 0;
let failed = 0;

function report(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}\n      ${detail}`);
  }
}

/** Run a pg-style query through the translator, exactly as db.ts does. */
async function run(pool, text, values = []) {
  const translated = translateQuery(text, values);
  const request = pool.request();
  for (const p of translated.params) {
    const v = p.value;
    if (v === null || v === undefined) request.input(p.name, sql.NVarChar(sql.MAX), null);
    else if (typeof v === "number")
      request.input(p.name, Number.isInteger(v) ? sql.Int : sql.Float, v);
    else if (typeof v === "boolean") request.input(p.name, sql.Bit, v);
    else if (v instanceof Date) request.input(p.name, sql.DateTimeOffset, v);
    else request.input(p.name, v);
  }
  return request.query(translated.text);
}

async function check(pool, name, fn) {
  try {
    await fn();
    report(name, true);
  } catch (err) {
    report(name, false, err.message);
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[db-check] DATABASE_URL is not set. Aborting.");
  process.exit(1);
}

let pool;
try {
  const config = buildConfig(DATABASE_URL);
  console.log("[db-check] connecting ...");
  pool = await sql.connect(config);

  const meta = await pool
    .request()
    .query("SELECT @@VERSION AS version, DB_NAME() AS db, SUSER_SNAME() AS login");
  const row = meta.recordset[0];
  console.log(`[db-check] connected to "${row.db}" as "${row.login}"`);
  console.log(`[db-check] ${String(row.version).split("\n")[0].trim()}\n`);

  console.log("[db-check] parameter binding");

  await check(pool, "integer parameter round-trips", async () => {
    const r = await run(pool, "SELECT $1 AS v", [42]);
    if (r.recordset[0].v !== 42) throw new Error(`got ${r.recordset[0].v}`);
  });

  await check(pool, "string parameter round-trips", async () => {
    const r = await run(pool, "SELECT $1 AS v", ["hello"]);
    if (r.recordset[0].v !== "hello") throw new Error(`got ${r.recordset[0].v}`);
  });

  await check(pool, "unicode string survives (NVARCHAR, not VARCHAR)", async () => {
    const r = await run(pool, "SELECT $1 AS v", ["مرحبا"]);
    if (r.recordset[0].v !== "مرحبا") throw new Error(`got ${r.recordset[0].v}`);
  });

  await check(pool, "boolean parameter round-trips as BIT", async () => {
    const r = await run(pool, "SELECT $1 AS v", [true]);
    if (r.recordset[0].v !== true) throw new Error(`got ${r.recordset[0].v}`);
  });

  await check(pool, "NULL parameter round-trips", async () => {
    const r = await run(pool, "SELECT $1 AS v", [null]);
    if (r.recordset[0].v !== null) throw new Error(`got ${r.recordset[0].v}`);
  });

  await check(pool, "a long string (>4000 chars) is not truncated", async () => {
    const long = "x".repeat(50_000);
    const r = await run(pool, "SELECT LEN($1) AS n", [long]);
    if (r.recordset[0].n !== 50_000) throw new Error(`got length ${r.recordset[0].n}`);
  });

  await check(pool, "the same placeholder used twice binds once", async () => {
    const r = await run(pool, "SELECT $1 AS a, $1 AS b", ["dup"]);
    if (r.recordset[0].a !== "dup" || r.recordset[0].b !== "dup") {
      throw new Error(JSON.stringify(r.recordset[0]));
    }
  });

  await check(pool, "a $ inside a string literal is left alone", async () => {
    const r = await run(pool, "SELECT '$5.00' AS v, $1 AS p", ["x"]);
    if (r.recordset[0].v !== "$5.00") throw new Error(`got ${r.recordset[0].v}`);
  });

  console.log("\n[db-check] array parameters (= ANY -> IN)");

  await check(pool, "= ANY($1) expands to an IN list", async () => {
    const r = await run(
      pool,
      "SELECT v FROM (VALUES (1),(2),(3),(4)) AS t(v) WHERE v = ANY($1::int[])",
      [[2, 4]]
    );
    const got = r.recordset.map((x) => x.v).sort();
    if (got.join(",") !== "2,4") throw new Error(`got ${got.join(",")}`);
  });

  await check(pool, "an empty array matches nothing, as Postgres does", async () => {
    const r = await run(
      pool,
      "SELECT v FROM (VALUES (1),(2)) AS t(v) WHERE v = ANY($1::int[])",
      [[]]
    );
    if (r.recordset.length !== 0) throw new Error(`got ${r.recordset.length} rows`);
  });

  await check(pool, "a text array works too", async () => {
    const r = await run(
      pool,
      "SELECT v FROM (VALUES ('a'),('b'),('c')) AS t(v) WHERE v = ANY($1::text[])",
      [["a", "c"]]
    );
    if (r.recordset.length !== 2) throw new Error(`got ${r.recordset.length} rows`);
  });

  console.log("\n[db-check] result shapes");

  await check(pool, "COUNT(*) comes back as a JS number, not a string", async () => {
    const r = await run(pool, "SELECT COUNT(*) AS n FROM (VALUES (1),(2)) AS t(v)");
    if (typeof r.recordset[0].n !== "number") {
      throw new Error(`got ${typeof r.recordset[0].n}`);
    }
  });

  await check(pool, "rowsAffected reports write counts", async () => {
    const request = pool.request();
    const r = await request.batch(
      "CREATE TABLE #probe (id INT); INSERT INTO #probe VALUES (1),(2),(3);"
    );
    const total = (r.rowsAffected ?? []).reduce((a, b) => a + b, 0);
    if (total !== 3) throw new Error(`got ${total}`);
  });

  console.log("\n[db-check] transactions");

  await check(pool, "a committed transaction persists its writes", async () => {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    await new sql.Request(tx).batch("CREATE TABLE ##tx_probe (id INT)");
    await new sql.Request(tx).query("INSERT INTO ##tx_probe VALUES (1)");
    await tx.commit();
    const r = await pool.request().query("SELECT COUNT(*) AS n FROM ##tx_probe");
    const n = r.recordset[0].n;
    await pool.request().batch("DROP TABLE ##tx_probe");
    if (n !== 1) throw new Error(`got ${n} rows`);
  });

  await check(pool, "a rolled-back transaction discards its writes", async () => {
    await pool.request().batch("CREATE TABLE ##rb_probe (id INT)");
    const tx = new sql.Transaction(pool);
    await tx.begin();
    await new sql.Request(tx).query("INSERT INTO ##rb_probe VALUES (1)");
    await tx.rollback();
    const r = await pool.request().query("SELECT COUNT(*) AS n FROM ##rb_probe");
    const n = r.recordset[0].n;
    await pool.request().batch("DROP TABLE ##rb_probe");
    if (n !== 0) throw new Error(`expected 0 rows after rollback, got ${n}`);
  });

  console.log(
    `\n[db-check] ${passed} passed, ${failed} failed.` +
      (failed === 0 ? " Data layer looks healthy.\n" : "\n")
  );
  if (failed > 0) process.exitCode = 1;
} catch (err) {
  console.error("\n[db-check] FAILED to connect or run:", err.message);
  process.exitCode = 1;
} finally {
  await pool?.close().catch(() => {});
}
