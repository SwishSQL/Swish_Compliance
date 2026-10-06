#!/usr/bin/env node
/**
 * Copy all data from the PostgreSQL edition's database into this SQL Server
 * database.
 *
 *   PG_SOURCE_URL=postgres://user:pass@host:port/db  DATABASE_URL=mssql://...  \
 *     npm run migrate:from-postgres -- [--dry-run] [--replace]
 *
 * How it stays safe:
 *   - The source is opened READ ONLY in one REPEATABLE READ snapshot, so the
 *     copy is consistent even if someone is still using the old system, and
 *     nothing can be written to it.
 *   - Everything written to SQL Server happens in ONE transaction that is
 *     rolled back unless every table was copied AND verified cell by cell
 *     against the source. Any error = the target is left exactly as it was.
 *   - It refuses to overwrite a target that already holds real data unless
 *     --replace is given.
 *
 * Stop the application on the target first (it must not be writing while the
 * data is copied). Ids are preserved, so every link between records survives.
 */
import crypto from "node:crypto";
import pg from "pg";
import sql from "mssql";
import { buildConfig } from "./dbConfig.mjs";
import { runMigrations } from "./migrateCore.mjs";

const USAGE = `Usage: npm run migrate:from-postgres -- [--dry-run] [--replace]

  Environment:
    PG_SOURCE_URL   PostgreSQL connection URL of the OLD system (read only)
    DATABASE_URL    SQL Server connection URL of the NEW system
    PG_SOURCE_SSL   optional: "false" to disable TLS to PostgreSQL
                    (default: TLS without certificate check unless host is local)

  --dry-run   check both sides and report what would be copied; copies nothing
  --replace   allow deleting data that is already in the SQL Server database`;

const argv = process.argv.slice(2);
const known = new Set(["--dry-run", "--replace", "--help", "-h"]);
const bad = argv.filter((a) => !known.has(a));
if (bad.length || argv.includes("--help") || argv.includes("-h")) {
  console.log(bad.length ? `Unknown option: ${bad.join(" ")}\n\n${USAGE}` : USAGE);
  process.exit(bad.length ? 2 : 0);
}
const DRY_RUN = argv.includes("--dry-run");
const REPLACE = argv.includes("--replace");

const log = (m = "") => console.log(m);
const qi = (name) => `[${String(name).replace(/]/g, "]]")}]`; // SQL Server identifier
const pi = (name) => `"${String(name).replace(/"/g, '""')}"`; // PostgreSQL identifier

/** Tables whose rows are created by sql/002_seed.sql or the bootstrap admin. */
const SEEDED_TABLES = new Set(["brands", "departments", "divisions", "config_options", "org_units", "users"]);
const BYTE_BUDGET = 4 * 1024 * 1024; // per INSERT statement
const MAX_PARAMS = 2000; // SQL Server allows 2,100 per request

/* ─── Source (PostgreSQL) ─────────────────────────────────────────── */

function sourceClient(urlText) {
  const url = new URL(urlText);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  url.searchParams.delete("sslmode"); // decided explicitly below, never by the URL
  const sslEnv = (process.env.PG_SOURCE_SSL ?? "").toLowerCase();
  const ssl = sslEnv === "false" || (!sslEnv && local) ? false : { rejectUnauthorized: false };
  return new pg.Client({
    connectionString: url.toString(),
    ssl,
    statement_timeout: 10 * 60_000,
    // DATE comes back as the plain 'YYYY-MM-DD' text, never a timezone-shifted Date.
    types: {
      getTypeParser: (oid, format) => (oid === 1082 ? (v) => v : pg.types.getTypeParser(oid, format)),
    },
  });
}

/* ─── Target (SQL Server) metadata ────────────────────────────────── */

