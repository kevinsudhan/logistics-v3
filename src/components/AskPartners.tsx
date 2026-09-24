import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";
import RichTextEditor from "./RichTextEditor";
import Drafting from "./Drafting";
import { draftRequest, draftRequestWithAi, sendBurst, type BurstResult } from "../services/rfq";
import { listPartners, type Partner } from "../services/partners";
import { mailIsLive } from "../services/backend";
import type { Enquiry } from "../services/enquiries";
import { InlineLoading } from "./Loading";

/**
 * Asking several partners for a rate at once.
 *
 * ---------------------------------------------------------------------------
 * ONE MESSAGE, SENT SEPARATELY
 *
 * The same text goes to each partner in its own mail rather than as one with
 * six recipients. Two reasons, and both matter: six recipients is one
 * conversation, so every reply would thread together and no rate could be
 * attributed to the agent who sent it — and none of them should see who else
 * was asked.
 *
 * THE MESSAGE IS EDITABLE BEFORE IT GOES
 *
 * It is composed from the enquiry, which means it is only as complete as the
 * enquiry is. The operator knows things the record does not, and a request that
 * cannot be corrected before sending is one that gets sent wrong and chased by
 * phone afterwards.
 * ---------------------------------------------------------------------------
 */
export default function AskPartners({
  enquiry,
  fromName,
  onClose,
  onSent,
}: {
  enquiry: Enquiry;
  fromName: string;
  onClose: () => void;
  onSent: (result: BurstResult) => void;
}) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial = useMemo(() => draftRequest(enquiry, fromName), [enquiry, fromName]);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);

  /**
   * Writing it with a model, which is opt-in and reversible.
   *
   * The template is what the dialog opens with and what sends unless somebody
   * chooses otherwise — it copies every figure off the enquiry and cannot get
   * one wrong. This is for the requests the template is not right for, and it
   * needs a brief, because "write it with AI" without saying what it should do
   * produces the template again in worse prose.
   *
   * `wrote` is what makes it safe to try: one press puts the standard request
   * back, so nobody is stuck with a version they like less than what they had.
   */
  const [briefing, setBriefing] = useState(false);
  const [brief, setBrief] = useState("");
  const [writing, setWriting] = useState(false);
  const [wrote, setWrote] = useState(false);

  async function writeIt() {
    if (!brief.trim()) return setError("Say what this request should do.");
    setWriting(true);
    setError(null);
    try {
      setBody(await draftRequestWithAi({ enquiry, fromName, instruction: brief }));
      setWrote(true);
      setBriefing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not write that request.");
    } finally {
      setWriting(false);
    }
  }

  const live = mailIsLive();

  useEffect(() => {
    void listPartners()
      .then(setPartners)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load partners."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  /** Only partners with an address can be asked; the rest have nowhere to send. */
  const reachable = useMemo(() => partners.filter((p) => p.emails?.[0]), [partners]);

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function send() {
    if (!chosen.size) return setError("Choose at least one partner.");
    if (!subject.trim()) return setError("The request needs a subject.");
    setBusy(true);
    setError(null);
    try {
      const result = await sendBurst({
        enquiry,
        subject: subject.trim(),
        body,
        partners: reachable
          .filter((p) => chosen.has(p.id))
          .map((p) => ({
            id: p.id,
            email: p.emails[0],
            label: p.organisation?.trim() || p.name,
          })),
      });
      onSent(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the request.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6"
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full flex-col rounded-t-card shadow-pop sm:card sm:max-w-2xl"
        role="dialog"
        aria-label="Ask partners for a rate"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-medium text-text-primary">Ask partners for a rate</h2>
            <p className="text-[11.5px] text-text-muted">
              {enquiry.ref} · each partner is written to separately
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-text-muted hover:text-text-primary disabled:opacity-50"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!live && (
            <div className="flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
              <AlertCircle size={13} className="mt-px shrink-0" />
              <span>
                <strong className="font-medium">Nothing will be delivered.</strong> Outlook is not
                connected on this session, so no request goes out and no reply can be tracked. Sign
                in with Microsoft first.
              </span>
            </div>
          )}

          <div>
            <p className="mb-2 text-[12px] font-medium text-text-secondary">
              Who to ask
              {chosen.size > 0 && (
                <span className="ml-2 font-normal text-text-muted">{chosen.size} selected</span>
              )}
            </p>

            {loading ? (
              <InlineLoading label="Loading partners" className="py-1 text-[12px]" />
            ) : reachable.length === 0 ? (
              <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] text-text-secondary">
                No partners with an email address yet. Add them under Partners — a partner with no
                address has nowhere for this to go.
              </p>
            ) : (
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {reachable.map((p) => {
                  const on = chosen.has(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => toggle(p.id)}
                        aria-pressed={on}
                        className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                          on
                            ? "border-brand/30 bg-bg-success"
                            : "border-border bg-surface-1 hover:border-border-strong"
                        }`}
                      >
                        <span
                          className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border ${
                            on
                              ? "border-brand bg-brand text-white"
                              : "border-border-strong bg-surface-1"
                          }`}
                          aria-hidden
                        >
                          {on && <Check size={10} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-medium text-text-primary">
                            {p.organisation?.trim() || p.name}
                          </span>
                          <span className="block truncate text-[11px] text-text-muted">
                            {p.emails[0]}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-text-secondary">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full"
              autoComplete="off"
            />
          </label>

          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-medium text-text-secondary">
                The request
                <span className="ml-2 font-normal text-text-muted">
                  {wrote
                    ? "Written to your brief — read it before it goes."
                    : "Built from this enquiry — correct anything before it goes."}
                </span>
              </p>

              <div className="flex items-center gap-2">
                {wrote && (
                  <button
                    type="button"
                    onClick={() => {
                      setBody(initial.body);
                      setWrote(false);
                    }}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                  >
                    <RotateCcw size={11} />
                    Back to the standard request
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setBriefing((v) => !v)}
                  aria-expanded={briefing}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                >
                  <Sparkles size={11} />
                  {wrote ? "Write it again" : "Write it with AI"}
                </button>
              </div>
            </div>

            {/*
              The brief. Asked for rather than assumed: a model told only "write
              a rate request" reproduces the template in worse prose, and the
              reason to reach for this is always something the operator knows
              and the enquiry does not.
            */}
            {briefing && (
              <div className="mb-2 rounded-card border border-border bg-surface-2 p-3">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-text-secondary">
                    What should this request do?
                  </span>
                  <textarea
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        if (!writing) void writeIt();
                      }
                    }}
                    rows={3}
                    autoFocus
                    placeholder="e.g. chase them, we asked last Tuesday and heard nothing — and ask whether they can take it a week earlier"
                    className="w-full text-[12.5px]"
                  />
                </label>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] leading-relaxed text-text-muted">
                    It may use only the shipment details on this enquiry. It cannot invent a
                    weight, a volume or a date.
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setBriefing(false)}
                      className="h-7 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void writeIt()}
                      disabled={writing || !brief.trim()}
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-brand px-2.5 text-[11.5px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
                    >
                      {writing ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Sparkles size={11} />
                      )}
                      {writing ? "Writing…" : "Write it"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/*
              The request the model is rewriting is the one on screen, so the
              editor steps aside rather than showing text about to be replaced.
            */}
            {writing ? (
              <Drafting label="Writing the rate request" lines={5} />
            ) : (
              <RichTextEditor value={body} onChange={setBody} minHeight={220} />
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-[11px] text-text-muted">
            {chosen.size === 0
              ? "Nobody selected yet."
              : `${chosen.size} separate message${chosen.size === 1 ? "" : "s"} — nobody sees who else was asked.`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void send()}
              disabled={busy || chosen.size === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {busy ? "Sending…" : `Send to ${chosen.size || ""}`.trim()}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
