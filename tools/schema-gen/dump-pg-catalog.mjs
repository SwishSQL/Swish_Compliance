import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const SQL_DIR = "C:/Users/Zedni Store/swish-compliance/sql";
const db = new PGlite();

const files = fs.readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql")).sort();
// Run twice: the real deploy re-runs every file on every boot, so a second
// pass proves idempotency and matches what production has converged to.
for (const pass of [1, 2]) {
  for (const f of files) {
    const text = fs.readFileSync(path.join(SQL_DIR, f), "utf8");
    try {
      await db.exec(text);
    } catch (e) {
      console.log(`PASS ${pass} FAIL ${f}: ${e.message}`);
    }
  }
}

const q = async (s) => (await db.query(s)).rows;

const out = {};
out.columns = await q(`
  SELECT c.table_name, c.column_name, c.ordinal_position, c.data_type, c.udt_name,
         c.character_maximum_length, c.numeric_precision, c.numeric_scale,
         c.is_nullable, c.column_default, c.is_identity
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_name=c.table_name AND t.table_schema=c.table_schema
  WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
  ORDER BY c.table_name, c.ordinal_position`);
out.constraints = await q(`
  SELECT conrelid::regclass::text AS table_name, conname, contype,
         pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE connamespace='public'::regnamespace
  ORDER BY 1, contype, conname`);
out.indexes = await q(`
  SELECT tablename, indexname, indexdef FROM pg_indexes
  WHERE schemaname='public' ORDER BY tablename, indexname`);
out.triggers = await q(`
  SELECT event_object_table AS table_name, trigger_name, action_timing, event_manipulation, action_statement
  FROM information_schema.triggers ORDER BY 1,2`);
out.functions = await q(`
  SELECT p.proname, pg_get_functiondef(p.oid) AS def FROM pg_proc p
  WHERE p.pronamespace='public'::regnamespace`);
out.views = await q(`SELECT table_name, view_definition FROM information_schema.views WHERE table_schema='public'`);
out.sequences = await q(`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'`);

const tables = [...new Set(out.columns.map((c) => c.table_name))];
out.rowCounts = {};
out.data = {};
for (const t of tables) {
  const n = (await q(`SELECT COUNT(*)::int AS n FROM "${t}"`))[0].n;
  out.rowCounts[t] = n;
  if (n > 0) out.data[t] = await q(`SELECT * FROM "${t}"`);
}

fs.writeFileSync("catalog.json", JSON.stringify(out, null, 1));
console.log("tables", tables.length, "columns", out.columns.length,
  "constraints", out.constraints.length, "indexes", out.indexes.length,
  "triggers", out.triggers.length, "functions", out.functions.length,
  "views", out.views.length);
console.log("rows:", Object.entries(out.rowCounts).filter(([, n]) => n > 0));
