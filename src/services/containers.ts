import { supabase } from "../lib/supabase";
import type { Enquiry } from "./enquiries";

/**
 * Containers the desk has booked, and what is travelling on them.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ROWS ARE CALLED sailings IN THE DATABASE
 *
 * Because they already were. `sailings` has held "a container of this size, on
 * this route, leaving on this date" since the stowage planner was built, and a
 * second table for the same four facts would let the two screens disagree about
 * what space exists.
 *
 * The name is the only thing that differs. A person books a container; the
 * table records a sailing; they are the same row.
 * ---------------------------------------------------------------------------
 */

/** The types the desk actually books. 40GP is a plain forty-foot box. */
export const CONTAINER_TYPES = [
  { code: "40GP", label: "40ft standard", hint: "12.03 × 2.35 × 2.39 m · 26,700 kg" },
  { code: "40HC", label: "40ft high cube", hint: "12.03 × 2.35 × 2.69 m · 28,600 kg" },
  { code: "20GP", label: "20ft standard", hint: "5.90 × 2.35 × 2.39 m · 28,200 kg" },
] as const;

export const DEFAULT_CONTAINER = "40GP";

export type ContainerStatus = "open" | "closing_soon" | "full" | "sailed";

export const STATUS_LABEL: Record<ContainerStatus, string> = {
  open: "Open",
  closing_soon: "Closing soon",
  full: "Full",
  sailed: "Sailed",
};

export interface Container {
  id: string;
  route: string;
  origin: string | null;
  destination: string | null;
  carrier: string;
  container_code: string;
  mode: "LCL" | "FCL";
  sailing_date: string;
  cutoff_date: string | null;
  status: ContainerStatus;
  partner_id: string | null;
  notes: string;
  created_at: string;

  /** Joined in by `listContainers`, not a column. */
  partner_name?: string | null;
  partner_org?: string | null;
  enquiry_count?: number;
}

/**
 * Every container, soonest sailing first.
 *
 * The partner and the load arrive with it rather than as a request per row: a
 * page listing twenty containers would otherwise make forty more calls to say
 * who each one is with and how much is on it.
 */
export async function listContainers(): Promise<Container[]> {
  const [{ data, error }, { data: load }] = await Promise.all([
    supabase
      .from("sailings")
      .select("*, partners(name, organisation)")
      .order("sailing_date", { ascending: true }),
    supabase.from("container_load").select("id, enquiry_count"),
  ]);
  if (error) throw new Error(error.message);

  const counts = new Map((load ?? []).map((l) => [l.id as string, Number(l.enquiry_count) || 0]));

  return (data ?? []).map((row) => {
    const { partners, ...rest } = row as Record<string, unknown> & {
      partners?: { name?: string; organisation?: string } | null;
    };
    return {
      ...(rest as unknown as Container),
      partner_name: partners?.name ?? null,
      partner_org: partners?.organisation ?? null,
      enquiry_count: counts.get((rest as { id: string }).id) ?? 0,
    };
  });
}

/** The ones an enquiry can still be put on — anything that has not sailed. */
export async function listOpenContainers(): Promise<Container[]> {
  return (await listContainers()).filter((c) => c.status !== "sailed");
}

export async function createContainer(input: {
  origin: string;
  destination: string;
  sailing_date: string;
  partner_id?: string | null;
  container_code?: string;
  carrier?: string;
  cutoff_date?: string | null;
  mode?: "LCL" | "FCL";
  notes?: string;
}): Promise<Container> {
  const { data, error } = await supabase.rpc("create_container", {
    p_origin: input.origin,
    p_destination: input.destination,
    p_sailing_date: input.sailing_date,
    p_partner_id: input.partner_id || null,
    p_container_code: input.container_code || DEFAULT_CONTAINER,
    p_carrier: input.carrier ?? "",
    p_cutoff_date: input.cutoff_date || null,
    p_mode: input.mode ?? "FCL",
    p_notes: input.notes ?? "",
  });
  if (error) throw new Error(error.message);
  return data as Container;
}

export async function updateContainer(
  id: string,
  patch: Partial<{
    origin: string;
    destination: string;
    sailing_date: string;
    partner_id: string | null;
    container_code: string;
    carrier: string;
    cutoff_date: string | null;
    status: ContainerStatus;
    notes: string;
  }>
): Promise<Container> {
  const { data, error } = await supabase.rpc("update_container", {
    p_id: id,
    p_origin: patch.origin ?? null,
    p_destination: patch.destination ?? null,
    p_sailing_date: patch.sailing_date ?? null,
    p_partner_id: patch.partner_id ?? null,
    p_container_code: patch.container_code ?? null,
    p_carrier: patch.carrier ?? null,
    p_cutoff_date: patch.cutoff_date ?? null,
    p_status: patch.status ?? null,
    p_notes: patch.notes ?? null,
  });
  if (error) throw new Error(error.message);
  return data as Container;
}

/**
 * Puts an enquiry on a container, or takes it off.
 *
 * Null is the "take it off" case rather than a second function, which is how
 * the database models it too — one rule, one timeline entry either way.
 */
export async function assignContainer(ref: string, sailingId: string | null): Promise<Enquiry> {
  const { data, error } = await supabase.rpc("assign_container", {
    p_ref: ref,
    p_sailing_id: sailingId,
  });
  if (error) throw new Error(error.message);
  return data as Enquiry;
}

/** What is on one container. Used by the page's expanded row. */
export async function enquiriesOn(sailingId: string): Promise<Enquiry[]> {
  const { data, error } = await supabase
    .from("enquiries")
    .select("*")
    .eq("sailing_id", sailingId)
    .order("ref");
  if (error) throw new Error(error.message);
  return (data ?? []) as Enquiry[];
}

/** "Chennai → Colombo", or whatever half of it exists. */
export function routeOf(c: Pick<Container, "origin" | "destination" | "route">): string {
  const ends = [c.origin, c.destination].filter(Boolean);
  return ends.length === 2 ? ends.join(" → ") : c.route;
}

/**
 * How close the sailing is, in words.
 *
 * Days rather than a date on its own, because "in 3 days" is the fact that
 * changes what somebody does and "18 Sep" needs a calendar to become that.
 */
export function sailsIn(iso: string): { text: string; urgent: boolean; past: boolean } {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return { text: "", urgent: false, past: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) return { text: `${-days}d ago`, urgent: false, past: true };
  if (days === 0) return { text: "today", urgent: true, past: false };
  if (days === 1) return { text: "tomorrow", urgent: true, past: false };
  return { text: `in ${days}d`, urgent: days <= 5, past: false };
}

/** Record which sailing schedule entry a container was built from (071). */
export async function linkContainerSchedule(containerId: string, scheduleId: string | null): Promise<void> {
  const { error } = await supabase.from("sailings").update({ schedule_id: scheduleId }).eq("id", containerId);
  if (error) throw new Error(error.message);
}
