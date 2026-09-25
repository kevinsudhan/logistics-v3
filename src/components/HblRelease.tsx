import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Mail, Undo2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { releaseMailHtml, releaseMailSubject, releaseSteps, releaseSummary, type ReleaseMailInput, type ReleaseStep } from "../lib/hblRelease";
import type { Shipment } from "../services/enquiries";
import { patchHblRelease, releaseAgent, unpaidInvoices, type HblReleasePatch, type HblRow } from "../services/hbl";
import ComposeMail from "./ComposeMail";
import { inputBase, Section } from "./HblBoxes";

/**
 * Releasing our own house B/L, once it is issued (089).
 *
 * Each step is ticked for today, and says who or how many where that
 * matters: who took the originals, how many are back, which agent the
 * release went to. The telex release (or a sea waybill's release
 * instructions) is written here and sent from the person's own mailbox to
 * the destination agent; sending it ticks its step. Every tick is on the
 * B/L's history, and the ones a colleague needs on the case file's timeline.
 */

const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const day = (iso: string | null) => (iso ? formatDate(iso, { day: "numeric", month: "short", year: "numeric" }) : "");

export default function HblRelease({ shipment: s, row, onChanged }: { shipment: Shipment; row: HblRow; onChanged: () => Promise<void> | void }) {
  const { session } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unpaid, setUnpaid] = useState(0);
  const [agent, setAgent] = useState<{ name: string; email: string } | null>(null);
  const [takenBy, setTakenBy] = useState("");
  const [back, setBack] = useState(row.originals_returned);
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string } | null>(null);

  useEffect(() => {
    void unpaidInvoices(s.id).then(setUnpaid);
    void releaseAgent(s).then(setAgent).catch(() => setAgent(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id]);
  useEffect(() => setBack(row.originals_returned), [row.originals_returned]);

  const state = { ...row, status: row.status };
  const { steps, complete } = releaseSteps(state);
  const summary = releaseSummary(state);
  const charged = Boolean(row.charges_received_on);
  // Released at destination only after what lets our agent release it: an
  // original out to be surrendered, or our release message sent.
  const readyToRelease = steps.filter((x) => x.key !== "released_on" && x.key !== "charges_received_on" && !x.optional).every((x) => x.done);

  async function run(key: string, patch: HblReleasePatch, confirmUnpaid?: string) {
    if (confirmUnpaid && !charged && !window.confirm(`Charges from the shipper are not marked received. ${confirmUnpaid} anyway?`)) return;
    setBusy(key);
    setError(null);
    try {
      await patchHblRelease(s.id, patch);
      await onChanged();
    } catch (e) {
      setError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  }

  const mailInput = (): ReleaseMailInput => {
    const d = row.data;
    return {
      ref: s.enquiry_ref,
      mode: row.release_mode,
      hblNo: row.hbl_no ?? "",
      mblNo: s.mainline_no,
      agentName: agent?.name || null,
      shipper: d.shipper_name,
      consignee: d.consignee_name,
      vessel: d.vessel,
      voyage: d.voyage,
      portOfLoading: d.port_of_loading,
      portOfDischarge: d.port_of_discharge,
      containers: d.containers.map((c) => c.container_no).filter(Boolean),
      packages: [d.packages, d.package_type].filter(Boolean).join(" "),
      grossKg: d.gross_weight_kg,
      originals: row.originals,
      place: d.place_of_issue || "CHENNAI",
      freightTerms: d.freight_terms,
    };
  };

  const openMail = () => {
    if (!charged && !window.confirm("Charges from the shipper are not marked received. Write the release anyway?")) return;
    const input = mailInput();
    setCompose({ to: agent?.email ?? "", subject: releaseMailSubject(input), body: releaseMailHtml(input) });
  };

  const undo = (st: ReleaseStep): HblReleasePatch =>
    st.key === "originals_returned_on"
      ? { originals_returned: 0, originals_returned_on: null }
      : st.key === "originals_released_on"
        ? { originals_released_on: null, originals_released_to: "" }
        : st.key === "release_sent_on"
          ? { release_sent_on: null, release_sent_to: "" }
          : { [st.key]: null };

  const button = "inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-50";

  return (
    <Section
      title={`Release — ${row.release_mode === "express" ? "sea waybill" : row.release_mode === "telex" ? "telex release" : "original B/Ls"}`}
      action={<span className={`text-[12px] font-medium ${complete ? "text-text-success" : "text-text-secondary"}`}>{summary}</span>}
    >
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">
          <AlertTriangle size={13} className="mt-px shrink-0" /> {error}
        </p>
      )}
      <ol className="space-y-2.5">
        {steps.map((st) => {
          const locked = Boolean(row.released_on) && st.key !== "released_on";
          return (
            <li key={st.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className={`grid size-5 shrink-0 place-items-center rounded-full ${st.done ? "bg-bg-success text-text-success" : "bg-surface-2 text-text-muted"}`}>
                {busy === st.key ? <Loader2 size={11} className="animate-spin" /> : st.done ? <Check size={12} /> : <span className="size-1.5 rounded-full bg-current" />}
              </span>
              <span className="min-w-0">
                <span className={`block text-[12.5px] ${st.done ? "text-text-primary" : "text-text-secondary"}`}>{st.label}</span>
                {!st.done && <span className="block text-[11px] text-text-muted">{st.hint}</span>}
              </span>
              {st.done && (
                <span className="text-[11.5px] text-text-muted">
                  {[st.detail, st.done ? day(st.on) : ""].filter(Boolean).join(" · ")}
                </span>
              )}

              {/* ---- what can be done about it ---- */}
              {st.done ? (
                !locked && (
                  <button type="button" disabled={busy !== null} onClick={() => void run(st.key, undo(st))} className="text-text-muted hover:text-text-danger disabled:opacity-40" aria-label={`Undo: ${st.label}`} title="Undo">
                    <Undo2 size={12} />
                  </button>
                )
              ) : st.key === "charges_received_on" ? (
                <>
                  <button type="button" disabled={busy !== null} onClick={() => void run(st.key, { charges_received_on: todayIst() })} className={button}>
                    Received today
                  </button>
                  {unpaid > 0 && (
                    <span className="text-[11.5px] text-text-warning">
                      {unpaid} invoice{unpaid === 1 ? "" : "s"} on this job not fully paid
                    </span>
                  )}
                </>
              ) : st.key === "originals_released_on" ? (
                <>
                  <input value={takenBy} onChange={(e) => setTakenBy(e.target.value)} placeholder="Who took them" className={`${inputBase} h-7 w-48`} aria-label="Who took the originals" />
                  <button
                    type="button"
                    disabled={busy !== null || !takenBy.trim()}
                    title={takenBy.trim() ? undefined : "Say who took them first"}
                    onClick={() => void run(st.key, { originals_released_on: todayIst(), originals_released_to: takenBy.trim().toUpperCase() }, "Hand over the originals")}
                    className={button}
                  >
                    Handed over today
                  </button>
                </>
              ) : st.key === "originals_returned_on" ? (
                <>
                  <select value={back} onChange={(e) => setBack(Number(e.target.value))} className={`${inputBase} h-7`} aria-label="How many originals are back">
                    {Array.from({ length: row.originals + 1 }, (_, n) => (
                      <option key={n} value={n}>
                        {n} of {row.originals} back
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy !== null || back === row.originals_returned}
                    onClick={() => void run(st.key, { originals_returned: back, originals_returned_on: back > 0 ? todayIst() : null })}
                    className={button}
                  >
                    Record today
                  </button>
                </>
              ) : st.key === "release_sent_on" ? (
                <>
                  <button
                    type="button"
                    disabled={busy !== null || (row.release_mode === "telex" && row.originals_returned < row.originals)}
                    title={row.release_mode === "telex" && row.originals_returned < row.originals ? "Every original has to be back with us first" : agent?.email ? `To ${agent.email}` : "No email on file for the destination agent: add one on the Party tab, or type it in the mail"}
                    onClick={openMail}
                    className={`${button} border-brand text-text-accent`}
                  >
                    <Mail size={12} /> Write the {row.release_mode === "express" ? "release instructions" : "telex release"}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null || (row.release_mode === "telex" && row.originals_returned < row.originals)}
                    onClick={() => void run(st.key, { release_sent_on: todayIst(), release_sent_to: (agent?.name ?? "").toUpperCase() }, "Mark the release sent")}
                    className={button}
                    title="Sent from Outlook directly"
                  >
                    Sent another way
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null || !readyToRelease}
                  title={readyToRelease ? undefined : `After: ${steps.filter((x) => x.key !== "released_on" && x.key !== "charges_received_on" && !x.optional && !x.done).map((x) => x.label.toLowerCase()).join(", ")}`}
                  onClick={() => void run(st.key, { released_on: todayIst() })}
                  className={button}
                >
                  Released today
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {compose && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          enquiryRef={s.enquiry_ref}
          reference={s.enquiry_ref}
          initial={compose}
          onClose={() => setCompose(null)}
          onSent={() => {
            setCompose(null);
            void run("release_sent_on", { release_sent_on: todayIst(), release_sent_to: (agent?.name || compose.to).toUpperCase() });
          }}
        />
      )}
    </Section>
  );
}
