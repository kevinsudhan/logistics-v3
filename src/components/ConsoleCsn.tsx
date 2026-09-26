import { useEffect, useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, Check, ChevronDown, ChevronRight, Download, FileJson, FilePen, Loader2, Plus, Save, Trash2, Upload } from "lucide-react";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { csnDue } from "../lib/receivedHbl";
import { amendmentProblems, asFiled, buildAmendment, buildCsn, csnJson, csnProblems, type CsnContainer, type CsnDraft, type CsnHouse, type CsnItem, type CsnParty, type CsnPlace, type CsnSettings } from "../lib/icegateCsn";
import { readCsnReply, whereInForm } from "../lib/icegateReply";
import { applyCsnReply, csnDraftFor, csnEventFor, csnFilesFor, filedDraftFor, loadCsnSettings, newCsnFile, recordCsn, saveCsnDraft, saveCsnSettings, type CsnFileRow, type ReplyOutcome } from "../services/icegateCsn";
import type { Console } from "../services/consoles";

/**
 * The CSN for ICEGATE, on an import console (097).
 *
 * The desk files the Cargo Summary Notification as consol agent: the carrier's
 * master B/L and every house B/L under it, 72 hours before the vessel arrives.
 * This lays out what ICEGATE's file needs, filled from the console and its
 * house bills; lists what is still missing or wrong, in the words the desk
 * uses; and makes the file, named and numbered as ICEGATE expects, for the
 * desk to sign with its certificate and upload. The CSN number that comes back
 * is recorded here, on the console and every job, which clears the jobs' "CSN
 * due" alerts.
 *
 * ICEGATE's reply to a file (its …_ACK.json or …_SFL.json) is read in here
 * too (100): kept on the file it answers, its errors shown where they are in
 * the form, and on an accepted live file the CSN number and the CINs recorded.
 *
 * Once the CSN number is recorded, a change to the form becomes an amendment
 * (SCA, 099): what changed since the last live file, and only that, against
 * the CSN it amends.
 *
 * The format and every rule are CBIC's: lib/icegateCsn.ts, docs/icegate-csn.
 */
