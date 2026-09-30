import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Load the SQL Server driver from node_modules instead of bundling it.
  // Bundled, Next.js puts one copy in each server layer (pages vs server
  // actions), while db.ts shares ONE connection pool across them — a
  // request from the other layer then binds parameters with type objects
  // that pool's driver doesn't recognise ("c.type.validate is not a
  // function"). One external copy means one set of types.
  serverExternalPackages: ["mssql", "tedious"],
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
