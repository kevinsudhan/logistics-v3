import { greetingHtml } from "./greeting";
import type { DocSpec, DocumentData } from "./documents/types";

/**
 * Sending a document from the Documents list (6 Oct): who it goes to, under
 * what subject, and the few lines around the PDF.
 *
 * ---------------------------------------------------------------------------
 * WHO
 *
 * Most documents are the customer's: the booking confirmation, the draft and
 * final B/L, the cargo receipt, the invoices, the proof of delivery. The
 * arrival notice and the delivery order are the consignee's, at the far end.
 * The shipping instructions and the VGM go to the line. The address is only
 * the first suggestion: the compose window's To is the desk's to change.
 *
 * A DRAFT
 *
 * A document still missing details goes as the stamped draft naming them,
 * and the mail says so and asks for them: that draft is how the desk chases
 * what is missing. Never sent as though it were the final one.
 * ---------------------------------------------------------------------------
 */

export type Audience = "customer" | "consignee" | "carrier";

export const AUDIENCE: Record<string, Audience> = {
  quotation: "customer",
  "booking-confirmation": "customer",
  "shipping-instructions": "carrier",
  "vgm-declaration": "carrier",
  "bl-draft": "customer",
  "bl-final": "customer",
  fcr: "customer",
  "arrival-notice": "consignee",
  "delivery-order": "consignee",
  "commercial-invoice": "customer",
  "proforma-invoice": "customer",
  "tax-invoice": "customer",
  "proof-of-delivery": "customer",
};

export const AUDIENCE_WORD: Record<Audience, string> = { customer: "the customer", consignee: "the consignee", carrier: "the line" };

export const audienceOf = (spec: Pick<DocSpec, "id">): Audience => AUDIENCE[spec.id] ?? "customer";

/** What the reader is asked, document by document; one line under the opening. */
const ASK: Record<string, string> = {
  "booking-confirmation": "It confirms the space held for your cargo on the sailing shown.",
  "shipping-instructions": "Kindly issue the bill of lading as set out in it.",
  "vgm-declaration": "It states the verified gross mass of the packed container, for loading.",
  "bl-draft": "Kindly check every detail and confirm, or tell us what to correct, before the bill of lading is issued.",
  "bl-final": "These are the particulars the bill of lading is issued with.",
  fcr: "It is our receipt for your cargo.",
  "arrival-notice": "Your cargo is due to arrive as shown. Kindly arrange the clearance, and contact us for the delivery order.",
  "delivery-order": "Please present it to take delivery of the cargo.",
  "commercial-invoice": "Kindly check it before the shipping bill is filed.",
  "proforma-invoice": "Kindly confirm the charges, or arrange the advance, so the tax invoice can follow.",
  "tax-invoice": "Kindly arrange the payment by the due date.",
  "proof-of-delivery": "It confirms the delivery of your cargo.",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const lane = (d: Pick<DocumentData, "origin" | "destination">) => [d.origin, d.destination].map((x) => x?.trim()).filter(Boolean).join(" to ");

/** "Draft B/L — Chennai to Jebel Ali", "DRAFT — Booking confirmation — …" while details are still missing. */
export function documentMailSubject(spec: Pick<DocSpec, "shortName">, d: Pick<DocumentData, "origin" | "destination">, ready: boolean): string {
  return [ready ? null : "DRAFT", spec.shortName, lane(d) || null].filter(Boolean).join(" — ");
}

export function documentMailBody(
  spec: Pick<DocSpec, "id" | "title" | "shortName">,
  d: Pick<DocumentData, "reference" | "origin" | "destination">,
  o: { ready: boolean; missing: string[]; to: { name: string | null; address: string | null } }
): string {
  // "the booking confirmation", "the VGM declaration": an acronym keeps its capitals.
  const name = /^[A-Z][a-z]/.test(spec.shortName) ? `${spec.shortName[0].toLowerCase()}${spec.shortName.slice(1)}` : spec.shortName;
  // The draft B/L is a draft by name already.
  const draftOf = !o.ready && spec.id !== "bl-draft" ? "a draft of " : "";
  const route = lane(d);
  const lines = [
    `<div>Please find attached ${draftOf}the ${esc(name)} for our reference <strong>${esc(d.reference)}</strong>${route ? ` (${esc(route)})` : ""}.</div>`,
    ASK[spec.id] ? `<div>${esc(ASK[spec.id])}</div>` : "",
    o.ready
      ? ""
      : `<div><br></div><div>It is a draft: still to be confirmed${o.missing.length ? ` — ${esc(o.missing.join(", "))}` : ""}. Kindly send us these, and we will issue it.</div>`,
  ].filter(Boolean);
  return `${greetingHtml(o.to.name, o.to.address)}${lines.join("")}<div><br></div>`;
}

/** What the timeline says: "Draft B/L sent to ops@x.com (as a draft: consignee address)". */
export function documentSentSummary(spec: Pick<DocSpec, "shortName">, to: string[], ready: boolean, missing: string[]): string {
  return `${spec.shortName} sent to ${to.join(", ") || "—"}${ready ? "" : ` (as a draft${missing.length ? `: ${missing.join(", ").toLowerCase()} still missing` : ""})`}`;
}

/** Who a document goes to, best address first: the customer's, the consignee's (else the customer's), the line's. */
export function recipientsFor(
  a: Audience,
  c: {
    customer: { name: string; company: string; emails: string[] } | null;
    consignee: { name: string | null; email: string | null } | null;
    parties: Array<{ role: string; name: string; organisation: string; emails: string[] }>;
  }
): Array<{ address: string; name: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ address: string; name: string | null }> = [];
  const add = (address: string | null | undefined, name: string | null) => {
    const k = (address ?? "").trim().toLowerCase();
    if (!k || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k) || seen.has(k)) return;
    seen.add(k);
    out.push({ address: address!.trim(), name });
  };
  const customer = () => {
    for (const e of c.customer?.emails ?? []) add(e, c.customer?.name || null);
    for (const p of c.parties.filter((x) => x.role === "client")) for (const e of p.emails) add(e, p.name || null);
  };
  if (a === "customer") customer();
  else if (a === "consignee") {
    add(c.consignee?.email, c.consignee?.name ?? null);
    if (!out.length) customer();
  } else for (const p of c.parties.filter((x) => x.role === "carrier" || x.role === "consol_partner")) for (const e of p.emails) add(e, p.name || null);
  return out;
}
