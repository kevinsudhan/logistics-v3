import { supabase } from "../lib/supabase";
import { refFromSubject, subjectToken, type PartyRole } from "./caseFile";
import {
  conversationMessages,
  getMailMessage,
  getMailMessages,
  mailIsLive,
  searchMail,
  type MailMessage,
} from "./backend";

/**
 * Enquiries, against v2's own Supabase project.
 *
 * ---------------------------------------------------------------------------
 * REAL DATA, NOT FIXTURES
 *
 * Nothing in here is seeded. An enquiry exists because somebody created one
 * from a real email or entered one by hand, and every screen shows an empty
 * state until that happens. Sample rows would make the pipeline look busy and
 * teach nobody anything about whether it works.
 *
 * This is v2's project, not v1's. The production CRM and the live voice agents
 * are untouched by anything done here.
 * ---------------------------------------------------------------------------
 */

export type EnquiryStatus =
  | "new"
  | "qualifying"
  | "quoted"
  | "accepted"
  | "declined"
  | "lost";

export type EnquirySource = "email" | "call" | "whatsapp" | "web" | "manual";

export const STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: "New",
  qualifying: "Qualifying",
  quoted: "Quoted",
  accepted: "Accepted",
  declined: "Declined",
  lost: "Lost",
};

/** The inbound pipeline, in the order an enquiry moves through it. */
export const INBOUND_STATUSES: EnquiryStatus[] = ["new", "qualifying", "quoted", "accepted"];

export interface Customer {
  id: string;
  name: string;
  company: string;
  phones: string[];
  emails: string[];
}

export interface Enquiry {
  ref: string;
  customer_id: string;
  seq: number;
  status: EnquiryStatus;
  source: EnquirySource;

  origin: string | null;
  destination: string | null;
  cargo: string | null;
  cargo_type: string | null;
  incoterm: string | null;
  ready_date: string | null;
  pickup_location: string | null;

  /** The container this is travelling on, once one has been chosen. */
  sailing_id: string | null;

  piece_count: number | null;
  piece_length_cm: number | null;
  piece_width_cm: number | null;
  piece_height_cm: number | null;
  weight_per_piece_kg: number | null;
  gross_weight_kg: number | null;
  volume_cbm: number | null;
  stackable: boolean | null;
  upright_only: boolean | null;
  special_handling: string | null;

  /* Cargo details (063). */
  /** Dangerous goods. Null is "nobody has said", not "no". */
  hazardous: boolean | null;
  expected_delivery_date: string | null;
  /**
   * The unit the dimension lines are entered in. The totals above are always
   * centimetres, kilos and CBM whatever this says.
   */
  dimension_unit: "cm_kg" | "in_lb";

  /**
   * How it travels (047).
   *
   * Asked rather than derived: the chargeable-weight ratios are per mode and
   * are not interchangeable, and an enquiry has no sailing to read it off at
   * the point somebody wants the figure.
   */
  transport_mode: "sea_lcl" | "sea_fcl" | "air" | "road" | "other" | null;

  /* What the job includes (061). */
  /** We collect from the shipper, rather than them delivering to us. */
  pickup_required: boolean | null;
  /** We deliver at destination, rather than handing over at the port. */
  delivery_required: boolean | null;
  delivery_location: string | null;
  transit_days: number | null;
  /** The customer's own number for this — their PO or booking reference. */
  customer_reference: string | null;

  /**
   * Which way the cargo is going (031).
   *
   * On the table since 031 and guessed from the route where it was not given,
   * but never declared here — so every reader of it went through a cast. It
   * decides which charge heads apply and which rates match.
   */
  trade_direction: "export" | "import" | "cross_trade" | null;

  consignee_name: string | null;
  consignee_address: string | null;
  consignee_country: string | null;

  /* What a consol agent asks for before they will quote (046, 047). */
  cfs_location: string | null;
  cargo_cutoff: string | null;
  si_cutoff: string | null;
  marks_and_numbers: string | null;
  freight_terms: "prepaid" | "collect" | null;
  notify_name: string | null;
  notify_address: string | null;

  /* The packing list and the customs entry (047). */
  package_count: number | null;
  package_type: string | null;
  hs_code: string | null;
  net_weight_kg: number | null;

  /* Dangerous goods, as the carrier's DG desk asks for them (046, 047). */
  un_number: string | null;
  imo_class: string | null;
  packing_group: "I" | "II" | "III" | null;
  flash_point_c: number | null;
  msds_provided: boolean | null;

  /**
   * How far the correspondence has been read for the above (048).
   *
   * The `receivedDateTime` of the newest message already read. See
   * services/autoFill.ts, which is the only thing that writes it.
   */
  details_read_at: string | null;

  notes: string | null;
  /**
   * When this reached the desk, which is not when the row was made.
   *
   * For anything that came through the queue it is the message or call
   * timestamp. Null for an enquiry opened by hand, where there is nothing
   * earlier than somebody typing it in and `opened_at` is the arrival.
   */
  received_at: string | null;
  opened_at: string;
  updated_at: string;

