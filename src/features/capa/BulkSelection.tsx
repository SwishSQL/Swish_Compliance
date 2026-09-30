"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type SelectableFinding = {
  itemId: number;
  auditId: number;
  question: string;
};

type BulkSelectionState = {
  selected: Map<number, SelectableFinding>;
  toggle: (finding: SelectableFinding) => void;
  isSelected: (itemId: number) => boolean;
  clear: () => void;
};

const BulkSelectionContext = createContext<BulkSelectionState | null>(null);

/**
 * Wraps the findings tree on /capa so any FindingCheckbox anywhere inside
 * (a different control, test, or even a different audit) shares one
 * selection set. Keyed by item_id, which is globally unique across audits.
 */
export function BulkSelectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Map<number, SelectableFinding>>(
    () => new Map()
  );

  const toggle = useCallback((finding: SelectableFinding) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(finding.itemId)) next.delete(finding.itemId);
      else next.set(finding.itemId, finding);
      return next;
    });
  }, []);

  const isSelected = useCallback(
    (itemId: number) => selected.has(itemId),
    [selected]
  );

  const clear = useCallback(() => setSelected(new Map()), []);

  const value = useMemo(
    () => ({ selected, toggle, isSelected, clear }),
    [selected, toggle, isSelected, clear]
  );

  return (
    <BulkSelectionContext.Provider value={value}>
      {children}
    </BulkSelectionContext.Provider>
  );
}

export function useBulkSelection(): BulkSelectionState {
  const ctx = useContext(BulkSelectionContext);
  if (!ctx) {
    throw new Error("useBulkSelection must be used within a BulkSelectionProvider");
  }
  return ctx;
}
