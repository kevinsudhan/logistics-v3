import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Eye,
  FileUp,
  History,
  Loader2,
  Lock,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { failureText } from "../lib/errorText";
import {
  awbTotals,
  chargeAmount,
  emptyCharge,
  emptyRate,
  FIELD_LABEL,
  finalDestination,
  hawbFromJob,
  lineTotal,
  missingForOriginal,
  money,
  refetch,
  type HawbData,
  type OtherCharge,
  type PC,
  type RateLine,
} from "../lib/hawb";
import { hawbFileName, hawbPdfBytes, renderHawbPdf } from "../lib/documents/hawbPdf";
import { uploadFile } from "../services/attachments";
import { listPeople, nameOf, quotesFor, type Enquiry, type Person, type Shipment } from "../services/enquiries";
import { getHawb, hawbHistory, jobForHawb, logHawbPrint, saveHawb, setOriginalIssued, type HawbHistory, type HawbRow } from "../services/hawb";
import { linesFor } from "../services/quoteLines";
import { liveQuoteOf } from "../lib/attachableDocuments";
import { SectionSkeleton } from "./Loading";

/**
 * The HAWB tab: the house air waybill, laid out like the form it prints.
 *
 * ---------------------------------------------------------------------------
 * HOW IT WORKS
 *
 * The first time it opens, the form is filled from the job ("Fetch details")
 * and nothing is saved until Save. After that it opens as saved, and Fetch
 * details refreshes only the job's boxes — parties, routing, flights, pieces
 * and weights, goods — leaving the charges, notes and signatures the desk
 * wrote (src/lib/hawb.ts).
 *
 * The first save numbers it (MAA/DXB/HAWB0000001) and puts the number on the
 * shipment as its house bill. Print shows a draft, stamped DRAFT, until the
 * Airway bill is set to Original; "Original AWB issued: Yes" then locks the
 * form, and only an administrator can set it back (075).
 *
 * Printing uses what is saved, never what is on screen and unsaved, so the
 * paper and the record cannot disagree.
 * ---------------------------------------------------------------------------
 */

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export default function HawbForm({
  shipment: s,
  enquiry,
  onChanged,
  prevTab,
  nextTab,
}: {
  shipment: Shipment;
  enquiry: Pick<Enquiry, "dimension_unit"> | null;
  /** The shipment's house bill number may have just been set. */
  onChanged: () => void;
  prevTab: string;
  nextTab: string;
}) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [row, setRow] = useState<HawbRow | null>(null);
  const [d, setD] = useState<HawbData | null>(null);
  const [date, setDate] = useState<string>("");
  const [kind, setKind] = useState<"draft" | "original">("draft");
  const [saved, setSaved] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [history, setHistory] = useState<HawbHistory[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [chargeNames, setChargeNames] = useState<string[]>([]);
  const [printOpen, setPrintOpen] = useState(false);

  const snapshot = (data: HawbData | null, dt: string, k: string) => JSON.stringify([data, dt, k]);
  const dirty = d !== null && snapshot(d, date, kind) !== saved;
  const locked = Boolean(row?.original_issued);
  const isAdmin = session?.role === "admin";

  const load = useCallback(async () => {
    setError(null);
    try {
      const existing = await getHawb(s.id);
      setRow(existing);
      if (existing) {
        setD(existing.data);
        setDate(existing.hawb_date ?? "");
        setKind(existing.awb_kind);
        setSaved(snapshot(existing.data, existing.hawb_date ?? "", existing.awb_kind));
      } else {
        const fresh = hawbFromJob(await jobForHawb(s, enquiry, session?.name ?? null));
        setD(fresh);
        setDate(today());
        setKind("draft");
        // Nothing saved yet: the whole form is unsaved, and says so.
        setSaved("");
      }
    } catch (e) {
      setError(failureText(e, "Could not load the HAWB.").message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Charge names the desk already used on this job's quotation, offered as the
  // other charges are typed.
  useEffect(() => {
    void quotesFor(s.enquiry_ref)
      .then((qs) => {
        const q = liveQuoteOf(qs);
        return q ? linesFor(q.id) : [];
      })
      .then((ls) => setChargeNames([...new Set(ls.map((l) => l.description.toUpperCase()).filter(Boolean))]))
      .catch(() => setChargeNames([]));
  }, [s.enquiry_ref]);

  // Leaving the page with unsaved boxes asks first.
  useEffect(() => {
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [dirty]);

  const totals = useMemo(() => (d ? awbTotals(d) : null), [d]);
  const missing = useMemo(() => (d ? missingForOriginal(d) : []), [d]);

  if (!d || !totals) {
    return error ? (
      <p className="flex items-center gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
        <AlertCircle size={13} /> {error}
      </p>
    ) : (
      <SectionSkeleton lines={5} label="Loading the HAWB" className="py-6" />
    );
  }

  const set = <K extends keyof HawbData>(k: K, v: HawbData[K]) => setD((x) => (x ? { ...x, [k]: v } : x));
  const setRate = (i: number, patch: Partial<RateLine>) =>
    setD((x) => (x ? { ...x, rates: x.rates.map((r, n) => (n === i ? { ...r, ...patch } : r)) } : x));
  const setCharge = (i: number, patch: Partial<OtherCharge>) =>
    setD((x) => (x ? { ...x, other_charges: x.other_charges.map((c, n) => (n === i ? { ...c, ...patch } : c)) } : x));

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const said = await fn();
      if (said) setNote(said);
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("save", async () => {
      if (kind === "original" && missing.length) {
        throw new Error(`An original HAWB needs: ${missing.join(", ")}.`);
      }
      const { row: r, numberError } = await saveHawb(s.id, { hawb_date: date || null, awb_kind: kind, data: d }, Boolean(row));
      setRow(r);
      setD(r.data);
      setSaved(snapshot(r.data, r.hawb_date ?? "", r.awb_kind));
      if (history) setHistory(await hawbHistory(s.id));
      onChanged();
      if (numberError) return `Saved. Not numbered yet: ${numberError}`;
      return r.hawb_no && !row?.hawb_no ? `Saved and numbered ${r.hawb_no}.` : "Saved.";
    });

  const fetchDetails = () =>
    run("fetch", async () => {
      if (row && !window.confirm("Refresh the parties, routing, flights, pieces, weights and goods from the job? Charges, notes and signatures stay as they are.")) return;
      const fresh = hawbFromJob(await jobForHawb(s, enquiry, session?.name ?? null));
      setD(row ? refetch(d, fresh) : fresh);
      return "Filled from the job. Check it, then Save.";
    });

  const printInput = () => ({ data: row!.data, hawbNo: row!.hawb_no, hawbDate: row!.hawb_date, kind: row!.awb_kind });
  const print = (how: "view" | "download" | "file") =>
    run(`print-${how}`, async () => {
      setPrintOpen(false);
      const input = printInput();
      const name = hawbFileName(input);
      if (how === "view") {
        const url = renderHawbPdf(input).output("bloburl") as unknown as string;
        const tab = window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        if (!tab) throw new Error("The browser blocked the new tab. Allow pop-ups for this site, or use Download.");
      } else if (how === "download") {
        renderHawbPdf(input).save(name);
      } else {
        const bytes = hawbPdfBytes(input);
        await uploadFile({
          enquiryRef: s.enquiry_ref,
          file: new File([new Uint8Array(bytes)], name, { type: "application/pdf" }),
          documentType: "HAWB",
          referenceNumber: input.hawbNo,
          protected: input.kind === "original",
        });
      }
      await logHawbPrint(s.id, `${input.kind === "original" ? "Original" : "Draft"} ${how === "file" ? "filed to Documents" : how === "view" ? "viewed" : "downloaded"}`).catch(() => {});
      if (history) setHistory(await hawbHistory(s.id));
      return how === "file" ? `${name} filed on the Documents tab.` : undefined;
    });

  const toggleIssued = (issued: boolean) =>
    run("issued", async () => {
      if (issued) {
        if (dirty) throw new Error("Save first: the original is issued as saved.");
        if (row?.awb_kind !== "original") throw new Error('Set "Airway bill" to Original and save before marking it issued.');
        if (missing.length) throw new Error(`An original HAWB needs: ${missing.join(", ")}.`);
        if (!window.confirm("Mark the original HAWB as issued? The form locks, and only an administrator can reopen it.")) return;
      } else if (!window.confirm("Reopen the issued HAWB for correction?")) return;
      await setOriginalIssued(s.id, issued);
      await load();
      if (history) setHistory(await hawbHistory(s.id));
      return issued ? "Marked issued. The form is locked." : "Reopened for correction.";
    });

  const openHistory = () =>
    run("history", async () => {
      const [h, p] = await Promise.all([hawbHistory(s.id), people.length ? Promise.resolve(people) : listPeople()]);
      setPeople(p);
      setHistory(h);
    });

  const go = (tab: string) => {
    if (dirty && !window.confirm("Leave without saving the HAWB?")) return;
    navigate(`../${tab}`, { relative: "path" });
  };

  const ro = locked;
  // Full width unless a width is given: a fixed width and w-full on one input
  // is a coin toss the stylesheet decides.
  const base = "rounded border border-border bg-surface-1 px-2 py-1 text-[12.5px] uppercase disabled:bg-surface-2 disabled:text-text-secondary";
  const inp = `${base} w-full`;
  const T = (k: keyof HawbData, extra = "") => (
    <input value={d[k] as string} disabled={ro} onChange={(e) => set(k, e.target.value as never)} className={`${inp} ${extra}`} />
  );
  const A = (k: keyof HawbData, rows = 3) => (
    <textarea value={d[k] as string} disabled={ro} rows={rows} onChange={(e) => set(k, e.target.value as never)} className={`${inp} resize-y leading-snug`} />
  );
  const PCSel = (k: "wt_val" | "other") => (
    <select value={d[k]} disabled={ro} onChange={(e) => set(k, e.target.value as PC)} className={inp}>
      <option value="P">P</option>
      <option value="C">C</option>
    </select>
  );

  return (
    <div>
      {/* ---- toolbar ---- */}
      <div className="card mb-3 flex flex-wrap items-end gap-x-4 gap-y-3 p-3">
        <div className="flex flex-wrap gap-1">
          <Tool icon={<RefreshCw size={15} />} label="Fetch details" busy={busy === "fetch"} disabled={ro || busy !== null} onClick={() => void fetchDetails()} />
          <Tool icon={<Save size={15} />} label={row ? "Update" : "Save"} busy={busy === "save"} disabled={ro || busy !== null || (!dirty && Boolean(row))} onClick={() => void save()} primary={dirty} />
          <div className="relative">
            <Tool
              icon={<Printer size={15} />}
              label="Print"
              busy={busy?.startsWith("print") ?? false}
              disabled={!row || dirty || busy !== null}
              title={!row ? "Save the HAWB first" : dirty ? "Save first: the print is of what is saved" : undefined}
              onClick={() => setPrintOpen((o) => !o)}
            />
            {printOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-border bg-surface-1 p-1 shadow-lg">
                <MenuItem icon={<Eye size={13} />} onClick={() => void print("view")}>
                  View {row?.awb_kind === "original" ? "original" : "draft"}
                </MenuItem>
                <MenuItem icon={<Download size={13} />} onClick={() => void print("download")}>
                  Download PDF
                </MenuItem>
                <MenuItem icon={<FileUp size={13} />} onClick={() => void print("file")}>
                  File to Documents
                </MenuItem>
              </div>
            )}
          </div>
          <Tool icon={<History size={15} />} label="History logs" busy={busy === "history"} disabled={!row || busy !== null} onClick={() => void openHistory()} />
        </div>

        <Labelled label="HAWB date">
          <input type="date" value={date} disabled={ro} onChange={(e) => setDate(e.target.value)} className={`${base} h-8 w-40 normal-case`} />
        </Labelled>
        <Labelled label="Airway bill">
          <select value={kind} disabled={ro} onChange={(e) => setKind(e.target.value as "draft" | "original")} className={`${base} h-8 w-36 normal-case`}>
            <option value="draft">Draft</option>
            <option value="original">Original</option>
          </select>
        </Labelled>
        <Labelled label="Original AWB issued">
          <select
            value={locked ? "yes" : "no"}
            disabled={!row || busy !== null || (locked && !isAdmin)}
            title={locked && !isAdmin ? "Only an administrator can reopen an issued HAWB" : undefined}
            onChange={(e) => void toggleIssued(e.target.value === "yes")}
            className={`${base} h-8 w-28 normal-case`}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </Labelled>

        <span className="ml-auto self-center text-[11.5px]">
          {!row ? (
            <span className="text-text-warning">Filled from the job — not saved yet</span>
          ) : dirty ? (
            <span className="text-text-warning">Unsaved changes</span>
          ) : (
            <span className="text-text-muted">Saved {new Date(row.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          )}
        </span>
      </div>

      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" /> {error}
        </p>
      )}
      {note && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-bg-success px-3 py-2.5 text-[12px] text-text-success">
          <Check size={13} className="mt-px shrink-0" /> {note}
        </p>
      )}
      {locked && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <Lock size={13} className="mt-px shrink-0" /> The original HAWB has been issued, so the form is locked.
          {isAdmin ? " Set Original AWB issued back to No to correct it." : " An administrator can reopen it for a correction."}
        </p>
      )}
      {kind === "original" && !locked && missing.length > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <AlertTriangle size={13} className="mt-px shrink-0" /> An original needs: {missing.join(", ")}.
        </p>
      )}

      {/* ---- the form ---- */}
      <div className="card overflow-x-auto p-3">
        <div className="min-w-[860px]">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
            <input value={d.airline_prefix} disabled={ro} onChange={(e) => set("airline_prefix", e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="176" title="Airline prefix (MAWB)" className={`${base} w-14 text-center font-mono`} />
            <span className="text-text-muted">|</span>
            <input value={d.departure_code} disabled={ro} onChange={(e) => set("departure_code", e.target.value.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase())} placeholder="MAA" title="Departure airport code" className={`${base} w-14 text-center font-mono`} />
            <span className="text-text-muted">|</span>
            <input value={d.mawb_serial} disabled={ro} onChange={(e) => set("mawb_serial", e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="MAWB serial" title="MAWB serial number" className={`${base} w-32 font-mono`} />
          </div>

          <div className="grid grid-cols-2 border-l border-t border-border-strong">
            {/* shipper | issuer */}
            <Cell>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <BoxLabel>Shipper's Name and Address</BoxLabel>
                </div>
                <div className="w-48">
                  <BoxLabel>Shipper's Account Number</BoxLabel>
                  {T("shipper_account")}
                </div>
              </div>
              <div className="mt-1.5 space-y-1">
                {T("shipper_name", "font-semibold")}
                {A("shipper_address")}
              </div>
            </Cell>
            <Cell>
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-semibold text-text-secondary">Not Negotiable</span>
                <input value={d.carrier_name} disabled={ro} onChange={(e) => set("carrier_name", e.target.value)} placeholder="Carrier" className={`${base} w-56 font-semibold`} />
              </div>
              <p className="mt-2 text-[18px] font-bold text-text-primary">Air Waybill</p>
              <BoxLabel>Issued by</BoxLabel>
              {A("issued_by", 3)}
              <p className="mt-1 text-[10.5px] text-text-muted">Copies 1, 2 and 3 of this Air Waybill are originals and have the same validity.</p>
            </Cell>

            {/* consignee | conditions */}
            <Cell>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <BoxLabel>Consignee's Name and Address</BoxLabel>
                </div>
                <div className="w-48">
                  <BoxLabel>Consignee's Account Number</BoxLabel>
                  {T("consignee_account")}
                </div>
              </div>
              <div className="mt-1.5 space-y-1">
                {T("consignee_name", "font-semibold")}
                {A("consignee_address")}
              </div>
            </Cell>
            <Cell>
              <p className="text-[10px] uppercase leading-relaxed text-text-muted">
                It is agreed that the goods declared herein are accepted in apparent good order and condition (except as noted) for carriage subject to the conditions
                of contract on the reverse hereof. All goods may be carried by any other means including road or any other carrier unless specific contrary instructions
                are given hereon by the shipper, and shipper agrees that the shipment may be carried via intermediate stopping places which the carrier deems
                appropriate. The shipper's attention is drawn to the notice concerning carrier's limitation of liability. Shipper may increase such limitation of
                liability by declaring a higher value for carriage and paying a supplemental charge if required.
              </p>
            </Cell>

            {/* agent | accounting */}
            <Cell>
              <BoxLabel>Issuing Carrier's Agent Name and City</BoxLabel>
              <div className="space-y-1">
                {T("agent_name")}
                {A("agent_address", 2)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <BoxLabel>Agent's IATA Code</BoxLabel>
                  {T("agent_iata_code")}
                </div>
                <div>
                  <BoxLabel>Account Number</BoxLabel>
                  {T("agent_account")}
                </div>
              </div>
              <div className="mt-2">
                <BoxLabel>Airport of Departure (Address of First Carrier) and Requested Routing</BoxLabel>
                {T("departure_airport", "text-center")}
              </div>
            </Cell>
            <Cell>
              <BoxLabel>Accounting Information</BoxLabel>
              {A("accounting_info", 3)}
              <div className="mt-2 flex items-center gap-2">
                <span className="shrink-0 text-[11px] font-semibold text-text-secondary">Reference Number</span>
                {T("reference_number", "normal-case")}
              </div>
            </Cell>
          </div>

          {/* ---- routing strip ---- */}
          <div className="grid grid-cols-[60px_1.4fr_60px_60px_60px_60px_70px_64px_56px_56px_56px_56px_1fr_1fr] border-l border-border-strong">
            <Head>To *</Head>
            <Head>By First Carrier *</Head>
            <Head>To</Head>
            <Head>By</Head>
            <Head>To</Head>
            <Head>By</Head>
            <Head>Currency</Head>
            <Head>Chgs Code</Head>
            <Head>WT/VAL</Head>
            <Head>&nbsp;</Head>
            <Head>Other</Head>
            <Head>&nbsp;</Head>
            <Head>Declared Value for Carriage *</Head>
            <Head>Declared Value for Customs *</Head>
            {(["to1", "by1", "to2", "by2", "to3", "by3", "currency", "chgs_code"] as const).map((k) => (
              <Slot key={k}>{T(k, "text-center")}</Slot>
            ))}
            <Slot>{PCSel("wt_val")}</Slot>
            <Slot>
              <span className="block pt-1 text-center text-[11px] text-text-muted">{d.wt_val === "P" ? "PPD" : "COLL"}</span>
            </Slot>
            <Slot>{PCSel("other")}</Slot>
            <Slot>
              <span className="block pt-1 text-center text-[11px] text-text-muted">{d.other === "P" ? "PPD" : "COLL"}</span>
            </Slot>
            <Slot>{T("dv_carriage", "text-center")}</Slot>
            <Slot>{T("dv_customs", "text-center")}</Slot>
          </div>

          <div className="grid grid-cols-[1.1fr_1.5fr_1.5fr_1fr_2fr] border-l border-border-strong">
            <Head>Destination Airport *</Head>
            <Head>Flight &amp; Date</Head>
            <Head>Flight &amp; Date</Head>
            <Head>Insurance Amount *</Head>
            <Head>&nbsp;</Head>
            <Slot>{T("destination_airport", "text-center")}</Slot>
            <Slot>
              <div className="flex gap-1">
                <input value={d.flight1} disabled={ro} onChange={(e) => set("flight1", e.target.value.toUpperCase())} className={`${base} w-24`} />
                <input type="date" value={d.flight1_date} disabled={ro} onChange={(e) => set("flight1_date", e.target.value)} className={`${inp} normal-case`} />
              </div>
            </Slot>
            <Slot>
              <div className="flex gap-1">
                <input value={d.flight2} disabled={ro} onChange={(e) => set("flight2", e.target.value.toUpperCase())} className={`${base} w-24`} />
                <input type="date" value={d.flight2_date} disabled={ro} onChange={(e) => set("flight2_date", e.target.value)} className={`${inp} normal-case`} />
              </div>
            </Slot>
            <Slot>{T("insurance", "text-center")}</Slot>
            <Slot>
              <p className="text-[9.5px] leading-snug text-text-muted">
                INSURANCE — If carrier offers insurance, and such insurance is requested in accordance with the conditions thereof, indicate amount to be insured in
                figures in box marked "Amount of insurance".
              </p>
            </Slot>
          </div>

          <div className="grid grid-cols-[1fr_220px] border-l border-border-strong">
            <Slot>
              <BoxLabel>Handling Information</BoxLabel>
              {A("handling_info", 3)}
              <div className="mt-1.5 flex items-center gap-2">
                <span className="shrink-0 text-[11px] font-semibold text-text-secondary">PAN Number</span>
                <input value={d.pan_number} disabled={ro} onChange={(e) => set("pan_number", e.target.value.toUpperCase())} className={`${base} w-44`} />
              </div>
            </Slot>
            <Slot>
              <BoxLabel>SCI</BoxLabel>
              {T("sci")}
            </Slot>
          </div>

          {/* ---- rate lines ---- */}
          <div className="grid grid-cols-[1fr_300px] border-l border-border-strong">
            <div className="border-b border-r border-border-strong">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-surface-2 text-[10.5px] font-semibold text-text-secondary">
                    {["Number of Pieces", "Gross Weight", "KG/LB", "Rate Class", "Commodity Item No.", "Chargeable Weight", "Rate / Charge", "Total", ""].map((h, i) => (
                      <th key={i} className="border-b border-r border-border px-1.5 py-1 text-left font-semibold last:border-r-0">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.rates.map((r, i) => (
                    <tr key={i}>
                      <Td>
                        <input value={r.pieces} disabled={ro} onChange={(e) => setRate(i, { pieces: e.target.value })} inputMode="numeric" className={inp} />
                      </Td>
                      <Td>
                        <input value={r.gross} disabled={ro} onChange={(e) => setRate(i, { gross: e.target.value })} inputMode="decimal" className={inp} />
                      </Td>
                      <Td>
                        <select value={r.unit} disabled={ro} onChange={(e) => setRate(i, { unit: e.target.value as "K" | "L" })} className={inp}>
                          <option value="K">K</option>
                          <option value="L">L</option>
                        </select>
                      </Td>
                      <Td>
                        <select value={r.rate_class} disabled={ro} onChange={(e) => setRate(i, { rate_class: e.target.value })} className={inp} title="M minimum, N normal, Q quantity, C specific commodity, R reduced, S surcharged">
                          <option value=""></option>
                          {["M", "N", "Q", "C", "R", "S"].map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </Td>
                      <Td>
                        <input value={r.commodity_item} disabled={ro} onChange={(e) => setRate(i, { commodity_item: e.target.value })} className={inp} />
                      </Td>
                      <Td>
                        <input value={r.chargeable} disabled={ro} onChange={(e) => setRate(i, { chargeable: e.target.value })} inputMode="decimal" className={inp} />
                      </Td>
                      <Td>
                        <input value={r.rate} disabled={ro} onChange={(e) => setRate(i, { rate: e.target.value })} inputMode="decimal" className={inp} />
                      </Td>
                      <Td>
                        <input
                          value={r.total}
                          disabled={ro}
                          onChange={(e) => setRate(i, { total: e.target.value })}
                          placeholder={money(lineTotal({ ...r, total: "" })) || "rate × wt"}
                          title="Worked out from rate × chargeable weight; type to override"
                          className={inp}
                        />
                      </Td>
                      <Td>
                        {!ro && d.rates.length > 1 && (
                          <button type="button" onClick={() => set("rates", d.rates.filter((_, n) => n !== i))} className="p-1 text-text-muted hover:text-text-danger" aria-label="Remove rate line">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </Td>
                    </tr>
                  ))}
                  <tr className="bg-surface-2 text-[12px] font-semibold">
                    <td className="px-2 py-1">{totals.pieces || ""}</td>
                    <td className="px-2 py-1">{totals.gross || ""}</td>
                    <td className="px-2 py-1">{d.rates[0]?.unit}</td>
                    <td colSpan={4} className="px-2 py-1 text-right">
                      {!ro && (
                        <button type="button" onClick={() => set("rates", [...d.rates, emptyRate()])} className="inline-flex items-center gap-1 text-[11px] font-normal text-text-accent hover:underline">
                          <Plus size={11} /> Add a rate line
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-1">{money(totals.weightCharge)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              <div className="border-t border-border p-2">
                <BoxLabel>Marks &amp; Numbers</BoxLabel>
                {A("marks_numbers", 2)}
              </div>
            </div>
            <Slot>
              <BoxLabel>Nature and Quantity of Goods (incl. Dimensions &amp; Volume)</BoxLabel>
              {A("nature_of_goods", 9)}
            </Slot>
          </div>

          {/* ---- charges | other charges and signatures ---- */}
          <div className="grid grid-cols-2 border-l border-border-strong">
            <div className="border-b border-r border-border-strong">
              <ChargeRow label="Weight Charges" pp={money(totals.prepaid.weight)} cc={money(totals.collect.weight)} head />
              <ChargeRow
                label="Valuation Charges"
                pp={d.wt_val === "P" ? <input value={d.valuation_charge} disabled={ro} onChange={(e) => set("valuation_charge", e.target.value)} inputMode="decimal" className={inp} /> : ""}
                cc={d.wt_val === "C" ? <input value={d.valuation_charge} disabled={ro} onChange={(e) => set("valuation_charge", e.target.value)} inputMode="decimal" className={inp} /> : ""}
              />
              <ChargeRow
                label="Tax"
                pp={d.wt_val === "P" ? <input value={d.tax} disabled={ro} onChange={(e) => set("tax", e.target.value)} inputMode="decimal" className={inp} /> : ""}
                cc={d.wt_val === "C" ? <input value={d.tax} disabled={ro} onChange={(e) => set("tax", e.target.value)} inputMode="decimal" className={inp} /> : ""}
              />
              <ChargeRow label="Total Other Charges Due Agent" pp={money(totals.prepaid.dueAgent)} cc={money(totals.collect.dueAgent)} />
              <ChargeRow label="Total Other Charges Due Carrier" pp={money(totals.prepaid.dueCarrier)} cc={money(totals.collect.dueCarrier)} />
              <ChargeRow label="Total Prepaid  |  Total Collect" pp={money(totals.prepaid.total)} cc={money(totals.collect.total)} strong />
              <ChargeRow
                label="Currency Conversion Rate  |  CC Charges in Dest. Currency"
                pp={<input value={d.conversion_rate} disabled={ro} onChange={(e) => set("conversion_rate", e.target.value)} inputMode="decimal" className={inp} />}
                cc={money(totals.ccInDestCurrency)}
              />
              <ChargeRow
                label="Charges at Destination  |  Total Collect Charges"
                pp={<input value={d.charges_at_destination} disabled={ro} onChange={(e) => set("charges_at_destination", e.target.value)} inputMode="decimal" className={inp} />}
                cc={money(totals.totalCollectCharges)}
              />
            </div>

            <div className="border-b border-r border-border-strong">
              <div className="p-2">
                <div className="mb-1 flex items-center justify-between">
                  <BoxLabel>Other Charges</BoxLabel>
                  {!ro && (
                    <button type="button" onClick={() => set("other_charges", [...d.other_charges, emptyCharge(d.other)])} className="inline-flex items-center gap-1 text-[11px] text-text-accent hover:underline">
                      <Plus size={11} /> Add a charge
                    </button>
                  )}
                </div>
                {d.other_charges.length === 0 ? (
                  <p className="py-2 text-[11.5px] text-text-muted">None. Add the charges the HAWB should show, or leave it blank for "as agreed".</p>
                ) : (
                  <table className="w-full text-[11.5px]">
                    <thead>
                      <tr className="text-left text-[10.5px] text-text-secondary">
                        <th className="pb-1 font-semibold">Charge *</th>
                        <th className="pb-1 font-semibold">Unit</th>
                        <th className="pb-1 font-semibold">Per unit</th>
                        <th className="pb-1 font-semibold">Amount</th>
                        <th className="pb-1 font-semibold">Due</th>
                        <th className="pb-1 font-semibold">PP/CC</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.other_charges.map((c, i) => (
                        <tr key={i}>
                          <td className="pr-1 pb-1">
                            <input value={c.name} disabled={ro} list="hawb-charge-names" onChange={(e) => setCharge(i, { name: e.target.value })} className={inp} />
                          </td>
                          <td className="pr-1 pb-1">
                            <select value={c.unit} disabled={ro} onChange={(e) => setCharge(i, { unit: e.target.value as OtherCharge["unit"] })} className={`${inp} normal-case`}>
                              <option value="shipment">Shipment</option>
                              <option value="kg">Per kg</option>
                              <option value="piece">Per piece</option>
                            </select>
                          </td>
                          <td className="w-20 pr-1 pb-1">
                            <input value={c.per_unit} disabled={ro} onChange={(e) => setCharge(i, { per_unit: e.target.value })} inputMode="decimal" className={inp} />
                          </td>
                          <td className="w-24 pr-1 pb-1">
                            <input
                              value={c.amount}
                              disabled={ro}
                              onChange={(e) => setCharge(i, { amount: e.target.value })}
                              placeholder={money(chargeAmount({ ...c, amount: "" }, totals.chargeable, totals.pieces))}
                              title="Worked out from per unit × quantity; type to override"
                              inputMode="decimal"
                              className={inp}
                            />
                          </td>
                          <td className="pr-1 pb-1">
                            <select value={c.due} disabled={ro} onChange={(e) => setCharge(i, { due: e.target.value as OtherCharge["due"] })} className={`${inp} normal-case`}>
                              <option value="carrier">Carrier</option>
                              <option value="agent">Agent</option>
                            </select>
                          </td>
                          <td className="pr-1 pb-1">
                            <select value={c.pp} disabled={ro} onChange={(e) => setCharge(i, { pp: e.target.value as PC })} className={`${inp} normal-case`}>
                              <option value="P">Prepaid</option>
                              <option value="C">Collect</option>
                            </select>
                          </td>
                          <td className="pb-1">
                            {!ro && (
                              <button type="button" onClick={() => set("other_charges", d.other_charges.filter((_, n) => n !== i))} className="p-1 text-text-muted hover:text-text-danger" aria-label="Remove charge">
                                <Trash2 size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <datalist id="hawb-charge-names">
                  {chargeNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>

              <div className="border-t border-border p-2">
                <p className="text-[10px] leading-snug text-text-muted">
                  Shipper certifies that the particulars on the face hereof are correct and that insofar as any part of the consignment contains dangerous goods, such part
                  is properly described by name and is in proper condition for carriage by air according to the applicable Dangerous Goods Regulations.
                </p>
                <input value={d.shipper_signature} disabled={ro} onChange={(e) => set("shipper_signature", e.target.value)} className={`${inp} mt-1.5 text-center`} />
                <p className="mt-0.5 border-t border-dashed border-border-strong pt-0.5 text-center text-[10.5px] font-semibold text-text-secondary">Signature of Shipper or Agent</p>
              </div>

              <div className="border-t border-border p-2">
                <p className="text-[10px] leading-snug text-text-muted">
                  Carrier certifies that the goods described hereon are accepted for carriage subject to the conditions of contract on the reverse hereof, the goods then
                  being in apparent good order and condition except as noted hereon.
                </p>
                <input value={d.carrier_signature} disabled={ro} onChange={(e) => set("carrier_signature", e.target.value)} className={`${inp} mt-1.5`} />
                <div className="mt-1.5 grid grid-cols-[1fr_90px] gap-2">
                  <div>
                    <input type="date" value={d.executed_on} disabled={ro} onChange={(e) => set("executed_on", e.target.value)} className={`${inp} normal-case`} />
                    <p className="text-center text-[10.5px] font-semibold text-text-secondary">Executed on (Date)</p>
                  </div>
                  <div>
                    <input value={d.executed_at} disabled={ro} onChange={(e) => set("executed_at", e.target.value.toUpperCase())} className={`${inp} text-center`} />
                    <p className="text-center text-[10.5px] font-semibold text-text-secondary">at (Place)</p>
                  </div>
                </div>
                <p className="mt-1 text-center text-[10.5px] font-semibold text-text-secondary">Signature of Issuing Carrier or its Agent</p>
              </div>
            </div>
          </div>

          <p className="mt-2 text-right font-mono text-[13px] font-semibold text-text-primary">
            {row?.hawb_no ?? (
              <span className="font-sans text-[11.5px] font-normal text-text-muted">
                Numbered on the first save{finalDestination(d) && d.departure_code ? ` — ${d.departure_code}/${finalDestination(d)}/HAWB…` : ""}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* ---- footer ---- */}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={() => go(prevTab)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-4 text-[12.5px] text-text-primary hover:bg-surface-2">
          <ArrowLeft size={14} /> Previous
        </button>
        <button type="button" onClick={() => go(nextTab)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-4 text-[12.5px] text-text-primary hover:bg-surface-2">
          Next <ArrowRight size={14} />
        </button>
        <button
          type="button"
          disabled={ro || busy !== null || (!dirty && Boolean(row))}
          onClick={() => void save()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-5 text-[12.5px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {busy === "save" && <Loader2 size={13} className="animate-spin" />}
          {row ? "Update" : "Save"}
        </button>
      </div>

      {history && <HistoryPanel history={history} people={people} onClose={() => setHistory(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces of the form
// ---------------------------------------------------------------------------

function Tool({
  icon,
  label,
  onClick,
  busy,
  disabled,
  primary,
  title,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  primary?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex w-[76px] flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40 ${
        primary ? "bg-brand text-white hover:bg-brand-dark" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      }`}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function MenuItem({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] text-text-primary hover:bg-surface-2">
      {icon}
      {children}
    </button>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-semibold text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

const Cell = ({ children }: { children: ReactNode }) => <div className="border-b border-r border-border-strong p-2">{children}</div>;
const Slot = ({ children }: { children: ReactNode }) => <div className="border-b border-r border-border-strong p-1.5">{children}</div>;
const Head = ({ children }: { children: ReactNode }) => (
  <div className="border-b border-r border-border bg-surface-2 px-1.5 py-1 text-[10.5px] font-semibold leading-tight text-text-secondary">{children}</div>
);
const BoxLabel = ({ children }: { children: ReactNode }) => <p className="mb-0.5 text-[11px] font-semibold text-text-secondary">{children}</p>;
const Td = ({ children }: { children: ReactNode }) => <td className="border-r border-border px-1 py-1 last:border-r-0">{children}</td>;

function ChargeRow({ label, pp, cc, head, strong }: { label: string; pp: ReactNode; cc: ReactNode; head?: boolean; strong?: boolean }) {
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex justify-center">
        <span className="-mb-px rounded-b-md border border-t-0 border-border bg-surface-2 px-2 text-[10.5px] font-semibold text-text-secondary">{label}</span>
      </div>
      <div className="grid grid-cols-2">
        <div className={`border-r border-border px-2 pb-1.5 pt-1 text-right text-[12.5px] tabular-nums ${strong ? "font-semibold" : ""}`}>
          {head && <span className="float-left text-[10.5px] font-semibold text-text-muted">Prepaid</span>}
          {pp || <span className="text-text-muted">&nbsp;</span>}
        </div>
        <div className={`px-2 pb-1.5 pt-1 text-right text-[12.5px] tabular-nums ${strong ? "font-semibold" : ""}`}>
          {head && <span className="float-left text-[10.5px] font-semibold text-text-muted">Collect</span>}
          {cc || <span className="text-text-muted">&nbsp;</span>}
        </div>
      </div>
    </div>
  );
}

function HistoryPanel({ history, people, onClose }: { history: HawbHistory[]; people: Person[]; onClose: () => void }) {
  const show = (v: unknown) => {
    if (v === null || v === undefined || v === "") return "(blank)";
    if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 60)}…` : v;
    return Array.isArray(v) ? `${v.length} line${v.length === 1 ? "" : "s"}` : JSON.stringify(v);
  };
  const WHAT: Record<HawbHistory["action"], string> = {
    created: "Created",
    updated: "Changed",
    numbered: "Numbered",
    issued: "Original issued",
    reopened: "Reopened",
    printed: "Printed",
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-label="HAWB history">
      <div className="h-full w-full max-w-md overflow-y-auto bg-surface-1 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-text-primary">History logs</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-text-muted hover:text-text-primary" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {!history.length ? (
          <p className="text-[12.5px] text-text-muted">Nothing recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {history.map((h) => (
              <li key={h.id} className="rounded-lg border border-border p-3">
                <p className="text-[12.5px] font-medium text-text-primary">
                  {WHAT[h.action]}
                  {h.note ? ` — ${h.note}` : ""}
                </p>
                <p className="text-[11px] text-text-muted">
                  {new Date(h.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {" · "}
                  {nameOf(people, h.actor) ?? "the system"}
                </p>
                {h.changes.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-[11.5px]">
                    {h.changes.map((c, i) => (
                      <li key={i} className="text-text-secondary">
                        <span className="font-medium text-text-primary">{FIELD_LABEL[c.field] ?? c.field}</span>: {show(c.from)} → {show(c.to)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
