# PostgreSQL → SQL Server query conversion guide

How every query in `src/` is converted. The schema is already done
(`sql/001_baseline.sql`, generated from the real PostgreSQL catalog); this
guide covers the application SQL.

**Goal: identical behaviour to the PostgreSQL edition.** Same rows, same
order, same JS types coming back, same errors. When in doubt, preserve what
PostgreSQL + the `pg` driver actually did — not what the code comment says.

---

## 0. What the data layer already does (do NOT hand-convert these)

`src/lib/db.ts` + `src/lib/sqlTranslate.ts` keep the pg call surface
(`queryAll` / `queryOne` / `execute` / `withTransaction` → `client.query`)
and translate at runtime:

| Keep writing | Becomes | Notes |
|---|---|---|
| `$1`, `$2` … | `@p1`, `@p2` … | reuse of the same `$n` is fine |
| `col = ANY($1)` / `= ANY($1::int[])` | `col IN (@p1_0, …)` | JS array param; empty array → matches nothing (like PG) |
| `col <> ALL($1)` | `col NOT IN (…)` | empty array → matches everything (like PG) |
| alias `AS something__json` | row key `something`, JSON-parsed | see §4 |

Anything else PostgreSQL-specific must be rewritten by hand, in place, as
native T-SQL. Keep the `$n` placeholders.

Parameter binding (db.ts `bind`): JS number → INT/BIGINT/FLOAT, boolean →
BIT, Date → DATETIMEOFFSET, string → NVARCHAR, **null → NVARCHAR(MAX)**,
object → JSON string. A JS array is only legal inside `ANY(...)`/`ALL(...)`.

---

## 1. Schema facts you need

- Types: INT, SMALLINT, BIT (booleans), DATE, DATETIMEOFFSET(3) (all
  timestamps, stored UTC), DECIMAL(5,2) (`audits.score` only),
  NVARCHAR(n), NVARCHAR(MAX) (text/jsonb). Nullability of every column is
  in `sql/001_baseline.sql` — check it when a rule below depends on it.
- `audit_responses.percent` is a reserved word: write `[percent]`.
- **Tables with an AFTER UPDATE trigger** (updated_at): audit_responses,
  audits, checklist_templates, checks, config_options, controls,
  corrective_actions, divisions, domains, frameworks, org_units, sops.
- **Tables with an INSTEAD OF DELETE trigger** (ON DELETE emulation):
  audits, brands, checklist_items, checklist_templates, checks, controls,
  corrective_actions, departments, divisions, domains, frameworks,
  org_units, sops, users.
- No table has an INSERT trigger.
- Database collation is case-insensitive (`SQL_Latin1_General_CP1_CI_AS`).

---

## 2. Rewrite rules

### Casts `::type`
- `COUNT(*)::int`, `SUM(int)::int`, `x::int` where x is already INT → just drop the cast.
- `$1::int`, `$1::text` etc. → drop, **unless** the parameter can be NULL and its
  type matters (COALESCE/CASE result, arithmetic, `IS NULL OR col = $1` is fine
  without). Then `CAST($1 AS INT)`. Null params arrive as NVARCHAR(MAX), so
  `COALESCE($1, some_int_col)` silently becomes text — always CAST those.
- `x::text` → `CAST(x AS NVARCHAR(50))` (size to fit). For DATE → text
  PostgreSQL gives `YYYY-MM-DD`: use `CONVERT(NVARCHAR(10), x, 23)`.
- `x::date` → `CAST(x AS DATE)`. `x::numeric` / `x::float` → `CAST(x AS DECIMAL(18,4))` / `CAST(x AS FLOAT)`.
- `ARRAY[]::text[]` fallbacks → `'[]'` inside a `__json` column (§4).

