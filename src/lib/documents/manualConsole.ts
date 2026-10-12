import { COMPANY } from "../company";
import { emptyHbl, type HblData } from "../hbl";
import type { ManifestConsole, ManifestLine } from "../consoleManifest";
import type { ConsoleBox, MasterConsole, SiTerms } from "../masterBill";
import type { ImportConsole } from "../importMaster";
import type { StuffedBox, StuffedHouse, StuffingConsole } from "../stuffingReport";
import type { OutturnConsole, OutturnHouse } from "../outturn";
import { manifestFileName, renderManifestPdf } from "./manifestPdf";
import { masterSiFileName, renderMasterSiPdf } from "./masterSiPdf";
import { cfsNominationFileName, renderCfsNominationPdf } from "./cfsNominationPdf";
import { renderStuffingReportPdf, stuffingReportFileName } from "./stuffingReportPdf";
import { outturnFileName, renderOutturnReportPdf } from "./outturnReportPdf";
import {
  emptyRequired,
  lines,
  parseNumber,
  text,
  type FormDoc,
  type ManualField,
  type ManualRow,
  type ManualTable,
  type ManualValues,
} from "./manualForm";

/**
 * The console's paper, typed in by hand (Manual documents).
 *
 * ---------------------------------------------------------------------------
 * THE SAME RENDERERS, FED FROM A FORM
 *
 * Each of these is drawn by the function the Consoles page already uses, so a
 * manifest typed in here is laid out exactly like one built from a console's
 * jobs. What is new is only the adapter: what was typed, as the shape that
 * function takes.
 *
 * ONE CONSOLE, TYPED ONCE
 *
 * The five share their details — the console number, the vessel, the master
 * B/L, the boxes — the way they share them on a real console. Typing the
 * vessel for the stuffing report puts it on the manifest too.
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------- the fields

const field = (key: string, label: string, more: Partial<ManualField> = {}): ManualField => ({ key, label, ...more });
const date = (key: string, label: string, more: Partial<ManualField> = {}) => field(key, label, { input: "date", ...more });
const num = (key: string, label: string, more: Partial<ManualField> = {}) => field(key, label, { input: "number", ...more });
const req = (f: ManualField): ManualField => ({ ...f, required: true });

const F = {
  console_no: field("console_no", "Console number", { placeholder: "CON/26-27/0012" }),
  carrier: field("carrier", "Shipping line", { placeholder: "MAERSK" }),
  coload: field("coload", "Space bought from a co-loader", { input: "check", hint: "On a co-load the instruction goes to the co-loader and states only the cargo." }),
  coloader: field("coloader", "Co-loader"),
  carrier_booking_no: field("carrier_booking_no", "Carrier booking number"),
  mbl_number: field("mbl_number", "Master B/L number"),
  mbl_date: date("mbl_date", "Master B/L date"),
  vessel: field("vessel", "Vessel"),
  voyage: field("voyage", "Voyage"),
  mother_vessel: field("mother_vessel", "Mother vessel", { hint: "Where a feeder carries the box to the main line." }),
  pol: field("pol", "Port of loading", { placeholder: "CHENNAI" }),
  pod: field("pod", "Port of discharge", { placeholder: "JEBEL ALI" }),
  place_of_delivery: field("place_of_delivery", "Place of delivery"),
  etd: date("etd", "ETD"),
  eta: date("eta", "ETA"),
  cutoff_date: date("cutoff_date", "Cut-off"),
  igm_no: field("igm_no", "IGM number"),
  igm_date: date("igm_date", "IGM date"),
  cfs_name: field("cfs_name", "CFS"),
  stuffed_on: date("stuffed_on", "Stuffed on"),
  destuffed_on: date("destuffed_on", "Destuffed on"),
  our_name: field("our_name", "Signed for", { placeholder: COMPANY.legalName, hint: `Left blank, ${COMPANY.legalName}.` }),

  shipper_name: field("shipper_name", "Shipper"),
  shipper_address: field("shipper_address", "Shipper's address", { input: "textarea", wide: true }),
  consignee_name: field("consignee_name", "Consignee"),
  consignee_address: field("consignee_address", "Consignee's address", { input: "textarea", wide: true }),
  notify_name: field("notify_name", "Notify party"),
  notify_address: field("notify_address", "Notify party's address", { input: "textarea", wide: true }),
  marks_numbers: field("marks_numbers", "Marks and numbers", { input: "textarea", wide: true }),
  description: field("description", "Description of goods", { input: "textarea", wide: true, placeholder: "AS PER ATTACHED LIST" }),
  packages: num("packages", "Packages", { hint: "Left blank, the boxes' total." }),
  package_type: field("package_type", "Kind of packages", { placeholder: "PACKAGES" }),
  gross_weight_kg: num("gross_weight_kg", "Gross weight (kg)", { hint: "Left blank, the boxes' total." }),
  measurement_cbm: num("measurement_cbm", "Measurement (CBM)", { hint: "Left blank, the boxes' total." }),
  service_type: field("service_type", "Service", { placeholder: "CFS/CFS" }),
  shippers_load: field("shippers_load", "Shipper's load, stow, count and seal", { input: "check" }),
  freight_terms: field("freight_terms", "Freight", {
    input: "select",
    options: [
      { value: "prepaid", label: "Prepaid" },
      { value: "collect", label: "Collect" },
    ],
  }),
  freight_payable_at: field("freight_payable_at", "Freight payable at"),
  remarks: field("remarks", "Remarks for the line", { input: "textarea", wide: true, placeholder: "Please show the HS codes · Clean on board" }),
};

// ---------------------------------------------------------------- the tables

/** The console's boxes. One list, read by the SI, the CFS letter, the stuffing and the outturn. */
const BOX_COLUMNS = [
  field("container_no", "Container no.", { placeholder: "PCIU1234567" }),
  field("size_type", "Size / type", { placeholder: "40HC" }),
  field("seal_no", "Seal no."),
  num("packages", "Packages"),
  num("gross_kg", "Gross kg"),
  num("cbm", "CBM"),
];
const boxes = (columns = BOX_COLUMNS): ManualTable => ({
  key: "boxes",
  label: "Containers",
  lineLabel: "Container",
  columns,
  addLabel: "Add a container",
});
const BOXES = boxes();
/** The same boxes, where only which box and its seal matter. */
const BOXES_SEALED = boxes(BOX_COLUMNS.slice(0, 3));

