import { Fragment } from "react";
import { requirePermission, loadPermissionOverrides } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import {
  ROLES,
  ROLE_LABELS,
  PERMISSIONS,
  PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
} from "@/lib/auth/permissions";
import { savePermissionsAction } from "@/features/admin/permissions/actions";

/**
 * Role × permission matrix (docs/RBAC.md §10). Ticks show what each role
 * can do now; amber cells differ from the default matrix. Record-level
 * rules (own department, assigned records, no self-approval) are not
 * configurable here — they're enforced next to each record.
 */
export default async function PermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const me = await requirePermission("admin.permissions");
  const sp = await searchParams;
  const overrides = await loadPermissionOverrides();
  const effective = (role: string, perm: string) => {
    const o = overrides.find((x) => x.role === role && x.permission === perm);
    if (o) return Boolean(o.allowed);
    return (DEFAULT_ROLE_PERMISSIONS as Record<string, string[]>)[role]?.includes(perm) ?? false;
  };
  const isOverridden = (role: string, perm: string) =>
    overrides.some((x) => x.role === role && x.permission === perm);

  const groups = Array.from(new Set(PERMISSION_KEYS.map((k) => k.split(".")[0])));
  const GROUP_LABEL: Record<string, string> = {
    admin: "Users & system",
    records: "Visibility",
    grc: "GRC library",
    sop: "SOPs & Policies",
    audit: "Audits",
    capa: "Corrective actions",
  };

  return (
    <Workspace
      section="Administration / Permissions"
      subtitle="Role × permission matrix"
      sessionLabel="Session"
      userLabel={me.displayName}
    >
      {sp.saved && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Permissions saved. They apply on each user&apos;s next page load.
        </div>
      )}
      <form action={savePermissionsAction} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium sticky left-0 bg-gray-50 min-w-[280px]">Permission</th>
              {ROLES.map((r) => (
                <th key={r} className="px-2 py-3 font-medium text-center whitespace-nowrap">
                  {ROLE_LABELS[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g}>
                <tr className="bg-gray-50/60 border-t border-gray-100">
                  <td colSpan={ROLES.length + 1} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    {GROUP_LABEL[g] ?? g}
                  </td>
                </tr>
                {PERMISSION_KEYS.filter((k) => k.startsWith(`${g}.`)).map((perm) => (
                  <tr key={perm} className="border-t border-gray-100">
                    <td className="px-4 py-2 sticky left-0 bg-white">
                      <div className="text-gray-900">{PERMISSIONS[perm]}</div>
                      <div className="text-[11px] text-gray-400 font-mono">{perm}</div>
                    </td>
                    {ROLES.map((r) => (
                      <td
                        key={r}
                        className={`px-2 py-2 text-center ${isOverridden(r, perm) ? "bg-amber-50" : ""}`}
                      >
                        <input
                          type="checkbox"
                          name={`${r}:${perm}`}
                          defaultChecked={effective(r, perm)}
                          className="accent-brand-700"
                          aria-label={`${ROLE_LABELS[r]}: ${PERMISSIONS[perm]}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            Amber cells differ from the default matrix. Record-level rules (own department,
            assigned records, no self-approval) always apply on top.
          </p>
          <button type="submit" className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
            Save permissions
          </button>
        </div>
      </form>
    </Workspace>
  );
}
