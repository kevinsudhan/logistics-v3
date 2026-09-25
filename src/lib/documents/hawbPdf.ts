import { jsPDF } from "jspdf";
import { awbTotals, chargeAmount, finalDestination, lineTotal, money, type HawbData } from "../hawb";
import { formatDate } from "../dates";

/**
 * The house air waybill, printed box for box like the IATA form.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS DRAWN, NOT RENDERED FROM THE SCREEN
 *
 * An air waybill is read by people who know where every box is — the
 * airline's acceptance desk, the handling agent, customs at destination. It
 * has to look like one: the parties down the left, the issuer and conditions
 * on the right, the routing strip, the rate line, the charge columns and the
 * two signatures. So it is drawn in vector with jsPDF, like the other
 * documents here, rather than screenshotted from the form.
 *
 * WHAT IT WILL NOT DO
 *
 * Print a total nobody computed: the charge boxes come from `awbTotals`, the
 * same arithmetic the form shows. And a draft is stamped DRAFT across the
 * page, so a draft sent to the shipper for approval can never be mistaken for
 * the original.
 * ---------------------------------------------------------------------------
 */

export interface HawbPdfInput {
  data: HawbData;
  hawbNo: string | null;
  hawbDate: string | null;
  kind: "draft" | "original";
}

const INK: [number, number, number] = [17, 24, 39];
const LABEL: [number, number, number] = [55, 65, 81];
const LINE: [number, number, number] = [60, 60, 60];

const M = 7;
const W = 210 - M * 2;

