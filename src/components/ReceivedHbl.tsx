import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, AlertTriangle, Check, ChevronDown, ClipboardCopy, FileSearch, Loader2, PenLine, Save, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { COMPANY } from "../lib/company";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { emptyHbl, RELEASE_HINT, RELEASE_LABEL, type HblData, type ReleaseMode } from "../lib/hbl";
import { useLiveVersion } from "../lib/liveVersions";
import {
  checkAgainstJob,
  correctionsText,
  CSN_LEAD_HOURS,
  csnDue,
  jobBlanksFromBill,
  releaseChecklist,
  STAGE_LABEL,
  type CheckRow,
  type ReceivedStage,
} from "../lib/receivedHbl";
import type { CustomsRecord } from "../lib/customs";
import type { Shipment } from "../services/enquiries";
import { listPartners, type Partner } from "../services/partners";
import {
  BILL_FILE_TYPES,
  fillJobFromBill,
  getReceivedHbl,
  importCustoms,
  patchReceivedHbl,
  readBillFile,
  saveManifest,
  saveReceivedHbl,
  type ReceivedHblInput,
  type ReceivedHblRow,
} from "../services/receivedHbl";
import HblBoxes, { inputBase, Labelled, Section } from "./HblBoxes";
import { SectionSkeleton } from "./Loading";

/**
 * The origin agent's house B/L, received on our job (088).
 *
 * ---------------------------------------------------------------------------
 * THE ORDER THINGS HAPPEN IN
 *
 *   1. Their draft arrives. "Read their B/L" files the PDF on the Documents
 *      tab and reads its boxes in (Gemini); nothing is saved until Save.
 *   2. We check it against our job, box by box, send them the corrections or
 *      confirm it, and fill the job's own blanks from it where it knows more.
 *   3. Their final bill arrives: its number is the job's house B/L from then
 *      on, on the arrival notice and the DO.
 *   4. On an import we file the house-level manifest (CSN) as consol agent,
 *      due 72 hours before the vessel's ETA, on the import customs record.
 *   5. The cargo is released: an original surrendered, or the telex release,
 *      or nothing for a sea waybill; the money paid; then our DO.
 *
 * The boxes are the same component as our own B/L (HblBoxes). Around them is
 * what is different about receiving one.
 * ---------------------------------------------------------------------------
 */

type Form = Omit<ReceivedHblInput, "data"> & { data: HblData };

const blank = (): Form => ({
  issuer_partner_id: null,
  issuer_name: "",
  hbl_no: "",
  agent_ref: "",
  stage: "draft",
  corrections: "",
  release_mode: "original",
  originals: 3,
  data: emptyHbl(),
  file_id: null,
  originals_surrendered_on: null,
  telex_received_on: null,
  charges_cleared_on: null,
  do_issued_on: null,
  do_valid_until: null,
});

const fromRow = (r: ReceivedHblRow): Form => ({
  issuer_partner_id: r.issuer_partner_id,
  issuer_name: r.issuer_name,
  hbl_no: r.hbl_no,
  agent_ref: r.agent_ref,
  stage: r.stage,
  corrections: r.corrections,
  release_mode: r.release_mode,
  originals: r.originals,
  data: r.data,
  file_id: r.file_id,
  originals_surrendered_on: r.originals_surrendered_on,
  telex_received_on: r.telex_received_on,
  charges_cleared_on: r.charges_cleared_on,
  do_issued_on: r.do_issued_on,
  do_valid_until: r.do_valid_until,
});

/** The parts of the form Save writes; the release ticks save as they are ticked. */
const snapshot = (f: Form) =>
  JSON.stringify([f.issuer_partner_id, f.issuer_name, f.hbl_no, f.agent_ref, f.stage, f.corrections, f.release_mode, f.originals, f.data, f.file_id]);

const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const day = (iso: string | null) => (iso ? formatDate(iso, { day: "numeric", month: "short", year: "numeric" }) : "");

