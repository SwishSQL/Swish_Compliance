"use client";

import { useMemo, useState } from "react";

type Option = { id: number; name: string };

export default function MultiSelect({
  name,
  label,
  options,
  defaultSelected = [],
  placeholder = "Select…",
  onChange,
}: {
  name: string;            // form field name (will be sent repeated, e.g. brand_ids)
  label: string;
  options: Option[];
  defaultSelected?: number[];
  placeholder?: string;
  /** Optional — lets a parent that needs to react live to the selection
   *  (e.g. adjust other fields) observe it. Most callers just let the
   *  hidden inputs carry the value on submit and don't need this. */
  onChange?: (selected: number[]) => void;
}) {
  const [selected, setSelectedState] = useState<number[]>(defaultSelected);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  function setSelected(update: number[] | ((prev: number[]) => number[])) {
    setSelectedState((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      onChange?.(next);
      return next;
    });
  }

  const optionById = useMemo(() => {
    const m = new Map<number, string>();
    for (const o of options) m.set(o.id, o.name);
    return m;
  }, [options]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, search]);

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function remove(id: number) {
    setSelected((prev) => prev.filter((x) => x !== id));
  }

  return (
    <div className="relative">
      {label && (
        <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      )}

      {/* Hidden inputs that actually get submitted with the form */}
      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}

      {/* Chips of selected items */}
      <div
        onClick={() => setOpen((v) => !v)}
        className="min-h-[42px] w-full px-2 py-1.5 border border-gray-300 rounded-lg flex flex-wrap items-center gap-1.5 cursor-text bg-white focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-brand-500"
      >
        {selected.length === 0 && (
          <span className="text-gray-400 text-sm px-1">{placeholder}</span>
        )}
        {selected.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 bg-brand-50 text-brand-700 border border-brand-200 rounded-md px-2 py-0.5 text-xs"
          >
            {optionById.get(id) ?? "(inactive)"}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(id);
              }}
              className="text-brand-600 hover:text-brand-800"
              aria-label={`Remove ${optionById.get(id)}`}
            >
              ×
            </button>
          </span>
        ))}
        <span className="ml-auto text-gray-400 text-xs pr-1">{open ? "▲" : "▼"}</span>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-hidden flex flex-col">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="px-3 py-2 border-b border-gray-100 text-sm focus:outline-none"
            autoFocus
          />
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-gray-400">
                No matches.
              </div>
            )}
            {filtered.map((o) => {
              const isOn = selected.includes(o.id);
              return (
                <label
                  key={o.id}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={() => toggle(o.id)}
                    className="accent-brand-700"
                  />
                  <span>{o.name}</span>
                </label>
              );
            })}
          </div>
          <div className="border-t border-gray-100 px-3 py-2 flex justify-between text-xs">
            <button
              type="button"
              onClick={() => setSelected([])}
              className="text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-brand-700 font-medium hover:underline"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
