# PostgreSQL → SQL Server port

This repo is a copy of [swish-compliance](https://github.com/swish-code/swish-compliance)
being converted from PostgreSQL to Microsoft SQL Server. It shares the
original's full commit history; everything below the first porting commit
is the PostgreSQL app.

**Status: the foundation is in place. The SQL files and the queries are not
converted yet, so the app will not run against a live database.**

---

## The core idea

The app has ~285 query call sites spread across repositories, server
actions and page components. All of them go through four helpers in
`src/lib/db.ts`. Rather than rewrite every call site, the helpers keep
their exact signatures — including pg-style `$1, $2` placeholders — and
translate at runtime.

`src/lib/sqlTranslate.ts` does the translation:

| Postgres | SQL Server | Handled |
|---|---|---|
| `$1`, `$2` … | `@p1`, `@p2` … | automatically |
| `col = ANY($1)` (JS array) | `col IN (@p1_0, @p1_1, …)` | automatically |
| `col <> ALL($1)` | `col NOT IN (…)` | automatically |
| `$` inside strings / comments / identifiers | untouched | automatically |

It refuses rather than guesses: an array passed outside `ANY`/`ALL`, a
non-array inside one, or a placeholder with no argument all throw
immediately with the offending query in the message.

Transactions keep pg's client shape (`client.query()` returning
`{ rows, rowCount }`), so existing transaction bodies work unchanged.

---

## Done

- `src/lib/sqlTranslate.ts` — placeholder + array translation (25 unit tests)
- `src/lib/db.ts` — `mssql` pool, `queryAll` / `queryOne` / `execute` /
  `withTransaction`, explicit per-type parameter binding, pg-shaped
  transaction client
- `scripts/splitBatches.mjs` — `GO` batch splitting (15 unit tests)
- `scripts/migrate.mjs` — rewritten: tracks applied files in
  `schema_migrations`, runs each file in a transaction, honours `GO`
- `scripts/db-check.mjs` — live smoke test of the whole data layer
- `scripts/dbConfig.mjs` — shared connection-string parsing
- Removed the three `pool.connect()` call sites and the dead `PoolClient` export
- `package.json` (`pg` → `mssql`), `.env.example`, `README.md`, `tsconfig.json`

`npm test`, `npx tsc --noEmit` and `npm run build` all pass.

**Not yet verified against a real SQL Server** — no instance was available.
`npm run db:check` is the first thing to run once one is.

---

## Not done

### 1. The `sql/` files (51 files) — biggest single chunk
Mostly mechanical but high volume:

| Postgres | SQL Server | Count |
|---|---|---|
| `SERIAL` | `INT IDENTITY(1,1)` | 27 |
| `TIMESTAMPTZ` | `DATETIMEOFFSET` | 58 |
| `TEXT` | `NVARCHAR(MAX)` | 78 |
| `BOOLEAN` / `TRUE` / `FALSE` | `BIT` / `1` / `0` | 34 |
| `JSONB` | `NVARCHAR(MAX)` + `ISJSON` check | 4 |
| `CREATE TABLE IF NOT EXISTS` | `IF OBJECT_ID(…) IS NULL` | 32 |
| `ADD COLUMN IF NOT EXISTS` | `IF COL_LENGTH(…) IS NULL` | 78 |
| `CREATE INDEX IF NOT EXISTS` | `IF NOT EXISTS (SELECT 1 FROM sys.indexes …)` | 69 |
| `set_updated_at()` plpgsql + 12 triggers | per-table `AFTER UPDATE` trigger joined on `inserted` | 13 |
| `ON CONFLICT` | `MERGE` or `IF EXISTS / ELSE` | 25 |
| `DISTINCT ON` | `ROW_NUMBER()` | 2 |
| `DO $$ … $$` | plain batch | 2 |

Triggers must be the first statement in their batch — put a `GO` line
before each one. Give every trigger `SET NOCOUNT ON` so it does not
inflate the `rowsAffected` that `execute()` returns.

### 2. Application queries
| Postgres | SQL Server | Count |
|---|---|---|
| `::int` and friends | usually just delete it — `COUNT(*)` is already an `int` here | 171 |
| `LIMIT n` | `TOP (n)`, or `OFFSET … FETCH` when ordered | 42 |
| `RETURNING` | `OUTPUT INSERTED.id` — **and `OUTPUT … INTO @t` on the 12 tables that have triggers** | 29 |
| `ON CONFLICT` | `MERGE` or `IF NOT EXISTS` | 27 |
| `NULLS LAST` | `ORDER BY CASE WHEN x IS NULL THEN 1 ELSE 0 END, x` | 23 |
| `ILIKE` | `LIKE` (SQL Server collations are case-insensitive by default) | 20 |
| `NOW()`, `CURRENT_DATE`, `INTERVAL`, `to_char` | `SYSDATETIMEOFFSET()`, `DATEADD`, `FORMAT` | ~30 |
| `FILTER (WHERE …)` | `SUM(CASE WHEN … END)` | 5 |
| `DISTINCT ON` | `ROW_NUMBER()` | 2 |
| `WITH RECURSIVE` | drop the `RECURSIVE` keyword | 1 |
| `generate_series` | recursive CTE or a numbers table | 1 |

### 3. `array_agg` — the one piece with no direct equivalent
`src/features/admin/users/repository.ts` builds `brand_ids`, `brand_names`,
`department_ids`, … as Postgres arrays and the TypeScript reads them as
`number[]` / `string[]`. SQL Server has no array type. Options are
`STRING_AGG` plus a split on the way out, or `FOR JSON PATH` plus
`JSON.parse`. Either way `UserRow` and its consumers change.

### 4. Remaining scripts
`scripts/import_sop_grc_workbook.mjs`, `scripts/remove_legacy_it_hr_seed.cjs`
and the two ad-hoc `scripts/*.sql` files still use `pg` and Postgres syntax.

---

## Traps that will not fail the build

These compile and deploy fine, then behave wrongly at runtime. They are
the reason a file-by-file pass is needed rather than "does it build":

1. **`WHERE is_active`** — valid in Postgres, a syntax error in SQL Server
   (`BIT` is not a predicate). Must become `WHERE is_active = 1`. There are
   11 of these.
2. **`NULLS LAST`** — Postgres sorts NULLs last by default on `ASC`;
   SQL Server sorts them **first**. Ordering silently changes.
3. **`COALESCE($1, non_text_column)`** — a NULL parameter binds as
   NVARCHAR, and type precedence makes the whole expression NVARCHAR.
   Add an explicit `CAST` in the SQL at these sites.
4. **`RETURNING` on a table with a trigger** — plain `OUTPUT` fails with
   error 334; it needs `OUTPUT … INTO @table`.
5. **`execute()` return value** — comes from `rowsAffected`. A trigger
   without `SET NOCOUNT ON` inflates it, which would break the
   `if (result === 0) throw` checks.

---

## Suggested order

1. Stand up a SQL Server instance and run `npm run db:check`.
2. Convert `sql/001_schema.sql` and confirm `npm run db:migrate` works
   against an empty database.
3. Convert the rest of `sql/` in order.
4. Convert queries feature by feature, starting with auth (`src/lib/auth/`)
   so you can log in, then SOPs, then the rest.
5. Leave `array_agg` (users repository) and the reporting pages — the
   heaviest date/aggregate logic — for last.
