import type { jsPDF } from "jspdf";
import { LETTERHEAD_BAND_JPG } from "./mark";
import { COMPANY } from "../company";

/**
 * The page, the palette and the letterhead every document shares.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE
 *
 * Two renderers draw documents now — the general one for bills of lading,
 * invoices and the rest, and the quotation, which is a rate sheet and does not
 * fit the label-and-value shape the others do. Both begin with the same
 * letterhead, and the day the office moves or the GSTIN changes, that fact has
 * to be true in one place. A registered address that is right on the B/L and
 * stale on the quotation is the kind of error a customer's accounts department
 * finds first.
 * ---------------------------------------------------------------------------
 */

export const PAGE_W = 210;
export const PAGE_H = 297;
export const MARGIN = 16;
export const CONTENT_W = PAGE_W - MARGIN * 2;
export const FOOTER_Y = PAGE_H - 20;

/**
 * The house palette, the mail's (lib/brandedMail.ts): the logo's navy, the blue
 * of its ring, and slate greys. It was a green and warm greys until the logo
 * came in; a quotation attached to a navy mail printed as somebody else's.
 */
export const BRAND: [number, number, number] = [15, 33, 58];
export const ACCENT: [number, number, number] = [22, 112, 176];
export const INK: [number, number, number] = [31, 41, 55];
export const MUTED: [number, number, number] = [100, 116, 139];
export const FAINT: [number, number, number] = [148, 163, 184];
export const RULE: [number, number, number] = [214, 221, 230];
export const TINT: [number, number, number] = [241, 245, 249];
export const WARN: [number, number, number] = [150, 70, 20];
/** Text on the navy band: the address a step back from the white GSTIN. */
const ON_BRAND: [number, number, number] = [200, 214, 232];

/** The issuer, as it appears on the letterhead (src/lib/company.ts). */
export { COMPANY };

/**
 * The lockup and the address on a navy band, with the blue rule under it — the
 * head of the quotation mail, on paper.
 *
 * A letterhead without an address is a header. These documents are presented to
 * carriers, banks and customs, all of whom expect to see who issued it and
 * where they are — so the registered address and the GSTIN are part of the
 * document, not decoration.
 *
 * The band sits inside the margins rather than bleeding off the page: office
 * printers leave a few millimetres unprinted at the edge, and a bleed comes
 * out with a white sliver down each side.
 *
 * @returns the y to carry on drawing from
 */
export function drawLetterhead(doc: jsPDF, y: number): number {
  const set = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);

  // The band and the logo are one image, cut to these 178 x 26mm (see mark.ts).
  const BAND_H = 26;
  try {
    doc.addImage(LETTERHEAD_BAND_JPG, "JPEG", MARGIN, y, CONTENT_W, BAND_H);
  } catch {
    // A letterhead without its logo is still a valid document. Failing the
    // whole render because an image would not decode is not — a plain band
    // and the name stand in.
    fill(BRAND);
    doc.rect(MARGIN, y, CONTENT_W, BAND_H, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    set([255, 255, 255]);
    doc.text(COMPANY.name, MARGIN + 6, y + BAND_H / 2 + 1.8);
  }

  // Address right-aligned, so the two blocks frame the head of the page.
  const right = PAGE_W - MARGIN - 5;
  const lines = [...COMPANY.address, COMPANY.contact.join("  ·  ")];
  const step = 3.7;
  let ay = y + (BAND_H - step * (lines.length + 1)) / 2 + 2.6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.3);
  set(ON_BRAND);
  for (const line of lines) {
    doc.text(line, right, ay, { align: "right" });
    ay += step;
  }
  doc.setFont("helvetica", "bold");
  set([255, 255, 255]);
  doc.text(COMPANY.gst, right, ay, { align: "right" });

  y += BAND_H;
  fill(ACCENT);
  doc.rect(MARGIN, y, CONTENT_W, 1.1, "F");
  return y + 1.1 + 7;
}

/** "18 Sep 2026". The month is spelled from a list — see quotationMail.ts. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function docDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}
