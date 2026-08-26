# Swish Compliance (SQL Server edition)

Full-stack compliance management app — SOP register, audits, CAPA tracking, and dashboards. Built with **Next.js 16 + Microsoft SQL Server**.

> This repository is the SQL Server port of
> [swish-compliance](https://github.com/swish-code/swish-compliance), which
> runs on PostgreSQL. The port is **in progress** — see
> [PORTING.md](./PORTING.md) for what is done, what is not, and what to
> watch out for. Until that document says otherwise, treat this repo as
> not yet ready to run against a live database.

## What it does

A central place to manage Standard Operating Procedures (SOPs) and the compliance lifecycle around them:

- **SOP register** — create, edit, version, approve and archive SOPs scoped by brand + department
- **Approval workflow** — draft → pending review → approved (or rejected). Permissions enforced per role.
- **Audit log** — every state-changing action is recorded with user, timestamp and details
- **Personal work queue** — quick KPIs for what's pending, what you own, what's approved

> **In this version** the SOP module is fully functional end-to-end. Audits, CAPA, Evidence, Frameworks and Dashboard are scaffolded as placeholder pages and ready to be implemented next.

## Tech stack

| Layer    | Stack |
|----------|-------|
| Framework | Next.js 16 (App Router) + React 19 |
| Language  | TypeScript |
| Styling   | Tailwind CSS v4 |
| Auth      | Custom: bcryptjs + JWT (HS256) in an HTTP-only cookie via `jose` |
| Database  | Microsoft SQL Server (via `mssql`) |
| Validation| Zod |
| Runtime   | Node.js ≥ 22.6 |

## Quick start

### Prerequisites
- Node.js 22.6+ (the test suite relies on built-in TypeScript stripping)
- Microsoft SQL Server 2019+ / Azure SQL (local Docker image works fine)

### 1. Install
```bash
npm install
```

### 2. Configure
```bash
cp .env.example .env.local
# Edit .env.local — set DATABASE_URL and JWT_SECRET
```

Generate a JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Check the connection
```bash
npm run db:check
```

Connects, then exercises the data layer end to end — parameter binding for
every type, array expansion, result shapes and transactions. Run this first;
if it fails, nothing else will work.

### 4. Migrate + seed
```bash
npm run db:migrate
```

Applies every `sql/*.sql` file that has not run yet, tracking them in a
`schema_migrations` table, then seeds a bootstrap admin user
(`admin@swish.local` / `admin123` by default, or `ADMIN_EMAIL` /
`ADMIN_PASSWORD` from env).

> The SQL files are still being converted to T-SQL — see [PORTING.md](./PORTING.md).

### 5. Run
```bash
npm run dev   # http://localhost:3001
```

Sign in with the admin credentials above. Go to **Compliance → SOPs → + New SOP**.

## Tests

```bash
npm test
```

Covers the pg-to-T-SQL query translator and the migration batch splitter —
the two pieces of pure logic the whole data layer rests on.

## Deploy

`railway.json` is configured to run `npm run db:migrate && npm start` on
boot. Set these env vars on the service:

- `DATABASE_URL` → your SQL Server connection string (see `.env.example`)
- `JWT_SECRET` → long random string (use the generator above)
- `NODE_ENV` → `production`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` → bootstrap admin credentials

Migrations are tracked and never re-applied, so redeploying is safe.

## Project layout

```
swish-compliance/
├── sql/
│   ├── 001_schema.sql        # All tables, indexes, triggers (IF NOT EXISTS)
│   └── 002_seed.sql          # Reference brands + departments
├── scripts/
│   └── migrate.mjs           # Applies all sql/*.sql + bootstraps admin user
├── src/
│   ├── middleware.ts         # Cookie auth guard for /api/* and protected pages
│   ├── lib/
│   │   ├── env.ts            # Zod-validated env vars
│   │   ├── db.ts             # SQL Server pool + query helpers
│   │   ├── sqlTranslate.ts   # pg $1 placeholders -> T-SQL @p1 parameters
│   │   └── auth/
│   │       ├── session.ts    # JWT sign/verify, cookie management, password check
│   │       └── guard.ts      # requireUser() + role helpers
│   ├── features/
│   │   ├── shell/            # Sidebar, Workspace layout, Placeholder
│   │   └── sops/             # repository.ts + actions.ts + types.ts
│   └── app/
│       ├── login/            # /login (public)
│       ├── api/auth/         # POST /api/auth/login + /logout
│       └── (authed)/         # All protected pages
│           ├── layout.tsx    # Server-side auth gate + sidebar
│           ├── my-work/      # Personal queue
│           ├── sops/         # Full CRUD: list, new, [id] detail
│           └── …             # roadmap, tests, reports, frameworks, controls, policies, audits, admin (placeholders)
├── public/favicon.svg
├── .env.example
├── railway.json
└── package.json
```

## SOP feature — what works end-to-end

1. **List** (`/sops`) — paginated, filterable by status and search
2. **Create** (`/sops/new`) — full form with brand + department + file URL (SharePoint link) + dates
3. **Detail** (`/sops/[id]`) — view + transition buttons depending on role and status
4. **Workflow transitions** (server actions):
   - `draft / rejected` → `pending_review` (owner or editor)
   - `pending_review` → `approved` / `rejected` (admin or business_excellence)
   - `approved` → `archived` (editor)
5. **Audit log** — every transition is recorded in `audit_logs`

## Roles

| Role | Can edit SOPs | Can approve SOPs |
|------|---------------|------------------|
| `admin` | ✅ | ✅ |
| `business_excellence` | ✅ | ✅ |
| `compliance` | ✅ | ❌ |
| `auditor` | ❌ | ❌ |
| `branch_manager` | ❌ | ❌ |
| `viewer` (default) | ❌ | ❌ |

Roles are stored in `users.role` and enforced both in server actions and via UI gating.

## What's next

To make this a full ECS replacement, build these modules using the same vertical-slice pattern as `src/features/sops/`:

- `assignments/` — SOP rollout to specific brand+department combos
- `audits/` — checklist templates + on-site execution + scoring
- `capa/` — corrective actions linked to audit findings
- `evidence/` — file metadata + linkage to SOPs / audits / CAPAs
- `notifications/` — Outlook (Microsoft Graph) email + in-app inbox
- `dashboard/` — KPIs (compliance rate, overdue CAPAs, audit trends)
- `admin/` — user management, brand/department CRUD

Each module follows: `repository.ts` (DB) → `actions.ts` (server actions) → page in `src/app/(authed)/<module>/`.
