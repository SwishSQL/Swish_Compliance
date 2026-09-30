"use client";

import { useBulkSelection, type SelectableFinding } from "./BulkSelection";

export default function FindingCheckbox({
  finding,
}: {
  finding: SelectableFinding;
}) {
  const { isSelected, toggle } = useBulkSelection();
  const checked = isSelected(finding.itemId);

  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={() => toggle(finding)}
      className="mt-1 w-4 h-4 accent-brand-700 shrink-0 cursor-pointer"
      aria-label={`Select finding for bulk assignment: ${finding.question}`}
    />
  );
}
