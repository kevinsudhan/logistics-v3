import type { Customer, Enquiry, Quote } from "../services/enquiries";
import { subjectToken } from "../services/caseFile";
import {
  ACCENT,
  ACCENT_SOFT,
  INK,
  MODE_WORD,
  MUTED,
  NAVY,
  caption,
  esc,
  letter,
  longDate,
  message as messageSection,
  money,
  num,
  preparedFor,
  section,
  shipmentBox,
  signOff,
} from "./brandedMail";

/**
 * The booking confirmation: what was agreed, in writing, before we book.
 *
 * ---------------------------------------------------------------------------
 * The same letterhead as the quotation (lib/brandedMail.ts), so the customer
 * reads one company from the first rate to the booking.
 *
 * Every line is conditional. An enquiry with no ready date produces a letter
 * with no ready-date line, rather than one saying "Ready: not specified" — the
 * customer is being asked to check this, and a placeholder invites them to
 * confirm something nobody established.
 * ---------------------------------------------------------------------------
 */

export interface ConfirmationMailInput {
  enquiry: Enquiry;
  customer: Customer | null;
  /** The accepted quotation, when there is one. */
  quote: Quote | null;
  fromName?: string;
  company?: string;
  /** The logo on this app (MAIL_LOGO_PATH); carried inside the message at send. */
  logoSrc?: string | null;
  /** Today, for the letter's date; passed in so the letter is the same when tested. */
  date?: Date;
}

const route = (e: Enquiry) => [e.origin, e.destination].filter(Boolean).join(" to ");

/** The reference goes in brackets at the front, where a reply-all cannot lose it. */
export function confirmationSubject(e: Enquiry): string {
  return `${subjectToken(e.ref)} Booking confirmation${route(e) ? ` — ${route(e)}` : ""}`;
}

/** The covering note, for the sender to edit rather than to send as is. */
export function confirmationMessage(i: Pick<ConfirmationMailInput, "customer">): string {
  const greeting = i.customer?.name ? `Dear ${i.customer.name},` : "Dear Sir or Madam,";
  return `${greeting}\n\nThank you for confirming. Below is what we agreed, so you have it in writing before we book.`;
}

export function confirmationHtml(i: ConfirmationMailInput): string {
  const { enquiry: e, customer, quote } = i;

  // Totals, not one piece's size: a consignment of several sizes has no single one to print.
  const pieces = e.piece_count
    ? e.piece_length_cm && e.piece_width_cm && e.piece_height_cm
      ? `${num(e.piece_count)} at ${num(e.piece_length_cm)} × ${num(e.piece_width_cm)} × ${num(e.piece_height_cm)} cm`
      : `${num(e.piece_count)}`
    : e.package_count
      ? `${num(e.package_count)} ${esc(e.package_type || "packages")}`
      : "";

  const facts: Array<[string, string]> = [
    ["Mode", e.transport_mode ? MODE_WORD[e.transport_mode] ?? "" : ""],
    ["Incoterm", e.incoterm ? esc(e.incoterm.toUpperCase()) : ""],
    ["Cargo", esc(e.cargo ?? "")],
    ["Cargo ready", e.ready_date ? longDate(e.ready_date) : ""],
    ["Pieces", pieces],
    ["Gross weight", e.gross_weight_kg ? `${num(e.gross_weight_kg)} kg` : ""],
    ["Volume", e.volume_cbm ? `${num(e.volume_cbm)} CBM` : ""],
    ["Sailing", quote?.sailing_date ? longDate(quote.sailing_date) : ""],
    ["Collection from", e.pickup_required ? esc(e.pickup_location ?? "") : ""],
    ["Delivery to", e.delivery_required ? esc(e.delivery_location ?? "") : ""],
    ["Consignee", esc([e.consignee_name, e.consignee_country].filter(Boolean).join(", "))],
    ["Special handling", esc(e.special_handling ?? "")],
  ];

  /* The rate, set apart: it is the figure the customer is agreeing to. */
  const rate = quote
    ? section(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${ACCENT_SOFT}" style="background:${ACCENT_SOFT};border-radius:8px;border-collapse:separate;">
          <tr>
            <td style="padding:14px 16px;">
              ${caption("Rate agreed", NAVY)}
              ${quote.basis ? `<p style="margin:0;font-size:12.5px;color:${MUTED};line-height:1.45;">${esc(quote.basis)}</p>` : ""}
              <p style="margin:4px 0 0;font-size:11.5px;color:${MUTED};">Quotation ${esc(e.ref)}${quote.version > 1 ? `/${quote.version}` : ""}</p>
            </td>
            <td align="right" valign="middle" style="padding:14px 16px;font-size:20px;font-weight:800;color:${NAVY};white-space:nowrap;">${money(quote.amount_inr)}</td>
          </tr>
        </table>`
      )
    : "";

  /* What happens next, with the blue rule down its side so it reads as the ask. */
  const next = section(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
          <tr><td style="border-left:3px solid ${ACCENT};padding:4px 0 4px 14px;">
            ${caption("What happens next", NAVY)}
            <p style="margin:0;font-size:13.5px;line-height:1.6;color:${INK};">If everything above is correct, please reply to confirm and we will proceed with the booking. For any correction, just reply to this message.</p>
          </td></tr>
        </table>
        <p style="margin:14px 0 0;font-size:12px;line-height:1.55;color:${MUTED};">Please keep <strong style="color:${INK};">${esc(e.ref)}</strong> in the subject line when you reply — it is how we keep every message about this shipment together.</p>`,
    24
  );

  return letter({
    logoSrc: i.logoSrc,
    title: "BOOKING CONFIRMATION",
    meta: [
      ["Reference", esc(e.ref)],
      ["Date", longDate((i.date ?? new Date()).toISOString())],
      ...(e.customer_reference ? ([["Your ref", esc(e.customer_reference)]] as Array<[string, string]>) : []),
    ],
    sections: [
      preparedFor(customer),
      messageSection(confirmationMessage(i)),
      shipmentBox(e, facts),
      rate,
      next,
      signOff(i.fromName, i.company),
    ],
  });
}
