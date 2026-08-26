/**
 * Build an `mssql` connection config from DATABASE_URL.
 *
 * Shared by the standalone scripts (migrate, db-check). It intentionally
 * mirrors `buildConfig()` in src/lib/db.ts rather than importing it —
 * these scripts run outside Next.js, so they cannot use the "@/" alias or
 * the "server-only" guard that module carries.
 *
 * Accepts either a native SQL Server connection string
 * ("Server=host,1433;Database=db;User Id=sa;Password=...;") or a URL
 * ("mssql://user:pass@host:1433/database").
 */
export function buildConfig(raw) {
  const url = String(raw ?? "").trim();
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (/^[A-Za-z ]+=/.test(url)) return url;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "DATABASE_URL must be a SQL Server connection string or an mssql:// URL."
    );
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL is missing the database name.");

  const host = parsed.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  const encrypt = parsed.searchParams.get("encrypt");
  const trust = parsed.searchParams.get("trustServerCertificate");

  return {
    server: host,
    port: parsed.port ? Number(parsed.port) : 1433,
    database,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    connectionTimeout: 30_000,
    // Migrations can legitimately take a while on a large table.
    requestTimeout: 10 * 60_000,
    options: {
      encrypt: encrypt ? encrypt !== "false" : !isLocal,
      trustServerCertificate: trust ? trust !== "false" : isLocal,
      useUTC: true,
    },
  };
}