  /** Who took this one on, and when. Null means it is still on the shared board. */
  assigned_to: string | null;
  assigned_at: string | null;
}

export interface Party {
  id: string;
  enquiry_ref: string;
  role: PartyRole;
  name: string;
  organisation: string;
  emails: string[];
}

export interface Quote {
  id: string;
  enquiry_ref: string;
  version: number;
  amount_inr: number;
  basis: string;
  valid_until: string | null;
  sailing_date: string | null;
  status: "draft" | "sent" | "accepted" | "declined" | "expired" | "superseded";
  sent_at: string | null;
  responded_at: string | null;
  /**
   * The caller said yes on the phone.
   *
   * Not an acceptance. It is the reason to chase one -- a transcript the ASR
   * guessed at is not something to commit a container on.
   */
  verbal_accept_at: string | null;
  /** How the written confirmation arrived. Null means it has not. */
  accepted_via: "email" | "manual" | null;
  /** The message the acceptance came from, so it points at evidence. */
  accepted_message_id: string | null;
  acceptance_note: string;
  created_at: string;

  /* The quotation's own header (055). */
  currency: string;
  /** Rate of exchange from the quote currency to INR, as agreed on the quotation. */
  fx_rate: number;
  quote_type: "standard" | "spot" | "contract";
  multi_carrier: boolean;

  /* Where the quotation is with US, rather than with the customer (052). */
  approval_status: "draft" | "pending" | "approved" | "rejected";
  submitted_at: string | null;
  submitted_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approval_note: string;
  /** The terms printed under the charges, copied on at the time of sending. */
  terms: Array<{ scope: string; text: string }>;
}

/** One line of the sign-off checklist, as `shipment_signoff_checklist` returns it. */
export interface SignOffItem {
  key: string;
  label: string;
  ok: boolean;
  /** Must pass — only an admin, with a reason, can sign past it. */
  blocking: boolean;
  detail: string | null;
}

export type ShipmentStage =
  | "booked"
  | "cargo_received"
  | "stuffed"
  | "gated_in"
  | "sailed"
  | "arrived"
  | "delivered"
  | "cancelled";

