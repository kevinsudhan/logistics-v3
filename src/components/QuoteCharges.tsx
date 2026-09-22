import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
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
import { bestPerCharge, laneLabel, ratesFor, type ResolvedRate } from "../services/rateMaster";

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

/**
 * One editable cell of the grid.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY CELL HAS A VISIBLE BORDER
 *
 * It used to be `border-transparent bg-transparent`, drawing a box only on
 * hover. On a page with one or two fields that reads as clean; on a grid of
 * fourteen columns it reads as broken — a row of numbers floating in space,
 * with no way to tell what is editable, what is computed, and where one cell
 * ends and the next begins. Finding the cost column meant counting across.
 *
 * A rate sheet is a form, and a form shows its fields.
 * ---------------------------------------------------------------------------
 */
function Cell({
  value,
  onCommit,
  locked,
  align,
  mono,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  locked?: boolean;
  align?: "right";
  mono?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (locked) {
    return (
      <span
        className={`block truncate px-2 py-1.5 text-[12.5px] text-text-secondary ${
          align === "right" ? "text-right tabular-nums" : ""
        } ${mono ? "font-mono" : ""}`}
      >
        {value || "—"}
      </span>
    );
  }

  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      className={`h-8 w-full rounded-lg border border-border bg-surface-1 px-2.5 text-[12.5px] text-text-primary transition-colors placeholder:text-text-muted hover:border-border-strong focus:border-text-accent focus:outline-none ${
        align === "right" ? "text-right tabular-nums" : ""
      } ${mono ? "font-mono" : ""}`}
    />
  );
}

/**
 * A figure the database works out: an amount, or a cost.
 *
 * Shaped like the inputs beside it so the row keeps its rhythm, and filled
 * rather than bordered so it is obvious at a glance that typing here is not
 * how the number changes.
 */
function Computed({ value }: { value: string }) {
  return (
    <span className="flex h-8 items-center justify-end rounded-lg bg-surface-2 px-2.5 text-[12.5px] font-medium tabular-nums text-text-primary">
      {value}
    </span>
  );
}

