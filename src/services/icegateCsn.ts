import { myId, supabase } from "../lib/supabase";
import { COMPANY } from "../lib/company";
import { formatDate } from "../lib/dates";
import { draftFor, mergeDraft, type BillData, type CsnDraft, type CsnEvent, type CsnSettings, type CsnSource } from "../lib/icegateCsn";
import type { CsnReply } from "../lib/icegateReply";
import { findPlace } from "../lib/geo";
import { shipmentsOn, updateConsole, type Console } from "./consoles";
import { customsFor, startCustoms, updateCustoms } from "./customs";
import { updateShipment, type Shipment } from "./enquiries";
import { getHbl } from "./hbl";
import { listPartners } from "./partners";
import { getReceivedHbl } from "./receivedHbl";
import { extraPartiesFor } from "./shipmentExtras";

/**
 * The CSN for ICEGATE, from a console (097, 098): the desk's ICEGATE identity,
 * the form as saved, a numbered file, and the CSN number once ICEGATE has
 * issued it. An import console files on entry (SCE), an export console on exit
 * (SCX). The file itself is lib/icegateCsn.ts; ICEGATE's reply to it,
 * lib/icegateReply.ts (100).
 *
 * Or from a job on no console (143): the desk's own master B/L with this one
 * house under it, filed from the job's IGM page. Whatever is filed for —
 * the `CsnSubject` — the form, the numbered files, the reply and the CSN
 * number recorded go the same way; only where they are kept differs.
 */

/** What a CSN is filed for: a console of house B/Ls, or one job filed on its own (143). */
export type CsnSubject = { kind: "console"; console: Console } | { kind: "shipment"; shipment: Shipment };

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
  const me = await myId();
  const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v ?? "").trim().toUpperCase()]));
  const { data, error } = await supabase
    .from("icegate_settings")
    .update({ ...clean, updated_at: new Date().toISOString(), updated_by: me })
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

/** The event a subject files: a console's by its direction; a job's by its own, an import unless it is an export. */
export const subjectEvent = (subject: CsnSubject): CsnEvent =>
  subject.kind === "console" ? csnEventFor(subject.console) ?? "SCE" : subject.shipment.trade_direction === "export" ? "SCX" : "SCE";

/** The form, as far as the CRM can fill it, with what was saved last time on top. */
export const csnDraftForSubject = (subject: CsnSubject, settings: CsnSettings) =>
  subject.kind === "console" ? csnDraftFor(subject.console, settings) : csnDraftForShipment(subject.shipment, settings);

export const saveSubjectDraft = (subject: CsnSubject, draft: CsnDraft) =>
  subject.kind === "console" ? saveCsnDraft(subject.console.id, draft) : updateShipment(subject.shipment.id, { csn_draft: draft }).then(() => undefined);

/** The customs station code for an Indian sea port: INMAA → INMAA1, as Customs and its samples write it. */
const indianSeaPort = (code: string) => (/^IN[A-Z]{3}$/.test(code) ? `${code}1` : code);
/** A port's code from the job's spelling of it: its UN/LOCODE (lib/geo), or nothing for the desk to type. */
const portCode = (text: string | null | undefined) => findPlace(text, "sea_fcl")?.codes.find((c) => /^[A-Z]{5}$/.test(c)) ?? "";
const lines = (...parts: Array<string | null | undefined>) => parts.map((x) => (x ?? "").trim()).filter(Boolean).join("\n");
const numText = (n: number | null | undefined) => (n == null ? "" : String(n));

/**
 * A job filed on its own (143): its master B/L, and itself the one house under
 * it. Read as a console of one is (`csnDraftFor`): the house B/L it travels
 * under (the agent's, as read in, or ours), its customs record (the CFS on an
 * import, the shipping bill on an export), its customer, its boxes, the agent at
 * the other end; and where no B/L says a thing, the job's own particulars — so
 * a job with no B/L read in yet still fills the form. The ports are found from
 * the job's spelling of them; an Indian port is its customs station (INMAA1).
 */
