import type { Customer, Enquiry, Quote } from "../services/enquiries";
import type { QuoteLine } from "../services/quoteLines";
import type { QuoteTerm } from "../services/quoteApproval";
import { COMPANY, MAIL_LOGO_NAVY } from "./company";

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
 * WHY EVERY STYLE IS INLINE
 *
 * Outlook and Gmail both strip <style> blocks, and Outlook's renderer is Word's.
 * A stylesheet that looks right here produces an unstyled column of text in the
 * one client this trade actually uses. Tables and inline attributes are ugly to
 * write and are what survives.
 *
 * THE LOGO, AND WHY IT IS NOT A LINK TO AN IMAGE
 *
 * A remote image is blocked by default in Outlook, so a logo fetched from the
 * web is a blank rectangle on first read. The body names the logo by its
 * address on this app (so the compose window can show it) and the send turns
 * it into an attachment inside the message, which Outlook and Gmail show at
 * once (lib/inlineBrand.ts). It sits on the navy it was cut from, so the
 * header cell around it carries on seamlessly, and if a client still will not
 * draw it the alt text is the company's name in white on that navy. No web
 * fonts: the type is the system stack.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not invent a figure. Where a charge has no rate, the line prints what
 * is recorded rather than a total that looks complete, because a quotation that
 * silently omits a charge is one this desk has to honour.
 * ---------------------------------------------------------------------------
 */

/*
  Palette, from the logo: its navy for the header, the blue of its ring for the
  accent, slate greys for everything that is not the point.
*/
const NAVY = MAIL_LOGO_NAVY;
const NAVY_LINE = "#24395a";
const NAVY_SOFT = "#9fb3cc";
const ACCENT = "#1670b0";
const ACCENT_SOFT = "#eaf3fb";
const INK = "#1f2937";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const SOFT = "#f6f8fb";
const PAGE = "#eef2f7";
const FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

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

const MODE_WORD: Record<string, string> = {
  air: "Air freight",
  sea_lcl: "Sea freight · LCL",
  sea_fcl: "Sea freight · FCL",
  road: "Road",
  other: "Other",
};

/** A small uppercase caption over a section or a value. */
const caption = (text: string, color = MUTED) =>
  `<p style="margin:0 0 4px;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:${color};font-weight:600;">${esc(text)}</p>`;

