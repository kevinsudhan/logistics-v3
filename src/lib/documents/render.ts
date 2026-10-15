import { jsPDF } from "jspdf";
import type { ChargeLine, DocRow, DocSection, DocSpec, DocumentData } from "./types";
import { billed, gstinOf, stateOf, chargeTotals, foreignCurrencies, lineAmount, lineCurrency, lineGst, lineInr, rateFigure, rateOfExchange, roeFigure, rupeeFigure, rupeesInWords, statementTotal, taxLines } from "./charges";
import { documentNo, readiness } from "./data";
import {
  BRAND,
  CONTENT_W,
  docDate,
  drawLetterhead,
  FAINT,
  FOOTER_Y,
  INK,
  MARGIN,
  MUTED,
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
 * ---------------------------------------------------------------------------
 */

// Spelled from docDate's month list: the "en-GB" locale now prints "Sept".
const today = () => docDate(new Date().toISOString());

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
}

const FITS: Fit[] = [
  { gap: 1, row: 5.2, sign: 13, line: 4.4, declLine: 3.6, carry: false },
  { gap: 0.55, row: 4.6, sign: 10, line: 4.4, declLine: 3.6, carry: false },
  { gap: 0.3, row: 4.3, sign: 8, line: 4, declLine: 3.3, carry: false },
  { gap: 0.3, row: 4.3, sign: 8, line: 4, declLine: 3.3, carry: true },
];

export function renderDocument(spec: DocSpec, data: DocumentData): jsPDF {
  let doc: jsPDF | null = null;
  for (const fit of FITS) {
    const drawn = draw(spec, data, fit);
    if (!drawn.signPushed) return drawn.doc;
    doc = drawn.doc;
  }
  return doc!;
}

type Colour = [number, number, number];

