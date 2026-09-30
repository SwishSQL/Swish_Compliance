# Deploying Swish Compliance on a company SQL Server

For the IT team. Everything the app needs from the database is in `sql/`.

## 1. Create the database and a login

Run once as a SQL Server administrator (SSMS / sqlcmd). Pick your own names
and a strong password.

```sql
CREATE DATABASE swish_compliance;
GO
CREATE LOGIN compliance_app WITH PASSWORD = '<strong password>', CHECK_POLICY = ON;
GO
USE swish_compliance;
CREATE USER compliance_app FOR LOGIN compliance_app;
ALTER ROLE db_owner ADD MEMBER compliance_app;   -- needed for the schema migration
GO
```

Keep the default collation (case-insensitive, e.g. `SQL_Latin1_General_CP1_CI_AS`
or an Arabic/Latin CI equivalent). Text columns are `NVARCHAR`, so Arabic works.
After the first deployment you may reduce the login to
`db_datareader` + `db_datawriter` + `db_ddladmin`; the app itself only reads
and writes data (schema changes happen only in `npm run db:migrate`).

## 2. Configure

Copy `.env.example` to `.env.local` (or set real environment variables):

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `mssql://compliance_app:<password>@<host>:1433/swish_compliance` — percent-encode special characters in the password (`@` → `%40`). Add `?encrypt=true&trustServerCertificate=true` if the server uses a self-signed certificate. |
| `JWT_SECRET` | At least 16 random characters: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `NODE_ENV` | `production` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first administrator, created by the migration only if the `users` table is empty. Change the password after first login (Account page). |
| `SESSION_COOKIE_SECURE` | Optional. The login cookie is HTTPS-only in production. **Serve the app over HTTPS** (reverse proxy / IIS ARR / nginx). Only if it must run on plain `http://` inside the intranet, set this to `false`, otherwise login appears to succeed and then bounces back to the login page. |

## 3. Install, migrate, run

```bash
npm ci
npm run db:check        # every line should be ✓
npm run db:migrate      # creates tables, triggers, seed data, first admin
npm run build
npx next start -p <port>          # or: npm start (port 3001)
```

Run it as a service (PM2, NSSM, Windows Service, systemd) behind the HTTPS
reverse proxy. The process needs outbound access to the SQL Server only.

Alternatively a DBA can apply the schema by hand: run `sql/001_baseline.sql`
then `sql/002_seed.sql` in SSMS (the files use `GO` separators), then start
the app. `db:migrate` also creates the first admin user, so prefer it.

## 4. Upgrades

Pull the new version, `npm ci`, `npm run db:migrate` (applies only new
`sql/00N_*.sql` files), `npm run build`, restart.

## 5. First steps after login

1. Change the admin password (Account page).
2. Administration → Users: create users and give them a role and department(s).
3. Administration → Departments: assign each department's manager.
4. Load content with Administration → Import Data (GRC workbook), or create SOPs by hand.

## Backups

Everything lives in the one database (attachments are stored inside it as
base64 text, up to ~10 MB each). A normal SQL Server backup of `swish_compliance` is the
complete backup.
