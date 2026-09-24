import { jsPDF } from "jspdf";
import type { DocSpec, DocumentData } from "./types";
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
 * ---------------------------------------------------------------------------
 */

// Spelled from docDate's month list: the "en-GB" locale now prints "Sept".
const today = () => docDate(new Date().toISOString());

export function renderDocument(spec: DocSpec, data: DocumentData): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const { ready, missingLabels } = readiness(data, spec.requires);

  const set = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);

  let y = MARGIN;

  /** Starts a new page when the next block would run into the footer. */
  const ensure = (needed: number) => {
    if (y + needed < FOOTER_Y - 6) return;
    doc.addPage();
    y = MARGIN;
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
  y += TITLE_H + 5;

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
  y += 4;

  // ---------------------------------------------------------------- parties
  /*
    Shipper and consignee in bordered boxes.
    ------------------------------------------------------------------------
    This is how every B/L, every shipping instruction and every delivery order
    in the trade is laid out, and a reader who handles these all day finds the
    consignee by looking at the top-right box before reading a word.
  */
  if (spec.parties) {
    const gap = 5;
    const colW = (CONTENT_W - gap) / 2;

    const shipper = [data.shipperName ?? TBD, `GSTIN / IEC: ${data.shipperGstinIec ?? TBD}`];
    const consignee = [
      data.consigneeName ?? TBD,
      data.consigneeAddress ?? TBD,
      data.consigneeCountry ?? TBD,
    ];

    // Both boxes take the height of the taller, so the pair reads as one band.
    const lines = (rows: string[]) =>
      rows.flatMap((r) => doc.splitTextToSize(r, colW - 7) as string[]);
    const boxH = Math.max(lines(shipper).length, lines(consignee).length) * 4.2 + 11;

    ensure(boxH + 8);

    const drawParty = (x: number, heading: string, rows: string[]) => {
      stroke(RULE);
      fill([255, 255, 255]);
      doc.roundedRect(x, y, colW, boxH, 1.5, 1.5, "FD");

      fill(TINT);
      doc.rect(x + 0.4, y + 0.4, colW - 0.8, 6, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      set(MUTED);
      doc.text(heading.toUpperCase(), x + 3.5, y + 4.4);

      let ly = y + 10.4;
      doc.setFontSize(8.6);
      for (const row of rows) {
        const known = !row.includes(TBD);
        doc.setFont("helvetica", known && row === rows[0] ? "bold" : "normal");
        set(known ? INK : FAINT);
        for (const line of doc.splitTextToSize(row, colW - 7) as string[]) {
          doc.text(line, x + 3.5, ly);
          ly += 4.2;
        }
      }
    };

    drawParty(MARGIN, "Shipper / Exporter", shipper);
    drawParty(MARGIN + colW + gap, "Consignee / Importer", consignee);
    y += boxH + 7;
  }

  // --------------------------------------------------------------- sections
  const LABEL_W = 46;
  for (const section of spec.sections) {
    // A section whose every row is empty is dropped rather than printed as a
    // wall of TBD — the outstanding list below already says what is missing,
    // and repeating it as ten blank rows buries the rows that do carry
    // information.
    const rendered = section.rows.map((r) => [r.label, r.value(data)] as const);
    if (rendered.every(([, v]) => v === undefined)) continue;

    ensure(14 + rendered.length * 5.4);

    // Section header as a tinted bar with a brand tick, so the eye can find
    // "Cargo" without reading the rows above it.
    fill(TINT);
    doc.rect(MARGIN, y, CONTENT_W, 6.4, "F");
    fill(BRAND);
    doc.rect(MARGIN, y, 1.2, 6.4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.4);
    set(MUTED);
    doc.text(section.title.toUpperCase(), MARGIN + 4, y + 4.3);
    y += 9.4;

    doc.setFontSize(8.6);
    for (const [label, value] of rendered) {
      const text = value ?? TBD;
      const wrapped = doc.splitTextToSize(text, CONTENT_W - LABEL_W - 2) as string[];

      ensure(wrapped.length * 4.4 + 2);

      doc.setFont("helvetica", "normal");
      set(MUTED);
      doc.text(label, MARGIN + 1, y);

      doc.setFont("helvetica", value === undefined ? "italic" : "bold");
      set(value === undefined ? FAINT : INK);
      let ly = y;
      for (const line of wrapped) {
        doc.text(line, MARGIN + LABEL_W, ly);
        ly += 4.4;
      }

      y += Math.max(5.2, wrapped.length * 4.4 + 0.8);

      // A hairline between rows. Light enough to separate without ruling the
      // page into a table, which these are not.
      stroke([238, 239, 233]);
      doc.setLineWidth(0.15);
      doc.line(MARGIN + 1, y - 2.6, PAGE_W - MARGIN - 1, y - 2.6);
      doc.setLineWidth(0.2);
    }
    y += 4;
  }

  // ------------------------------------------------------------ outstanding
  if (missingLabels.length) {
    const body = missingLabels.join(" · ");
    const wrapped = doc.splitTextToSize(body, CONTENT_W - 10) as string[];
    const h = wrapped.length * 4 + 12;

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
    y += h + 6;
  }

  // ------------------------------------------------------------ declaration
  if (spec.declaration) {
    const wrapped = doc.splitTextToSize(spec.declaration, CONTENT_W - 4) as string[];
    ensure(wrapped.length * 3.6 + 8);

    stroke(RULE);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    doc.setLineWidth(0.2);
    y += 4.5;

    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.6);
    set(MUTED);
    for (const line of wrapped) {
      doc.text(line, MARGIN + 2, y);
      y += 3.6;
    }
    y += 4;
  }

  // -------------------------------------------------------- signature block
  /*
    A real signature line, where this desk is the one signing.
    ------------------------------------------------------------------------
    It was one line of small print in the footer, which is where a disclaimer
    goes and not where anybody signs. A document that has to be signed should
    show the space for it.
  */
  if (spec.issuer === "desk") {
    ensure(24);
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    set(MUTED);
    doc.text("For AASHISH LOGISTICS GLOBAL", PAGE_W - MARGIN, y, { align: "right" });
    y += 13;
    stroke(RULE);
    doc.line(PAGE_W - MARGIN - 58, y, PAGE_W - MARGIN, y);
    y += 3.6;
    doc.setFontSize(7);
    set(FAINT);
    doc.text("Authorised signatory", PAGE_W - MARGIN, y, { align: "right" });
    y += 6;
  }

  drawFooters(doc, data);
  return doc;
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