const MANIFEST_LINES: ManualTable = {
  key: "manifest_lines",
  label: "House bills",
  lineLabel: "House bill",
  addLabel: "Add a house bill",
  hint: "A line per house bill. Any marked Draft prints the manifest as PROVISIONAL.",
  columns: [
    field("hbl_no", "House B/L"),
    field("status", "B/L status", {
      input: "select",
      options: [
        { value: "issued", label: "Issued" },
        { value: "draft", label: "Draft" },
      ],
    }),
    field("shipper", "Shipper"),
    field("consignee", "Consignee"),
    field("notify", "Notify party"),
    field("marks", "Marks"),
    field("containers", "Container(s)", { placeholder: "PCIU1234567 / 40HC", hint: "More than one: separate with commas." }),
    num("packages", "Packages"),
    field("package_type", "Kind", { placeholder: "CARTONS" }),
    field("description", "Description of goods"),
    num("gross_kg", "Gross kg"),
    num("cbm", "CBM"),
    field("freight", "Freight", {
      input: "select",
      options: [
        { value: "", label: "Not stated" },
        { value: "PREPAID", label: "Prepaid" },
        { value: "COLLECT", label: "Collect" },
      ],
    }),
    field("release", "Release", { placeholder: "3 ORIGINALS · TELEX RELEASE" }),
  ],
};