export default function ConsoleCsn({ console: c, onChanged }: { console: Console; onChanged: () => void }) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<CsnSettings | null>(null);
  const [draft, setDraft] = useState<CsnDraft | null>(null);
  const [files, setFiles] = useState<CsnFileRow[]>([]);
  /** What ICEGATE holds, as far as the CRM knows: the form kept with the last live file. */
  const [filed, setFiled] = useState<CsnDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [csnNo, setCsnNo] = useState(c.csn_no ?? "");
  const [csnDate, setCsnDate] = useState(c.csn_date ?? "");
  const [openHouse, setOpenHouse] = useState<string | null>(null);
  /** The reply just read in, and the file whose reply is shown open. */
  const [outcome, setOutcome] = useState<ReplyOutcome | null>(null);
  const [openJob, setOpenJob] = useState<number | null>(null);

  useEffect(() => {
    if (!open || draft) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await loadCsnSettings();
        const [d, f, was] = await Promise.all([csnDraftFor(c, s), csnFilesFor(c.id), filedDraftFor(c.id)]);
        if (cancelled) return;
        setSettings(s);
        setDraft(d);
        setFiles(f);
        setFiled(was);
      } catch (e) {
        if (!cancelled) setError(failureText(e, "Could not gather the console for the CSN.").message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, draft, c]);

  const event = csnEventFor(c) ?? "SCE";
  const exp = event === "SCX";
  const problems = useMemo(() => (draft && settings ? csnProblems(draft, settings) : []), [draft, settings]);
  const errors = problems.filter((p) => p.level === "error");
  const due = csnDue(c.eta, null, c.csn_date);
  const csnRef = { no: c.csn_no ?? "", date: c.csn_date ?? "" };
  const amendment = useMemo(
    () => (c.csn_no && draft && settings && filed ? buildAmendment(filed, draft, settings, { jobNo: 1, date: "20260101", time: "T00:00" }, { no: c.csn_no, date: c.csn_date ?? "" }) : null),
    [c.csn_no, c.csn_date, draft, settings, filed],
  );
  // What only the amendment needs; the form's own problems are listed above it.
  const amendProblems = useMemo(
    () => (c.csn_no && draft && settings ? amendmentProblems(filed, draft, settings, { no: c.csn_no, date: c.csn_date ?? "" }).filter((p) => p.where === "Amendment") : []),
    [c.csn_no, c.csn_date, draft, settings, filed],
  );

  /** Change the draft in place, on a copy. */
  const change = (fn: (d: CsnDraft) => void) =>
    setDraft((d) => {
      if (!d) return d;
      const next = structuredClone(d);
      fn(next);
      return next;
    });

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  /** Hand the browser a file to save. */
  function save(name: string, doc: Record<string, unknown>) {
    const url = URL.createObjectURL(new Blob([csnJson(doc)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /** After a file is made: the list, and what ICEGATE holds once a live one is accepted. */
  async function afterFile(indicator: "P" | "T") {
    const [f, was] = await Promise.all([csnFilesFor(c.id), indicator === "P" ? filedDraftFor(c.id) : Promise.resolve(filed)]);
    setFiles(f);
    setFiled(was);
  }

  const download = () =>
    act("download", async () => {
      if (!draft || !settings) return;
      await saveCsnDraft(c.id, draft);
      const file = await newCsnFile(c.id, event, draft.houses.length, draft.indicator, asFiled(null, draft));
      save(file.file_name, buildCsn(draft, settings, { jobNo: file.job_no, date: file.date, time: file.time }));
      await afterFile(draft.indicator);
      setNote(`Made ${file.file_name}. Sign it with ICEGATE's signing utility and your Class III certificate, then upload it on ICEGATE. When the CSN number comes back, record it below.`);
    });

  const readReply = (upload: File) =>
    act("reply", async () => {
      if (!settings) return;
      setOutcome(null);
      const reply = readCsnReply(await upload.text(), upload.name);
      const o = await applyCsnReply(c, reply, settings);
      setOutcome(o);
      setOpenJob(o.status === "accepted" ? null : o.file.job_no);
      await afterFile("P");
      if (o.recorded.some((x) => x.startsWith("CSN "))) {
        setCsnNo(reply.csnNo);
        setCsnDate(reply.csnDate || reply.date);
      }
      if (o.recorded.length) onChanged();
    });

  const downloadAmendment = () =>
    act("amend", async () => {
      if (!draft || !settings || !filed) return;
      await saveCsnDraft(c.id, draft);
      const file = await newCsnFile(c.id, "SCA", draft.houses.length, draft.indicator, asFiled(filed, draft));
      const a = buildAmendment(filed, draft, settings, { jobNo: file.job_no, date: file.date, time: file.time }, csnRef);
      if (!a.doc) throw new Error("Nothing has changed since the CSN was filed.");
      save(file.file_name, a.doc);
      await afterFile(draft.indicator);
      setNote(`Made ${file.file_name}, amending CSN ${csnRef.no}. Sign it and upload it on ICEGATE as you did the CSN.${draft.indicator === "P" ? " The next amendment will compare with the form as it stands now." : ""}`);
    });

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">CSN for ICEGATE</h3>
        {c.csn_no ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-bg-success px-2 py-0.5 text-[11px] text-text-success">
            <Check size={11} /> CSN {c.csn_no}
            {c.csn_date ? ` · ${formatDate(c.csn_date, { day: "numeric", month: "short" })}` : ""}
          </span>
        ) : exp ? (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary">
            CSN on exit: before the vessel sails{c.etd ? ` (ETD ${formatDate(c.etd, { day: "numeric", month: "short" })})` : ""}
          </span>
        ) : due.due ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${due.state === "overdue" ? "bg-bg-danger text-text-danger" : due.state === "soon" ? "bg-bg-warning text-text-warning" : "bg-surface-2 text-text-secondary"}`}>
            {due.state === "overdue" ? "Overdue — was due " : "Due by "}
            {formatDate(due.due.toISOString(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })}
          </span>
        ) : (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-muted">Due 72 hours before the ETA</span>
        )}
      </div>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-primary hover:border-border-strong"
        >
          <FileJson size={13} /> Prepare the CSN file
        </button>
      ) : !draft || !settings ? (
        error ? (
          <p className="rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>
        ) : (
          <p className="flex items-center gap-2 text-[12px] text-text-muted">
            <Loader2 size={12} className="animate-spin" /> Gathering the console and its house B/Ls…
          </p>
        )
      ) : (
        <div className="space-y-4 rounded-card border border-border p-3">
          <p className="text-[12px] leading-relaxed text-text-secondary">
            {exp
              ? "Export consol, CSN on exit (SCX): the master B/L as a consolidated line, the desk as its shipper, and each house B/L under it pointing at its exporter's shipping bill by the bill's PCIN, in CBIC's format."
              : "Import consol, CSN on entry (SCE): the master B/L as a consolidated line and each house B/L under it, in CBIC's format."}{" "}
            Filled from the console and the house B/Ls; check what is marked, fill what is missing, then make the file.
          </p>

          {/* ---- the desk's ICEGATE identity ---- */}
          <SettingsBlock settings={settings} admin={session?.role === "admin"} onSaved={setSettings} />

          {/* ---- the call and the master line ---- */}
          <Block title="The vessel and the master B/L">
            <Grid>
              <Text label="Vessel IMO number" value={draft.vesselImo} max={7} placeholder="7 digits" onChange={(v) => change((d) => void (d.vesselImo = v.replace(/\D/g, "")))} />
              <Text label="Voyage call number (VCN)" value={draft.vcn} max={35} upper placeholder="from the line's agent" onChange={(v) => change((d) => void (d.vcn = v))} />
              <Text label="Master B/L number" value={draft.mblNo} max={20} upper onChange={(v) => change((d) => void (d.mblNo = v))} />
              <Text label="Master B/L date" type="date" value={draft.mblDate} onChange={(v) => change((d) => void (d.mblDate = v))} />
              <Text label={exp ? "Port of clearance" : "First port of entry"} value={draft.firstPort} max={10} upper placeholder={exp ? "INMAA1" : "INMAA"} onChange={(v) => change((d) => void (d.firstPort = v))} />
              <Text label="Next port of unlading" value={draft.nextPort} max={10} upper placeholder={exp ? "AEJEA" : "INMAA"} onChange={(v) => change((d) => void (d.nextPort = v))} />
              <Text label={exp ? "Final destination" : "CFS / ICD custodian code"} value={draft.destPort} max={10} upper placeholder={exp ? "AEJEA" : ""} onChange={(v) => change((d) => void (d.destPort = v))} />
              <label className="block text-[11px] text-text-secondary">
                Cargo movement
                <select value={draft.movement} onChange={(e) => change((d) => void (d.movement = e.target.value as CsnDraft["movement"]))} className="mt-1 h-8 w-full text-[12px]">
                  {exp ? (
                    <>
                      <option value="TC">Foreign transhipment (TC)</option>
                      <option value="FT">Foreign transit (FT)</option>
                      <option value="TI">Domestic transhipment (TI)</option>
                    </>
                  ) : (
                    <>
                      <option value="LC">Local clearance (LC)</option>
                      <option value="DT">Domestic transit (DT)</option>
                      <option value="TI">Domestic transhipment (TI)</option>
                    </>
                  )}
                </select>
              </label>
            </Grid>
            {(exp || draft.movement === "TI") && (
              <Grid>
                <Text label="Transhipper code (the carrier's)" value={draft.transhipper?.code ?? ""} max={10} upper onChange={(v) => change((d) => void (d.transhipper = { code: v, bond: d.transhipper?.bond ?? "" }))} />
                <Text label="Transhipper bond" value={draft.transhipper?.bond ?? ""} max={10} upper onChange={(v) => change((d) => void (d.transhipper = { code: d.transhipper?.code ?? "", bond: v }))} />
              </Grid>
            )}
            <Grid>
              <Place label="Port of acceptance" place={draft.acceptance} onChange={(p) => change((d) => void (d.acceptance = p))} />
              <Place label="Port of receipt" place={draft.receipt} onChange={(p) => change((d) => void (d.receipt = p))} />
              <Place label="Itinerary: from" place={draft.itinerary.from} onChange={(p) => change((d) => void (d.itinerary.from = p))} />
              <Place label="Itinerary: to" place={draft.itinerary.to} onChange={(p) => change((d) => void (d.itinerary.to = p))} />
            </Grid>
            <PartyEditor
              title={exp ? "Shipper on the master B/L (the desk, with its IEC)" : "Shipper on the master B/L (the origin agent)"}
              party={draft.consignor}
              withCode={exp}
              onChange={(p) => change((d) => void (d.consignor = p))}
            />
            <PartyEditor
              title={exp ? "Consignee on the master B/L (the destination agent)" : "Consignee on the master B/L (the desk)"}
              party={draft.consignee}
              withCode={!exp}
              onChange={(p) => change((d) => void (d.consignee = p))}
            />
            <PartyEditor title="Notify party on the master B/L" party={draft.notify} onChange={(p) => change((d) => void (d.notify = p))} />
            <Grid>
              <Text label="Packages" value={draft.packages} onChange={(v) => change((d) => void (d.packages = v))} />
              <Text label="Gross weight (kg)" value={draft.grossKg} onChange={(v) => change((d) => void (d.grossKg = v))} />
              <Text label="Marks and numbers" value={draft.marks} max={512} onChange={(v) => change((d) => void (d.marks = v))} />
              <Text label="Description of goods" value={draft.description} max={512} onChange={(v) => change((d) => void (d.description = v))} />
            </Grid>
            <Boxes list={draft.containers} onChange={(list) => change((d) => void (d.containers = list))} />
          </Block>

          {/* ---- each house B/L ---- */}
          <Block title={`House B/Ls (${draft.houses.length})`}>
            {draft.houses.length === 0 && <p className="text-[12px] text-text-muted">No jobs on this console yet.</p>}
            {draft.houses.map((h, i) => {
              const mine = errors.filter((p) => p.where === (h.ref || h.hblNo || "House"));
              const isOpen = openHouse === h.shipmentId;
              const set = (fn: (x: CsnHouse) => void) => change((d) => fn(d.houses[i]));
              return (
                <div key={h.shipmentId} className="rounded-lg border border-border">
                  <button type="button" onClick={() => setOpenHouse(isOpen ? null : h.shipmentId)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]">
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span className="font-medium text-text-primary">{h.hblNo || "No house B/L number"}</span>
                    <span className="text-text-muted">{h.ref}</span>
                    <span className="truncate text-text-secondary">{exp ? h.consignor.name : h.consignee.name}</span>
                    <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] ${mine.length ? "bg-bg-danger text-text-danger" : "bg-bg-success text-text-success"}`}>
                      {mine.length ? `${mine.length} to fix` : "Ready"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-3 border-t border-border px-3 py-3">
                      <Grid>
                        <Text label="House B/L number" value={h.hblNo} max={20} upper onChange={(v) => set((x) => void (x.hblNo = v))} />
                        <Text label="House B/L date" type="date" value={h.hblDate} onChange={(v) => set((x) => void (x.hblDate = v))} />
                        {exp ? (
                          <>
                            <label className="block text-[11px] text-text-secondary">
                              Shipping bill
                              <p className="mt-1 flex h-8 items-center text-[12px] text-text-primary">
                                {h.sbNo ? `${h.sbNo}${h.sbDate ? ` of ${formatDate(h.sbDate, { day: "numeric", month: "short", year: "numeric" })}` : ""}` : "Not on the job's export customs yet"}
                              </p>
                            </label>
                            <Text label="PCIN of the shipping bill" value={h.pcin ?? ""} max={20} upper placeholder="from the exporter's CHA" onChange={(v) => set((x) => void (x.pcin = v))} />
                          </>
                        ) : (
                          <Text label="CFS / ICD custodian code" value={h.destPort} max={10} upper onChange={(v) => set((x) => void (x.destPort = v))} />
                        )}
                      </Grid>
                      {exp && draft.movement === "FT" ? (
                        <p className="text-[11px] text-text-muted">On foreign transit the guide asks only for the shipping bill's PCIN, the container and the measures for each house; the parties below are not sent.</p>
                      ) : null}
                      <Grid>
                        <Place label="Port of acceptance" place={h.acceptance} onChange={(p) => set((x) => void (x.acceptance = p))} />
                        <Place label="Port of receipt" place={h.receipt} onChange={(p) => set((x) => void (x.receipt = p))} />
                        {exp && <Text label="Final destination" value={h.destPort} max={10} upper onChange={(v) => set((x) => void (x.destPort = v))} />}
                      </Grid>
                      <PartyEditor title={exp ? "Shipper (the exporter, with its IEC)" : "Shipper"} party={h.consignor} withCode={exp} onChange={(p) => set((x) => void (x.consignor = p))} />
                      <PartyEditor title={exp ? "Consignee (overseas)" : "Consignee (the importer)"} party={h.consignee} withCode={!exp} onChange={(p) => set((x) => void (x.consignee = p))} />
                      <PartyEditor title="Notify party" party={h.notify} onChange={(p) => set((x) => void (x.notify = p))} />
                      <Grid>
                        <Text label="Packages" value={h.packages} onChange={(v) => set((x) => void (x.packages = v))} />
                        <Text label="Gross weight (kg)" value={h.grossKg} onChange={(v) => set((x) => void (x.grossKg = v))} />
                        <Text label="Net weight (kg)" value={h.netKg} onChange={(v) => set((x) => void (x.netKg = v))} />
                        <Text label="Marks and numbers" value={h.marks} max={512} onChange={(v) => set((x) => void (x.marks = v))} />
                      </Grid>
                      <Text label="Description of goods, as on the B/L" value={h.description} max={512} onChange={(v) => set((x) => void (x.description = v))} />
                      {/* An export house carries no items: its shipping bill already describes them. */}
                      {!exp && <Items list={h.items} onChange={(list) => set((x) => void (x.items = list))} />}
                      <Boxes list={h.containers} onChange={(list) => set((x) => void (x.containers = list))} />
                    </div>
                  )}
                </div>
              );
            })}
          </Block>

          {/* ---- what stands in the way ---- */}
          {problems.length > 0 ? (
            <div className={`rounded-lg px-3 py-2 text-[12px] ${errors.length ? "bg-bg-danger text-text-danger" : "bg-bg-warning text-text-warning"}`}>
              <p className="flex items-center gap-1.5 font-medium">
                {errors.length ? <AlertCircle size={13} /> : <AlertTriangle size={13} />}
                {errors.length ? `${errors.length} thing${errors.length === 1 ? "" : "s"} ICEGATE would refuse` : "Worth a look before filing"}
              </p>
              <ul className="mt-1 space-y-0.5 pl-5">
                {problems.map((p, k) => (
                  <li key={k} className={`list-disc ${p.level === "warning" ? "text-text-warning" : ""}`}>
                    <strong className="font-medium">{p.where}</strong> · {p.field} {p.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 rounded-lg bg-bg-success px-3 py-2 text-[12px] text-text-success">
              <Check size={13} /> Everything ICEGATE checks is in order.
            </p>
          )}

          {error && <p className="rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}
          {note && <p className="rounded-lg bg-bg-success px-3 py-2 text-[12px] text-text-success">{note}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <select value={draft.indicator} onChange={(e) => change((d) => void (d.indicator = e.target.value as "P" | "T"))} className="h-8 text-[12px]" aria-label="Live filing or test file">
              <option value="P">Live filing (P)</option>
              <option value="T">Test file (T)</option>
            </select>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act("save", async () => {
                await saveCsnDraft(c.id, draft);
                setNote("Saved.");
              })}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-primary hover:border-border-strong disabled:opacity-60"
            >
              {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
            </button>
            <button
              type="button"
              disabled={busy !== null || errors.length > 0}
              onClick={download}
              title={errors.length ? "Fix what is listed above first" : c.csn_no ? "The CSN is on record: to change it, amend it below" : undefined}
              className={
                c.csn_no
                  ? "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-primary hover:border-border-strong disabled:opacity-50"
                  : "inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              }
            >
              {busy === "download" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {c.csn_no ? "Download a fresh CSN file" : "Download the CSN file"}
            </button>
          </div>

          {/* ---- after ICEGATE ---- */}
          <Block
            title="ICEGATE's reply"
            note="Upload the …_ACK.json or …_SFL.json ICEGATE sent back. The CRM finds the file it answers, shows what ICEGATE said, and on an accepted live file records the CSN number and the CINs."
          >
            <label
              className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-primary hover:border-border-strong ${busy !== null ? "pointer-events-none opacity-60" : ""}`}
            >
              {busy === "reply" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Read a reply
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                disabled={busy !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) readReply(f);
                }}
              />
            </label>
            {outcome && <ReplyNote outcome={outcome} />}
            {files.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border text-[12px]">
                {files.map((f) => (
                  <FileLine key={f.job_no} file={f} open={openJob === f.job_no} onToggle={() => setOpenJob(openJob === f.job_no ? null : f.job_no)} />
                ))}
              </ul>
            )}
          </Block>

          <Block title="Record the CSN number by hand" note="When the reply came some other way.">
            <div className="flex flex-wrap items-end gap-2">
              <Text label="CSN number" value={csnNo} max={7} onChange={(v) => setCsnNo(v.replace(/\D/g, ""))} />
              <Text label="CSN date" type="date" value={csnDate} onChange={setCsnDate} />
              <button
                type="button"
                disabled={busy !== null || !csnNo.trim() || !csnDate}
                onClick={() =>
                  act("record", async () => {
                    await recordCsn(c, csnNo, csnDate);
                    setNote("Recorded on the console and on every job under it.");
                    onChanged();
                  })
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-primary hover:border-border-strong disabled:opacity-60"
              >
                {busy === "record" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Record
              </button>
            </div>
          </Block>

          {/* ---- amending it ---- */}
          {c.csn_no && (
            <Block
              title="Amend the CSN (SCA)"
              note={`CSN ${c.csn_no}${c.csn_date ? ` of ${formatDate(c.csn_date, { day: "numeric", month: "short", year: "numeric" })}` : ""} is on record. Change the form above; the amendment carries only what changed since the last live file.`}
            >
              {amendment && amendment.changes.length > 0 && (
                <ul className="space-y-0.5 pl-5 text-[12px] text-text-primary">
                  {amendment.changes.map((x, k) => (
                    <li key={k} className="list-disc">
                      {x}
                    </li>
                  ))}
                </ul>
              )}
              {amendProblems.length > 0 && (
                <ul className="space-y-0.5 rounded-lg bg-surface-2 px-3 py-2 pl-7 text-[12px] text-text-secondary">
                  {amendProblems.map((p, k) => (
                    <li key={k} className="list-disc">
                      <strong className="font-medium">{p.field}</strong>: {p.message}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy !== null || errors.length > 0 || amendProblems.length > 0}
                  onClick={downloadAmendment}
                  title={errors.length ? "Fix what is listed above first" : amendProblems.length ? amendProblems[0].message : undefined}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  {busy === "amend" ? <Loader2 size={13} className="animate-spin" /> : <FilePen size={13} />} Download the amendment
                </button>
                <span className="text-[11px] text-text-muted">{draft.indicator === "T" ? "As a test file (T)" : "As a live filing (P)"}, per the choice above.</span>
              </div>
            </Block>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/** What the reply just read in said, and what it put on record. */
function ReplyNote({ outcome: o }: { outcome: ReplyOutcome }) {
  const name = o.file.file_name;
  const n = o.file.reply?.errors.length ?? 0;
  if (o.status === "accepted") {
    return (
      <div className="rounded-lg bg-bg-success px-3 py-2 text-[12px] text-text-success">
        <p className="flex items-center gap-1.5 font-medium">
          <Check size={13} /> ICEGATE accepted {name}.
        </p>
        {o.recorded.length > 0 && <p className="mt-1">Recorded: {o.recorded.join("; ")}.</p>}
        {o.notes.map((x, k) => (
          <p key={k} className="mt-1">
            {x}
          </p>
        ))}
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertCircle size={13} />
        {o.status === "failed" ? `ICEGATE could not read ${name}: it did not match the format.` : `ICEGATE rejected ${name}: ${n} problem${n === 1 ? "" : "s"}.`}
      </p>
      <p className="mt-1">
        {o.status === "failed"
          ? "The CRM checks every file against CBIC's published schema, so a structure failure usually means ICEGATE's live format has moved on. Keep this reply for whoever maintains the CRM."
          : "They are listed under the file below. Fix them in the form and make a new file."}
        {o.file.event === "SCA" && o.file.indicator === "P" ? " The next amendment compares with the last live file ICEGATE did not reject, so it carries these changes again." : ""}
      </p>
    </div>
  );
}

/** A file made, where ICEGATE's reply stands, and what it found wrong. */
function FileLine({ file: f, open, onToggle }: { file: CsnFileRow; open: boolean; onToggle: () => void }) {
  const errors = f.reply?.errors ?? [];
  const chip =
    f.reply_status === "accepted"
      ? { text: `Accepted${f.reply?.csnNo && f.event !== "SCA" && f.indicator === "P" ? ` · CSN ${f.reply.csnNo}` : ""}`, tone: "bg-bg-success text-text-success" }
      : f.reply_status === "rejected"
        ? { text: `Rejected · ${errors.length} problem${errors.length === 1 ? "" : "s"}`, tone: "bg-bg-danger text-text-danger" }
        : f.reply_status === "failed"
          ? { text: "Structure failed", tone: "bg-bg-danger text-text-danger" }
          : { text: "Awaiting reply", tone: "bg-surface-2 text-text-muted" };
  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-[11px] text-text-primary">{f.file_name}</span>
        <span className="text-[11px] text-text-muted">
          {f.event === "SCA" ? "amendment" : "CSN"} · {f.indicator === "T" ? "test" : "live"} · {f.houses} house B/L{f.houses === 1 ? "" : "s"} ·{" "}
          {formatDate(f.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })}
        </span>
        {errors.length > 0 ? (
          <button type="button" onClick={onToggle} className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${chip.tone}`} aria-expanded={open}>
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {chip.text}
          </button>
        ) : (
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${chip.tone}`}>{chip.text}</span>
        )}
      </div>
      {open && errors.length > 0 && (
        <ul className="mt-2 space-y-1 pl-5 text-[12px] text-text-primary">
          {errors.map((e, k) => (
            <li key={k} className="list-disc">
              <strong className="font-medium">{whereInForm(e, f.draft, f.event)}</strong>: {e.message}
              {e.code && <span className="text-text-muted"> ({e.code})</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function SettingsBlock({ settings, admin, onSaved }: { settings: CsnSettings; admin: boolean; onSaved: (s: CsnSettings) => void }) {
  const [edit, setEdit] = useState<CsnSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const missing = !settings.icegate_id || !settings.pan || !settings.authorised_pan || !settings.port_of_reporting;
  return (
    <Block title="The desk on ICEGATE" note={admin ? "Set once, for every console. Only an administrator can change these." : "Set by an administrator."}>
      <Grid>
        <Text label="ICEGATE ID" value={edit.icegate_id} upper max={30} disabled={!admin} onChange={(v) => setEdit({ ...edit, icegate_id: v })} />
        <Text label="Desk PAN" value={edit.pan} upper max={10} disabled={!admin} onChange={(v) => setEdit({ ...edit, pan: v })} />
        <Text label="Authorised person's PAN" value={edit.authorised_pan} upper max={10} disabled={!admin} onChange={(v) => setEdit({ ...edit, authorised_pan: v })} />
        <Text label="Port of reporting" value={edit.port_of_reporting} upper max={6} placeholder="INMAA1" disabled={!admin} onChange={(v) => setEdit({ ...edit, port_of_reporting: v })} />
        <Text label="Desk IEC, if not the PAN (exports)" value={edit.iec ?? ""} upper max={10} disabled={!admin} onChange={(v) => setEdit({ ...edit, iec: v })} />
      </Grid>
      {admin && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const saved = await saveCsnSettings(edit);
                onSaved(saved);
                setEdit(saved);
                setMsg("Saved.");
              } catch (e) {
                setMsg(failureText(e, "Could not save.").message);
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-primary hover:border-border-strong disabled:opacity-60"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save the desk's details
          </button>
          {msg && <span className="text-[11px] text-text-secondary">{msg}</span>}
        </div>
      )}
      {!admin && missing && <p className="text-[11px] text-text-warning">Not all set yet: ask an administrator to fill these in.</p>}
    </Block>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-medium text-text-primary">
        {title}
        {note && <span className="ml-2 font-normal text-text-muted">{note}</span>}
      </p>
      {children}
    </div>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;

function Text({
  label,
  value,
  onChange,
  max,
  placeholder,
  upper = false,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  placeholder?: string;
  upper?: boolean;
  type?: "text" | "date";
  disabled?: boolean;
}) {
  const over = max !== undefined && value.length > max;
  return (
    <label className="block text-[11px] text-text-secondary">
      <span className="flex justify-between gap-2">
        {label}
        {max !== undefined && max >= 35 && value.length > max * 0.8 && <span className={over ? "text-text-danger" : "text-text-muted"}>{value.length}/{max}</span>}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
        className={`mt-1 h-8 w-full text-[12px] ${over ? "border-text-danger" : ""}`}
      />
    </label>
  );
}

/** A place: its UN/LOCODE, and its name. One label over both. */
function Place({ label, place, onChange }: { label: string; place: CsnPlace; onChange: (p: CsnPlace) => void }) {
  return (
    <div className="block text-[11px] text-text-secondary">
      {label}
      <div className="mt-1 grid grid-cols-[84px_1fr] gap-1.5">
        <input value={place.code} placeholder="CNSHA" aria-label={`${label}: UN/LOCODE`} onChange={(e) => onChange({ ...place, code: e.target.value.toUpperCase() })} className="h-8 w-full text-[12px]" />
        <input value={place.name} placeholder="Name" aria-label={`${label}: name`} onChange={(e) => onChange({ ...place, name: e.target.value })} className="h-8 w-full text-[12px]" />
      </div>
    </div>
  );
}

function PartyEditor({ title, party, onChange, withCode = false }: { title: string; party: CsnParty; onChange: (p: CsnParty) => void; withCode?: boolean }) {
  const set = (patch: Partial<CsnParty>) => onChange({ ...party, ...patch });
  return (
    <div className="rounded-lg bg-surface-2 p-2">
      <p className="mb-1.5 text-[11px] font-medium text-text-secondary">{title}</p>
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_220px]">
        <div className="space-y-2">
          <Grid>
            <Text label="Name" value={party.name} max={70} upper onChange={(v) => set({ name: v })} />
            <Text label="Street address" value={party.street} max={70} upper onChange={(v) => set({ street: v })} />
            <Text label="City" value={party.city} max={70} upper onChange={(v) => set({ city: v })} />
            <Text label="State / province" value={party.subdivision} max={35} upper onChange={(v) => set({ subdivision: v })} />
            <Text label="Country (2 letters)" value={party.country} max={2} upper placeholder="CN" onChange={(v) => set({ country: v.slice(0, 2) })} />
            <Text label="Postcode" value={party.postcode} max={9} upper onChange={(v) => set({ postcode: v })} />
            {withCode && (
              <>
                <Text label="IEC / PAN" value={party.code} max={17} upper onChange={(v) => set({ code: v })} />
                <label className="block text-[11px] text-text-secondary">
                  Code type
                  <select value={party.codeType} onChange={(e) => set({ codeType: e.target.value as CsnParty["codeType"] })} className="mt-1 h-8 w-full text-[12px]">
                    <option value="">—</option>
                    <option value="IEC">IEC</option>
                    <option value="PAN">PAN</option>
                    <option value="GSN">GSTIN</option>
                  </select>
                </label>
              </>
            )}
          </Grid>
        </div>
        {party.source && (
          <pre className="whitespace-pre-wrap rounded border border-border bg-surface-1 p-2 font-sans text-[11px] leading-snug text-text-muted" title="As the B/L gives it">
            {party.source}
          </pre>
        )}
      </div>
    </div>
  );
}

function Boxes({ list, onChange }: { list: CsnContainer[]; onChange: (l: CsnContainer[]) => void }) {
  const set = (i: number, patch: Partial<CsnContainer>) => onChange(list.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-text-secondary">Containers</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-[12px]">
          <thead>
            <tr className="text-left text-[11px] text-text-muted">
              <th className="py-1 pr-2 font-normal">Container</th>
              <th className="py-1 pr-2 font-normal">ISO size-type</th>
              <th className="py-1 pr-2 font-normal">Load</th>
              <th className="py-1 pr-2 font-normal">Seal type</th>
              <th className="py-1 pr-2 font-normal">Seal no.</th>
              <th className="py-1 pr-2 font-normal">Packages</th>
              <th className="py-1 pr-2 font-normal">Weight kg</th>
              <th className="py-1 pr-2 font-normal">SOC</th>
              <th className="py-1 pr-2 font-normal" title="The container agent's code (its PAN with Customs); sent empty when not known">Agent code</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((b, i) => (
              <tr key={i}>
                <td className="py-0.5 pr-2"><input value={b.no} onChange={(e) => set(i, { no: e.target.value.toUpperCase().replace(/\s/g, "") })} className="h-7 w-32 text-[12px]" placeholder="TGHU8261450" /></td>
                <td className="py-0.5 pr-2"><input value={b.size} onChange={(e) => set(i, { size: e.target.value.toUpperCase().slice(0, 4) })} className="h-7 w-16 text-[12px]" placeholder="45G1" /></td>
                <td className="py-0.5 pr-2">
                  <select value={b.load} onChange={(e) => set(i, { load: e.target.value as CsnContainer["load"] })} className="h-8 w-[76px] py-0 text-[12px]">
                    <option value="FCL">FCL</option>
                    <option value="LCL">LCL</option>
                  </select>
                </td>
                <td className="py-0.5 pr-2">
                  <select value={b.sealType} onChange={(e) => set(i, { sealType: e.target.value as CsnContainer["sealType"] })} className="h-8 w-[92px] py-0 text-[12px]">
                    <option value="BTSL">Bolt</option>
                    <option value="ESEAL">E-seal</option>
                  </select>
                </td>
                <td className="py-0.5 pr-2"><input value={b.seal} onChange={(e) => set(i, { seal: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} className="h-7 w-28 text-[12px]" /></td>
                <td className="py-0.5 pr-2"><input value={b.packages} onChange={(e) => set(i, { packages: e.target.value })} className="h-7 w-20 text-[12px]" /></td>
                <td className="py-0.5 pr-2"><input value={b.weightKg} onChange={(e) => set(i, { weightKg: e.target.value })} className="h-7 w-24 text-[12px]" /></td>
                <td className="py-0.5 pr-2"><input type="checkbox" checked={b.soc} onChange={(e) => set(i, { soc: e.target.checked })} aria-label="Shipper-owned container" /></td>
                <td className="py-0.5 pr-2"><input value={b.agentCode ?? ""} onChange={(e) => set(i, { agentCode: e.target.value.toUpperCase() })} className="h-7 w-28 text-[12px]" placeholder="optional" /></td>
                <td className="py-0.5">
                  <button type="button" onClick={() => onChange(list.filter((_, k) => k !== i))} className="text-text-muted hover:text-text-danger" aria-label="Remove container">
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => onChange([...list, { no: "", size: "", load: "LCL", sealType: "BTSL", seal: "", soc: false, weightKg: "", packages: "", agentCode: "" }])}
        className="mt-1 inline-flex items-center gap-1 text-[12px] text-text-accent hover:underline"
      >
        <Plus size={12} /> Add a container
      </button>
    </div>
  );
}

function Items({ list, onChange }: { list: CsnItem[]; onChange: (l: CsnItem[]) => void }) {
  const set = (i: number, patch: Partial<CsnItem>) => onChange(list.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-text-secondary">Cargo items</p>
      <div className="space-y-1.5">
        {list.map((it, i) => (
          <div key={i} className="grid grid-cols-[100px_1fr_80px_64px_80px_20px] items-end gap-1.5">
            <Text label="HS code" value={it.hs} max={8} onChange={(v) => set(i, { hs: v.replace(/\D/g, "").slice(0, 8) })} />
            <Text label="Description" value={it.desc} max={256} onChange={(v) => set(i, { desc: v })} />
            <Text label="UN no." value={it.un} max={5} upper placeholder="ZZZZZ" onChange={(v) => set(i, { un: v })} />
            <Text label="IMDG" value={it.imdg} max={3} upper placeholder="ZZZ" onChange={(v) => set(i, { imdg: v })} />
            <Text label="Packages" value={it.packages} onChange={(v) => set(i, { packages: v })} />
            <button type="button" onClick={() => onChange(list.filter((_, k) => k !== i))} className="mb-2 text-text-muted hover:text-text-danger" aria-label="Remove item">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-text-muted">Not hazardous: UN number ZZZZZ and IMDG class ZZZ, as the guide asks.</p>
      <button type="button" onClick={() => onChange([...list, { hs: "", desc: "", un: "ZZZZZ", imdg: "ZZZ", packages: "" }])} className="mt-1 inline-flex items-center gap-1 text-[12px] text-text-accent hover:underline">
        <Plus size={12} /> Add an item
      </button>
    </div>
  );
}