### Result JS types — must match what `pg` returned
`pg` returned: INT/SMALLINT → number; **BIGINT (a bare `COUNT(*)` or
`SUM(int)` without cast) → string**; NUMERIC/DECIMAL → **string**; BOOLEAN →
boolean; DATE / TIMESTAMPTZ → Date; JSONB → parsed object; arrays → JS arrays.
`mssql` returns: INT → number, BIGINT → string, DECIMAL/FLOAT → number,
BIT → boolean, DATE/DATETIMEOFFSET → Date, NVARCHAR → string.

So:
- Check the TypeScript row type on the call (`queryAll<{ n: number }>`) and
  how the value is used. If the code treats a value as a **string** (declared
  `string`, `.toFixed` absent, used in string ops) and PG produced NUMERIC
  text, produce text: e.g. `ROUND(AVG(score)::numeric, 1)::text` →
  `CAST(CAST(ROUND(AVG(CAST(score AS DECIMAL(18,4))), 1) AS DECIMAL(18,1)) AS NVARCHAR(40))`
  (the inner DECIMAL(18,1) is what makes it print `87.5`, not `87.5000`).
  `a.score::text` (DECIMAL(5,2)) → `CAST(a.score AS NVARCHAR(20))` gives `87.50` exactly like PG.
- A computed boolean must come back as a JS boolean: `CAST(... AS BIT)`.
  `COALESCE(bit_col, 0)` / `ISNULL` / `CASE ... THEN 1 ELSE 0` all return
  INT (number) — wrap in `CAST(... AS BIT)`.

### Booleans
- `WHERE is_active` → `WHERE is_active = 1`; `NOT is_active` → `is_active = 0`;
  `= TRUE`/`= FALSE`/`IS TRUE` → `= 1`/`= 0`.
- Literal `TRUE`/`FALSE` in VALUES/SET → `1`/`0`.
- A boolean expression in the SELECT list (`a > b AS flag`, `x IS NULL AS f`,
  `EXISTS(...) AS f`) is not valid T-SQL →
  `CAST(CASE WHEN <expr> THEN 1 ELSE 0 END AS BIT) AS flag`.

### Aggregates
- `COUNT(*) FILTER (WHERE c)` → `SUM(CASE WHEN c THEN 1 ELSE 0 END)` (wrap in
  `COALESCE(..., 0)` if PG could never return NULL there — COUNT never does,
  SUM over zero rows does).
- `AGG(x) FILTER (WHERE c)` → `AGG(CASE WHEN c THEN x END)`.
- **`AVG(int_col)` is integer-truncated in T-SQL.** PG returns a fraction →
  `AVG(CAST(x AS DECIMAL(18,4)))` or `AVG(CAST(x AS FLOAT))`.
- `ROUND(x, n)` keeps the input scale in T-SQL (87.5000); fine for numbers,
  cast to `DECIMAL(18,n)` when you need exact text.
- `ROUND(x)` (one arg) → `ROUND(x, 0)`.
- `array_agg` → §4.

### GROUP BY — the silent PG extension
PostgreSQL lets you `GROUP BY t.id` and still select `t.name`, `t.*` etc.
(functional dependency on the primary key). **T-SQL does not**: every
non-aggregated selected column must be in GROUP BY (or be aggregated). Add the
columns to GROUP BY; for `t.*` list the columns. No positional `GROUP BY 1`.

### Strings
- `a || b` → `a + b`. Keep `+` (not CONCAT) so a NULL operand still gives NULL
  like PG. Non-string operands need `CAST(x AS NVARCHAR(n))` or `+` becomes
  arithmetic.
- `ILIKE` → `LIKE` (collation is case-insensitive). Note T-SQL LIKE treats
  `[` as a wildcard class — acceptable.
- `LPAD(s, n, '0')` → `RIGHT(REPLICATE('0', n) + s, n)` (only for s shorter
  than n, which is the case for sequence numbers).
- `INITCAP` has no equivalent — do it in JS after the query if needed.
- `length(s)` → `LEN(s)`; `position(a in b)` → `CHARINDEX(a, b)`;
  `substring(s from i for n)` → `SUBSTRING(s, i, n)`; `lower/upper/trim` fine.

