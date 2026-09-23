import { supabase } from "../lib/supabase";
import type { Enquiry, Shipment } from "./enquiries";

/**
 * Customers, as a book you can open.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SERVICE EXISTS
 *
 * The table has been there since 005 and everything points at it — enquiries,
 * shipments, invoices all carry a customer_id. What was missing was any way to
 * approach the data from that direction. You could open a job and see who it
 * was for; you could not open a customer and see their jobs.
 *
 * So the question a forwarder asks before quoting anybody — "what have we done
 * for these people, did we win it, and do they pay?" — was answered from
 * memory, or by searching the mailbox, or not at all.
 *
 * THE SUMMARY IS A VIEW, THE RECORD IS THE TABLE
 *
 * `CustomerSummary` comes from `customer_summary` (050): one row per customer
 * with their counts, lanes and balance already aggregated, so the directory is
 * a single query however many customers there are. `Customer` is the row
 * itself, for the screens that edit it.
 *
 * They are deliberately different types. The summary is read-only and has
 * columns that exist nowhere in the table; treating them as one thing leads to
 * writing a patch containing `shipments: 4`.
 * ---------------------------------------------------------------------------
 */

/** The record. Every column on `customers`. */
export interface Customer {
  id: string;
  name: string;
  company: string;
  emails: string[];
  phones: string[];

  /** False = archived. Never deleted: invoices reference them with restrict. */
  active: boolean;
  notes: string;
  tags: string[];

  /* The statutory block — what a tax invoice needs. */
  gstin: string | null;
  pan: string | null;
  iec: string | null;

  billing_name: string | null;
  billing_attention: string | null;
  billing_address: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_state_code: string | null;
  billing_pincode: string | null;
  billing_country: string | null;
  billing_email: string | null;
  payment_terms_days: number | null;

  created_at: string;
  updated_at: string;
}

/**
 * One row of the directory: the record plus what they have given us.
 *
 * Read-only. Everything past `created_at` is computed by the view.
 */
export interface CustomerSummary {
  id: string;
  name: string;
  company: string;
  emails: string[];
  phones: string[];
  active: boolean;
  tags: string[];
  gstin: string | null;
  iec: string | null;
  created_at: string;

  enquiries: number;
  enquiries_open: number;
  enquiries_won: number;
  enquiries_lost: number;
  last_enquiry_at: string | null;
  top_origin: string | null;
  top_destination: string | null;
  trade_direction: "export" | "import" | "cross_trade" | null;

  shipments: number;
  shipments_live: number;
  shipments_delivered: number;
  last_shipped_on: string | null;
  lifetime_inr: number;

  outstanding: number;
  on_account: number;
  open_invoices: number;

  gstin_missing: boolean;
  iec_missing: boolean;

  /** Last enquiry or shipment, whichever is later. Null if neither. */
  last_activity_on: string | null;
}

/** The directory, aggregates included, in one round trip. */
export async function listCustomers(): Promise<CustomerSummary[]> {
  const { data, error } = await supabase
    .from("customer_summary")
    .select("*")
    .order("company", { nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerSummary[];
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Customer) ?? null;
}

export async function getSummary(id: string): Promise<CustomerSummary | null> {
  const { data, error } = await supabase
    .from("customer_summary")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CustomerSummary) ?? null;
}

/**
 * Is this address already somebody's?
 *
 * Asked before creating, because `create_customer` answers the question by
 * silently returning the existing record — which is right for the intake path
 * (a mail from a known address is that customer) and wrong for a person typing
 * a form, who would be handed a record they did not mean to touch.
 */
export async function customerWithEmail(email: string): Promise<Customer | null> {
  const v = email.trim().toLowerCase();
  if (!v) return null;
  // `cs` is array-contains. Postgres arrays are case-sensitive, so the address
  // is matched as stored and as typed — the two spellings people actually use.
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .or(`emails.cs.{"${v}"},emails.cs.{"${email.trim()}"}`)
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as Customer) ?? null;
}

/**
 * A new customer.
 *
 * ---------------------------------------------------------------------------
 * WHY IT REFUSES A KNOWN ADDRESS RATHER THAN MERGING INTO IT
 *
 * `create_customer` returns the EXISTING customer when the email is one we
 * already have. That is the right behaviour where it is called from — mail
 * arriving from a known address belongs to that customer, and minting a second
 * record would split their history.
 *
 * It is the wrong behaviour behind a form. Somebody typing what they believe is
 * a new customer would get back an established one, and the details they just
 * typed would be written over the top of it: a full record with a GSTIN and a
 * billing address replaced by the half a line somebody had to hand. That is a
 * silent, destructive edit to a record they never opened.
 *
 * So the address is checked first and the caller is told. Deciding what to do
 * about it — open that customer, use a different address — is a person's job.
 * ---------------------------------------------------------------------------
 */
export class CustomerExistsError extends Error {
  constructor(readonly existing: Customer) {
    super(
      `${(existing.company || existing.name).trim()} (${existing.id}) already uses that email address.`
    );
    this.name = "CustomerExistsError";
  }
}

