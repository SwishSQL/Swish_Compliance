// Emits the reference rows the PostgreSQL migrations seed, as T-SQL.
import fs from "node:fs";
const c = JSON.parse(fs.readFileSync("catalog.json", "utf8"));
const OUT = process.argv[2];

// Insert order respects foreign keys between the seeded tables.
const ORDER = ["brands", "divisions", "departments", "config_options", "org_units"];
const typeOf = (t, n) => c.columns.find((x) => x.table_name === t && x.column_name === n).udt_name;

function lit(t, k, v) {
  if (v === null || v === undefined) return "NULL";
  const ty = typeOf(t, k);
  if (ty === "bool") return v ? "1" : "0";
  if (["int4", "int2", "numeric"].includes(ty)) return String(v);
  return `N'${String(v).replace(/'/g, "''")}'`;
}

const L = [
  "/*",
  " * Reference rows the PostgreSQL edition seeds in its migrations (brands,",
  " * departments, divisions, config options, the org-unit tree). Ids are kept",
  " * so parent/child links inside the seed stay intact. created_at/updated_at",
  " * are left to their defaults.",
  " */",
  "",
];
for (const t of ORDER) {
  const rows = c.data[t];
  if (!rows?.length) continue;
  const keys = Object.keys(rows[0]).filter((k) => k !== "created_at" && k !== "updated_at");
  L.push(`SET IDENTITY_INSERT dbo.${t} ON;`);
  // org_units references itself: insert parents before children.
  const sorted = t === "org_units" ? [...rows].sort((a, b) => a.level - b.level || a.id - b.id) : [...rows].sort((a, b) => a.id - b.id);
  for (const r of sorted) {
    L.push(`INSERT INTO dbo.${t} (${keys.join(", ")}) VALUES (${keys.map((k) => lit(t, k, r[k])).join(", ")});`);
  }
  L.push(`SET IDENTITY_INSERT dbo.${t} OFF;`, "");
}
if (Object.keys(c.data).some((t) => !ORDER.includes(t))) throw new Error("unseeded table " + Object.keys(c.data));
fs.writeFileSync(OUT, L.join("\n"));
console.log("wrote", OUT);
