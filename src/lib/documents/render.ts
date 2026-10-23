import { jsPDF } from "jspdf";
import type { ChargeLine, DocRow, DocSection, DocSpec, DocumentData } from "./types";
import {
  chargeTotals,
  foreignCurrencies,
  interState,
  lineAmount,
  lineCurrency,
  lineInr,
  lineTax,
  percent,
  rateOfExchange,
  roeFigure,
  rupeeFigure,
  rupeesInWords,
  stateOf,
  taxSummary,
  type TaxSums,
} from "./charges";
import { documentNo, readiness } from "./data";
import {
  BRAND,
  COMPANY,
  CONTENT_W,
  drawLetterhead,
  FAINT,
  FOOTER_Y,
  INK,
  issuedToday,
  MARGIN,
  MUTED,
  PAGE_H,
  PAGE_W,
  RULE,
  TINT,
  WARN,
} from "./letterhead";

const TBD = "TBD";

/**
 * Draws any document in the registry.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS RESPONSIBLE FOR
 *
 * Written once, deliberately. The rules that matter are the ones about honesty,
 * and they only hold if there is a single place enforcing them:
 *
 *   - A field nobody established prints TBD, in grey, and is never inferred.
 *   - A document missing anything it requires is stamped DRAFT and lists what
 *     is outstanding, by name, on the document itself.
 *   - Nothing is presented as signed or issued by an authority that has not
 *     signed it.
 *
 * WHY THE LAYOUT IS BUILT FROM BANDS AND BOXES
 *
 * A bill of lading is read by people looking for one field. A customs officer
 * wants the HS code, a warehouse wants the package count, an accounts clerk
 * wants the invoice value — and none of them read the document top to bottom.
 *
 * The previous version was flat: bold label, thin rule, rows of text at one
 * weight. It printed the right information and gave the eye nothing to aim at,
 * so finding the consignee meant reading everything above it.
 *
 * So: a filled title band, the parties in bordered boxes the way they sit on a
 * real B/L, and each section under a tinted header bar. The structure is doing
 * the same job the printed forms these replace have always done.
 *
 * A document declared `layout: "split"` (the cargo arrival notice) is drawn in
 * two columns instead — its parties boxed down the left, its details in a grid
 * on the right, its cargo as a table across, and what the consignee must do
 * beside the terms and the signature — because that is how the people who
 * receive one expect to find things on it, and because it puts a CAN with
 * every particular filled in on one page.
 *
 * A document declared `layout: "invoice"` (the freight invoice and its
 * proforma) is drawn as a GST invoice to the trade, without boxes: label and
 * value in two columns, the charges ruled with the tax on each line and their
 * totals, then the tax by SAC, the terms, and our bank details beside the
 * signature — always on the one page (onOnePage).
 * ---------------------------------------------------------------------------
 */

/**
 * How tightly a document is set.
 *
 * ---------------------------------------------------------------------------
 * THE SIGNATURE STAYS WITH THE DOCUMENT
 *
 * A document whose content ends near the foot of a page used to put the
 * signature line on a page of its own: "For AASHISH LOGISTICS GLOBAL" and a
 * rule, alone on page two, under a page one that looks unsigned. Nobody signs
 * that, and a consignee reading page one has a document with no signature.
 *
 * So it is drawn as usual first; if the signature would go over to a new
 * page, it is drawn again with the space between blocks taken in, then again
 * with the lines a little closer too, which between them bring it back nearly
 * always. If even that is not enough, the block above it — the declaration,
 * else the outstanding list, else the last section — goes over with it, so
 * the signature is at least under something it signs.
 *
 * The first fit is the layout as it always was, so a document with room for
 * its signature is drawn as before.
 * ---------------------------------------------------------------------------
 */
interface Fit {
  /** Scales the space between blocks. */
  gap: number;
  /** The least height of a row. */
  row: number;
  /** Space left above the signature line, for the signature. */
  sign: number;
  /** The distance between the lines of a row, and of the declaration. */
  line: number;
  declLine: number;
  /** Take the block above the signature over with it. */
  carry: boolean;
  /** An invoice's particulars closer set, never smaller: the first thing tried when it runs over (onOnePage). */
  close?: boolean;
  /**
   * An invoice with more charges than the page holds as it is (onOnePage):
   * its particulars closer set, the bank account beside the tax by SAC, and
   * the charges' lines at `rows` of their size — the table's head, its total
   * and everything round it as they are.
   */
  crowded?: boolean;
  rows?: number;
  /**
   * Room left over on an invoice's page, given to its charges' table, so the
   * total, the tax, the bank account and the signature sit at its foot.
   */
  stretch?: number;
  /**
   * Drawn without page breaks and, where under one, smaller by this much: an
   * invoice whose charges would not fit even at the least size (onOnePage).
   */
  scale?: number;
}

const FITS: Fit[] = [
  { gap: 1, row: 5.2, sign: 13, line: 4.4, declLine: 3.6, carry: false },
  { gap: 0.55, row: 4.6, sign: 10, line: 4.4, declLine: 3.6, carry: false },
  { gap: 0.3, row: 4.3, sign: 8, line: 4, declLine: 3.3, carry: false },
  { gap: 0.3, row: 4.3, sign: 8, line: 4, declLine: 3.3, carry: true },
];

export function renderDocument(spec: DocSpec, data: DocumentData): jsPDF {
  if (spec.layout === "invoice") return onOnePage(spec, data);
  let doc: jsPDF | null = null;
  for (const fit of FITS) {
    const drawn = draw(spec, data, fit);
    if (!drawn.signPushed) return drawn.doc;
    doc = drawn.doc;
  }
  return doc!;
}

/** The least size the charges' lines are set at before anything else is made smaller. */
const LEAST_ROWS = 0.3;

/** How far down an invoice's page it may run: it has no footer, so nearer the foot than other documents. */
const INVOICE_LIMIT = PAGE_H - 18;

/**
 * An invoice is one page, however many charges it has.
 *
 * ---------------------------------------------------------------------------
 * A second page of an invoice is a page somebody loses: the charges on one,
 * the total and the bank account on the other. So it is drawn as usual first,
 * then closer set, as any document is. If it is still more than a page, it is
 * crowded: the particulars closer set, the bank account beside the tax by
 * SAC, and only the charges' lines made smaller — by as little as gets the
 * whole on the page. The letterhead, the particulars, the
 * table's head and total, the tax and the bank stay their size and the width
 * of the page: thirty charges make the table's lines small, not the invoice.
 *
 * Only a list longer than even the least size holds (some sixty lines) is
 * laid out without page breaks and printed smaller as a whole, about the head
 * of the page: still the one page, every figure where it was.
 *
 * Whatever room is left on the page goes to the charges' table, as the line's
 * e-invoice leaves it, so the foot — the total, the tax, the terms, the bank
 * account and the signature — is always at the foot of the page.
 * ---------------------------------------------------------------------------
 */
