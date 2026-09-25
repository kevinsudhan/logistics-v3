import { supabase } from "../lib/supabase";
import type { Shipment } from "./enquiries";

/**
 * Consoles — one master bill of lading, many house bills under it.
 *
 * ---------------------------------------------------------------------------
 * THE OBJECT THE BUSINESS IS
 *
 * A consolidator buys space against one master B/L and fills it with cargo from
 * several unrelated shippers, each of whom gets a house B/L on our own series.
 * Nothing in this system held the master until now, which meant "which house
 * bills are on MSKU9070323" had no answer and the overseas agent — who bills
 * per master, not per shipment — had nothing to be billed against.
 *
 * THE HOUSE BILL IS `shipments.bl_number`
 *
 * Not a new column. The B/L number the nine document specs print is the one the
 * customer holds, and on a consolidation that is the house bill. The carrier's
 * master lives on the console, where exactly one copy of it exists.
 * ---------------------------------------------------------------------------
 */

export type ConsoleStatus = "open" | "closed" | "sailed" | "arrived" | "cancelled";
export type ConsoleMode = "LCL" | "FCL";

export const STATUS_LABEL: Record<ConsoleStatus, string> = {
  open: "Open",
  closed: "Closed",
  sailed: "Sailed",
  arrived: "Arrived",
  cancelled: "Cancelled",
};

export const STATUS_HINT: Record<ConsoleStatus, string> = {
  open: "Still accepting cargo",
  closed: "Past cut-off — no more cargo",
  sailed: "Gone",
  arrived: "At destination",
  cancelled: "Abandoned",
};

/** The order the desk moves a console through. */
export const STATUS_ORDER: ConsoleStatus[] = ["open", "closed", "sailed", "arrived"];

export interface Console {
  id: string;
  console_no: string | null;
  fy: string | null;
  direction: "export" | "import" | "cross_trade";
  mode: ConsoleMode;
  status: ConsoleStatus;

  mbl_number: string | null;
  mbl_date: string | null;
  carrier: string;
  carrier_id: string | null;
  agent_id: string | null;

  vessel: string;
  voyage: string;
  mother_vessel: string;
  sailing_id: string | null;
  /** The sailing schedule entry it was built from (071). */
  schedule_id: string | null;

  pol: string;
  pol_code: string;
  pod: string;
  pod_code: string;
  place_of_delivery: string;
  delivery_code: string;

  etd: string | null;
  eta: string | null;
  cutoff_date: string | null;

  mlo_code: string;
  igm_no: string;
  igm_date: string | null;
  csn_no: string;
  csn_date: string | null;
  cin_type: string;
  cargo_identification_no: string;

  remarks: string;
  created_at: string;
  updated_at: string;

  /** The cargo manifest sent to the destination agent (090). */
  manifest_sent_at: string | null;
  manifest_sent_to: string;
  manifest_bills: number | null;
  manifest_provisional: boolean;

  /** Joined in by the loaders, not columns. */
  agent_label?: string | null;
  summary?: ConsoleSummary;
}

export interface ConsoleSummary {
  console_id: string;
  house_bills: number;
  issued_bills: number;
  container_count: number;
  packages: number;
  gross_weight_kg: number;
  volume_cbm: number;
}

export async function listConsoles(): Promise<Console[]> {
  const [{ data, error }, { data: sums }] = await Promise.all([
    supabase
      .from("consoles")
      .select("*, partners!consoles_agent_id_fkey(name, organisation)")
      .order("etd", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase.from("console_summary").select("*"),
  ]);
  if (error) throw new Error(error.message);

  const byId = new Map(
    (sums ?? []).map((s) => [(s as ConsoleSummary).console_id, s as ConsoleSummary])
  );

  return (data ?? []).map((row) => {
    const { partners, ...rest } = row as Record<string, unknown> & {
      partners?: { name?: string; organisation?: string } | null;
    };
    const c = rest as unknown as Console;
    return {
      ...c,
      agent_label: partners?.organisation || partners?.name || null,
      summary: byId.get(c.id),
    };
  });
}

export async function getConsole(id: string): Promise<Console | null> {
  const { data, error } = await supabase.from("consoles").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Console) ?? null;
}

/**
 * Open one, from a sailing where there is one.
 *
 * The sailing already knows the route, the carrier, the box size and the dates.
 * Asking for them again on a console that covers exactly that space is four
 * fields of retyping and four chances to disagree with the booking.
 */
export async function openConsole(
  sailingId: string | null,
  direction: "export" | "import" | "cross_trade" = "export",
  mode?: ConsoleMode
): Promise<Console> {
  const { data, error } = await supabase.rpc("open_console", {
    p_sailing_id: sailingId,
    p_direction: direction,
    p_mode: mode ?? null,
  });
  if (error) throw new Error(error.message);
  return data as Console;
}

export async function updateConsole(id: string, patch: Partial<Console>): Promise<Console> {
  const { data, error } = await supabase
    .from("consoles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Console;
}

export async function attachToConsole(shipmentId: string, consoleId: string): Promise<Shipment> {
  const { data, error } = await supabase.rpc("attach_to_console", {
    p_shipment: shipmentId,
    p_console: consoleId,
  });
  if (error) throw new Error(error.message);
  return data as Shipment;
}

export async function detachFromConsole(shipmentId: string): Promise<Shipment> {
  const { data, error } = await supabase.rpc("detach_from_console", { p_shipment: shipmentId });
  if (error) throw new Error(error.message);
  return data as Shipment;
}

/**
 * Allocate this shipment's house bill.
 *
 * Refuses to overwrite one that exists. A B/L number that changes after it has
 * been sent is the most expensive correction in this business, and pressing a
 * button twice must not be how it happens.
 */
export async function issueHouseBl(shipmentId: string): Promise<Shipment> {
  const { data, error } = await supabase.rpc("issue_house_bl", { p_shipment: shipmentId });
  if (error) throw new Error(error.message);
  return data as Shipment;
}

/** The house bills riding on one console. */
export async function shipmentsOn(consoleId: string): Promise<Shipment[]> {
  const { data, error } = await supabase
    .from("shipments")
    .select("*, customers(name, company)")
    .eq("console_id", consoleId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Shipment[];
}

/** Consoles a shipment could still be put on. */
export async function openConsoles(): Promise<Console[]> {
  const { data, error } = await supabase
    .from("consoles")
    .select("*")
    .in("status", ["open", "closed"])
    .order("etd", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Console[];
}

/**
 * How full the box is, as a percentage of what it holds.
 *
 * Load factor is the number a consolidator lives on: space is bought whole and
 * sold by the cubic metre, so the gap between the two is the margin. Returns
 * null rather than a guess when the container's capacity is not known — a load
 * factor computed against an assumed size would be worse than none.
 */
export function loadFactor(volumeCbm: number, capacityCbm: number | null): number | null {
  if (!capacityCbm || capacityCbm <= 0) return null;
  return Math.round((volumeCbm / capacityCbm) * 1000) / 10;
}

/** Usable stowage volume, which is not the same as the box's internal volume. */
export const CAPACITY_CBM: Record<string, number> = {
  // Internal volumes are 33.2 / 67.7 / 76.4; a consolidator plans on what can
  // actually be stowed, which is around 85% of that once dunnage and the shape
  // of real cargo are allowed for.
  "20GP": 28,
  "40GP": 57,
  "40HC": 65,
};
