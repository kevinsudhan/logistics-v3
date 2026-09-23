import { supabase } from "../lib/supabase";

/**
 * The follow-ups a booking is worked through.
 *
 * ---------------------------------------------------------------------------
 * NOT THE SAME AS `stage`
 *
 * `stage` is where the cargo is — booked, stuffed, sailed. These are the
 * chasing: the warehouse, the HAWB draft, the origin customer. Half of them
 * are done while the cargo sits at one stage, and they do not always happen in
 * order, so they are a checklist beside the stage rather than a replacement
 * for it.
 *
 * The list is per mode and is copied onto the booking when it is created, so
 * editing the standing list does not rewrite a job already worked.
 * ---------------------------------------------------------------------------
 */

export interface Checkpoint {
  id: string;
  shipment_id: string;
  position: number;
  code: string;
  label: string;
  /** Null until somebody says it is done. The timestamp IS the record. */
  done_at: string | null;
  done_by: string | null;
  note: string;
  /** The stage ticking this step marks the shipment as — a milestone (066). */
  stage: string | null;
  /** When it is due: from the booking's dates by rule, or set by hand. */
  due_on: string | null;
  due_manual: boolean;
  /** Who is chasing it. Null: whoever handles the job. */
  assigned_to: string | null;
}

/** A date by hand, or null to hand it back to the rule. */
export async function setCheckpointDue(id: string, due: string | null): Promise<void> {
  const { error } = await supabase.rpc("set_checkpoint_due", { p_id: id, p_due: due });
  if (error) throw new Error(error.message);
}

export async function setCheckpointOwner(id: string, userId: string | null): Promise<void> {
  const { error } = await supabase
    .from("shipment_checkpoints")
    .update({ assigned_to: userId })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Every open step across a set of jobs, in order — for the worklist.
 *
 * One query for the whole board rather than one per job: the list is read
 * every morning, and ten round trips to draw it is ten reasons for it to be
 * slow.
 */
export async function openStepsFor(shipmentIds: string[]): Promise<Checkpoint[]> {
  if (!shipmentIds.length) return [];
  const { data, error } = await supabase
    .from("shipment_checkpoints")
    .select("*")
    .in("shipment_id", shipmentIds)
    .is("done_at", null)
    .order("position");
  if (error) throw new Error(error.message);
  return (data ?? []) as Checkpoint[];
}

export async function checkpointsFor(shipmentId: string): Promise<Checkpoint[]> {
  const { data, error } = await supabase
    .from("shipment_checkpoints")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("position");
  if (error) throw new Error(error.message);
  return (data ?? []) as Checkpoint[];
}

/**
 * Tick one, or untick it.
 *
 * Unticking is allowed on purpose. A step marked done by mistake is ordinary,
 * and a checklist you cannot correct is one people stop trusting — they keep
 * the real state somewhere else instead.
 */
export async function setCheckpoint(
  id: string,
  done: boolean,
  note?: string
): Promise<Checkpoint> {
  const patch: Record<string, unknown> = {
    done_at: done ? new Date().toISOString() : null,
    done_by: done ? ((await supabase.auth.getUser()).data.user?.id ?? null) : null,
  };
  if (note !== undefined) patch.note = note;

  const { data, error } = await supabase
    .from("shipment_checkpoints")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Checkpoint;
}

/** Just the note, without touching whether it is done. */
export async function setCheckpointNote(id: string, note: string): Promise<void> {
  const { error } = await supabase
    .from("shipment_checkpoints")
    .update({ note })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Send a booking back to the enquiry it came from.
 *
 * Refuses once an invoice exists: that is a statutory document, and the
 * instrument for undoing it is a credit note rather than deleting the job it
 * was raised against. Returns the enquiry reference to navigate back to.
 */
export async function revertShipment(shipmentId: string, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc("revert_shipment", {
    p_id: shipmentId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** How far along, for a heading. Null when there is no checklist. */
export function progressOf(list: Checkpoint[]): { done: number; total: number } | null {
  if (!list.length) return null;
  return { done: list.filter((c) => c.done_at).length, total: list.length };
}