const STUFFING_LINES: ManualTable = {
  key: "stuffing_lines",
  label: "Houses stuffed",
  lineLabel: "House",
  addLabel: "Add a house",
  hint: "Each house under the container it went into. A house with no container prints as not in a box yet.",
  columns: [
    field("container_no", "Container no."),
    field("ref", "Job reference"),
    field("hbl_no", "House B/L"),
    field("shipper", "Shipper"),
    field("marks", "Marks"),
    num("packages", "Packages"),
    field("package_type", "Kind", { placeholder: "CARTONS" }),
    num("kg", "Gross kg"),
    num("cbm", "CBM"),
    num("declared", "Declared packages"),
    num("received", "Received at CFS"),
    field("condition", "Condition", { placeholder: "GOOD" }),
  ],
};

const OUTTURN_LINES: ManualTable = {
  key: "outturn_lines",
  label: "Houses landed",
  lineLabel: "House",
  addLabel: "Add a house",
  hint: "Manifested against landed: a house landed short, over or damaged is reported as such.",
  columns: [
    field("ref", "Job reference"),
    field("hbl_no", "House B/L"),
    field("consignee", "Consignee"),
    num("manifested", "Manifested packages"),
    field("package_type", "Kind", { placeholder: "CARTONS" }),
    num("landed", "Landed packages"),
    num("landed_kg", "Landed kg"),
    field("condition", "Condition", {
      input: "select",
      options: [
        { value: "", label: "Not tallied" },
        { value: "good", label: "Good" },
        { value: "short", label: "Short" },
        { value: "damaged", label: "Damaged" },
        { value: "wet", label: "Wet" },
      ],
    }),
    field("remarks", "Remarks"),
  ],
};

// ---------------------------------------------------------------- the adapters

const orNull = (s: string) => s || null;
const n0 = (s: string | undefined) => parseNumber(s) ?? 0;
const nNull = (s: string | undefined) => parseNumber(s) ?? null;
const sum = (rows: ManualRow[], key: string) => Math.round(rows.reduce((t, r) => t + n0(r[key]), 0) * 1000) / 1000;
/** A total typed in, or the boxes' own where nothing was. */
const totalOr = (typed: string, rows: ManualRow[], key: string) =>
  typed || (rows.some((r) => parseNumber(r[key]) !== undefined) ? String(sum(rows, key)) : "");
const boxKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function manifestInput(v: ManualValues): { console: ManifestConsole; lines: ManifestLine[]; provisional: boolean } {
  const ls = lines(v, "manifest_lines");
  return {
    console: {
      console_no: orNull(text(v, "console_no")),
      direction: "export",
      mbl_number: orNull(text(v, "mbl_number")),
      mbl_date: orNull(text(v, "mbl_date")),
      carrier: text(v, "carrier"),
      vessel: text(v, "vessel"),
      voyage: text(v, "voyage"),
      mother_vessel: text(v, "mother_vessel"),
      pol: text(v, "pol"),
      pod: text(v, "pod"),
      place_of_delivery: text(v, "place_of_delivery"),
      etd: orNull(text(v, "etd")),
      eta: orNull(text(v, "eta")),
    },
    lines: ls.map((r, i) => ({
      n: i + 1,
      shipmentId: "",
      ref: "",
      hblNo: (r.hbl_no ?? "").trim(),
      shipper: (r.shipper ?? "").trim(),
      consignee: (r.consignee ?? "").trim(),
      notify: (r.notify ?? "").trim(),
      marks: (r.marks ?? "").trim(),
      packages: nNull(r.packages),
      packageType: (r.package_type ?? "").trim(),
      description: (r.description ?? "").trim(),
      grossKg: nNull(r.gross_kg),
      cbm: nNull(r.cbm),
      containers: (r.containers ?? "").split(",").map((c) => c.trim()).filter(Boolean),
      freight: r.freight === "PREPAID" || r.freight === "COLLECT" ? r.freight : "",
      release: (r.release ?? "").trim(),
      source: r.status === "draft" ? "draft" : "issued",
    })),
    provisional: ls.some((r) => r.status === "draft"),
  };
}

