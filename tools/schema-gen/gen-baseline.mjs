// Generates the SQL Server baseline schema from the PostgreSQL catalog
// that PGlite produced after running every PG migration (catalog.json).
import fs from "node:fs";

const c = JSON.parse(fs.readFileSync("catalog.json", "utf8"));
const OUT = process.argv[2];

const tables = [...new Set(c.columns.map((x) => x.table_name))].sort();
const colsOf = (t) => c.columns.filter((x) => x.table_name === t);
const col = (t, n) => c.columns.find((x) => x.table_name === t && x.column_name === n);

function sqlType(x) {
  switch (x.udt_name) {
    case "int4": return "INT";
    case "int2": return "SMALLINT";
    case "int8": return "BIGINT";
    case "bool": return "BIT";
    case "date": return "DATE";
    case "timestamptz": return "DATETIMEOFFSET(3)";
    case "numeric": return `DECIMAL(${x.numeric_precision},${x.numeric_scale})`;
    case "varchar": return `NVARCHAR(${x.character_maximum_length})`;
    case "text": return "NVARCHAR(MAX)";
    case "jsonb": return "NVARCHAR(MAX)";
    default: throw new Error(`unmapped type ${x.udt_name} on ${x.table_name}.${x.column_name}`);
  }
}

function sqlDefault(x) {
  const d = x.column_default;
  if (d == null || d.startsWith("nextval(")) return null;
  if (d === "now()") return "SYSUTCDATETIME()";
  if (d === "CURRENT_DATE") return "CAST(SYSUTCDATETIME() AS DATE)";
  if (d === "true") return "1";
  if (d === "false") return "0";
  if (/^-?\d+(\.\d+)?$/.test(d)) return d;
  const m = d.match(/^'((?:[^']|'')*)'::(character varying|text)$/);
  if (m) return `N'${m[1]}'`;
  throw new Error(`unmapped default ${d} on ${x.table_name}.${x.column_name}`);
}

const cons = (t, type) => c.constraints.filter((x) => x.table_name === t && x.contype === type);
const colList = (def) => def.match(/\(([^)]*)\)/)[1].split(",").map((s) => s.trim());

const L = [];
const qi = (n) => (n === "percent" ? "[percent]" : n);
const emit = (s = "") => L.push(s);

emit(`/*
 * Swish Compliance — SQL Server baseline schema.
 *
 * Equivalent to the PostgreSQL edition after its migrations 001-055, generated
 * from the catalog those migrations produce (not re-typed by hand), then
 * adapted to SQL Server:
 *
 *   - SERIAL -> INT IDENTITY, TIMESTAMPTZ -> DATETIMEOFFSET(3),
 *     TEXT/JSONB -> NVARCHAR(MAX), VARCHAR(n) -> NVARCHAR(n) (Arabic text).
 *   - UNIQUE on a nullable column -> filtered unique index (SQL Server's
 *     UNIQUE constraint allows only ONE NULL; PostgreSQL allows many).
 *   - Foreign keys are declared without ON DELETE actions: SQL Server
 *     rejects most of the original CASCADE / SET NULL rules (multiple
 *     cascade paths, self-references). The exact PostgreSQL ON DELETE
 *     behaviour is reproduced instead by the INSTEAD OF DELETE triggers at
 *     the end of this file.
 *   - updated_at is maintained by AFTER UPDATE triggers (was a BEFORE
 *     UPDATE plpgsql trigger).
 */
`);

// ── Tables ───────────────────────────────────────────────────────────
for (const t of tables) {
  const lines = [];
  for (const x of colsOf(t)) {
    const isSerial = x.column_default && x.column_default.startsWith("nextval(");
    let s = `  ${qi(x.column_name).padEnd(28)} ${sqlType(x)}`;
    if (isSerial) s += " IDENTITY(1,1)";
    s += x.is_nullable === "NO" ? " NOT NULL" : " NULL";
    const d = sqlDefault(x);
    if (d != null) s += ` CONSTRAINT DF_${t}_${x.column_name} DEFAULT ${d}`;
    lines.push(s);
  }
  for (const p of cons(t, "p")) {
    lines.push(`  CONSTRAINT ${p.conname} PRIMARY KEY (${colList(p.def).join(", ")})`);
  }
  for (const u of cons(t, "u")) {
    const cl = colList(u.def);
    if (cl.every((k) => col(t, k).is_nullable === "NO")) {
      lines.push(`  CONSTRAINT ${u.conname} UNIQUE (${cl.join(", ")})`);
    }
  }
  for (const k of cons(t, "c")) {
    lines.push(`  CONSTRAINT ${k.conname} ${k.def.split("(percent ").join("([percent] ")}`);
  }
  for (const x of colsOf(t).filter((x) => x.udt_name === "jsonb")) {
    lines.push(`  CONSTRAINT CK_${t}_${x.column_name}_json CHECK (${x.column_name} IS NULL OR ISJSON(${x.column_name}) = 1)`);
  }
  emit(`CREATE TABLE dbo.${t} (\n${lines.join(",\n")}\n);`);
  emit();
}