export default function ReceivedHbl({ shipment: s, onChanged }: { shipment: Shipment; onChanged: () => void }) {
  const { session } = useAuth();
  const [row, setRow] = useState<ReceivedHblRow | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [saved, setSaved] = useState("");
  const [agents, setAgents] = useState<Partner[]>([]);
  const [customs, setCustoms] = useState<CustomsRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showBoxes, setShowBoxes] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const importJob = s.trade_direction === "import";
  const dirty = f !== null && snapshot(f) !== saved;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [existing, partners, c] = await Promise.all([
        getReceivedHbl(s.id),
        listPartners().catch(() => [] as Partner[]),
        importCustoms(s.id).catch(() => null),
      ]);
      setAgents(partners.filter((p) => p.role === "overseas_agent" || p.role === "consol_partner"));
      setCustoms(c);
      setRow(existing);
      const form = existing ? fromRow(existing) : { ...blank(), hbl_no: s.forwarders_bl_no ?? "" };
      setF(form);
      setSaved(existing ? snapshot(form) : "");
      if (!existing) setShowBoxes(true);
    } catch (e) {
      setError(failureText(e, "Could not load their B/L.").message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Somebody else's save or tick (084): read again when nothing is typed here.
  const live = useLiveVersion("received_house_bills");
  const liveCustoms = useLiveVersion("shipment_customs");
  const dirtyNow = useRef(dirty);
  dirtyNow.current = dirty;
  useEffect(() => {
    if ((live || liveCustoms) && !dirtyNow.current) void load();
  }, [live, liveCustoms, load]);

  useEffect(() => {
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [dirty]);

  const checks = useMemo(() => (f ? checkAgainstJob(f.data, s, importJob ? COMPANY.legalName : undefined) : []), [f, s, importJob]);
  const blanks = useMemo(() => (f ? jobBlanksFromBill(f.data, s).filled : []), [f, s]);

  if (!f) {
    return error ? (
      <p className="flex items-center gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
        <AlertCircle size={13} /> {error}
      </p>
    ) : (
      <SectionSkeleton lines={5} label="Loading their B/L" className="py-6" />
    );
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const setBox = <K extends keyof HblData>(k: K, v: HblData[K]) => setF((x) => (x ? { ...x, data: { ...x.data, [k]: v } } : x));

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

  const save = (patch: Partial<Form> = {}) =>
    run("save", async () => {
      const next = { ...f, ...patch };
      if (!next.hbl_no.trim() && !next.data.consignee_name.trim()) throw new Error("Give it their B/L number or a consignee first, or read their PDF in.");
      const { data, ...rest } = next;
      const r = await saveReceivedHbl(s.id, { ...rest, data }, Boolean(row));
      setRow(r);
      const form = fromRow(r);
      setF(form);
      setSaved(snapshot(form));
      onChanged();
      return patch.stage && patch.stage !== row?.stage ? `Saved: ${STAGE_LABEL[patch.stage].toLowerCase()}.` : "Saved.";
    });

  const read = (file: File) =>
    run("read", async () => {
      const { fileId, reading, readError } = await readBillFile(s.enquiry_ref, file);
      setF((x) =>
        x
          ? {
              ...x,
              file_id: fileId,
              ...(reading
                ? {
                    data: reading.data,
                    hbl_no: reading.blNo || x.hbl_no,
                    agent_ref: reading.otherRef || x.agent_ref,
                    issuer_name: reading.issuer || x.issuer_name,
                    issuer_partner_id: x.issuer_partner_id ?? matchAgent(agents, reading.issuer),
                    originals: reading.originals ?? x.originals,
                  }
                : {}),
            }
          : x
      );
      setShowBoxes(true);
      if (readError) throw new Error(readError);
      return `Read ${file.name} and filed it on the Documents tab. Check the boxes below against the PDF, then Save.${reading?.draft ? " It is marked as a draft or copy." : ""}`;
    });

  const pickAgent = (id: string | null) => {
    const p = agents.find((a) => a.id === id);
    setF((x) => (x ? { ...x, issuer_partner_id: id, issuer_name: p ? (p.organisation || p.name).toUpperCase() : x.issuer_name } : x));
  };

  const fillJob = () =>
    run("fill", async () => {
      if (!window.confirm(`Fill the job's empty boxes from their B/L: ${blanks.join(", ")}? Nothing the job already says is changed.`)) return;
      const filled = await fillJobFromBill(s.id, f.data, s);
      onChanged();
      return filled.length ? `Filled on the job: ${filled.join(", ")}.` : "The job had nothing blank that the B/L knows.";
    });

  const differences = checks.filter((c) => c.state === "differs" || c.state === "missing_on_bill");
  const release = releaseChecklist({
    stage: row?.stage ?? f.stage,
    release_mode: row?.release_mode ?? f.release_mode,
    issuer_name: f.issuer_name,
    freight_terms: f.data.freight_terms,
    originals_surrendered_on: row?.originals_surrendered_on ?? null,
    telex_received_on: row?.telex_received_on ?? null,
    charges_cleared_on: row?.charges_cleared_on ?? null,
  });

  const tick = (patch: Partial<ReceivedHblInput>, said: string) =>
    run("tick", async () => {
      if (!row) throw new Error("Save their B/L first.");
      await patchReceivedHbl(s.id, patch);
      await load();
      onChanged();
      return said;
    });

  const base = inputBase;

  return (
    <div>
      {/* ---- the bill, and where it stands ---- */}
      <div className="card mb-3 p-3">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <input
            ref={fileInput}
            type="file"
            accept={BILL_FILE_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void read(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {busy === "read" ? <Loader2 size={14} className="animate-spin" /> : <FileSearch size={14} />}
            {busy === "read" ? "Reading their B/L…" : "Read their B/L"}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy !== null || (!dirty && Boolean(row))}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium disabled:opacity-50 ${
              dirty ? "border-brand bg-bg-accent text-text-accent" : "border-border bg-surface-1 text-text-secondary"
            }`}
          >
            {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {row ? "Update" : "Save"}
          </button>
          <span className="ml-auto self-center text-[11.5px]">
            {!row ? (
              <span className="text-text-warning">Not saved yet</span>
            ) : dirty ? (
              <span className="text-text-warning">Unsaved changes</span>
            ) : (
              <span className="text-text-muted">Saved {formatDate(row.updated_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            )}
          </span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Labelled label="Issued by">
            <select value={f.issuer_partner_id ?? ""} onChange={(e) => pickAgent(e.target.value || null)} className={`${base} h-8 w-full`}>
              <option value="">{f.issuer_partner_id ? "Not one of our partners" : f.issuer_name ? `${f.issuer_name} (not on file as a partner)` : "Pick the origin agent"}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.organisation || a.name}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Their B/L no.">
            <input value={f.hbl_no} onChange={(e) => set("hbl_no", e.target.value.toUpperCase())} className={`${base} h-8 w-full font-mono`} />
          </Labelled>
          <Labelled label="Their reference">
            <input value={f.agent_ref} onChange={(e) => set("agent_ref", e.target.value.toUpperCase())} className={`${base} h-8 w-full font-mono`} placeholder="DOC No., file no." />
          </Labelled>
          <div className="grid grid-cols-[1fr_72px] gap-2">
            <Labelled label="Release">
              <select
                value={f.release_mode}
                onChange={(e) => {
                  const r = e.target.value as ReleaseMode;
                  setF((x) => (x ? { ...x, release_mode: r, originals: r === "express" ? 0 : x.originals || 3 } : x));
                }}
                title={RELEASE_HINT[f.release_mode]}
                className={`${base} h-8 w-full`}
              >
                {(["original", "telex", "express"] as ReleaseMode[]).map((r) => (
                  <option key={r} value={r}>
                    {RELEASE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Labelled>
            <Labelled label="Originals">
              <select value={f.originals} disabled={f.release_mode === "express"} onChange={(e) => set("originals", Number(e.target.value))} className={`${base} h-8 w-full`}>
                {f.release_mode === "express" ? <option value={0}>None</option> : [1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Labelled>
          </div>
        </div>

        {/* Where the bill stands. Each step saves the form with it. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3" role="group" aria-label="Where their B/L stands">
          {(["draft", "confirmed", "final"] as ReceivedStage[]).map((st, n) => (
            <button
              key={st}
              type="button"
              disabled={busy !== null}
              onClick={() => (st === f.stage && !dirty ? undefined : void save({ stage: st }))}
              aria-pressed={f.stage === st}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors disabled:opacity-60 ${
                f.stage === st ? "border-brand bg-brand font-medium text-white" : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
              }`}
            >
              <span className="tabular-nums opacity-70">{n + 1}</span>
              {STAGE_LABEL[st]}
            </button>
          ))}
          {row?.confirmed_at && <span className="ml-1 text-[11.5px] text-text-muted">confirmed {day(row.confirmed_at)}</span>}
        </div>
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

      {/* ---- their draft against our job ---- */}
      {checks.length > 0 && (
        <Section
          title="Their B/L against our job"
          action={
            <span className={`text-[12px] font-medium ${differences.length ? "text-text-warning" : "text-text-success"}`}>
              {differences.length ? `${differences.length} to correct` : "Matches the job"}
            </span>
          }
        >
          <CheckTable rows={checks} />
          <div className="mt-3 flex flex-wrap gap-2">
            {differences.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const text = correctionsText(checks, f.hbl_no);
                  set("corrections", text);
                  void navigator.clipboard
                    ?.writeText(text)
                    .then(() => setNote("Corrections copied — paste them into your reply to the agent. Save to keep them on the job."))
                    .catch(() => setNote("Corrections written below. Save to keep them on the job."));
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary"
              >
                <ClipboardCopy size={13} /> Copy the corrections for the agent
              </button>
            )}
            {blanks.length > 0 && (
              <button
                type="button"
                onClick={() => void fillJob()}
                disabled={busy !== null}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
              >
                <PenLine size={13} /> Fill the job&rsquo;s blanks from it ({blanks.length})
              </button>
            )}
          </div>
          {(f.corrections || differences.length > 0) && (
            <div className="mt-3">
              <Labelled label="Corrections sent to the agent">
                <textarea value={f.corrections} rows={Math.min(8, Math.max(2, f.corrections.split("\n").length))} onChange={(e) => set("corrections", e.target.value)} className={`${base} w-full resize-y leading-snug`} />
              </Labelled>
            </div>
          )}
        </Section>
      )}

      {/* ---- the boxes ---- */}
      <button
        type="button"
        onClick={() => setShowBoxes((v) => !v)}
        aria-expanded={showBoxes}
        className="mb-3 flex w-full items-center justify-between rounded-lg border border-border bg-surface-1 px-4 py-2.5 text-[12.5px] font-medium text-text-primary hover:bg-surface-2"
      >
        The boxes on their B/L
        <ChevronDown size={14} className={`transition-transform ${showBoxes ? "rotate-180" : ""}`} />
      </button>
      {showBoxes && <HblBoxes d={f.data} set={setBox} ro={false} variant="theirs" express={f.release_mode === "express"} />}

      {/* ---- the manifest, and releasing the cargo: imports ---- */}
      {importJob ? (
        <>
          <Manifest shipment={s} customs={customs} onSaved={(c) => setCustoms(c)} run={run} busy={busy} />
          <Release
            shipment={s}
            row={row}
            items={release.items}
            ready={release.ready}
            busy={busy}
            onTick={tick}
          />
        </>
      ) : (
        <p className="mt-3 max-w-prose text-[11px] leading-relaxed text-text-muted">
          The manifest (CSN) and the release to the consignee appear here on an import job. This job is marked {s.trade_direction ?? "without a direction"}.
        </p>
      )}
    </div>
  );
}

