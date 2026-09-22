import { supabase } from "../lib/supabase";

/**
 * The charges a quotation is built from.
 *
 * ---------------------------------------------------------------------------
 * WHY A QUOTE HAS LINES AT ALL
 *
 * Because it becomes an invoice, and an invoice has lines. Typing one figure
 * into the quote and then typing the breakdown again at billing is how the two
 * end up disagreeing — and it is why "what is the 62,000 made of" had no answer
 * anywhere in this system.
 *
 * THE COST SITS BESIDE THE SELL, NOT INSTEAD OF IT
 *
 * `cost_inr` is what a partner quoted us for that charge. It is recorded on the
 * line so the margin is visible while the quotation is being built, which is
 * the only moment anybody can do anything about it. It is never copied into
 * `rate`: a partner's figure is a buying price, and putting one in front of a
 * customer sends the agent's cost to the shipper.
 * ---------------------------------------------------------------------------
 */

export interface QuoteLine {
  id: string;
  quote_id: string;
  position: number;
  description: string;
  sac_code: string | null;
  quantity: number;
  unit: string;
  rate: number;
  currency: string;
  fx_rate: number;
  amount: number;
  amount_inr: number;
  /** The code the desk quotes against — ADO, CDO, ASFRT. */
  charge_code: string | null;
  /** The floor for this charge, in the line's own currency. */
  min_amount: number | null;

  /* The buying side, in the currency it was bought in (055). */
  cost_currency: string;
  cost_fx_rate: number;
  /** Cost per unit in `cost_currency`. `cost_inr` is derived from it. */
  cost_rate: number | null;
  /** Who the cost is with. Free text: not every vendor is in the partner book. */
  vendor: string | null;

  /** What this charge costs us in rupees. Derived when a cost rate is given. */
  cost_inr: number | null;
  partner_quote_id: string | null;
  created_at: string;
}

export async function linesFor(quoteId: string): Promise<QuoteLine[]> {
  const { data, error } = await supabase
    .from("quote_lines")
    .select("*")
    .eq("quote_id", quoteId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as QuoteLine[];
}

export async function addLine(
  quoteId: string,
  line: Partial<Omit<QuoteLine, "id" | "quote_id" | "amount" | "amount_inr" | "created_at">>
): Promise<void> {
  const { error } = await supabase.from("quote_lines").insert({ quote_id: quoteId, ...line });
  if (error) throw new Error(error.message);
}

export async function updateLine(
  id: string,
  patch: Partial<Omit<QuoteLine, "id" | "quote_id" | "amount" | "amount_inr" | "created_at">>
): Promise<void> {
  const { error } = await supabase.from("quote_lines").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeLine(id: string): Promise<void> {
  const { error } = await supabase.from("quote_lines").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Sell, cost and what is left — computed here so the panel can show it live. */
export function summarise(lines: QuoteLine[]) {
  const sell = lines.reduce((t, l) => t + Number(l.amount_inr || 0), 0);
  const cost = lines.reduce((t, l) => t + Number(l.cost_inr ?? 0), 0);
  const costed = lines.filter((l) => l.cost_inr !== null).length;
  return {
    sell,
    cost,
    margin: sell - cost,
    /** Null until at least one line has a cost against it. */
    pct: costed === 0 || sell === 0 ? null : Math.round(((sell - cost) / sell) * 1000) / 10,
    costed,
    uncosted: lines.length - costed,
  };
}
