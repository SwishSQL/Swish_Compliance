import Link from "next/link";
import type { Option } from "./lineage";

/*
 * One GET form of list filters, shared by Domains, Frameworks, Checklists
 * and Questions. Server-rendered; no client JavaScript needed.
 */

export type SelectFilter = {
  name: string;
  label: string;
  options: Option[] | { id: string; name: string }[];
  value?: string | number;
};

export default function FilterBar({
  action,
  search,
  searchPlaceholder,
  selects,
  hidden,
  count,
}: {
  action: string;
  search?: string;
  searchPlaceholder: string;
  selects: SelectFilter[];
  hidden?: Record<string, string | undefined>;
  count?: { shown: number; total: number; noun: string };
}) {
  const active = !!search || selects.some((s) => s.value !== undefined && s.value !== "");
  return (
    <form method="get" action={action} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4">
      {hidden &&
        Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[220px]">
          <span className="block text-[11px] text-gray-500 mb-1">Search</span>
          <input
            type="search"
            name="search"
            defaultValue={search ?? ""}
            placeholder={searchPlaceholder}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </label>
        {selects.map((s) => (
          <label key={s.name} className="min-w-[150px]">
            <span className="block text-[11px] text-gray-500 mb-1">{s.label}</span>
            <select
              name={s.name}
              defaultValue={s.value ?? ""}
              className="w-full max-w-[240px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All</option>
              {s.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button type="submit" className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
          Apply
        </button>
        {active && (
          <Link href={action} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-800">
            Reset
          </Link>
        )}
      </div>
      {count && (
        <div className="text-xs text-gray-500 mt-2">
          Showing {count.shown} of {count.total} {count.noun}
        </div>
      )}
    </form>
  );
}

export const STATUS_OPTIONS = [
  { id: "active", name: "Active" },
  { id: "inactive", name: "Inactive" },
];
