import type { Customer, Enquiry } from "../services/enquiries";
import { COMPANY, MAIL_LOGO_NAVY } from "./company";

/**
 * The letterhead every customer mail is built on: the quotation, the booking
 * confirmation, and whatever goes out next.
 *
 * ---------------------------------------------------------------------------
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
 * NARROW SCREENS
 *
 * Half of these are read on a phone. Nothing here is a fixed width: the card
 * is 100% up to 640px, the logo 100% up to 300px (Outlook, which ignores the
 * CSS, sizes it by its width attribute), header details may wrap, and long
 * words may break. It holds together down to 320px.
 * ---------------------------------------------------------------------------
 */

/* Palette, from the logo: its navy, the blue of its ring, slate greys for the rest. */
export const NAVY = MAIL_LOGO_NAVY;
export const NAVY_LINE = "#24395a";
export const NAVY_SOFT = "#9fb3cc";
export const ACCENT = "#1670b0";
export const ACCENT_SOFT = "#eaf3fb";
export const INK = "#1f2937";
export const MUTED = "#64748b";
export const LINE = "#e2e8f0";
export const SOFT = "#f6f8fb";
const PAGE = "#eef2f7";
const FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

/** Escapes for HTML. Notes are typed by a person and go into markup. */
export function esc(v: string): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const num = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));

export const money = (n: number | null | undefined) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

/**
 * "18 Sep 2026" — unambiguous across the date conventions this trade spans.
 *
 * The months are listed rather than taken from `toLocaleDateString`, which
 * abbreviates September to four letters in en-GB: a letter dated "18 Sept
 * 2026" and valid to "18 Oct 2026" is two different formats on one line.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** A small uppercase caption over a section or a value. */
export const caption = (text: string, color = MUTED) =>
  `<p style="margin:0 0 4px;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:${color};font-weight:600;">${esc(text)}</p>`;

/** One section of the card, with the card's side padding. */
export const section = (html: string, top = 22) => (html ? `<tr><td style="padding:${top}px 24px 0;">${html}</td></tr>` : "");

/** Who it is for: the company, then the person. */
export function preparedFor(customer: Customer | null): string {
  const to = customer?.company || customer?.name || "";
  return section(
    `${caption("Prepared for")}
        <p style="margin:0;font-size:17px;font-weight:700;color:${NAVY};">${esc(to || "—")}</p>
        ${customer?.name && customer.name !== to ? `<p style="margin:2px 0 0;font-size:13px;color:${MUTED};">Attn: ${esc(customer.name)}</p>` : ""}`,
    26
  );
}

/** The sender's own words, line breaks kept. */
export const message = (text: string) =>
  section(`<p style="margin:0;font-size:14px;line-height:1.65;color:${INK};">${esc(text).replace(/\n/g, "<br>")}</p>`, 18);

export const MODE_WORD: Record<string, string> = {
  air: "Air freight",
  sea_lcl: "Sea freight · LCL",
  sea_fcl: "Sea freight · FCL",
  road: "Road",
  other: "Other",
};

