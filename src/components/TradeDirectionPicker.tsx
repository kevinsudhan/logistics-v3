import { useState } from "react";
import { useRovingButtons } from "../lib/useRovingButtons";
import { Loader2 } from "lucide-react";
import { failureText } from "../lib/errorText";
import type { Enquiry } from "../services/enquiries";

type Direction = NonNullable<Enquiry["trade_direction"]>;

const OPTIONS: Array<{ value: Direction; label: string }> = [
  { value: "export", label: "Export" },
  { value: "import", label: "Import" },
  { value: "cross_trade", label: "Cross trade" },
];

const WHAT_CHANGES: Record<Direction, string> = {
  export:
    "The workflow becomes an export's: pickup, stuffing, VGM, gate-in, the SI and the B/L, export customs (LEO) and the pre-alert to the agent.",
  import:
    "The workflow becomes an import's: the booking with the origin agent, the pre-alert and documents received, the arrival notice, import customs (OOC), the delivery order and, on FCL, the empty container's return.",
  cross_trade: "Worked as an export without India's customs: the pickup, stuffing, B/L and pre-alert stay; no LEO or OOC step.",
};

/**
 * Import or export, chosen outright on the shipment (134). The workflow, the
 * customer's milestones, the customs side, the pre-alert and the B/L all
 * follow it; changing it says what will change and asks first. Steps already
 * done stay — they happened.
 */
export default function TradeDirectionPicker({
  value,
  locked,
  onChange,
}: {
  value: Enquiry["trade_direction"] | null;
  /** A signed-off, cancelled or delivered job keeps the list it was worked to. */
  locked: boolean;
  onChange: (v: Direction) => Promise<void>;
}) {
  const [busy, setBusy] = useState<Direction | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One Tab stop, the arrows along it; Enter or Space asks to change (lib/useRovingButtons).
  const row = useRovingButtons<HTMLSpanElement>();

  async function pick(v: Direction) {
    if (v === value || busy) return;
    const from = OPTIONS.find((o) => o.value === value)?.label.toLowerCase();
    if (!window.confirm(`Make this ${from ? `${from} job ` : "job "}${v === "import" ? "an import" : v === "export" ? "an export" : "a cross trade"}?\n\n${WHAT_CHANGES[v]}\n\nSteps not yet done for the other way are taken off; steps already done stay.`)) return;
    setBusy(v);
    setError(null);
    try {
      await onChange(v);
    } catch (e) {
      setError(failureText(e, "The direction did not change.").message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        {...row}
        role="radiogroup"
        aria-label="Import or export"
        title={locked ? "This job is closed: it keeps the list it was worked to" : "Import or export: the workflow follows it"}
        className="inline-flex h-7 overflow-hidden rounded-lg border border-border bg-surface-1"
      >
        {OPTIONS.map((o, i) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={locked || busy !== null}
              onClick={() => void pick(o.value)}
              className={`flex items-center gap-1 px-2.5 text-[11.5px] font-medium transition-colors disabled:cursor-default ${i ? "border-l border-border" : ""} ${
                on ? "bg-brand text-white" : "text-text-muted hover:bg-surface-2 hover:text-text-primary disabled:hover:bg-transparent disabled:hover:text-text-muted"
              }`}
            >
              {busy === o.value && <Loader2 size={11} className="animate-spin" />}
              {o.label}
            </button>
          );
        })}
      </span>
      {!value && <span className="text-[11px] text-text-warning">Not set: worked as an export</span>}
      {error && <span className="text-[11px] text-text-danger">{error}</span>}
    </span>
  );
}
