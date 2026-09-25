import { partyLines, type HblData, type ReleaseMode } from "./hbl";
import type { CellValue, Sheet } from "./xlsx";

/**
 * The console's cargo manifest, for the destination agent.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS
 *
 * One master B/L, and every house B/L under it, on one page: the carrier's
 * bill and the box, then a line per house bill — who shipped it to whom, what
 * and how much, freight prepaid or collect, and how it is released. The agent
 * breaks the box down, delivers each house bill and collects what is collect
 * against it; this is the list they work from, and what they file their own
 * manifest with at their end.
 *
 * WHERE EACH LINE COMES FROM
 *
 * The house B/L as saved — ours on an export (085), the origin agent's as
 * received on an import (088) — because that is what the consignee will
 * present. A job on the console with no B/L saved yet still gets its line,
 * from the job's own fields, and the manifest says it is provisional: a
 * manifest that quietly leaves a shipment off is worse than one that says it
 * is not final.
 *
 * Pure: the page, the PDF and the Excel sheet all draw from `manifestFrom`.
 * ---------------------------------------------------------------------------
 */

export interface ManifestConsole {
  console_no: string | null;
  direction: "export" | "import" | "cross_trade";
  mbl_number: string | null;
  mbl_date: string | null;
  carrier: string;
  vessel: string;
  voyage: string;
  mother_vessel: string;
  pol: string;
  pod: string;
  place_of_delivery: string;
  etd: string | null;
  eta: string | null;
}

/** The job's own fields, for a line with no B/L saved. */
export interface ManifestJob {
  id: string;
  enquiry_ref: string;
  bl_number: string | null;
  forwarders_bl_no: string | null;
  shipper_name: string | null;
  consignee_name: string | null;
  consignee_iec: string | null;
  consignee_gstin: string | null;
  notify_name: string | null;
  package_count: number | null;
  piece_count: number | null;
  package_type: string | null;
  cargo: string | null;
  gross_weight_kg: number | string | null;
  volume_cbm: number | string | null;
  marks_and_numbers: string | null;
  freight_terms: "prepaid" | "collect" | null;
}

/** A saved B/L: ours (house_bills) or theirs (received_house_bills). */
export interface ManifestBill {
  shipment_id: string;
  hbl_no: string | null;
  data: HblData;
  release_mode: ReleaseMode;
  originals: number;
  /** Ours: issued or draft. Theirs: final, or not yet. */
  final: boolean;
}

export type LineSource = "issued" | "draft" | "job";

