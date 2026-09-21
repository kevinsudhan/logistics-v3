import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import Select from "./Select";
import { CHARGE_HEADS, LINE_CURRENCIES, UNITS, money } from "../services/charges";
import {
  addLine,
  linesFor,
  removeLine,
  summarise,
  updateLine,
  type QuoteLine,
} from "../services/quoteLines";
import type { PartnerQuote } from "../services/rfq";

/**
 * What a quotation is made of.
 *
 * ---------------------------------------------------------------------------
 * THE SAME SHAPE AS THE INVOICE IT BECOMES
 *
 * A quotation used to be one number in a box. The customer asks what it is made
 * of and nobody can say; the charges get typed again at billing and the two
 * disagree; margin per charge head is unanswerable. Lines fix all three, and
 * the accepted quote's lines are what the invoice starts from.
 *
 * WHY THE PARTNER'S FIGURE GOES IN A COST COLUMN AND NOT THE RATE
 *
 * Because it is a buying price. Dropping an agent's number into the rate would
 * put their cost in front of the shipper, which is the one mistake on this
 * screen that cannot be undone once the mail has gone. "Use as cost" fills the
 * cost column and leaves the sell rate for a person to decide.
 * ---------------------------------------------------------------------------
 */

function Cell({
  value,
  onCommit,
  locked,
  width,
  align,
  mono,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  locked?: boolean;
  width?: string;
  align?: "right";
  mono?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (locked) {
    return <span className={mono ? "font-mono" : undefined}>{value || "—"}</span>;
  }

  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      className={`h-7 rounded border border-transparent bg-transparent px-1.5 text-[13px] text-text-primary transition-colors placeholder:text-text-muted hover:border-border focus:border-border-strong focus:bg-surface-1 focus:outline-none ${
        width ?? "w-full"
      } ${align === "right" ? "text-right tabular-nums" : ""} ${mono ? "font-mono" : ""}`}
    />
  );
}