export function quotationHtml(i: QuotationMailInput): string {
  const { enquiry, customer, quote, lines, terms } = i;
  const to = customer?.company || customer?.name || "";
  const message = i.message?.trim() || quotationMessage(i);
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

  /* The shipment in brief: only what is known, two to a row. */
  const pieces = [
    enquiry.package_count ? `${num(enquiry.package_count)} ${esc(enquiry.package_type || "packages")}` : enquiry.piece_count ? `${num(enquiry.piece_count)} pcs` : null,
    enquiry.gross_weight_kg ? `${num(enquiry.gross_weight_kg)} kg` : null,
    enquiry.volume_cbm ? `${num(enquiry.volume_cbm)} CBM` : null,
  ].filter(Boolean);
  const facts: Array<[string, string]> = [
    ["Mode", enquiry.transport_mode ? MODE_WORD[enquiry.transport_mode] ?? "" : ""],
    ["Incoterm", enquiry.incoterm ? esc(enquiry.incoterm.toUpperCase()) : ""],
    ["Cargo", esc(enquiry.cargo ?? "")],
    ["Cargo ready", enquiry.ready_date ? longDate(enquiry.ready_date) : ""],
    ["Packages & weight", pieces.join(" · ")],
  ].filter(([, v]) => v) as Array<[string, string]>;
  const factRows: string[] = [];
  for (let k = 0; k < facts.length; k += 2) {
    factRows.push(`<tr>${fact(...facts[k])}${facts[k + 1] ? fact(...facts[k + 1]) : `<td width="50%" style="padding:10px 16px;"></td>`}</tr>`);
  }
  const lane =
    enquiry.origin || enquiry.destination
      ? `<tr><td colspan="2" style="padding:14px 16px 10px;border-bottom:1px solid ${LINE};">
          ${caption("Route")}
          <p style="margin:0;font-size:15px;font-weight:700;color:${NAVY};">${esc(enquiry.origin || "—")} <span style="color:${ACCENT};">&rarr;</span> ${esc(enquiry.destination || "—")}</p>
        </td></tr>`
      : "";

  const grouped = groupTerms(terms);
  const termsHtml = grouped.length
    ? `
      <tr><td style="padding:26px 24px 0;">
        ${caption("Terms & conditions", NAVY)}
        ${grouped
          .map(
            (g) => `
          ${g.label ? `<p style="margin:10px 0 4px;font-size:12px;font-weight:700;color:${INK};">${esc(g.label)}</p>` : ""}
          <ol style="margin:6px 0 0;padding-left:18px;list-style-type:decimal;color:${MUTED};font-size:12px;line-height:1.6;">
            ${g.items.map((t) => `<li style="margin:0 0 3px;">${esc(t)}</li>`).join("")}
          </ol>`
          )
          .join("")}
      </td></tr>`
    : "";

  /*
    The accept button: a link, not a form. The page it opens is what accepts;
    following this URL only reads, because Outlook Safe Links and every mail
    gateway fetch the links in a message before the recipient sees it.

    A table cell with its own background rather than a styled <a> alone:
    Outlook ignores padding and background on inline elements.
  */
  const accept = i.acceptUrl
    ? `
      <tr><td style="padding:24px 24px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td bgcolor="${ACCENT}" style="background:${ACCENT};border-radius:6px;">
            <a href="${esc(i.acceptUrl)}" style="display:inline-block;padding:13px 24px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:.02em;">Accept this quotation &rarr;</a>
          </td>
        </tr></table>
        <p style="margin:8px 0 0;font-size:11.5px;color:${MUTED};line-height:1.5;">Opens a page showing this quotation, where you can confirm. Replying to this email works just as well.</p>
      </td></tr>`
    : "";

  /*
    The header: the logo on its own navy, so the image's edge disappears into
    the cell around it. Stacked rather than side by side — two cells squeezed
    onto a phone collided into "QUOTATIONRef ALG09004-26".
  */
  // width:100% capped at 300, not a fixed 300px: a fixed width sets the cell's minimum and pushes a
  // narrow phone sideways. Outlook ignores the CSS and sizes it by the width attribute.
  const brand = i.logoSrc
    ? `<img src="${esc(i.logoSrc)}" width="300" alt="${esc(COMPANY.legalName)}" style="display:block;width:100%;max-width:300px;height:auto;border:0;color:#ffffff;font-size:16px;font-weight:700;" />`
    : `<p style="margin:0;color:#ffffff;font-size:17px;font-weight:700;letter-spacing:.06em;">${esc(COMPANY.name)}</p>`;
  const meta = (label: string, value: string) =>
    // Values may wrap ("23 Sep / 2026") so three fit a narrow phone; on a desktop they sit on one line.
    `<td valign="top" style="padding:0 14px 0 0;">
      <p style="margin:0;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${NAVY_SOFT};">${label}</p>
      <p style="margin:3px 0 0;font-size:13px;font-weight:700;color:#ffffff;">${value}</p>
    </td>`;

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${PAGE}" style="background:${PAGE};font-family:${FONT};">
  <tr><td align="center" style="padding:24px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:100%;max-width:640px;background:#ffffff;border:1px solid ${LINE};border-radius:10px;border-collapse:separate;">

      <tr><td bgcolor="${NAVY}" style="background:${NAVY};padding:22px 24px 22px;border-radius:10px 10px 0 0;">
        ${brand}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid ${NAVY_LINE};">
          <tr><td style="padding-top:16px;">
            <p style="margin:0 0 12px;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:.16em;">QUOTATION</p>
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              ${meta("Reference", esc(ref))}
              ${meta("Date", longDate(quote.created_at))}
              ${quote.valid_until ? meta("Valid until", longDate(quote.valid_until)) : ""}
            </tr></table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td height="4" bgcolor="${ACCENT}" style="background:${ACCENT};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>

      <tr><td style="padding:26px 24px 0;">
        ${caption("Prepared for")}
        <p style="margin:0;font-size:17px;font-weight:700;color:${NAVY};">${esc(to || "—")}</p>
        ${customer?.name && customer.name !== to ? `<p style="margin:2px 0 0;font-size:13px;color:${MUTED};">Attn: ${esc(customer.name)}</p>` : ""}
      </td></tr>

      <tr><td style="padding:18px 24px 0;">
        <p style="margin:0;font-size:14px;line-height:1.65;color:${INK};">${esc(message).replace(/\n/g, "<br>")}</p>
      </td></tr>

      ${
        lane || factRows.length
          ? `<tr><td style="padding:22px 24px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${SOFT}" style="background:${SOFT};border:1px solid ${LINE};border-radius:8px;border-collapse:separate;">
          ${lane}
          ${factRows.join("")}
        </table>
      </td></tr>`
          : ""
      }

      <tr><td style="padding:24px 24px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
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
        </table>
      </td></tr>

      ${accept}

      ${termsHtml}

      <tr><td style="padding:26px 24px 26px;">
        <p style="margin:0;font-size:13.5px;line-height:1.6;color:${INK};">
          Warm regards,<br>
          ${i.fromName ? `<strong style="color:${NAVY};">${esc(i.fromName)}</strong><br>` : ""}
          <span style="color:${MUTED};">${esc(i.company || COMPANY.legalName)}</span>
        </p>
      </td></tr>

      <tr><td bgcolor="${SOFT}" style="background:${SOFT};border-top:1px solid ${LINE};padding:18px 24px 20px;border-radius:0 0 10px 10px;">
        <p style="margin:0 0 4px;font-size:12.5px;font-weight:700;color:${NAVY};">${esc(COMPANY.legalName)}</p>
        <p style="margin:0;font-size:11.5px;line-height:1.6;color:${MUTED};">
          ${COMPANY.address.map(esc).join(", ")}<br>
          Tel ${esc(COMPANY.phone)} &nbsp;&middot;&nbsp; <a href="https://${esc(COMPANY.website)}" style="color:${ACCENT};text-decoration:none;">${esc(COMPANY.website)}</a> &nbsp;&middot;&nbsp; GSTIN ${esc(COMPANY.gstin)}
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>`.trim();
}

/** One fact in the shipment box. */
function fact(label: string, value: string): string {
  return `<td width="50%" valign="top" style="padding:10px 16px;">
    ${caption(label)}
    <p style="margin:0;font-size:13.5px;color:${INK};line-height:1.4;">${value}</p>
  </td>`;
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

/** Escapes for HTML. The covering note is typed by a person and goes into markup. */
function esc(v: string): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const num = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const money = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * "18 Sep 2026" — unambiguous across the date conventions this trade spans.
 *
 * The months are listed rather than taken from `toLocaleDateString`, which
 * abbreviates September to four letters in en-GB: a quotation dated "18 Sept
 * 2026" and valid to "18 Oct 2026" is two different formats on one line, on a
 * document a customer reads.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