async function loadTargetModel(pool) {
  const cols = (
    await pool.request().query(`
      SELECT t.name AS tbl, c.name AS col, ty.name AS type, c.max_length, c.precision, c.scale,
             c.is_nullable, c.is_identity
      FROM sys.tables t
      JOIN sys.columns c ON c.object_id = t.object_id
      JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      WHERE t.schema_id = SCHEMA_ID('dbo') AND t.name <> 'schema_migrations'
      ORDER BY t.name, c.column_id`)
  ).recordset;

  const pks = (
    await pool.request().query(`
      SELECT t.name AS tbl, c.name AS col, ic.key_ordinal
      FROM sys.tables t
      JOIN sys.indexes i ON i.object_id = t.object_id AND i.is_primary_key = 1
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE t.schema_id = SCHEMA_ID('dbo')
      ORDER BY t.name, ic.key_ordinal`)
  ).recordset;

  const fks = (
    await pool.request().query(`
      SELECT OBJECT_NAME(parent_object_id) AS child, OBJECT_NAME(referenced_object_id) AS parent
      FROM sys.foreign_keys`)
  ).recordset;

  const tables = new Map();
  for (const c of cols) {
    if (!tables.has(c.tbl)) tables.set(c.tbl, { name: c.tbl, columns: [], pk: [], identity: null });
    const t = tables.get(c.tbl);
    t.columns.push(c);
    if (c.is_identity) t.identity = c.col;
  }
  for (const p of pks) tables.get(p.tbl)?.pk.push(p.col);
  for (const t of tables.values()) {
    if (t.pk.length === 0) throw new Error(`Table ${t.name} has no primary key — cannot page it safely.`);
  }

  // Parents before children where possible. Some tables point at each other
  // (sops <-> domains), so no strict order exists; that is fine because every
  // constraint is switched off while loading and fully re-validated afterwards.
  const deps = new Map([...tables.keys()].map((n) => [n, new Set()]));
  for (const f of fks) if (f.child !== f.parent && deps.has(f.child) && deps.has(f.parent)) deps.get(f.child).add(f.parent);
  const order = [];
  const placed = new Set();
  while (order.length < tables.size) {
    const remaining = [...deps.keys()].filter((n) => !placed.has(n)).sort();
    let ready = remaining.filter((n) => [...deps.get(n)].every((d) => placed.has(d)));
    if (ready.length === 0) {
      // Break a cycle: take the table with the fewest parents still missing.
      const unmet = (n) => [...deps.get(n)].filter((d) => !placed.has(d)).length;
      ready = [remaining.sort((a, b) => unmet(a) - unmet(b))[0]];
    }
    for (const n of ready) {
      placed.add(n);
      order.push(n);
    }
  }
  return { tables, order };
}

/** mssql parameter type for a target column. */
function paramType(c) {
  switch (c.type) {
    case "int": return sql.Int;
    case "smallint": return sql.SmallInt;
    case "bigint": return sql.BigInt;
    case "bit": return sql.Bit;
    case "datetimeoffset": return sql.DateTimeOffset(3);
    case "nvarchar": return c.max_length === -1 ? sql.NVarChar(sql.MAX) : sql.NVarChar(Math.max(1, c.max_length / 2));
    // date and decimal travel as text and are converted exactly by SQL Server itself.
    case "date": return sql.NVarChar(10);
    case "decimal":
    case "numeric": return sql.NVarChar(64);
    default: throw new Error(`Unsupported column type "${c.type}" (${c.tbl}.${c.col}).`);
  }
}

/** Convert a value read from PostgreSQL into what the mssql driver should bind. */
function toParam(c, v) {
  if (v === null || v === undefined) return null;
  switch (c.type) {
    case "bit": return Boolean(v);
    case "int":
    case "smallint": return Number(v);
    case "datetimeoffset": return v instanceof Date ? v : new Date(v);
    case "nvarchar": return typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
    default: return String(v);
  }
}

