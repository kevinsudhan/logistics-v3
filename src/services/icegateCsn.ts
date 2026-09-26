import { supabase } from "../lib/supabase";
import { COMPANY } from "../lib/company";
import { draftFor, mergeDraft, type BillData, type CsnDraft, type CsnEvent, type CsnSettings, type CsnSource } from "../lib/icegateCsn";
import { shipmentsOn, updateConsole, type Console } from "./consoles";
import { customsFor, startCustoms, updateCustoms } from "./customs";
import { listPartners } from "./partners";

/**
 * The CSN for ICEGATE, from a console (097, 098): the desk's ICEGATE identity,
 * the form as saved, a numbered file, and the CSN number once ICEGATE has
 * issued it. An import console files on entry (SCE), an export console on exit
 * (SCX). The file itself is lib/icegateCsn.ts.
 */

/** The event a console files: imports on entry, exports on exit; a cross-trade box files neither. */
export const csnEventFor = (c: Pick<Console, "direction">): CsnEvent | null => (c.direction === "import" ? "SCE" : c.direction === "export" ? "SCX" : null);

const SETTINGS = "icegate_id, pan, authorised_pan, port_of_reporting, iec";

export async function loadCsnSettings(): Promise<CsnSettings> {
  const { data, error } = await supabase.from("icegate_settings").select(SETTINGS).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CsnSettings | null) ?? { icegate_id: "", pan: "", authorised_pan: "", port_of_reporting: "", iec: "" };
}

/** An administrator's to change; for anybody else the database changes nothing, and this says so. */
export async function saveCsnSettings(patch: Partial<CsnSettings>): Promise<CsnSettings> {
  const { data: auth } = await supabase.auth.getUser();
  const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v ?? "").trim().toUpperCase()]));
  const { data, error } = await supabase
    .from("icegate_settings")
    .update({ ...clean, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null })
    .eq("id", true)
    .select(SETTINGS);
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Only an administrator can change the desk's ICEGATE details.");
  return data[0] as CsnSettings;
}

type Box = CsnSource["containers"][number];
const BOX = "container_no, size_type, iso_code, seal_type, seal_no, package_count, weight_kg, is_soc, shipment_id, console_id";
type Customer = { id: string; name: string; company: string | null; iec: string | null; pan: string | null; billing_address: string | null; billing_city: string | null; billing_state: string | null; billing_pincode: string | null; billing_country: string | null };

/**
 * Everything the form starts from: the console, each job's house B/L (the
 * origin agent's as received on an import, ours on an export), its customs
 * record (the CFS on an import, the shipping bill on an export), its customer,
 * the boxes, the agent at the other end, and the desk. Then whatever was saved
 * last time on top, so nothing the desk typed is lost.
 */
export async function csnDraftFor(c: Console, settings: CsnSettings): Promise<CsnDraft> {
  const event = csnEventFor(c) ?? "SCE";
  const jobs = await shipmentsOn(c.id);
  const ids = jobs.map((j) => j.id);
  const customerIds = [...new Set(jobs.map((j) => j.customer_id).filter(Boolean))];
  const none = Promise.resolve({ data: [], error: null });
  const [received, ours, customs, jobBoxes, consoleBoxes, customers, partners] = await Promise.all([
    ids.length ? supabase.from("received_house_bills").select("shipment_id, hbl_no, data").in("shipment_id", ids) : none,
    ids.length ? supabase.from("house_bills").select("shipment_id, hbl_no, data").in("shipment_id", ids) : none,
    ids.length ? supabase.from("shipment_customs").select("shipment_id, side, cfs_code, sb_number, sb_date").in("shipment_id", ids) : none,
    ids.length ? supabase.from("shipment_containers").select(BOX).in("shipment_id", ids) : none,
    supabase.from("shipment_containers").select(BOX).eq("console_id", c.id),
    customerIds.length
      ? supabase.from("customers").select("id, name, company, iec, pan, billing_address, billing_city, billing_state, billing_pincode, billing_country").in("id", customerIds)
      : none,
    c.agent_id ? listPartners(true).catch(() => []) : Promise.resolve([]),
  ]);
  for (const r of [received, ours, customs, jobBoxes, consoleBoxes, customers]) if (r.error) throw new Error(r.error.message);

  type Bill = { shipment_id: string; hbl_no: string | null; data: Partial<BillData> };
  type Customs = { shipment_id: string; side: string; cfs_code: string | null; sb_number: string | null; sb_date: string | null };
  const receivedBy = new Map(((received.data ?? []) as Bill[]).map((b) => [b.shipment_id, b]));
  const oursBy = new Map(((ours.data ?? []) as Bill[]).map((b) => [b.shipment_id, b]));
  const customsRows = (customs.data ?? []) as Customs[];
  const importBy = new Map(customsRows.filter((r) => r.side === "import").map((r) => [r.shipment_id, r]));
  const exportBy = new Map(customsRows.filter((r) => r.side === "export").map((r) => [r.shipment_id, r]));
  const customerBy = new Map(((customers.data ?? []) as Customer[]).map((cu) => [cu.id, cu]));
  const boxesBy = new Map<string, Box[]>();
  for (const b of (jobBoxes.data ?? []) as Array<Box & { shipment_id: string }>) boxesBy.set(b.shipment_id, [...(boxesBy.get(b.shipment_id) ?? []), b]);

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
      const cu = customerBy.get(j.customer_id);
      const sb = exportBy.get(j.id);
      return {
        id: j.id,
        ref: j.enquiry_ref || j.id,
        bill: bill ? { hbl_no: bill.hbl_no, data: bill.data ?? {} } : null,
        cfs_code: importBy.get(j.id)?.cfs_code ?? "",
        containers: boxesBy.get(j.id) ?? [],
        customer: cu
          ? { name: cu.company || cu.name, iec: cu.iec, pan: cu.pan, address: cu.billing_address, city: cu.billing_city, state: cu.billing_state, pincode: cu.billing_pincode, country: cu.billing_country }
          : null,
        sb: sb ? { number: sb.sb_number, date: sb.sb_date } : null,
      };
    }),
    containers: masterBoxes,
    agent: agent ? { name: agent.organisation || agent.name, address: agent.address ?? "" } : null,
    desk: { name: COMPANY.legalName.toUpperCase(), address: COMPANY.address.join("\n") + "\nIndia", pan: settings.pan, postal: COMPANY.postal },
  };
  return mergeDraft(c.csn_draft as CsnDraft | null, draftFor(src, settings, event));
}