const d8 = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : formatDate(d, { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
};

export function renderHawbPdf(i: HawbPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const d = i.data;
  const t = awbTotals(d);

  const stroke = () => {
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
  };
  const label = (x: number, y: number, s: string, size = 5.4) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(LABEL[0], LABEL[1], LABEL[2]);
    doc.text(s, x, y);
  };
  const value = (x: number, y: number, s: string, opts: { size?: number; bold?: boolean; width?: number; align?: "left" | "center" | "right"; maxLines?: number } = {}) => {
    if (!s) return;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 7.6);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    const lines = opts.width ? (doc.splitTextToSize(s, opts.width) as string[]) : s.split("\n");
    const shown = opts.maxLines ? lines.slice(0, opts.maxLines) : lines;
    doc.text(shown, x, y, { align: opts.align ?? "left" });
  };
  /** A box with its label in the top-left corner and its value under it. */
  const box = (x: number, y: number, w: number, h: number, lab: string, val = "", opts: Parameters<typeof value>[3] = {}) => {
    stroke();
    doc.rect(x, y, w, h);
    if (lab) label(x + 1, y + 2.4, lab);
    const cx = opts.align === "center" ? x + w / 2 : opts.align === "right" ? x + w - 1.2 : x + 1.2;
    value(cx, y + (lab ? 6 : 4), val, { width: w - 2.4, maxLines: Math.max(1, Math.floor((h - (lab ? 4 : 1.5)) / 3.1)), ...opts });
  };

  // ---- the draft stamp, under everything else ----
  if (i.kind === "draft") {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(96);
    doc.setTextColor(232, 232, 232);
    doc.text("DRAFT", 105, 170, { align: "center", angle: 35 });
  }

  // ---- the head: MAWB prefix | departure | serial, and our number ----
  let y = M + 3;
  value(M, y, [d.airline_prefix, d.departure_code, d.mawb_serial].filter(Boolean).join("   "), { size: 10, bold: true });
  value(M + W, y, i.hawbNo ? `HAWB No. ${i.hawbNo}` : "HAWB (not yet numbered)", { size: 10, bold: true, align: "right" });
  y += 3;

  const L = W / 2;
  const R = M + L;

  // A party: its label, the account number box inset at the top right, and
  // the name and address beneath both, so a long address never runs under it.
  const party = (yy: number, lab: string, accLab: string, name: string, address: string, account: string) => {
    stroke();
    doc.rect(M, yy, L, 25);
    label(M + 1, yy + 2.4, lab);
    box(M + L - 38, yy, 38, 7, accLab, account, { size: 7 });
    value(M + 1.2, yy + 10.2, name, { size: 7.8, bold: true, width: L - 2.4, maxLines: 1 });
    value(M + 1.2, yy + 13.6, address, { size: 7, width: L - 2.4, maxLines: 4 });
  };

  party(y, "Shipper's Name and Address", "Shipper's Account Number", d.shipper_name, d.shipper_address, d.shipper_account);

  // The issuer.
  stroke();
  doc.rect(R, y, L, 25);
  label(R + 1.2, y + 3, "Not Negotiable", 6);
  value(R + 1.2, y + 8.5, "Air Waybill", { size: 13, bold: true });
  label(R + 1.2, y + 11.5, "Issued by", 5.6);
  value(R + 1.2, y + 15, d.issued_by, { size: 6.8, width: L - 2.4, maxLines: 3 });
  value(R + L - 1.2, y + 8.5, d.carrier_name, { size: 7.4, bold: true, align: "right" });
  label(R + 1.2, y + 23.8, "Copies 1, 2 and 3 of this Air Waybill are originals and have the same validity.", 5.2);
  y += 25;

  // Consignee, and the conditions.
  party(y, "Consignee's Name and Address", "Consignee's Account Number", d.consignee_name, d.consignee_address, d.consignee_account);
  stroke();
  doc.rect(R, y, L, 25);
  value(
    R + 1.2,
    y + 3,
    "It is agreed that the goods described herein are accepted in apparent good order and condition (except as noted) for carriage SUBJECT TO THE CONDITIONS OF CONTRACT ON THE REVERSE HEREOF. ALL GOODS MAY BE CARRIED BY ANY OTHER MEANS INCLUDING ROAD OR ANY OTHER CARRIER UNLESS SPECIFIC CONTRARY INSTRUCTIONS ARE GIVEN HEREON BY THE SHIPPER, AND SHIPPER AGREES THAT THE SHIPMENT MAY BE CARRIED VIA INTERMEDIATE STOPPING PLACES WHICH THE CARRIER DEEMS APPROPRIATE. THE SHIPPER'S ATTENTION IS DRAWN TO THE NOTICE CONCERNING CARRIER'S LIMITATION OF LIABILITY. Shipper may increase such limitation of liability by declaring a higher value for carriage and paying a supplemental charge if required.",
    { size: 5, width: L - 2.4 }
  );
  y += 25;

  // The agent, and the accounting information.
  box(M, y, L, 13, "Issuing Carrier's Agent Name and City", [d.agent_name, d.agent_address].filter(Boolean).join("\n"));
  box(R, y, L, 21, "Accounting Information", d.accounting_info, { bold: true });
  y += 13;
  box(M, y, L / 2, 8, "Agent's IATA Code", d.agent_iata_code);
  box(M + L / 2, y, L / 2, 8, "Account No.", d.agent_account);
  y += 8;
  box(M, y, L, 8, "Airport of Departure (Addr. of First Carrier) and Requested Routing", d.departure_airport);
  box(R, y, L, 8, "Reference Number", d.reference_number);
  y += 8;

  // The routing strip.
  const strip: Array<[number, string, string, Parameters<typeof value>[3]?]> = [
    [12, "To", d.to1],
    [30, "By First Carrier", d.by1],
    [12, "To", d.to2],
    [12, "By", d.by2],
    [12, "To", d.to3],
    [12, "By", d.by3],
    [13, "Currency", d.currency],
    [10, "CHGS Code", d.chgs_code],
    [8, "WT/VAL PPD", d.wt_val === "P" ? "X" : "", { align: "center" }],
    [8, "COLL", d.wt_val === "C" ? "X" : "", { align: "center" }],
    [8, "Other PPD", d.other === "P" ? "X" : "", { align: "center" }],
    [8, "COLL", d.other === "C" ? "X" : "", { align: "center" }],
    [25.5, "Declared Value for Carriage", d.dv_carriage],
    [25.5, "Declared Value for Customs", d.dv_customs],
  ];
  let x = M;
  for (const [w, lab, val, o] of strip) {
    box(x, y, w, 10, lab, val, { size: 7.6, ...(o ?? {}) });
    x += w;
  }
  y += 10;

  const flightDate = (f: string, dt: string) => [f, dt ? d8(dt).slice(0, 6) : ""].filter(Boolean).join(" / ");
  box(M, y, 44, 10, "Airport of Destination", d.destination_airport);
  box(M + 44, y, 30, 10, "Requested Flight / Date", flightDate(d.flight1, d.flight1_date));
  box(M + 74, y, 30, 10, "Requested Flight / Date", flightDate(d.flight2, d.flight2_date));
  box(M + 104, y, 24, 10, "Amount of Insurance", d.insurance);
  stroke();
  doc.rect(M + 128, y, W - 128, 10);
  value(
    M + 129.2,
    y + 2.6,
    "INSURANCE — If carrier offers insurance, and such insurance is requested in accordance with the conditions thereof, indicate amount to be insured in figures in box marked \"Amount of Insurance\".",
    { size: 4.8, width: W - 130.4 }
  );
  y += 10;

  // Handling information, with the PAN and SCI.
  box(M, y, W - 30, 16, "Handling Information", [d.handling_info, d.pan_number ? `PAN: ${d.pan_number}` : ""].filter(Boolean).join("\n"), { size: 7, maxLines: 4 });
  box(M + W - 30, y, 30, 16, "SCI", d.sci);
  y += 16;

  // The rate lines.
  const cols: Array<[number, string]> = [
    [15, "No. of Pieces RCP"],
    [19, "Gross Weight"],
    [8, "kg lb"],
    [11, "Rate Class"],
    [15, "Commodity Item No."],
    [19, "Chargeable Weight"],
    [17, "Rate / Charge"],
    [24, "Total"],
    [W - 128, "Nature and Quantity of Goods (incl. Dimensions or Volume)"],
  ];
  const bodyH = 40;
  x = M;
  for (const [w, lab] of cols) {
    stroke();
    doc.rect(x, y, w, 7);
    doc.rect(x, y + 7, w, bodyH);
    value(x + w / 2, y + 2.6, lab, { size: 5, width: w - 1.5, align: "center" });
    x += w;
  }
  let ry = y + 11;
  for (const r of d.rates) {
    const cells = [r.pieces, r.gross, r.unit, r.rate_class, r.commodity_item, r.chargeable, r.rate, money(lineTotal(r)) || (r.total ?? "")];
    x = M;
    cells.forEach((c, n) => {
      const w = cols[n][0];
      value(x + w / 2, ry, c, { size: 7.6, align: "center" });
      x += w;
    });
    ry += 4.2;
  }
  value(M + 129.2, y + 11, d.nature_of_goods, { size: 7, width: W - 130.4, maxLines: 11 });
  // Totals under the lines, as the form prints them.
  if (d.rates.length > 1) {
    value(M + 7.5, y + 7 + bodyH - 2, String(t.pieces), { size: 7.6, bold: true, align: "center" });
    value(M + 24.5, y + 7 + bodyH - 2, String(t.gross), { size: 7.6, bold: true, align: "center" });
    value(M + 104 + 12, y + 7 + bodyH - 2, money(t.weightCharge), { size: 7.6, bold: true, align: "center" });
  }
  y += 7 + bodyH;

  box(M, y, W, 9, "Marks & Numbers", d.marks_numbers, { size: 7, maxLines: 2 });
  y += 9;

  // ---- the charge columns (left) ----
  const half = L / 2;
  const rowH = 8.2;
  const pair = (yy: number, lab: string, pp: number | string, cc: number | string) => {
    stroke();
    doc.rect(M, yy, half, rowH);
    doc.rect(M + half, yy, half, rowH);
    // The label sits in a tab over the column line, as on the printed form.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.4);
    const tw = doc.getTextWidth(lab);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(M + L / 2 - tw / 2 - 1.2, yy + 0.4, tw + 2.4, 2.9, 0.8, 0.8, "FD");
    value(M + L / 2, yy + 2.5, lab, { size: 5.4, align: "center" });
    value(M + half - 1.5, yy + 6.6, typeof pp === "number" ? money(pp) : pp, { size: 7.6, align: "right" });
    value(M + L - 1.5, yy + 6.6, typeof cc === "number" ? money(cc) : cc, { size: 7.6, align: "right" });
  };
  const top = y;
  label(M + 1.2, y + 2.4, "Prepaid");
  label(M + L - 1.2 - doc.getTextWidth("Collect"), y + 2.4, "Collect");
  pair(y, "Weight Charge", t.prepaid.weight, t.collect.weight);
  pair((y += rowH), "Valuation Charge", t.prepaid.valuation, t.collect.valuation);
  pair((y += rowH), "Tax", t.prepaid.tax, t.collect.tax);
  pair((y += rowH), "Total Other Charges Due Agent", t.prepaid.dueAgent, t.collect.dueAgent);
  pair((y += rowH), "Total Other Charges Due Carrier", t.prepaid.dueCarrier, t.collect.dueCarrier);
  pair((y += rowH), "Total Prepaid  |  Total Collect", t.prepaid.total, t.collect.total);
  pair((y += rowH), "Currency Conversion Rate  |  CC Charges in Dest. Currency", d.conversion_rate, money(t.ccInDestCurrency));
  pair((y += rowH), "For Carrier's Use only at Destination  |  Charges at Destination", "", money(parseFloat(d.charges_at_destination) || 0));
  pair((y += rowH), "Total Collect Charges", "", money(t.totalCollectCharges));
  const bottom = y + rowH;

  // ---- other charges and the signatures (right) ----
  let yr = top;
  const others = d.other_charges
    .map((c) => {
      const amt = chargeAmount(c, t.chargeable, t.pieces);
      return `${c.name.toUpperCase()}  ${money(amt)}  ${c.due === "agent" ? "A" : "C"} / ${c.pp === "P" ? "PP" : "CC"}`;
    })
    .join("\n");
  box(R, yr, L, 24, "Other Charges", others, { size: 6.6, maxLines: 6 });
  yr += 24;

  stroke();
  doc.rect(R, yr, L, 24);
  value(
    R + 1.2,
    yr + 2.6,
    "Shipper certifies that the particulars on the face hereof are correct and that insofar as any part of the consignment contains dangerous goods, such part is properly described by name and is in proper condition for carriage by air according to the applicable Dangerous Goods Regulations.",
    { size: 5, width: L - 2.4 }
  );
  value(R + L / 2, yr + 17, d.shipper_signature, { size: 8, bold: true, align: "center" });
  doc.setLineDashPattern([0.8, 0.8], 0);
  doc.line(R + 4, yr + 19, R + L - 4, yr + 19);
  doc.setLineDashPattern([], 0);
  value(R + L / 2, yr + 22, "Signature of Shipper or his Agent", { size: 5.4, align: "center" });
  yr += 24;

  stroke();
  doc.rect(R, yr, L, bottom - yr);
  value(
    R + 1.2,
    yr + 2.6,
    "Carrier certifies that the goods described hereon are accepted for carriage subject to THE CONDITIONS OF CONTRACT ON THE REVERSE HEREOF, the goods then being in apparent good order and condition except as noted hereon.",
    { size: 5, width: L - 2.4 }
  );
  value(R + L / 2, yr + 12, d.carrier_signature, { size: 7.6, bold: true, align: "center", width: L - 4 });
  const sy = bottom - 6;
  value(R + 14, sy, d8(d.executed_on), { size: 7.6, align: "center" });
  value(R + 40, sy, d.executed_at, { size: 7.6, align: "center" });
  doc.line(R + 2, sy + 1.2, R + L - 2, sy + 1.2);
  value(R + 14, sy + 4, "Executed on (date)", { size: 5.2, align: "center" });
  value(R + 40, sy + 4, "at (place)", { size: 5.2, align: "center" });
  value(R + 74, sy + 4, "Signature of Issuing Carrier or its Agent", { size: 5.2, align: "center" });

  // ---- the foot ----
  const fy = bottom + 5;
  value(M, fy, i.kind === "original" ? "ORIGINAL 3 (FOR SHIPPER)" : "DRAFT — FOR APPROVAL, NOT AN ORIGINAL", { size: 7.6, bold: true });
  value(M + W, fy, [i.hawbNo, i.hawbDate ? `dated ${d8(i.hawbDate)}` : ""].filter(Boolean).join("  "), { size: 8.4, bold: true, align: "right" });
  value(M, fy + 4, `To ${finalDestination(d) || "—"} · ${d.departure_code || "—"} departure`, { size: 5.6 });
  return doc;
}

export function hawbFileName(i: HawbPdfInput): string {
  const no = (i.hawbNo ?? "unnumbered").replace(/[^A-Za-z0-9-]+/g, "-");
  return `HAWB-${no}${i.kind === "draft" ? "-DRAFT" : ""}.pdf`;
}

export function hawbPdfBytes(i: HawbPdfInput): Uint8Array {
  return new Uint8Array(renderHawbPdf(i).output("arraybuffer") as ArrayBuffer);
}
