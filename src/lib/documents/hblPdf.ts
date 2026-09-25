import { jsPDF } from "jspdf";
import { COMPANY } from "../company";
import { formatDate } from "../dates";
import { consigneeText, INSURANCE_LABEL, originalsInWords, partyLines, titleOf, totalInWords, type HblData, type ReleaseMode } from "../hbl";

/**
 * The house bill of lading, printed box for box the way a B/L is laid out
 * (085).
 *
 * ---------------------------------------------------------------------------
 * THE LAYOUT
 *
 * The standard one every forwarder's B/L follows, because the people who read
 * it — the bank checking it against a letter of credit, the consignee, the
 * agent releasing the cargo, customs — know where each box is: the parties
 * down the left; the B/L number, references and delivery agent on the right;
 * the routing strip; the particulars the shipper furnished; the total in
 * words; the freight table; freight payable at, originals, place and date of
 * issue; cargo insurance; shipped on board; and the signature for the
 * operator it is issued under. A consignee or notify party in India carries
 * its IEC and GSTIN under its address.
 *
 * WHAT IT PRINTS AS
 *
 *   draft     one page stamped DRAFT, for the shipper to check
 *   original  the originals, one page each, "ORIGINAL 1 OF 3" … — only once
 *             issued; a sea waybill has no originals and prints as itself
 *   copy      one page, "COPY — NON-NEGOTIABLE", to send anybody who needs
 *             to see it without holding title
 * ---------------------------------------------------------------------------
 */

export type HblPrint = "draft" | "original" | "copy";

export interface HblPdfInput {
  data: HblData;
  hblNo: string | null;
  release: ReleaseMode;
  originals: number;
  print: HblPrint;
}

const INK: [number, number, number] = [17, 24, 39];
const LABEL: [number, number, number] = [71, 85, 105];
const LINE: [number, number, number] = [70, 70, 70];
const NAVY: [number, number, number] = [15, 33, 58];

const M = 8;
const W = 210 - M * 2;