/* ─── Comparison (source value vs what was stored) ────────────────── */

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** One canonical text per cell, identical for equal values on either side. */
function canon(c, v, side) {
  if (v === null || v === undefined) return "∅";
  switch (c.type) {
    case "bit": return v ? "1" : "0";
    case "int":
    case "smallint":
    case "bigint": return String(Number(v));
    case "decimal":
    case "numeric": return String(Number(v));
    case "datetimeoffset": return String((v instanceof Date ? v : new Date(v)).getTime());
    case "date": return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    case "nvarchar": {
      const text = typeof v === "object" ? stable(v) : String(v);
      // jsonb columns hold JSON text on the SQL Server side: compare as parsed JSON.
      if (side === "target" && c.isJson) {
        try { return stable(JSON.parse(text)); } catch { return text; }
      }
      return typeof v === "object" ? stable(v) : text;
    }
    default: return String(v);
  }
}

/* ─── Paged reads ─────────────────────────────────────────────────── */

const hasBigText = (t) => t.columns.some((c) => c.type === "nvarchar" && c.max_length === -1);
const pageSize = (t) => (hasBigText(t) ? 20 : 500);

async function readSourcePage(client, t, offset, limit) {
  const cols = t.columns.map((c) => pi(c.col)).join(", ");
  const order = t.pk.map(pi).join(", ");
  const r = await client.query(`SELECT ${cols} FROM ${pi(t.name)} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`);
  return r.rows;
}

