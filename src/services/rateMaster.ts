import { supabase } from "../lib/supabase";
import type { FreightMode } from "../lib/chargeableWeight";
import type { TradeDirection } from "./charges";

/**
 * The rate master.
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS
 *
 * Every quotation is the same handful of charges, and on a lane the desk runs
 * weekly the figures barely move. Typed in fresh each time, they drift: two
 * operators quote the same shipper two different documentation fees in a week,
 * and neither is wrong because neither had anything to be wrong against.
 *
 * WILDCARDS, AND WHY THE MOST SPECIFIC ROW WINS
 *
 * A null origin, destination, mode or direction means "any". That is what keeps
 * the table small: the administration fee is one row, not one per lane. When
 * several rows could apply, the one that named the most wins — which is how
 * people already describe their own pricing: "4,000 for documentation, except
 * out of Chennai it is 4,500, except on the Jebel Ali run it is 5,000."
 *
 * The ranking is done in Postgres (`rates_for`, 051) rather than here, so that
 * "which rate did this use" has one answer rather than one per caller.
 * ---------------------------------------------------------------------------
 */

export interface RateCard {
  id: string;
  charge_head: string;
  sac_code: string | null;
  mode: FreightMode | "sea_fcl" | null;
  direction: TradeDirection | null;
  origin: string | null;
  destination: string | null;
  unit: string;
  currency: string;
  sell_rate: number;
  cost_rate: number | null;
  min_amount: number | null;
  partner_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  notes: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A rate as `rates_for` returns it, with how specifically it was written. */
export interface ResolvedRate
  extends Omit<RateCard, "active" | "created_by" | "created_at" | "updated_at"> {
  /** 0 for a standing rate, up to 6 for one naming both ends, mode and direction. */
  specificity: number;
}

/**
 * The whole table, for the rate master page.
 *
 * Ordered by charge and then by most recently touched. NOT by specificity —
 * that is computed by `rates_for` and is not a column here, so there is nothing
 * to sort on. The page groups by charge head, which is how somebody maintaining
 * rates reads them: all the documentation fees together, the lane-specific ones
 * visible against the standing one they override.
 */
export async function listRates(includeInactive = false): Promise<RateCard[]> {
  let q = supabase.from("rate_cards").select("*");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q.order("charge_head").order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RateCard[];
}

export async function saveRate(patch: Partial<RateCard>): Promise<RateCard> {
  const row = {
    ...patch,
    updated_at: new Date().toISOString(),
  };
  if (patch.id) {
    const { data, error } = await supabase
      .from("rate_cards")
      .update(row)
      .eq("id", patch.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as RateCard;
  }
  const { data, error } = await supabase
    .from("rate_cards")
    .insert({ ...row, created_by: (await supabase.auth.getUser()).data.user?.id ?? null })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as RateCard;
}

export async function removeRate(id: string): Promise<void> {
  const { error } = await supabase.from("rate_cards").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Every rate that could apply to one shipment, best first.
 *
 * A null argument matches everything, which is what an enquiry with no
 * destination recorded yet should do — show the standing charges rather than
 * nothing at all.
 */
export async function ratesFor(input: {
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
  direction?: string | null;
  on?: string;
}): Promise<ResolvedRate[]> {
  const { data, error } = await supabase.rpc("rates_for", {
    p_origin: input.origin ?? null,
    p_destination: input.destination ?? null,
    p_mode: input.mode ?? null,
    p_direction: input.direction ?? null,
    p_on: input.on ?? new Date().toISOString().slice(0, 10),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ResolvedRate[];
}

/**
 * One rate per charge, the best of each.
 *
 * What the quote builder wants: `rates_for` returns every candidate ordered by
 * specificity, and offering an operator three documentation fees to choose
 * between is offering them the decision the table was built to make.
 */
export function bestPerCharge(rates: ResolvedRate[]): ResolvedRate[] {
  const best = new Map<string, ResolvedRate>();
  for (const r of rates) {
    // The list arrives sorted, so the first of each head is the winner and
    // later ones are the rows it beat.
    if (!best.has(r.charge_head)) best.set(r.charge_head, r);
  }
  return [...best.values()];
}

/** "Chennai → Jebel Ali", "Ex Chennai", "Any lane" — how a rate's scope reads. */
export function laneLabel(r: { origin: string | null; destination: string | null }): string {
  if (r.origin && r.destination) return `${r.origin} → ${r.destination}`;
  if (r.origin) return `Ex ${r.origin}`;
  if (r.destination) return `To ${r.destination}`;
  return "Any lane";
}

/** Whether a rate has lapsed, for the row that should look inert. */
export function expired(r: { valid_to: string | null }, on = new Date()): boolean {
  if (!r.valid_to) return false;
  return r.valid_to < on.toISOString().slice(0, 10);
}

export const RATE_MODES = [
  { value: "", label: "Any mode" },
  { value: "sea_lcl", label: "Sea LCL" },
  { value: "sea_fcl", label: "Sea FCL" },
  { value: "air", label: "Air" },
  { value: "road", label: "Road" },
] as const;

export const RATE_DIRECTIONS = [
  { value: "", label: "Any direction" },
  { value: "export", label: "Export" },
  { value: "import", label: "Import" },
  { value: "cross_trade", label: "Cross trade" },
] as const;
