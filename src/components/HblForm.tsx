import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, AlertTriangle, Check, Download, Eye, FileUp, History, Loader2, Lock, Plus, Printer, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { failureText } from "../lib/errorText";
import { formatDate } from "../lib/dates";
import { useLiveVersion } from "../lib/liveVersions";
import {
  emptyContainer,
  FIELD_LABEL,
  missingForIssue,
  refetch,
  RELEASE_HINT,
  RELEASE_LABEL,
  totalInWords,
  type HblContainer,
  type HblData,
  type ReleaseMode,
} from "../lib/hbl";
import { hblFileName, hblPdfBytes, renderHblPdf, type HblPrint } from "../lib/documents/hblPdf";
import { uploadFile } from "../services/attachments";
import { listPeople, nameOf, type Person, type Shipment } from "../services/enquiries";
import { getHbl, hblFromJob, hblHistory, jobForHbl, logHblPrint, mtoPartners, saveHbl, setHblIssued, type HblHistory, type HblRow } from "../services/hbl";
import type { Partner } from "../services/partners";
import { SectionSkeleton } from "./Loading";

/**
 * The house bill of lading, as a form (085).
 *
 * ---------------------------------------------------------------------------
 * HOW IT WORKS
 *
 * The same way the HAWB does for air. The first time it opens it is filled
 * from the job and nothing is saved until Save; after that it opens as saved,
 * and Fetch details refreshes the job's boxes — parties, vessel, ports, the
 * containers and the figures — leaving the wording the desk wrote.
 *
 * The first save that names a consignee numbers it (HBL/26-27/0001) and puts
 * the number on the shipment. How it is released — originals, telex, or an
 * express sea waybill — and how many originals are signed are chosen above
 * the form. "Issued" locks it, because the shipper, the bank or the consignee
 * is holding it; only an administrator can set it back to draft.
 *
 * It is issued under a partner's MTO registration until Aashish has its own:
 * the partner is picked here, and its name and number are copied onto the
 * B/L, so a partner record edited later does not rewrite one already out.
 *
 * Printing uses what is saved, never what is on screen and unsaved, so the
 * paper and the record cannot disagree.
 * ---------------------------------------------------------------------------
 */

