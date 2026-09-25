import { supabase } from "../lib/supabase";
import { normaliseHbl, type ReleaseMode } from "../lib/hbl";
import { isProvisional, manifestLines, type ManifestBill, type ManifestConsole, type ManifestLine } from "../lib/consoleManifest";
import { shipmentsOn, updateConsole, type Console } from "./consoles";
import { listPartners } from "./partners";

/**
 * Everything the console's manifest is drawn from (090): its jobs, the house
 * B/L each travels under — ours as saved, or the origin agent's as received
 * when the job travels under theirs — and the agent it goes to.
 */
export async function manifestFor(c: Console): Promise<{ lines: ManifestLine[]; provisional: boolean; agent: { name: string; email: string } | null; jobCount: number }> {
  const jobs = await shipmentsOn(c.id);
  const ids = jobs.map((j) => j.id);
  const [ours, theirs, partners] = await Promise.all([
    ids.length ? supabase.from("house_bills").select("shipment_id, hbl_no, status, release_mode, originals, data").in("shipment_id", ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from("received_house_bills").select("shipment_id, hbl_no, stage, release_mode, originals, data").in("shipment_id", ids) : Promise.resolve({ data: [], error: null }),
    c.agent_id ? listPartners(true).catch(() => []) : Promise.resolve([]),
  ]);
  if (ours.error) throw new Error(ours.error.message);
  if (theirs.error) throw new Error(theirs.error.message);

  type Row = { shipment_id: string; hbl_no: string | null; release_mode: ReleaseMode; originals: number; data: unknown };
  const forwarder = new Set(jobs.filter((j) => j.bl_type === "forwarder").map((j) => j.id));
  const bills: ManifestBill[] = [
    ...((ours.data ?? []) as Array<Row & { status: string }>)
      .filter((r) => !forwarder.has(r.shipment_id))
      .map((r) => ({ shipment_id: r.shipment_id, hbl_no: r.hbl_no, release_mode: r.release_mode, originals: r.originals, data: normaliseHbl(r.data as never), final: r.status === "issued" })),
    ...((theirs.data ?? []) as Array<Row & { stage: string }>)
      .filter((r) => forwarder.has(r.shipment_id))
      .map((r) => ({ shipment_id: r.shipment_id, hbl_no: r.hbl_no || null, release_mode: r.release_mode, originals: r.originals, data: normaliseHbl(r.data as never), final: r.stage === "final" })),
  ];

  const lines = manifestLines(jobs, bills);
  const partner = partners.find((p) => p.id === c.agent_id);
  return {
    lines,
    provisional: isProvisional(manifestConsole(c), lines),
    agent: partner ? { name: partner.organisation || partner.name, email: partner.emails[0] ?? "" } : null,
    jobCount: jobs.length,
  };
}

export const manifestConsole = (c: Console): ManifestConsole => ({
  console_no: c.console_no,
  direction: c.direction,
  mbl_number: c.mbl_number,
  mbl_date: c.mbl_date,
  carrier: c.carrier,
  vessel: c.vessel,
  voyage: c.voyage,
  mother_vessel: c.mother_vessel,
  pol: c.pol,
  pod: c.pod,
  place_of_delivery: c.place_of_delivery,
  etd: c.etd,
  eta: c.eta,
});

/** That it went: when, to whom, how many house bills, whether provisional. */
export async function markManifestSent(consoleId: string, to: string, bills: number, provisional: boolean): Promise<void> {
  await updateConsole(consoleId, {
    manifest_sent_at: new Date().toISOString(),
    manifest_sent_to: to,
    manifest_bills: bills,
    manifest_provisional: provisional,
  });
}
