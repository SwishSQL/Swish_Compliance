import "server-only";
import sql from "mssql";
import { env } from "@/lib/env";
import { translateQuery } from "@/lib/sqlTranslate";

/**
 * Microsoft SQL Server data-access layer.
 *
 * This deliberately keeps the exact API the app was built against when it
 * ran on PostgreSQL — `queryAll` / `queryOne` / `execute` / `withTransaction`,
 * all taking pg-style `$1, $2` placeholders — so the ~285 query call sites
 * across the app did not have to be rewritten. Placeholder translation
 * happens in `sqlTranslate.ts`; result shapes are normalised here.
 *
 * Two things behave differently from `pg` and are worth knowing:
 *
 *   - `COUNT(*)` comes back as a JS number. Postgres returns `bigint` as a
 *     string, which is why so many queries say `COUNT(*)::int`. Those casts
 *     are invalid T-SQL and are being removed as queries get ported.
 *
 *   - A NULL parameter is bound as NVARCHAR. That is harmless when it is
 *     inserted, assigned or compared, but `COALESCE($1, some_non_text_col)`
 *     would resolve to NVARCHAR by type precedence. Those sites need an
 *     explicit CAST in the SQL — see PORTING.md.
 */

/** How long to wait for a free pooled connection before giving up. */
const CONNECTION_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;

function buildConfig(): sql.config | string {
  const url = env.DATABASE_URL.trim();

  // A native SQL Server connection string ("Server=...;Database=...;")
  // is handed to the driver untouched.
  if (/^[A-Za-z ]+=/.test(url)) return url;

  // Otherwise treat it as a URL: mssql://user:pass@host:port/database
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "DATABASE_URL must be either a SQL Server connection string " +
        '("Server=host,1433;Database=db;User Id=sa;Password=...;") or a URL ' +
        '("mssql://user:pass@host:1433/database").'
    );
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error("DATABASE_URL is missing the database name.");
  }

  const host = parsed.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  // `encrypt` is required by Azure SQL and most hosted providers; a local
  // dev instance usually presents a self-signed certificate, so trust it
  // there rather than forcing everyone to install one.
  const encrypt = parsed.searchParams.get("encrypt");
  const trust = parsed.searchParams.get("trustServerCertificate");

  return {
    server: host,
    port: parsed.port ? Number(parsed.port) : 1433,
    database,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
    options: {
      encrypt: encrypt ? encrypt !== "false" : !isLocal,
      trustServerCertificate: trust ? trust !== "false" : isLocal,
      // Without this, DATETIMEOFFSET columns come back as strings in some
      // driver versions; the app expects Date objects throughout.
      useUTC: true,
    },
  };
}

// Reuse the pool across hot reloads in dev, exactly as the pg version did.
const globalForSql = globalThis as unknown as {
  __mssqlPool?: Promise<sql.ConnectionPool>;
};

function getPool(): Promise<sql.ConnectionPool> {
  if (!globalForSql.__mssqlPool) {
    const pool = new sql.ConnectionPool(buildConfig() as sql.config);
    // If the very first connect fails, drop the memoised promise so the
    // next request retries instead of resolving to a dead pool forever.
    globalForSql.__mssqlPool = pool.connect().catch((err) => {
      globalForSql.__mssqlPool = undefined;
      throw err;
    });
  }
  return globalForSql.__mssqlPool;
}

/**
 * Bind one value, choosing an explicit SQL type.
 *
 * The driver can infer types, but not from `null` — and its default for
 * plain integers is not wide enough for every column here — so the mapping
 * is spelled out.
 */
function bind(request: sql.Request, name: string, value: unknown): void {
  if (value === null || value === undefined) {
    request.input(name, sql.NVarChar(sql.MAX), null);
    return;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      const fitsInt = value >= -2_147_483_648 && value <= 2_147_483_647;
      request.input(name, fitsInt ? sql.Int : sql.BigInt, value);
    } else {
      request.input(name, sql.Float, value);
    }
    return;
  }
  if (typeof value === "bigint") {
    request.input(name, sql.BigInt, value.toString());
    return;
  }
  if (typeof value === "boolean") {
    request.input(name, sql.Bit, value);
    return;
  }
  if (value instanceof Date) {
    request.input(name, sql.DateTimeOffset, value);
    return;
  }
  if (Buffer.isBuffer(value)) {
    request.input(name, sql.VarBinary(sql.MAX), value);
    return;
  }
  if (typeof value === "object") {
    // JSON columns are NVARCHAR(MAX) here, so objects are serialised the
    // same way `pg` would have written them into a JSONB column.
    request.input(name, sql.NVarChar(sql.MAX), JSON.stringify(value));
    return;
  }
  // Strings: let the driver size the NVARCHAR from the value, which keeps
  // short parameters index-friendly and still allows very long ones
  // (attachments are stored as data URLs).
  request.input(name, value as string);
}

