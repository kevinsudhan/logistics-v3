import { useId } from "react";

/**
 * A figure that shows what it is made of when you point at it.
 *
 * ---------------------------------------------------------------------------
 * WHY HOVER, AND NOT ONLY HOVER
 *
 * On the approvals queue the question is always "what is in that number",
 * asked of ten quotations in a row. A hover answers it without a click and
 * without losing your place. But a phone has no hover and a keyboard has no
 * pointer, so the same breakdown opens on focus: a tap on the figure, or
 * tabbing to it.
 *
 * WHERE IT OPENS
 *
 * Under the row of figures, not under the one figure: the nearest positioned
 * ancestor is the row, so on a phone the table spans the card instead of
 * running off the side of the screen, and on a wide screen it sits right-
 * aligned under the figures it explains.
 * ---------------------------------------------------------------------------
 */

export interface BreakdownRow {
  name: string;
  amount: string;
  /** A second line under the amount — the rupee figure of a foreign charge. */
  amountNote?: string;
  /** A second line under the name — the vendor, the rate. */
  note?: string;
  /** Greyed: a charge with nothing recorded on this side. */
  muted?: boolean;
  /** Red: a charge sold below what it costs. */
  negative?: boolean;
}

export default function AmountBreakdown({
  label,
  value,
  sub,
  rows,
  total,
  footnote,
  tone = "default",
}: {
  label: string;
  value: string;
  /** A small line under the figure — the quote currency, the margin. */
  sub?: string;
  rows: BreakdownRow[];
  total?: string;
  /** Said under the table, in amber: what the figure leaves out. */
  footnote?: string;
  tone?: "default" | "negative" | "warning";
}) {
  const id = useId();
  const colour =
    tone === "negative"
      ? "text-text-danger"
      : tone === "warning"
        ? "text-text-warning"
        : "text-text-primary";

  return (
    <div className="group text-right">
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      <button
        type="button"
        aria-describedby={rows.length ? id : undefined}
        className={`cursor-help rounded text-[16px] font-semibold tabular-nums underline decoration-border-strong decoration-dotted underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${colour}`}
      >
        {value}
      </button>
      {sub && <p className="text-[11px] tabular-nums text-text-muted">{sub}</p>}

      {rows.length > 0 && (
        <div
          id={id}
          role="tooltip"
          className="pointer-events-none invisible absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-lg border border-border bg-surface-1 text-left opacity-0 shadow-lg transition-opacity duration-100 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 sm:left-auto sm:w-[26rem]"
        >
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-brand text-white">
                <th className="px-3 py-2 text-left font-medium">Charge name</th>
                <th className="px-3 py-2 text-right font-medium">{label}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border align-top">
                  <td className="px-3 py-1.5 text-text-secondary">
                    {r.name}
                    {r.note && <span className="block text-[10.5px] text-text-muted">{r.note}</span>}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${
                      r.negative ? "text-text-danger" : r.muted ? "text-text-muted" : "text-text-primary"
                    }`}
                  >
                    {r.amount}
                    {r.amountNote && (
                      <span className="block text-[10.5px] text-text-muted">{r.amountNote}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {total && (
              <tfoot>
                <tr className="border-t border-border-strong bg-surface-2 font-medium">
                  <td className="px-3 py-1.5 text-text-primary">Total</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${colour}`}>{total}</td>
                </tr>
              </tfoot>
            )}
          </table>
          {footnote && (
            <p className="border-t border-border px-3 py-1.5 text-[11px] text-text-warning">
              {footnote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