function onOnePage(spec: DocSpec, data: DocumentData): jsPDF {
  const fits = (doc: jsPDF) => doc.getNumberOfPages() === 1;
  /** Drawn again with the room it left given to the table; as it was, should that ever not fit. */
  const settle = (fit: Fit, drawn: { doc: jsPDF; end: number }) => {
    const room = INVOICE_LIMIT - drawn.end - 1;
    if (room < 0.5) return drawn.doc;
    const settled = draw(spec, data, { ...fit, stretch: room }).doc;
    return fits(settled) ? settled : drawn.doc;
  };
  // As usual, then closer set, then with the particulars closer set too: the foot still as it was approved.
  for (const fit of [...FITS.slice(0, 3), { ...FITS[2], close: true }]) {
    const drawn = draw(spec, data, fit);
    if (fits(drawn.doc)) return settle(fit, drawn);
  }
  const crowded: Fit = { ...FITS[2], close: true, crowded: true };
  const at = (rows: number) => ({ fit: { ...crowded, rows }, drawn: draw(spec, data, { ...crowded, rows }) });
  // Down a twentieth at a time, not by halving: a long charge's name goes on to a
  // second line at one size and not the next, so a smaller size does not always fit
  // where a larger did not, and halving can stop well short of the largest that does.
  for (let step = 0; 1 - step * 0.05 >= LEAST_ROWS - 1e-9; step++) {
    const rows = 1 - step * 0.05;
    let best = at(rows);
    if (!fits(best.drawn.doc)) continue;
    // Then a little finer, between it and the size above.
    for (const finer of [0.0375, 0.025, 0.0125]) {
      if (!step) break;
      const larger = at(rows + finer);
      if (fits(larger.drawn.doc)) {
        best = larger;
        break;
      }
    }
    return settle(best.fit, best.drawn);
  }
  const { end } = draw(spec, data, { ...crowded, rows: LEAST_ROWS, scale: 1 });
  return draw(spec, data, { ...crowded, rows: LEAST_ROWS, scale: Math.min(1, (INVOICE_LIMIT - MARGIN) / (end - MARGIN)) }).doc;
}

/**
 * Whatever is drawn after this, until `unzoom`, at `s` of its size: scaled
 * about the top margin, so it starts where it would, and centred across the
 * page. A PDF transformation (cm), so the text, the rules and the logo shrink
 * together.
 */
function zoom(doc: jsPDF, s: number) {
  const k = doc.internal.scaleFactor;
  const e = k * (1 - s) * (PAGE_W / 2);
  const f = (1 - s) * (doc.internal.pageSize.getHeight() * k - k * MARGIN);
  rawWrite(doc, "q", `${s.toFixed(5)} 0 0 ${s.toFixed(5)} ${e.toFixed(3)} ${f.toFixed(3)} cm`);
}

const unzoom = (doc: jsPDF) => rawWrite(doc, "Q");

/** A line of the page's own content stream, which jsPDF's typings leave out. */
const rawWrite = (doc: jsPDF, ...ops: string[]) => (doc.internal as unknown as { write: (...s: string[]) => void }).write(...ops);

type Colour = [number, number, number];

