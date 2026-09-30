import { runMigrations } from "../scripts/migrateCore.mjs";

/**
 * Node-only part of the startup hook (see instrumentation.ts): creates the
 * database if it does not exist, builds every table, and seeds the first
 * admin — so the first `npm start` on a new server sets the whole database
 * up by itself. Later starts only apply SQL files added since.
 *
 * It must finish before the server accepts requests, and a failure stops
 * the server with the reason in the log: running against a half-built
 * schema would be worse than not starting.
 *
 * Set SKIP_AUTO_MIGRATE=true to turn it off (then run `npm run db:migrate`).
 */
export async function setupDatabase() {
  // `next build` also loads the hook; it must never touch the database.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.SKIP_AUTO_MIGRATE === "true") return;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return; // env.ts reports the missing variable with a clearer message

  try {
    await runMigrations({ databaseUrl });
  } catch (err) {
    console.error(
      "[db] Automatic database setup FAILED — stopping the server.\n" +
        `     ${err instanceof Error ? err.message : String(err)}`
    );
    // Exit instead of throwing: a thrown error leaves Next.js serving 500s on
    // the port, which hides the problem from a process manager. Exiting lets
    // PM2 / the Windows service show it as failed and restart it.
    process.exit(1);
  }
}
