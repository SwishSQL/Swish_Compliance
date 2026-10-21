import type { NextConfig } from "next";

/**
 * Hosts the browser reaches this app on, for Server Actions (every form
 * button: save a user, create an SOP, assign a CAPA, ...).
 *
 * Behind the company's IIS reverse proxy the app sees Host = 127.0.0.1:6011
 * while the browser's Origin is https://compliance.swishhh.net. Next.js treats
 * that mismatch as a forged request and rejects every Server Action with
 * "Invalid Server Actions request" (the page shows "Application error: a
 * server-side exception has occurred"), while plain page loads and login keep
 * working. Listing the public host here tells it the proxy is expected.
 *
 * Taken from APP_BASE_URL (already used for single sign-on), plus the company
 * default and an optional SERVER_ACTIONS_ALLOWED_ORIGINS comma list for extra hosts.
 */
function serverActionOrigins(): string[] {
  const hosts = new Set<string>(["compliance.swishhh.net"]);
  const base = (process.env.APP_BASE_URL ?? "").trim();
  if (base) {
    try {
      hosts.add(new URL(base).host.toLowerCase());
    } catch {
      /* ignore a malformed value; the default above still applies */
    }
  }
  for (const h of (process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? "").split(",")) {
    const host = h.trim().toLowerCase();
    if (host) hosts.add(host);
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  // Load the SQL Server driver from node_modules instead of bundling it.
  // Bundled, Next.js puts one copy in each server layer (pages vs server
  // actions), while db.ts shares ONE connection pool across them — a
  // request from the other layer then binds parameters with type objects
  // that pool's driver doesn't recognise ("c.type.validate is not a
  // function"). One external copy means one set of types.
  serverExternalPackages: ["mssql", "tedious"],
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
      allowedOrigins: serverActionOrigins(),
    },
  },
};

export default nextConfig;
