import type { jsPDF } from "jspdf";
import { AASHISH_MARK_PNG } from "./mark";
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

/** The house palette, matched to the CRM so the two look like one system. */
export const BRAND: [number, number, number] = [15, 110, 86];
export const INK: [number, number, number] = [20, 21, 15];
export const MUTED: [number, number, number] = [110, 112, 100];
export const FAINT: [number, number, number] = [155, 157, 146];
export const RULE: [number, number, number] = [214, 216, 206];
export const TINT: [number, number, number] = [241, 242, 237];
export const WARN: [number, number, number] = [150, 70, 20];

/** The issuer, as it appears on the letterhead (src/lib/company.ts). */
export { COMPANY };

/**
 * The mark, the name, and the address block, with a rule under them.
 *
 * A letterhead without an address is a header. These documents are presented to
 * carriers, banks and customs, all of whom expect to see who issued it and
 * where they are — so the registered address and the GSTIN are part of the
 * document, not decoration.
 *
 * @returns the y to carry on drawing from
 */
export function drawLetterhead(doc: jsPDF, y: number): number {
  const set = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);

  const LOGO = 14;
  try {
    doc.addImage(AASHISH_MARK_PNG, "PNG", MARGIN, y, LOGO, LOGO);
  } catch {
    // A letterhead without its mark is still a valid document. Failing the
    // whole render because an image would not decode is not.
  }

  const nameX = MARGIN + LOGO + 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14.5);
  set(BRAND);
  doc.text(COMPANY.name, nameX, y + 5.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  set(MUTED);
  doc.text(COMPANY.tagline, nameX, y + 10);
  doc.text(COMPANY.gst, nameX, y + 13.6);

  // Address right-aligned, so the two blocks frame the head of the page.
  doc.setFontSize(7.4);
  let ay = y + 3;
  for (const line of [...COMPANY.address, ...COMPANY.contact]) {
    doc.text(line, PAGE_W - MARGIN, ay, { align: "right" });
    ay += 3.4;
  }

  y += 18;
  // Weighted so it reads as a division rather than another hairline on a page
  // that has several.
  fill(BRAND);
  doc.rect(MARGIN, y, CONTENT_W, 0.8, "F");
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