export default function QuoteCharges({
  quoteId,
  locked,
  partnerQuotes,
  lane,
  quoteCurrency = "INR",
  quoteFxRate = 1,
  onChanged,
}: {
  quoteId: string;
  /** An accepted quote is what the customer agreed to; its charges are fixed. */
  locked?: boolean;
  /** Replies that came back from partners, offered as a cost against a line. */
  partnerQuotes?: PartnerQuote[];
  /**
   * What this job is, so the rate master can be asked what applies to it.
   *
   * Absent means the button is not offered: filling a quotation from rates for
   * a lane nobody has recorded would produce the standing charges and no
   * freight, which looks like a complete quotation and is not.
   */
  lane?: {
    origin: string | null;
    destination: string | null;
    mode?: string | null;
    direction?: string | null;
  };
  /** What the customer is quoted in, and what it converts at. */
  quoteCurrency?: string;
  quoteFxRate?: number;
  onChanged?: () => void;
}) {
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  const [filling, setFilling] = useState(false);
  /** What the rate master offered, and what was done with it. */
  const [filled, setFilled] = useState<{ used: ResolvedRate[]; skipped: string[] } | null>(null);

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

  /**
   * Fill the quotation from the rate master.
   *
   * ---------------------------------------------------------------------------
   * WHAT IT WILL AND WILL NOT DO
   *
   * It adds a line for every charge the rate master has a rate for on this lane
   * and does not already have a line here. It never touches a line that is
   * already on the quotation — including an empty one somebody added by hand a
   * moment ago, because a rate written over a figure being typed is the kind of
   * thing that goes out unnoticed.
   *
   * WHY THE COST COMES ACROSS AND THE MARGIN IS NOT INVENTED
   *
   * The rate master holds both, so both are used: the sell becomes the rate and
   * the cost becomes `cost_inr`, which is what makes the margin visible while
   * the quotation is being built. Where the master has no cost, the line is
   * added with none rather than a guess.
   *
   * WHY QUANTITY IS 1 AND NOT DERIVED
   *
   * A per-kilo air rate needs the chargeable weight, a per-CBM sea rate needs
   * the volume, and a per-container rate needs the count — three different
   * facts, not all of which are recorded at quoting time. Putting 1 in is
   * obviously a placeholder; putting a derived number in that happens to be
   * wrong is not.
   * ---------------------------------------------------------------------------
   */
  async function fillFromRates() {
    if (!lane) return;
    setFilling(true);
    setError(null);
    try {
      const applicable = bestPerCharge(
        await ratesFor({
          origin: lane.origin,
          destination: lane.destination,
          mode: lane.mode ?? null,
          direction: lane.direction ?? null,
        })
      );

      const already = new Set(lines.map((l) => l.description.trim().toLowerCase()));
      const used: ResolvedRate[] = [];
      const skipped: string[] = [];

      for (const r of applicable) {
        if (already.has(r.charge_head.trim().toLowerCase())) {
          skipped.push(r.charge_head);
          continue;
        }
        used.push(r);
      }

      // Sequentially, so `position` comes out in the order the rates resolved
      // rather than in whatever order a batch of promises happened to settle.
      let position = lines.length;
      for (const r of used) {
        position += 1;
        await addLine(quoteId, {
          position,
          description: r.charge_head,
          sac_code: r.sac_code,
          unit: r.unit,
          quantity: 1,
          rate: r.sell_rate,
          currency: r.currency,
          cost_inr: r.cost_rate,
        });
      }

      await load();
      onChanged?.();
      setFilled({ used, skipped });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the rate master.");
    } finally {
      setFilling(false);
    }
  }

  const s = summarise(lines);
  const cur = quoteCurrency || "INR";
  // Guarded: a zero or missing rate would divide the totals into infinity.
  const fx = Number(quoteFxRate) > 0 ? Number(quoteFxRate) : 1;
  /*
    Whether either rate-of-exchange column is worth a column.

    A rate of exchange means nothing on a line priced in rupees — it is always
    1, and a column of 1.0000 down a fourteen-column grid is width spent saying
    nothing. The two sides are asked separately because they move
    independently: a charge sold in rupees is routinely bought in dollars, and
    hiding the cost rate because the selling side is domestic would hide the one
    figure that explains what the cost actually is.

    Derived from the lines, so switching a currency to USD brings its column
    back on the spot. The quote's own currency counts too — a quotation
    presented in USD needs its rate visible even before a line uses one.
  */
  const anyFx = quoteCurrency !== "INR" || lines.some((l) => l.currency !== "INR");
  const anyCostFx = lines.some((l) => l.cost_currency !== "INR");

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
            {lane && (
              <button
                type="button"
                onClick={() => void fillFromRates()}
                disabled={filling}
                title={`Rates for ${laneLabel({ origin: lane.origin, destination: lane.destination })}`}
                className="mr-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-60"
              >
                {filling ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                Fill using rate master
              </button>
            )}
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

      {filled && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-border-strong px-3 py-2 text-[12px] text-text-secondary">
          <Wand2 size={13} className="mt-px shrink-0" />
          <div className="min-w-0 flex-1">
            {filled.used.length ? (
              <p>
                Added from the rate master:{" "}
                <strong className="text-text-primary">
                  {filled.used.map((r) => r.charge_head).join(", ")}
                </strong>
                . Quantities are placeholders &mdash; set them against the cargo.
              </p>
            ) : (
              <p>
                The rate master had nothing to add for this lane
                {filled.skipped.length ? " that is not already on the quotation" : ""}.
              </p>
            )}
            {filled.skipped.length > 0 && (
              <p className="mt-0.5 text-[11px] text-text-muted">
                Left alone, already on the quotation: {filled.skipped.join(", ")}.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setFilled(null)}
            className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary"
            aria-label="Dismiss"
          >
            <Trash2 size={12} className="opacity-0" />
            <span aria-hidden>&times;</span>
          </button>
        </div>
      )}

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[12px] text-text-muted">
          No charges yet. Add the heads this rate is made of — they become the invoice when the
          customer accepts.
        </p>
      ) : (
        <div className="overflow-x-auto">
          {/*
            The charge grid: what we sell on the left, what it costs us on the
            right, and the vendor it is bought from at the end.

            Wide on purpose. A forwarder prices a job by reading across one row
            — sell 4,500, cost 3,000, A2C Forwarders — and splitting that across
            two screens is what makes people keep the real working in a
            spreadsheet. It scrolls sideways rather than wrapping, because a row
            that wraps stops being a row.
          */}
          <table className={`w-full border-separate border-spacing-y-1 text-[12.5px] ${
              anyFx && anyCostFx ? "min-w-[86rem]" : anyFx || anyCostFx ? "min-w-[80rem]" : "min-w-[74rem]"
            }`}>
            <thead>
              <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-text-secondary">
                <th className="w-9 py-2 pr-1 text-right font-medium">#</th>
                <th className="w-52 whitespace-nowrap py-2 pr-2 font-medium">Charge name</th>
                <th className="w-24 whitespace-nowrap py-2 pr-2 font-medium">Charge</th>
                <th className="w-24 py-2 pr-2 whitespace-nowrap font-medium">Currency</th>
                {anyFx && (
                  <th className="w-24 whitespace-nowrap py-2 pr-2 text-right font-medium">ROE</th>
                )}
                <th className="w-32 py-2 pr-2 whitespace-nowrap font-medium">Unit</th>
                <th className="w-24 py-2 pr-2 text-right whitespace-nowrap font-medium">Units</th>
                <th className="w-28 py-2 pr-2 text-right whitespace-nowrap font-medium">Sell / unit</th>
                <th className="w-28 py-2 pr-2 text-right whitespace-nowrap font-medium">Local amt.</th>
                <th className="w-24 py-2 pr-2 text-right whitespace-nowrap font-medium">Min amt.</th>
                {/* The buying half, tinted so the eye can tell at a glance which
                    side of the row it is on. */}
                <th className="w-24 bg-surface-2 py-2 pl-3 pr-2 whitespace-nowrap font-medium">Cost cur.</th>
                {anyCostFx && (
                  <th className="w-24 whitespace-nowrap bg-surface-2 py-2 pr-2 text-right font-medium">
                    ROE
                  </th>
                )}
                <th className="w-28 bg-surface-2 py-2 pr-2 text-right whitespace-nowrap font-medium">Cost / unit</th>
                <th className="w-28 bg-surface-2 py-2 pr-2 text-right whitespace-nowrap font-medium">Local amt.</th>
                <th className="w-40 bg-surface-2 py-2 pr-2 whitespace-nowrap font-medium">Vendor</th>
                {!locked && <th className="w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5 pr-1 text-right text-[11.5px] tabular-nums text-text-muted">
                    {lines.indexOf(l) + 1}
                  </td>
                  {/*
                    The name first, the code after it.

                    The name is what the line IS and is how anybody reading the
                    quotation identifies it; the code is a filing reference that
                    matters at invoicing. Leading with the code made the eye land
                    on ADO and CDO and have to read one column further to find
                    out what either of them was.
                  */}
                  <td className="py-1.5 pr-2">
                    <Cell
                      value={l.description}
                      locked={locked}
                      onCommit={(v) => void run(() => updateLine(l.id, { description: v }))}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Cell
                      value={l.charge_code ?? ""}
                      locked={locked}
                      mono
                      placeholder="—"
                      onCommit={(v) => void run(() => updateLine(l.id, { charge_code: v || null }))}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    {locked ? (
                      <span className="font-mono text-text-secondary">{l.currency}</span>
                    ) : (
                      <Select
                        label="Currency"
                        className="w-full"
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
                      <Cell
                        value={String(l.fx_rate)}
                        /* A rupee line's rate is always 1 and is not editable,
                           even while the column is up for the sake of a foreign
                           line beside it. */
                        locked={locked || l.currency === "INR"}
                        align="right"
                        onCommit={(v) =>
                          Number(v) > 0 && void run(() => updateLine(l.id, { fx_rate: Number(v) }))
                        }
                      />
                    </td>
                  )}
                  <td className="py-1.5 pr-2">
                    {locked ? (
                      <span className="text-text-secondary">{l.unit || "—"}</span>
                    ) : (
                      <Select
                        label="Unit"
                        className="w-full"
                        value={l.unit}
                        options={UNITS.map((u) => ({ value: u, label: u }))}
                        onChange={(v) => void run(() => updateLine(l.id, { unit: v }))}
                      />
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <Cell
                      value={String(l.quantity)}
                      locked={locked}
                      align="right"
                      onCommit={(v) => void run(() => updateLine(l.id, { quantity: Number(v) || 0 }))}
                    />
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <Cell
                      value={String(l.rate)}
                      locked={locked}
                      align="right"
                      onCommit={(v) => void run(() => updateLine(l.id, { rate: Number(v) || 0 }))}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Computed value={money(l.amount_inr)} />
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <Cell
                      value={l.min_amount == null ? "" : String(l.min_amount)}
                      locked={locked}
                      align="right"
                      placeholder="—"
                      onCommit={(v) =>
                        void run(() =>
                          updateLine(l.id, { min_amount: v.trim() === "" ? null : Number(v) || 0 })
                        )
                      }
                    />
                  </td>

                  <td className="bg-surface-2 py-1.5 pl-3 pr-2">
                    {locked ? (
                      <span className="font-mono text-text-secondary">{l.cost_currency}</span>
                    ) : (
                      <Select
                        label="Cost currency"
                        className="w-full"
                        value={l.cost_currency}
                        options={LINE_CURRENCIES.map((c) => ({ value: c, label: c }))}
                        onChange={(v) =>
                          void run(() =>
                            updateLine(l.id, {
                              cost_currency: v,
                              ...(v === "INR" ? { cost_fx_rate: 1 } : {}),
                            })
                          )
                        }
                      />
                    )}
                  </td>
                  {anyCostFx && (
                    <td className="bg-surface-2 py-1.5 pr-2 text-right">
                      <Cell
                        value={String(l.cost_fx_rate)}
                        locked={locked || l.cost_currency === "INR"}
                        align="right"
                        onCommit={(v) =>
                          Number(v) > 0 &&
                          void run(() => updateLine(l.id, { cost_fx_rate: Number(v) }))
                        }
                      />
                    </td>
                  )}
                  <td className="bg-surface-2 py-1.5 pr-2 text-right">
                    <Cell
                      value={l.cost_rate == null ? "" : String(l.cost_rate)}
                      locked={locked}
                      align="right"
                      placeholder="—"
                      onCommit={(v) =>
                        void run(() =>
                          updateLine(l.id, { cost_rate: v.trim() === "" ? null : Number(v) || 0 })
                        )
                      }
                    />
                  </td>
                  {/* Derived by the database from the three cells to its left,
                      so the margin cannot drift from the figures it is a margin
                      on. Never typed. */}
                  <td className="bg-surface-2 py-1.5 pr-2">
                    <Computed value={l.cost_inr === null ? "—" : money(l.cost_inr)} />
                  </td>
                  <td className="bg-surface-2 py-1.5 pr-2">
                    {locked ? (
                      <span className="text-text-secondary">{l.vendor || "—"}</span>
                    ) : quoted.length > 0 && !l.vendor ? (
                      <Select
                        label="Vendor"
                        className="w-full"
                        value=""
                        options={[
                          { value: "", label: "—" },
                          ...quoted.map((p) => ({
                            value: p.id,
                            label: p.partner_label || p.partner_email,
                            hint: money(Number(p.amount)),
                          })),
                        ]}
                        onChange={(v) => {
                          const pq = quoted.find((p) => p.id === v);
                          if (!pq) return;
                          /*
                            Taking a partner reply fills the vendor AND the cost,
                            in the currency they quoted. It never touches the
                            sell rate: their figure is a buying price, and
                            putting one in front of the shipper sends them the
                            agent's own cost.
                          */
                          void run(() =>
                            updateLine(l.id, {
                              vendor: pq.partner_label || pq.partner_email,
                              cost_rate: Number(pq.amount),
                              cost_currency: pq.currency || "INR",
                              partner_quote_id: pq.id,
                            })
                          );
                        }}
                      />
                    ) : (
                      <Cell
                        value={l.vendor ?? ""}
                        locked={locked}
                        placeholder="—"
                        onCommit={(v) => void run(() => updateLine(l.id, { vendor: v || null }))}
                      />
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
          {/*
            Billing, cost, profit — in the currency the customer is quoted in
            and in rupees beside it.

            Both, because they answer different questions. The quote currency is
            what goes on the document and what the customer will argue about;
            the rupee figure is what the desk is actually paid and what the
            margin means anything in. Showing one and making somebody multiply
            is how a quotation goes out at a margin nobody checked.
          */}
          <dl className="w-full max-w-md text-[12.5px] sm:w-[26rem]">
            <Total label="Billing" quote={s.sell / fx} inr={s.sell} cur={cur} strong />
            {s.costed > 0 && (
              <>
                <Total label="Cost" quote={s.cost / fx} inr={s.cost} cur={cur} />
                <div className="mt-1 border-t border-border pt-1">
                  <Total
                    label="Profit"
                    quote={s.margin / fx}
                    inr={s.margin}
                    cur={cur}
                    strong
                    danger={s.margin < 0}
                  />
                  {s.pct !== null && (
                    <div className="flex items-baseline justify-between gap-4 py-0.5">
                      <dt className="text-text-secondary">Profit %</dt>
                      <dd
                        className={`tabular-nums ${
                          s.margin < 0 ? "text-text-danger" : "text-text-primary"
                        }`}
                      >
                        {s.pct}%
                      </dd>
                    </div>
                  )}
                </div>
                {s.uncosted > 0 && (
                  <p className="pt-1.5 text-[11px] leading-relaxed text-text-muted">
                    {s.uncosted} charge{s.uncosted === 1 ? " has" : "s have"} no cost against{" "}
                    {s.uncosted === 1 ? "it" : "them"}, so the profit is the best case.
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

/**
 * One line of the totals, in the quote currency and in rupees.
 *
 * The rupee column is suppressed when the quotation is already in rupees —
 * printing the same figure twice reads as two facts.
 */
function Total({
  label,
  quote,
  inr,
  cur,
  strong,
  danger,
}: {
  label: string;
  quote: number;
  inr: number;
  cur: string;
  strong?: boolean;
  danger?: boolean;
}) {
  const tone = danger ? "text-text-danger" : strong ? "text-text-primary" : "text-text-secondary";
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <dt className={strong ? "font-medium text-text-primary" : "text-text-secondary"}>{label}</dt>
      <dd className="flex items-baseline gap-4 tabular-nums">
        {cur !== "INR" && (
          <span className={`w-28 text-right ${tone}`}>
            <span className="mr-1 text-[10.5px] text-text-muted">{cur}</span>
            {quote.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </span>
        )}
        <span className={`w-28 text-right ${tone} ${strong ? "font-medium" : ""}`}>
          <span className="mr-1 text-[10.5px] text-text-muted">INR</span>
          {inr.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
        </span>
      </dd>
    </div>
  );
}