export const SHIPMENT_STAGE_LABEL: Record<ShipmentStage, string> = {
  booked: "Booked",
  cargo_received: "Cargo received",
  stuffed: "Stuffed",
  gated_in: "Gated in",
  sailed: "Sailed",
  arrived: "Arrived",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/**
 * The stages a shipment of this mode actually passes through.
 *
 * An air job is never stuffed into a box or gated into a terminal, and
 * offering "Move to stuffed" on one is a button nobody can press truthfully.
 */
export function stagesFor(mode: Enquiry["transport_mode"] | null | undefined): ShipmentStage[] {
  // Each of these has a step on that mode's workflow that marks it (066): the
  // stage moves when the step is ticked, so a stage with no step would be a
  // button that cannot work.
  switch (mode) {
    case "air":
    // An LCL house shipment is received into the CFS; the console, not the
    // shipment, is stuffed and gated in.
    case "sea_lcl":
      return ["booked", "cargo_received", "sailed", "arrived", "delivered"];
    case "sea_fcl":
      return ["booked", "stuffed", "gated_in", "sailed", "arrived", "delivered"];
    default:
      return ["booked", "cargo_received", "sailed", "delivered"];
  }
}

/** "Departed" for a flight, "Dispatched" for a truck — "Sailed" only at sea. */
export function stageLabel(
  stage: ShipmentStage,
  mode: Enquiry["transport_mode"] | null | undefined
): string {
  if (stage === "sailed") {
    if (mode === "air") return "Departed";
    if (mode === "road" || mode === "other") return "Dispatched";
  }
  return SHIPMENT_STAGE_LABEL[stage];
}

/** The order operations actually moves through, for the stage control. */
export const SHIPMENT_STAGES: ShipmentStage[] = [
  "booked",
  "cargo_received",
  "stuffed",
  "gated_in",
  "sailed",
  "arrived",
  "delivered",
];

export interface Shipment {
  id: string;
  enquiry_ref: string;
  customer_id: string;
  stage: ShipmentStage;
  origin: string | null;
  destination: string | null;
  cargo: string | null;
  piece_count: number | null;
  volume_cbm: number | null;
  gross_weight_kg: number | null;
  agreed_inr: number | null;
  sailing_date: string | null;
  carrier: string | null;
  booking_number: string | null;
  container_number: string | null;
  bl_number: string | null;
  vessel: string | null;
  etd: string | null;
  eta: string | null;

  /** The booked space this shipment is on. The column has existed since 010. */
  sailing_id: string | null;

  /**
   * The particulars a shipping document is made of.
   *
   * Added because the registry could issue twelve documents and only three came
   * out as finals against a real booking — not for want of typing, but because
   * there was nowhere to type them. All nullable: the draft a document prints
   * while one is missing is what the desk sends to chase it.
   */
  container_type: string | null;
  consignee_name: string | null;
  consignee_address: string | null;
  consignee_country: string | null;
  shipper_name: string | null;
  shipper_gstin_iec: string | null;
  package_count: number | null;
  package_type: string | null;
  hs_code: string | null;
  net_weight_kg: number | null;
  invoice_value_inr: number | null;
  incoterm: string | null;
  payment_terms: string | null;
  letter_of_credit: boolean | null;

  /**
   * The party boxes as a bill of lading prints them (033).
   *
   * Prefixed by role rather than held in a table, because the document pipeline
   * reads five of these columns directly and the shipment's Party tab writes
   * them — a table would need a mirror with two writers racing on it.
   */
  shipper_address: string | null;
  shipper_city: string | null;
  shipper_state: string | null;
  shipper_state_code: string | null;
  shipper_country: string | null;
  shipper_country_code: string | null;
  shipper_pincode: string | null;
  shipper_gstin: string | null;
  shipper_pan: string | null;
  shipper_iec: string | null;

  consignee_city: string | null;
  consignee_state: string | null;
  consignee_state_code: string | null;
  consignee_country_code: string | null;
  consignee_pincode: string | null;
  consignee_gstin: string | null;
  consignee_pan: string | null;
  consignee_iec: string | null;
  consignee_dpd_code: string | null;

  notify_name: string | null;
  notify_address: string | null;
  notify_city: string | null;
  notify_state: string | null;
  notify_state_code: string | null;
  notify_country: string | null;
  notify_country_code: string | null;
  notify_pincode: string | null;
  notify_gstin: string | null;
  notify_pan: string | null;
  notify_iec: string | null;

  /** Whose bill the cargo travels under when it is co-loaded. */
  bl_type: "house" | "forwarder" | null;
  forwarders_bl_no: string | null;

  /**
   * The console this shipment's house bill sits under (035).
   *
   * Null on a direct FCL job moving under the carrier's own bill — a console of
   * one would put a master bill number on a shipment that does not have one.
   */
  console_id: string | null;

  /** Job-level particulars that sit under the container grid (032). */
  agent_code: string | null;
  mainline_no: string | null;
  cfs_clearance_date: string | null;
  tsa_no: string | null;
  tsa_date: string | null;

  /* Job facts, copied from the enquiry and kept in step with it (065). */
  voyage: string | null;
  transport_mode: Enquiry["transport_mode"];
  trade_direction: Enquiry["trade_direction"];
  un_number: string | null;
  imo_class: string | null;
  packing_group: "I" | "II" | "III" | null;
  flash_point_c: number | null;
  msds_provided: boolean | null;

  /* Booking particulars — the shipment's own once it exists (047, 065). */
  cfs_location: string | null;
  cargo_cutoff: string | null;
  si_cutoff: string | null;
  marks_and_numbers: string | null;
  freight_terms: "prepaid" | "collect" | null;

  /* The shipment page's own (065). */
  shipment_date: string | null;
  /** The carrier's bill goes straight to the shipper; no house bill. */
  direct: boolean;
  routed: "self" | "agent";
  routed_agent_id: string | null;
  origin_booking_person: string | null;
  destination_booking_person: string | null;
  flight_number: string | null;
  etd_time: string | null;
  eta_time: string | null;
  port_of_loading: string | null;
  port_of_discharge: string | null;
  shipper_email: string | null;
  consignee_email: string | null;
  notify_email: string | null;

  /** The departure this booking was built from (071), if one was picked. */
  schedule_id: string | null;

  /** The ship's AIS identity, for following it (072). */
  vessel_mmsi: string | null;
  vessel_imo: string | null;

  /* Closed by operations (070). Set and cleared only by the sign-off functions. */
  signed_off_at: string | null;
  signed_off_by: string | null;
  sign_off_note: string | null;
  sign_off_snapshot: SignOffItem[] | null;

  created_at: string;
  updated_at: string;
}

/** Any column on a shipment row may be patched through `updateShipment`. */
export async function updateShipment(
  id: string,
  patch: Record<string, unknown>
): Promise<Shipment> {
  const { data, error } = await supabase
    .from("shipments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Shipment;
}

export interface EnquiryEvent {
  id: string;
  enquiry_ref: string;
  kind: string;
  summary: string;
  detail: Record<string, unknown>;
  /** Who did it. Null when the change came from the server rather than a person. */
  actor: string | null;
  at: string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Everyone on the desk, so a user id can be shown as a name.
 *
 * Fetched once and joined in the browser rather than embedded in every query.
 * There are four people here and there will be a handful more; a lookup table
 * of that size is cheaper to carry than a join repeated on every row of every
 * board, and it keeps the enquiry queries readable.
 */
export interface Person {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "employee";
  /** May hand an enquiry to somebody else. Administrators may regardless. */
  can_assign: boolean;
}

/**
 * The second lock on team oversight.
 *
 * ---------------------------------------------------------------------------
 * THE PASSWORD IS CHECKED IN THE DATABASE, NOT HERE
 *
 * `verifyOversightPassword` sends the attempt and gets back a boolean. The hash
 * never leaves Postgres, so there is nothing in the bundle to read and nothing
 * on the wire to capture and grind against offline. The table it lives in has
 * row-level security enabled and no policies at all, which means no client can
 * read it under any key the browser holds.
 *
 * The comparison is bcrypt at cost 12, so each attempt costs the server a few
 * hundred milliseconds. That is what makes guessing impractical, and it is also
 * why the button needs a spinner.
 * ---------------------------------------------------------------------------
 */
export async function verifyOversightPassword(password: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("verify_oversight_password", {
    p_password: password,
  });
  if (error) throw error;
  return data === true;
}

/** Whether anybody has set one yet, so the prompt can say if nobody has. */
export async function oversightLockIsSet(): Promise<boolean> {
  const { data, error } = await supabase.rpc("oversight_lock_is_set");
  if (error) throw error;
  return data === true;
}

/** Changes it. Administrators only; the database enforces that, not this. */
export async function setOversightPassword(password: string): Promise<void> {
  const { error } = await supabase.rpc("set_oversight_password", { p_password: password });
  if (error) throw error;
}

export async function listPeople(): Promise<Person[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, can_assign")
    .order("full_name");
  if (error) throw error;
  return (data ?? []) as Person[];
}

/** A name to show for a user id, falling back to the address, then to nothing. */
export function nameOf(people: Person[] | Map<string, Person>, id: string | null): string | null {
  if (!id) return null;
  const p = people instanceof Map ? people.get(id) : people.find((x) => x.id === id);
  if (!p) return null;
  return p.full_name?.trim() || p.email;
}

/**
 * When an enquiry arrived, for anything measuring how long it waited.
 *
 * The fallback is the point. `opened_at` is when the row was created, which for
 * a queued enquiry is when somebody finally dealt with it — using that as the
 * arrival made every wait read as nothing at all, because it was being
 * subtracted from itself.
 */
export function arrivedAt(e: Pick<Enquiry, "received_at" | "opened_at">): string {
  return e.received_at ?? e.opened_at;
}

/**
 * Takes an enquiry on.
 *
 * The database refuses one somebody else already holds, so two people pressing
 * a second apart cannot both end up believing it is theirs. Pressing it on your
 * own is not an error and changes nothing.
 */
export async function claimEnquiry(ref: string): Promise<Enquiry> {
  const { data, error } = await supabase.rpc("claim_enquiry", { p_ref: ref.toUpperCase() });
  if (error) throw error;
  return data as Enquiry;
}

/**
 * Hands an enquiry to somebody else, or back to the board with `null`.
 *
 * Restricted to people the desk has given the permission to, which the database
 * checks — this is not a matter of hiding a button. One call rather than a
 * release followed by a claim, because a hand-off is one decision and half of
 * it landing would leave the work belonging to nobody.
 */
export async function assignEnquiry(ref: string, toUserId: string | null): Promise<Enquiry> {
  const { data, error } = await supabase.rpc("assign_enquiry", {
    p_ref: ref.toUpperCase(),
    p_to: toUserId,
  });
  if (error) throw error;
  return data as Enquiry;
}

/** Whether this person may put work on somebody else's list. */
export function mayAssignOthers(people: Person[], id: string | undefined): boolean {
  if (!id) return false;
  const me = people.find((p) => p.id === id);
  return !!me && (me.role === "admin" || me.can_assign);
}

/** Puts it back on the shared board. Admins may release anybody's. */
export async function releaseEnquiry(ref: string): Promise<Enquiry> {
  const { data, error } = await supabase.rpc("release_enquiry", { p_ref: ref.toUpperCase() });
  if (error) throw error;
  return data as Enquiry;
}

/** Every event across every enquiry, newest first — the admin's activity feed. */
export async function allEvents(limit = 200): Promise<EnquiryEvent[]> {
  const { data, error } = await supabase
    .from("enquiry_events")
    .select("*")
    .order("at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as EnquiryEvent[];
}

export async function listEnquiries(): Promise<Array<Enquiry & { customer: Customer | null }>> {
  const { data, error } = await supabase
    .from("enquiries")
    .select("*, customer:customers(*)")
    .order("opened_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Array<Enquiry & { customer: Customer | null }>;
}

export async function getEnquiry(
  ref: string
): Promise<(Enquiry & { customer: Customer | null }) | null> {
  const { data, error } = await supabase
    .from("enquiries")
    .select("*, customer:customers(*)")
    .eq("ref", ref.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return (data as (Enquiry & { customer: Customer | null }) | null) ?? null;
}

export async function listCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase.from("customers").select("*").order("company");
  if (error) throw error;
  return (data ?? []) as Customer[];
}

export async function partiesFor(ref: string): Promise<Party[]> {
  const { data, error } = await supabase
    .from("enquiry_parties")
    .select("*")
    .eq("enquiry_ref", ref.toUpperCase());
  if (error) throw error;
  return (data ?? []) as Party[];
}

export async function quotesFor(ref: string): Promise<Quote[]> {
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("enquiry_ref", ref.toUpperCase())
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Quote[];
}

export async function eventsFor(ref: string): Promise<EnquiryEvent[]> {
  const { data, error } = await supabase
    .from("enquiry_events")
    .select("*")
    .eq("enquiry_ref", ref.toUpperCase())
    .order("at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EnquiryEvent[];
}

/**
 * The most recent events across every enquiry, for the overview.
 *
 * The overview used to render a hand-written list of things that had supposedly
 * happened — flagged documents, a booking locked, a vessel delayed — none of
 * which referred to a record that existed. This returns what the timeline
 * actually recorded, so an empty desk shows an empty feed rather than a busy
 * one that means nothing.
 */
export async function recentEvents(limit = 8): Promise<EnquiryEvent[]> {
  const { data, error } = await supabase
    .from("enquiry_events")
    .select("*")
    .order("at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as EnquiryEvent[];
}

/** How many calls are on record, counted by the database rather than by us. */
export async function countCalls(): Promise<number> {
  const { count, error } = await supabase
    .from("calls")
    .select("call_id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

/**
 * Turns an accepted enquiry into a shipment.
 *
 * The database refuses unless a quote has actually been accepted, so the guard
 * cannot be bypassed by calling this directly. Pressing twice returns the
 * existing shipment rather than raising: the second press means "did that
 * work?", and an error there would read as a failure.
 */
export async function promoteToShipment(ref: string): Promise<Shipment> {
  const { data, error } = await supabase.rpc("promote_enquiry", { p_ref: ref.toUpperCase() });
  if (error) throw error;
  return data as Shipment;
}

export async function shipmentFor(ref: string): Promise<Shipment | null> {
  const { data, error } = await supabase
    .from("shipments")
    .select("*")
    .eq("enquiry_ref", ref.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return (data as Shipment | null) ?? null;
}

/**
 * Shipments, with whoever is handling them.
 *
 * ---------------------------------------------------------------------------
 * A SHIPMENT'S OWNER IS ITS ENQUIRY'S OWNER
 *
 * Derived through the join rather than copied into a column on `shipments`.
 * They are one job: the person who took the enquiry on is the person who sees
 * it through to delivery, and a second `assigned_to` would let the board and
 * the case file disagree about who that is.
 *
 * Handing a job over therefore happens in one place — on the enquiry — and both
 * views follow it.
 * ---------------------------------------------------------------------------
 */
export async function listShipments(
  stages?: ShipmentStage[]
): Promise<Array<ShipmentRow>> {
  let q = supabase
    .from("shipments")
    .select("*, customer:customers(*), enquiry:enquiries(assigned_to, assigned_at)");
  if (stages?.length) q = q.in("stage", stages);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const { enquiry, ...rest } = row as Record<string, unknown> & {
      enquiry?: { assigned_to?: string | null; assigned_at?: string | null } | null;
    };
    return {
      ...(rest as unknown as Shipment & { customer: Customer | null }),
      assigned_to: enquiry?.assigned_to ?? null,
      assigned_at: enquiry?.assigned_at ?? null,
    };
  });
}

/**
 * A shipment as the boards show it: the row, its customer, and who has it.
 *
 * `assigned_to` is not a column — it is the enquiry's, joined in. See
 * `listShipments`.
 */
export interface ShipmentRow extends Shipment {
  customer: Customer | null;
  assigned_to: string | null;
  assigned_at: string | null;
}

/** One shipment by its id, with the customer attached. */
export async function getShipment(
  id: string
): Promise<(Shipment & { customer: Customer | null }) | null> {
  const { data, error } = await supabase
    .from("shipments")
    .select("*, customer:customers(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as (Shipment & { customer: Customer | null }) | null) ?? null;
}

export async function setShipmentStage(id: string, stage: ShipmentStage): Promise<Shipment> {
  const { data, error } = await supabase.rpc("set_shipment_stage", {
    p_id: id,
    p_stage: stage,
  });
  if (error) throw error;
  return data as Shipment;
}

export async function threadsFor(ref: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("enquiry_threads")
    .select("conversation_id")
    .eq("enquiry_ref", ref.toUpperCase());
  if (error) throw error;
  return (data ?? []).map((r) => r.conversation_id as string);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Finds an existing customer by address, or creates one. Server-side, to avoid a race. */
export async function findOrCreateCustomer(input: {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
}): Promise<Customer> {
  const { data, error } = await supabase.rpc("create_customer", {
    p_name: input.name,
    p_company: input.company ?? "",
    p_email: input.email ?? null,
    p_phone: input.phone ?? null,
  });
  if (error) throw error;
  return data as Customer;
}

/**
 * Opens an enquiry.
 *
 * The reference is allocated inside the database rather than here: two
 * operators taking an enquiry from the same customer at the same moment would
 * otherwise both read the same maximum and both try to write E03.
 */
export async function createEnquiry(input: {
  customerId: string;
  source: EnquirySource;
  origin?: string;
  destination?: string;
  cargo?: string;
}): Promise<Enquiry> {
  const { data, error } = await supabase.rpc("create_enquiry", {
    p_customer_id: input.customerId,
    p_source: input.source,
    p_origin: input.origin ?? null,
    p_destination: input.destination ?? null,
    p_cargo: input.cargo ?? null,
  });
  if (error) throw error;
  return data as Enquiry;
}

export async function updateEnquiry(
  ref: string,
  patch: Partial<Enquiry>,
  summary?: string
): Promise<Enquiry> {
  const { data, error } = await supabase
    .from("enquiries")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("ref", ref.toUpperCase())
    .select()
    .single();
  if (error) throw error;

  if (summary) await logEvent(ref, "field_updated", summary, patch as Record<string, unknown>);
  return data as Enquiry;
}

export async function addParty(p: {
  enquiryRef: string;
  role: PartyRole;
  name: string;
  organisation?: string;
  emails: string[];
}): Promise<Party> {
  const { data, error } = await supabase
    .from("enquiry_parties")
    .insert({
      enquiry_ref: p.enquiryRef.toUpperCase(),
      role: p.role,
      name: p.name,
      organisation: p.organisation ?? "",
      emails: p.emails,
    })
    .select()
    .single();
  if (error) throw error;
  await logEvent(p.enquiryRef, "party_added", `${p.name} added as ${p.role.replace("_", " ")}`);
  return data as Party;
}

/** Binds a mail thread, so the rest of the conversation files itself. */
export async function bindThread(ref: string, conversationId: string, messageId?: string) {
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase.from("enquiry_threads").upsert(
    {
      conversation_id: conversationId,
      enquiry_ref: ref.toUpperCase(),
      bound_by: user.user?.id ?? null,
    },
    { onConflict: "conversation_id" }
  );
  if (error) throw error;

  if (messageId) {
    await supabase
      .from("enquiry_messages")
      .upsert(
        { message_id: messageId, enquiry_ref: ref.toUpperCase(), via: "manual" },
        { onConflict: "message_id,enquiry_ref" }
      );
  }
  await logEvent(ref, "mail_linked", "Mail thread linked to this enquiry");
}

export async function logEvent(
  ref: string,
  kind: string,
  summary: string,
  detail: Record<string, unknown> = {}
) {
  const { data: user } = await supabase.auth.getUser();
  await supabase.from("enquiry_events").insert({
    enquiry_ref: ref.toUpperCase(),
    kind,
    summary,
    detail,
    actor: user.user?.id ?? null,
  });
}

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

/**
 * Records a quote, superseding whatever was outstanding.
 *
 * Previous versions are kept rather than overwritten: when a customer says
 * "you told me a different number last week", the earlier figure is the answer,
 * and an overwritten row cannot give it.
 */
export async function addQuote(input: {
  ref: string;
  amountInr: number;
  basis: string;
  validUntil?: string;
  sailingDate?: string;
  /** The sailing schedule entry the date was picked from (071). */
  scheduleId?: string | null;
  /** What the customer is quoted in, and what it converts at (055). */
  currency?: string;
  fxRate?: number;
  quoteType?: "standard" | "spot" | "contract";
  multiCarrier?: boolean;
}): Promise<Quote> {
  const ref = input.ref.toUpperCase();
  const existing = await quotesFor(ref);

  await supabase
    .from("quotes")
    .update({ status: "superseded" })
    .eq("enquiry_ref", ref)
    .in("status", ["draft", "sent"]);

  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("quotes")
    .insert({
      enquiry_ref: ref,
      version: (existing[0]?.version ?? 0) + 1,
      amount_inr: input.amountInr,
      basis: input.basis,
      valid_until: input.validUntil ?? null,
      sailing_date: input.sailingDate ?? null,
      schedule_id: input.scheduleId ?? null,
      currency: input.currency ?? "INR",
      // A rupee quotation converts at 1. Anything else needs a rate, and
      // defaulting a foreign quotation to 1 would print the figure unchanged
      // and call it rupees.
      fx_rate: input.fxRate && input.fxRate > 0 ? input.fxRate : 1,
      quote_type: input.quoteType ?? "standard",
      multi_carrier: input.multiCarrier ?? false,
      status: "draft",
      created_by: user.user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Quote;
}

export async function markQuoteSent(quoteId: string, ref: string, amount: number) {
  const { error } = await supabase
    .from("quotes")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", quoteId);
  if (error) throw error;

  await updateEnquiry(ref, { status: "quoted" });
  await logEvent(ref, "quote_sent", `Quoted ₹${amount.toLocaleString("en-IN")}`);
}

/**
 * The customer said yes.
 *
 * This is the end of the inbound half: the enquiry becomes a commitment, and
 * everything downstream -- booking, allocation, documents -- starts from here.
 * Recorded as an explicit act rather than inferred from a mail, because a
 * booking is a thing somebody at the desk should have to affirm.
 */
export async function acceptQuote(quoteId: string, ref: string, amount: number) {
  const { error } = await supabase
    .from("quotes")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("id", quoteId);
  if (error) throw error;

  await updateEnquiry(ref, { status: "accepted" });
  await logEvent(ref, "accepted", `Customer accepted ₹${amount.toLocaleString("en-IN")}`);
}

export async function declineQuote(quoteId: string, ref: string, reason: string) {
  await supabase
    .from("quotes")
    .update({ status: "declined", responded_at: new Date().toISOString() })
    .eq("id", quoteId);
  await updateEnquiry(ref, { status: "declined" });
  await logEvent(ref, "declined", reason || "Customer declined the quote");
}

// ---------------------------------------------------------------------------
// Mail filing
// ---------------------------------------------------------------------------

export interface FiledMessage {
  message: MailMessage;
  role: PartyRole;
  via: "thread" | "subject" | "reference-in-body" | "manual";
  confidence: "certain" | "likely";
}

/**
 * The correspondence on an enquiry, gathered from the signed-in user's mailbox.
 *
 * A caveat worth stating: this reads the mailbox of whoever is signed in, so
 * an enquiry's mail is only as complete as that person's access. Gathering
 * every desk mailbox needs application permissions and a server to hold them,
 * which v2 does not have. Today's answer is honest rather than complete.
 */
export async function correspondenceFor(
  ref: string,
  mailbox: string
): Promise<FiledMessage[]> {
  if (!mailIsLive() || !mailbox) return [];

  const [threads, parties, pinned, owner] = await Promise.all([
    threadsFor(ref),
    partiesFor(ref),
    supabase.from("enquiry_messages").select("message_id, via").eq("enquiry_ref", ref.toUpperCase()),
    getEnquiry(ref),
  ]);

  /**
   * The customer's own addresses.
   *
   * Nothing ever writes the customer into enquiry_parties -- that table fills up
   * with the agents and brokers discovered from mail -- so without this the
   * person the enquiry belongs to was the one correspondent the case file could
   * not recognise, and their replies filed under "Other".
   */
  const clientAddresses = new Set(
    (owner?.customer?.emails ?? []).map((e) => e.toLowerCase())
  );

  const pinnedIds = new Map(
    (pinned.data ?? []).map((r) => [r.message_id as string, r.via as FiledMessage["via"]])
  );

  /*
    Gathered by identifier, not by scanning recent folders.

    This used to read the first page of inbox, sent and archive — fifty each —
    and keep whatever matched. Every rule below is a precise identifier, so the
    scan was never the thing that decided; it was only the supply of messages,
    and it silently capped the case file at "the last fifty, per folder". A
    thread bound to an older enquiry simply did not appear, and nothing said so:
    the binding was right, the correspondence was right, and the screen was
    empty. Filing a month-old exchange onto a job is exactly when somebody
    reaches for that button.

    Asking Graph for each thing by name has no such horizon and is fewer
    requests on a typical case file — three conversations rather than a hundred
    and fifty messages.
  */
  const seen = new Map<string, MailMessage>();

  const [byThread, bySubject, byPin] = await Promise.all([
    // Whole conversations, at any age.
    Promise.all(threads.map((id) => conversationMessages(mailbox, id).catch(() => []))),
    // Anything still carrying our token in its subject, anywhere in the mailbox.
    searchMail(mailbox, `"${subjectToken(ref)}"`).catch(() => [] as MailMessage[]),
    // Messages somebody pinned by hand, which may belong to no bound thread.
    Promise.all(
      [...pinnedIds.keys()].map((id) =>
        getMailMessage(mailbox, id)
          .then((r) => r.message)
          .catch(() => null)
      )
    ),
  ]);

  /*
    Stamp the direction on the way in.

    Graph does not say which folder a result of a conversation or search came
    from, and `adapt` fills in "inbox" because something has to go there. Every
    reader downstream — this function, MailRow, the compose box — decides
    inbound or outbound from `folder === "sent"`, so left alone our own replies
    would render as though the customer had sent them.

    The sender is the fact the folder was standing in for, so it is read once
    here and the folder set to match. One place, and nothing downstream has to
    know this happened.
  */
  const remember = (m: MailMessage) => {
    const outbound = m.from.emailAddress.address.toLowerCase() === mailbox.toLowerCase();
    seen.set(m.id, outbound && m.folder !== "sent" ? { ...m, folder: "sent" } : m);
  };

  for (const page of byThread) for (const m of page) remember(m);
  for (const m of bySubject) remember(m);
  for (const m of byPin) if (m) remember(m);

  const out: FiledMessage[] = [];
  for (const m of seen.values()) {
    let via: FiledMessage["via"] | null = null;

    if (pinnedIds.has(m.id)) via = pinnedIds.get(m.id)!;
    else if (threads.includes(m.conversationId)) via = "thread";
    else if (refFromSubject(m.subject)?.toUpperCase() === ref.toUpperCase()) via = "subject";
    if (!via) continue;

    // The counterparty is whichever end is not us. `folder` is trustworthy
    // here because `remember` above set it from the sender.
    const counterparty =
      m.folder === "sent"
        ? m.toRecipients[0]?.emailAddress.address ?? ""
        : m.from.emailAddress.address;
    // A named party wins over the customer list, so somebody who is both the
    // customer's contact and, say, the consol partner keeps the role the desk
    // gave them deliberately.
    const known = parties.find((p) =>
      p.emails.some((e) => e.toLowerCase() === counterparty.toLowerCase())
    )?.role;
    const role: PartyRole =
      known ?? (clientAddresses.has(counterparty.toLowerCase()) ? "client" : "other");

    out.push({ message: m, role, via, confidence: via === "reference-in-body" ? "likely" : "certain" });
  }

  return out.sort(
    (a, b) => Date.parse(b.message.receivedDateTime) - Date.parse(a.message.receivedDateTime)
  );
}

/** Inbox mail not yet filed against any enquiry — the triage queue. */
export async function unfiledMail(mailbox: string): Promise<MailMessage[]> {
  if (!mailIsLive() || !mailbox) return [];

  const [{ data: threadRows }, { data: msgRows }, { messages }] = await Promise.all([
    supabase.from("enquiry_threads").select("conversation_id"),
    supabase.from("enquiry_messages").select("message_id"),
    getMailMessages(mailbox, "inbox"),
  ]);

  const bound = new Set((threadRows ?? []).map((r) => r.conversation_id as string));
  const pinned = new Set((msgRows ?? []).map((r) => r.message_id as string));

  return messages.filter(
    (m) => !bound.has(m.conversationId) && !pinned.has(m.id) && !refFromSubject(m.subject)
  );
}

/** Volume from dimensions, so it is never a number somebody typed twice. */
export function computeVolumeCbm(e: Partial<Enquiry>): number | null {
  const { piece_length_cm: l, piece_width_cm: w, piece_height_cm: h, piece_count: n } = e;
  if (!l || !w || !h || !n) return null;
  return Number(((l * w * h * n) / 1_000_000).toFixed(2));
}

/** Gross weight from per-piece weight, same reasoning. */
export function computeGrossKg(e: Partial<Enquiry>): number | null {
  const { weight_per_piece_kg: kg, piece_count: n } = e;
  if (!kg || !n) return null;
  return Number((kg * n).toFixed(2));
}

/**
 * What is still missing before this enquiry can be quoted.
 *
 * Space cannot be checked in three dimensions without dimensions, and a rate
 * without a route is a guess -- so these are the fields a quote genuinely
 * depends on, not a wish list.
 */
export function missingForQuote(e: Enquiry): string[] {
  const blank = (v: unknown) => v === null || v === undefined || v === "";
  const missing: string[] = [];

  if (blank(e.transport_mode)) missing.push("Service");
  if (blank(e.origin)) missing.push("Origin");
  if (blank(e.destination)) missing.push("Destination");
  if (blank(e.cargo)) missing.push("Commodity");

  /*
    Size and weight, by whatever route they arrived.

    The volume is the total — summed from the dimension lines, or stated in the
    mail — so one check covers both. FCL is bought by the box and does not need
    one. The weight is a stated total or pieces times a per-piece figure; either
    establishes it.
  */
  if (e.transport_mode !== "sea_fcl" && blank(e.volume_cbm)) missing.push("Dimensions");
  if (blank(e.gross_weight_kg) && blank(e.weight_per_piece_kg)) missing.push("Weight");
  return missing;
}

/**
 * Puts an address heard on a call onto the customer record.
 *
 * The newest one goes FIRST. Nothing is thrown away -- a company has more than
 * one person, and a second address is another way to reach them rather than
 * proof the first was wrong -- but when somebody gives a different address on a
 * later call, that is the one they want used, so everything that reads "their
 * email" now reads the latest. Giving the same address twice just moves it back
 * to the front.
 *
 * This is the half of the calls-to-mail bridge that phone matching cannot do:
 * once the address is here, anything they write from it files itself against
 * this customer instead of arriving as a stranger.
 */
export async function linkCustomerEmail(customerId: string, email: string): Promise<Customer> {
  const { data, error } = await supabase.rpc("link_email_to_customer", {
    p_customer_id: customerId,
    p_email: email.trim().toLowerCase(),
  });
  if (error) throw new Error(error.message);
  return data as Customer;
}

/**
 * Record that the customer confirmed, and how.
 *
 * This is what "accepted" means now. A yes on a call sets verbal_accept_at and
 * nothing else; only this unlocks a booking, because only this leaves something
 * to show a customer who later says they never agreed.
 *
 * @param via         "email" when confirming from their reply, "manual" when
 *                    the confirmation reached us some other way.
 * @param messageId   The reply it came from. Required in spirit for "email".
 * @param note        Where the yes came from. The database refuses a manual
 *                    confirmation without one.
 */
export async function confirmAcceptance(
  ref: string,
  quoteId: string,
  via: "email" | "manual",
  messageId: string | null,
  note = ""
): Promise<Quote> {
  const { data, error } = await supabase.rpc("confirm_acceptance", {
    p_ref: ref.toUpperCase(),
    p_quote_id: quoteId,
    p_via: via,
    p_message_id: messageId,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return data as Quote;
}