export function masterSiInput(v: ManualValues): { console: MasterConsole; si: HblData; terms: SiTerms } {
  const bx = lines(v, "boxes");
  const coload = text(v, "coload") === "yes";
  const freight = text(v, "freight_terms") === "collect" ? "collect" : "prepaid";
  const parties = {
    shipper_name: text(v, "shipper_name"),
    shipper_address: text(v, "shipper_address"),
    consignee_name: text(v, "consignee_name"),
    consignee_address: text(v, "consignee_address"),
    notify_name: text(v, "notify_name"),
    notify_address: text(v, "notify_address"),
  };
  return {
    console: {
      console_no: orNull(text(v, "console_no")),
      direction: "export",
      carrier: text(v, "carrier"),
      carrier_booking_no: text(v, "carrier_booking_no"),
      mbl_number: orNull(text(v, "mbl_number")),
      vessel: text(v, "vessel"),
      voyage: text(v, "voyage"),
      pol: text(v, "pol"),
      pod: text(v, "pod"),
      place_of_delivery: text(v, "place_of_delivery"),
      etd: orNull(text(v, "etd")),
      cutoff_date: orNull(text(v, "cutoff_date")),
      coload,
      coloader: text(v, "coloader"),
    },
    si: {
      ...emptyHbl(),
      ...parties,
      booking_ref: text(v, "carrier_booking_no"),
      vessel: text(v, "vessel"),
      voyage: text(v, "voyage"),
      port_of_loading: text(v, "pol"),
      port_of_discharge: text(v, "pod"),
      place_of_delivery: text(v, "place_of_delivery"),
      service_type: text(v, "service_type"),
      containers: bx.map((b) => ({
        container_no: (b.container_no ?? "").trim(),
        seal_no: (b.seal_no ?? "").trim(),
        size_type: (b.size_type ?? "").trim(),
        packages: (b.packages ?? "").trim(),
        package_type: "",
        gross_kg: (b.gross_kg ?? "").trim(),
        cbm: (b.cbm ?? "").trim(),
      })),
      marks_numbers: text(v, "marks_numbers"),
      packages: totalOr(text(v, "packages"), bx, "packages"),
      package_type: text(v, "package_type"),
      description: text(v, "description"),
      gross_weight_kg: totalOr(text(v, "gross_weight_kg"), bx, "gross_kg"),
      measurement_cbm: totalOr(text(v, "measurement_cbm"), bx, "cbm"),
      shippers_load: text(v, "shippers_load") === "yes",
      freight_terms: freight,
      freight_payable_at: text(v, "freight_payable_at"),
    },
    terms: {
      ...parties,
      freight_terms: freight,
      freight_payable_at: text(v, "freight_payable_at"),
      description: text(v, "description"),
      marks_numbers: text(v, "marks_numbers"),
      remarks: text(v, "remarks"),
    },
  };
}

