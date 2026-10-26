import type { ControlRates } from "./types";

const fmt = (n: number) => `${Math.round(n * 10) / 10}%`;

/**
 * A control's Success / Failure / N/A rates from its audit answers.
 * Failure is the "No" rate; N/A is shown but left out of the score.
 */
export default function ControlRatesBadges({
  rates,
  detailed = false,
}: {
  rates?: ControlRates | null;
  /** Spell the labels out and show the score (control page). */
  detailed?: boolean;
}) {
  if (!rates || rates.questions === 0) {
    return <span className="text-xs text-gray-400">Not audited</span>;
  }
  const chip =
    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={`${chip} bg-emerald-50 text-emerald-700 border-emerald-200`}
        title="Success: the Yes rate across this control's audit answers"
      >
        {detailed ? "Success " : "✓ "}
        {fmt(rates.success)}
      </span>
      <span
        className={`${chip} bg-red-50 text-red-700 border-red-200`}
        title="Failure: the No rate across this control's audit answers"
      >
        {detailed ? "Failure " : "✕ "}
        {fmt(rates.failure)}
      </span>
      <span
        className={`${chip} bg-gray-50 text-gray-500 border-gray-200`}
        title="N/A answers are left out of the score so they never count against the control"
      >
        N/A {fmt(rates.na)}
      </span>
      {detailed && rates.score !== null && (
        <span className="text-xs text-gray-500">
          Score <span className="font-semibold text-gray-800">{fmt(rates.score)}</span>{" "}
          <span className="text-gray-400">
            (Success ÷ (Success + Failure), N/A excluded · {rates.questions} answered question
            {rates.questions === 1 ? "" : "s"})
          </span>
        </span>
      )}
    </div>
  );
}
