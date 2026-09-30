# Swish Compliance (SQL Server edition)

GRC / compliance management app: SOP register with a multi-stage approval
workflow, audits (graded Yes / No / N-A answers, several SOPs per audit),
corrective actions (CAPA) with bulk assignment, frameworks → controls →
tests → checklists → questions, dashboards and an admin area.

**Next.js 15 · React 19 · TypeScript · Microsoft SQL Server (`mssql`)**

This is the SQL Server edition of
[swish-compliance](https://github.com/swish-code/swish-compliance) (PostgreSQL).
Same features, same screens; only the data layer differs. To deploy it on a
server, follow **[docs/DEPLOY-IT.md](docs/DEPLOY-IT.md)**.

## Requirements

- Node.js **22.6+**
- Microsoft SQL Server **2019+** (developed and tested on SQL Server 2025) or Azure SQL

## Quick start

```bash
npm install
cp .env.example .env.local      # set DATABASE_URL and JWT_SECRET
npm run db:check                # connects and exercises the data layer
npm run db:migrate              # creates the schema + seed data + first admin
npm run build && npm start      # http://localhost:3001
```

`npm run dev` runs the development server instead of the production build.

## Scripts

| Command | What it does |
|---|---|
| `npm run db:migrate` | Applies every `sql/*.sql` file not yet applied (tracked in `schema_migrations`), then creates the first admin user if the users table is empty. Safe to re-run. |
| `npm run db:check` | Smoke test of the database layer against your server. Run it first if anything looks wrong. |
| `npm test` | Unit tests for the query translator and the migration batch splitter. |
| `node tools/sqlcheck.mjs <file.sql> '[params]'` | Runs one query against the database inside a transaction that is always rolled back. |

## How the database layer works

All queries are written in **native T-SQL**. `src/lib/db.ts` keeps the same
four helpers the PostgreSQL edition used (`queryAll`, `queryOne`, `execute`,
`withTransaction`) and `src/lib/sqlTranslate.ts` converts only the parameter
placeholders (`$1` → `@p1`) and `= ANY($1)` array comparisons at runtime.

- Arrays and JSON: SQL Server has no array type, so queries build JSON text
  and alias the column `something__json`; `db.ts` parses it back to a JS value.
- Schema: `sql/001_baseline.sql` is the complete schema (generated from the
  final PostgreSQL schema), `sql/002_seed.sql` the reference data. To change
  the schema later, add `sql/003_….sql`; never edit an applied file.
- `ON DELETE CASCADE / SET NULL` rules are implemented with `INSTEAD OF DELETE`
  triggers at the end of `001_baseline.sql` (SQL Server rejects most of the
  original rules as multiple cascade paths).
- Porting future PostgreSQL-side changes: see
  [docs/TSQL-CONVERSION-GUIDE.md](docs/TSQL-CONVERSION-GUIDE.md).

## Roles

`admin`, `ceo`, `business_excellence`, `compliance`, `opex`,
`department_manager`, `auditor`, `viewer`. Admin, Compliance and Business
Excellence see everything; other roles only see their own department(s).

## Project layout

```
sql/                 schema + seed (T-SQL, GO-separated batches)
scripts/             migrate.mjs, db-check.mjs, helpers
tools/               sqlcheck.mjs, schema-gen/ (regenerates 001/002 from a PostgreSQL catalog)
docs/                DEPLOY-IT.md, TSQL-CONVERSION-GUIDE.md
src/lib/             db.ts, sqlTranslate.ts, env.ts, auth/, admin/, grcImport/
src/features/        one folder per module (repository.ts + actions.ts + UI)
src/app/(authed)/    all signed-in pages
```