export default function QuoteCharges({
  quoteId,
  locked,
  partnerQuotes,
  onChanged,
}: {
  quoteId: string;
  /** An accepted quote is what the customer agreed to; its charges are fixed. */
  locked?: boolean;
  /** Replies that came back from partners, offered as a cost against a line. */
  partnerQuotes?: PartnerQuote[];
  onChanged?: () => void;
}) {
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setLines(await linesFor(quoteId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the charges.");
    }
  }, [quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!adding) return;
    const away = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAdding(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [adding]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    }
  };

  const s = summarise(lines);
  const anyFx = lines.some((l) => l.currency !== "INR");

  /** Replies carrying a figure, which are the only ones worth offering. */
  const quoted = (partnerQuotes ?? []).filter(
    (p) => p.status === "quoted" && p.amount !== null && p.amount !== undefined
  );

  return (
    <div>
      {error && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          Charges
        </h3>
        {!locked && (
          <div ref={addRef} className="relative">
            <button
              onClick={() => setAdding((a) => !a)}
              aria-expanded={adding}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
            >
              <Plus size={13} />
              Add a charge
            </button>
            {adding && (
              <ul className="absolute right-0 z-30 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-border-strong bg-surface-1 py-1 shadow-lg">
                {CHARGE_HEADS.map((h) => (
                  <li key={h.label}>
                    <button
                      onClick={() => {
                        setAdding(false);
                        void run(() =>
                          addLine(quoteId, {
                            position: lines.length + 1,
                            description: h.label,
                            sac_code: h.sac,
                            unit: h.unit,
                            quantity: 1,
                            rate: 0,
                          })
                        );
                      }}
                      className="flex w-full items-baseline justify-between gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-surface-2"
                    >
                      <span className="text-text-primary">{h.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-text-muted">{h.sac}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[12px] text-text-muted">
          No charges yet. Add the heads this rate is made of — they become the invoice when the
          customer accepts.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className={`w-full text-[13px] ${anyFx ? "min-w-[52rem]" : "min-w-[40rem]"}`}>
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                <th className="w-[13rem] py-1.5 pr-2 font-medium">Charge</th>
                <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
                <th className="py-1.5 pr-2 font-medium">Unit</th>
                <th className="py-1.5 pr-2 text-right font-medium">Rate</th>
                <th className="py-1.5 pr-2 font-medium">Cur</th>
                {anyFx && <th className="py-1.5 pr-2 text-right font-medium">To INR</th>}
                <th className="py-1.5 pr-2 text-right font-medium">Sell</th>
                <th className="py-1.5 pr-2 text-right font-medium">Our cost</th>
                {!locked && <th className="w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5 pr-2">
                    <Cell
                      value={l.description}
                      locked={locked}
                      onCommit={(v) => void run(() => updateLine(l.id, { description: v }))}
                    />
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <Cell
                      value={String(l.quantity)}
                      locked={locked}
                      align="right"
                      width="w-16"
                      onCommit={(v) => void run(() => updateLine(l.id, { quantity: Number(v) || 0 }))}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    {locked ? (
                      <span className="text-text-secondary">{l.unit || "—"}</span>
                    ) : (
                      <Select
                        label="Unit"
                        className="w-28"
                        value={l.unit}
                        options={UNITS.map((u) => ({ value: u, label: u }))}
                        onChange={(v) => void run(() => updateLine(l.id, { unit: v }))}
                      />
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <Cell
                      value={String(l.rate)}
                      locked={locked}
                      align="right"
                      width="w-24"
                      onCommit={(v) => void run(() => updateLine(l.id, { rate: Number(v) || 0 }))}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    {locked ? (
                      <span className="font-mono text-text-secondary">{l.currency}</span>
                    ) : (
                      <Select
                        label="Currency"
                        className="w-24"
                        value={l.currency}
                        options={LINE_CURRENCIES.map((c) => ({ value: c, label: c }))}
                        onChange={(v) =>
                          void run(() =>
                            updateLine(l.id, { currency: v, ...(v === "INR" ? { fx_rate: 1 } : {}) })
                          )
                        }
                      />
                    )}
                  </td>
                  {anyFx && (
                    <td className="py-1.5 pr-2 text-right">
                      {l.currency === "INR" ? (
                        <span className="text-text-muted">—</span>
                      ) : (
                        <Cell
                          value={String(l.fx_rate)}
                          locked={locked}
                          align="right"
                          width="w-20"
                          onCommit={(v) =>
                            Number(v) > 0 && void run(() => updateLine(l.id, { fx_rate: Number(v) }))
                          }
                        />
                      )}
                    </td>
                  )}
                  <td className="py-1.5 pr-2 text-right font-medium tabular-nums text-text-primary">
                    {money(l.amount_inr)}
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    {l.cost_inr === null ? (
                      quoted.length > 0 && !locked ? (
                        <Select
                          label="Use a partner's rate as the cost"
                          className="w-40"
                          align="right"
                          value=""
                          options={[
                            { value: "", label: "Not costed" },
                            ...quoted.map((p) => ({
                              value: p.id,
                              label: `${money(Number(p.amount))}${p.currency && p.currency !== "INR" ? ` ${p.currency}` : ""}`,
                              hint: p.partner_label || p.partner_email,
                            })),
                          ]}
                          onChange={(v) => {
                            const pq = quoted.find((p) => p.id === v);
                            if (!pq) return;
                            void run(() =>
                              updateLine(l.id, {
                                cost_inr: Number(pq.amount),
                                partner_quote_id: pq.id,
                              })
                            );
                          }}
                        />
                      ) : (
                        <Cell
                          value=""
                          locked={locked}
                          align="right"
                          width="w-24"
                          placeholder="—"
                          onCommit={(v) =>
                            v.trim() &&
                            void run(() => updateLine(l.id, { cost_inr: Number(v) || 0 }))
                          }
                        />
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="tabular-nums text-text-secondary">
                          {money(l.cost_inr)}
                        </span>
                        {!locked && (
                          <button
                            onClick={() =>
                              void run(() =>
                                updateLine(l.id, { cost_inr: null, partner_quote_id: null })
                              )
                            }
                            aria-label="Clear the cost on this line"
                            className="text-text-muted hover:text-text-primary"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  {!locked && (
                    <td className="py-1.5">
                      <button
                        onClick={() => void run(() => removeLine(l.id))}
                        aria-label={`Remove ${l.description || "this charge"}`}
                        className="grid size-7 place-items-center rounded-lg text-text-muted transition-colors hover:bg-bg-danger hover:text-text-danger"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lines.length > 0 && (
        <div className="mt-3 flex justify-end">
          <dl className="w-full max-w-xs space-y-1 text-[13px] sm:w-72">
            <div className="flex justify-between">
              <dt className="font-medium text-text-primary">Quoted</dt>
              <dd className="text-[15px] font-medium tabular-nums text-text-primary">
                {money(s.sell)}
              </dd>
            </div>
            {s.costed > 0 && (
              <>
                <div className="flex justify-between">
                  <dt className="text-text-secondary">Our cost</dt>
                  <dd className="tabular-nums text-text-secondary">{money(s.cost)}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5">
                  <dt className="font-medium text-text-primary">Margin</dt>
                  <dd
                    className={`font-medium tabular-nums ${
                      s.margin < 0 ? "text-text-danger" : "text-text-primary"
                    }`}
                  >
                    {money(s.margin)}
                    {s.pct !== null && (
                      <span className="ml-1.5 text-[11px] font-normal text-text-muted">
                        {s.pct}%
                      </span>
                    )}
                  </dd>
                </div>
                {s.uncosted > 0 && (
                  <p className="pt-1 text-[11px] leading-relaxed text-text-muted">
                    {s.uncosted} charge{s.uncosted === 1 ? " has" : "s have"} no cost against{" "}
                    {s.uncosted === 1 ? "it" : "them"}, so the margin is the best case.
                  </p>
                )}
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
