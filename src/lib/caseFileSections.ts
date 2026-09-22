import type { Enquiry, Shipment } from "../services/enquiries";

/**
 * The sections this file is read in.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS NOT ONE PAGE ANY MORE
 *
 * It was nine panels stacked vertically, and it grew that way honestly — each
 * one was the right thing to add at the time. But the result is a page where
 * the documents are four screens below the cargo, and where somebody who opened
 * it to check a partner's rate scrolls past the quote, the acceptance and the
 * confirmation to get there.
 *
 * WHY A SEARCH PARAMETER AND NOT A NESTED ROUTE
 *
 * The shipment page uses nested routes, because its sections need almost
 * nothing from each other. These nine panels all read the same enquiry, quotes,
 * mail, events and parties, loaded once at the top of this component. Splitting
 * them into routed children would mean threading all of that through an outlet
 * context for no gain — the URL is what matters, and `?section=` puts it in the
 * URL just as well.
 * ---------------------------------------------------------------------------
 */
export const SECTIONS = [
  // Mail first, and the default. On a desk whose work is the mailbox, "read
  // this and answer it" is what opening an enquiry is for; everything else on
  // this file is something you go to afterwards.
  { key: "mail", label: "Mail" },

  // ---------------------------------------------------------------------------
  // Everything about the consignment itself, on one page.
  //
  // This was two tabs — "Details" for the cargo and the parties, "Shipment
  // details" for what a consol agent asks before quoting. The split was ours,
  // not the work's: both are answers to "what is being shipped", they are
  // filled in from the same mails in the same sitting, and separating them
  // meant somebody reading a thread had to decide which of two tabs the fact
  // they had just learned belonged in.
  //
  // One page, in the order an operator works: the cargo, the consolidation and
  // cut-offs, the parties on the bill of lading, the dangerous goods.
  // ---------------------------------------------------------------------------
  { key: "shipment", label: "Shipment process" },

  // Buying, not selling: which agents are on this job and what they came back
  // with. The quotation moved to Shipment process, next to the dimensions it is
  // priced on — asking an agent for a rate and putting a price to a customer
  // are different sittings, and the key stays "quote" so existing links and
  // bookmarks carrying ?section=quote still land somewhere real.
  { key: "quote", label: "Partners" },

  // The history. It answers how this got here, which is a different question
  // asked at a different time.
  { key: "timeline", label: "Timeline" },

  { key: "documents", label: "Documents" },
  { key: "billing", label: "Billing" },
] as const;

export type Section = (typeof SECTIONS)[number]["key"];


/**
 * What the build offers, before the enquiry itself is consulted.
 *
 * Derived rather than baked in, so `?section=billing` on a build without the
 * accounts desk falls through to the first one still standing instead of
 * rendering a tab strip with nothing under it. The full list above stays as the
 * source of the type.
 *
 * The flags are passed in rather than imported: `import.meta.env` exists only
 * under Vite, and a module that reads it cannot be run by a test. A rule about
 * what an enquiry can do has no business knowing how the build was configured
 * either.
 */
export interface BuildFlags {
  accountsDesk: boolean;
  mailOnlyCaseFile: boolean;
}

export function buildSections(flags: BuildFlags): SectionDef[] {
  return flags.mailOnlyCaseFile
    ? SECTIONS.filter((s) => s.key === "mail" || s.key === "timeline")
    : SECTIONS.filter((s) => s.key !== "billing" || flags.accountsDesk);
}

/**
 * The sections THIS enquiry has, which is fewer while it is still inbound.
 *
 * ---------------------------------------------------------------------------
 * WHY DOCUMENTS AND BILLING ARE NOT THERE UNTIL IT IS WON
 *
 * Because neither can produce anything. Every document past the quotation — the
 * booking confirmation, the shipping instructions, the bill of lading, the
 * arrival notice — needs a booking that does not exist yet, so the Documents
 * tab on an inbound enquiry is a list of twelve things all saying "not ready".
 * Billing is worse: an invoice against a job nobody has agreed to is not a
 * document that is merely premature, it is one that should not exist.
 *
 * A tab that never has anything under it teaches people to stop opening tabs.
 *
 * THE QUOTATION DOES NOT NEED THEM
 *
 * It used to be the reason to keep Documents open early. It is not any more:
 * the quotation is generated, downloaded and emailed from the quote itself,
 * which is where somebody building one already is.
 *
 * WON, NOT MERELY PROMISING
 *
 * The test is an accepted quote or an actual shipment — not "quoted", which is
 * a hope, and not the enquiry's own status alone, because a job already
 * promoted to a booking must keep its documents whatever the enquiry row says.
 * ---------------------------------------------------------------------------
 */
export function sectionsFor(
  enquiry: Pick<Enquiry, "status"> | null,
  shipment: Shipment | null,
  flags: BuildFlags
): SectionDef[] {
  const available = buildSections(flags);
  const won = Boolean(shipment) || enquiry?.status === "accepted";
  if (won) return available;
  return available.filter((s) => s.key !== "documents" && s.key !== "billing");
}


/** One entry in the tab strip. */
export interface SectionDef {
  key: Section;
  label: string;
}