export interface ManifestLine {
  n: number;
  shipmentId: string;
  ref: string;
  hblNo: string;
  shipper: string;
  consignee: string;
  notify: string;
  marks: string;
  packages: number | null;
  packageType: string;
  description: string;
  grossKg: number | null;
  cbm: number | null;
  containers: string[];
  freight: "PREPAID" | "COLLECT" | "";
  release: string;
  source: LineSource;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

export const RELEASE_SHORT: Record<ReleaseMode, (originals: number) => string> = {
  original: (n) => `${n} ORIGINAL${n === 1 ? "" : "S"}`,
  telex: () => "TELEX RELEASE",
  express: () => "SEA WAYBILL",
};

/** One line per job on the console, from its B/L where one is saved. */
export function manifestLines(jobs: ManifestJob[], bills: ManifestBill[]): ManifestLine[] {
  const byJob = new Map(bills.map((b) => [b.shipment_id, b]));
  return jobs.map((j, i) => {
    const b = byJob.get(j.id);
    if (b) {
      const d = b.data;
      return {
        n: i + 1,
        shipmentId: j.id,
        ref: j.enquiry_ref,
        hblNo: b.hbl_no ?? "",
        shipper: d.shipper_name,
        consignee: partyLines(d.consignee_name, "", d.consignee_iec, d.consignee_gstin),
        notify: d.notify_name,
        marks: d.marks_numbers,
        packages: num(d.packages),
        packageType: d.package_type,
        description: d.description,
        grossKg: num(d.gross_weight_kg),
        cbm: num(d.measurement_cbm),
        containers: d.containers.map((c) => [c.container_no, c.seal_no && `SEAL ${c.seal_no}`].filter(Boolean).join(" / ")).filter(Boolean),
        freight: d.freight_terms === "collect" ? "COLLECT" : "PREPAID",
        release: RELEASE_SHORT[b.release_mode](b.originals),
        source: b.final ? "issued" : "draft",
      };
    }
    return {
      n: i + 1,
      shipmentId: j.id,
      ref: j.enquiry_ref,
      hblNo: up(j.bl_number ?? j.forwarders_bl_no),
      shipper: up(j.shipper_name),
      consignee: partyLines(up(j.consignee_name), "", up(j.consignee_iec), up(j.consignee_gstin)),
      notify: up(j.notify_name),
      marks: up(j.marks_and_numbers),
      packages: j.package_count ?? j.piece_count ?? null,
      packageType: up(j.package_type),
      description: up(j.cargo),
      grossKg: num(j.gross_weight_kg),
      cbm: num(j.volume_cbm),
      containers: [],
      freight: j.freight_terms === "collect" ? "COLLECT" : j.freight_terms === "prepaid" ? "PREPAID" : "",
      release: "",
      source: "job",
    };
  });
}

export interface ManifestTotals {
  bills: number;
  packages: number;
  grossKg: number;
  cbm: number;
  containers: string[];
  collect: number;
}

export function manifestTotals(lines: ManifestLine[]): ManifestTotals {
  const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
  return {
    bills: lines.length,
    packages: lines.reduce((s, l) => s + (l.packages ?? 0), 0),
    grossKg: round(lines.reduce((s, l) => s + (l.grossKg ?? 0), 0), 3),
    cbm: round(lines.reduce((s, l) => s + (l.cbm ?? 0), 0), 3),
    containers: [...new Set(lines.flatMap((l) => l.containers.map((c) => c.split(" / ")[0])))],
    collect: lines.filter((l) => l.freight === "COLLECT").length,
  };
}

/**
 * What stops it being final, in words. Sending a provisional manifest is
 * normal — the agent wants the list before the last B/L is out — so these
 * are said on the page and printed as PROVISIONAL, not refused.
 */
export function manifestIssues(c: ManifestConsole, lines: ManifestLine[]): string[] {
  const out: string[] = [];
  if (!lines.length) out.push("No house bills on the console");
  if (!c.mbl_number?.trim()) out.push("No master B/L number");
  if (!c.vessel.trim()) out.push("No vessel");
  const draft = lines.filter((l) => l.source === "draft");
  const job = lines.filter((l) => l.source === "job");
  if (draft.length) out.push(`${draft.length} house B/L${draft.length === 1 ? "" : "s"} not issued yet (${draft.map((l) => l.hblNo || l.ref).join(", ")})`);
  if (job.length) out.push(`${job.length} job${job.length === 1 ? "" : "s"} with no B/L saved (${job.map((l) => l.ref).join(", ")})`);
  const noWeight = lines.filter((l) => !l.grossKg);
  if (noWeight.length) out.push(`No gross weight on ${noWeight.map((l) => l.hblNo || l.ref).join(", ")}`);
  return out;
}

export const isProvisional = (c: ManifestConsole, lines: ManifestLine[]) => manifestIssues(c, lines).length > 0;

// ---------------------------------------------------------------------------
// The mail, and the sheet
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kg = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });

export function manifestSubject(c: ManifestConsole, provisional: boolean): string {
  return [
    `[${c.console_no ?? "CONSOLE"}] ${provisional ? "PROVISIONAL " : ""}CARGO MANIFEST`,
    c.mbl_number && `MBL ${c.mbl_number}`,
    [c.vessel, c.voyage].filter(Boolean).join(" ") || null,
    [c.pol, c.pod].filter(Boolean).join("-") || null,
  ]
    .filter(Boolean)
    .join(" — ");
}

