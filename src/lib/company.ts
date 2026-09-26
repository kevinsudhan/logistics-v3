/**
 * Who issues what this CRM sends: the letterhead on documents, the footer on
 * a quotation mail.
 *
 * One place, because the day the office moves or the GSTIN changes it has to
 * be true everywhere at once — a registered address that is right on the B/L
 * and stale on the quotation is what a customer's accounts department finds.
 */
export const COMPANY = {
  /** As the letterhead prints it. */
  name: "AASHISH LOGISTICS GLOBAL",
  /** The registered name, as the logo carries it. */
  legalName: "Aashish Logistics Global Pvt Ltd",
  tagline: "Freight forwarding, consolidation & customs documentation",
  address: [
    "The Calamine Canary Building, No.55, 3B, 3rd Floor",
    "W-Block, 3rd Main Road, Anna Nagar, Chennai 600040",
  ],
  contact: ["Tel: 044-4811 6348", "www.aashishlogisticsglobal.com"],
  phone: "044-4811 6348",
  website: "www.aashishlogisticsglobal.com",
  gstin: "33ABDCA2229C1ZD",
  gst: "GSTIN: 33ABDCA2229C1ZD",
  /**
   * The same address, in the parts Customs asks for (the CSN for ICEGATE,
   * lib/icegateCsn.ts): a street line of at most 70 characters, the city, the
   * state, the PIN code.
   */
  postal: {
    street: "NO.55, 3B, 3RD FLOOR, W-BLOCK, 3RD MAIN ROAD, ANNA NAGAR",
    city: "CHENNAI",
    state: "TAMIL NADU",
    postcode: "600040",
    country: "IN",
  },
};

/** The logo for mail: the lockup on flat navy (#0F213A), 640px wide for sharp display at 300. */
export const MAIL_LOGO_PATH = "/brand/aashish-logo-email.jpg";
export const MAIL_LOGO_NAVY = "#0F213A";