export async function createCustomer(input: {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  rest?: Partial<Customer>;
}): Promise<Customer> {
  if (input.email) {
    const clash = await customerWithEmail(input.email);
    if (clash) throw new CustomerExistsError(clash);
  }

  const { data, error } = await supabase.rpc("create_customer", {
    p_name: input.name,
    p_company: input.company ?? "",
    p_email: input.email ?? null,
    p_phone: input.phone ?? null,
  });
  if (error) throw new Error(error.message);

  const made = data as Customer;
  // Everything the RPC's four parameters cannot carry. Safe now: the address
  // was checked, so this is a record made a moment ago and not somebody else's.
  if (input.rest && Object.keys(input.rest).length) {
    return updateCustomer(made.id, input.rest);
  }
  return made;
}

export async function updateCustomer(id: string, patch: Partial<Customer>): Promise<Customer> {
  const { data, error } = await supabase
    .from("customers")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Customer;
}

export const archiveCustomer = (id: string) => updateCustomer(id, { active: false });
export const restoreCustomer = (id: string) => updateCustomer(id, { active: true });

/**
 * Their shipments, newest first.
 *
 * Cancelled ones are included here although the summary excludes them from its
 * counts. The difference is the question being asked: the summary says how much
 * work this customer represents, and a cancelled booking is none. The history
 * says what happened, and a cancellation is a thing that happened — frequently
 * the most relevant thing, if somebody is asking why the last job never sailed.
 */
export async function shipmentsFor(customerId: string): Promise<Shipment[]> {
  const { data, error } = await supabase
    .from("shipments")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Shipment[];
}

/**
 * Their enquiries, newest first — including the ones that went nowhere.
 *
 * Lost enquiries are the point. A customer with fourteen enquiries and two
 * shipments is telling you something that a list of their shipments alone
 * cannot: either the rates are wrong, or they are using us to benchmark
 * somebody else.
 */
export async function enquiriesFor(customerId: string): Promise<Enquiry[]> {
  const { data, error } = await supabase
    .from("enquiries")
    .select("*")
    .eq("customer_id", customerId)
    .order("received_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Enquiry[];
}

/** Every tag in use, for the directory's filter row. */
export function tagsOf(customers: Array<{ tags: string[] }>): string[] {
  const seen = new Map<string, string>();
  for (const c of customers)
    for (const t of c.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * How a customer reads in a list.
 *
 * `company` where there is one, the contact's name otherwise. Worth a helper
 * because the fallback is needed in six places and because the real data has
 * customers whose company is an email address — created automatically from a
 * mail before anybody tidied them up, which is one of the things the directory
 * exists to make visible.
 */
export const customerLabel = (c: { company?: string | null; name: string }): string =>
  (c.company ?? "").trim() || c.name;

/**
 * Days since anything happened, or null if nothing ever has.
 *
 * Measured from enquiry OR shipment. A customer who asked for a rate last week
 * is live even if they have not shipped since March, and calling them dormant
 * because of the shipment date would put the wrong name on a call list.
 */
export function daysSinceActivity(c: CustomerSummary): number | null {
  if (!c.last_activity_on) return null;
  const then = new Date(c.last_activity_on + "T00:00:00Z").getTime();
  return Math.floor((Date.now() - then) / 86_400_000);
}

/** The dormancy line. Ninety days is roughly a quarter, which is how shipping seasons move. */
export const DORMANT_AFTER_DAYS = 90;

/**
 * Point an enquiry at a customer already in the directory.
 *
 * Where the record it leaves has no other work — the ordinary case, a stranger
 * created from an unfamiliar address — its addresses move to the chosen
 * customer and it is archived, so the next mail from that address files itself
 * under the right company. Where it has other work, only this enquiry moves.
 * Refused once the job has been invoiced. All of it decided in
 * `reassign_enquiry_customer` (060), not here.
 */
export async function reassignEnquiryCustomer(
  ref: string,
  customerId: string
): Promise<{ changed: boolean; merged?: boolean; from?: string }> {
  const { data, error } = await supabase.rpc("reassign_enquiry_customer", {
    p_ref: ref,
    p_customer_id: customerId,
  });
  if (error) throw new Error(error.message);
  return data as { changed: boolean; merged?: boolean; from?: string };
}

/**
 * Whether a record looks like one the intake made from a bare address.
 *
 * Mail from somebody new creates a customer named after whatever the sender's
 * header said — "info", "sales", or the address itself. Those are worth
 * pointing out, because they are usually a regular customer writing from an
 * address nobody had seen, and the fix is one choice from the directory.
 */
export function looksAutoCreated(c: { name: string; company?: string | null }): boolean {
  const name = (c.name ?? "").trim().toLowerCase();
  const company = (c.company ?? "").trim();
  if (company) return false;
  if (!name || name.includes("@")) return true;
  return ["info", "sales", "ops", "operations", "admin", "contact", "enquiry", "enquiries",
          "noreply", "no-reply", "support", "accounts", "export", "import", "office"].includes(name);
}