async function readTargetPage(pool, tx, t, offset, limit) {
  const cols = t.columns.map((c) => qi(c.col)).join(", ");
  const order = t.pk.map(qi).join(", ");
  const r = await new sql.Request(tx).query(
    `SELECT ${cols} FROM dbo.${qi(t.name)} ORDER BY ${order} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
  );
  return r.recordset;
}

/* ─── Main ────────────────────────────────────────────────────────── */

async function main() {
  const sourceUrl = process.env.PG_SOURCE_URL;
  const targetUrl = process.env.DATABASE_URL;
  if (!sourceUrl || !targetUrl) {
    console.error("PG_SOURCE_URL and DATABASE_URL must both be set.\n\n" + USAGE);
    process.exit(2);
  }

  log("== 1/6  Preparing the SQL Server schema (creates the database and tables if missing; copies no data)");
  await runMigrations({ databaseUrl: targetUrl, seedAdmin: false, log: (m) => log("   " + m) });

  const pool = new sql.ConnectionPool(buildConfig(targetUrl));
  await pool.connect();
  const client = sourceClient(sourceUrl);
  let tx;
  try {
    log("== 2/6  Connecting to PostgreSQL (read only snapshot)");
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

    const model = await loadTargetModel(pool);
    for (const t of model.tables.values()) {
      for (const c of t.columns) {
        c.tbl = t.name;
        c.isJson = false;
      }
    }

    // Does the PostgreSQL side have exactly the columns we expect?
    const srcCols = (
      await client.query(
        `SELECT table_name, column_name, udt_name FROM information_schema.columns WHERE table_schema = 'public'`
      )
    ).rows;
    const srcByTable = new Map();
    for (const r of srcCols) {
      if (!srcByTable.has(r.table_name)) srcByTable.set(r.table_name, new Map());
      srcByTable.get(r.table_name).set(r.column_name, r.udt_name);
    }
    const problems = [];
    for (const t of model.tables.values()) {
      const s = srcByTable.get(t.name);
      if (!s) { problems.push(`table "${t.name}" is missing in PostgreSQL`); continue; }
      for (const c of t.columns) {
        if (!s.has(c.col)) problems.push(`column ${t.name}.${c.col} is missing in PostgreSQL`);
        else if (s.get(c.col) === "jsonb" || s.get(c.col) === "json") c.isJson = true;
      }
      for (const name of s.keys()) {
        if (!t.columns.some((c) => c.col === name)) problems.push(`PostgreSQL has column ${t.name}.${name} that SQL Server does not (data would be lost)`);
      }
    }
    const extraTables = [...srcByTable.keys()].filter((n) => !model.tables.has(n) && n !== "schema_migrations");
    if (problems.length) {
      throw new Error(
        "The two databases do not have the same structure. The PostgreSQL system must be on the same version as this SQL Server edition:\n  - " +
          problems.join("\n  - ")
      );
    }
    if (extraTables.length) log(`   note: these PostgreSQL tables are not part of this app and are NOT copied: ${extraTables.join(", ")}`);

    // Row counts on both sides.
    const srcCounts = new Map();
    const tgtCounts = new Map();
    for (const name of model.order) {
      srcCounts.set(name, Number((await client.query(`SELECT COUNT(*) AS n FROM ${pi(name)}`)).rows[0].n));
      tgtCounts.set(name, (await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.${qi(name)}`)).recordset[0].n);
    }

    const nonSeedData = model.order.filter((n) => !SEEDED_TABLES.has(n) && tgtCounts.get(n) > 0);
    const pristine = nonSeedData.length === 0 && tgtCounts.get("users") <= 1;
    log("== 3/6  Comparing both sides");
    log("   " + "table".padEnd(26) + "PostgreSQL".padStart(11) + "SQL Server now".padStart(16));
    for (const name of model.order) {
      log("   " + name.padEnd(26) + String(srcCounts.get(name)).padStart(11) + String(tgtCounts.get(name)).padStart(16));
    }
    const totalRows = [...srcCounts.values()].reduce((a, b) => a + b, 0);
    log(`   total rows to copy: ${totalRows}`);

    if (!pristine && !REPLACE && !DRY_RUN) {
      throw new Error(
        `The SQL Server database already contains data (${nonSeedData.join(", ") || "users"}). ` +
          `Copying would DELETE it. Run again with --replace if that is what you want.`
      );
    }
    if (DRY_RUN) {
      log("\nDry run finished: nothing was copied. Structure matches" + (pristine ? ", and the target is empty." : `, but the target holds data (use --replace to overwrite it).`));
      return;
    }
    if (!pristine) log("   --replace given: existing data in SQL Server will be deleted.");

    log("== 4/6  Copying (one transaction; nothing is kept unless everything verifies)");
    tx = new sql.Transaction(pool);
    await tx.begin();
    const run = (text) => new sql.Request(tx).batch(text);

    for (const name of model.order) {
      await run(`ALTER TABLE dbo.${qi(name)} NOCHECK CONSTRAINT ALL; ALTER TABLE dbo.${qi(name)} DISABLE TRIGGER ALL;`);
    }
    for (const name of [...model.order].reverse()) await run(`DELETE FROM dbo.${qi(name)}`);

    for (const name of model.order) {
      const t = model.tables.get(name);
      const total = srcCounts.get(name);
      if (t.identity) await run(`SET IDENTITY_INSERT dbo.${qi(name)} ON`);

      const colList = t.columns.map((c) => qi(c.col)).join(", ");
      const perStatement = Math.max(1, Math.min(1000, Math.floor(MAX_PARAMS / t.columns.length)));
      const size = pageSize(t);
      let copied = 0;

      const flush = async (rows) => {
        if (rows.length === 0) return;
        const req = new sql.Request(tx);
        const values = rows.map((row, r) => {
          const ph = t.columns.map((c, i) => {
            const p = `r${r}c${i}`;
            req.input(p, paramType(c), toParam(c, row[c.col]));
            return `@${p}`;
          });
          return `(${ph.join(", ")})`;
        });
        await req.query(`INSERT INTO dbo.${qi(name)} (${colList}) VALUES ${values.join(", ")}`);
      };

      for (let offset = 0; offset < total; offset += size) {
        const rows = await readSourcePage(client, t, offset, size);
        let batch = [];
        let bytes = 0;
        for (const row of rows) {
          let rowBytes = 0;
          for (const c of t.columns) {
            const v = row[c.col];
            if (typeof v === "string") rowBytes += v.length * 2;
            else if (v && typeof v === "object" && !(v instanceof Date)) rowBytes += JSON.stringify(v).length * 2;
          }
          if (batch.length && (batch.length >= perStatement || bytes + rowBytes > BYTE_BUDGET)) {
            await flush(batch);
            batch = [];
            bytes = 0;
          }
          batch.push(row);
          bytes += rowBytes;
        }
        await flush(batch);
        copied += rows.length;
      }
      if (t.identity) await run(`SET IDENTITY_INSERT dbo.${qi(name)} OFF`);
      log(`   ${name.padEnd(26)} ${String(copied).padStart(8)} rows`);
    }

    log("== 5/6  Re-enabling triggers and constraints (this also validates every link between records)");
    for (const name of model.order) {
      await run(`ALTER TABLE dbo.${qi(name)} ENABLE TRIGGER ALL; ALTER TABLE dbo.${qi(name)} WITH CHECK CHECK CONSTRAINT ALL;`);
    }
    for (const name of model.order) {
      const t = model.tables.get(name);
      if (!t.identity) continue;
      const max = (await new sql.Request(tx).query(`SELECT MAX(${qi(t.identity)}) AS m FROM dbo.${qi(name)}`)).recordset[0].m ?? 0;
      await run(`DBCC CHECKIDENT (N'dbo.${name.replace(/'/g, "''")}', RESEED, ${Number(max)}) WITH NO_INFOMSGS`);
    }

    log("== 6/6  Verifying every cell against PostgreSQL");
    let mismatches = 0;
    const digest = crypto.createHash("sha256");
    for (const name of model.order) {
      const t = model.tables.get(name);
      const total = srcCounts.get(name);
      const actual = (await new sql.Request(tx).query(`SELECT COUNT(*) AS n FROM dbo.${qi(name)}`)).recordset[0].n;
      let bad = 0;
      if (actual !== total) {
        console.error(`   ✗ ${name}: ${total} rows in PostgreSQL, ${actual} in SQL Server`);
        bad++;
      } else {
        const size = pageSize(t);
        for (let offset = 0; offset < total && bad < 5; offset += size) {
          const a = await readSourcePage(client, t, offset, size);
          const b = await readTargetPage(pool, tx, t, offset, size);
          for (let i = 0; i < a.length; i++) {
            for (const c of t.columns) {
              const x = canon(c, a[i][c.col], "source");
              const y = canon(c, b[i]?.[c.col], "target");
              digest.update(`${name}|${c.col}|${x}\n`);
              if (x !== y) {
                bad++;
                console.error(
                  `   ✗ ${name} row ${t.pk.map((k) => a[i][k]).join("/")} column ${c.col}: ` +
                    `PostgreSQL=${JSON.stringify(x.slice(0, 80))} SQL Server=${JSON.stringify(y.slice(0, 80))}`
                );
                if (bad >= 5) break;
              }
            }
            if (bad >= 5) break;
          }
        }
      }
      mismatches += bad;
      if (bad === 0) log(`   ✓ ${name.padEnd(26)} ${String(total).padStart(8)} rows identical`);
    }

    if (mismatches > 0) throw new Error(`Verification failed (${mismatches} problem(s)); nothing was changed in SQL Server.`);

    await tx.commit();
    tx = null;
    log(`\nDone. ${totalRows} rows in ${model.order.length} tables copied and verified.`);
    log(`Content fingerprint (same value on any re-run of identical data): ${digest.digest("hex").slice(0, 16)}`);
    log("Start the application now; sign in with the same users and passwords as the old system.");
  } finally {
    if (tx) await tx.rollback().catch(() => {});
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
    await pool.close().catch(() => {});
  }
}

let finished = false;
// If the process ends without main() having finished (e.g. a connection that
// silently never completes), that must never look like success.
process.on("exit", (code) => {
  if (!finished && code === 0) {
    console.error("\nFAILED: the migration ended unexpectedly before finishing (is the PostgreSQL address reachable?).");
    console.error("Nothing was changed in the SQL Server data.");
    process.exitCode = 1;
  }
});

main().then(() => { finished = true; }).catch((err) => {
  finished = true;
  console.error("\nFAILED: " + (err instanceof Error ? err.message : err));
  console.error("Nothing was changed in the SQL Server data.");
  process.exit(1);
});
