import type { Customer, Enquiry, Quote } from "../services/enquiries";
import type { QuoteLine } from "../services/quoteLines";
import type { QuoteTerm } from "../services/quoteApproval";
import {
  ACCENT,
  ACCENT_SOFT,
  INK,
  LINE,
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
  packagesAndWeight,
  preparedFor,
  section,
  shipmentBox,
  signOff,
} from "./brandedMail";

/**
 * The quotation, as a mail a customer opens.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MAIL CARRIES THE FIGURES AND NOT JUST THE ATTACHMENT
 *
 * Half the people who receive this read it on a phone, where opening a PDF is a
 * decision rather than a glance. A mail saying "please find attached" makes the
 * customer work before they can see a number, and the ones who do not bother
 * are the ones who go quiet. The PDF still goes, because that is what gets
 * forwarded to their accounts department and printed.
 *
 * THE LETTERHEAD
 *
 * The card, the logo header, the shipment box, the sign-off and the footer
 * are the shared letterhead in lib/brandedMail.ts, so the booking
 * confirmation looks like the same company wrote it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not invent a figure. Where a charge has no rate, the line prints what
 * is recorded rather than a total that looks complete, because a quotation that
 * silently omits a charge is one this desk has to honour.
 * ---------------------------------------------------------------------------
 */

export interface QuotationMailInput {
  enquiry: Enquiry;
  customer: Customer | null;
  quote: Quote;
  lines: QuoteLine[];
  terms: QuoteTerm[];
  /** What the sender wants to say above the figures. Their words, not ours. */
  message?: string;
  /** How it is signed off. */
  fromName?: string;
  company?: string;
  /**
   * Where the customer can accept it, if a link has been issued.
   *
   * Absent means no button is drawn — better than a button that goes nowhere.
   */
  acceptUrl?: string | null;
  /**
   * The logo's address (MAIL_LOGO_PATH on this app's origin).
   *
   * An http address so the compose window can show it; the send swaps it for
   * an inline attachment (lib/inlineBrand.ts). Absent, the header sets the
   * name in type instead.
   */
  logoSrc?: string | null;
}

/** The subject line, carrying the reference so the reply files itself. */
export function quotationSubject(i: { enquiry: Enquiry; quote: Quote }): string {
  const lane = [i.enquiry.origin, i.enquiry.destination].filter(Boolean).join(" – ");
  return `Quotation ${i.enquiry.ref}${lane ? ` · ${lane}` : ""}`;
}

/** The default covering note, for the sender to edit rather than to send as is. */
export function quotationMessage(i: QuotationMailInput): string {
  const lane = [i.enquiry.origin, i.enquiry.destination].filter(Boolean).join(" to ");
  return (
    `Thank you for your enquiry${lane ? ` for ${lane}` : ""}. ` +
    `Our quotation is set out below and attached as a PDF.` +
    (i.quote.valid_until ? ` The rates are valid until ${longDate(i.quote.valid_until)}.` : "") +
    ` Please let us know if you would like us to proceed, or if anything needs adjusting.`
  );
}