export async function csnDraftForShipment(s: Shipment, settings: CsnSettings): Promise<CsnDraft> {
  const event: CsnEvent = s.trade_direction === "export" ? "SCX" : "SCE";
  const exp = event === "SCX";
  const [received, ours, customs, boxes, customer, parties] = await Promise.all([
    getReceivedHbl(s.id).catch(() => null),
    getHbl(s.id).catch(() => null),
    customsFor(s.id).catch(() => []),
    supabase.from("shipment_containers").select(BOX).eq("shipment_id", s.id),
    s.customer_id
      ? supabase.from("customers").select("id, name, company, iec, pan, billing_address, billing_city, billing_state, billing_pincode, billing_country").eq("id", s.customer_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    extraPartiesFor(s.id).catch(() => []),
  ]);
  if (boxes.error) throw new Error(boxes.error.message);

  const bill = s.bl_type === "forwarder" ? received ?? ours : ours ?? received;
  const data = (bill?.data ?? {}) as Partial<BillData>;
  const importRecord = customs.find((r) => r.side === "import");
  const exportRecord = customs.find((r) => r.side === "export");
  const cu = customer.data as Customer | null;
  const agentParty = parties.find((p) => p.role === (exp ? "destination_agent" : "origin_agent"));

  const polName = data.port_of_loading || s.port_of_loading || s.origin || "";
  const podName = data.port_of_discharge || s.port_of_discharge || s.destination || "";
  const polCode = portCode(polName);
  const podCode = portCode(podName);
  const house = s.bl_type === "forwarder" && s.forwarders_bl_no ? s.forwarders_bl_no : s.bl_number;

  const src: CsnSource = {
    console: {
      mbl_number: s.mainline_no,
      mbl_date: s.mainline_date ?? null,
      pol: polName,
      pol_code: exp ? indianSeaPort(polCode) : polCode,
      pod: podName,
      pod_code: exp ? podCode : indianSeaPort(podCode),
      place_of_delivery: data.place_of_delivery || s.destination || "",
      delivery_code: "",
    },
    jobs: [
      {
        id: s.id,
        ref: s.enquiry_ref || s.id,
        bill: bill ? { hbl_no: bill.hbl_no, data } : null,
        cfs_code: importRecord?.cfs_code ?? "",
        containers: (boxes.data ?? []) as Box[],
        customer: cu
          ? { name: cu.company || cu.name, iec: cu.iec, pan: cu.pan, address: cu.billing_address, city: cu.billing_city, state: cu.billing_state, pincode: cu.billing_pincode, country: cu.billing_country }
          : null,
        sb: exportRecord ? { number: exportRecord.sb_number, date: exportRecord.sb_date } : null,
        fallback: {
          hbl_no: house ?? "",
          shipper_name: s.shipper_name ?? "",
          shipper_address: lines(s.shipper_address, [s.shipper_city, s.shipper_pincode].filter(Boolean).join(" "), s.shipper_country),
          consignee_name: s.consignee_name ?? "",
          consignee_address: lines(s.consignee_address, [s.consignee_city, s.consignee_state, s.consignee_pincode].filter(Boolean).join(" "), s.consignee_country),
          consignee_iec: s.consignee_iec || s.consignee_pan || "",
          notify_name: s.notify_name ?? "",
          notify_address: lines(s.notify_address, [s.notify_city, s.notify_state, s.notify_pincode].filter(Boolean).join(" "), s.notify_country),
          port_of_loading: s.port_of_loading ?? "",
          port_of_discharge: s.port_of_discharge ?? "",
          place_of_delivery: s.destination ?? "",
          marks_numbers: s.marks_and_numbers ?? "",
          packages: numText(s.package_count),
          package_type: s.package_type ?? "",
          description: s.cargo ?? "",
          hs_code: s.hs_code ?? "",
          gross_weight_kg: numText(s.gross_weight_kg),
          measurement_cbm: numText(s.volume_cbm),
          date_of_issue: s.bl_date ?? "",
        },
      },
    ],
    containers: (boxes.data ?? []) as Box[],
    agent: agentParty?.name ? { name: agentParty.name, address: lines(agentParty.address, agentParty.city, agentParty.country) } : null,
    desk: { name: COMPANY.legalName.toUpperCase(), address: COMPANY.address.join("\n") + "\nIndia", pan: settings.pan, postal: COMPANY.postal },
  };
  const fresh = draftFor(src, settings, event);
  // What the job already says of the call: its vessel's IMO, the line carrying it.
  fresh.vesselImo = (s.vessel_imo ?? "").replace(/\D/g, "");
  if (s.carrier) fresh.shippingLine = { name: s.carrier.toUpperCase(), code: "" };
  const draft = mergeDraft(s.csn_draft as CsnDraft | null, fresh);
  // The IGM line is the job's (its import customs record, kept on the IGM page): not typed twice.
  if (importRecord?.igm_item?.trim()) draft.lineNo = importRecord.igm_item.trim();
  return draft;
}

/**
 * A job number from ICEGATE's sequence for this sender, and the file's name.
 * `filed` is the form as ICEGATE will hold it once this file is accepted
 * (`asFiled`), kept on the file's row (099) for the next amendment to compare with.
 */
export async function newCsnFile(subject: CsnSubject, event: CsnEvent | "SCA", houses: number, indicator: "P" | "T", filed: CsnDraft): Promise<{ job_no: number; file_name: string; date: string; time: string }> {
  const { data, error } = await supabase.rpc("csn_file_new", {
    p_console: subject.kind === "console" ? subject.console.id : null,
    p_shipment: subject.kind === "shipment" ? subject.shipment.id : null,
    p_event: event,
    p_indicator: indicator,
    p_houses: houses,
    p_draft: filed,
  });
  if (error) throw new Error(error.message);
  return data as { job_no: number; file_name: string; date: string; time: string };
}

/** The column a subject's files are kept under, and its id. */
const owner = (subject: CsnSubject): [string, string] =>
  subject.kind === "console" ? ["console_id", subject.console.id] : ["shipment_id", subject.shipment.id];

export type ReplyStatus = "accepted" | "rejected" | "failed";

export interface CsnFileRow {
  job_no: number;
  event: CsnEvent | "SCA";
  file_name: string;
  indicator: "P" | "T";
  houses: number;
  created_at: string;
  /** The form the file was made from, as ICEGATE holds it once accepted (099). */
  draft: CsnDraft | null;
  /** ICEGATE's reply, once read in (100): null while it is awaited. */
  reply_status: ReplyStatus | null;
  reply: CsnReply | null;
  replied_at: string | null;
}

const FILE_COLS = "job_no, console_id, shipment_id, event, file_name, indicator, houses, created_at, draft, reply_status, reply, replied_at";

export async function csnFilesFor(subject: CsnSubject): Promise<CsnFileRow[]> {
  const { data, error } = await supabase
    .from("csn_files")
    .select(FILE_COLS)
    .eq(...owner(subject))
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return (data ?? []) as CsnFileRow[];
}

/**
 * What ICEGATE holds for the console, as far as the CRM knows: the form kept
 * with the last live (P) file made for it — the CSN, or the last amendment —
 * that ICEGATE did not reject (a reply awaited counts as accepted, 100).
 * Null when no live file was made since the CRM started keeping them (099).
 */
export async function filedDraftFor(subject: CsnSubject): Promise<CsnDraft | null> {
  const { data, error } = await supabase
    .from("csn_files")
    .select("draft")
    .eq(...owner(subject))
    .eq("indicator", "P")
    .not("draft", "is", null)
    .or("reply_status.is.null,reply_status.eq.accepted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.draft as CsnDraft | undefined) ?? null;
}

export interface ReplyOutcome {
  file: CsnFileRow;
  status: ReplyStatus;
  /** What the reply put on record, in words. */
  recorded: string[];
  /** What it could not, and why. */
  notes: string[];
}

/**
 * ICEGATE's reply, kept on the file it answers (found by its job number), and
 * on an accepted live file what it brings: the CSN number and date (on the
 * console and every job, as `recordCsn`), the master line's CIN on the console,
 * and each house's CIN on its job's customs record. A test file's reply is
 * kept and nothing else: a test filing is not a CSN.
 *
 * Refused when the reply is not for this desk, not for a file made in the
 * CRM, or for a file made for another console or job.
 */
export async function applyCsnReply(subject: CsnSubject, reply: CsnReply, settings: CsnSettings): Promise<ReplyOutcome> {
  if (!reply.jobNo) throw new Error("The reply does not say which file it answers: it has no job number.");
  const desk = settings.icegate_id.trim().toUpperCase();
  if (reply.sender && desk && reply.sender !== desk) throw new Error(`That reply is for sender ${reply.sender}, not this desk (${desk}).`);
  const { data, error } = await supabase.from("csn_files").select(FILE_COLS).eq("job_no", reply.jobNo).maybeSingle();
  if (error) throw new Error(error.message);
  const file = data as (CsnFileRow & { console_id: string | null; shipment_id: string | null }) | null;
  if (!file) throw new Error(`No CSN file with job number ${reply.jobNo} was made in the CRM. Is this the reply to a file made elsewhere?`);
  const [col, id] = owner(subject);
  if ((col === "console_id" ? file.console_id : file.shipment_id) !== id) {
    const other = file.console_id
      ? `console ${(await supabase.from("consoles").select("console_no").eq("id", file.console_id).maybeSingle()).data?.console_no ?? ""}`.trim()
      : file.shipment_id
        ? `job ${(await supabase.from("shipments").select("enquiry_ref").eq("id", file.shipment_id).maybeSingle()).data?.enquiry_ref ?? file.shipment_id}`
        : "another console or job";
    throw new Error(`That reply answers job no. ${file.job_no} (${file.file_name}), made for ${other}. Read it in there.`);
  }
  if (["SCE", "SCX", "SCA"].includes(reply.event) && reply.event !== file.event) {
    throw new Error(`That reply is for an ${reply.event} file, but job ${file.job_no} is an ${file.event}.`);
  }

  const status: ReplyStatus = reply.kind === "SFL" ? "failed" : reply.accepted ? "accepted" : "rejected";
  const { error: kept } = await supabase.rpc("csn_file_reply", { p_job: file.job_no, p_status: status, p_reply: reply });
  if (kept) throw new Error(kept.message);

  const recorded: string[] = [];
  const notes: string[] = [];
  if (status === "accepted" && file.indicator === "T") notes.push("It was a test file, so nothing was put on record.");
  if (status === "accepted" && file.indicator === "P") {
    if (file.event !== "SCA" && reply.csnNo) {
      const date = reply.csnDate || reply.date;
      await recordSubjectCsn(subject, reply.csnNo, date);
      const where = subject.kind === "console" ? "on the console and every job" : "on the job";
      recorded.push(`CSN ${reply.csnNo}${date ? ` of ${formatDate(date, { day: "numeric", month: "short", year: "numeric" })}` : ""}, ${where}`);
    }
    if (reply.masterCin && subject.kind === "console") {
      await updateConsole(subject.console.id, { cin_type: reply.masterCin.type, cargo_identification_no: reply.masterCin.no });
      recorded.push(`the master line's ${reply.masterCin.type || "CIN"} ${reply.masterCin.no}, on the console`);
    } else if (reply.masterCin) {
      notes.push(`The master line got ${reply.masterCin.type || "CIN"} ${reply.masterCin.no}: the job keeps its house's, so note the master's by hand.`);
    }
    const side = subjectEvent(subject) === "SCX" ? "export" : "import";
    for (const hc of reply.houseCins) {
      const h = file.draft?.houses.find((x, i) => (x.subLine ?? i + 1) === hc.subLine);
      if (!h) {
        notes.push(`House sub-line ${hc.subLine} got ${hc.type || "CIN"} ${hc.no}, but the CRM has no job for that sub-line on this file: note it by hand.`);
        continue;
      }
      try {
        const record = (await customsFor(h.shipmentId)).find((r) => r.side === side) ?? (await startCustoms(h.shipmentId, side));
        await updateCustoms(record.id, { cin_type: hc.type || null, cin_no: hc.no });
        recorded.push(`${hc.type || "CIN"} ${hc.no} on ${h.ref || h.shipmentId}`);
      } catch (e) {
        notes.push(`${h.ref || h.shipmentId}: ${hc.type || "CIN"} ${hc.no} was not recorded (${(e as Error).message}).`);
      }
    }
  }
  return { file: { ...file, reply_status: status, reply, replied_at: new Date().toISOString() }, status, recorded, notes };
}

/** The CSN number ICEGATE issued, where the subject keeps it: a console's on it and every job; a job's on its customs record. */
export async function recordSubjectCsn(subject: CsnSubject, csnNo: string, csnDate: string): Promise<void> {
  if (subject.kind === "console") {
    await recordCsn(subject.console, csnNo, csnDate);
    return;
  }
  const side = subjectEvent(subject) === "SCX" ? "export" : "import";
  const id = subject.shipment.id;
  const record = (await customsFor(id)).find((r) => r.side === side) ?? (await startCustoms(id, side));
  await updateCustoms(record.id, { csn_no: csnNo.trim(), csn_filed_on: csnDate || null });
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
