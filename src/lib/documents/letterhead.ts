import type { jsPDF } from "jspdf";
import { LETTERHEAD_MARK_JPG } from "./mark";
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

/** The issuer, as it appears on the letterhead (src/lib/company.ts). */
export { COMPANY };

/**
 * The head of every document, on the white of the page: the globe and the
 * registered name on the left; the address, the phone and the website, the
 * GSTIN and the PAN on the right; a hairline under them.
 *
 * It was the mail's lockup on a navy band with a blue rule (until 15 Oct).
 * The desk asked for it plain: a letterhead, not a banner, that prints
 * cleanly on an office printer.
 *
 * A letterhead without an address is a header. These documents are presented
 * to carriers, banks and customs, all of whom expect to see who issued it and
 * where they are — so the registered address, the GSTIN and the PAN are part
 * of the document, not decoration.
 *
 * @returns the y to carry on drawing from
 */
export function drawLetterhead(doc: jsPDF, y: number): number {
  const set = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);

  const HEAD_H = 21;
  const MARK = 19;
  const right = PAGE_W - MARGIN;

  // The globe; a letterhead without it is still a valid document, so a logo
  // that will not decode leaves the name where it is rather than failing the PDF.
  let nameX = MARGIN;
  try {
    doc.addImage(LETTERHEAD_MARK_JPG, "JPEG", MARGIN, y + (HEAD_H - MARK) / 2, MARK, MARK);
    nameX = MARGIN + MARK + 4;
  } catch {
    /* the name alone */
  }

  // Right-aligned, so the two blocks frame the head of the page. The PAN is a
  // GSTIN's third to twelfth characters.
  const lines = [...COMPANY.address, COMPANY.contact.join("  ·  ")];
  const ids = [COMPANY.gst, `PAN: ${COMPANY.gstin.slice(2, 12)}`];
  const step = 3.6;
  doc.setFontSize(7.4);
  doc.setFont("helvetica", "normal");
  const blockW = Math.max(...lines.map((l) => doc.getTextWidth(l)), ...ids.map((l) => doc.getTextWidth(l) * 1.06));
  let ay = y + (HEAD_H - step * (lines.length + ids.length - 1)) / 2 + 1.2;
  set(MUTED);
  for (const line of lines) {
    doc.text(line, right, ay, { align: "right" });
    ay += step;
  }
  doc.setFont("helvetica", "bold");
  set(INK);
  for (const line of ids) {
    doc.text(line, right, ay, { align: "right" });
    ay += step;
  }

  // The registered name, as large as fits before the address block.
  const room = right - blockW - 6 - nameX;
  doc.setFont("helvetica", "bold");
  let size = 15;
  doc.setFontSize(size);
  while (size > 10 && doc.getTextWidth(COMPANY.legalName) > room) doc.setFontSize((size -= 0.5));
  set(BRAND);
  doc.text(COMPANY.legalName, nameX, y + HEAD_H / 2 + size * 0.13);

  y += HEAD_H + 1.5;
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, right, y);
  doc.setLineWidth(0.2);
  return y + 7;
}

/** "18 Sep 2026". The month is spelled from a list — see quotationMail.ts. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function docDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

/** The day a document is printed: the date it is issued on. */
export const issuedToday = () => docDate(new Date().toISOString());