### Dates and time — everything stored and compared in UTC
- `NOW()` / `CURRENT_TIMESTAMP` → `SYSUTCDATETIME()`.
- `CURRENT_DATE` → `CAST(SYSUTCDATETIME() AS DATE)`.
- `x + INTERVAL '7 days'` → `DATEADD(day, 7, x)`; `NOW() - INTERVAL '30 days'`
  → `DATEADD(day, -30, SYSUTCDATETIME())`. `$1 * INTERVAL '1 day'` → `DATEADD(day, $1, x)`.
- `date_a - date_b` (days, int in PG) → `DATEDIFF(day, date_b, date_a)`.
- `to_char(x, 'YYYY-MM')` → `FORMAT(x, 'yyyy-MM')` (FORMAT is .NET format strings).
- `date_trunc('month', x)` → `DATEFROMPARTS(YEAR(x), MONTH(x), 1)`.
- `EXTRACT(...)` → `DATEPART(...)`.

### Ordering — NULLs sort the other way
PostgreSQL: ASC puts NULLs **last**, DESC puts them **first**.
SQL Server: ASC puts NULLs **first**, DESC puts them **last**.
For every ORDER BY key that can be NULL (nullable column, LEFT JOIN column,
CASE without ELSE, aggregate over maybe-no-rows):
- `x` / `x ASC` / `x NULLS LAST` → `CASE WHEN x IS NULL THEN 1 ELSE 0 END, x`
- `x DESC` / `x DESC NULLS FIRST` → `CASE WHEN x IS NULL THEN 0 ELSE 1 END, x DESC`
- `x DESC NULLS LAST` → `x DESC`; `x ASC NULLS FIRST` → `x`.
NOT NULL columns need nothing.

### LIMIT / OFFSET / DISTINCT ON
- `... ORDER BY z LIMIT n` → `SELECT TOP (n) ... ORDER BY z`. Param: `TOP ($1)`.
- `LIMIT n OFFSET m` → `ORDER BY ... OFFSET m ROWS FETCH NEXT n ROWS ONLY`
  (needs an ORDER BY).