function draw(spec: DocSpec, data: DocumentData, fit: Fit): { doc: jsPDF; signPushed: boolean; end: number } {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const zoomed = fit.scale !== undefined && fit.scale < 1;
  if (zoomed) zoom(doc, fit.scale!);
  const { ready, missingLabels } = readiness(data, spec.requires, spec.check);
  const split = spec.layout === "split";
  const invoice = spec.layout === "invoice";
  const signs = spec.issuer === "desk";

  const set = (c: Colour) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c: Colour) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: Colour) => doc.setDrawColor(c[0], c[1], c[2]);

  // Laid out to be scaled onto one page: never broken over two.
  const LIMIT = fit.scale !== undefined ? Infinity : invoice ? INVOICE_LIMIT : FOOTER_Y - 6;
  let y = MARGIN;
  /** Whether the signature went over to a new page: worth drawing again, tighter. */
  let signPushed = false;

  const newPage = () => {
    doc.addPage();
    y = MARGIN;
  };
  /** Starts a new page when the next block would run into the footer. Says whether it did. */
  const ensure = (needed: number) => {
    if (y + needed < LIMIT) return false;
    newPage();
    return true;
  };

  /** A row's value, and whether it is shown at all: an optional row with nothing is left out. */
  const shown = (section: DocSection) =>
    section.rows
      .map((row) => ({ row, value: row.value(data) }))
      .filter(({ row, value }) => !(row.optional && value === undefined));

  /** A section's heading, as a tinted bar with a brand tick, so the eye can find "Cargo". */
  const sectionBar = (title: string) => {
    fill(TINT);
    doc.rect(MARGIN, y, CONTENT_W, 6.4, "F");
    fill(BRAND);
    doc.rect(MARGIN, y, 1.2, 6.4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.4);
    set(MUTED);
    doc.text(title.toUpperCase(), MARGIN + 4, y + 4.3);
  };

  /** A bordered box with its heading in a tinted strip, as the parties sit on a B/L. */
  const box = (x: number, top: number, w: number, h: number, heading: string) => {
    stroke(RULE);
    fill([255, 255, 255]);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, top, w, h, 1.5, 1.5, "FD");
    fill(TINT);
    doc.rect(x + 0.4, top + 0.4, w - 0.8, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    set(MUTED);
    doc.text(heading.toUpperCase(), x + 3.5, top + 4.4);
  };

  /** The signature, right-aligned, its top at `top`; returns where it ends. */
  const signature = (top: number) => {
    let sy = top;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    set(MUTED);
    doc.text("For AASHISH LOGISTICS GLOBAL", PAGE_W - MARGIN, sy, { align: "right" });
    sy += fit.sign;
    stroke(RULE);
    doc.line(PAGE_W - MARGIN - 58, sy, PAGE_W - MARGIN, sy);
    sy += 3.6;
    doc.setFontSize(7);
    set(FAINT);
    doc.text("Authorised signatory", PAGE_W - MARGIN, sy, { align: "right" });
    return sy;
  };

  /** The rules of a ruled table: an invoice's charges and its tax by SAC. */
  const GRID: Colour = [160, 170, 184];

  y = drawLetterhead(doc, y);

  // ------------------------------------------------------------------ title
  /*
    The title in a filled band.
    ------------------------------------------------------------------------
    It is the one thing a reader needs before anything else — whether this is a
    quotation or a bill of lading changes what every field below it means — and
    at 13pt bold on white it carried no more weight than a section heading.

    An invoice's is centred and underlined over its particulars instead, as an
    invoice to the trade sets it.
  */
  const TITLE_H = 11;
  doc.setFont("helvetica", "bold");
  if (invoice) {
    doc.setFontSize(13);
    set(INK);
    doc.text(spec.title, PAGE_W / 2, y + 5.4, { align: "center" });
    const half = doc.getTextWidth(spec.title) / 2;
    stroke(INK);
    doc.setLineWidth(0.35);
    doc.line(PAGE_W / 2 - half, y + 6.8, PAGE_W / 2 + half, y + 6.8);
    doc.setLineWidth(0.2);
  } else {
    fill(TINT);
    doc.rect(MARGIN, y, CONTENT_W, TITLE_H, "F");
    fill(BRAND);
    doc.rect(MARGIN, y, 1.6, TITLE_H, "F");
    doc.setFontSize(12);
    set(INK);
    doc.text(spec.title, MARGIN + 5, y + TITLE_H / 2 + 1.4, {
      maxWidth: CONTENT_W - 44,
      baseline: "alphabetic",
    });
  }

  // Which copy of a tax invoice this is, at the right of its title, as the e-invoice marks it: ORIGINAL.
  let copyW = 0;
  const copy = invoice ? data.invoice?.copy : undefined;
  if (copy) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    set(INK);
    doc.text(copy, PAGE_W - MARGIN, y + 5.4, { align: "right" });
    copyW = doc.getTextWidth(copy) + 4;
  }

  if (!ready) {
    // A pill rather than loose red text, so it reads as a stamp on the
    // document rather than a sentence somebody added to it.
    const label = "DRAFT";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    const w = doc.getTextWidth(label) + 7;
    const top = invoice ? y + 1 : y + 2.6;
    const right = PAGE_W - MARGIN - copyW;
    fill([250, 235, 215]);
    stroke(WARN);
    doc.setLineWidth(0.3);
    doc.roundedRect(right - w, top, w, 5.8, 1.2, 1.2, "FD");
    set(WARN);
    doc.text(label, right - w / 2, top + 4, { align: "center" });
    doc.setLineWidth(0.2);
  }
  // Never so tight that the line under the band touches it: below 4 mm "Document no" ran into the title.
  y += invoice ? (fit.close ? 10 : 12) : TITLE_H + Math.max(4, 5 * fit.gap);

  // ------------------------------------------------------------- meta strip
  /*
    Four facts in two columns, keyed and valued.
    ------------------------------------------------------------------------
    They were four sentences ("Document no: X") which is how a label looks when
    nobody decided where the value goes. Split, they line up and can be scanned.
    An invoice carries its number and date in its own particulars instead.
  */
  const metaRows: Array<[string, string, string, string]> = [
    ["Document no", documentNo(spec, data), "Date issued", issuedToday()],
    [
      "Reference",
      data.reference,
      "Status",
      ready ? "Complete" : `Awaiting ${missingLabels.length} detail${missingLabels.length === 1 ? "" : "s"}`,
    ],
  ];

  doc.setFontSize(8.2);
  const midX = MARGIN + CONTENT_W / 2;
  for (const [k1, v1, k2, v2] of invoice ? [] : metaRows) {
    doc.setFont("helvetica", "normal");
    set(FAINT);
    doc.text(k1, MARGIN, y);
    doc.text(k2, midX, y);
    doc.setFont("helvetica", "bold");
    set(INK);
    doc.text(v1, MARGIN + 24, y, { maxWidth: CONTENT_W / 2 - 26 });
    doc.text(v2, midX + 24, y, { maxWidth: CONTENT_W / 2 - 26 });
    y += 4.6;
  }
  if (!invoice) y += 4 * fit.gap;

  // ---------------------------------------------------------------- parties
  /*
    Shipper and consignee in bordered boxes.
    ------------------------------------------------------------------------
    This is how every B/L, every shipping instruction and every delivery order
    in the trade is laid out, and a reader who handles these all day finds the
    consignee by looking at the top-right box before reading a word.
  */
  if (spec.parties && !split) {
    const gap = 5;
    const boxes: Array<[string, string[]]> = [
      ["Shipper / Exporter", [data.shipperName ?? TBD, `GSTIN / IEC: ${data.shipperGstinIec ?? TBD}`]],
      ["Consignee / Importer", [data.consigneeName ?? TBD, data.consigneeAddress ?? TBD, data.consigneeCountry ?? TBD]],
    ];
    const colW = (CONTENT_W - gap * (boxes.length - 1)) / boxes.length;
    const size = 8.6;
    const lineH = 4.2;

    // Every box takes the height of the tallest, so they read as one band.
    doc.setFontSize(size);
    const lines = (rows: string[]) =>
      rows.flatMap((r) => doc.splitTextToSize(r, colW - 7) as string[]);
    const boxH = Math.max(...boxes.map(([, rows]) => lines(rows).length)) * lineH + 11;

    ensure(boxH + 8);

    const drawParty = (x: number, heading: string, rows: string[]) => {
      box(x, y, colW, boxH, heading);
      let ly = y + 10.4;
      doc.setFontSize(size);
      for (const row of rows) {
        const known = !row.includes(TBD);
        doc.setFont("helvetica", known && row === rows[0] ? "bold" : "normal");
        set(known ? INK : FAINT);
        for (const line of doc.splitTextToSize(row, colW - 7) as string[]) {
          doc.text(line, x + 3.5, ly);
          ly += lineH;
        }
      }
    };

    boxes.forEach(([heading, rows], i) => drawParty(MARGIN + i * (colW + gap), heading, rows));
    y += boxH + 7 * fit.gap;
  }

  if (split) drawSplit();

  if (invoice) {
    drawColumns();
    if (data.charges?.length) drawCharges(data.charges);
    drawOutstanding();
    // Without a table to take it, the room left goes above the foot: the signature at the foot of the page all the same.
    if (!data.charges?.length) y += fit.stretch ?? 0;
    drawInvoiceClose();
    if (zoomed) unzoom(doc);
    // No footer: an invoice is its one page, and the desk wants nothing under the signature.
    return { doc, signPushed, end: y };
  }

  // --------------------------------------------------------------- sections
  const LABEL_W = 46;
  const bands = spec.sections.filter((s) => !(split && s.place));
  // The block straight above the signature, when it is a section: what goes over with it.
  const lastBand = bands.filter((s) => shown(s).some(({ value }) => value !== undefined)).pop();
  const carriesLast = fit.carry && signs && !split && !spec.declaration && !missingLabels.length;

  for (const section of spec.sections) {
    if (split && section.place === "table") {
      drawTable(section);
      continue;
    }
    if (split && section.place) continue;

    // A section whose every row is empty is dropped rather than printed as a
    // wall of TBD — the outstanding list below already says what is missing,
    // and repeating it as ten blank rows buries the rows that do carry
    // information.
    const rendered = shown(section).map(({ row, value }) => [row.label, value] as const);
    if (rendered.every(([, v]) => v === undefined)) continue;

    if (section.columns === 2) {
      drawPairs(section.title, rendered);
      continue;
    }

    doc.setFontSize(8.6);
    const wrappedRows = rendered.map(([, value]) => doc.splitTextToSize(value ?? TBD, CONTENT_W - LABEL_W - 2) as string[]);
    if (carriesLast && section === lastBand && y > MARGIN) {
      const h = 9.4 + wrappedRows.reduce((t, w) => t + Math.max(fit.row, w.length * fit.line + 0.8), 0) + 4 * fit.gap;
      if (y + h + 4 * fit.gap + fit.sign + 7 >= LIMIT && h + 4 * fit.gap + fit.sign + 7 < LIMIT - MARGIN) newPage();
    }

    ensure(14 + rendered.length * (fit.row + 0.2));

    sectionBar(section.title);
    y += 9.4;

    doc.setFontSize(8.6);
    rendered.forEach(([label, value], i) => {
      const wrapped = wrappedRows[i];

      ensure(wrapped.length * fit.line + 2);

      doc.setFont("helvetica", "normal");
      set(MUTED);
      doc.text(label, MARGIN + 1, y);

      doc.setFont("helvetica", value === undefined ? "italic" : "bold");
      set(value === undefined ? FAINT : INK);
      let ly = y;
      for (const line of wrapped) {
        doc.text(line, MARGIN + LABEL_W, ly);
        ly += fit.line;
      }

      y += Math.max(fit.row, wrapped.length * fit.line + 0.8);

      // A hairline between rows. Light enough to separate without ruling the
      // page into a table, which these are not.
      stroke([238, 239, 233]);
      doc.setLineWidth(0.15);
      doc.line(MARGIN + 1, y - 2.6, PAGE_W - MARGIN - 1, y - 2.6);
      doc.setLineWidth(0.2);
    });
    y += 4 * fit.gap;
  }

  if (spec.charges && data.charges?.length && !split) drawCharges(data.charges, spec.charges.title);

  // The declaration, as the band layout sets it full width.
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.6);
  const declLines = spec.declaration && !split ? (doc.splitTextToSize(spec.declaration, CONTENT_W - 4) as string[]) : [];
  const declH = declLines.length ? declLines.length * fit.declLine + 8.5 : 0;
  const SIGN_H = 4 * fit.gap + fit.sign + 7;

  // With no declaration, the outstanding list is what the signature carries over with.
  drawOutstanding((h) => fit.carry && signs && !split && !declLines.length && y > MARGIN && y + h + 6 * fit.gap + SIGN_H >= LIMIT);

  if (split) {
    drawClosing();
    drawFooters(doc, data);
    return { doc, signPushed, end: y };
  }

  // ------------------------------------------------------------ declaration
  if (declLines.length) {
    if (fit.carry && signs && y > MARGIN && y + declH + SIGN_H >= LIMIT) newPage();
    ensure(declLines.length * fit.declLine + 8);

    stroke(RULE);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    doc.setLineWidth(0.2);
    y += 4.5;

    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.6);
    set(MUTED);
    for (const line of declLines) {
      doc.text(line, MARGIN + 2, y);
      y += fit.declLine;
    }
    y += 4 * fit.gap;
  }

  // -------------------------------------------------------- signature block
  /*
    A real signature line, where this desk is the one signing.
    ------------------------------------------------------------------------
    It was one line of small print in the footer, which is where a disclaimer
    goes and not where anybody signs. A document that has to be signed should
    show the space for it.
  */
  if (signs) {
    signPushed = ensure(SIGN_H) || signPushed;
    y += 4 * fit.gap;
    y = signature(y) + 6;
  }

  drawFooters(doc, data);
  return { doc, signPushed, end: y };

  // ------------------------------------------------------------ outstanding

  /** What it still needs before it can be issued, by name, boxed: taken over with the close when `carry` says so. */
  function drawOutstanding(carry?: (h: number) => boolean) {
    if (!missingLabels.length) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    const body = missingLabels.join(" · ");
    const wrapped = doc.splitTextToSize(body, CONTENT_W - 10) as string[];
    const h = wrapped.length * 4 + 12;

    if (carry?.(h)) newPage();
    ensure(h + 4);

    fill([252, 244, 232]);
    stroke([232, 206, 170]);
    doc.roundedRect(MARGIN, y, CONTENT_W, h, 1.5, 1.5, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    set(WARN);
    doc.text(
      `STILL REQUIRED BEFORE THIS CAN BE ISSUED — ${missingLabels.length}`,
      MARGIN + 5,
      y + 5.6
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    let ly = y + 10.4;
    for (const line of wrapped) {
      doc.text(line, MARGIN + 5, ly);
      ly += 4;
    }
    y += h + 6 * fit.gap;
  }

  // ------------------------------------------------------------ split parts


  /**
   * The two columns: the parties boxed down the left, the details in a grid on
   * the right, both the height of the taller so they read as one band.
   */
  function drawSplit() {
    const LW = 66;
    const COL_GAP = 4;
    const RX = MARGIN + LW + COL_GAP;
    const RW = CONTENT_W - LW - COL_GAP;
    const STACK = 3;
    const LINE = 3.7;

    // The left: a box per party, a line per row; the first, the name, in bold.
    doc.setFontSize(8.2);
    const lefts = spec.sections
      .filter((s) => s.place === "left")
      .map((s) => {
        const lines = shown(s).flatMap(({ row, value }, i) => {
          const bold = i === 0 && Boolean(row.bare) && value !== undefined;
          const text = row.bare ? (value ?? TBD) : `${row.label}: ${value ?? TBD}`;
          doc.setFont("helvetica", bold ? "bold" : "normal");
          return text
            .split("\n")
            .flatMap((t) => doc.splitTextToSize(t, LW - 7) as string[])
            .map((t) => ({ t, bold, known: value !== undefined }));
        });
        return { title: s.title, lines, h: lines.length ? 10.2 + (lines.length - 1) * LINE + 3 : 0 };
      })
      .filter((b) => b.lines.length > 0);

    // The right: label over value, two to a line; a wide one takes the line.
    const inner = RW - 7;
    const half = (inner - 4) / 2;
    type Cell = { label: string; lines: string[]; known: boolean; h: number };
    const cell = (row: DocRow, value: string | undefined, w: number): Cell => {
      doc.setFont("helvetica", value === undefined ? "italic" : "bold");
      doc.setFontSize(7.8);
      const lines = (value ?? TBD).split("\n").flatMap((t) => doc.splitTextToSize(t, w) as string[]);
      return { label: row.label, lines, known: value !== undefined, h: 5.4 + (lines.length - 1) * 3.4 + 1.9 };
    };
    const rights = spec.sections
      .filter((s) => s.place === "right")
      .map((s) => {
        const grid: Array<{ cells: Cell[]; h: number }> = [];
        let pending: Cell | null = null;
        for (const { row, value } of shown(s)) {
          if (row.wide) {
            if (pending) grid.push({ cells: [pending], h: pending.h });
            pending = null;
            const c = cell(row, value, inner);
            grid.push({ cells: [c], h: c.h });
          } else if (pending) {
            const c = cell(row, value, half);
            grid.push({ cells: [pending, c], h: Math.max(pending.h, c.h) });
            pending = null;
          } else {
            pending = cell(row, value, half);
          }
        }
        if (pending) grid.push({ cells: [pending], h: pending.h });
        return { title: s.title, grid, h: grid.length ? 8.2 + grid.reduce((t, g) => t + g.h, 0) + 1 : 0 };
      })
      .filter((b) => b.grid.length > 0);

    const total = (bs: Array<{ h: number }>) => bs.reduce((t, b) => t + b.h, 0) + Math.max(0, bs.length - 1) * STACK;
    const H = Math.max(total(lefts), total(rights));
    // The shorter column's last box grows to meet the taller, so the two end level.
    if (lefts.length) lefts[lefts.length - 1].h += H - total(lefts);
    if (rights.length) rights[rights.length - 1].h += H - total(rights);

    ensure(H + 2);
    const top = y;

    let ly = top;
    for (const b of lefts) {
      box(MARGIN, ly, LW, b.h, b.title);
      let ty = ly + 10.2;
      doc.setFontSize(8.2);
      for (const line of b.lines) {
        doc.setFont("helvetica", line.bold ? "bold" : line.known ? "normal" : "italic");
        set(line.known ? INK : FAINT);
        doc.text(line.t, MARGIN + 3.5, ty);
        ty += LINE;
      }
      ly += b.h + STACK;
    }

    let ry = top;
    for (const b of rights) {
      box(RX, ry, RW, b.h, b.title);
      let gy = ry + 8.2;
      b.grid.forEach((g, i) => {
        g.cells.forEach((c, n) => {
          const x = RX + 3.5 + (n === 1 ? half + 4 : 0);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(6);
          set(MUTED);
          doc.text(c.label, x, gy + 2.2);
          doc.setFont("helvetica", c.known ? "bold" : "italic");
          doc.setFontSize(7.8);
          set(c.known ? INK : FAINT);
          let vy = gy + 5.4;
          for (const line of c.lines) {
            doc.text(line, x, vy);
            vy += 3.4;
          }
        });
        gy += g.h;
        if (i < b.grid.length - 1) {
          stroke([238, 239, 233]);
          doc.setLineWidth(0.15);
          doc.line(RX + 3.5, gy - 0.5, RX + RW - 3.5, gy - 0.5);
          doc.setLineWidth(0.2);
        }
      });
      ry += b.h + STACK;
    }

    y = top + H + 5 * fit.gap;
  }

  /**
   * A section as a table across the page: its rows are the columns, its values
   * the one line. The column heads say what it is, so it has no bar of its own.
   */
  function drawTable(section: DocSection) {
    const cols = section.rows.map((row) => ({ row, value: row.value(data) }));
    if (cols.every(({ value }) => value === undefined)) return;

    const weight = cols.reduce((t, c) => t + (c.row.width ?? 1), 0);
    const widths = cols.map((c) => ((c.row.width ?? 1) / weight) * CONTENT_W);
    doc.setFontSize(8);
    const cells = cols.map(({ row, value }, i) => {
      doc.setFont("helvetica", value === undefined ? "italic" : "bold");
      const text = value ?? (row.optional ? "" : TBD);
      return text.split("\n").flatMap((t) => doc.splitTextToSize(t, widths[i] - 3) as string[]);
    });
    const HEAD_H = 6;
    const cellH = Math.max(...cells.map((c) => c.length)) * 3.7 + 3.2;

    ensure(HEAD_H + cellH + 2);

    let x = MARGIN;
    cols.forEach(({ row, value }, i) => {
      const w = widths[i];
      const right = row.align === "right";
      fill(TINT);
      stroke(RULE);
      doc.setLineWidth(0.2);
      doc.rect(x, y, w, HEAD_H, "FD");
      doc.rect(x, y + HEAD_H, w, cellH);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      set(MUTED);
      doc.text(row.label, right ? x + w - 1.6 : x + 1.6, y + 4, { align: right ? "right" : "left" });
      doc.setFont("helvetica", value === undefined ? "italic" : "bold");
      doc.setFontSize(8);
      set(value === undefined ? FAINT : INK);
      let ly = y + HEAD_H + 4.3;
      for (const line of cells[i]) {
        doc.text(line, right ? x + w - 1.6 : x + 1.6, ly, { align: right ? "right" : "left" });
        ly += 3.7;
      }
      x += w;
    });
    y += HEAD_H + cellH + 5 * fit.gap;
  }

  /**
   * The charges, a line each, ruled as the line's e-invoice rules them and
   * under its heads: each line's SAC, its currency, rate and units, the amount
   * in that currency and the rate of exchange it is converted at, its taxable
   * value in rupees, central and state tax each with its rate (across states,
   * integrated tax), its amount in rupees, and the columns totalled under
   * them. Every column, whether or not this invoice needs it. A line
   * without its rate, or without a rate of exchange for its currency, shows
   * TBD where its figures go, and so do the totals: a total of some of the
   * lines is not the total. Under a bar of its own in the band layout; an
   * invoice's needs none.
   */
  function drawCharges(lines: ChargeLine[], title?: string) {
    const foreign = foreignCurrencies(lines);
    const plain = (n: number, places = 2) => n.toLocaleString("en-IN", { minimumFractionDigits: places, maximumFractionDigits: places });
    const figure = (n: number | undefined) => (n === undefined ? TBD : rupeeFigure(n));
    /** A line's tax, or a dash on a line that carries none. */
    const taxOf = (l: ChargeLine, k: keyof TaxSums) => (l.gstPercent ? figure(lineTax(l, data)?.[k]) : "-");
    /** The rate a tax is charged at on a line: half the GST for central and for state tax, the whole for integrated. */
    const rateOf = (l: ChargeLine, part: number) => (l.gstPercent ? percent(l.gstPercent * part) : "-");
    type Col = { head: string; w: number; right?: boolean; cell: (l: ChargeLine, i: number) => string; total?: keyof TaxSums };
    // Every column the line's e-invoice has, under its heads, whether or not this invoice needs it: a rupee line's ROE is a dash, an untaxed line's tax too.
    const taxCols: Col[] = interState(data)
      ? [
          { head: "Rate", w: 0.66, right: true, cell: (l) => rateOf(l, 1) },
          { head: "IGST", w: 1.1, right: true, cell: (l) => taxOf(l, "igst"), total: "igst" },
        ]
      : [
          { head: "Rate", w: 0.66, right: true, cell: (l) => rateOf(l, 0.5) },
          { head: "CGST", w: 0.95, right: true, cell: (l) => taxOf(l, "cgst"), total: "cgst" },
          { head: "Rate", w: 0.66, right: true, cell: (l) => rateOf(l, 0.5) },
          { head: "SGST", w: 0.95, right: true, cell: (l) => taxOf(l, "sgst"), total: "sgst" },
        ];
    const cols: Col[] = [
      { head: "No", w: 0.42, cell: (_, i) => String(i + 1) },
      { head: "Charge details", w: 1.95, cell: (l) => l.charge },
      { head: "HSN/SAC", w: 0.9, cell: (l) => l.sac ?? "" },
      { head: "Curr.", w: 0.72, cell: (l) => lineCurrency(l) },
      { head: "Rate / unit", w: 0.95, right: true, cell: (l) => (l.rate === undefined ? TBD : plain(l.rate)) },
      { head: "Unit", w: 0.7, right: true, cell: (l) => (l.quantity ?? 1).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) },
      {
        head: "Curr. amt",
        w: 1,
        right: true,
        cell: (l) => {
          const a = lineAmount(l);
          return a === undefined ? TBD : plain(a);
        },
      },
      {
        head: "ROE",
        w: 0.75,
        right: true,
        cell: (l) => {
          const c = lineCurrency(l);
          if (c === "INR") return "-";
          const roe = rateOfExchange(data, c);
          return roe === undefined ? TBD : roe.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
        },
      },
      { head: "Taxable amt", w: 1.2, right: true, cell: (l) => figure(lineInr(l, data)), total: "taxable" },
      ...taxCols,
      { head: "Amt in INR", w: 1.25, right: true, cell: (l) => figure(lineTax(l, data)?.total), total: "total" },
    ];
    const weight = cols.reduce((t, c) => t + c.w, 0);
    const widths = cols.map((c) => (c.w / weight) * CONTENT_W);
    const at = (c: Col, x: number, w: number) => (c.right ? x + w - 1.4 : x + 1.4);
    // The lines at their size, or smaller on a crowded invoice (onOnePage); the head and the total as they are.
    const t = fit.rows ?? 1;
    const SIZE = 7 * t;
    // Crowded, the lines closer set too, so they can stay that much larger.
    const LINE = (fit.crowded ? 3 : 3.4) * t;
    const PAD = (fit.crowded ? 1.2 : fit.gap < 1 ? 1.4 : 1.8) * t;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    const heads = cols.map((c, i) => headLines(c.head, widths[i] - 2.4));
    const HEAD_H = Math.max(...heads.map((h) => h.length)) * 2.4 + 3;

    const first = cols.findIndex((c) => c.total);
    /**
     * Where the table began on this page: its border and the rules between its
     * columns run from here. Through the total line, only between the totals,
     * so its label reads across the columns before them.
     */
    let top = y;
    const frame = (totalTop?: number) => {
      stroke(GRID);
      doc.setLineWidth(0.25);
      doc.rect(MARGIN, top, CONTENT_W, y - top);
      let x = MARGIN;
      widths.slice(0, -1).forEach((w, i) => {
        x += w;
        doc.line(x, top, x, totalTop !== undefined && i < first ? totalTop : y);
      });
      doc.setLineWidth(0.2);
    };
    const header = () => {
      top = y;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.2);
      set(INK);
      let x = MARGIN;
      cols.forEach((c, i) => {
        heads[i].forEach((t, k) => doc.text(t, at(c, x, widths[i]), y + 3.5 + k * 2.4, { align: c.right ? "right" : "left" }));
        x += widths[i];
      });
      y += HEAD_H;
      rule(MARGIN, PAGE_W - MARGIN, y);
      y += 0.8;
    };
    /** Over the page when `h` will not fit: the frame closed on this one, the header again on the next. */
    const room = (h: number) => {
      if (y + h < LIMIT) return;
      frame();
      newPage();
      header();
    };

    if (title) {
      ensure(9.4 + HEAD_H + 8);
      sectionBar(title);
      y += 9.4;
    } else ensure(HEAD_H + 12);
    header();

    lines.forEach((l, n) => {
      // The charge's name wraps; a figure is never broken over two lines.
      doc.setFont("helvetica", "normal");
      doc.setFontSize(SIZE);
      const name = doc.splitTextToSize(l.charge, widths[1] - 2.8) as string[];
      // Closer set when the page is being fitted to keep the signature on it.
      const h = name.length * LINE + PAD;
      room(h + 1);
      let x = MARGIN;
      cols.forEach((c, i) => {
        const text = c.cell(l, n);
        const tbd = text === TBD;
        doc.setFont("helvetica", tbd ? "italic" : "normal");
        doc.setFontSize(SIZE);
        set(tbd ? FAINT : INK);
        (i === 1 ? name : [text]).forEach((s, k) => doc.text(s, at(c, x, widths[i]), y + PAD / 2 + 2.45 * t + k * LINE, { align: c.right ? "right" : "left" }));
        x += widths[i];
      });
      y += h;
    });

    // The columns totalled under a rule, the label just before the first of them.
    const totals = chargeTotals(lines, data);
    const roes = foreign.map((c) => {
      const roe = rateOfExchange(data, c);
      return roe === undefined ? `1 ${c} = INR TBD` : roeFigure(c, roe);
    });
    const roeText = roes.length ? `Rates of exchange: ${roes.join("   ·   ")}` : "";
    /** Whether the rates of exchange went in the total line, before its label, where the columns have no totals. */
    let roeInTotal = false;
    const TOTAL_H = 5.6;
    // The room the page has left, as the table's empty foot: the frame runs on through it.
    y += fit.stretch ?? 0;
    room(TOTAL_H + 1);
    y += 1;
    rule(MARGIN, PAGE_W - MARGIN, y);
    const totalTop = y;
    let x = MARGIN;
    cols.forEach((c, i) => {
      if (i === first) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.4);
        set(INK);
        doc.text("Total (INR)", x - 2, y + 4, { align: "right" });
        const room = x - 2 - doc.getTextWidth("Total (INR)") - 5 - (MARGIN + 1.4);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.8);
        if (roeText && doc.getTextWidth(roeText) <= room) {
          set(MUTED);
          doc.text(roeText, MARGIN + 1.4, y + 4.2);
          roeInTotal = true;
        }
      }
      if (c.total) {
        const v = totals?.[c.total];
        doc.setFont("helvetica", v === undefined ? "italic" : "bold");
        doc.setFontSize(c.total === "total" ? 7.8 : 7.2);
        set(v === undefined ? FAINT : INK);
        doc.text(figure(v), at(c, x, widths[i]), y + 4, { align: "right" });
      }
      x += widths[i];
    });
    y += TOTAL_H;
    frame(totalTop);
    y += 4.4;

    // The total in words, as an invoice states it: what is owed cannot then be misread off the figures.
    const said = [
      ...(totals ? [{ text: `Amount in words: ${rupeesInWords(totals.total)}`, bold: true }] : []),
      ...(roeText && !roeInTotal ? [{ text: roeText, bold: false }] : []),
    ];
    for (const { text, bold } of said) {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(bold ? 7.6 : 7.2);
      set(bold ? INK : MUTED);
      for (const line of doc.splitTextToSize(text, CONTENT_W - 2) as string[]) {
        // Over the page here, the close follows it there: worth drawing again, tighter, as the signature is.
        if (ensure(5) && signs) signPushed = true;
        doc.text(line, MARGIN + 1, y);
        y += 3.8;
      }
    }
    y += 2.5 * fit.gap;
  }

  /**
   * A table's head in capitals, over as many lines as the column needs, broken
   * only between words: "RATE" squeezed is still RATE, not RAT and E. The font
   * is the caller's.
   */
  function headLines(head: string, w: number): string[] {
    const lines: string[] = [];
    for (const word of head.toUpperCase().split(" ")) {
      const last = lines.length - 1;
      if (last >= 0 && doc.getTextWidth(`${lines[last]} ${word}`) <= w) lines[last] = `${lines[last]} ${word}`;
      else lines.push(word);
    }
    return lines;
  }

  /** A rule across a ruled table, in its grey. */
  function rule(x1: number, x2: number, at: number) {
    stroke(GRID);
    doc.setLineWidth(0.25);
    doc.line(x1, at, x2, at);
    doc.setLineWidth(0.2);
  }

  /**
   * An invoice's particulars, as the trade's invoices set them out: label,
   * colon, value, in two columns down the page — the parties and the route on
   * the left, the invoice's and the shipment's particulars on the right — with
   * no boxes round them. The sections in a column follow one another with a
   * little space between; a value of several lines (a party's name over its
   * address) hangs under its first. Closer set when the page is tight, never smaller.
   */
  function drawColumns() {
    const SIZE = 7.8;
    const STEP = fit.close ? 3.15 : 3.7;
    const PART = fit.close ? 1.4 : 2.4;
    const LEFT_W = 100;
    const GAP = 8;
    type Line = { t: string; bold: boolean; known: boolean };
    const columns = [
      { place: "left", x: MARGIN, w: LEFT_W, label: 25 },
      { place: "right", x: MARGIN + LEFT_W + GAP, w: CONTENT_W - LEFT_W - GAP, label: 27 },
    ].map((c) => {
      const parts = spec.sections
        .filter((s) => s.place === c.place)
        .map((s) =>
          shown(s).map(({ row, value }) => {
            const known = value !== undefined;
            const lines = (value ?? TBD).split("\n").flatMap((part, i): Line[] => {
              const bold = Boolean(row.bold) && known && i === 0;
              doc.setFont("helvetica", bold ? "bold" : known ? "normal" : "italic");
              doc.setFontSize(SIZE);
              return (doc.splitTextToSize(part, c.w - c.label - 2) as string[]).map((t) => ({ t, bold, known }));
            });
            return { label: row.label, lines };
          })
        )
        .filter((rows) => rows.length > 0);
      const h = parts.reduce((t, rows) => t + rows.reduce((s, r) => s + r.lines.length * STEP, 0), 0) + Math.max(0, parts.length - 1) * PART;
      return { ...c, parts, h };
    });
    const H = Math.max(...columns.map((c) => c.h));
    ensure(H + 2);
    const top = y;
    for (const c of columns) {
      let cy = top + 2.8;
      c.parts.forEach((rows, n) => {
        if (n) cy += PART;
        for (const r of rows) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.2);
          set(MUTED);
          doc.text(r.label, c.x, cy);
          doc.text(":", c.x + c.label - 2, cy);
          for (const l of r.lines) {
            doc.setFont("helvetica", l.bold ? "bold" : l.known ? "normal" : "italic");
            doc.setFontSize(SIZE);
            set(l.known ? INK : FAINT);
            doc.text(l.t, c.x + c.label, cy);
            cy += STEP;
          }
        }
      });
    }
    // A clear gap before what comes under them: the charges' table.
    y = top + H + (fit.close ? 3 : 4);
  }

  /**
   * The foot of an invoice, as the trade's invoices close: the tax by SAC,
   * our PAN and GSTIN, the declaration and the terms, then the account it is
   * paid into, with the signature beside it. Crowded, it takes two columns,
   * which near halves it: the bank account beside the tax by SAC, the
   * signature beside the terms. Drawn as one block, so the signature is never
   * parted from it.
   */
  function drawInvoiceClose() {
    const STEP = 3.1;
    const lines = data.charges ?? [];
    const summary = lines.length ? taxSummary(lines, data) : undefined;
    const side = Boolean(fit.crowded);
    const SIDE_W = 66;
    const textW = side ? CONTENT_W - SIDE_W - 6 : CONTENT_W;
    // Room for heads of two lines: "TAXABLE / AMT" in a narrow column.
    const SUM_HEAD = side ? 7 : 7.4;
    const SUM_ROW = side ? 3.7 : 4.2;
    const sumH = summary ? SUM_HEAD + 1 + (summary.length + 1) * SUM_ROW + 1 + (side ? 2.5 : 3.5) : 0;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    // Our PAN, GSTIN and state, then our TAN, LUT and MSME where they were typed, as the e-invoice runs them on.
    const registered = [
      `PAN: ${COMPANY.gstin.slice(2, 12)}`,
      `GSTIN: ${COMPANY.gstin}`,
      `State code: ${stateOf(COMPANY.gstin)}`,
      ...(data.invoice?.tan ? [`TAN: ${data.invoice.tan}`] : []),
      ...(data.invoice?.lut ? [`LUT: ${data.invoice.lut}`] : []),
      ...(data.invoice?.msme ? [`MSME: ${data.invoice.msme}`] : []),
    ];
    // Packed a whole item at a time, so a line that runs over starts with the item, not a separator.
    const ours: string[] = [];
    for (const item of registered) {
      const last = ours.length - 1;
      if (last >= 0 && doc.getTextWidth(`${ours[last]}   ·   ${item}`) <= textW) ours[last] = `${ours[last]}   ·   ${item}`;
      else ours.push(item);
    }
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    const decl = spec.declaration ? (doc.splitTextToSize(spec.declaration, textW) as string[]) : [];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    const terms = (spec.terms ?? []).map((t) => doc.splitTextToSize(t, textW - 5) as string[]);
    const textH = ours.length * 3.4 + 1.2 + (decl.length ? decl.length * STEP + 1.4 : 0) + (terms.length ? 3.6 + terms.flat().length * STEP : 0) + 2.5;

    const bank: Array<[string, string]> = [
      ["A/c name", COMPANY.bank.accountName],
      ["Bank", COMPANY.bank.bank],
      ["A/c no.", COMPANY.bank.accountNo],
      ["IFSC", COMPANY.bank.ifsc],
    ];
    const BANK_W = side ? SIDE_W : 100;
    const BANK_LINE = 3.8;
    const bankH = 6.4 + bank.length * BANK_LINE + 0.6;
    const SIGN = 3 + fit.sign + 3.6;
    // Crowded: the tax by SAC level with the bank account, then the rest; without the tax, the rest beside the bank account.
    const first = side && summary ? Math.max(sumH, bankH + 2.5) : 0;
    const H = side
      ? first + Math.max(textH + 3.6, (summary ? 0 : bankH + 4) + (signs ? SIGN : 0))
      : sumH + textH + Math.max(bankH, signs ? SIGN : 0) + 5;

    // As one block: on this page whole, or over to the next whole.
    signPushed = (ensure(H + 2) && signs) || signPushed;
    const top = y;
    let ly = top;

    if (summary) {
      drawTaxSummary(summary, ly, side ? textW : 112, SUM_HEAD, SUM_ROW);
      ly += side ? first : sumH;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    set(INK);
    for (const line of ours) {
      doc.text(line, MARGIN, ly + 2.4);
      ly += 3.4;
    }
    ly += 1.2;
    if (decl.length) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7);
      set(MUTED);
      for (const line of decl) {
        doc.text(line, MARGIN, ly + 2.4);
        ly += STEP;
      }
      ly += 1.4;
    }
    if (terms.length) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      set(INK);
      doc.text("Terms:", MARGIN, ly + 2.4);
      ly += 3.6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.8);
      set(MUTED);
      terms.forEach((t, i) => {
        doc.text(`${i + 1}.`, MARGIN + 1, ly + 2.4);
        for (const line of t) {
          doc.text(line, MARGIN + 5, ly + 2.4);
          ly += STEP;
        }
      });
    }
    ly += 2.5;

    // Our bank account, ruled round as the sample has it: under the terms, or crowded, at the head of its own column.
    const bx = side ? PAGE_W - MARGIN - BANK_W : MARGIN;
    const by = side ? top : ly;
    stroke(GRID);
    doc.setLineWidth(0.25);
    doc.rect(bx, by, BANK_W, bankH);
    doc.setLineWidth(0.2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    set(INK);
    doc.text("Bank details", bx + 3, by + 4.4);
    bank.forEach(([label, value], i) => {
      const ry = by + 8.6 + i * BANK_LINE;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      set(MUTED);
      doc.text(label, bx + 3, ry);
      doc.text(":", bx + 17, ry);
      set(INK);
      doc.setFontSize(side ? 7 : 7.4);
      doc.text(value, bx + 19, ry);
    });

    // The signature beside the bank account, or crowded, at the foot of the block, beside the terms.
    if (signs) signature(side ? Math.max(top + bankH + 7, top + H - SIGN + 3) : by + 3);
    if (!side) ly += Math.max(bankH, signs ? SIGN : 0) + 3.6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    set(MUTED);
    doc.text("E. & O.E.", MARGIN, side ? ly + 1.1 : ly);

    y = top + H + 2;
  }

  /**
   * The tax by SAC and rate, ruled as the charges are, `w` wide at the left,
   * its total under it: the e-invoice's columns, central, state and
   * integrated tax each with its rate, the one not charged a dash.
   */
  function drawTaxSummary(rows: NonNullable<ReturnType<typeof taxSummary>>, top: number, w: number, HEAD: number, ROW: number) {
    const inter = interState(data);
    const rate = (r: number) => (r ? percent(r) : "-");
    type Row = (typeof rows)[number];
    type Col = { head: string; w: number; cell: (r: Row) => string; total?: string };
    const t = chargeTotals(data.charges ?? [], data)!;
    /** A tax's columns: its rate and its amount, or dashes where it is not the tax charged. */
    const tax = (head: string, charged: boolean, part: number, amount: (s: TaxSums) => number): Col[] => [
      { head: "Rate", w: 0.68, cell: (r) => (charged ? rate(r.rate * part) : "-") },
      { head, w: 1.1, cell: (r) => (charged ? rupeeFigure(amount(r)) : "-"), total: charged ? rupeeFigure(amount(t)) : "-" },
    ];
    const cols: Col[] = [
      { head: "HSN/SAC", w: 1.2, cell: (r) => r.sac || "-", total: "Total" },
      { head: "Taxable amt", w: 1.3, cell: (r) => rupeeFigure(r.taxable), total: rupeeFigure(t.taxable) },
      ...tax("CGST", !inter, 0.5, (s) => s.cgst),
      ...tax("SGST", !inter, 0.5, (s) => s.sgst),
      ...tax("IGST", inter, 1, (s) => s.igst),
      { head: "Total amt", w: 1.3, cell: (r) => rupeeFigure(r.total), total: rupeeFigure(t.total) },
    ];
    const weight = cols.reduce((s, c) => s + c.w, 0);
    const widths = cols.map((c) => (c.w / weight) * w);
    // The SAC to the left, every figure to the right.
    const cellAt = (i: number, x: number) => (i === 0 ? x + 1.4 : x + widths[i] - 1.4);
    const align = (i: number) => (i === 0 ? "left" : "right");

    let ty = top;
    const line = (cells: string[], bold: boolean, size: number, h: number) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      set(INK);
      let x = MARGIN;
      cells.forEach((s, i) => {
        doc.text(s, cellAt(i, x), ty + h - 1.3, { align: align(i) });
        x += widths[i];
      });
      ty += h;
    };
    // The heads, on two lines where a column is too narrow for one, level at their foot.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.8);
    set(INK);
    let hx = MARGIN;
    cols.forEach((c, i) => {
      const parts = headLines(c.head, widths[i] - 2.4);
      parts.forEach((p, k) => doc.text(p, cellAt(i, hx), ty + HEAD - 1.3 - (parts.length - 1 - k) * 2.4, { align: align(i) }));
      hx += widths[i];
    });
    ty += HEAD;
    rule(MARGIN, MARGIN + w, ty);
    ty += 1;
    // Closer set beside the bank account, where a lakh's figures have less room.
    const size = fit.crowded ? 6.3 : 6.8;
    for (const r of rows) line(cols.map((c) => c.cell(r)), false, size, ROW);
    ty += 1;
    rule(MARGIN, MARGIN + w, ty);
    line(cols.map((c) => c.total ?? ""), true, size, ROW);
    stroke(GRID);
    doc.setLineWidth(0.25);
    doc.rect(MARGIN, top, w, ty - top);
    let x = MARGIN;
    for (const cw of widths.slice(0, -1)) {
      x += cw;
      doc.line(x, top, x, ty);
    }
    doc.setLineWidth(0.2);
  }

  /**
   * A section as short particulars two to a line — label and value, then label
   * and value — under its bar: vessel, carrier, OBL, HBL, ports, container,
   * weight. Fifteen of them one under the other would take half a page.
   */
  function drawPairs(title: string, rendered: ReadonlyArray<readonly [string, string | undefined]>) {
    const gutter = 6;
    const half = (CONTENT_W - gutter) / 2;
    const LW = 30;
    doc.setFontSize(8.2);
    const cells = rendered.map(([label, value]) => {
      doc.setFont("helvetica", value === undefined ? "italic" : "bold");
      return { label, value, lines: doc.splitTextToSize(value ?? TBD, half - LW - 2) as string[] };
    });
    const pairs: Array<typeof cells> = [];
    for (let i = 0; i < cells.length; i += 2) pairs.push(cells.slice(i, i + 2));

    ensure(14 + Math.min(pairs.length, 3) * (fit.row + 0.2));
    sectionBar(title);
    y += 9.4;
    for (const pair of pairs) {
      const h = Math.max(fit.row, ...pair.map((c) => c.lines.length * fit.line + 0.8));
      ensure(h + 2);
      pair.forEach((c, n) => {
        const x = MARGIN + 1 + n * (half + gutter);
        doc.setFontSize(8.2);
        doc.setFont("helvetica", "normal");
        set(MUTED);
        doc.text(c.label, x, y);
        doc.setFont("helvetica", c.value === undefined ? "italic" : "bold");
        set(c.value === undefined ? FAINT : INK);
        let ly = y;
        for (const line of c.lines) {
          doc.text(line, x + LW, ly);
          ly += fit.line;
        }
      });
      y += h;
      stroke([238, 239, 233]);
      doc.setLineWidth(0.15);
      doc.line(MARGIN + 1, y - 2.6, PAGE_W - MARGIN - 1, y - 2.6);
      doc.setLineWidth(0.2);
    }
    y += 4 * fit.gap;
  }

  /**
   * The close of a split document, in two columns: what the consignee must do
   * on the left, the terms and the signature on the right. Side by side they
   * take half the height they would one under the other, which is what keeps
   * a CAN with every particular on one page; and drawn as one block, the
   * signature cannot be parted from them.
   */
  function drawClosing() {
    const DW = 70;
    const NW = CONTENT_W - DW - 8;
    const DX = MARGIN + NW + 8;

    const lead = spec.notes?.lead?.(data);
    const items = spec.notes?.lines(data).filter(Boolean) ?? [];
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    const leadLines = lead ? (doc.splitTextToSize(lead, NW) as string[]) : [];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    const itemLines = items.map((t) => doc.splitTextToSize(t, NW - 4.5) as string[]);
    const notesH =
      (leadLines.length ? leadLines.length * 3.7 + 2.4 : 0) + (items.length ? 4.6 + itemLines.flat().length * 3.5 : 0);

    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    const terms = spec.declaration ? (doc.splitTextToSize(spec.declaration, DW) as string[]) : [];
    const termsH = terms.length ? terms.length * 3.1 + 2 : 0;
    const signH = signs ? 4 + fit.sign + 3.6 : 0;
    const H = Math.max(notesH, termsH + signH) + 5;

    if (!notesH && !termsH && !signH) return;
    // As one block: on this page whole, or over to the next whole.
    signPushed = ensure(H + 2) && signs;

    stroke(RULE);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    doc.setLineWidth(0.2);
    const top = y + 4.6;

    let ny = top;
    if (leadLines.length) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      set(INK);
      for (const line of leadLines) {
        doc.text(line, MARGIN, ny);
        ny += 3.7;
      }
      ny += 2.4;
    }
    if (items.length) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      set(MUTED);
      doc.text(spec.notes!.title.toUpperCase(), MARGIN, ny);
      ny += 4.6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.8);
      set(INK);
      for (const lines of itemLines) {
        doc.text("•", MARGIN + 1, ny);
        for (const line of lines) {
          doc.text(line, MARGIN + 4.5, ny);
          ny += 3.5;
        }
      }
    }

    let dy = top;
    if (terms.length) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7);
      set(MUTED);
      for (const line of terms) {
        doc.text(line, DX, dy);
        dy += 3.1;
      }
      dy += 2;
    }
    if (signs) {
      // At the foot of the block, level with the bottom of the notes where they run longer.
      const signTop = Math.max(dy + 4, top + H - 5 - signH + 4);
      signature(signTop);
    }

    y = top - 4.6 + H + 2;
  }
}

/**
 * The footer, on every page, once every page exists.
 *
 * Drawn at the end rather than as each page fills, because "Page 1 of 3" is not
 * knowable until the third page has been added — and a document whose pages do
 * not say how many there are is one a recipient cannot tell is complete.
 */
function drawFooters(doc: jsPDF, data: DocumentData) {
  const pages = doc.getNumberOfPages();
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);

  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, FOOTER_Y, PAGE_W - MARGIN, FOOTER_Y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(FAINT[0], FAINT[1], FAINT[2]);

    doc.text(
      `System-generated by Aashish Logistics Global · ${data.sourceNote}`,
      MARGIN,
      FOOTER_Y + 4.5,
      { maxWidth: CONTENT_W - 34 }
    );
    doc.text(`Generated ${stamp} UTC`, MARGIN, FOOTER_Y + 8);
    doc.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN, FOOTER_Y + 8, { align: "right" });

    doc.setTextColor(0, 0, 0);
  }
}
