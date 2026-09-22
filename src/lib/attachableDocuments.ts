import { DOCUMENTS, documentBytes, documentDataFromEnquiry, readiness } from "./documents";
import { getEnquiry, quotesFor, type Customer, type Enquiry, type Quote } from "../services/enquiries";
import type { Attachable } from "../components/MailAttachments";

/**
 * The documents an enquiry can be asked to produce, ready to attach.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SHARED RATHER THAN BUILT ON EACH SCREEN
 *
 * Two screens send mail about the same job: the case file, and the agent's own
 * correspondence screen. If each decided for itself which documents were
 * sendable and what rate they carried, the two would drift — and the drift
 * would surface as a quotation attached from one screen showing a different
 * figure from the one attached from the other, in front of a customer.
 *
 * WHY ONLY THE READY ONES
 *
 * A document whose required fields are blank still generates: it prints TBD
 * where the answers should be and names what is outstanding. That is useful to
 * look at while you work out what is missing, and it is not something to put on
 * a mail. A document sent is a document relied on.
 * ---------------------------------------------------------------------------
 */

/**
 * The quote a document may print.
 *
 * An accepted quote wins over a later sent one: that is what the customer
 * agreed to, and a quotation reprinted afterwards must show what was agreed
 * rather than whatever was offered last. Drafts do not count — a rate nobody
 * has been told cannot appear on a document addressed to them.
 */
export const liveQuoteOf = (quotes: Quote[]): Quote | null =>
  quotes.find((q) => q.status === "accepted") ??
  quotes.filter((q) => q.status === "sent").sort((a, b) => b.version - a.version)[0] ??
  null;

/**
 * Built from data already in hand.
 *
 * `make` is not called here. It is handed to the picker and run only if
 * somebody chooses that document, so opening a reply box does not render every
 * PDF the enquiry could produce.
 */
export function attachablesFrom(
  enquiry: Enquiry,
  customer: Customer | null,
  amountInr: number | null
): Attachable[] {
  const data = documentDataFromEnquiry(enquiry, customer, amountInr);
  return DOCUMENTS.filter((spec) => readiness(data, spec.requires).ready).map((spec) => ({
    id: spec.id,
    label: spec.shortName,
    make: () => documentBytes(spec, data),
  }));
}

/**
 * The same list, for a screen that holds a reference and not the record.
 *
 * The partner screen knows a thread is about ALG09012-26 and nothing else about
 * it, so the enquiry and its quotes are fetched. Called when the attachment
 * menu is opened rather than when the reply box is — most replies to an agent
 * carry no attachment, and this is two queries every time otherwise.
 *
 * Returns nothing rather than throwing: an attachment menu that will not open
 * because a lookup failed is worse than one missing its document section, and
 * the operator can still attach from their computer.
 */
export async function attachablesForEnquiry(ref: string): Promise<Attachable[]> {
  try {
    const [enquiry, quotes] = await Promise.all([getEnquiry(ref), quotesFor(ref)]);
    if (!enquiry) return [];
    return attachablesFrom(enquiry, enquiry.customer, liveQuoteOf(quotes)?.amount_inr ?? null);
  } catch {
    return [];
  }
}
