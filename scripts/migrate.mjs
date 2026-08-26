#!/usr/bin/env node
/**
 * Migration runner for Microsoft SQL Server.
 *
 * Applies every .sql file under ./sql/ in lexicographic order, recording
 * what it has run in a `schema_migrations` table so re-running is cheap
 * and cannot double-apply anything. Each file runs inside a transaction —
 * SQL Server DDL is transactional, so a file that fails halfway leaves no
 * partial schema behind.
 *
 * Batches: SQL Server requires CREATE TRIGGER / PROCEDURE / VIEW /
 * FUNCTION to be the first statement in its batch. Split those files with
 * a line containing only `GO`, exactly as SSMS and sqlcmd do — the
 * separator is a client-side convention, so this script has to honour it
 * rather than the server.
 *
 * Also seeds a bootstrap admin user when the users table is empty, from
 * ADMIN_EMAIL / ADMIN_PASSWORD.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sql from "mssql";
import bcrypt from "bcryptjs";
import { splitBatches } from "./splitBatches.mjs";
import { buildConfig } from "./dbConfig.mjs";

/* ─── Migration bookkeeping ──────────────────────────────────────── */

const MIGRATIONS_TABLE = `
IF OBJECT_ID('dbo.schema_migrations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.schema_migrations (
    filename    NVARCHAR(260)    NOT NULL PRIMARY KEY,
    checksum    CHAR(64)         NOT NULL,
    applied_at  DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
END`;

function checksum(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

async function runSqlFiles(pool) {
  await pool.request().query(MIGRATIONS_TABLE);

  const applied = new Map(
    (await pool.request().query("SELECT filename, checksum FROM dbo.schema_migrations"))
      .recordset.map((r) => [r.filename, r.checksum])
  );

  const sqlDir = path.resolve(process.cwd(), "sql");
  const entries = (await fs.readdir(sqlDir)).filter((f) => f.endsWith(".sql")).sort();

  let appliedCount = 0;
  const modified = [];

  for (const file of entries) {
    const text = await fs.readFile(path.join(sqlDir, file), "utf8");
    const hash = checksum(text);
    const previous = applied.get(file);

    if (previous !== undefined) {
      if (previous !== hash) modified.push(file);
      continue;
    }

    const batches = splitBatches(text);
    if (batches.length === 0) {
      console.log(`[migrate] ${file} is empty — skipping.`);
      continue;
    }

    console.log(
      `[migrate] applying ${file} (${batches.length} batch${batches.length === 1 ? "" : "es"}) ...`
    );

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const [index, batch] of batches.entries()) {
        try {
          await new sql.Request(tx).batch(batch);
        } catch (err) {
          throw new Error(
            `${file} failed in batch ${index + 1} of ${batches.length}: ${err.message}`,
            { cause: err }
          );
        }
      }
      await new sql.Request(tx)
        .input("filename", sql.NVarChar(260), file)
        .input("checksum", sql.Char(64), hash)
        .query(
          "INSERT INTO dbo.schema_migrations (filename, checksum) VALUES (@filename, @checksum)"
        );
      await tx.commit();
      appliedCount++;
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }
  }

  if (modified.length > 0) {
    console.warn(
      `[migrate] WARNING: ${modified.length} already-applied file(s) changed ` +
        `since they ran and were NOT re-applied:\n` +
        modified.map((f) => `           - ${f}`).join("\n") +
        `\n           Add a new migration instead of editing an applied one, ` +
        `or rebuild the database from scratch.`
    );
  }
  console.log(
    appliedCount === 0
      ? "[migrate] schema already up to date."
      : `[migrate] applied ${appliedCount} new file(s).`
  );
}

/* ─── Bootstrap admin ────────────────────────────────────────────── */

async function seedAdmin(pool) {
  const { recordset } = await pool.request().query("SELECT COUNT(*) AS n FROM users");
  if (recordset[0].n > 0) {
    console.log("[migrate] users table already has rows — skipping admin seed.");
    return;
  }
  const email = process.env.ADMIN_EMAIL || "admin@swish.local";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const hash = bcrypt.hashSync(password, 10);

  await pool
    .request()
    .input("email", sql.NVarChar(255), email)
    .input("password_hash", sql.NVarChar(255), hash)
    .input("display_name", sql.NVarChar(255), "System Administrator")
    .input("role", sql.NVarChar(40), "admin")
    .query(
      `INSERT INTO users (email, password_hash, display_name, role, is_active)
       VALUES (@email, @password_hash, @display_name, @role, 1)`
    );

  console.log(
    process.env.ADMIN_PASSWORD
      ? `[migrate] admin user '${email}' created with ADMIN_PASSWORD from env.`
      : `[migrate] admin user '${email}' created with default password 'admin123'. CHANGE IT after first login.`
  );
}

/* ─── Entry point ────────────────────────────────────────────────── */

{
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("[migrate] DATABASE_URL is not set. Aborting.");
    process.exit(1);
  }

  let pool;
  try {
    pool = await sql.connect(buildConfig(DATABASE_URL));
    await runSqlFiles(pool);
    await seedAdmin(pool);
    console.log("[migrate] done.");
  } catch (err) {
    console.error("[migrate] FAILED:", err);
    process.exitCode = 1;
  } finally {
    await pool?.close().catch(() => {});
  }
}
