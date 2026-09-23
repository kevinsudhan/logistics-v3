import { supabase } from "../lib/supabase";
import type { ScheduleInput } from "../lib/schedules";

/**
 * The sailing schedule (071): departures a shipment, console, container or
 * quotation can be built from.
 */

export interface Schedule extends Omit<ScheduleInput, "id"> {
  id: string;
  carrier_partner_id: string | null;
  transit_days: number | null;
  created_at: string;
  updated_at: string;
}

export const STATUS_LABEL: Record<Schedule["status"], string> = {
  scheduled: "Scheduled",
  closed: "Closed",
  departed: "Departed",
  cancelled: "Cancelled",
};

export async function listSchedules(): Promise<Schedule[]> {
  const { data, error } = await supabase
    .from("sailing_schedules")
    .select("*")
    .order("etd", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Schedule[];
}

/**
 * Departures still to come on a lane — what the pickers offer.
 *
 * Matched loosely on the port names: "Chennai" should find "Chennai (MAA)"
 * and "Chennai (ex Madras)", because schedules arrive spelled the carrier's
 * way and the enquiry spelled the shipper's.
 */
export async function upcomingSchedules(opts: { mode?: "sea" | "air" | null } = {}): Promise<Schedule[]> {
  let q = supabase
    .from("sailing_schedules")
    .select("*")
    .gte("etd", new Date().toISOString().slice(0, 10))
    .neq("status", "cancelled")
    .order("etd", { ascending: true })
    .limit(300);
  if (opts.mode) q = q.eq("mode", opts.mode);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Schedule[];
}

export async function getSchedule(id: string): Promise<Schedule | null> {
  const { data, error } = await supabase.from("sailing_schedules").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Schedule) ?? null;
}

export async function saveSchedule(input: ScheduleInput & { id?: string }): Promise<Schedule> {
  const { id, ...fields } = input;
  const row = { ...fields, updated_at: new Date().toISOString() };
  const q = id
    ? supabase.from("sailing_schedules").update(row).eq("id", id)
    : supabase.from("sailing_schedules").insert({ ...row, created_by: (await supabase.auth.getUser()).data.user?.id ?? null });
  const { data, error } = await q.select().single();
  if (error) throw new Error(error.message);
  return data as Schedule;
}

export async function removeSchedule(id: string): Promise<void> {
  const { error } = await supabase.from("sailing_schedules").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * An uploaded sheet: rows with a Schedule ID update that schedule, the rest
 * are new. Rows are written one by one so a failure is named, not all-or-
 * nothing across two hundred lines.
 */
export async function importSchedules(
  rows: ScheduleInput[]
): Promise<{ created: number; updated: number; failed: Array<{ row: number; message: string }> }> {
  let created = 0;
  let updated = 0;
  const failed: Array<{ row: number; message: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      if (r.id) {
        const { data, error } = await supabase
          .from("sailing_schedules")
          .update({ ...r, updated_at: new Date().toISOString() })
          .eq("id", r.id)
          .select("id");
        if (error) throw new Error(error.message);
        if (!data?.length) throw new Error(`No schedule ${r.id} to update`);
        updated++;
      } else {
        await saveSchedule(r);
        created++;
      }
    } catch (e) {
      failed.push({ row: i + 1, message: e instanceof Error ? e.message : "Did not save" });
    }
  }
  return { created, updated, failed };
}

/** "MSC AURORA / FA412E" or "EK 543" — how a departure reads in a list. */
export function departureName(s: Pick<Schedule, "mode" | "vessel" | "voyage" | "flight_number" | "carrier">): string {
  const craft = s.mode === "air" ? s.flight_number : [s.vessel, s.voyage].filter(Boolean).join(" / ");
  return [s.carrier, craft].filter(Boolean).join(" · ") || "—";
}