- `(SELECT x FROM ... ORDER BY y LIMIT 1)` → `(SELECT TOP (1) x FROM ... ORDER BY y)`.
- ORDER BY inside a derived table / CTE / subquery is invalid without TOP.
- `DISTINCT ON (k) ... ORDER BY k, z` →
  `SELECT ... FROM (SELECT ..., ROW_NUMBER() OVER (PARTITION BY k ORDER BY z) AS rn FROM ...) s WHERE rn = 1`
  (don't let `rn` leak if the caller spreads the row — select explicit columns).

### Writes
- `INSERT ... RETURNING cols` → `INSERT INTO t (...) OUTPUT INSERTED.col1, INSERTED.col2 VALUES (...)`
  (fine on every table: none has an INSERT trigger). `RETURNING *` → `OUTPUT INSERTED.*`.
- `UPDATE/DELETE ... RETURNING` → a plain `OUTPUT` **fails (error 334)** on the
  trigger tables listed in §1. Use:
  ```sql
  DECLARE @out TABLE (id INT, code NVARCHAR(40));
  UPDATE corrective_actions SET ... OUTPUT INSERTED.id, INSERTED.code INTO @out WHERE id = $1;
  SELECT id, code FROM @out;
  ```
  or run the UPDATE then `SELECT ... WHERE id = $1` in the same query text.
  Use this form for every UPDATE/DELETE RETURNING, trigger table or not.
  Do not send such a multi-statement text through `execute()` expecting a
  write count — use `queryOne`/`queryAll` for anything that returns rows.
- `UPDATE t a SET ... FROM x WHERE ...` (alias on target) →
  `UPDATE a SET ... FROM t a JOIN x ON ...`. `DELETE FROM t USING x WHERE` →
  `DELETE t FROM t JOIN x ON ...`.
- `ON CONFLICT (k) DO NOTHING` → `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM t WHERE k = ...)`.
  For single-row VALUES: `IF NOT EXISTS (SELECT 1 FROM t WHERE k = $1) INSERT INTO t ... VALUES (...);`
- `ON CONFLICT (k) DO UPDATE SET c = EXCLUDED.c` →
  ```sql
  MERGE INTO t WITH (HOLDLOCK) AS tgt
  USING (SELECT $1 AS k, $2 AS c) AS src ON tgt.k = src.k
  WHEN MATCHED THEN UPDATE SET c = src.c
  WHEN NOT MATCHED THEN INSERT (k, c) VALUES (src.k, src.c);
  ```
  (MERGE must end with `;`). With RETURNING → `OUTPUT ... INTO @out` + SELECT.
  The PG `(xmax = 0) AS inserted` trick → MERGE `OUTPUT $action` into @out
  (`'INSERT'`/`'UPDATE'`) and return `CAST(CASE WHEN action = 'INSERT' THEN 1 ELSE 0 END AS BIT) AS inserted`.
- `unnest($1::text[])` → pass `JSON.stringify(array)` as the param and use
  `SELECT value AS n FROM OPENJSON($1)`.
- Row-count checks (`if (n === 0)`) keep working: `execute()` returns the
  statement's affected-row count, triggers don't inflate it.

### Other
- `WITH RECURSIVE` → `WITH`.
- `a IS DISTINCT FROM b` → `(a <> b OR (a IS NULL AND b IS NOT NULL) OR (a IS NOT NULL AND b IS NULL))`;
  `a IS NOT DISTINCT FROM b` → `(a = b OR (a IS NULL AND b IS NULL))`.
- `generate_series` → a recursive CTE or a VALUES list.
- `random()` → `NEWID()` in ORDER BY.
- `GREATEST/LEAST` → `IIF` / CASE (none in the code today).
- PG error codes: unique violation `23505` → `err.number === 2627 || err.number === 2601`;
  FK violation `23503` → `547`.

---

## 3. What to leave alone

- Placeholders `$n`, `= ANY($n)`, `<> ALL($n)`.
- Plain ANSI SQL: JOINs, CASE, COALESCE, NULLIF, EXISTS in WHERE, window
  functions, CTEs, UNION, subqueries, `IN (...)`.
- Double-quoted identifiers are valid (QUOTED_IDENTIFIER is on).
- SQL fragments exported as constants and interpolated with `${...}` — convert
  them where they are defined, and check every place they are interpolated.

---

## 4. Arrays and JSON (`__json` columns)

SQL Server has no array type. Build JSON text and alias the column with the
`__json` suffix; `db.ts` parses it and strips the suffix, so the row has the
exact key and shape the code already reads.

- int array: `COALESCE('[' + (SELECT STRING_AGG(CAST(x.id AS NVARCHAR(20)), ',') WITHIN GROUP (ORDER BY x.id) FROM ... ) + ']', '[]') AS department_ids__json`
- string array: `COALESCE('[' + (SELECT STRING_AGG('"' + STRING_ESCAPE(x.name, 'json') + '"', ',') WITHIN GROUP (ORDER BY x.name) FROM ...) + ']', '[]') AS department_names__json`
- Keep the SAME ordering the `array_agg(... ORDER BY ...)` had — code often
  zips an ids array with a names array by index, so both must use one order.
- PG `array_agg` over zero rows gives NULL; if the PG query had
  `COALESCE(array_agg(...), '{}')` produce `'[]'`, otherwise produce NULL
  (drop the outer COALESCE) — match what the TS type/usage expects.
- JSONB columns (`audit_logs.details`, `deleted_records.snapshot`,
  `sop_versions.snapshot`) are NVARCHAR(MAX): when the code reads them as
  objects, select `details AS details__json`. Writing them: pass the JS
  object (db.ts stringifies) or `JSON.stringify(...)`.
- STRING_AGG on NVARCHAR(MAX)-sized input is fine; on shorter types it caps at
  8000 bytes — cast the argument to `NVARCHAR(MAX)` when the list can be long.
