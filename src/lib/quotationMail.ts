import type { Customer, Enquiry, Quote } from "../services/enquiries";
import type { QuoteLine } from "../services/quoteLines";
import type { QuoteTerm } from "../services/quoteApproval";

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
 * WHY NO IMAGES AND NO WEB FONTS
 *
 * A remote image is blocked by default in Outlook, so a header that IS an image
 * is a blank rectangle on first read. The banner is a coloured table cell, which
 * renders everywhere, and the type is the system stack.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not invent a figure. Where a charge has no rate, the line prints what
 * is recorded rather than a total that looks complete, because a quotation that
 * silently omits a charge is one this desk has to honour.
 * ---------------------------------------------------------------------------
 */

const BRAND = "#2f4f6f";
const INK = "#1f2937";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const SOFT = "#f9fafb";

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
}

/** The subject line, carrying the reference so the reply files itself. */
export function quotationSubject(i: {
  enquiry: Enquiry;
  quote: Quote;
}): string {
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
  const to = customer?.company || customer?.name || "";
  const lane = [enquiry.origin, enquiry.destination].filter(Boolean).join(" → ");
  const message = i.message?.trim() || quotationMessage(i);

  /*
    Three columns, not six.

    A table cannot render narrower than its content's minimum width, so six
    columns of charge, unit, quantity, rate and amount simply do not fit a
    phone — the table stayed 640px wide inside a 400px screen and the rate and
    amount columns fell off the right-hand edge. Padding could not fix that;
    only fewer columns can.

    So the unit sits under the charge name where it reads as a qualifier, and
    the quantity and rate combine into the one line a person would say out
    loud: "1 x INR 4,500". Nothing is lost and it fits.
  */
  const charges = lines.length
    ? lines
        .map(
          (l, n) => `
        <tr>
          <td style="padding:10px 6px;border-bottom:1px solid ${LINE};color:${INK};font-size:13px;">
            <span style="color:${MUTED};">${n + 1}.</span> ${esc(l.description)}
            ${l.unit ? `<span style="display:block;padding-left:14px;color:${MUTED};font-size:11.5px;">${esc(l.unit)}</span>` : ""}
          </td>
          <td style="padding:10px 6px;border-bottom:1px solid ${LINE};color:${MUTED};font-size:12px;" align="right">
            ${num(l.quantity)} &times; ${esc(l.currency)}&nbsp;${num(l.rate)}
          </td>
          <td style="padding:10px 6px;border-bottom:1px solid ${LINE};color:${INK};font-size:13px;font-weight:600;" align="right">${money(l.amount_inr)}</td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="3" style="padding:14px 6px;color:${MUTED};font-size:13px;">Charges as discussed.</td></tr>`;

  const grouped = groupTerms(terms);
  const termsHtml = grouped.length
    ? `
      <tr><td style="padding:20px 20px 0;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">Terms</p>
        ${grouped
          .map(
            (g) => `
          ${g.label ? `<p style="margin:10px 0 4px;font-size:12px;font-weight:600;color:${INK};">${esc(g.label)}</p>` : ""}
          <ol style="margin:0;padding-left:18px;color:${MUTED};font-size:12px;line-height:1.55;">
            ${g.items.map((t) => `<li style="margin:0 0 3px;">${esc(t)}</li>`).join("")}
          </ol>`
          )
          .join("")}
      </td></tr>`
    : "";

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT};padding:16px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <!--
      width:100% with a max, NOT width="640".

      The fixed attribute kept the card 640px wide inside a 400px phone and the
      right-hand side of every row fell off the screen. A table's used width
      takes the attribute as a preferred width and will not shrink under it, so
      max-width alone never got a chance. This way it fills a phone and stops at
      640 on a desktop, which is the behaviour the max-width was there for.
    -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:100%;max-width:640px;background:#ffffff;border:1px solid ${LINE};border-radius:8px;overflow:hidden;">

      <!-- The banner. A table cell rather than an image: a remote image is
           blocked by default in Outlook and would open as a blank rectangle. -->
      <tr><td bgcolor="${BRAND}" style="background:${BRAND};padding:20px 20px;">
        <!--
          Stacked, not two cells side by side.

          It was a two-column row, and on a phone the client squeezes the table
          until the title and the reference block touch — "QUOTATIONRef
          ALG09004-26", which is what the customer actually received. Stacking
          cannot collide at any width, and the reference reads perfectly well
          under the word it belongs to.
        -->
        <p style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:.04em;line-height:1.2;">
          QUOTATION
        </p>
        <p style="margin:8px 0 0;color:#ffffff;font-size:12px;line-height:1.6;opacity:.92;">
          <strong>Ref</strong>&nbsp;${esc(enquiry.ref)}${quote.version > 1 ? `/${quote.version}` : ""}
          &nbsp;&middot;&nbsp; <strong>Date</strong>&nbsp;${longDate(quote.created_at)}${
            quote.valid_until
              ? `<br><strong>Valid to</strong>&nbsp;${longDate(quote.valid_until)}`
              : ""
          }
        </p>
      </td></tr>

      <tr><td style="padding:20px 20px 0;">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">To</p>
        <p style="margin:0;font-size:15px;font-weight:600;color:${INK};">${esc(to || "—")}</p>
        ${customer?.name && customer.name !== to ? `<p style="margin:2px 0 0;font-size:13px;color:${MUTED};">${esc(customer.name)}</p>` : ""}
      </td></tr>

      <tr><td style="padding:16px 20px 0;">
        <p style="margin:0;font-size:13.5px;line-height:1.6;color:${INK};">${esc(message).replace(/\n/g, "<br>")}</p>
      </td></tr>

      <!-- What is being shipped, so the figures have something to attach to. -->
      <tr><td style="padding:16px 20px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${SOFT}" style="background:${SOFT};border:1px solid ${LINE};border-radius:6px;">
          <tr>${cell("Lane", lane || "—", "100%")}</tr>
          ${
            enquiry.cargo || enquiry.ready_date
              ? `<tr>
            ${cell("Cargo", enquiry.cargo || "—", "60%")}
            ${cell("Ready", enquiry.ready_date ? longDate(enquiry.ready_date) : "—", "40%")}
          </tr>`
              : ""
          }
        </table>
      </td></tr>

      <tr><td style="padding:18px 20px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <thead>
            <tr bgcolor="${SOFT}" style="background:${SOFT};">
              <th align="left"  style="padding:8px 6px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};">Charge</th>
              <th align="right" style="padding:8px 6px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};">Qty &times; rate</th>
              <th align="right" style="padding:8px 6px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};">Amount</th>
            </tr>
          </thead>
          <tbody>${charges}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" align="right" style="padding:12px 6px;font-size:13px;color:${INK};font-weight:600;">Total</td>
              <td align="right" style="padding:12px 6px;font-size:15px;color:${INK};font-weight:700;white-space:nowrap;">${money(quote.amount_inr)}</td>
            </tr>
          </tfoot>
        </table>
      </td></tr>

      ${
        i.acceptUrl
          ? `
      <!--
        The accept button.

        A link, not a form: the page it opens is what accepts, and following
        this URL only reads. That matters because Outlook Safe Links and every
        antivirus gateway fetch the links in a message before the recipient
        sees it — a button that accepted on being followed would be pressed by
        a scanner.

        Drawn as a table cell with its own background rather than a styled <a>,
        because Outlook ignores padding and background on inline elements and
        would render a bare blue link.
      -->
      <tr><td style="padding:20px 20px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${BRAND};border-radius:6px;">
            <a href="${esc(i.acceptUrl)}"
               style="display:inline-block;padding:12px 26px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
              Accept this quotation
            </a>
          </td>
        </tr></table>
        <p style="margin:8px 0 0;font-size:11.5px;color:${MUTED};">
          Opens a page showing this quotation, where you can confirm. Nothing is
          charged, and replying to this email works just as well.
        </p>
      </td></tr>`
          : ""
      }

      ${termsHtml}

      <tr><td style="padding:20px 20px 24px;">
        <p style="margin:0;font-size:13px;color:${INK};">
          ${i.fromName ? `${esc(i.fromName)}<br>` : ""}
          <span style="color:${MUTED};">${esc(i.company || "Aashish Logistics Global")}</span>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>`.trim();
}

/** One fact in the cargo strip. */
function cell(label: string, value: string, width = "33%"): string {
  return `<td width="${width}" style="padding:9px 12px;">
    <p style="margin:0 0 2px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};">${esc(label)}</p>
    <p style="margin:0;font-size:13px;color:${INK};">${esc(value)}</p>
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