// ── UNIQUE constraints on nullable columns -> filtered unique indexes ──
emit("-- UNIQUE on nullable columns: PostgreSQL allows many NULLs, SQL Server's");
emit("-- UNIQUE constraint allows one. A filtered index keeps PostgreSQL's rule.");
for (const t of tables) {
  for (const u of cons(t, "u")) {
    const cl = colList(u.def);
    if (!cl.every((k) => col(t, k).is_nullable === "NO")) {
      const where = cl.filter((k) => col(t, k).is_nullable === "YES").map((k) => `${k} IS NOT NULL`).join(" AND ");
      emit(`CREATE UNIQUE INDEX ${u.conname} ON dbo.${t} (${cl.join(", ")}) WHERE ${where};`);
    }
  }
}
emit();

// ── Indexes ──────────────────────────────────────────────────────────
const conNames = new Set(c.constraints.map((x) => x.conname));
emit("-- Indexes");
for (const i of c.indexes) {
  if (conNames.has(i.indexname)) continue;
  const m = i.indexdef.match(/^CREATE (UNIQUE )?INDEX (\S+) ON public\.(\S+) USING btree \((.*?)\)(?: WHERE \((.*)\))?$/);
  if (!m) throw new Error("unparsed index " + i.indexdef);
  const [, uniq, name, t, cl, where] = m;
  let unique = !!uniq;
  let filter = where ? where.replace(/[()]/g, "") : null;
  const cols = cl.split(",").map((s) => s.trim());
  if (unique && !filter) {
    const nullable = cols.map((s) => s.replace(/ DESC$/, "")).filter((k) => col(t, k).is_nullable === "YES");
    if (nullable.length) filter = nullable.map((k) => `${k} IS NOT NULL`).join(" AND ");
  }
  emit(`CREATE ${unique ? "UNIQUE " : ""}INDEX ${name} ON dbo.${t} (${cols.join(", ")})${filter ? ` WHERE ${filter}` : ""};`);
}
emit();

// ── Foreign keys (no ON DELETE action — see header) ──────────────────
emit("-- Foreign keys. ON DELETE behaviour lives in the INSTEAD OF DELETE triggers below.");
const fks = c.constraints
  .filter((x) => x.contype === "f")
  .map((x) => {
    const m = x.def.match(/^FOREIGN KEY \((\w+)\) REFERENCES (\w+)\((\w+)\)(?: ON DELETE (CASCADE|SET NULL|RESTRICT))?$/);
    if (!m) throw new Error("unparsed fk " + x.def);
    return { table: x.table_name, name: x.conname, column: m[1], parent: m[2], parentCol: m[3], action: m[4] ?? "NO ACTION" };
  });
for (const f of fks) {
  emit(`ALTER TABLE dbo.${f.table} ADD CONSTRAINT ${f.name} FOREIGN KEY (${f.column}) REFERENCES dbo.${f.parent} (${f.parentCol});`);
}
emit();

// ── updated_at triggers ──────────────────────────────────────────────
for (const tr of c.triggers) {
  if (!/set_updated_at/.test(tr.action_statement)) throw new Error("unexpected trigger " + tr.trigger_name);
  emit("GO");
  emit(`CREATE TRIGGER dbo.${tr.trigger_name} ON dbo.${tr.table_name} AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.${tr.table_name} t JOIN inserted i ON i.id = t.id;
END;`);
}

// ── ON DELETE emulation ──────────────────────────────────────────────
const parents = [...new Set(fks.filter((f) => f.action === "CASCADE" || f.action === "SET NULL").map((f) => f.parent))].sort();
for (const p of parents) {
  const kids = fks.filter((f) => f.parent === p && (f.action === "CASCADE" || f.action === "SET NULL"));
  const body = [];
  const selfCascade = kids.filter((k) => k.table === p && k.action === "CASCADE");
  const idSet = selfCascade.length ? "@ids" : "deleted";
  if (selfCascade.length) {
    // Self-referencing CASCADE (org tree): collect every descendant first.
    if (selfCascade.length !== 1) throw new Error("multiple self cascades on " + p);
    const k = selfCascade[0];
    body.push(`  DECLARE @ids TABLE (id INT PRIMARY KEY);
  WITH tree AS (
    SELECT id FROM deleted
    UNION ALL
    SELECT c.id FROM dbo.${p} c JOIN tree ON c.${k.column} = tree.id
  )
  INSERT INTO @ids (id) SELECT DISTINCT id FROM tree OPTION (MAXRECURSION 0);`);
  }
  const inIds = `(SELECT id FROM ${idSet})`;
  for (const k of kids.filter((k) => k.action === "CASCADE" && k.table !== p)) {
    body.push(`  DELETE FROM dbo.${k.table} WHERE ${k.column} IN ${inIds};`);
  }
  for (const k of kids.filter((k) => k.action === "SET NULL")) {
    body.push(`  UPDATE dbo.${k.table} SET ${k.column} = NULL WHERE ${k.column} IN ${inIds};`);
  }
  body.push(`  DELETE FROM dbo.${p} WHERE id IN ${inIds};`);
  emit("GO");
  emit(`CREATE TRIGGER dbo.trg_${p}_on_delete ON dbo.${p} INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
${body.join("\n")}
END;`);
}
emit("GO");

fs.writeFileSync(OUT, L.join("\n") + "\n");
console.log("tables", tables.length, "fks", fks.length, "delete-triggers", parents.length, "->", OUT);
console.log("fk actions", fks.reduce((a, f) => ((a[f.action] = (a[f.action] || 0) + 1), a), {}));
