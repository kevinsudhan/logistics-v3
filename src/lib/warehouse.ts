import { chargeableWeight, type Chargeable, type FreightMode } from "./chargeableWeight";

/**
 * What the warehouse received, against what was booked.
 *
 * ---------------------------------------------------------------------------
 * Pieces are compared exactly: one carton short is a claim. Weight and volume
 * get a small tolerance, because a warehouse scale and the shipper's packing
 * list never agree to the gram, and flagging 496 kg against 496.4 kg teaches
 * the desk to ignore the flag.
 *
 * A total the receipts do not all give is unknown, not smaller — the same rule
 * as the dimension table: a partial sum understates, and an understated
 * weight is a lost charge.
 * ---------------------------------------------------------------------------
 */

export interface ReceiptFigures {
  pieces: number | null;
  gross_weight_kg: number | null;
  volume_cbm: number | null;
}

export interface Totals {
  pieces: number | null;
  grossKg: number | null;
  volumeCbm: number | null;
}

export function receivedTotals(receipts: ReceiptFigures[]): Totals {
  const sum = (k: keyof ReceiptFigures) =>
    receipts.length && receipts.every((r) => r[k] !== null && r[k] !== undefined)
      ? receipts.reduce((s, r) => s + Number(r[k]), 0)
      : null;
  return { pieces: sum("pieces"), grossKg: sum("gross_weight_kg"), volumeCbm: sum("volume_cbm") };
}

export type Verdict = "match" | "short" | "over" | "unknown";

export interface Difference {
  verdict: Verdict;
  /** Received minus booked. */
  delta: number | null;
}

/** Tolerances: pieces exact; weight 1% or 1 kg; volume 2% or 0.01 CBM. */
export function compare(
  booked: number | null,
  received: number | null,
  measure: "pieces" | "weight" | "volume"
): Difference {
  if (booked === null || received === null) return { verdict: "unknown", delta: null };
  const delta = received - booked;
  const allow =
    measure === "pieces"
      ? 0
      : measure === "weight"
        ? Math.max(1, Math.abs(booked) * 0.01)
        : Math.max(0.01, Math.abs(booked) * 0.02);
  if (Math.abs(delta) <= allow) return { verdict: "match", delta };
  return { verdict: delta < 0 ? "short" : "over", delta };
}

/**
 * The chargeable weight on each side, where the mode is charged on one.
 *
 * Returns the change in the billed figure, which is the number accounts needs:
 * "the invoice should be on 288 kg, not 240".
 */
export function chargeableChange(
  booked: Totals,
  received: Totals,
  mode: string | null | undefined
): { booked: Chargeable | null; received: Chargeable | null; changed: boolean } {
  if (mode !== "air" && mode !== "sea_lcl" && mode !== "road")
    return { booked: null, received: null, changed: false };
  const b = chargeableWeight(booked.grossKg, booked.volumeCbm, mode as FreightMode);
  const r = chargeableWeight(received.grossKg, received.volumeCbm, mode as FreightMode);
  return { booked: b, received: r, changed: Boolean(b && r && b.value !== r.value) };
}
