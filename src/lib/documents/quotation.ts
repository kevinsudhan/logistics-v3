import { jsPDF } from "jspdf";
import {
  BRAND,
  CONTENT_W,
  docDate,
  drawLetterhead,
  FOOTER_Y,
  INK,
  MARGIN,
  MUTED,
  PAGE_W,
  RULE,
  TINT,
} from "./letterhead";
import { groupTerms } from "../quotationMail";
import type { Customer, Enquiry, Quote } from "../../services/enquiries";
import type { QuoteLine } from "../../services/quoteLines";
import type { QuoteTerm } from "../../services/quoteApproval";
import { chargeableWeight, describeChargeable, modeFor, volumeFromPieces } from "../chargeableWeight";

/**
 * The quotation, as a document rather than as a screen.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS NOT THE EMAIL LAYOUT ON A PAGE
 *
 * They are read in different circumstances and the same design serves neither.
 * The mail is glanced at on a phone, once, by the person who asked for a rate:
 * it leads with the figures and keeps everything else short.
 *
 * The PDF is what gets printed, filed, attached to a purchase order and argued
 * about six weeks later. It is read by somebody checking one number against
 * another document, so it is laid out the way every rate sheet in this trade
 * is laid out: letterhead, a boxed header of who and when, the offer sentence,
 * the rate table with its per-unit and total columns side by side, the totals,
 * and the cargo the rates were quoted against.
 *
 * WHY THE DIMENSIONS ARE PRINTED UNDER THE RATES
 *
 * Because the rates are only valid for that cargo, and the first thing that
 * happens when the figures are questioned is somebody asking what they were
 * based on. Printing the weight, the volume and the chargeable figure on the
 * same page turns that from a phone call into a glance — and it makes it
 * obvious when a shipper's later declaration does not match what they said.
 *
 * WHY NOTHING IS INVENTED
 *
 * A charge with no rate prints what is recorded rather than a plausible total.
 * A quotation that silently omits a charge is one this desk has to honour at
 * the figure it printed.
 * ---------------------------------------------------------------------------
 */

export interface QuotationPdfInput {
  enquiry: Enquiry;
  customer: Customer | null;
  quote: Quote;
  lines: QuoteLine[];
  terms: QuoteTerm[];
  /** Who it is addressed to by name, where the desk knows. */
  attention?: string | null;
}