export function cfsNominationInput(v: ManualValues): { console: ImportConsole; boxes: ConsoleBox[]; cfs: string; ourName: string } {
  return {
    console: {
      console_no: orNull(text(v, "console_no")),
      coload: text(v, "coload") === "yes",
      carrier: text(v, "carrier"),
      mbl_number: orNull(text(v, "mbl_number")),
      mbl_date: orNull(text(v, "mbl_date")),
      vessel: text(v, "vessel"),
      voyage: text(v, "voyage"),
      pol: text(v, "pol"),
      pod: text(v, "pod"),
      eta: orNull(text(v, "eta")),
      igm_no: text(v, "igm_no"),
      igm_date: orNull(text(v, "igm_date")),
      // The import desk's own progress; the letter prints none of it.
      mbl_copy_at: null,
      mbl_release: null,
      release_in_hand_at: null,
      release_in_hand_ref: "",
      line_invoice_no: "",
      line_charges_inr: null,
      line_paid_at: null,
      line_do_no: "",
      line_do_at: null,
      line_do_valid_till: null,
      cfs_name: text(v, "cfs_name"),
      cfs_nominated_at: null,
      cfs_nominated_to: "",
      destuffed_on: orNull(text(v, "destuffed_on")),
    },
    boxes: lines(v, "boxes")
      .filter((b) => (b.container_no ?? "").trim())
      .map((b) => ({
        container_no: b.container_no.trim(),
        size_type: (b.size_type ?? "").trim(),
        seal_no: (b.seal_no ?? "").trim(),
        packages: n0(b.packages),
        gross_kg: n0(b.gross_kg),
        cbm: n0(b.cbm),
        houses: 0,
      })),
    cfs: text(v, "cfs_name"),
    ourName: text(v, "our_name") || COMPANY.legalName,
  };
}

/**
 * The stuffing report: each house under the box it went into.
 *
 * The boxes come from the container list, in its order, with their sizes and
 * seals; a house naming a box that is not on the list gets one of its own, so
 * nothing typed is dropped. A house with no box at all goes under "not in a
 * box yet", as on a console. A box's totals are its houses' — or, with no
 * houses in it, what was typed against the box.
 */
export function stuffingInput(v: ManualValues): { console: StuffingConsole; boxes: StuffedBox[]; stuffedOn: string | null } {
  const order: StuffedBox[] = [];
  const byKey = new Map<string, StuffedBox>();
  const boxFor = (containerNo: string, sizeType = "", sealNo = "") => {
    const k = boxKey(containerNo);
    let b = byKey.get(k);
    if (!b) {
      b = { containerNo: containerNo.trim(), sizeType: sizeType.trim(), sealNo: sealNo.trim(), houses: [], packages: 0, kg: 0, cbm: 0 };
      byKey.set(k, b);
      order.push(b);
    }
    return b;
  };
  const typed = new Map<StuffedBox, ManualRow>();
  for (const r of lines(v, "boxes")) {
    if (!(r.container_no ?? "").trim()) continue;
    typed.set(boxFor(r.container_no, r.size_type, r.seal_no), r);
  }
  for (const r of lines(v, "stuffing_lines")) {
    const house: StuffedHouse = {
      shipmentId: "",
      ref: (r.ref ?? "").trim(),
      hblNo: (r.hbl_no ?? "").trim(),
      shipper: (r.shipper ?? "").trim(),
      marks: (r.marks ?? "").trim(),
      packages: n0(r.packages),
      packageType: (r.package_type ?? "").trim(),
      kg: n0(r.kg),
      cbm: n0(r.cbm),
      declaredPkgs: nNull(r.declared),
      receivedPkgs: nNull(r.received),
      condition: (r.condition ?? "").trim(),
    };
    boxFor(r.container_no ?? "").houses.push(house);
  }
  for (const b of order) {
    const r = typed.get(b);
    const round = (x: number) => Math.round(x * 1000) / 1000;
    b.packages = b.houses.length ? b.houses.reduce((t, h) => t + h.packages, 0) : n0(r?.packages);
    b.kg = round(b.houses.length ? b.houses.reduce((t, h) => t + h.kg, 0) : n0(r?.gross_kg));
    b.cbm = round(b.houses.length ? b.houses.reduce((t, h) => t + h.cbm, 0) : n0(r?.cbm));
  }
  return {
    console: {
      console_no: orNull(text(v, "console_no")),
      carrier: text(v, "carrier"),
      vessel: text(v, "vessel"),
      voyage: text(v, "voyage"),
      pol: text(v, "pol"),
      pod: text(v, "pod"),
      etd: orNull(text(v, "etd")),
      cfs_name: text(v, "cfs_name"),
      mbl_number: orNull(text(v, "mbl_number")),
    },
    // The boxes in the order typed, and "not in a box yet" last.
    boxes: [...order.filter((b) => b.containerNo), ...order.filter((b) => !b.containerNo)],
    stuffedOn: orNull(text(v, "stuffed_on")),
  };
}

