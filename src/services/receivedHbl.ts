import { supabase } from "../lib/supabase";
import { normaliseHbl, type HblData, type ReleaseMode } from "../lib/hbl";
import type { CustomsRecord } from "../lib/customs";
import { billFromReading, jobBlanksFromBill, type BillReading, type JobBlanks, type ReceivedStage } from "../lib/receivedHbl";
import { uploadFile } from "./attachments";
import { customsFor, startCustoms, updateCustoms } from "./customs";
import { updateShipment } from "./enquiries";

/**
 * A house B/L somebody else issued, received on our job (088).
 *
 * One per shipment. The boxes are kept as our own B/L keeps them; saving
 * puts their number on the job (the database does), so the arrival notice,
 * the DO and the pre-alert print it. The house-level manifest lives on the
 * job's import customs record, which the bill of entry reads too.
 */

export interface ReceivedHblRow {
  shipment_id: string;
  issuer_partner_id: string | null;
  issuer_name: string;
  hbl_no: string;
  agent_ref: string;
  stage: ReceivedStage;
  confirmed_at: string | null;
  confirmed_by: string | null;
  corrections: string;
  release_mode: ReleaseMode;
  originals: number;
  data: HblData;
  file_id: string | null;
  originals_surrendered_on: string | null;
  telex_received_on: string | null;
  charges_cleared_on: string | null;
  do_issued_on: string | null;
  do_valid_until: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type ReceivedHblInput = Omit<ReceivedHblRow, "shipment_id" | "confirmed_at" | "confirmed_by" | "updated_at" | "updated_by">;

const failure = (e: { message: string; hint?: string | null }) => new Error(e.hint ? `${e.message}. ${e.hint}` : e.message);

export async function getReceivedHbl(shipmentId: string): Promise<ReceivedHblRow | null> {
  const { data, error } = await supabase.from("received_house_bills").select("*").eq("shipment_id", shipmentId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? ({ ...data, data: normaliseHbl(data.data) } as ReceivedHblRow) : null;
}

export async function saveReceivedHbl(shipmentId: string, input: ReceivedHblInput, exists: boolean): Promise<ReceivedHblRow> {
  const values = { ...input, originals: input.release_mode === "express" ? 0 : Math.min(3, Math.max(1, input.originals || 3)) };
  const { error } = exists
    ? await supabase.from("received_house_bills").update(values).eq("shipment_id", shipmentId)
    : await supabase.from("received_house_bills").insert({ shipment_id: shipmentId, ...values });
  if (error) throw failure(error);
  return (await getReceivedHbl(shipmentId))!;
}

/** One field or a few, without the rest of the form: a tick on the release checklist. */
export async function patchReceivedHbl(shipmentId: string, patch: Partial<ReceivedHblInput>): Promise<void> {
  const { error } = await supabase.from("received_house_bills").update(patch).eq("shipment_id", shipmentId);
  if (error) throw failure(error);
}

const toBase64 = (file: File) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => fail(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });

export const BILL_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/**
 * Their PDF: filed on the Documents tab, and read into boxes.
 *
 * Filed first, so the document is kept even when the reading fails. The
 * reading is Gemini's (classify-enquiry, mode "hbl"); nothing is saved from
 * it until a person has looked at the boxes and pressed Save.
 */
export async function readBillFile(enquiryRef: string, file: File): Promise<{ fileId: string; reading: ReturnType<typeof billFromReading> | null; readError: string | null }> {
  if (!BILL_FILE_TYPES.includes(file.type)) throw new Error("Send the B/L as a PDF, or a JPG, PNG or WebP picture of it.");
  if (file.size > 7 * 1024 * 1024) throw new Error("That file is over 7 MB, too large to read. A smaller scan will do.");
  const filed = await uploadFile({ enquiryRef, file, documentType: "House B/L (agent's)" });
  try {
    const { data, error } = await supabase.functions.invoke("classify-enquiry", {
      body: { mode: "hbl", file_base64: await toBase64(file), file_mime: file.type },
    });
    if (error) throw new Error(error.message);
    const r = data as BillReading & { error?: string };
    if (r.error) throw new Error(r.error);
    if (r.is_bill_of_lading === false) return { fileId: filed.id, reading: null, readError: "That does not look like a bill of lading. It is filed on the Documents tab; type the boxes in instead." };
    return { fileId: filed.id, reading: billFromReading(r), readError: null };
  } catch (e) {
    return { fileId: filed.id, reading: null, readError: `Filed on the Documents tab, but it could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The job's empty boxes, filled from the bill. Returns what it filled, in words. */
export async function fillJobFromBill(shipmentId: string, bill: HblData, job: JobBlanks): Promise<string[]> {
  const { patch, filled } = jobBlanksFromBill(bill, job);
  if (filled.length) await updateShipment(shipmentId, patch);
  return filled;
}

/** The job's import customs record, where the manifest numbers live. */
export async function importCustoms(shipmentId: string): Promise<CustomsRecord | null> {
  return (await customsFor(shipmentId)).find((r) => r.side === "import") ?? null;
}

/** The manifest numbers, starting the import customs record if the job has none yet. */
export async function saveManifest(
  shipmentId: string,
  patch: Partial<Pick<CustomsRecord, "igm_number" | "igm_date" | "igm_item" | "igm_subline" | "csn_no" | "csn_filed_on" | "cfs_code" | "cin_no">>
): Promise<CustomsRecord> {
  const existing = await importCustoms(shipmentId);
  const record = existing ?? (await startCustoms(shipmentId, "import"));
  return updateCustoms(record.id, patch);
}
