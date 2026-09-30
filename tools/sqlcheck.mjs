#!/usr/bin/env node
/**
 * Run one app query against SQL Server inside a transaction that is always
 * rolled back — a quick way to prove a converted query parses, resolves every
 * table/column, and executes, without leaving anything behind.
 *
 *   node tools/sqlcheck.mjs <file.sql> ['<JSON array of $n params>']
 *
 * The file holds the query exactly as the app sends it (pg-style $1
 * placeholders, = ANY($n) with an array param, etc.); it goes through the
 * app's own translateQuery(). Prints the first rows and the row counts.
 * Needs DATABASE_URL.
 */
import fs from "node:fs";
import sql from "mssql";
import { buildConfig } from "../scripts/dbConfig.mjs";
import { translateQuery } from "../src/lib/sqlTranslate.ts";

const [file, paramsJson] = process.argv.slice(2);
if (!file) {
  console.error("usage: node tools/sqlcheck.mjs <file.sql> ['[params]']");
  process.exit(2);
}
const text = fs.readFileSync(file, "utf8");
const values = paramsJson ? JSON.parse(paramsJson) : [];
const { text: tsql, params } = translateQuery(text, values);

const pool = await sql.connect(buildConfig(process.env.DATABASE_URL));
const tx = new sql.Transaction(pool);
await tx.begin();
try {
  const req = new sql.Request(tx);
  for (const p of params) {
    if (p.value === null) req.input(p.name, sql.NVarChar(sql.MAX), null);
    else if (typeof p.value === "number") req.input(p.name, Number.isInteger(p.value) ? sql.Int : sql.Float, p.value);
    else if (typeof p.value === "boolean") req.input(p.name, sql.Bit, p.value);
    else req.input(p.name, p.value);
  }
  const r = await req.query(tsql);
  console.log("OK rowsAffected=", JSON.stringify(r.rowsAffected));
  (r.recordsets ?? []).forEach((set, i) => {
    console.log(`recordset ${i}: ${set.length} row(s)`, JSON.stringify(set.slice(0, 3)));
  });
} catch (e) {
  console.log(`ERROR ${e.number ?? ""}: ${e.message}`);
  console.log("--- translated T-SQL ---\n" + tsql);
  process.exitCode = 1;
} finally {
  await tx.rollback().catch(() => {});
  await pool.close();
}