export default function HblForm({ shipment: s, onChanged }: { shipment: Shipment; onChanged: () => void }) {
  const { session } = useAuth();
  const [row, setRow] = useState<HblRow | null>(null);
  const [d, setD] = useState<HblData | null>(null);
  const [release, setRelease] = useState<ReleaseMode>("original");
  const [originals, setOriginals] = useState(3);
  const [mtoId, setMtoId] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [partners, setPartners] = useState<Partner[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [history, setHistory] = useState<HblHistory[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [printOpen, setPrintOpen] = useState(false);

  const snapshot = (data: HblData | null, r: ReleaseMode, o: number, m: string | null) => JSON.stringify([data, r, o, m]);
  const dirty = d !== null && snapshot(d, release, originals, mtoId) !== saved;
  const locked = row?.status === "issued";
  const isAdmin = session?.role === "admin";

  const load = useCallback(async () => {
    setError(null);
    try {
      const [existing, mtos] = await Promise.all([getHbl(s.id), mtoPartners().catch(() => [] as Partner[])]);
      setPartners(mtos);
      setRow(existing);
      if (existing) {
        setD(existing.data);
        setRelease(existing.release_mode);
        setOriginals(existing.originals);
        setMtoId(existing.mto_partner_id);
        setSaved(snapshot(existing.data, existing.release_mode, existing.originals, existing.mto_partner_id));
      } else {
        // The only MTO on file is the one it is issued under; with several,
        // the first, and the desk changes it before saving if need be.
        const mto = mtos[0]?.id ?? null;
        setD(hblFromJob(await jobForHbl(s, mto)));
        setRelease("original");
        setOriginals(3);
        setMtoId(mto);
        // Nothing saved yet: the whole form is unsaved, and says so.
        setSaved("");
      }
    } catch (e) {
      setError(failureText(e, "Could not load the house B/L.").message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    Somebody else saving this B/L (084). With nothing unsaved here the form
    simply reads it again; with boxes typed and not saved, it only says so
    and offers to load theirs — see HawbForm.
  */
  const live = useLiveVersion("house_bills");
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
    void getHbl(s.id)
      .then((fresh) => {
        if (fresh && fresh.updated_at !== rowNow.current?.updated_at && fresh.updated_by !== session?.userId) setTheirs(true);
      })
      .catch(() => {});
  }, [live, load, s.id, session?.userId]);

  // Leaving the page with unsaved boxes asks first.
  useEffect(() => {
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [dirty]);

  const missing = useMemo(() => (d ? missingForIssue(d, release, originals) : []), [d, release, originals]);

  if (!d) {
    return error ? (
      <p className="flex items-center gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
        <AlertCircle size={13} /> {error}
      </p>
    ) : (
      <SectionSkeleton lines={5} label="Loading the house B/L" className="py-6" />
    );
  }

  const set = <K extends keyof HblData>(k: K, v: HblData[K]) => setD((x) => (x ? { ...x, [k]: v } : x));
  const setBox = (n: number, patch: Partial<HblContainer>) =>
    setD((x) => (x ? { ...x, containers: x.containers.map((c, i) => (i === n ? { ...c, ...patch } : c)) } : x));

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

  const pickMto = (id: string | null) => {
    setMtoId(id);
    const p = partners.find((x) => x.id === id);
    setD((x) => (x ? { ...x, mto_name: p ? (p.organisation || p.name).toUpperCase() : "", mto_registration: p?.mto_registration.toUpperCase() ?? "" } : x));
  };

  const pickRelease = (r: ReleaseMode) => {
    setRelease(r);
    // A sea waybill has no originals, and is made out to a named consignee.
    if (r === "express") {
      setOriginals(0);
      if (d.consignee_mode === "to_order") set("consignee_mode", "named");
    } else if (originals < 1) setOriginals(3);
  };

  const save = () =>
    run("save", async () => {
      const { row: r, numberError } = await saveHbl(s.id, { release_mode: release, originals, mto_partner_id: mtoId, data: d }, Boolean(row));
      setRow(r);
      setD(r.data);
      setRelease(r.release_mode);
      setOriginals(r.originals);
      setMtoId(r.mto_partner_id);
      setSaved(snapshot(r.data, r.release_mode, r.originals, r.mto_partner_id));
      setTheirs(false);
      if (history) setHistory(await hblHistory(s.id));
      onChanged();
      if (numberError) return `Saved. Not numbered yet: ${numberError}`;
      return r.hbl_no && !row?.hbl_no ? `Saved and numbered ${r.hbl_no}.` : "Saved.";
    });

  const fetchDetails = () =>
    run("fetch", async () => {
      if (row && !window.confirm("Refresh the parties, vessel, ports, containers and figures from the job? The description, remarks and issue details stay as they are.")) return;
      const fresh = hblFromJob(await jobForHbl(s, mtoId));
      setD(row ? refetch(d, fresh) : fresh);
      return "Filled from the job. Check it, then Save.";
    });

  const print = (kind: HblPrint, how: "view" | "download" | "file") =>
    run(`print-${how}`, async () => {
      setPrintOpen(false);
      const input = { data: row!.data, hblNo: row!.hbl_no, release: row!.release_mode, originals: row!.originals, print: kind };
      const name = hblFileName(input);
      if (how === "view") {
        const url = renderHblPdf(input).output("bloburl") as unknown as string;
        const tab = window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        if (!tab) throw new Error("The browser blocked the new tab. Allow pop-ups for this site, or use Download.");
      } else if (how === "download") {
        renderHblPdf(input).save(name);
      } else {
        await uploadFile({
          enquiryRef: s.enquiry_ref,
          file: new File([hblPdfBytes(input) as BlobPart], name, { type: "application/pdf" }),
          documentType: "House B/L",
          referenceNumber: input.hblNo,
          protected: kind === "original",
        });
      }
      const what = kind === "original" ? (row!.release_mode === "express" ? "Sea waybill" : `${row!.originals} original${row!.originals === 1 ? "" : "s"}`) : kind === "copy" ? "Copy" : "Draft";
      await logHblPrint(s.id, `${what} ${how === "file" ? "filed to Documents" : how === "view" ? "viewed" : "downloaded"}`).catch(() => {});
      if (history) setHistory(await hblHistory(s.id));
      return how === "file" ? `${name} filed on the Documents tab.` : undefined;
    });

  const toggleIssued = (issued: boolean) =>
    run("issued", async () => {
      if (issued) {
        if (dirty) throw new Error("Save first: it is issued as saved.");
        if (!row?.hbl_no) throw new Error("It is not numbered yet: name the consignee and save.");
        if (missing.length) throw new Error(`An issued B/L needs ${missing.join(", ")}.`);
        const what = release === "express" ? "the sea waybill" : `${originals} original${originals === 1 ? "" : "s"}`;
        if (!window.confirm(`Issue ${what}? The B/L locks, and only an administrator can reopen it.`)) return;
      } else if (!window.confirm("Set the issued B/L back to draft for a correction?")) return;
      await setHblIssued(s.id, issued);
      await load();
      onChanged();
      if (history) setHistory(await hblHistory(s.id));
      return issued ? "Issued. The B/L is locked." : "Back to draft for correction.";
    });

  const openHistory = () =>
    run("history", async () => {
      const [h, p] = await Promise.all([hblHistory(s.id), people.length ? Promise.resolve(people) : listPeople()]);
      setPeople(p);
      setHistory(h);
    });

  const ro = locked;
  const base =
    "rounded-lg border border-border bg-surface-1 px-2 py-1 text-[12.5px] text-text-primary hover:border-border-strong focus:border-border-strong focus:outline-none disabled:bg-surface-2 disabled:text-text-secondary";
  const T = (k: keyof HblData, placeholder = "") => (
    <input
      value={d[k] as string}
      disabled={ro}
      placeholder={placeholder}
      onChange={(e) => set(k, e.target.value.toUpperCase() as never)}
      className={`${base} h-8 w-full`}
    />
  );
  const A = (k: keyof HblData, rows = 3, placeholder = "") => (
    <textarea
      value={d[k] as string}
      disabled={ro}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => set(k, e.target.value.toUpperCase() as never)}
      className={`${base} w-full resize-y leading-snug`}
    />
  );
  const D = (k: "date_of_issue" | "on_board_date") => (
    <input type="date" value={d[k]} disabled={ro} onChange={(e) => set(k, e.target.value)} className={`${base} h-8 w-full tabular-nums`} />
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
              title={!row ? "Save the B/L first" : dirty ? "Save first: the print is of what is saved" : undefined}
              onClick={() => setPrintOpen((o) => !o)}
            />
            {printOpen && row && (
              <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-border bg-surface-1 p-1 shadow-lg">
                {locked ? (
                  <>
                    <MenuHead>{row.release_mode === "express" ? "Sea waybill" : `Originals (${row.originals})`}</MenuHead>
                    <MenuItem icon={<Eye size={13} />} onClick={() => void print("original", "view")}>View</MenuItem>
                    <MenuItem icon={<Download size={13} />} onClick={() => void print("original", "download")}>Download PDF</MenuItem>
                    <MenuItem icon={<FileUp size={13} />} onClick={() => void print("original", "file")}>File to Documents</MenuItem>
                  </>
                ) : (
                  <>
                    <MenuHead>Draft, for the shipper to check</MenuHead>
                    <MenuItem icon={<Eye size={13} />} onClick={() => void print("draft", "view")}>View</MenuItem>
                    <MenuItem icon={<Download size={13} />} onClick={() => void print("draft", "download")}>Download PDF</MenuItem>
                    <MenuItem icon={<FileUp size={13} />} onClick={() => void print("draft", "file")}>File to Documents</MenuItem>
                  </>
                )}
                <MenuHead>Copy — non-negotiable</MenuHead>
                <MenuItem icon={<Eye size={13} />} onClick={() => void print("copy", "view")}>View</MenuItem>
                <MenuItem icon={<Download size={13} />} onClick={() => void print("copy", "download")}>Download PDF</MenuItem>
              </div>
            )}
          </div>
          <Tool icon={<History size={15} />} label="History logs" busy={busy === "history"} disabled={!row || busy !== null} onClick={() => void openHistory()} />
        </div>

        <Labelled label="Release">
          <select value={release} disabled={ro} onChange={(e) => pickRelease(e.target.value as ReleaseMode)} className={`${base} h-8 w-52`} title={RELEASE_HINT[release]}>
            {(["original", "telex", "express"] as ReleaseMode[]).map((r) => (
              <option key={r} value={r}>
                {RELEASE_LABEL[r]}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Originals">
          <select value={originals} disabled={ro || release === "express"} onChange={(e) => setOriginals(Number(e.target.value))} className={`${base} h-8 w-20`}>
            {release === "express" ? <option value={0}>None</option> : [1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Labelled>
        <Labelled label="Issued under MTO of">
          {partners.length ? (
            <select value={mtoId ?? ""} disabled={ro} onChange={(e) => pickMto(e.target.value || null)} className={`${base} h-8 w-60`}>
              <option value="">Not chosen</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.organisation || p.name} · {p.mto_registration}
                </option>
              ))}
            </select>
          ) : (
            <Link to="/partners" className="flex h-8 items-center text-[12px] text-text-accent hover:underline">
              Add the MTO registration to a partner
            </Link>
          )}
        </Labelled>
        <Labelled label="Issued">
          <select
            value={locked ? "yes" : "no"}
            disabled={!row || busy !== null || (locked && !isAdmin)}
            title={locked && !isAdmin ? "Only an administrator can reopen an issued B/L" : undefined}
            onChange={(e) => void toggleIssued(e.target.value === "yes")}
            className={`${base} h-8 w-24`}
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
            <span className="text-text-muted">
              {row.hbl_no ?? "Not numbered"} · saved {formatDate(row.updated_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </span>
      </div>

      <p className="mb-3 text-[11.5px] leading-relaxed text-text-muted">{RELEASE_HINT[release]}</p>

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
          <span className="min-w-0 flex-1">Somebody else has saved this B/L while you were editing it. Saving yours replaces theirs.</span>
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
          <Lock size={13} className="mt-px shrink-0" /> This B/L has been issued, so it is locked.
          {isAdmin ? " Set Issued back to No to correct it." : " An administrator can reopen it for a correction."}
        </p>
      )}
      {!locked && row && missing.length > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] text-text-secondary">
          <AlertTriangle size={13} className="mt-px shrink-0" /> Before it can be issued it needs {missing.join(", ")}.
        </p>
      )}

      {/* ---- parties ---- */}
      <Section title="Parties">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Labelled label="Shipper / exporter">{T("shipper_name")}</Labelled>
            {A("shipper_address", 3)}
          </div>
          <div className="space-y-2">
            <Labelled label="Consignee">
              <div className="mb-1 flex gap-1" role="group" aria-label="Consignee">
                {(
                  [
                    { v: "named", label: "Named" },
                    { v: "to_order", label: "To order" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    disabled={ro || (o.v === "to_order" && release === "express")}
                    title={o.v === "to_order" && release === "express" ? "A sea waybill is made out to a named consignee" : undefined}
                    onClick={() => set("consignee_mode", o.v)}
                    aria-pressed={d.consignee_mode === o.v}
                    className={`h-7 rounded-lg border px-2.5 text-[12px] transition-colors disabled:opacity-50 ${
                      d.consignee_mode === o.v ? "border-brand bg-brand font-medium text-white" : "border-border bg-surface-1 text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {T("consignee_name", d.consignee_mode === "to_order" ? "TO ORDER OF — the bank or shipper, or leave blank" : "")}
            </Labelled>
            {A("consignee_address", 3)}
          </div>
          <div className="space-y-2">
            <Labelled label="Notify party">{T("notify_name")}</Labelled>
            {A("notify_address", 2)}
          </div>
          <Labelled label="Also notify">{A("also_notify", 3)}</Labelled>
          <div className="md:col-span-2">
            <Labelled label="For delivery of goods please apply to (our agent at destination)">{A("delivery_agent", 3)}</Labelled>
          </div>
        </div>
      </Section>

      {/* ---- routing ---- */}
      <Section title="Routing">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Labelled label="Pre-carriage by">{T("pre_carriage_by")}</Labelled>
          <Labelled label="Place of receipt">{T("place_of_receipt")}</Labelled>
          <Labelled label="Ocean vessel">{T("vessel")}</Labelled>
          <Labelled label="Voyage">{T("voyage")}</Labelled>
          <Labelled label="Port of loading">{T("port_of_loading")}</Labelled>
          <Labelled label="Port of discharge">{T("port_of_discharge")}</Labelled>
          <Labelled label="Place of delivery">{T("place_of_delivery")}</Labelled>
          <Labelled label="Final destination">{T("final_destination")}</Labelled>
          <Labelled label="Service">
            <input list="hbl-service" value={d.service_type} disabled={ro} onChange={(e) => set("service_type", e.target.value.toUpperCase())} className={`${base} h-8 w-full`} />
            <datalist id="hbl-service">
              {["FCL/FCL", "LCL/LCL", "FCL/LCL", "LCL/FCL", "CY/CY", "CFS/CFS"].map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </Labelled>
        </div>
      </Section>

      {/* ---- containers ---- */}
      <Section
        title="Containers"
        action={
          !ro && (
            <button type="button" onClick={() => set("containers", [...d.containers, emptyContainer()])} className="inline-flex items-center gap-1 text-[12px] text-text-accent hover:underline">
              <Plus size={12} /> Add a box
            </button>
          )
        }
      >
        {d.containers.length === 0 ? (
          <p className="text-[12px] text-text-muted">None yet. Fetch details brings in the boxes and seals from the Containers tab.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12px]">
              <thead>
                <tr className="text-left text-[11px] text-text-secondary">
                  {["Container no.", "Seal no.", "Size / type", "Packages", "Kind", "Gross kg", "CBM", ""].map((h) => (
                    <th key={h} className="px-1 pb-1 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.containers.map((c, n) => (
                  <tr key={n}>
                    {(["container_no", "seal_no", "size_type", "packages", "package_type", "gross_kg", "cbm"] as Array<keyof HblContainer>).map((k) => (
                      <td key={k} className="px-1 py-0.5">
                        <input
                          value={c[k]}
                          disabled={ro}
                          onChange={(e) => setBox(n, { [k]: e.target.value.toUpperCase() })}
                          className={`${base} h-8 w-full ${["packages", "gross_kg", "cbm"].includes(k) ? "text-right tabular-nums" : ""} ${k === "container_no" || k === "seal_no" ? "font-mono" : ""}`}
                        />
                      </td>
                    ))}
                    <td className="px-1">
                      {!ro && (
                        <button
                          type="button"
                          onClick={() => set("containers", d.containers.filter((_, i) => i !== n))}
                          aria-label={`Remove ${c.container_no || "this box"}`}
                          className="grid size-8 place-items-center rounded-lg text-text-muted hover:bg-bg-danger hover:text-text-danger"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---- the particulars ---- */}
      <Section title="Particulars furnished by the shipper">
        <div className="grid gap-3 md:grid-cols-2">
          <Labelled label="Marks and numbers">{A("marks_numbers", 3)}</Labelled>
          <Labelled label="Description of goods">{A("description", 3)}</Labelled>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Labelled label="Packages">{T("packages")}</Labelled>
          <Labelled label="Kind of packages">{T("package_type")}</Labelled>
          <Labelled label="HS code">{T("hs_code")}</Labelled>
          <Labelled label="Gross weight (kg)">{T("gross_weight_kg")}</Labelled>
          <Labelled label="Measurement (CBM)">{T("measurement_cbm")}</Labelled>
        </div>
        <label className="mt-3 flex items-center gap-2 text-[12px] text-text-secondary">
          <input type="checkbox" checked={d.shippers_load} disabled={ro} onChange={(e) => set("shippers_load", e.target.checked)} />
          Shipper&rsquo;s load, stow, count and seal — said to contain (a full box we did not see packed)
        </label>
        <p className="mt-2 text-[12px]">
          <span className="text-text-muted">Printed as: </span>
          <span className="font-medium text-text-primary">{totalInWords(d) || "—"}</span>
        </p>
        <div className="mt-3">
          <Labelled label="Remarks">{A("remarks", 2)}</Labelled>
        </div>
      </Section>

      {/* ---- freight and issue ---- */}
      <Section title="Freight and issue">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Labelled label="Freight">
            <select value={d.freight_terms} disabled={ro} onChange={(e) => set("freight_terms", e.target.value as "prepaid" | "collect")} className={`${base} h-8 w-full`}>
              <option value="prepaid">Prepaid</option>
              <option value="collect">Collect</option>
            </select>
          </Labelled>
          <Labelled label="Freight payable at">{T("freight_payable_at")}</Labelled>
          <Labelled label="Place of issue">{T("place_of_issue")}</Labelled>
          <Labelled label="Date of issue">{D("date_of_issue")}</Labelled>
          <Labelled label="Shipped on board">{D("on_board_date")}</Labelled>
          <Labelled label="Booking reference">{T("booking_ref")}</Labelled>
          <div className="sm:col-span-2">
            <Labelled label="Export references (shipping bill, invoice)">{T("export_refs")}</Labelled>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] text-text-muted">
          {d.mto_registration
            ? `Issued under MTO registration ${d.mto_registration}${d.mto_name ? ` of ${d.mto_name}` : ""}, with Aashish Logistics signing as agent.`
            : "Pick the partner whose MTO registration it is issued under, above."}
        </p>
      </Section>

      {history && <HistoryPanel history={history} people={people} onClose={() => setHistory(null)} />}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card mb-3 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Tool({
  icon,
  label,
  busy,
  disabled,
  onClick,
  primary,
  title,
}: {
  icon: ReactNode;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
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

const MenuHead = ({ children }: { children: ReactNode }) => (
  <p className="px-2.5 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-text-muted first:pt-1">{children}</p>
);

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
    <label className="block min-w-0">
      <span className="mb-0.5 block text-[11px] text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

function HistoryPanel({ history, people, onClose }: { history: HblHistory[]; people: Person[]; onClose: () => void }) {
  const show = (v: unknown) => {
    if (v === null || v === undefined || v === "") return "(blank)";
    if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 60)}…` : v;
    return Array.isArray(v) ? `${v.length} line${v.length === 1 ? "" : "s"}` : JSON.stringify(v);
  };
  const WHAT: Record<HblHistory["action"], string> = {
    created: "Created",
    updated: "Changed",
    numbered: "Numbered",
    issued: "Issued",
    reopened: "Reopened",
    printed: "Printed",
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-label="House B/L history">
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
