import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  Printer,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { failureText } from "../lib/errorText";
import { FIELD_LABEL, finalDestination, hawbFromJob, missingForOriginal, refetch, type HawbData } from "../lib/hawb";
import HawbBoxes from "./HawbBoxes";
import { hawbFileName, hawbPdfBytes, renderHawbPdf } from "../lib/documents/hawbPdf";
import { uploadFile } from "../services/attachments";
import { listPeople, nameOf, quotesFor, type Enquiry, type Person, type Shipment } from "../services/enquiries";
import { getHawb, hawbHistory, jobForHawb, logHawbPrint, saveHawb, setOriginalIssued, type HawbHistory, type HawbRow } from "../services/hawb";
import { linesFor } from "../services/quoteLines";
import { liveQuoteOf } from "../lib/attachableDocuments";
import { SectionSkeleton } from "./Loading";
import { formatDate } from "../lib/dates";
import { useLiveVersion } from "../lib/liveVersions";

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

  /*
    Somebody else saving this HAWB (084).

    With nothing unsaved here, the form simply reads it again. With boxes
    typed and not saved, reading it again would wipe them — so it only looks
    whether the saved HAWB is newer and somebody else's, and if it is, says so
    and offers to load theirs. Whoever saves next replaces the other's.
  */
  const live = useLiveVersion("house_airwaybills");
  const [theirs, setTheirs] = useState(false);
  const dirtyNow = useRef(dirty);
  dirtyNow.current = dirty;
  const rowNow = useRef(row);
  rowNow.current = row;
  useEffect(() => {
    if (!live) return;
    if (!dirtyNow.current) {
      setTheirs(false);
      void load();
      return;
    }
    void getHawb(s.id)
      .then((fresh) => {
        if (fresh && fresh.updated_at !== rowNow.current?.updated_at && fresh.updated_by !== session?.userId) setTheirs(true);
      })
      .catch(() => {});
  }, [live, load, s.id, session?.userId]);

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

  const missing = useMemo(() => (d ? missingForOriginal(d) : []), [d]);

  if (!d) {
    return error ? (
      <p className="flex items-center gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
        <AlertCircle size={13} /> {error}
      </p>
    ) : (
      <SectionSkeleton lines={5} label="Loading the HAWB" className="py-6" />
    );
  }

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
      setTheirs(false);
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
  // The toolbar's controls, styled as the boxes are (HawbBoxes).
  const base = "rounded border border-border bg-surface-1 px-2 py-1 text-[12.5px] uppercase disabled:bg-surface-2 disabled:text-text-secondary";

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
            <span className="text-text-muted">Saved {formatDate(row.updated_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
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
      {theirs && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <AlertCircle size={13} className="shrink-0" />
          <span className="min-w-0 flex-1">
            Somebody else has saved this HAWB while you were editing it. Saving yours replaces theirs.
          </span>
          <button
            type="button"
            onClick={() => {
              setTheirs(false);
              void load();
            }}
            className="h-7 shrink-0 rounded-lg border border-current/30 px-2.5 font-medium hover:bg-white/40"
          >
            Load theirs, drop my changes
          </button>
        </div>
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
      <HawbBoxes d={d} update={(fn) => setD((x) => (x ? fn(x) : x))} ro={ro} chargeNames={chargeNames}>
        <p className="mt-2 text-right font-mono text-[13px] font-semibold text-text-primary">
          {row?.hawb_no ?? (
            <span className="font-sans text-[11.5px] font-normal text-text-muted">
              Numbered on the first save{finalDestination(d) && d.departure_code ? ` — ${d.departure_code}/${finalDestination(d)}/HAWB…` : ""}
            </span>
          )}
        </p>
      </HawbBoxes>

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
                  {formatDate(h.at, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
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