/** The agent on file whose name the reading's issuer contains, if there is exactly one. */
function matchAgent(agents: Partner[], issuer: string): string | null {
  const key = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  const k = key(issuer);
  if (!k) return null;
  const hits = agents.filter((a) => {
    const n = key(a.organisation || a.name);
    return n && (k.includes(n) || n.includes(k));
  });
  return hits.length === 1 ? hits[0].id : null;
}

const CHECK_TONE: Record<CheckRow["state"], { text: string; className: string }> = {
  same: { text: "Same", className: "bg-bg-success text-text-success" },
  differs: { text: "Differs", className: "bg-bg-danger text-text-danger" },
  missing_on_bill: { text: "Missing on B/L", className: "bg-bg-warning text-text-warning" },
  not_on_job: { text: "Not on our job", className: "bg-surface-2 text-text-secondary" },
};

function CheckTable({ rows }: { rows: CheckRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[12px]">
        <thead>
          <tr className="text-left text-[11px] text-text-secondary">
            <th className="px-2 pb-1.5 font-medium">Box</th>
            <th className="px-2 pb-1.5 font-medium">Their B/L</th>
            <th className="px-2 pb-1.5 font-medium">Our job</th>
            <th className="px-2 pb-1.5 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.key} className={r.state === "differs" ? "bg-bg-danger/40" : undefined}>
              <td className="whitespace-nowrap px-2 py-1.5 text-text-secondary">{r.label}</td>
              <td className="px-2 py-1.5 text-text-primary">{r.theirs || <span className="text-text-muted">—</span>}</td>
              <td className="px-2 py-1.5 text-text-primary">{r.ours || <span className="text-text-muted">—</span>}</td>
              <td className="px-2 py-1.5 text-right">
                <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium ${CHECK_TONE[r.state].className}`}>{CHECK_TONE[r.state].text}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The house-level manifest we file as consol agent
// ---------------------------------------------------------------------------

function Manifest({
  shipment: s,
  customs,
  onSaved,
  run,
  busy,
}: {
  shipment: Shipment;
  customs: CustomsRecord | null;
  onSaved: (c: CustomsRecord) => void;
  run: (key: string, fn: () => Promise<string | void>) => Promise<void>;
  busy: string | null;
}) {
  const due = csnDue(s.eta, s.eta_time, customs?.csn_filed_on ?? null);
  const save = (patch: Parameters<typeof saveManifest>[1]) =>
    run("manifest", async () => {
      onSaved(await saveManifest(s.id, patch));
    });
  const tone =
    due.state === "filed"
      ? "bg-bg-success text-text-success"
      : due.state === "overdue"
        ? "bg-bg-danger text-text-danger"
        : due.state === "soon"
          ? "bg-bg-warning text-text-warning"
          : "bg-surface-2 text-text-secondary";
  const dueText = due.due ? formatDate(due.due.toISOString(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "";
  const left =
    due.hoursLeft === null
      ? ""
      : Math.abs(due.hoursLeft) < 48
        ? `${Math.abs(due.hoursLeft)} hr`
        : `${Math.round(Math.abs(due.hoursLeft) / 24)} days`;

  return (
    <Section title="Manifest (CSN) — we file it as consol agent">
      <p className={`mb-3 rounded-lg px-3 py-2 text-[12px] ${tone}`}>
        {due.state === "filed"
          ? `CSN filed on ${formatDate(customs!.csn_filed_on!, { day: "numeric", month: "short", year: "numeric" })}.`
          : due.state === "no_eta"
            ? `Due ${CSN_LEAD_HOURS} hours before the vessel's ETA. The job has no ETA yet.`
            : due.state === "overdue"
              ? `Overdue: it was due ${dueText}, ${left} ago.`
              : `Due ${dueText} (${CSN_LEAD_HOURS} hours before ETA), ${left} from now.`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SaveField label="IGM no." value={customs?.igm_number ?? ""} onSave={(v) => save({ igm_number: v || null })} disabled={busy !== null} />
        <SaveField label="IGM date" type="date" value={customs?.igm_date ?? ""} onSave={(v) => save({ igm_date: v || null })} disabled={busy !== null} />
        <SaveField label="Line no. (the master's)" value={customs?.igm_item ?? ""} onSave={(v) => save({ igm_item: v || null })} disabled={busy !== null} />
        <SaveField label="Sub-line no. (this B/L)" value={customs?.igm_subline ?? ""} onSave={(v) => save({ igm_subline: v || null })} disabled={busy !== null} />
        <SaveField label="CFS code" value={customs?.cfs_code ?? ""} onSave={(v) => save({ cfs_code: v.toUpperCase() || null })} disabled={busy !== null} />
        <SaveField label="CSN no." value={customs?.csn_no ?? ""} onSave={(v) => save({ csn_no: v.toUpperCase() || null })} disabled={busy !== null} />
        <SaveField label="CSN filed on" type="date" value={customs?.csn_filed_on ?? ""} onSave={(v) => save({ csn_filed_on: v || null })} disabled={busy !== null} />
      </div>
      <p className="mt-2 text-[11px] text-text-muted">
        The same IGM numbers the bill of entry reads, kept on the job&rsquo;s import customs record (the <Link to={`/shipments/${s.id}/customs`} className="text-text-accent hover:underline">Customs tab</Link>).
      </p>
    </Section>
  );
}