export function quotationHtml(i: QuotationMailInput): string {
  const { enquiry, customer, quote, lines, terms } = i;
  const text = i.message?.trim() || quotationMessage(i);
  const ref = `${enquiry.ref}${quote.version > 1 ? `/${quote.version}` : ""}`;

  /*
    Three columns, not six.

    A table cannot render narrower than its content's minimum width, so six
    columns of charge, unit, quantity, rate and amount simply do not fit a
    phone — the rate and amount columns fell off the right-hand edge. So the
    unit sits under the charge name, and quantity and rate combine into the one
    line a person would say out loud: "1 × INR 4,500".
  */
  const charges = lines.length
    ? lines
        .map(
          (l) => `
          <tr>
            <td style="padding:12px 8px;border-bottom:1px solid ${LINE};color:${INK};font-size:13.5px;line-height:1.4;word-break:break-word;">
              ${esc(l.description)}
              ${l.unit ? `<span style="display:block;margin-top:2px;color:${MUTED};font-size:11.5px;">per ${esc(l.unit)}</span>` : ""}
            </td>
            <td align="right" style="padding:12px 8px;border-bottom:1px solid ${LINE};color:${MUTED};font-size:12.5px;">
              ${num(l.quantity)} &times; ${esc(l.currency)}&nbsp;${num(l.rate)}
            </td>
            <td align="right" style="padding:12px 8px;border-bottom:1px solid ${LINE};color:${INK};font-size:13.5px;font-weight:600;white-space:nowrap;">${money(l.amount_inr)}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="3" style="padding:16px 10px;border-bottom:1px solid ${LINE};color:${MUTED};font-size:13px;font-style:italic;">Charges as discussed.</td></tr>`;

  const grouped = groupTerms(terms);
  const termsHtml = grouped.length
    ? section(
        `${caption("Terms & conditions", NAVY)}
        ${grouped
          .map(
            (g) => `
          ${g.label ? `<p style="margin:10px 0 4px;font-size:12px;font-weight:700;color:${INK};">${esc(g.label)}</p>` : ""}
          <ol style="margin:6px 0 0;padding-left:18px;list-style-type:decimal;color:${MUTED};font-size:12px;line-height:1.6;">
            ${g.items.map((t) => `<li style="margin:0 0 3px;">${esc(t)}</li>`).join("")}
          </ol>`
          )
          .join("")}`,
        26
      )
    : "";

  /*
    The accept button: a link, not a form. The page it opens is what accepts;
    following this URL only reads, because Outlook Safe Links and every mail
    gateway fetch the links in a message before the recipient sees it.

    A table cell with its own background rather than a styled <a> alone:
    Outlook ignores padding and background on inline elements.
  */
  const accept = i.acceptUrl
    ? section(
        `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td bgcolor="${ACCENT}" style="background:${ACCENT};border-radius:6px;">
            <a href="${esc(i.acceptUrl)}" style="display:inline-block;padding:13px 24px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:.02em;">Accept this quotation &rarr;</a>
          </td>
        </tr></table>
        <p style="margin:8px 0 0;font-size:11.5px;color:${MUTED};line-height:1.5;">Opens a page showing this quotation, where you can confirm. Replying to this email works just as well.</p>`,
        24
      )
    : "";

  const table = section(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <thead>
            <tr>
              <th align="left" bgcolor="${NAVY}" style="background:${NAVY};padding:10px 8px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#ffffff;font-weight:700;">Charge</th>
              <th align="right" bgcolor="${NAVY}" style="background:${NAVY};padding:10px 8px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#ffffff;font-weight:700;">Qty &times; rate</th>
              <th align="right" bgcolor="${NAVY}" style="background:${NAVY};padding:10px 8px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#ffffff;font-weight:700;">Amount</th>
            </tr>
          </thead>
          <tbody>${charges}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" align="right" bgcolor="${ACCENT_SOFT}" style="background:${ACCENT_SOFT};padding:14px 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${NAVY};font-weight:700;">Total (INR)</td>
              <td align="right" bgcolor="${ACCENT_SOFT}" style="background:${ACCENT_SOFT};padding:14px 8px;font-size:17px;color:${NAVY};font-weight:800;white-space:nowrap;">${money(quote.amount_inr)}</td>
            </tr>
          </tfoot>
        </table>`,
    24
  );

  return letter({
    logoSrc: i.logoSrc,
    title: "QUOTATION",
    meta: [
      ["Reference", esc(ref)],
      ["Date", longDate(quote.created_at)],
      ...(quote.valid_until ? ([["Valid until", longDate(quote.valid_until)]] as Array<[string, string]>) : []),
    ],
    sections: [
      preparedFor(customer),
      messageSection(text),
      shipmentBox(enquiry, [
        ["Mode", enquiry.transport_mode ? MODE_WORD[enquiry.transport_mode] ?? "" : ""],
        ["Incoterm", enquiry.incoterm ? esc(enquiry.incoterm.toUpperCase()) : ""],
        ["Cargo", esc(enquiry.cargo ?? "")],
        ["Cargo ready", enquiry.ready_date ? longDate(enquiry.ready_date) : ""],
        ["Packages & weight", packagesAndWeight(enquiry)],
      ]),
      table,
      accept,
      termsHtml,
      signOff(i.fromName, i.company),
    ],
  });
}

/**
 * Terms grouped by scope, general first.
 *
 * General terms apply to everything and a mode's terms are an addition to them,
 * so reading the mode's block first would have the customer agreeing to the
 * exception before the rule.
 */
export function groupTerms(terms: QuoteTerm[]): Array<{ label: string; items: string[] }> {
  const by = new Map<string, string[]>();
  for (const t of terms) {
    if (!t.text.trim()) continue;
    const list = by.get(t.scope) ?? [];
    list.push(t.text.trim());
    by.set(t.scope, list);
  }
  const order = ["general", "air", "sea_lcl", "sea_fcl", "road"];
  return [...by.entries()]
    .sort((a, b) => indexOrLast(order, a[0]) - indexOrLast(order, b[0]))
    .map(([scope, items]) => ({ label: scope === "general" ? "" : SCOPE_LABEL[scope] ?? scope, items }));
}

const SCOPE_LABEL: Record<string, string> = {
  air: "Air",
  sea_lcl: "Sea LCL",
  sea_fcl: "Sea FCL",
  road: "Road",
};

const indexOrLast = (list: string[], v: string) => {
  const i = list.indexOf(v);
  return i === -1 ? list.length : i;
};