export function outturnInput(v: ManualValues): { console: OutturnConsole; houses: OutturnHouse[] } {
  return {
    console: {
      console_no: orNull(text(v, "console_no")),
      mbl_number: orNull(text(v, "mbl_number")),
      vessel: text(v, "vessel"),
      voyage: text(v, "voyage"),
      pol: text(v, "pol"),
      pod: text(v, "pod"),
      cfs_name: text(v, "cfs_name"),
      destuffed_on: orNull(text(v, "destuffed_on")),
      // "PCIU1234567 40HC", as a console's outturn lists them.
      containers: lines(v, "boxes")
        .filter((b) => (b.container_no ?? "").trim())
        .map((b) => `${b.container_no.trim()} ${(b.size_type ?? "").trim()}`.trim()),
    },
    houses: lines(v, "outturn_lines").map((r) => ({
      shipmentId: "",
      ref: (r.ref ?? "").trim(),
      hblNo: (r.hbl_no ?? "").trim(),
      consignee: (r.consignee ?? "").trim(),
      manifestedPkgs: nNull(r.manifested),
      packageType: (r.package_type ?? "").trim(),
      landedPkgs: nNull(r.landed),
      landedKg: nNull(r.landed_kg),
      conditions: r.condition ? [r.condition] : [],
      remarks: (r.remarks ?? "").trim(),
    })),
  };
}

// ---------------------------------------------------------------- the documents

/** What a table must have before the document says anything. */
const needLines = (v: ManualValues, t: ManualTable, what: string) => (lines(v, t.key).length ? [] : [what]);

const manifestSections = [
  {
    title: "Console",
    fields: [F.console_no, req(F.mbl_number), F.mbl_date, F.carrier, req(F.vessel), F.voyage, F.mother_vessel, req(F.pol), req(F.pod), F.place_of_delivery, F.etd, F.eta],
  },
  { title: "House bills", table: MANIFEST_LINES },
];

const siSections = [
  {
    title: "Booking",
    fields: [F.console_no, F.carrier, F.coload, F.coloader, req(F.carrier_booking_no), req(F.vessel), F.voyage, req(F.pol), req(F.pod), F.place_of_delivery, F.etd, F.cutoff_date],
  },
  {
    title: "Parties on the master B/L",
    fields: [req(F.shipper_name), F.shipper_address, req(F.consignee_name), F.consignee_address, F.notify_name, F.notify_address],
  },
  { title: "Containers", table: BOXES, note: "Not printed on a co-load: the box is the co-loader's." },
  {
    title: "Cargo, as the bill should describe it",
    fields: [F.marks_numbers, req(F.description), F.packages, F.package_type, F.gross_weight_kg, F.measurement_cbm, F.service_type, F.shippers_load, F.freight_terms, F.freight_payable_at, F.remarks],
  },
];

const cfsSections = [
  {
    title: "Master B/L and arrival",
    fields: [F.console_no, req(F.carrier), F.coload, req(F.mbl_number), F.mbl_date, F.vessel, F.voyage, F.pol, F.pod, F.eta, F.igm_no, F.igm_date],
  },
  { title: "The CFS", fields: [req(F.cfs_name), F.our_name] },
  { title: "Containers", table: BOXES_SEALED },
];

const stuffingSections = [
  {
    title: "Console and sailing",
    fields: [F.console_no, F.carrier, F.vessel, F.voyage, F.mbl_number, F.pol, F.pod, F.etd, req(F.cfs_name), F.stuffed_on],
  },
  { title: "Containers", table: BOXES_SEALED, note: "Size and seal for each box. Its packages, weight and measure are its houses'." },
  { title: "Houses stuffed", table: STUFFING_LINES },
];