function draw(spec: DocSpec, data: DocumentData, fit: Fit): { doc: jsPDF; signPushed: boolean } {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const { ready, missingLabels } = readiness(data, spec.requires, spec.check);
  const split = spec.layout === "split";
  const signs = spec.issuer === "desk";

  const set = (c: Colour) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c: Colour) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: Colour) => doc.setDrawColor(c[0], c[1], c[2]);

  const LIMIT = FOOTER_Y - 6;
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

  y = drawLetterhead(doc, y);

  // ------------------------------------------------------------------ title
  /*
    The title in a filled band.
    ------------------------------------------------------------------------
    It is the one thing a reader needs before anything else — whether this is a
    quotation or a bill of lading changes what every field below it means — and
    at 13pt bold on white it carried no more weight than a section heading.
  */
  const TITLE_H = 11;
  fill(TINT);
  doc.rect(MARGIN, y, CONTENT_W, TITLE_H, "F");
  fill(BRAND);
  doc.rect(MARGIN, y, 1.6, TITLE_H, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  set(INK);
  doc.text(spec.title, MARGIN + 5, y + TITLE_H / 2 + 1.4, {
    maxWidth: CONTENT_W - 44,
    baseline: "alphabetic",
  });

  if (!ready) {
    // A pill rather than loose red text, so it reads as a stamp on the
    // document rather than a sentence somebody added to it.
    const label = "DRAFT";
    doc.setFontSize(8.5);
    const w = doc.getTextWidth(label) + 7;
    fill([250, 235, 215]);
    stroke(WARN);
    doc.setLineWidth(0.3);
    doc.roundedRect(PAGE_W - MARGIN - w, y + 2.6, w, 5.8, 1.2, 1.2, "FD");
    set(WARN);
    doc.setFont("helvetica", "bold");
    doc.text(label, PAGE_W - MARGIN - w / 2, y + 6.6, { align: "center" });
    doc.setLineWidth(0.2);
  }
  // Never so tight that the line under the band touches it: below 4 mm "Document no" ran into the title.
  y += TITLE_H + Math.max(4, 5 * fit.gap);

  // ------------------------------------------------------------- meta strip
  /*
    Four facts in two columns, keyed and valued.
    ------------------------------------------------------------------------
    They were four sentences ("Document no: X") which is how a label looks when
    nobody decided where the value goes. Split, they line up and can be scanned.
  */
  const metaRows: Array<[string, string, string, string]> = [
    ["Document no", documentNo(spec, data), "Date issued", today()],
    [
      "Reference",
      data.reference,
      "Status",
      ready ? "Complete" : `Awaiting ${missingLabels.length} detail${missingLabels.length === 1 ? "" : "s"}`,
    ],
  ];

  doc.setFontSize(8.2);
  const midX = MARGIN + CONTENT_W / 2;
  for (const [k1, v1, k2, v2] of metaRows) {
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
  y += 4 * fit.gap;

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
    /*
      Two boxes as a B/L sets them out, or — `notifyParty` — three: the notify
      party (the forwarder at the other end) beside them, and every box with
      its address and GSTIN, as an invoice to the trade carries them.
    */
    const three = Boolean(spec.notifyParty);
    /*
      An invoice is to one of them (`billTo`): its box says so, and carries
      what an invoice's To carries besides — the state code and PAN read from
      its GSTIN, and the contact — rather than a To block repeating the box.
    */
    const toBilled = (who: "shipper" | "consignee" | "notify", heading: string, rows: string[]): [string, string[]] => {
      if (!data.billTo || data.billTo !== who) return [heading, rows];
      const tax = billed(data).tax;
      const extra = [
        ...(stateOf(tax) ? [`State code: ${stateOf(tax)}`] : []),
        ...(gstinOf(tax) ? [`PAN: ${gstinOf(tax)!.slice(2, 12)}`] : []),
        ...(data.phone ? [`Contact: ${data.phone}`] : []),
      ];
      return [`${heading} · Billed to`, [...rows, ...extra]];
    };
    const boxes: Array<[string, string[]]> = three
      ? [
          toBilled("shipper", "Shipper / Exporter", [data.shipperName ?? TBD, data.shipperAddress ?? TBD, `GSTIN / IEC: ${data.shipperGstinIec ?? TBD}`]),
          toBilled("consignee", "Consignee / Importer", [
            data.consigneeName ?? TBD,
            data.consigneeAddress ?? TBD,
            ...(data.consigneeCountry ? [data.consigneeCountry] : []),
            `GSTIN: ${data.consigneeGstin ?? TBD}`,
          ]),
          toBilled("notify", "Notify party / Forwarder", [data.notifyName ?? TBD, data.notifyAddress ?? TBD, `GSTIN: ${data.notifyGstin ?? TBD}`]),
        ]
      : [
          ["Shipper / Exporter", [data.shipperName ?? TBD, `GSTIN / IEC: ${data.shipperGstinIec ?? TBD}`]],
          ["Consignee / Importer", [data.consigneeName ?? TBD, data.consigneeAddress ?? TBD, data.consigneeCountry ?? TBD]],
        ];
    const colW = (CONTENT_W - gap * (boxes.length - 1)) / boxes.length;
    const size = three ? 7.8 : 8.6;
    const lineH = three ? 3.8 : 4.2;

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

  if (spec.charges && data.charges?.length && !split) {
    const { title, style } = spec.charges;
    drawCharges(typeof title === "function" ? title(data) : title, data.charges, style === "statement");
  }

  // The declaration, as the band layout sets it full width.
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.6);
  const declLines = spec.declaration && !split ? (doc.splitTextToSize(spec.declaration, CONTENT_W - 4) as string[]) : [];
  const declH = declLines.length ? declLines.length * fit.declLine + 8.5 : 0;
  const SIGN_H = 4 * fit.gap + fit.sign + 7;

  // ------------------------------------------------------------ outstanding
  if (missingLabels.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    const body = missingLabels.join(" · ");
    const wrapped = doc.splitTextToSize(body, CONTENT_W - 10) as string[];
    const h = wrapped.length * 4 + 12;

    // With no declaration, the outstanding list is what the signature carries over with.
    if (fit.carry && signs && !split && !declLines.length && y > MARGIN && y + h + 6 * fit.gap + SIGN_H >= LIMIT) newPage();
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

  if (split) {
    drawClosing();
    drawFooters(doc, data);
    return { doc, signPushed };
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
  return { doc, signPushed };

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
   * The charges, a line each, ruled as a table, with the totals under the
   * figures. Each line's rate is printed in the currency it was given in, and
   * converted to rupees at the invoice's rate of exchange for that currency;
   * GST and the totals are in rupees, and the rates used are printed under
   * them. The rate-of-exchange column is left out when every line is in
   * rupees, and the GST columns when no line carries GST, rather than printed
   * as columns of dashes. A line without its rate, or without a rate of
   * exchange for its currency, shows TBD where its figures go, and so do the
   * totals: a total of some of the lines is not the total.
   */
  function drawCharges(title: string, lines: ChargeLine[], statement = false) {
    const taxed = !statement && lines.some((l) => l.gstPercent);
    const foreign = foreignCurrencies(lines);
    const figure = (n: number | undefined) => (n === undefined ? TBD : rupeeFigure(n));
    type Col = { head: string; w: number; right?: boolean; cell: (l: ChargeLine, i: number) => string };
    /*
      A statement of charges, as the trade sends one: each line's volume, its
      rate per unit and currency, the rate of exchange (one for rupees), the
      amount in its own currency and in rupees, and a tick where it is taxed.
      The GST follows as lines of its own — central and state tax at half the
      rate each, or integrated tax across states — and the total includes it.
    */
    const plain = (n: number, places = 2) => n.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });
    /** A cell drawn as a tick rather than written: the PDF's own font has no check mark. */
    const TICK = "\u0001tick";
    const statementCols: Col[] = [
      { head: "S.No", w: 0.45, cell: (_, i) => String(i + 1) },
      { head: "Charge name", w: 3.4, cell: (l) => l.charge },
      { head: "Volume", w: 0.85, right: true, cell: (l) => plain(l.quantity ?? 1, 3) },
      { head: "Per unit", w: 1.05, right: true, cell: (l) => (l.rate === undefined ? TBD : plain(l.rate)) },
      { head: "Currency", w: 0.85, cell: (l) => lineCurrency(l) },
      {
        head: "ROE",
        w: 0.85,
        right: true,
        cell: (l) => {
          const roe = rateOfExchange(data, lineCurrency(l));
          return roe === undefined ? TBD : roe.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
        },
      },
      { head: "Amount", w: 1.2, right: true, cell: (l) => { const a = lineAmount(l); return a === undefined ? TBD : plain(a); } },
      { head: "In INR", w: 1.35, right: true, cell: (l) => figure(lineInr(l, data)) },
      { head: "Tax", w: 0.45, cell: (l) => (l.gstPercent ? TICK : "") },
    ];
    const cols: Col[] = statement ? statementCols : [
      { head: "#", w: 0.5, cell: (_, i) => String(i + 1) },
      { head: "Charge", w: 2.35, cell: (l) => l.charge },
      { head: "SAC", w: 0.95, cell: (l) => l.sac ?? "" },
      { head: "Basis", w: 1.3, cell: (l) => l.basis ?? "" },
      { head: "Qty", w: 0.5, right: true, cell: (l) => (l.quantity ?? 1).toLocaleString("en-US", { maximumFractionDigits: 3 }) },
      { head: "Rate", w: 1.7, right: true, cell: (l) => (l.rate === undefined ? TBD : rateFigure(lineCurrency(l), l.rate)) },
      ...(foreign.length
        ? [
            {
              head: "ROE",
              w: 0.8,
              right: true,
              cell: (l: ChargeLine) => {
                const c = lineCurrency(l);
                if (c === "INR") return "-";
                const roe = rateOfExchange(data, c);
                return roe === undefined ? TBD : roe.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
              },
            },
          ]
        : []),
      { head: "Amount (INR)", w: 1.75, right: true, cell: (l) => figure(lineInr(l, data)) },
      ...(taxed
        ? [
            { head: "GST %", w: 0.8, right: true, cell: (l: ChargeLine) => (l.gstPercent ? `${l.gstPercent}%` : "-") },
            { head: "GST (INR)", w: 1.3, right: true, cell: (l: ChargeLine) => figure(lineGst(l, data)) },
            {
              head: "Total (INR)",
              w: 1.65,
              right: true,
              cell: (l: ChargeLine) => {
                const inr = lineInr(l, data);
                return figure(inr === undefined ? undefined : inr + lineGst(l, data)!);
              },
            },
          ]
        : []),
    ];
    const weight = cols.reduce((t, c) => t + c.w, 0);
    const widths = cols.map((c) => (c.w / weight) * CONTENT_W);
    const HEAD_H = 6.4;
    const LINE = 3.6;

    const header = () => {
      let x = MARGIN;
      fill(TINT);
      stroke(RULE);
      doc.setLineWidth(0.2);
      doc.rect(MARGIN, y, CONTENT_W, HEAD_H, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.6);
      set(MUTED);
      cols.forEach((c, i) => {
        doc.text(c.head.toUpperCase(), c.right ? x + widths[i] - 1.6 : x + 1.6, y + 4.2, { align: c.right ? "right" : "left" });
        x += widths[i];
      });
      y += HEAD_H;
    };

    ensure(9.4 + HEAD_H + 8);
    sectionBar(title);
    y += 9.4;
    header();

    // Every row's cells as text: the charges, then on a statement its tax lines, numbered on from them.
    const taxes = statement ? taxLines(lines, data) : [];
    const table: string[][] = [
      ...lines.map((l, n) => cols.map((c) => c.cell(l, n))),
      ...taxes.map((t, k) => {
        const amount = t.amount === undefined ? TBD : plain(t.amount);
        const by: Record<string, string> = {
          "S.No": String(lines.length + k + 1),
          "Charge name": t.label,
          Currency: "INR",
          ROE: "1.00",
          Amount: amount,
          "In INR": figure(t.amount),
        };
        return cols.map((c) => by[c.head] ?? "");
      }),
    ];

    doc.setFontSize(7.4);
    table.forEach((row, n) => {
      const taxRow = n >= lines.length;
      const cells = cols.map((c, i) => {
        doc.setFont("helvetica", i === 1 && !taxRow ? "bold" : "normal");
        return row[i] === TICK ? [TICK] : (doc.splitTextToSize(row[i], widths[i] - 3.2) as string[]);
      });
      // Closer set when the page is being fitted to keep the signature on it.
      const h = Math.max(...cells.map((c) => c.length)) * LINE + (fit.gap < 1 ? 1.9 : 2.6);
      if (ensure(h + 1)) header();
      let x = MARGIN;
      cols.forEach((c, i) => {
        if (cells[i][0] === TICK) {
          // A check mark, drawn: short stroke down, long stroke up.
          const cx = x + widths[i] / 2 - 0.4;
          const cy = y + 3.1;
          stroke(INK);
          doc.setLineWidth(0.35);
          doc.line(cx - 1.1, cy - 0.2, cx - 0.2, cy + 0.8);
          doc.line(cx - 0.2, cy + 0.8, cx + 1.5, cy - 1.4);
          doc.setLineWidth(0.2);
          x += widths[i];
          return;
        }
        const tbd = cells[i][0] === TBD;
        doc.setFont("helvetica", tbd ? "italic" : i === 1 && !taxRow ? "bold" : "normal");
        set(tbd ? FAINT : INK);
        let ly = y + 4;
        for (const t of cells[i]) {
          doc.text(t, c.right ? x + widths[i] - 1.6 : x + 1.6, ly, { align: c.right ? "right" : "left" });
          ly += LINE;
        }
        x += widths[i];
      });
      y += h;
      stroke([238, 239, 233]);
      doc.setLineWidth(0.15);
      doc.line(MARGIN, y, PAGE_W - MARGIN, y);
      doc.setLineWidth(0.2);
    });

    // The totals, under the figures, the last in bold; the rates of exchange they were worked at beside them.
    const totals = chargeTotals(lines, data);
    // A statement's total is what it prints: the charges and its tax lines.
    const total = statement ? statementTotal(lines, data) : totals?.total;
    const rows: Array<[string, number | undefined]> = statement
      ? [["Total (INR)", total]]
      : taxed
      ? [
          ["Taxable value (INR)", totals?.taxable],
          ["GST (INR)", totals?.gst],
          ["Total (INR)", totals?.total],
        ]
      : [["Total (INR)", totals?.total]];
    ensure(rows.length * 5 + 4);
    y += 4.6;
    /** Where the rates of exchange end, when they run below the totals. */
    let roeEnd = y;
    if (foreign.length) {
      const said = foreign.map((c) => {
        const roe = rateOfExchange(data, c);
        return roe === undefined ? `1 ${c} = INR TBD` : roeFigure(c, roe);
      });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.4);
      set(MUTED);
      doc.text("Rates of exchange", MARGIN + 1, y);
      doc.setFont("helvetica", "bold");
      set(INK);
      let ry = y + 3.8;
      for (const line of doc.splitTextToSize(said.join("   ·   "), CONTENT_W - 70) as string[]) {
        doc.text(line, MARGIN + 1, ry);
        ry += 3.6;
      }
      roeEnd = ry;
    }
    const valueX = PAGE_W - MARGIN - 1.6;
    const labelX = valueX - 42;
    rows.forEach(([label, value], i) => {
      const last = i === rows.length - 1;
      doc.setFont("helvetica", last ? "bold" : "normal");
      doc.setFontSize(last ? 9 : 8.2);
      set(last ? INK : MUTED);
      doc.text(label, labelX, y, { align: "right" });
      doc.setFont("helvetica", value === undefined ? "italic" : "bold");
      set(value === undefined ? FAINT : INK);
      doc.text(figure(value), valueX, y, { align: "right" });
      y += last ? 5.4 : 4.6;
    });
    y = Math.max(y, roeEnd);

    // The total in words, as an invoice states it: what is owed cannot then be misread off the figures.
    if (total !== undefined) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.8);
      set(MUTED);
      y += 1.5;
      for (const line of doc.splitTextToSize(`Amount in words: ${rupeesInWords(total)}`, CONTENT_W - 2) as string[]) {
        // Over the page here, the close follows it there: worth drawing again, tighter, as the signature is.
        if (ensure(5) && signs) signPushed = true;
        doc.text(line, MARGIN + 1, y);
        y += 3.8;
      }
    }
    y += 4 * fit.gap;
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
