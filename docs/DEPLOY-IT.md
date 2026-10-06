# Deploying Swish Compliance on a company SQL Server

For the IT team. Everything the app needs from the database is in `sql/`.

## 1. Create a SQL login

**The app creates the database and every table by itself on its first start** —
you only need a login. Run once as a SQL Server administrator (SSMS / sqlcmd),
with your own name and a strong password:

```sql
CREATE LOGIN compliance_app WITH PASSWORD = '<strong password>', CHECK_POLICY = ON;
ALTER SERVER ROLE dbcreator ADD MEMBER compliance_app;   -- lets it create its database
```

The database is created with a case-insensitive collation
(`Latin1_General_100_CI_AS`) and owned by this login. Text columns are
`NVARCHAR`, so Arabic works.

*If policy does not allow the app to create databases*, create an empty database
yourself instead and give the login `db_owner` on it (skip the `dbcreator` line);
the app then only creates the tables inside it:

```sql
CREATE DATABASE swish_compliance COLLATE Latin1_General_100_CI_AS;
GO
USE swish_compliance;
CREATE USER compliance_app FOR LOGIN compliance_app;
ALTER ROLE db_owner ADD MEMBER compliance_app;
```

## 2. Configure

Copy `.env.example` to `.env.local` (or set real environment variables):

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `mssql://compliance_app:<password>@<host>:1433/swish_compliance` — percent-encode special characters in the password (`@` → `%40`). Add `?encrypt=true&trustServerCertificate=true` if the server uses a self-signed certificate. |
| `JWT_SECRET` | At least 16 random characters: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `NODE_ENV` | `production` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first administrator, created on first start only if the `users` table is empty. Change the password after first login (Account page). |
| `SKIP_AUTO_MIGRATE` | Optional. `true` turns the automatic database setup off (then run `npm run db:migrate` yourself). |
| `SESSION_COOKIE_SECURE` | Optional. The login cookie is HTTPS-only in production. **Serve the app over HTTPS** (reverse proxy / IIS ARR / nginx). Only if it must run on plain `http://` inside the intranet, set this to `false`, otherwise login appears to succeed and then bounces back to the login page. |

## 3. Install and run

```bash
npm ci
npm run build
npm start                          # listens on port 6011 (change it in package.json to use another)
```

On **every start** the app first makes sure the database is ready, and logs it:

```
[db] database "swish_compliance" does not exist — creating it.     (first start only)
[migrate] applying 001_baseline.sql ...                              (first start only)
[migrate] first admin 'admin@…' created from ADMIN_EMAIL / ADMIN_PASSWORD.
[db] schema is up to date.                                          (every later start)
```

If setup fails (wrong password, server unreachable, no permission to create
the database) the log says why and the process **exits with code 1** instead of
serving a broken app. Two instances starting at once are safe: the second waits
for the first.

Optional checks before the first start: `npm run db:check` (connection and data
layer) and `npm run db:migrate` (runs the same setup by hand).

Run it as a service (PM2, NSSM, Windows Service, systemd) behind the HTTPS
reverse proxy. The process needs outbound access to the SQL Server only.

Prefer to apply the schema by hand? Run `sql/001_baseline.sql` then
`sql/002_seed.sql` in SSMS (they use `GO` separators) and start the app with
`SKIP_AUTO_MIGRATE=true`. Note the first admin is only created by the automatic
setup / `db:migrate`.

## 4. Upgrades

Pull the new version, `npm ci`, `npm run build`, restart. Any new
`sql/00N_*.sql` files are applied automatically on that start.

## 5. Move the existing data (only when replacing the old PostgreSQL system)

Stop the app, then follow [MIGRATE-FROM-POSTGRES.md](MIGRATE-FROM-POSTGRES.md): one command
copies every table, keeps all ids and passwords, and verifies each cell before
keeping anything. Then start the app again. Skip this step for a fresh install.

## 6. First steps after login

1. Change the admin password (Account page).
2. Administration → Users: create users and give them a role and department(s).
3. Administration → Departments: assign each department's manager.
4. Load content with Administration → Import Data (GRC workbook), or create SOPs by hand.

## Backups

Everything lives in the one database (attachments are stored inside it as
base64 text, up to ~10 MB each). A normal SQL Server backup of `swish_compliance` is the
complete backup.
