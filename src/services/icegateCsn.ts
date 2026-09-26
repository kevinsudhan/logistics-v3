import { supabase } from "../lib/supabase";
import { COMPANY } from "../lib/company";
import { draftFor, mergeDraft, type CsnDraft, type CsnSettings, type CsnSource, type BillData } from "../lib/icegateCsn";
import { shipmentsOn, updateConsole, type Console } from "./consoles";
import { listPartners } from "./partners";
import { saveManifest } from "./receivedHbl";

/**
 * The CSN for ICEGATE, from an import console (097): the desk's ICEGATE
 * identity, the form as saved, a numbered file, and the CSN number once
 * ICEGATE has issued it. The file itself is lib/icegateCsn.ts.
 */

export async function loadCsnSettings(): Promise<CsnSettings> {
  const { data, error } = await supabase.from("icegate_settings").select("icegate_id, pan, authorised_pan, port_of_reporting").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CsnSettings | null) ?? { icegate_id: "", pan: "", authorised_pan: "", port_of_reporting: "" };
}

/** An administrator's to change; for anybody else the database changes nothing, and this says so. */
export async function saveCsnSettings(patch: Partial<CsnSettings>): Promise<CsnSettings> {
  const { data: auth } = await supabase.auth.getUser();
  const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v ?? "").trim().toUpperCase()]));
  const { data, error } = await supabase
    .from("icegate_settings")
    .update({ ...clean, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null })
    .eq("id", true)
    .select("icegate_id, pan, authorised_pan, port_of_reporting");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Only an administrator can change the desk's ICEGATE details.");
  return data[0] as CsnSettings;
}

type Box = CsnSource["containers"][number];
const BOX = "container_no, size_type, iso_code, seal_type, seal_no, package_count, weight_kg, is_soc, shipment_id, console_id";

/**
 * Everything the form starts from: the console, each job's house B/L (the
 * origin agent's as received, or ours), its CFS, the boxes, the agent who
 * shipped the master B/L, and the desk. Then whatever was saved last time on
 * top, so nothing the desk typed is lost.
 */
export async function csnDraftFor(c: Console, settings: CsnSettings): Promise<CsnDraft> {
  const jobs = await shipmentsOn(c.id);
  const ids = jobs.map((j) => j.id);
  const none = Promise.resolve({ data: [], error: null });
  const [received, ours, customs, jobBoxes, consoleBoxes, partners] = await Promise.all([
    ids.length ? supabase.from("received_house_bills").select("shipment_id, hbl_no, data").in("shipment_id", ids) : none,
    ids.length ? supabase.from("house_bills").select("shipment_id, hbl_no, data").in("shipment_id", ids) : none,
    ids.length ? supabase.from("shipment_customs").select("shipment_id, side, cfs_code").in("shipment_id", ids) : none,
    ids.length ? supabase.from("shipment_containers").select(BOX).in("shipment_id", ids) : none,
    supabase.from("shipment_containers").select(BOX).eq("console_id", c.id),
    c.agent_id ? listPartners(true).catch(() => []) : Promise.resolve([]),
  ]);
  for (const r of [received, ours, customs, jobBoxes, consoleBoxes]) if (r.error) throw new Error(r.error.message);

  type Bill = { shipment_id: string; hbl_no: string | null; data: Partial<BillData> };
  const byJob = <T extends { shipment_id: string }>(rows: T[] | null) => {
    const m = new Map<string, T[]>();
    for (const r of rows ?? []) m.set(r.shipment_id, [...(m.get(r.shipment_id) ?? []), r]);
    return m;
  };
  const receivedBy = new Map(((received.data ?? []) as Bill[]).map((b) => [b.shipment_id, b]));
  const oursBy = new Map(((ours.data ?? []) as Bill[]).map((b) => [b.shipment_id, b]));
  const cfsBy = new Map(((customs.data ?? []) as Array<{ shipment_id: string; side: string; cfs_code: string | null }>).filter((r) => r.side === "import").map((r) => [r.shipment_id, r.cfs_code ?? ""]));
  const boxesBy = byJob((jobBoxes.data ?? []) as Array<Box & { shipment_id: string }>);

  // The console's own boxes; failing those, every job's, once each.
  const seen = new Set<string>();
  const master = ((consoleBoxes.data?.length ? consoleBoxes.data : jobBoxes.data) ?? []) as Box[];
  const masterBoxes = master.filter((b) => {
    const k = (b.container_no ?? "").toUpperCase().replace(/\s/g, "");
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const agent = partners.find((p) => p.id === c.agent_id);
  const src: CsnSource = {
    console: c,
    jobs: jobs.map((j) => {
      const bill = j.bl_type === "forwarder" ? receivedBy.get(j.id) ?? oursBy.get(j.id) : oursBy.get(j.id) ?? receivedBy.get(j.id);
      return {
        id: j.id,
        ref: j.enquiry_ref || j.id,
        bill: bill ? { hbl_no: bill.hbl_no, data: bill.data ?? {} } : null,
        cfs_code: cfsBy.get(j.id) ?? "",
        containers: boxesBy.get(j.id) ?? [],
      };
    }),
    containers: masterBoxes,
    mblShipper: agent ? { name: agent.organisation || agent.name, address: agent.address ?? "" } : null,
    desk: { name: COMPANY.legalName.toUpperCase(), address: COMPANY.address.join("\n") + "\nIndia", pan: settings.pan, postal: COMPANY.postal },
  };
  return mergeDraft(c.csn_draft as CsnDraft | null, draftFor(src, settings));
}

export async function saveCsnDraft(consoleId: string, draft: CsnDraft): Promise<void> {
  await updateConsole(consoleId, { csn_draft: draft });
}

/** A job number from ICEGATE's sequence for this sender, and the file's name. */
export async function newCsnFile(consoleId: string, houses: number, indicator: "P" | "T"): Promise<{ job_no: number; file_name: string; date: string; time: string }> {
  const { data, error } = await supabase.rpc("csn_file_new", { p_console: consoleId, p_event: "SCE", p_indicator: indicator, p_houses: houses });
  if (error) throw new Error(error.message);
  return data as { job_no: number; file_name: string; date: string; time: string };
}

export interface CsnFileRow {
  job_no: number;
  file_name: string;
  indicator: "P" | "T";
  houses: number;
  created_at: string;
}

export async function csnFilesFor(consoleId: string): Promise<CsnFileRow[]> {
  const { data, error } = await supabase
    .from("csn_files")
    .select("job_no, file_name, indicator, houses, created_at")
    .eq("console_id", consoleId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return (data ?? []) as CsnFileRow[];
}

/**
 * The CSN number ICEGATE issued, on the console and on every job under it —
 * which is what clears each job's "CSN due" alert (088).
 */
export async function recordCsn(c: Console, csnNo: string, csnDate: string): Promise<Console> {
  const jobs = await shipmentsOn(c.id);
  const updated = await updateConsole(c.id, { csn_no: csnNo.trim(), csn_date: csnDate || null });
  for (const j of jobs) await saveManifest(j.id, { csn_no: csnNo.trim(), csn_filed_on: csnDate || null });
  return updated;
}
