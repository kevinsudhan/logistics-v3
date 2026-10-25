import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ClipboardPaste, Loader2, Percent, Plus, Sparkles, Trash2, X } from "lucide-react";
import {
  GST_RATES,
  PASTE_CURRENCIES,
  PASTE_UNITS,
  SECTIONS,
  asSection,
  chargesLayout,
  figure,
  shareWording,
  totalInInr,
  withShares,
  type PastedLine,
  type PastedQuote,
  type Section,
  singleUnit,
} from "../lib/pastedQuote";
import { airTable } from "../lib/airQuote";
import FigureInput from "./FigureInput";
import PasteInput from "./PasteInput";
import { applyPastedQuote, draftTerms, isAirQuote, readPastedQuote, tableLayout } from "../services/pasteQuote";
import { airTableHtml, chargesHtml } from "../lib/quotationMail";
import type { Enquiry, Quote } from "../services/enquiries";
import { addToBuyRate } from "../services/buyRates";
import { mergeBuyLines, pasteSummary, type StoredBuyLine } from "../lib/buyRate";
import { listPartners, type Partner } from "../services/partners";
import { useDialog } from "../lib/useDialog";

/**
 * "Paste a quotation": the rate as the desk has it — from a mail, a WhatsApp
 * message, a rate sheet — read by the AI into charges under Freight, Ex works,
 * Destination and Other charges, checked here, then saved as the quotation's
 * charges (106). An air rate goes out as the desk's rate table, with GST (115).
 *
 * The AI only reads. Every total, every charge quoted as a percentage of
 * others, and the layout the mail carries are worked out by the app from the
 * lines shown here, which can be corrected before anything is saved: a
 * misread figure is one wrong line on this screen, not a wrong total in a
 * customer's inbox.
 *
 * The same dialog takes the partner's own rate (128, `purpose="cost"`): read
 * and checked the same way, then kept on the enquiry as what the job costs —
 * never sent to anybody — for the profit against the quotation.
 */
const MODE_NAME: Record<string, string> = { sea_fcl: "Sea FCL", sea_lcl: "Sea LCL", road: "Road" };

let fresh = 0;
const newId = () => `n${++fresh}`;

