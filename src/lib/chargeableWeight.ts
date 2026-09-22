/**
 * What the cargo is billed on.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE WEIGHT
 *
 * A carrier sells space, not mass. A tonne of steel and a tonne of pillows cost
 * the same to lift and nothing like the same to stow, so freight is charged on
 * whichever of weight and volume is greater once both are put in the same unit.
 * That converted figure is the chargeable weight, and it is the number every
 * LCL rate is quoted against — "USD 42 w/m" means forty-two dollars per
 * chargeable unit, not per tonne.
 *
 * Getting it wrong is not a rounding error. A 4 CBM consignment weighing 800kg
 * bills at 4, not 0.8: quoting the weight would be a fifth of the real cost.
 *
 * THE RATIOS ARE PER MODE AND ARE NOT INTERCHANGEABLE
 *
 * Sea LCL:  1 CBM  = 1 tonne.        The w/m the trade says out loud.
 * Air:      6000 cm³ = 1 kg.         IATA volumetric, the near-universal
 *                                    default; some carriers use 5000 on
 *                                    express, which is a different rate card.
 * Road:     1 CBM  = 333 kg.         The common European LTL convention.
 *
 * Feeding air dimensions into the sea ratio understates the charge by a factor
 * of six, which is why the mode is required rather than defaulted.
 *
 * WHY IT ROUNDS UP, AND TO WHAT
 *
 * Carriers bill in whole units for sea and in half-kilos for air, always
 * upward. 2.01 CBM is three units on an LCL bill, not two — so a quotation
 * built on the unrounded figure is under the invoice that follows it, every
 * time, by up to nearly a whole unit.
 *
 * WHY NOTHING IS INVENTED
 *
 * Returns null when the inputs are not there. A consignment with weight and no
 * volume has no chargeable weight yet; guessing the volume from a piece count
 * would put a number on a quotation that nobody measured, which is the one
 * thing this desk does not do.
 * ---------------------------------------------------------------------------
 */

export type FreightMode = "sea_lcl" | "air" | "road";

export interface Chargeable {
  /** The billed figure, rounded as the mode bills it. */
  value: number;
  /** "CBM" for sea and road-by-volume, "kg" for air. */
  unit: "CBM" | "kg";
  /** Which side won — the thing an operator wants to see explained. */
  basis: "weight" | "volume";
  /** Both sides in the billing unit, before rounding, so the choice is readable. */
  weightEquivalent: number;
  volumeEquivalent: number;
}

/** Volume in CBM from centimetre dimensions and a piece count. */
export function volumeFromPieces(
  lengthCm: number | null | undefined,
  widthCm: number | null | undefined,
  heightCm: number | null | undefined,
  pieces: number | null | undefined
): number | null {
  const l = num(lengthCm);
  const w = num(widthCm);
  const h = num(heightCm);
  const n = num(pieces);
  if (l === null || w === null || h === null || n === null) return null;
  if (l <= 0 || w <= 0 || h <= 0 || n <= 0) return null;
  // cm³ to m³ is 1,000,000, not 1000 — the mistake that reports a 1.2m crate
  // as 0.0018 CBM and prices a container load as hand luggage.
  return (l * w * h * n) / 1_000_000;
}

/**
 * The chargeable weight, or null when there is not enough to say.
 *
 * @param grossWeightKg total weight of the consignment
 * @param volumeCbm     total volume; measure it rather than deriving it where
 *                      the pieces are irregular, which is most of them
 */
export function chargeableWeight(
  grossWeightKg: number | null | undefined,
  volumeCbm: number | null | undefined,
  mode: FreightMode
): Chargeable | null {
  const kg = num(grossWeightKg);
  const cbm = num(volumeCbm);
  if (kg === null || cbm === null) return null;
  if (kg < 0 || cbm < 0) return null;
  if (kg === 0 && cbm === 0) return null;

  if (mode === "air") {
    // Both sides in kilos: the volume converted at 6000 cm³ per kg, which is
    // 1 CBM = 166.667 kg.
    const volumeEquivalent = cbm * (1_000_000 / 6000);
    const basis = volumeEquivalent > kg ? "volume" : "weight";
    const raw = Math.max(kg, volumeEquivalent);
    return {
      value: roundUpTo(raw, 0.5),
      unit: "kg",
      basis,
      weightEquivalent: kg,
      volumeEquivalent,
    };
  }

  // Sea and road bill in CBM, so the weight is what converts.
  const kgPerCbm = mode === "road" ? 333 : 1000;
  const weightEquivalent = kg / kgPerCbm;
  const basis = weightEquivalent > cbm ? "weight" : "volume";
  const raw = Math.max(weightEquivalent, cbm);
  return {
    value: roundUpTo(raw, 1),
    unit: "CBM",
    basis,
    weightEquivalent,
    volumeEquivalent: cbm,
  };
}

/** "4 CBM — on volume (0.80 by weight)", for the line under the figure. */
export function describeChargeable(c: Chargeable | null): string {
  if (!c) return "Needs both a gross weight and a volume";
  const other =
    c.basis === "volume"
      ? `${c.weightEquivalent.toFixed(2)} by weight`
      : `${c.volumeEquivalent.toFixed(2)} by volume`;
  return `${c.value} ${c.unit} — charged on ${c.basis} (${other})`;
}

/** The mode a container type implies, so nothing has to be asked twice. */
export function modeFor(containerType: string | null | undefined): FreightMode {
  const t = (containerType ?? "").toLowerCase();
  if (t.includes("air") || t === "awb") return "air";
  return "sea_lcl";
}

function num(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Upward, to the nearest step.
 *
 * The epsilon is against binary floating point, not against the cargo: 2.4/0.5
 * is 4.800000000000001 in a double, and a bare ceil would bill 5.0kg as 5.5.
 */
function roundUpTo(value: number, step: number): number {
  const steps = Math.ceil(value / step - 1e-9);
  return Number((steps * step).toFixed(2));
}