export function renderQuotationPdf(i: QuotationPdfInput): jsPDF {
  const { enquiry, customer, quote, lines, terms } = i;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const set = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);

  let y = drawLetterhead(doc, MARGIN);

  /** A new page when the next block would run into the footer. */
  const ensure = (needed: number) => {
    if (y + needed < FOOTER_Y - 6) return;
    doc.addPage();
    y = MARGIN;
  };

  // -------------------------------------------------------------- the title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  set(INK);
  doc.text("QUOTATION", PAGE_W / 2, y + 5, { align: "center" });
  y += 11;

  // ------------------------------------------------------- who, and when
  /*
    A bordered box split down the middle: the customer on the left, the
    document's own identity on the right. This is the block somebody's eye goes
    to first when they pull the page out of a folder, and it is the shape every
    rate sheet in this trade uses — which is the reason to use it.
  */
  const BOX_H = 30;
  const mid = MARGIN + CONTENT_W / 2;
  stroke(RULE);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, y, CONTENT_W, BOX_H);

  const rowY = (n: number) => y + 6.5 + n * 5.6;
  const pair = (label: string, value: string, x: number, n: number, labelW: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    set(INK);
    doc.text(label, x, rowY(n));
    doc.text(":", x + labelW, rowY(n));
    doc.setFont("helvetica", "normal");
    set(value ? INK : MUTED);
    doc.text(value || "—", x + labelW + 3, rowY(n), { maxWidth: CONTENT_W / 2 - labelW - 12 });
  };

  const to = (customer?.company || customer?.name || "").trim();
  const chargeable = chargeableFor(enquiry);

  pair("Customer Name", to, MARGIN + 4, 0, 26);
  pair("Attention", (i.attention || customer?.name || "").trim(), MARGIN + 4, 1, 26);
  pair("Phone", (customer?.phones?.[0] ?? "").trim(), MARGIN + 4, 2, 26);
  pair("Stackable", enquiry.stackable == null ? "" : enquiry.stackable ? "Yes" : "No", MARGIN + 4, 3, 26);

  pair("Quotation No", `${enquiry.ref}${quote.version > 1 ? `/${quote.version}` : ""}`, mid + 4, 0, 26);
  pair("Quotation Date", docDate(quote.created_at), mid + 4, 1, 26);
  pair("Valid From", docDate(quote.created_at), mid + 4, 2, 26);
  pair("Valid To", docDate(quote.valid_until), mid + 4, 3, 26);

  y += BOX_H + 7;

  // ------------------------------------------------------- the offer line
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  set(INK);
  doc.text(
    "We sincerely appreciate being given the opportunity to quote on this business and are pleased to offer you the below rate quotation.",
    MARGIN,
    y,
    { maxWidth: CONTENT_W }
  );
  y += 9;

  // ------------------------------------------------------------ the rates
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.6);
  set(INK);
  doc.text(ratesHeading(enquiry), MARGIN, y);
  y += 4;

  /*
    Column widths in millimetres, summing to the content width.

    Description is given the room because a charge name is the one column that
    wraps; the numeric columns are sized to their widest realistic value and
    right-aligned, so figures line up down the page and can be compared without
    reading the labels.
  */
  const COL = { desc: 52, ccy: 18, per: 40, min: 20, units: 22, total: 26 };
  const xs = {
    desc: MARGIN,
    ccy: MARGIN + COL.desc,
    per: MARGIN + COL.desc + COL.ccy,
    min: MARGIN + COL.desc + COL.ccy + COL.per,
    units: MARGIN + COL.desc + COL.ccy + COL.per + COL.min,
    total: MARGIN + COL.desc + COL.ccy + COL.per + COL.min + COL.units,
  };
  const tableRight = MARGIN + CONTENT_W;

  const headerRow = (top: number) => {
    fill(TINT);
    doc.rect(MARGIN, top, CONTENT_W, 8, "F");
    stroke(RULE);
    doc.rect(MARGIN, top, CONTENT_W, 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.4);
    set(INK);
    const ty = top + 5.2;
    doc.text("Charge Description", xs.desc + 2, ty);
    doc.text("Currency", xs.ccy + 2, ty);
    doc.text("Amount Per Unit", xs.per + 2, ty);
    doc.text("Min Amount", xs.min + COL.min - 2, ty, { align: "right" });
    doc.text("Estimated Unit", xs.units + COL.units - 2, ty, { align: "right" });
    doc.text("Total Amount", tableRight - 2, ty, { align: "right" });
    return top + 8;
  };

  ensure(30);
  y = headerRow(y);

  if (!lines.length) {
    stroke(RULE);
    doc.rect(MARGIN, y, CONTENT_W, 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    set(MUTED);
    doc.text("Charges as discussed.", xs.desc + 2, y + 6);
    y += 9;
  }

  for (const l of lines) {
    // Wrapped first, because the row has to be as tall as its description.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const wrapped = doc.splitTextToSize(l.description || "—", COL.desc - 4) as string[];
    const h = Math.max(9, wrapped.length * 4 + 4.5);

    if (y + h > FOOTER_Y - 6) {
      doc.addPage();
      y = MARGIN;
      y = headerRow(y);
    }

    stroke(RULE);
    doc.rect(MARGIN, y, CONTENT_W, h);
    const ty = y + 6;
    set(INK);
    doc.text(wrapped, xs.desc + 2, ty);
    doc.text(l.currency || "INR", xs.ccy + 2, ty);
    doc.text(`${amount(l.rate)} per ${l.unit || "unit"}`, xs.per + 2, ty, { maxWidth: COL.per - 4 });
    doc.text(amount(0), xs.min + COL.min - 2, ty, { align: "right" });
    doc.text(amount(l.quantity), xs.units + COL.units - 2, ty, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(amount(l.amount_inr), tableRight - 2, ty, { align: "right" });
    y += h;
  }

  // ------------------------------------------------------------- the total
  y += 3;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  set(INK);
  doc.text("Total in INR", tableRight - 34, y + 3, { align: "right" });
  doc.text(amount(quote.amount_inr), tableRight - 2, y + 3, { align: "right" });
  y += 9;

  // ------------------------------------------- what the rates were quoted on
  ensure(34);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.6);
  set(INK);
  doc.text("Dimension calculation", MARGIN, y);
  y += 3;

  const dim = [
    ["Gross weight", enquiry.gross_weight_kg == null ? "—" : `${amount(enquiry.gross_weight_kg)} kg`],
    ["Pieces", enquiry.piece_count == null ? "—" : String(enquiry.piece_count)],
    ["Volume", volumeOf(enquiry) == null ? "—" : `${amount(volumeOf(enquiry)!)} CBM`],
    [
      "Dimensions",
      enquiry.piece_length_cm && enquiry.piece_width_cm && enquiry.piece_height_cm
        ? `${enquiry.piece_length_cm} × ${enquiry.piece_width_cm} × ${enquiry.piece_height_cm} cm`
        : "—",
    ],
    // The figure the rate is actually applied to, computed rather than stored —
    // a third number that must agree with two others is a number that stops
    // agreeing. See lib/chargeableWeight.ts.
    ["Chargeable", chargeable ? `${amount(chargeable.value)} ${chargeable.unit}` : "—"],
  ];

  const cw = CONTENT_W / dim.length;
  fill(TINT);
  doc.rect(MARGIN, y, CONTENT_W, 7, "F");
  stroke(RULE);
  doc.rect(MARGIN, y, CONTENT_W, 7);
  doc.rect(MARGIN, y + 7, CONTENT_W, 8);
  doc.setFontSize(7.4);
  dim.forEach(([label, value], n) => {
    doc.setFont("helvetica", "bold");
    set(INK);
    doc.text(label, MARGIN + n * cw + 2, y + 4.8);
    doc.setFont("helvetica", "normal");
    set(value === "—" ? MUTED : INK);
    doc.setFontSize(8);
    doc.text(value, MARGIN + n * cw + 2, y + 12.4, { maxWidth: cw - 4 });
    doc.setFontSize(7.4);
  });
  y += 15;

  if (chargeable) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    set(MUTED);
    doc.text(describeChargeable(chargeable), MARGIN, y + 4);
    y += 6;
  }

  // ------------------------------------------------------------- the terms
  const grouped = groupTerms(terms);
  if (grouped.length) {
    y += 4;
    ensure(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.6);
    set(INK);
    doc.text("Terms & conditions", MARGIN, y);
    y += 5;

    for (const g of grouped) {
      if (g.label) {
        ensure(8);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.6);
        set(INK);
        doc.text(g.label, MARGIN, y);
        y += 4;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.4);
      set(MUTED);
      g.items.forEach((t, n) => {
        const wrapped = doc.splitTextToSize(`${n + 1}.  ${t}`, CONTENT_W - 4) as string[];
        ensure(wrapped.length * 3.4 + 2);
        doc.text(wrapped, MARGIN + 2, y);
        y += wrapped.length * 3.4 + 1.4;
      });
      y += 2;
    }
  }

  // ------------------------------------------------------------ the footer
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    stroke(RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, FOOTER_Y - 4, PAGE_W - MARGIN, FOOTER_Y - 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    set(MUTED);
    doc.text(
      "Business is transacted subject to our standard trading conditions, available on request.",
      MARGIN,
      FOOTER_Y
    );
    doc.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN, FOOTER_Y, { align: "right" });
    // A quiet brand rule at the very foot, so a loose page is identifiable.
    fill(BRAND);
    doc.rect(MARGIN, FOOTER_Y + 3, CONTENT_W, 0.6, "F");
  }

  return doc;
}

/** "AIR RATES", "SEA LCL RATES" — the heading the trade puts over a rate table. */
function ratesHeading(e: Enquiry): string {
  switch (e.transport_mode) {
    case "air":
      return "AIR RATES";
    case "sea_fcl":
      return "SEA FCL RATES";
    case "sea_lcl":
      return "SEA LCL RATES";
    case "road":
      return "ROAD RATES";
    default:
      return "RATES";
  }
}

/** Measured where it exists, derived from the piece dimensions only where it does not. */
function volumeOf(e: Enquiry): number | null {
  return (
    e.volume_cbm ??
    volumeFromPieces(e.piece_length_cm, e.piece_width_cm, e.piece_height_cm, e.piece_count)
  );
}

function chargeableFor(e: Enquiry) {
  return chargeableWeight(e.gross_weight_kg, volumeOf(e), modeFor(e.transport_mode));
}

const amount = (n: number | null | undefined) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
