# Moving the existing data from PostgreSQL to SQL Server

One command copies **everything** from the old (PostgreSQL) Swish Compliance
database into the new SQL Server one: users and their passwords, SOPs,
frameworks, controls, tests, checklists, audits and answers, CAPAs,
attachments, notifications and the audit log. Record ids are kept, so every
link between records survives, and people sign in with the same passwords.

It is safe to run and to re-run:

- The old database is opened **read only** in one consistent snapshot. Nothing
  can be written to it.
- Everything written to SQL Server is **one transaction**. It is kept only if
  every table was copied **and every cell verified** against PostgreSQL;
  otherwise SQL Server is left exactly as it was.
- It will not overwrite a SQL Server database that already holds real data
  unless you add `--replace`.

## What you need

| | |
|---|---|
| `DATABASE_URL` | The new SQL Server database, same value as the app's `.env.local` (`mssql://user:password@host:1433/database`). The login needs the `dbcreator` role, or the database must already exist (see DEPLOY-IT.md). |
| `PG_SOURCE_URL` | The **old** PostgreSQL database, `postgres://user:password@host:port/database`. On Railway this is the Postgres service's **public** connection (Railway → Postgres → Connect / Networking → TCP proxy); the internal `*.railway.internal` address is not reachable from outside. |
| The project folder | `npm ci` done (this installs the `pg` driver the tool uses). |

Stop the application that uses the SQL Server database while this runs, and
ask people to stop using the **old** system from the moment you start the
final copy (changes made after that are not copied; you can always run the
command again later to refresh with `--replace`).

## Commands

### Windows (PowerShell), from the project folder

```powershell
$env:DATABASE_URL  = "mssql://compliance_app:<password>@<sql-server>:1433/swish_compliance"
$env:PG_SOURCE_URL = "postgres://<user>:<password>@<railway-host>:<port>/railway"

# 1. Check everything first. Copies nothing.
node scripts/migrate-from-postgres.mjs --dry-run

# 2. Copy the data.
node scripts/migrate-from-postgres.mjs
```

### Linux / macOS

```bash
export DATABASE_URL='mssql://compliance_app:<password>@<sql-server>:1433/swish_compliance'
export PG_SOURCE_URL='postgres://<user>:<password>@<railway-host>:<port>/railway'

node scripts/migrate-from-postgres.mjs --dry-run      # 1. check, copies nothing
node scripts/migrate-from-postgres.mjs                # 2. copy
```

(`npm run migrate:from-postgres -- --dry-run` does the same thing.)
Put passwords containing `@ : / #` in percent-encoding (`@` → `%40`).

## What you will see

```
== 1/6  Preparing the SQL Server schema ...
== 2/6  Connecting to PostgreSQL (read only snapshot)
== 3/6  Comparing both sides          <- table-by-table row counts, old vs new
== 4/6  Copying (one transaction; nothing is kept unless everything verifies)
== 5/6  Re-enabling triggers and constraints (this also validates every link between records)
== 6/6  Verifying every cell against PostgreSQL
   ✓ users                      5 rows identical
   ...
Done. 418 rows in 34 tables copied and verified.
```

The dry run ends with "Structure matches" and does not copy anything (it does
create the empty tables if the database is brand new). After the real run,
start the application (`npm start`) and sign in with an existing account.

## If it stops with "FAILED"

It always ends with "Nothing was changed in the SQL Server data." Typical causes:

| Message | Meaning / fix |
|---|---|
| `PG_SOURCE_URL and DATABASE_URL must both be set` | Set both variables (see above). |
| `connect ECONNREFUSED` / `password authentication failed` | The PostgreSQL address or password is wrong, or its public/TCP-proxy access is not enabled. |
| `The two databases do not have the same structure ...` | The old system is on a different version than this SQL Server edition. It lists the exact table/column differences. Bring the old system to its latest version (or ask the developer) and retry. |
| `The SQL Server database already contains data` | Add `--replace` only if you really want to replace what is there. |
| `... conflicted with the FOREIGN KEY constraint ...` | The old database contains a record that points at something that no longer exists. Nothing was copied; send the message to the developer. |

## Good to know

- Times are stored by SQL Server to the millisecond (PostgreSQL keeps microseconds). Nothing visible changes.
- The JSON stored in the audit log / version history is copied with the same
  content; PostgreSQL may list the keys of each entry in a different order.
- The last line of a successful run prints a *content fingerprint*. Running
  the copy again on unchanged data prints the same value, which is a quick way
  to confirm two copies are identical.
- Afterwards remove the Railway TCP proxy / public access if it was only
  created for this migration.