const day = (iso: string | null | undefined) => {
  if (!iso) return "";
  return formatDate(iso.slice(0, 10), { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() || iso;
};

const TERMS =
  "RECEIVED in apparent good order and condition, unless otherwise stated, the goods or packages said to contain goods described above, for carriage from the place of receipt or port of loading to the port of discharge or place of delivery, subject to the terms and conditions of the issuing operator's multimodal transport document. One original, duly endorsed, must be surrendered in exchange for the goods or a delivery order. In witness whereof the number of originals stated above have been signed, one of which being accomplished the others to stand void.";
const WAYBILL_TERMS =
  "RECEIVED in apparent good order and condition, unless otherwise stated, the goods described above for carriage to the port of discharge or place of delivery, subject to the terms and conditions of the issuing operator. This sea waybill is not a document of title and is non-negotiable. Delivery will be made to the named consignee, or to their authorised agent, on proof of identity and without surrender of this or any other document.";

export function renderHblPdf(i: HblPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pages =
    i.print === "original" && i.release !== "express"
      ? Array.from({ length: Math.max(1, i.originals) }, (_, n) => `ORIGINAL ${n + 1} OF ${i.originals}`)
      : [i.print === "copy" ? "COPY — NON-NEGOTIABLE" : i.print === "draft" ? "DRAFT — FOR APPROVAL" : "SEA WAYBILL — NON-NEGOTIABLE"];
  pages.forEach((label, n) => {
    if (n > 0) doc.addPage();
    drawPage(doc, i, label);
  });
  return doc;
}

function drawPage(doc: jsPDF, i: HblPdfInput, copyLabel: string) {
  const d = i.data;
  const { title, subtitle } = titleOf(i.release);

  const stroke = () => {
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
  };
  const label = (x: number, y: number, s: string, size = 5.6) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(LABEL[0], LABEL[1], LABEL[2]);
    doc.text(s, x, y);
  };
  const value = (
    x: number,
    y: number,
    s: string,
    opts: { size?: number; bold?: boolean; width?: number; align?: "left" | "center" | "right"; maxLines?: number; color?: [number, number, number] } = {}
  ) => {
    if (!s) return 0;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 7.6);
    const c = opts.color ?? INK;
    doc.setTextColor(c[0], c[1], c[2]);
    const all = s.split("\n").flatMap((l) => (opts.width ? (doc.splitTextToSize(l, opts.width) as string[]) : [l]));
    const shown = opts.maxLines ? all.slice(0, opts.maxLines) : all;
    doc.text(shown, x, y, { align: opts.align ?? "left" });
    return shown.length;
  };
  /** A box, its label top-left, its value under the label. */
  const box = (x: number, y: number, w: number, h: number, lab: string, val = "", opts: Parameters<typeof value>[3] = {}) => {
    stroke();
    doc.rect(x, y, w, h);
    if (lab) label(x + 1.2, y + 2.6, lab);
    const cx = opts.align === "center" ? x + w / 2 : opts.align === "right" ? x + w - 1.4 : x + 1.4;
    value(cx, y + (lab ? 6.2 : 4), val, { width: w - 2.8, maxLines: Math.max(1, Math.floor((h - (lab ? 4.2 : 1.5)) / 3.2)), ...opts });
  };

  // ---- stamps, under everything ----
  if (i.print !== "original") {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(i.print === "draft" ? 96 : 80);
    doc.setTextColor(236, 236, 236);
    doc.text(i.print === "draft" ? "DRAFT" : "COPY", 105, 175, { align: "center", angle: 35 });
  }

  // ---- the head ----
  let y = M;
  value(M, y + 5.5, title, { size: 16, bold: true, color: NAVY });
  label(M, y + 9.6, subtitle, 6.2);
  value(M + W, y + 4.6, i.hblNo ? `B/L No.  ${i.hblNo}` : "B/L No.  (not yet numbered)", { size: 10.5, bold: true, align: "right" });
  value(M + W, y + 9.2, copyLabel, { size: 7.4, bold: true, align: "right", color: i.print === "original" ? NAVY : [150, 70, 20] });
  y += 12;
  const issuer = [
    d.mto_registration ? `Issued under MTO Registration No. ${d.mto_registration}${d.mto_name ? ` of ${d.mto_name}` : ""}` : "MTO registration not stated",
    `by ${COMPANY.legalName.toUpperCase()}, as agent · ${COMPANY.gst}`,
    COMPANY.address.join(", "),
  ].join("\n");
  value(M, y + 1, issuer, { size: 6.4, width: W, maxLines: 3 });
  y += 9.5;

  const L = W * 0.56;
  const R = M + L;
  const RW = W - L;

  // ---- parties, and the references and agent beside them ----
  const party = (yy: number, h: number, lab: string, name: string, address: string) => {
    stroke();
    doc.rect(M, yy, L, h);
    label(M + 1.2, yy + 2.6, lab);
    const n = value(M + 1.4, yy + 6.4, name, { size: 8, bold: true, width: L - 2.8, maxLines: 2 });
    value(M + 1.4, yy + 6.4 + n * 3.3, address, { size: 7.2, width: L - 2.8, maxLines: Math.max(1, Math.floor((h - 7 - n * 3.3) / 3.1)) });
  };

  party(y, 26, "Shipper / Exporter", d.shipper_name, d.shipper_address);
  box(R, y, RW, 9, "B/L No.", i.hblNo ?? "", { bold: true, size: 9 });
  box(R, y + 9, RW / 2, 8.5, "Booking reference", d.booking_ref, { size: 7.4 });
  box(R + RW / 2, y + 9, RW / 2, 8.5, "Service", d.service_type, { size: 7.4 });
  box(R, y + 17.5, RW, 8.5, "Export references", d.export_refs, { size: 7 });
  y += 26;

  const c = consigneeText(d);
  party(y, 28, i.release === "express" ? "Consignee (named; not to order)" : "Consignee (or order)", c.name, partyLines(c.address, d.consignee_contact, d.consignee_iec, d.consignee_gstin));
  box(R, y, RW, 28, "For delivery of goods please apply to", d.delivery_agent, { size: 7 });
  y += 28;

  party(y, 22, "Notify party", d.notify_name, partyLines(d.notify_address, "", d.notify_iec, d.notify_gstin));
  box(R, y, RW, 22, "Also notify", d.also_notify, { size: 7 });
  y += 22;

  // ---- routing ----
  const cw = W / 3;
  box(M, y, cw, 10, "Pre-carriage by", d.pre_carriage_by);
  box(M + cw, y, cw, 10, "Place of receipt", d.place_of_receipt);
  box(M + 2 * cw, y, cw, 10, "Ocean vessel / Voyage", [d.vessel, d.voyage].filter(Boolean).join("  /  "), { bold: true });
  y += 10;
  box(M, y, cw, 10, "Port of loading", d.port_of_loading, { bold: true });
  box(M + cw, y, cw, 10, "Port of discharge", d.port_of_discharge, { bold: true });
  box(M + 2 * cw, y, cw, 10, "Place of delivery", [d.place_of_delivery, d.final_destination && d.final_destination !== d.place_of_delivery ? `FINAL: ${d.final_destination}` : ""].filter(Boolean).join("\n"));
  y += 10;

  // ---- the particulars ----
  const cols = [
    { w: 50, lab: "Container No. / Seal No.\nMarks and numbers" },
    { w: 28, lab: "No. and kind\nof packages" },
    { w: W - 50 - 28 - 22 - 20, lab: "Description of goods\n(said to contain)" },
    { w: 22, lab: "Gross weight\n(kg)" },
    { w: 20, lab: "Measurement\n(CBM)" },
  ];
  label(M + 1.2, y + 2.6, "PARTICULARS FURNISHED BY THE SHIPPER — CARRIED AT SHIPPER'S DECLARATION, NOT CHECKED BY THE CARRIER", 5.4);
  y += 3.6;
  let x = M;
  const headH = 7;
  stroke();
  for (const col of cols) {
    doc.setFillColor(241, 245, 249);
    doc.rect(x, y, col.w, headH, "FD");
    value(x + 1.2, y + 2.8, col.lab, { size: 5.8, color: LABEL });
    x += col.w;
  }
  y += headH;

  const bodyH = 58;
  x = M;
  for (const col of cols) {
    stroke();
    doc.rect(x, y, col.w, bodyH);
    x += col.w;
  }
  // Column 1: each box, then the marks.
  const boxLines = d.containers.map((b) => [b.container_no, b.seal_no && `SEAL ${b.seal_no}`, b.size_type].filter(Boolean).join(" / "));
  const col1 = [...boxLines, boxLines.length && d.marks_numbers ? "" : null, d.marks_numbers].filter((s) => s !== null).join("\n");
  value(M + 1.4, y + 4, col1, { size: 6.8, width: cols[0].w - 2.8, maxLines: 20 });
  // Column 2: the count.
  value(M + cols[0].w + 1.4, y + 4, [d.packages, d.package_type].filter(Boolean).join("\n"), { size: 7.4, bold: true, width: cols[1].w - 2.8, maxLines: 4 });
  // Column 3: the goods, the HS code, the clauses.
  const clauses = d.shippers_load ? ["SHIPPER'S LOAD, STOW, COUNT AND SEAL"] : [];
  const col3 = [
    d.said_to_contain ? "SAID TO CONTAIN" : null,
    d.description,
    d.hs_code ? `HS CODE: ${d.hs_code}` : null,
    clauses.length ? "" : null,
    ...clauses,
    d.remarks ? "" : null,
    d.remarks || null,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");
  value(M + cols[0].w + cols[1].w + 1.4, y + 4, col3, { size: 7.2, width: cols[2].w - 2.8, maxLines: 20 });
  // Columns 4 and 5: the totals.
  const x4 = M + cols[0].w + cols[1].w + cols[2].w;
  value(x4 + cols[3].w - 1.4, y + 4, d.gross_weight_kg, { size: 7.6, bold: true, align: "right" });
  value(x4 + cols[3].w + cols[4].w - 1.4, y + 4, d.measurement_cbm, { size: 7.6, bold: true, align: "right" });
  y += bodyH;

  box(M, y, W, 8, "Total number of containers or packages (in words)", totalInWords(d), { bold: true, size: 7.6 });
  y += 8;

  // ---- the freight table ----
  const fc = [
    { w: W - 26 * 4, lab: `Freight and charges — ${d.freight_terms === "collect" ? "FREIGHT COLLECT" : "FREIGHT PREPAID"}`, key: "charge" as const, align: "left" as const },
    { w: 26, lab: "Revenue tons", key: "revenue_tons" as const, align: "right" as const },
    { w: 26, lab: "Rate", key: "rate" as const, align: "right" as const },
    { w: 26, lab: "Prepaid", key: "prepaid" as const, align: "right" as const },
    { w: 26, lab: "Collect", key: "collect" as const, align: "right" as const },
  ];
  const lines = d.charges.filter((l) => Object.values(l).some((v) => String(v).trim())).slice(0, 4);
  const rowH = 3.8;
  const tableH = 5 + Math.max(1, lines.length) * rowH + 1;
  x = M;
  for (const col of fc) {
    stroke();
    doc.rect(x, y, col.w, tableH);
    label(x + 1.2, y + 2.8, col.lab);
    lines.forEach((l, n) => value(col.align === "right" ? x + col.w - 1.4 : x + 1.4, y + 5 + rowH * n + 2.6, l[col.key], { size: 7, align: col.align, bold: col.key !== "charge" && col.key !== "revenue_tons" }));
    x += col.w;
  }
  y += tableH;

  // ---- payable at, originals, issue ----
  const q = W / 3;
  box(M, y, q, 10, "Freight payable at", d.freight_payable_at);
  box(M + q, y, q, 10, "Number of original B/Ls", i.release === "express" ? "NIL — SEA WAYBILL" : originalsInWords(i.originals), { bold: true });
  box(M + 2 * q, y, q, 10, "Place and date of issue", [d.place_of_issue, day(d.date_of_issue)].filter(Boolean).join(", "));
  y += 10;

  // ---- cargo insurance: a tick in the box it is ----
  stroke();
  doc.rect(M, y, W, 6.5);
  label(M + 1.2, y + 4.2, "Cargo insurance through the undersigned:");
  let ix = M + 48;
  for (const k of ["not_covered", "covered"] as const) {
    stroke();
    doc.rect(ix, y + 1.8, 3, 3);
    if (d.insurance === k) value(ix + 0.55, y + 4.3, "X", { size: 7, bold: true });
    label(ix + 4.2, y + 4.2, INSURANCE_LABEL[k].toLowerCase(), 6);
    ix += 4.2 + doc.getTextWidth(INSURANCE_LABEL[k].toLowerCase()) + 8;
  }
  y += 6.5;

  const half = W / 2;
  stroke();
  doc.rect(M, y, half, 34);
  label(M + 1.2, y + 2.6, "Shipped on board");
  value(M + 1.4, y + 6.6, [day(d.on_board_date), [d.vessel, d.voyage].filter(Boolean).join(" / ")].filter(Boolean).join("   "), { bold: true, size: 7.8, width: half - 2.8 });
  value(M + 1.4, y + 11.5, i.release === "express" ? WAYBILL_TERMS : TERMS, { size: 5.3, width: half - 2.8, maxLines: 9 });

  doc.rect(M + half, y, half, 34);
  label(M + half + 1.2, y + 2.6, "Signed for the operator");
  value(M + half + 1.4, y + 7, d.mto_name ? `For and on behalf of ${d.mto_name}, as carrier` : "For and on behalf of the carrier", { size: 7, width: half - 2.8, maxLines: 2 });
  value(M + half + 1.4, y + 14, `${COMPANY.legalName.toUpperCase()}, AS AGENT`, { size: 7, bold: true, width: half - 2.8 });
  stroke();
  doc.line(M + half + 8, y + 28, M + W - 8, y + 28);
  label(M + half + half / 2 - 10, y + 31, "Authorised signatory", 6);
  y += 34;

  // ---- the foot ----
  label(M, y + 4, `${copyLabel}${i.hblNo ? ` · ${i.hblNo}` : ""} · ${d.booking_ref}`, 5.8);
  label(M + W - 50, y + 4, "Terms and conditions as per the issuing operator's MTD.", 5.4);
}

/** "HBL-26-27-0001-original.pdf": no slashes, so it saves and attaches as one name. */
export function hblFileName(i: Pick<HblPdfInput, "hblNo" | "print" | "release">): string {
  const kind = i.print === "original" && i.release === "express" ? "waybill" : i.print;
  return `${(i.hblNo ?? "HBL-draft").replace(/[\\/:*?"<>|]+/g, "-")}-${kind}.pdf`;
}

export function hblPdfBytes(i: HblPdfInput): Uint8Array {
  return new Uint8Array(renderHblPdf(i).output("arraybuffer") as ArrayBuffer);
}