async function run(
  text: string,
  values: unknown[],
  runner?: sql.Request
): Promise<sql.IResult<Record<string, unknown>>> {
  const translated = translateQuery(text, values);
  const request = runner ?? (await getPool()).request();
  for (const p of translated.params) bind(request, p.name, p.value);
  return request.query(translated.text);
}

/**
 * Column-alias suffix that marks a JSON value to decode on the way out.
 *
 * `pg` returned PostgreSQL arrays (array_agg) as JS arrays and JSONB as
 * parsed objects; SQL Server has neither type, so such values are built as
 * JSON text in the query and aliased `<name>__json`. Rows come back with
 * that column parsed and renamed to `<name>`, so callers see exactly the
 * shape `pg` gave them. Example:
 *
 *   COALESCE('[' + STRING_AGG(CAST(x.id AS NVARCHAR(20)), ',') + ']', '[]')
 *     AS department_ids__json          -- row.department_ids: number[]
 */
const JSON_SUFFIX = "__json";

function decodeRows<T>(rows: Record<string, unknown>[] | undefined): T[] {
  if (!rows) return [];
  if (rows.length === 0) return rows as unknown as T[];
  const jsonKeys = Object.keys(rows[0]).filter((k) => k.endsWith(JSON_SUFFIX));
  if (jsonKeys.length === 0) return rows as unknown as T[];
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!key.endsWith(JSON_SUFFIX)) {
        out[key] = value;
        continue;
      }
      const name = key.slice(0, -JSON_SUFFIX.length);
      if (value === null || value === undefined) {
        out[name] = null;
      } else if (typeof value === "string") {
        try {
          out[name] = JSON.parse(value);
        } catch {
          throw new Error(`Column "${key}" is not valid JSON: ${value.slice(0, 200)}`);
        }
      } else {
        out[name] = value;
      }
    }
    return out;
  }) as unknown as T[];
}

/** Run a parameterized query and return all rows. */
export async function queryAll<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await run(text, params);
  return decodeRows<T>(res.recordset);
}

/** Run a parameterized query and return the first row (or undefined). */
export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const res = await run(text, params);
  return decodeRows<T>(res.recordset)[0];
}

/** Run a write query and return rowsAffected. */
export async function execute(
  text: string,
  params: unknown[] = []
): Promise<number> {
  const res = await run(text, params);
  // One entry per statement in the batch. Triggers set NOCOUNT ON so they
  // do not inflate this (see sql/000_helpers.sql).
  return (res.rowsAffected ?? []).reduce((sum, n) => sum + n, 0);
}

/**
 * The subset of `pg`'s PoolClient the app actually used inside
 * transactions: `client.query(...)` returning `{ rows, rowCount }`.
 * Keeping that shape means the existing transaction bodies work as-is.
 */
export type TxClient = {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }>;
};

/**
 * Run a callback inside a transaction on a single dedicated connection,
 * rolling back on any error. Needed whenever a caller has to make several
 * writes that must all succeed or all be undone together — queryAll /
 * queryOne / execute each grab their own connection from the pool, so they
 * cannot share one transaction.
 *
 * Note: a SQL Server transaction serialises its requests, so the callback
 * must await each query rather than firing them in parallel.
 */
export async function withTransaction<T>(
  fn: (client: TxClient) => Promise<T>
): Promise<T> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  let committed = false;
  const client: TxClient = {
    async query<R = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const res = await run(text, params, new sql.Request(transaction));
      return {
        rows: decodeRows<R>(res.recordset),
        rowCount: (res.rowsAffected ?? []).reduce((sum, n) => sum + n, 0),
      };
    },
  };

  try {
    const result = await fn(client);
    await transaction.commit();
    committed = true;
    return result;
  } finally {
    if (!committed) {
      // Swallow rollback failures so the original error still surfaces —
      // if the connection already died, the transaction is gone anyway.
      await transaction.rollback().catch(() => {});
    }
  }
}

/** Close the pool. Only used by scripts; the server keeps it open. */
export async function closePool(): Promise<void> {
  const pending = globalForSql.__mssqlPool;
  if (!pending) return;
  globalForSql.__mssqlPool = undefined;
  const pool = await pending.catch(() => null);
  await pool?.close();
}
