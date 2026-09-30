/**
 * Next.js startup hook: runs once when the server starts. The database
 * setup lives in instrumentation-node.ts because the SQL Server driver
 * only exists in the Node.js runtime; the explicit runtime check below is
 * what keeps it out of the edge bundle.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { setupDatabase } = await import("./instrumentation-node");
    await setupDatabase();
  }
}
