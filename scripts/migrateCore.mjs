/**
 * Database bootstrap: create the database if it is missing, apply every
 * sql/*.sql file that has not run yet, and seed the first admin.
 *
 * Used by two callers with identical behaviour:
 *   - src/instrumentation.ts  — runs automatically every time the server starts
 *   - scripts/migrate.mjs     — `npm run db:migrate`, for running it by hand
 *
 * Safe to run on every start: applied files are tracked in
 * `schema_migrations` (by filename + checksum) and skipped, and a SQL Server
 * application lock makes two instances starting at once queue up instead of
 * racing. Each file runs in a transaction, so a failure leaves no partial
 * schema behind.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sql from "mssql";
import bcrypt from "bcryptjs";
import { splitBatches } from "./splitBatches.mjs";
import { buildConfig } from "./dbConfig.mjs";

/** Case-insensitive on purpose: the app treats 'HR' and 'hr' as the same name/email. */
const DEFAULT_COLLATION = "Latin1_General_100_CI_AS";

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

/**
 * Split a connection config into the target database name and a config
 * that points at `master` instead (needed to CREATE DATABASE).
 */
function splitDatabase(config) {
  if (typeof config === "string") {
    const m = config.match(/(Database|Initial Catalog)\s*=\s*([^;]+)/i);
    if (!m) throw new Error("The connection string has no Database= / Initial Catalog= entry.");
    return {
      database: m[2].trim(),
      masterConfig: config.replace(m[0], `${m[1]}=master`),
    };
  }
  return { database: config.database, masterConfig: { ...config, database: "master" } };
}

function quoteIdent(name) {
  if (!name || name.length > 128) throw new Error(`Invalid database name "${name}".`);
  return `[${name.replace(/]/g, "]]")}]`;
}

/**
 * Make sure the target database exists, creating it when it does not.
 * Needs a login allowed to create databases (server role `dbcreator`) only
 * for that first creation; if the database already exists nothing is required.
 */
export async function ensureDatabase(config, log = console.log) {
  const probe = new sql.ConnectionPool(config);
  let firstError;
  try {
    await probe.connect();
    return false;
  } catch (err) {
    firstError = err;
  } finally {
    await probe.close().catch(() => {});
  }

  // SQL Server reports a missing database as a plain "Login failed" (ELOGIN).
  // Anything else (network, timeout, TLS) is not something we can fix here.
  if (firstError?.code !== "ELOGIN") throw firstError;

  const { database, masterConfig } = splitDatabase(config);
  const master = new sql.ConnectionPool(masterConfig);
  try {
    try {
      await master.connect();
    } catch {
      throw firstError; // master refuses it too: the user name or password is wrong
    }

    const { recordset } = await master
      .request()
      .input("name", sql.NVarChar(128), database)
      .query("SELECT DB_ID(@name) AS id");
    if (recordset[0].id !== null) {
      throw new Error(
        `The database "${database}" exists but this login cannot open it. In that database run: ` +
          `CREATE USER <login> FOR LOGIN <login>; ALTER ROLE db_owner ADD MEMBER <login>;`
      );
    }

    log(`[db] database "${database}" does not exist — creating it.`);
    try {
      await master
        .request()
        .batch(`CREATE DATABASE ${quoteIdent(database)} COLLATE ${DEFAULT_COLLATION}`);
    } catch (err) {
      const denied = /permission|denied/i.test(err?.message ?? "");
      throw new Error(
        denied
          ? `The login is not allowed to create databases. Either create an empty database ` +
              `named "${database}" yourself (the app creates every table inside it), or grant ` +
              `the login the dbcreator server role: ALTER SERVER ROLE dbcreator ADD MEMBER <login>;`
          : `Could not create database "${database}": ${err.message}`,
        { cause: err }
      );
    }
    log(`[db] database "${database}" created.`);
    return true;
  } finally {
    await master.close().catch(() => {});
  }
}

async function applyMigrations(pool, sqlDir, log) {
  await pool.request().query(MIGRATIONS_TABLE);

  const applied = new Map(
    (await pool.request().query("SELECT filename, checksum FROM dbo.schema_migrations"))
      .recordset.map((r) => [r.filename, r.checksum])
  );

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
      log(`[migrate] ${file} is empty — skipping.`);
      continue;
    }

    log(`[migrate] applying ${file} (${batches.length} batch${batches.length === 1 ? "" : "es"}) ...`);

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
        .query("INSERT INTO dbo.schema_migrations (filename, checksum) VALUES (@filename, @checksum)");
      await tx.commit();
      appliedCount++;
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }
  }

  if (modified.length > 0) {
    console.warn(
      `[migrate] WARNING: ${modified.length} already-applied file(s) changed since they ran and ` +
        `were NOT re-applied: ${modified.join(", ")}. Add a new migration instead of editing an applied one.`
    );
  }
  if (appliedCount > 0) log(`[migrate] applied ${appliedCount} new file(s).`);
  return appliedCount;
}

async function seedAdmin(pool, log) {
  const { recordset } = await pool.request().query("SELECT COUNT(*) AS n FROM users");
  if (recordset[0].n > 0) return false;

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

  log(
    process.env.ADMIN_PASSWORD
      ? `[migrate] first admin '${email}' created from ADMIN_EMAIL / ADMIN_PASSWORD.`
      : `[migrate] first admin '${email}' created with the DEFAULT password 'admin123' — change it after first login.`
  );
  return true;
}

/**
 * Full bootstrap. `databaseUrl` is the same DATABASE_URL the app uses.
 * Throws on any failure (callers decide whether that is fatal).
 *
 * @param {{ databaseUrl: string, sqlDir?: string, log?: (msg: string) => void }} opts
 */
export async function runMigrations({ databaseUrl, sqlDir, log = console.log }) {
  const config = buildConfig(databaseUrl);
  await ensureDatabase(config, log);

  // One connection so the session-level application lock below is held by
  // the same connection that does the work.
  const base = typeof config === "string" ? config : { ...config, pool: { max: 1, min: 0 } };
  const pool = new sql.ConnectionPool(base);
  await pool.connect();
  try {
    const lock = await pool
      .request()
      .query(
        `DECLARE @r INT;
         EXEC @r = sp_getapplock @Resource = N'swish_compliance_migrate', @LockMode = 'Exclusive',
              @LockOwner = 'Session', @LockTimeout = 120000;
         SELECT @r AS result;`
      );
    if (lock.recordset[0].result < 0) {
      throw new Error("Timed out waiting for another instance that is migrating the database.");
    }

    const collation = (
      await pool.request().query("SELECT CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS NVARCHAR(128)) AS c")
    ).recordset[0].c;
    if (/_CS_/i.test(collation)) {
      console.warn(
        `[db] WARNING: the database collation is case-SENSITIVE (${collation}). The app expects ` +
          `case-insensitive comparisons (e.g. emails, names); create the database with a *_CI_* collation.`
      );
    }

    const n = await applyMigrations(pool, sqlDir ?? path.resolve(process.cwd(), "sql"), log);
    const seeded = await seedAdmin(pool, log);
    if (n === 0 && !seeded) log("[db] schema is up to date.");

    await pool
      .request()
      .query(`EXEC sp_releaseapplock @Resource = N'swish_compliance_migrate', @LockOwner = 'Session'`)
      .catch(() => {});
  } finally {
    await pool.close().catch(() => {});
  }
}