export async function saveCsnDraft(consoleId: string, draft: CsnDraft): Promise<void> {
  await updateConsole(consoleId, { csn_draft: draft });
}

/**
 * A job number from ICEGATE's sequence for this sender, and the file's name.
 * `filed` is the form as ICEGATE will hold it once this file is accepted
 * (`asFiled`), kept on the file's row (099) for the next amendment to compare with.
 */
export async function newCsnFile(consoleId: string, event: CsnEvent | "SCA", houses: number, indicator: "P" | "T", filed: CsnDraft): Promise<{ job_no: number; file_name: string; date: string; time: string }> {
  const { data, error } = await supabase.rpc("csn_file_new", { p_console: consoleId, p_event: event, p_indicator: indicator, p_houses: houses, p_draft: filed });
  if (error) throw new Error(error.message);
  return data as { job_no: number; file_name: string; date: string; time: string };
}

export interface CsnFileRow {
  job_no: number;
  event: CsnEvent | "SCA";
  file_name: string;
  indicator: "P" | "T";
  houses: number;
  created_at: string;
}

export async function csnFilesFor(consoleId: string): Promise<CsnFileRow[]> {
  const { data, error } = await supabase
    .from("csn_files")
    .select("job_no, event, file_name, indicator, houses, created_at")
    .eq("console_id", consoleId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return (data ?? []) as CsnFileRow[];
}

/**
 * What ICEGATE holds for the console, as far as the CRM knows: the form kept
 * with the last live (P) file made for it — the CSN, or the last amendment.
 * Null when no live file was made since the CRM started keeping them (099).
 */
export async function filedDraftFor(consoleId: string): Promise<CsnDraft | null> {
  const { data, error } = await supabase
    .from("csn_files")
    .select("draft")
    .eq("console_id", consoleId)
    .eq("indicator", "P")
    .not("draft", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.draft as CsnDraft | undefined) ?? null;
}

/**
 * The CSN number ICEGATE issued, on the console and on every job under it: on
 * the import customs record for an import (which clears the job's "CSN due"
 * alert, 088), on the export one for an export. A job without that record yet
 * gets one.
 */
export async function recordCsn(c: Console, csnNo: string, csnDate: string): Promise<Console> {
  const side = csnEventFor(c) === "SCX" ? "export" : "import";
  const jobs = await shipmentsOn(c.id);
  const updated = await updateConsole(c.id, { csn_no: csnNo.trim(), csn_date: csnDate || null });
  for (const j of jobs) {
    const record = (await customsFor(j.id)).find((r) => r.side === side) ?? (await startCustoms(j.id, side));
    await updateCustoms(record.id, { csn_no: csnNo.trim(), csn_filed_on: csnDate || null });
  }
  return updated;
}