export function manifestHtml(c: ManifestConsole, lines: ManifestLine[], agentName: string | null, provisional: boolean, attached: string[]): string {
  const t = manifestTotals(lines);
  const cell = "padding:4px 10px 4px 0;vertical-align:top;border-bottom:1px solid #e5e7eb";
  const head = "padding:4px 10px 4px 0;text-align:left;color:#555;font-weight:600;border-bottom:1px solid #cbd5e1";
  return (
    `<p>${agentName ? `Dear ${esc(agentName)},` : "Dear Partner,"}</p>` +
    `<p>Please find the ${provisional ? "<strong>provisional</strong> " : ""}cargo manifest for our console <strong>${esc(c.console_no ?? "")}</strong>` +
    `${c.mbl_number ? ` under master B/L <strong>${esc(c.mbl_number)}</strong>` : ""}${attached.length ? ", attached as PDF and Excel" : ""}.</p>` +
    `<p>${esc([c.vessel, c.voyage].filter(Boolean).join(" / "))}${c.pol || c.pod ? ` · ${esc([c.pol, c.pod].filter(Boolean).join(" → "))}` : ""}` +
    `${c.etd ? ` · ETD ${esc(c.etd)}` : ""}${c.eta ? ` · ETA ${esc(c.eta)}` : ""}</p>` +
    `<table style="border-collapse:collapse;font-size:13px;margin:8px 0 12px"><tr>` +
    ["House B/L", "Consignee", "Packages", "Gross kg", "CBM", "Freight"].map((h) => `<th style="${head}">${h}</th>`).join("") +
    `</tr>` +
    lines
      .map(
        (l) =>
          `<tr><td style="${cell}">${esc(l.hblNo || l.ref)}</td><td style="${cell}">${esc(l.consignee.split("\n")[0])}</td>` +
          `<td style="${cell}">${l.packages ?? ""} ${esc(l.packageType)}</td><td style="${cell}">${l.grossKg !== null ? kg(l.grossKg) : ""}</td>` +
          `<td style="${cell}">${l.cbm ?? ""}</td><td style="${cell}">${esc(l.freight)}</td></tr>`
      )
      .join("") +
    `<tr><td style="${cell};font-weight:600">${t.bills} house bill${t.bills === 1 ? "" : "s"}</td><td style="${cell}"></td>` +
    `<td style="${cell};font-weight:600">${t.packages}</td><td style="${cell};font-weight:600">${kg(t.grossKg)}</td><td style="${cell};font-weight:600">${t.cbm}</td><td style="${cell}"></td></tr>` +
    `</table>` +
    (t.collect ? `<p><strong>${t.collect} house bill${t.collect === 1 ? " is" : "s are"} freight collect:</strong> please release against payment.</p>` : "") +
    (provisional ? `<p>This manifest is provisional; we will send the final one once every house B/L is issued.</p>` : "") +
    `<p>Kindly acknowledge receipt.</p>`
  );
}

export function manifestSheet(c: ManifestConsole, lines: ManifestLine[], provisional: boolean): Sheet {
  const t = manifestTotals(lines);
  const rows: CellValue[][] = lines.map((l) => [
    l.n,
    l.hblNo,
    l.shipper,
    l.consignee,
    l.notify,
    l.marks,
    l.packages,
    l.packageType,
    l.description,
    l.grossKg,
    l.cbm,
    l.containers.join("\n"),
    l.freight,
    l.release,
    l.ref,
  ]);
  rows.push([null, `${t.bills} house bills`, null, null, null, null, t.packages, null, null, t.grossKg, t.cbm, null, null, null, null]);
  return {
    name: "Manifest",
    columns: [
      { header: "#", width: 4, kind: "center" },
      { header: "House B/L", width: 18, kind: "key" },
      { header: "Shipper", width: 28, kind: "wrap" },
      { header: "Consignee", width: 32, kind: "wrap" },
      { header: "Notify", width: 24, kind: "wrap" },
      { header: "Marks", width: 14, kind: "wrap" },
      { header: "Packages", width: 10, kind: "number" },
      { header: "Kind", width: 10 },
      { header: "Description", width: 30, kind: "wrap" },
      { header: "Gross kg", width: 11, kind: "number" },
      { header: "CBM", width: 9, kind: "number" },
      { header: "Container / seal", width: 22, kind: "wrap" },
      { header: "Freight", width: 10, kind: "center" },
      { header: "Release", width: 14 },
      { header: "Our ref", width: 13 },
    ],
    rows,
    report: {
      title: `${provisional ? "PROVISIONAL " : ""}CARGO MANIFEST — ${c.console_no ?? ""}`,
      lines: [
        [c.mbl_number && `MBL ${c.mbl_number}`, c.carrier, [c.vessel, c.voyage].filter(Boolean).join(" / ")].filter(Boolean).join(" · "),
        [[c.pol, c.pod].filter(Boolean).join(" → "), c.etd && `ETD ${c.etd}`, c.eta && `ETA ${c.eta}`].filter(Boolean).join(" · "),
      ].filter(Boolean),
      freezeColumns: 2,
      footer: `Aashish Logistics Global · ${c.console_no ?? ""}`,
    },
  };
}