/** Packages (or pieces), weight and volume, as far as they are known. */
export function packagesAndWeight(e: Enquiry): string {
  return [
    e.package_count ? `${num(e.package_count)} ${esc(e.package_type || "packages")}` : e.piece_count ? `${num(e.piece_count)} pcs` : null,
    e.gross_weight_kg ? `${num(e.gross_weight_kg)} kg` : null,
    e.volume_cbm ? `${num(e.volume_cbm)} CBM` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The shipment in brief: the route across the top, then the facts two to a
 * row. Values are HTML (already escaped); a fact with no value is not a line.
 */
export function shipmentBox(e: Enquiry, facts: Array<[string, string]>): string {
  const known = facts.filter(([, v]) => v);
  const rows: string[] = [];
  for (let k = 0; k < known.length; k += 2) {
    rows.push(`<tr>${fact(...known[k])}${known[k + 1] ? fact(...known[k + 1]) : `<td width="50%" style="padding:10px 16px;"></td>`}</tr>`);
  }
  const lane =
    e.origin || e.destination
      ? `<tr><td colspan="2" style="padding:14px 16px 10px;border-bottom:1px solid ${LINE};">
          ${caption("Route")}
          <p style="margin:0;font-size:15px;font-weight:700;color:${NAVY};">${esc(e.origin || "—")} <span style="color:${ACCENT};">&rarr;</span> ${esc(e.destination || "—")}</p>
        </td></tr>`
      : "";
  if (!lane && !rows.length) return "";
  return section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${SOFT}" style="background:${SOFT};border:1px solid ${LINE};border-radius:8px;border-collapse:separate;">
          ${lane}
          ${rows.join("")}
        </table>`);
}

function fact(label: string, value: string): string {
  return `<td width="50%" valign="top" style="padding:10px 16px;">
    ${caption(label)}
    <p style="margin:0;font-size:13.5px;color:${INK};line-height:1.4;">${value}</p>
  </td>`;
}

/** Signed by the sender, for the company. */
export const signOff = (fromName: string | undefined, company: string | undefined) => `<tr><td style="padding:26px 24px 26px;">
        <p style="margin:0;font-size:13.5px;line-height:1.6;color:${INK};">
          Warm regards,<br>
          ${fromName ? `<strong style="color:${NAVY};">${esc(fromName)}</strong><br>` : ""}
          <span style="color:${MUTED};">${esc(company || COMPANY.legalName)}</span>
        </p>
      </td></tr>`;

/**
 * The whole letter: the card, its header, the blue rule, the sections, and the
 * registered details at the foot.
 *
 * The header is the logo on its own navy, then the title and up to three facts
 * under it — stacked rather than side by side, because two cells squeezed onto
 * a phone collided into "QUOTATIONRef ALG09004-26". A long title ("BOOKING
 * CONFIRMATION") steps down a size, so its longest word still fits a 320px
 * phone.
 */
export function letter(i: { logoSrc?: string | null; title: string; meta: Array<[string, string]>; sections: string[] }): string {
  // width:100% capped at 300, not a fixed 300px: a fixed width sets the cell's minimum and pushes a
  // narrow phone sideways. Outlook ignores the CSS and sizes it by the width attribute.
  const brand = i.logoSrc
    ? `<img src="${esc(i.logoSrc)}" width="300" alt="${esc(COMPANY.legalName)}" style="display:block;width:100%;max-width:300px;height:auto;border:0;color:#ffffff;font-size:16px;font-weight:700;" />`
    : `<p style="margin:0;color:#ffffff;font-size:17px;font-weight:700;letter-spacing:.06em;">${esc(COMPANY.name)}</p>`;
  // Values may wrap ("23 Sep / 2026") so three fit a narrow phone; on a desktop they sit on one line.
  const meta = i.meta
    .map(
      ([label, value]) => `<td valign="top" style="padding:0 14px 0 0;">
      <p style="margin:0;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${NAVY_SOFT};">${label}</p>
      <p style="margin:3px 0 0;font-size:13px;font-weight:700;color:#ffffff;">${value}</p>
    </td>`
    )
    .join("");

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${PAGE}" style="background:${PAGE};font-family:${FONT};">
  <tr><td align="center" style="padding:24px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:100%;max-width:640px;background:#ffffff;border:1px solid ${LINE};border-radius:10px;border-collapse:separate;">

      <tr><td bgcolor="${NAVY}" style="background:${NAVY};padding:22px 24px 22px;border-radius:10px 10px 0 0;">
        ${brand}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid ${NAVY_LINE};">
          <tr><td style="padding-top:16px;">
            <p style="margin:0 0 12px;color:#ffffff;font-size:${i.title.length > 12 ? 19 : 22}px;font-weight:800;letter-spacing:.16em;">${esc(i.title)}</p>
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              ${meta}
            </tr></table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td height="4" bgcolor="${ACCENT}" style="background:${ACCENT};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>

      ${i.sections.filter(Boolean).join("\n\n      ")}

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
