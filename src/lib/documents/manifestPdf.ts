import { jsPDF } from "jspdf";
import { COMPANY } from "../company";
import { formatDate } from "../dates";
import { manifestTotals, type ManifestConsole, type ManifestLine } from "../consoleManifest";

/**
 * The console's cargo manifest as a PDF: A4 landscape, the master bill and
 * the voyage in a block at the top, a line per house bill under it, the
 * header repeated on every page and the totals at the end. PROVISIONAL across
 * the title while any house bill is not final (lib/consoleManifest.ts).
 */

const NAVY: [number, number, number] = [15, 33, 58];
const INK: [number, number, number] = [17, 24, 39];
const LABEL: [number, number, number] = [71, 85, 105];
const LINE: [number, number, number] = [120, 120, 120];
const AMBER: [number, number, number] = [150, 70, 20];

const PW = 297;
const PH = 210;
const M = 8;
const W = PW - M * 2;

const day = (iso: string | null | undefined) => (iso ? formatDate(iso.slice(0, 10), { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() : "");

const COLS: Array<{ key: string; head: string; w: number; align?: "right" | "center" }> = [
  { key: "n", head: "#", w: 7, align: "center" },
  { key: "hbl", head: "House B/L", w: 26 },
  { key: "shipper", head: "Shipper", w: 34 },
  { key: "consignee", head: "Consignee", w: 40 },
  { key: "notify", head: "Notify party", w: 26 },
  { key: "marks", head: "Marks / container", w: 22 },
  { key: "pkgs", head: "Packages", w: 17 },
  { key: "goods", head: "Description of goods", w: 43 },
  { key: "kg", head: "Gross kg", w: 17, align: "right" },
  { key: "cbm", head: "CBM", w: 13, align: "right" },
  { key: "freight", head: "Freight", w: 16, align: "center" },
  { key: "release", head: "Release", w: 20 },
];

export function renderManifestPdf(c: ManifestConsole, lines: ManifestLine[], provisional: boolean, printedOn: Date = new Date()): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const t = manifestTotals(lines);

  const text = (x: number, y: number, s: string, o: { size?: number; bold?: boolean; color?: [number, number, number]; align?: "left" | "right" | "center" } = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size ?? 7);
    const col = o.color ?? INK;
    doc.setTextColor(col[0], col[1], col[2]);
    doc.text(s, x, y, { align: o.align ?? "left" });
  };
  const stroke = () => {
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
  };

  // ---- the head, on the first page ----
  let y = M + 6;
  text(M, y, "CARGO MANIFEST", { size: 16, bold: true, color: NAVY });
  if (provisional) text(M + 62, y, "PROVISIONAL", { size: 10, bold: true, color: AMBER });
  text(M + W, y - 1.5, COMPANY.legalName.toUpperCase(), { size: 9, bold: true, color: NAVY, align: "right" });
  text(M + W, y + 2.5, COMPANY.address.join(", "), { size: 6.2, color: LABEL, align: "right" });
  y += 6;

  // ---- the master bill and the voyage ----
  const facts: Array<[string, string]> = [
    ["Console", c.console_no ?? ""],
    ["Master B/L", [c.mbl_number ?? "", c.mbl_date ? day(c.mbl_date) : ""].filter(Boolean).join("  ·  ")],
    ["Carrier", c.carrier],
    ["Vessel / voyage", [c.vessel, c.voyage].filter(Boolean).join(" / ") + (c.mother_vessel ? `  (mother: ${c.mother_vessel})` : "")],
    ["Port of loading", c.pol],
    ["Port of discharge", c.pod],
    ["Place of delivery", c.place_of_delivery],
    ["ETD / ETA", [day(c.etd), day(c.eta)].filter(Boolean).join("  →  ")],
    ["Containers", t.containers.join(", ")],
    ["Totals", `${t.bills} house B/L${t.bills === 1 ? "" : "s"} · ${t.packages.toLocaleString("en-IN")} packages · ${t.grossKg.toLocaleString("en-IN")} kg · ${t.cbm} CBM`],
  ];
  const fw = W / 5;
  const fh = 9;
  facts.forEach(([k, v], i) => {
    const x = M + (i % 5) * fw;
    const yy = y + Math.floor(i / 5) * fh;
    stroke();
    doc.rect(x, yy, fw, fh);
    text(x + 1.2, yy + 2.8, k, { size: 5.6, color: LABEL });
    const shown = (doc.splitTextToSize(v || "—", fw - 2.6) as string[]).slice(0, 2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(shown, x + 1.3, yy + 5.8);
  });
  y += fh * 2 + 4;

  // ---- the house bills ----
  const cellLines = (l: ManifestLine): Record<string, string[]> => {
    const wrap = (s: string, w: number) => s.split("\n").flatMap((p) => doc.splitTextToSize(p, w - 2.4) as string[]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.6);
    const w = Object.fromEntries(COLS.map((col) => [col.key, col.w]));
    return {
      n: [String(l.n)],
      hbl: wrap([l.hblNo || "(no B/L)", l.source === "draft" ? "DRAFT" : l.source === "job" ? "NOT SAVED" : ""].filter(Boolean).join("\n"), w.hbl),
      shipper: wrap(l.shipper, w.shipper),
      consignee: wrap(l.consignee, w.consignee),
      notify: wrap(l.notify, w.notify),
      marks: wrap([l.marks, ...l.containers].filter(Boolean).join("\n"), w.marks),
      pkgs: wrap([l.packages ?? "", l.packageType].filter((x) => x !== "").join(" "), w.pkgs),
      goods: wrap(l.description, w.goods),
      kg: [l.grossKg !== null ? l.grossKg.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : ""],
      cbm: [l.cbm !== null ? String(l.cbm) : ""],
      freight: [l.freight],
      release: wrap(l.release, w.release),
    };
  };

  const header = () => {
    let x = M;
    for (const col of COLS) {
      doc.setFillColor(241, 245, 249);
      stroke();
      doc.rect(x, y, col.w, 6, "FD");
      text(col.align === "right" ? x + col.w - 1.2 : col.align === "center" ? x + col.w / 2 : x + 1.2, y + 4, col.head, { size: 6, bold: true, color: LABEL, align: col.align ?? "left" });
      x += col.w;
    }
    y += 6;
  };
  header();

  const LH = 2.8;
  lines.forEach((l, i) => {
    const cells = cellLines(l);
    const rows = Math.max(1, ...Object.values(cells).map((v) => Math.min(v.length, 12)));
    const h = rows * LH + 2.4;
    // The last line keeps the totals company, so they never stand on a page alone.
    const need = h + (i === lines.length - 1 ? 6.5 : 0);
    if (y + need > PH - 14) {
      doc.addPage();
      y = M + 4;
      header();
    }
    let x = M;
    for (const col of COLS) {
      stroke();
      doc.rect(x, y, col.w, h);
      const v = cells[col.key].slice(0, 12);
      const bold = col.key === "hbl" || col.key === "freight";
      const warn = col.key === "hbl" && l.source !== "issued";
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(6.6);
      doc.setTextColor(INK[0], INK[1], INK[2]);
      const tx = col.align === "right" ? x + col.w - 1.2 : col.align === "center" ? x + col.w / 2 : x + 1.2;
      if (warn && v.length > 1) {
        doc.text(v.slice(0, -1), tx, y + 3, { align: col.align ?? "left" });
        text(tx, y + 3 + (v.length - 1) * LH, v[v.length - 1], { size: 6, bold: true, color: AMBER, align: col.align ?? "left" });
      } else {
        doc.text(v, tx, y + 3, { align: col.align ?? "left" });
      }
      x += col.w;
    }
    y += h;
  });

  // ---- the totals ----
  const before = (key: string) => COLS.slice(0, COLS.findIndex((c2) => c2.key === key)).reduce((s, c2) => s + c2.w, 0);
  stroke();
  doc.setFillColor(248, 250, 252);
  doc.rect(M, y, W, 6.5, "FD");
  text(M + 1.2, y + 4.3, `TOTAL: ${t.bills} HOUSE B/L${t.bills === 1 ? "" : "S"}${t.collect ? ` · ${t.collect} FREIGHT COLLECT` : ""}`, { size: 6.8, bold: true });
  text(M + before("pkgs") + 1.2, y + 4.3, `${t.packages.toLocaleString("en-IN")}`, { size: 6.8, bold: true });
  text(M + before("kg") + COLS.find((c2) => c2.key === "kg")!.w - 1.2, y + 4.3, t.grossKg.toLocaleString("en-IN", { maximumFractionDigits: 3 }), { size: 6.8, bold: true, align: "right" });
  text(M + before("cbm") + COLS.find((c2) => c2.key === "cbm")!.w - 1.2, y + 4.3, String(t.cbm), { size: 6.8, bold: true, align: "right" });
  y += 6.5;

  // ---- the foot of every page ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    text(M, PH - 6, `${COMPANY.legalName} · ${c.console_no ?? ""}${c.mbl_number ? ` · MBL ${c.mbl_number}` : ""} · printed ${day(printedOn.toISOString())}`, { size: 6, color: LABEL });
    text(M + W, PH - 6, `Page ${p} of ${pages}`, { size: 6, color: LABEL, align: "right" });
    if (provisional) text(M + W / 2, PH - 6, "PROVISIONAL — not every house B/L is final", { size: 6, bold: true, color: AMBER, align: "center" });
  }
  return doc;
}

export const manifestFileName = (c: ManifestConsole, ext: "pdf" | "xlsx") =>
  `${(c.console_no ?? "console").replace(/[\\/:*?"<>|]+/g, "-")}-manifest${c.mbl_number ? `-${c.mbl_number.replace(/[\\/:*?"<>|]+/g, "-")}` : ""}.${ext}`;

export const manifestPdfBytes = (c: ManifestConsole, lines: ManifestLine[], provisional: boolean) =>
  new Uint8Array(renderManifestPdf(c, lines, provisional).output("arraybuffer") as ArrayBuffer);