const outturnSections = [
  {
    title: "Console and destuffing",
    fields: [F.console_no, req(F.mbl_number), F.vessel, F.voyage, F.pol, F.pod, F.cfs_name, req(F.destuffed_on)],
  },
  { title: "Containers", table: BOXES_SEALED },
  { title: "Houses landed", table: OUTTURN_LINES },
];

export const CONSOLE_DOCUMENTS: FormDoc[] = [
  {
    id: "master-si",
    shortName: "Shipping instructions (master B/L)",
    alias: "SI",
    purpose: "What the line should print on the console's master bill: the boxes, the seals and the cargo.",
    group: "console",
    store: "console",
    editor: "form",
    stampsDraft: false,
    sections: siSections,
    render: (v) => {
      const i = masterSiInput(v);
      return renderMasterSiPdf(i.console, i.si, i.terms);
    },
    fileName: (v) => masterSiFileName(masterSiInput(v).console),
    missing: (v) => {
      const coload = text(v, "coload") === "yes";
      return [
        ...emptyRequired(siSections, v),
        ...(coload ? (text(v, "coloader") ? [] : ["Co-loader"]) : text(v, "carrier") ? [] : ["Shipping line"]),
        ...(coload ? [] : needLines(v, BOXES, "A container")),
      ];
    },
  },
  {
    id: "cargo-manifest",
    shortName: "Cargo manifest",
    purpose: "Every house bill on the master, with its parties, packages, weight and measure.",
    group: "console",
    store: "console",
    editor: "form",
    stampsDraft: false,
    sections: manifestSections,
    render: (v) => {
      const i = manifestInput(v);
      return renderManifestPdf(i.console, i.lines, i.provisional);
    },
    fileName: (v) => manifestFileName(manifestInput(v).console, "pdf"),
    missing: (v) => [...emptyRequired(manifestSections, v), ...needLines(v, MANIFEST_LINES, "A house bill")],
  },
  {
    id: "stuffing-report",
    shortName: "Stuffing report",
    purpose: "Each box with its seal and the houses packed into it, tallied against what was declared.",
    group: "console",
    store: "console",
    editor: "form",
    stampsDraft: false,
    sections: stuffingSections,
    render: (v) => {
      const i = stuffingInput(v);
      return renderStuffingReportPdf(i.console, i.boxes, i.stuffedOn);
    },
    fileName: (v) => stuffingReportFileName(stuffingInput(v).console),
    missing: (v) => [...emptyRequired(stuffingSections, v), ...needLines(v, STUFFING_LINES, "A house")],
  },
  {
    id: "cfs-nomination",
    shortName: "CFS nomination letter",
    purpose: "Asks the line to move an import box to our CFS and issue the delivery order in its favour.",
    group: "console",
    store: "console",
    editor: "form",
    stampsDraft: false,
    sections: cfsSections,
    render: (v) => {
      const i = cfsNominationInput(v);
      return renderCfsNominationPdf(i.console, i.boxes, i.cfs, i.ourName);
    },
    fileName: (v) => cfsNominationFileName(cfsNominationInput(v).console),
    missing: (v) => [...emptyRequired(cfsSections, v), ...(cfsNominationInput(v).boxes.length ? [] : ["A container number"])],
  },
  {
    id: "outturn-report",
    shortName: "Outturn report",
    purpose: "What landed at the CFS against what was manifested, house by house.",
    group: "console",
    store: "console",
    editor: "form",
    stampsDraft: false,
    sections: outturnSections,
    render: (v) => {
      const i = outturnInput(v);
      return renderOutturnReportPdf(i.console, i.houses);
    },
    fileName: (v) => outturnFileName(outturnInput(v).console),
    missing: (v) => [...emptyRequired(outturnSections, v), ...needLines(v, OUTTURN_LINES, "A house")],
  },
];
