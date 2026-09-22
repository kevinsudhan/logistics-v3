import { readText } from "./classify";
import { updateEnquiry, type Enquiry, type FiledMessage } from "./enquiries";
import { byKey, type FieldDef } from "../data/requestFields";
import { threadText } from "../lib/mailText";

/**
 * Filling the blanks from the mail, without being asked.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM
 *
 * A consol enquiry is answered across a fortnight of replies. The CFS arrives
 * in one mail, the cut-off in the agent's answer three days later, the UN
 * number when somebody finally asks whether it is hazardous. Every one of those
 * answers is already in the thread and none of them is in the fields, because
 * nobody opens a details form to re-type what they have just read.
 *
 * So the details panel is blank on an enquiry whose correspondence answers most
 * of it, and the co-loader is asked a second time for something the shipper
 * already said.
 *
 * WHAT THIS DOES
 *
 * When an enquiry is opened and its correspondence has grown since the last
 * reading, the new thread is read once and anything it answers that is still
 * blank is written. Nothing else.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES, AND WHY EACH ONE IS THERE
 *
 * 1. BLANKS ONLY. A value already recorded is never touched, even when the
 *    reading is confident it disagrees. Somebody typed it, or a previous
 *    reading was confirmed by somebody leaving it — either way a model does not
 *    get to overwrite a human on a field that ends up on a bill of lading. A
 *    correction is a person's job.
 *
 * 2. ONCE PER NEW MESSAGE. Gated on `details_read_at`, the high-water mark from
 *    048. Re-reading an unchanged thread costs a model call against live
 *    customer mail and cannot produce anything the first reading did not.
 *
 * 3. THE MARK MOVES EVEN WHEN NOTHING IS FOUND. A thread that was read and
 *    answered nothing is still a thread that was read. Leaving the mark behind
 *    would re-read it on every page load for ever.
 *
 * 4. IT SAYS WHAT IT DID. Every automatic write is logged to the timeline with
 *    the fields it filled, so the answer to "where did this CFS come from" is
 *    on the same screen as the CFS. An invisible automatic edit to a field that
 *    prints on a document is not something this desk should have.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not run on mail arriving in the background — it runs when somebody
 * opens the enquiry. A silent write to a record nobody is looking at, made from
 * a mail nobody has read yet, is a worse trade than a one-second fill on the
 * screen where it will be noticed.
 * ---------------------------------------------------------------------------
 */

/**
 * The cargo fields, which the consol panel does not show but a reading fills.
 *
 * ---------------------------------------------------------------------------
 * Without these the automatic fill could write the CFS and the packing group
 * and not the origin — so a details panel sat empty in front of a mail that
 * named the lane, the pieces and the weight, under a banner listing exactly
 * the fields the fill was not permitted to touch.
 *
 * They live here rather than in the panel's own list because what a screen
 * DISPLAYS and what a reading may WRITE are different questions. Answering
 * them with one list is what caused this.
 * ---------------------------------------------------------------------------
 */
export const CARGO_KEYS = [
  "origin",
  "destination",
  "cargo",
  "cargo_type",
  "incoterm",
  "ready_date",
  "pickup_location",
  "piece_count",
  "piece_length_cm",
  "piece_width_cm",
  "piece_height_cm",
  "weight_per_piece_kg",
  "gross_weight_kg",
  "volume_cbm",
  "stackable",
  "consignee_name",
  "consignee_country",
];

/** What was filled, for the line the panel shows afterwards. */
export interface AutoFilled {
  /** The fields written, in catalogue order. */
  fields: Array<{ key: string; def: FieldDef; value: unknown }>;
  /** The subject of the newest message read, so the source is nameable. */
  from: string;
}

/**
 * Read what is new and fill what is blank.
 *
 * @param enquiry the enquiry as loaded, including `details_read_at`
 * @param mail    its correspondence, newest or oldest first — order is not assumed
 * @param keys    the fields this is allowed to fill; the panel's own list, so
 *                the two cannot drift apart
 * @returns what was filled, or null when there was nothing new or nothing found
 */
export async function fillFromNewMail(
  enquiry: Enquiry,
  mail: FiledMessage[],
  keys: string[],
  /** Whose mailbox to fetch the full bodies from. */
  mailbox: string
): Promise<AutoFilled | null> {
  if (mail.length === 0) return null;

  const record = enquiry as unknown as Record<string, unknown>;
  const newest = mail.reduce(
    (max, f) => (f.message.receivedDateTime > max ? f.message.receivedDateTime : max),
    ""
  );
  if (!newest) return null;

  // Rule 2: nothing has arrived since the last reading.
  const mark = record.details_read_at as string | null | undefined;
  if (mark && newest <= mark) return null;

  // Rule 1: only the blanks are in play. When there are none, there is nothing
  // a reading could do, so the mark moves without one being made.
  const blanks = keys.filter((k) => isBlank(record[k]));
  if (blanks.length === 0) {
    await stamp(enquiry.ref, newest);
    return null;
  }

  /*
    The whole thread, bodies and all.

    Two things matter here and both were wrong before. The first is that this
    reads the FULL text: `bodyPreview` is a 255-character snippet, and passing
    it to the model meant showing it the greeting and the first line of a
    freight enquiry — which is why mails that plainly stated the cut-offs and
    the weights came back with almost nothing filled in.

    The second is that it reads the whole thread rather than only what is
    newer than the mark. A reply saying "Chennai, and the 14th" answers two
    fields and names neither; the question giving it meaning is in an older
    message. The mark decides WHETHER to read, not how much context it gets.
  */
  const text = await threadText(
    mailbox,
    mail.map((f) => f.message)
  );

  const reading = (await readText({ body: text, subject: enquiry.ref })) as unknown as Record<
    string,
    unknown
  >;

  const fields = blanks
    .map((key) => ({ key, def: byKey(key), value: reading[key] }))
    .filter(
      (f): f is { key: string; def: FieldDef; value: unknown } =>
        !!f.def && f.value !== null && f.value !== undefined && f.value !== ""
    );

  // Rule 3: read is read, whether or not it yielded anything.
  if (fields.length === 0) {
    await stamp(enquiry.ref, newest);
    return null;
  }

  const patch: Record<string, unknown> = { details_read_at: newest };
  for (const f of fields) patch[f.key] = f.value;

  // Rule 4: the summary is what the timeline will show, so it names the fields
  // rather than counting them — "filled 3 fields" is not an audit trail.
  await updateEnquiry(
    enquiry.ref,
    patch as Partial<Enquiry>,
    `Filled from the correspondence: ${fields.map((f) => f.def.label).join(", ")}`
  );

  const subject = mail.find((f) => f.message.receivedDateTime === newest)?.message.subject ?? "";
  return { fields, from: subject };
}

/** Move the mark without writing anything else. */
async function stamp(ref: string, at: string): Promise<void> {
  await updateEnquiry(ref, { details_read_at: at } as Partial<Enquiry>);
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}
