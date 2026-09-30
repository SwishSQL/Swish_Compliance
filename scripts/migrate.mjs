#!/usr/bin/env node
/**
 * `npm run db:migrate` — creates the database if missing, applies any new
 * sql/*.sql files and seeds the first admin. The server does the same
 * automatically on every start (src/instrumentation.ts); this script exists
 * to run it by hand, e.g. to check the connection before the first start.
 */
import { runMigrations } from "./migrateCore.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[migrate] DATABASE_URL is not set. Aborting.");
  process.exit(1);
}

try {
  await runMigrations({ databaseUrl });
  console.log("[migrate] done.");
} catch (err) {
  console.error("[migrate] FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
