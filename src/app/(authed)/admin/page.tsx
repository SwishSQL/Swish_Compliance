import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { queryOne } from "@/lib/db";
import { importRecruitmentSopAction } from "@/features/admin/seeds/actions";

export default async function AdminHomePage() {
  const user = await requireAdmin();

  const stats = await queryOne<{
    users: number;
    active_users: number;
    brands: number;
    departments: number;
    org_units: number;
    audit_events: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM users)                           AS users,
       (SELECT COUNT(*) FROM users WHERE is_active = 1)       AS active_users,
       (SELECT COUNT(*) FROM brands WHERE is_active = 1)      AS brands,
       (SELECT COUNT(*) FROM departments WHERE is_active = 1) AS departments,
       (SELECT COUNT(*) FROM org_units WHERE is_active = 1)   AS org_units,
       (SELECT COUNT(*) FROM audit_logs)                      AS audit_events`
  );

  // Users, Brands, Departments, Org Units and Config all live under one
  // tabbed page now (user spec 2026-08-17) — one tile linking there, with
  // a mini stat row instead of four separate tiles.
  const configStats = [
    { label: "Users", value: `${stats?.active_users ?? 0}/${stats?.users ?? 0}`, tab: "users" },
    { label: "Brands", value: stats?.brands ?? 0, tab: "brands" },
    { label: "Departments", value: stats?.departments ?? 0, tab: "departments" },
    { label: "Org Units", value: stats?.org_units ?? 0, tab: "org-units" },
  ] as const;

  const tiles = [
    {
      href: "/admin/import",
      title: "Import Data",
      desc: "Upload a filled SOP_GRC workbook — adds SOPs, Domains, Frameworks, Controls, Tests and Questions, linked into the existing tree.",
      value: "Preview before saving",
      tone: "from-teal-500 to-teal-700",
    },
    {
      href: "/admin/audit-logs",
      title: "Audit Logs",
      desc: "Full activity trail of every state-changing action.",
      value: `${stats?.audit_events ?? 0} events recorded`,
      tone: "from-rose-500 to-rose-700",
    },
  ];

  // Is the Recruitment SOP template already in the system?
  const seededSop = await queryOne<{ id: number }>(
    `SELECT TOP (1) id FROM sops WHERE code = 'HRD-REC-01'`
  );

  return (
    <Workspace
      section="Administration"
      subtitle="Admin Home"
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* Config — Users, Brands, Departments, Org Units, Config in one
          tabbed page. Full-width so the stat row has room to breathe. */}
      <Link
        href="/admin/config"
        className="group block bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md hover:border-gray-300 transition-all mb-5"
      >
        <div className="h-1.5 bg-gradient-to-r from-emerald-500 to-purple-700" />
        <div className="p-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Config</h2>
              <p className="text-sm text-gray-500 leading-relaxed mt-1">
                Users, Brands, Departments, Org Units and dropdown options —
                all in one tabbed page.
              </p>
            </div>
            <span className="text-gray-400 group-hover:text-gray-600 transition-colors shrink-0">
              →
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {configStats.map((s) => (
              <div key={s.tab} className="bg-gray-50 rounded-lg px-3 py-2.5 text-center">
                <div className="text-lg font-semibold text-gray-900 tabular-nums">
                  {s.value}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group block bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md hover:border-gray-300 transition-all"
          >
            <div className={`h-1.5 bg-gradient-to-r ${t.tone}`} />
            <div className="p-6">
              <div className="flex items-start justify-between gap-4 mb-3">
                <h2 className="text-lg font-semibold text-gray-900">{t.title}</h2>
                <span className="text-gray-400 group-hover:text-gray-600 transition-colors">→</span>
              </div>
              <p className="text-sm text-gray-500 leading-relaxed mb-4">{t.desc}</p>
              <div className="text-xs uppercase tracking-wider text-gray-400">
                {t.value}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* ─── SOP Templates / seed data ──────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-brand-500 to-brand-800" />
        <div className="p-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">SOP Templates</h2>
              <p className="text-sm text-gray-500 leading-relaxed mt-1">
                Load pre-built SOPs (from Excel templates shipped with the
                system) straight into the SOPs register as a Draft. The normal
                Compliance → BE → CEO workflow runs afterwards.
              </p>
            </div>
          </div>

          <div className="mt-4 border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-4 bg-gray-50/60">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center text-xl shrink-0">
                📋
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">
                  Recruitment SOP (Universal Template)
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  HR / People &amp; Culture · v1.0 · Effective 01 Jun 2026
                </div>
              </div>
            </div>

            {seededSop ? (
              <Link
                href={`/sops/${seededSop.id}`}
                className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
              >
                ✓ Already imported · Open
              </Link>
            ) : (
              <form action={importRecruitmentSopAction}>
                <button
                  type="submit"
                  className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-700 hover:bg-brand-800 text-white shadow-sm"
                >
                  <span>⬆️</span> Import to SOPs
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </Workspace>
  );
}