function SaveField({ label, value, onSave, type = "text", disabled }: { label: string; value: string; onSave: (v: string) => void; type?: "text" | "date"; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Labelled label={label}>
      <input
        type={type}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== value && onSave(draft.trim())}
        className={`${inputBase} h-8 w-full ${type === "date" ? "tabular-nums" : "font-mono"}`}
      />
    </Labelled>
  );
}

// ---------------------------------------------------------------------------
// Releasing the cargo
// ---------------------------------------------------------------------------

function Release({
  shipment: s,
  row,
  items,
  ready,
  busy,
  onTick,
}: {
  shipment: Shipment;
  row: ReceivedHblRow | null;
  items: ReturnType<typeof releaseChecklist>["items"];
  ready: boolean;
  busy: string | null;
  onTick: (patch: Partial<ReceivedHblInput>, said: string) => Promise<void>;
}) {
  const [validDays, setValidDays] = useState(7);
  return (
    <Section title="Release and delivery order">
      {!row ? (
        <p className="text-[12px] text-text-muted">Save their B/L first.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`grid size-5 shrink-0 place-items-center rounded-full ${i.done ? "bg-bg-success text-text-success" : "bg-surface-2 text-text-muted"}`}>
                  {i.done ? <Check size={12} /> : <span className="size-1.5 rounded-full bg-current" />}
                </span>
                <span className={`text-[12.5px] ${i.done ? "text-text-primary" : "text-text-secondary"}`}>{i.label}</span>
                {i.key === "final" ? (
                  !i.done && <span className="text-[11.5px] text-text-muted">— mark it at the top when the final bill is in</span>
                ) : i.done ? (
                  <>
                    <span className="text-[11.5px] text-text-muted">{day(i.on)}</span>
                    <button type="button" disabled={busy !== null || Boolean(row.do_issued_on)} onClick={() => void onTick({ [i.key]: null }, "Unticked.")} className="text-[11.5px] text-text-muted hover:text-text-danger disabled:opacity-40" aria-label={`Untick: ${i.label}`}>
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={busy !== null} onClick={() => void onTick({ [i.key]: todayIst() }, `${i.label}: ticked for today.`)} className="h-7 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60">
                    Done today
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-4 border-t border-border pt-3">
            {row.do_issued_on ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-bg-success px-2.5 py-1 text-[12px] font-medium text-text-success">
                  <Check size={12} /> DO issued {day(row.do_issued_on)}
                  {row.do_valid_until && `, valid until ${day(row.do_valid_until)}`}
                </span>
                <Link to={`/shipments/${s.id}/documents`} className="text-[12px] text-text-accent hover:underline">
                  Print it from the Documents tab
                </Link>
                <button type="button" disabled={busy !== null} onClick={() => void onTick({ do_issued_on: null, do_valid_until: null }, "DO withdrawn.")} className="text-[11.5px] text-text-muted hover:text-text-danger">
                  Withdraw
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!ready || busy !== null}
                  title={ready ? undefined : "Every line above has to be done first"}
                  onClick={() => {
                    const on = todayIst();
                    void onTick({ do_issued_on: on, do_valid_until: addDays(on, validDays) }, "DO issued. Print it from the Documents tab.");
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  <Check size={14} /> Issue the DO
                </button>
                <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                  valid for
                  <select value={validDays} onChange={(e) => setValidDays(Number(e.target.value))} className={`${inputBase} h-8`}>
                    {[3, 5, 7, 10, 15, 30].map((n) => (
                      <option key={n} value={n}>
                        {n} days
                      </option>
                    ))}
                  </select>
                </label>
                {!ready && (
                  <span className="flex items-center gap-1 text-[11.5px] text-text-muted">
                    <AlertTriangle size={12} /> {items.filter((i) => !i.done).length} still to do
                  </span>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