export default function PasteQuoteDialog({
  enquiry,
  live,
  liveCount,
  initialText,
  onClose,
  onApplied,
  purpose = "quote",
  partnerQuoteLabel,
  existing = [],
}: {
  enquiry: Enquiry;
  /** The quotation being written, if any: a draft has its charges replaced. */
  live: Quote | null;
  /** How many charges that draft has now, to say what is being replaced. */
  liveCount: number;
  /** What was pasted on the quotation itself: read as soon as this opens. */
  initialText?: string;
  onClose: () => void;
  onApplied: () => void;
  /** "cost": the partner's original rate, kept on the enquiry for the profit (128), not the quotation. */
  purpose?: "quote" | "cost";
  /** The partner the rate is from, when the desk already said (cost only). */
  partnerQuoteLabel?: string;
  /** The original rate as it stands (cost only): this paste is added to it (129). */
  existing?: StoredBuyLine[];
}) {
  const cost = purpose === "cost";
  const what = cost ? "partner's rate" : "quotation";
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState<string>("");
  const [partnerLabel, setPartnerLabel] = useState(partnerQuoteLabel ?? "");
  /** A completely new rate from the partner: replaces the original rate instead of adding to it. */
  const [replaceAll, setReplaceAll] = useState(false);
  useEffect(() => {
    if (!cost) return;
    void listPartners(true)
      .then(setPartners)
      .catch(() => setPartners([]));
  }, [cost]);
  const airEnquiry = isAirQuote(enquiry);
  const [text, setText] = useState(initialText ?? "");
  /** Goes out as the desk's rate table, with GST: an air enquiry, or a rate pasted as a table. */
  const air = tableLayout(enquiry, text);
  const [q, setQ] = useState<PastedQuote | null>(null);
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [termsText, setTermsText] = useState("");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Tab stays inside and focus goes back on closing; Escape stays this dialog's own, below.
  const panel = useRef<HTMLDivElement>(null);
  useDialog(panel, undefined, { escape: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if ((text.trim() || q) && !window.confirm(`Close without saving this ${what}?`)) return;
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [text, q]);

  // Pasted on the quotation already: straight to reading it.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !initialText?.trim()) return;
    started.current = true;
    void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on opening
  }, []);

  async function read() {
    if (!text.trim()) return setError(`Paste the ${what} first.`);
    setBusy("read");
    setError(null);
    try {
      const got = await readPastedQuote(enquiry, text);
      setQ(got);
      // A draft's own terms are shown with the paste's, so what is in the box is what is saved.
      const kept = cost ? [] : draftTerms(live);
      const seen = new Set(kept.map((t) => t.toLowerCase()));
      setTermsText([...kept, ...got.terms.filter((t) => !seen.has(t.toLowerCase()))].join("\n"));
    } catch (e) {
      setError(e instanceof Error ? e.message : `The ${what} could not be read.`);
    } finally {
      setBusy(null);
    }
  }

  // What will be saved: the terms as typed, every percentage charge worked out.
  const current: PastedQuote | null = useMemo(
    () => (q ? withShares({ ...q, terms: termsText.split(/\r?\n/).map((t) => t.trim()).filter(Boolean) }) : null),
    [q, termsText]
  );
  const foreign = useMemo(() => [...new Set((q?.lines ?? []).filter((l) => l.percent == null).map((l) => l.currency).filter((c) => c !== "INR"))], [q]);
  const missingRoe = foreign.filter((c) => !(q?.roe[c] && q.roe[c] > 0));
  // The charges exactly as the mail will show them (lib/quotationMail): one unit of each (5 Oct).
  // The partner's rate is never mailed: it is shown in full, quantities and all, as it costs the job.
  const preview = current ? (cost ? chargesHtml(chargesLayout(current)) : air ? airTableHtml(airTable(current, enquiry, { singleUnit: true })) : chargesHtml(chargesLayout(singleUnit(current)))) : "";

  const setLine = (i: number, patch: Partial<PastedLine>) =>
    setQ((prev) => (prev ? { ...prev, lines: prev.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) } : prev));

  /** A change to what a percentage is of: its wording follows, as the desk would now write it. */
  const setShare = (i: number, patch: Pick<PastedLine, "percent" | "percentOf">) =>
    setQ((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.map((l, k) => (k === i ? { ...l, ...patch } : l));
      lines[i] = { ...lines[i], note: shareWording(lines[i], lines) };
      return { ...prev, lines };
    });

  const removeLine = (i: number) =>
    setQ((prev) => {
      if (!prev) return prev;
      const gone = prev.lines[i]?.id;
      return {
        ...prev,
        lines: prev.lines.filter((_, k) => k !== i).map((l) => (gone && l.percentOf?.includes(gone) ? { ...l, percentOf: l.percentOf.filter((x) => x !== gone) } : l)),
      };
    });

  async function save() {
    if (!current) return;
    if (!current.lines.length) return setError("There are no charges to save.");
    if (current.lines.some((l) => !l.description.trim())) return setError("Every charge needs a name.");
    const none = current.lines.find((l) => l.percent == null && !(l.quantity > 0));
    if (none) return setError(`Give the units for ${none.description}: more than nothing.`);
    const loose = current.lines.find((l) => l.percent != null && (!l.percent || !l.percentOf?.length));
    if (loose) return setError(`Say what ${loose.description || "the percentage charge"} is a percentage of.`);
    if (missingRoe.length) return setError(`Give the rate of exchange for ${missingRoe.join(", ")}.`);
    if (cost && !partnerId && !partnerLabel.trim()) return setError("Say whose rate this is.");
    setBusy("save");
    setError(null);
    try {
      if (cost) {
        const p = partners.find((x) => x.id === partnerId);
        await addToBuyRate({ enquiry, pasted: current, pastedText: text, partnerId: partnerId || null, partnerLabel: partnerLabel.trim() || (p ? p.organisation || p.name : ""), replaceAll });
      } else await applyPastedQuote({ enquiry, live, pasted: current, pastedText: text });
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : `The ${what} could not be saved.`);
      setBusy(null);
    }
  }

  const group = (section: Section, title: string) => {
    const rows = (q?.lines ?? []).map((l, i) => ({ l, i })).filter((x) => x.l.section === section);
    return (
      <div key={section} className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className={`text-[11px] font-semibold uppercase tracking-wide ${rows.length ? "text-text-secondary" : "text-text-muted"}`}>
            {title}
            {rows.length === 0 && <span className="ml-1.5 font-normal normal-case tracking-normal">— none</span>}
          </p>
          <button
            type="button"
            onClick={() =>
              setQ((prev) =>
                prev
                  ? {
                      ...prev,
                      lines: [
                        ...prev.lines,
                        { id: newId(), section, description: "", currency: "INR", unit: "Shipment", quantity: 1, rate: 0, note: null, gst: air ? 18 : null, percent: null, percentOf: [] },
                      ],
                    }
                  : prev
              )
            }
            className="flex items-center gap-1 text-[11.5px] text-text-accent hover:underline"
          >
            <Plus size={11} /> Add a charge
          </button>
        </div>
        <div className="space-y-1.5">
          {rows.map(({ l, i }) => {
            const share = l.percent != null;
            const worked = current?.lines[i];
            const others = (q?.lines ?? []).filter((x) => x.id && x.id !== l.id && x.percent == null);
            return (
              <div key={l.id ?? i} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface-1 p-1.5">
                <input
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                  placeholder="Charge"
                  aria-label="Charge"
                  className="h-8 min-w-[10rem] flex-[3] text-[12.5px]"
                />
                {share ? (
                  <>
                    <FigureInput
                      value={l.percent}
                      onValue={(n) => setShare(i, { percent: n, percentOf: l.percentOf ?? [] })}
                      aria-label="Per cent"
                      className="h-8 w-14 text-right text-[12.5px] tabular-nums"
                    />
                    <span className="text-[11.5px] text-text-muted">% of</span>
                  </>
                ) : (
                  <>
                    <select value={l.currency} onChange={(e) => setLine(i, { currency: e.target.value })} aria-label="Currency" className="h-8 w-[4.6rem] text-[12.5px]">
                      {/* The paste's own currency too, when it is not one of the usual ones (CNY, JPY…). */}
                      {[...new Set([...PASTE_CURRENCIES, l.currency])].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <FigureInput
                      value={l.rate}
                      onValue={(n) => setLine(i, { rate: n })}
                      allowNegative
                      aria-label="Rate"
                      className="h-8 w-24 text-right text-[12.5px] tabular-nums"
                    />
                    <select value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} aria-label="Per" className="h-8 w-[6.6rem] text-[12.5px]">
                      {PASTE_UNITS.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                    <span className="text-[11.5px] text-text-muted">×</span>
                    <FigureInput
                      value={l.quantity}
                      onValue={(n) => setLine(i, { quantity: n })}
                      aria-label="Units"
                      className={`h-8 w-16 text-right text-[12.5px] tabular-nums ${l.quantity > 0 ? "" : "border-text-danger"}`}
                    />
                  </>
                )}
                <span className="min-w-[6.5rem] flex-1 text-right text-[12.5px] font-medium tabular-nums text-text-primary">
                  {share ? `INR ${figure(worked?.rate ?? 0)}` : `${l.currency} ${figure(l.rate * l.quantity)}`}
                </span>
                {air && (
                  <select
                    value={l.gst == null ? "" : String(l.gst)}
                    onChange={(e) => setLine(i, { gst: e.target.value === "" ? null : Number(e.target.value) })}
                    aria-label="GST"
                    title="GST on this charge, as the table shows it"
                    className="h-8 w-[5.6rem] text-[12px]"
                  >
                    {l.gst == null && <option value="">GST —</option>}
                    {GST_RATES.map((g) => (
                      <option key={g} value={g}>
                        {g ? `GST ${g}%` : "No GST"}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  value={l.section}
                  onChange={(e) => setLine(i, { section: asSection(e.target.value) })}
                  aria-label="Group"
                  title="Which group it is under"
                  className="h-8 w-[6.4rem] text-[12px]"
                >
                  {SECTIONS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.title.replace(/ Charges$/, "")}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    share
                      ? setLine(i, { percent: null, percentOf: [], note: null, currency: "INR", rate: worked?.rate ?? 0, quantity: 1 })
                      : setShare(i, { percent: 0, percentOf: [] })
                  }
                  title={share ? "Make it a plain figure" : "Work it out as a percentage of other charges"}
                  aria-label={share ? "Make it a plain figure" : "Work it out as a percentage of other charges"}
                  aria-pressed={share}
                  className={`grid size-7 place-items-center rounded-md ${share ? "bg-bg-accent text-text-accent" : "text-text-muted hover:bg-surface-2 hover:text-text-primary"}`}
                >
                  <Percent size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  aria-label="Remove this charge"
                  title="Remove this charge"
                  className="grid size-7 place-items-center rounded-md text-text-muted hover:bg-bg-danger hover:text-text-danger"
                >
                  <Trash2 size={13} />
                </button>
                {share && (
                  <div className="flex w-full flex-wrap items-center gap-1 pl-1">
                    <span className="text-[11px] text-text-muted">Of:</span>
                    {others.length === 0 && <span className="text-[11px] text-text-muted">no other charges yet</span>}
                    {others.map((o) => {
                      const on = !!l.percentOf?.includes(o.id!);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setShare(i, { percent: l.percent ?? 0, percentOf: on ? (l.percentOf ?? []).filter((x) => x !== o.id) : [...(l.percentOf ?? []), o.id!] })
                          }
                          className={`h-6 rounded-full border px-2 text-[11px] ${on ? "border-text-accent bg-bg-accent text-text-accent" : "border-border text-text-secondary hover:text-text-primary"}`}
                        >
                          {o.description || "unnamed charge"}
                        </button>
                      );
                    })}
                  </div>
                )}
                <input
                  value={l.note ?? ""}
                  onChange={(e) => setLine(i, { note: e.target.value || null })}
                  placeholder={share ? "Its wording, e.g. 3% on OF+EXW" : "A condition, e.g. at actuals (with no figure, it stands in for one)"}
                  aria-label="Note"
                  className="h-7 w-full text-[11.5px]"
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const inr = current ? totalInInr(current.lines, current.roe) : null;
  // An air rate pasted on an enquiry that is not marked air: freight by the kilo, or air freight by name.
  const looksAir = !!q?.lines.some((l) => (l.section === "freight" && l.unit === "Kg") || /\b(af|air\s*freight)\b/i.test(l.description));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6">
      <div ref={panel} className="flex max-h-[94vh] w-full flex-col rounded-t-card bg-surface-1 shadow-xl sm:card sm:max-w-5xl" role="dialog" aria-modal="true" aria-label={cost ? "Paste the partner's rate" : "Paste a quotation"}>
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-[14px] font-medium text-text-primary">
            <ClipboardPaste size={15} /> {cost ? "Paste the partner's rate" : "Paste a quotation"}
          </h2>
          <button
            onClick={() => ((text.trim() || q) && !window.confirm(`Close without saving this ${what}?`) ? null : onClose())}
            className="text-text-muted hover:text-text-primary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!q && cost ? (
            <>
              <p className="mb-2 text-[12.5px] text-text-secondary">
                Paste the partner's rate exactly as they sent it — a mail, a WhatsApp message, a rate sheet. The AI sorts the charges; you check them
                next. It is kept on the enquiry as what the job costs, for the profit against your quotation, and is <strong className="font-medium text-text-primary">never sent to the customer</strong>.
              </p>
              <PasteInput value={text} onChange={setText} air={airEnquiry} autoFocus />
            </>
          ) : !q ? (
            <>
              <p className="mb-2 text-[12.5px] text-text-secondary">
                Paste the rate as you have it — a table, a mail, a WhatsApp message. The AI sorts the charges into
                <strong className="font-medium text-text-primary"> Freight, Ex works, Destination</strong> and <strong className="font-medium text-text-primary">Other charges</strong>; you check them next.
                {airEnquiry
                  ? " This is an air enquiry, so the mail carries them as your rate table, with GST, and the PDF goes with it."
                  : " The mail carries them in the quotation letter in your style, and the PDF goes with it."}
              </p>
              <PasteInput value={text} onChange={setText} air={airEnquiry} autoFocus />
            </>
          ) : (
            <>
              {cost && (
                <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-surface-2 px-3 py-2">
                  <label className="block min-w-[14rem] flex-1 text-[12px] text-text-secondary">
                    Whose rate
                    <select
                      value={partnerId}
                      onChange={(e) => {
                        setPartnerId(e.target.value);
                        const p = partners.find((x) => x.id === e.target.value);
                        if (p) setPartnerLabel(p.organisation || p.name);
                      }}
                      className="mt-1 h-8 w-full text-[12.5px]"
                    >
                      <option value="">Choose the partner</option>
                      {partners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.organisation || p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block min-w-[12rem] flex-1 text-[12px] text-text-secondary">
                    Or their name
                    <input value={partnerLabel} onChange={(e) => setPartnerLabel(e.target.value)} placeholder="Not in the directory" className="mt-1 h-8 w-full text-[12.5px]" />
                  </label>
                  {existing.length > 0 && current && (
                    <div className="w-full text-[12px]">
                      <p className="text-text-primary">
                        {pasteSummary(mergeBuyLines(existing, current.lines, { from: "", at: "", pastedText: "" }, replaceAll).entry)}
                        <span className="text-text-muted"> — added to the original rate of {existing.length} charge{existing.length === 1 ? "" : "s"}: a charge already there is updated, a new one added, the rest stay.</span>
                      </p>
                      <label className="mt-1 flex items-center gap-1.5 text-text-secondary">
                        <input type="checkbox" checked={replaceAll} onChange={(e) => setReplaceAll(e.target.checked)} /> This is a whole new rate: replace the original rate with it
                      </label>
                    </div>
                  )}
                </div>
              )}
              {!cost && live?.status === "draft" && liveCount > 0 && (
                <p className="mb-2 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
                  Saving replaces the {liveCount} charge{liveCount === 1 ? "" : "s"} on version {live.version}.
                </p>
              )}
              {!cost && !air && looksAir && (
                <p className="mb-2 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
                  This reads like an air rate, but the enquiry is {MODE_NAME[enquiry.transport_mode ?? ""] ?? "not marked as air"} and it was pasted as text, so
                  the mail will set it out as text. Paste it as a table, or change the enquiry's mode to Air, for your rate table.
                </p>
              )}
              <p className="text-[12px] text-text-secondary">
                Read by the AI — check every figure against what you pasted. Change a charge's group from its menu; the % button works a charge out as a percentage of others.
              </p>
              {SECTIONS.map((s) => group(s.key, s.title))}

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div>
                  {air && !cost && (
                    <div className="mb-3 grid grid-cols-3 gap-2">
                      {(
                        [
                          ["routing", "Routing", "HEL - IST - MAA"],
                          ["carrier", "Carrier", "TK"],
                          ["transitTime", "Transit time", "2-3 days"],
                        ] as const
                      ).map(([key, label, hint]) => (
                        <label key={key} className="block text-[12px] text-text-secondary">
                          {label}
                          <input
                            value={q[key] ?? ""}
                            onChange={(e) => setQ((prev) => (prev ? { ...prev, [key]: e.target.value || null } : prev))}
                            placeholder={hint}
                            className="mt-1 h-8 w-full text-[12.5px]"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Rates of exchange</p>
                  {foreign.length === 0 ? (
                    <p className="text-[12px] text-text-muted">All in rupees.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {foreign.map((c) => (
                        <label key={c} className="flex items-center gap-2 text-[12.5px] text-text-primary">
                          <span className="w-16">1 {c} = ₹</span>
                          <FigureInput
                            value={q.roe[c] ?? 0}
                            blankZero
                            onValue={(n) => setQ((prev) => (prev ? { ...prev, roe: { ...prev.roe, [c]: n } } : prev))}
                            placeholder="needed"
                            aria-label={`Rupees for one ${c}`}
                            className={`h-8 w-28 text-right tabular-nums ${q.roe[c] ? "" : "border-text-danger"}`}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  {!cost && (
                  <>
                  <label className="mt-3 block text-[12px] text-text-secondary">
                    Valid until
                    <input
                      type="date"
                      value={q.validUntil ?? ""}
                      onChange={(e) => setQ((prev) => (prev ? { ...prev, validUntil: e.target.value || null } : prev))}
                      className="mt-1 h-8 w-full"
                    />
                  </label>
                  <label className="mt-3 block text-[12px] text-text-secondary">
                    Terms, one per line
                    <textarea value={termsText} onChange={(e) => setTermsText(e.target.value)} rows={4} className="mt-1 w-full text-[12.5px]" />
                  </label>
                  </>
                  )}
                  <p className="mt-2 text-[12.5px] text-text-primary">
                    Total: <strong className="font-semibold tabular-nums">{inr === null ? "needs every rate of exchange" : `₹${figure(inr)}`}</strong>
                    {air && <span className="text-text-muted"> before GST</span>}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{cost ? "The partner's charges, in full" : "The charges, as the mail shows them"}</p>
                  {/* Our own markup, every value in it escaped (lib/quotationMail.ts). */}
                  <div
                    className="max-h-[26rem] overflow-auto rounded-lg border border-border bg-white p-3"
                    dangerouslySetInnerHTML={{ __html: preview }}
                  />
                  <p className="mt-1 text-[11px] text-text-muted">{cost ? "Kept on the enquiry for the profit; never sent." : "In the quotation letter as usual, with the PDF attached."}</p>
                </div>
              </div>
            </>
          )}

          {error && (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-[11px] text-text-muted">{q ? "Nothing is saved until you press Save." : "The AI reads it; nothing is saved yet."}</p>
          <div className="flex items-center gap-2">
            {q && (
              <button type="button" onClick={() => setQ(null)} className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:text-text-primary">
                Back to the text
              </button>
            )}
            {!q ? (
              <button
                type="button"
                onClick={() => void read()}
                disabled={busy !== null || !text.trim()}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
              >
                {busy === "read" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {busy === "read" ? "Reading…" : "Lay it out"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy !== null}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
              >
                {busy === "save" && <Loader2 size={13} className="animate-spin" />}
                {cost ? "Save the partner's rate" : "Save the quotation"}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
