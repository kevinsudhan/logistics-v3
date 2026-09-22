import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Send, Sparkles, X } from "lucide-react";
import { sendMail, mailIsLive, type MailMessage } from "../services/backend";
import { draftReply } from "../services/classify";
import { recordReply } from "../services/replyLog";
import { withToken } from "../services/caseFile";
import RichTextEditor from "./RichTextEditor";
import Drafting from "./Drafting";
import { greetingHtml } from "../lib/greeting";
import MailAttachments, { type Attachable, type Attached } from "./MailAttachments";
import { bytesToBase64 } from "../lib/base64";

/**
 * Compose, and reply.
 *
 * One component for both: a reply is a compose with the recipient, subject and
 * quoted body already filled, and the conversation id carried across so the
 * sent copy threads with what it answers. Splitting them would duplicate the
 * validation and the send path for no gain.
 */
export default function ComposeMail({
  mailbox,
  fromName,
  signature = "",
  replyTo,
  initial,
  onClose,
  onSent,
  partnerId,
  reference,
  enquiryRef,
  attachables,
  loadAttachables,
  attachments: initialAttachments,
}: {
  mailbox: string;
  fromName: string;
  /** The sender's saved signature, pre-filled into the body. */
  signature?: string;
  replyTo?: MailMessage;
  /**
   * A message the CRM has drafted -- a quotation, a booking confirmation.
   *
   * Pre-filled rather than sent outright, because it goes out under somebody's
   * name and they should see it first. The subject carries the enquiry
   * reference, which is what makes the customer's reply file itself.
   */
  initial?: { to?: string; subject?: string; body?: string };
  onClose: () => void;
  onSent: () => void;
  /**
   * The partner this reply concerns, when it is being sent from their
   * screen. Attributes the row in the reply log; absent everywhere else,
   * because a reply to a customer is still logged but is not theirs.
   */
  partnerId?: string | null;
  /**
   * The enquiry this message belongs to, when it has one.
   *
   * Two things depend on it: the files already filed against it become
   * attachable, and anything sent from here can be filed back onto it.
   */
  enquiryRef?: string | null;
  /**
   * Documents the caller can generate and attach — the quotation, the booking
   * confirmation. Passed as makers rather than files so nothing is rendered
   * for an attachment nobody chooses.
   */
  attachables?: Attachable[];
  /** The same, for a caller that must fetch the enquiry first. */
  loadAttachables?: () => Promise<Attachable[]>;
  /**
   * Files already on the message when it opens.
   *
   * For the case where the attachment IS the point of the mail — a quotation
   * going out with its PDF. Still removable before sending: prefilled is not
   * the same as compulsory.
   */
  attachments?: Array<{ name: string; contentType: string; bytes: Uint8Array }>;
  /**
   * The reference this conversation carries, ALG or PALG.
   *
   * Named `reference` and not `ref`: `ref` is reserved on a React element,
   * so React 18 strips it before the component sees it and warns that a
   * function component cannot take one. The prop would simply never arrive,
   * and the subject would go out without its token — silently, which is the
   * worst way for a filing mechanism to fail.
   *
   * Put into the subject so the reply the other side sends back files
   * itself. That is the whole mechanism: the token in the subject is how a
   * message three weeks from now is recognised as belonging to this
   * conversation, without anybody having to remember to file it.
   */
  reference?: string | null;
}) {
  /**
   * The signature is seeded into the editable body rather than bolted on at
   * send time, so what is on screen is what goes out. Appending it invisibly
   * during send would mean nobody could shorten it for a one-line reply, or
   * see that it is doubled when they have also typed their name.
   */
  const sig = signature.trim() ? `<br><br>${signature.trim()}` : "";
  const [to, setTo] = useState(initial?.to ?? (replyTo ? replyTo.from.emailAddress.address : ""));
  const [cc, setCc] = useState("");
  /*
    The token goes on here rather than at send time, so it is visible in the
    box before the message leaves. Somebody editing the subject can see what
    they are editing, and can take it off deliberately — which is different
    from it never having been there.

    withToken is idempotent: a reply to a thread that already carries the
    reference keeps the one it has rather than gaining a second.
  */
  const [subject, setSubject] = useState(() => {
    const base =
      initial?.subject ??
      (replyTo ? (/^re:/i.test(replyTo.subject) ? replyTo.subject : `Re: ${replyTo.subject}`) : "");
    return reference ? withToken(base, reference) : base;
  });
  /**
   * Everything below where the message gets written: the signature and the
   * thread being answered.
   *
   * Split out from the greeting deliberately. A drafted reply is written as
   * `draft + tail`, and if the greeting were part of the tail the draft would
   * land ABOVE it — and the model writes its own salutation, so the reader
   * would get two.
   */
  const tail =
    initial?.body !== undefined
      ? sig
      : replyTo
        ? `${sig}<br><br><hr><div>On ${new Date(replyTo.receivedDateTime).toLocaleString()}, ` +
          `${escapeHtml(replyTo.from.emailAddress.name || replyTo.from.emailAddress.address)} ` +
          `wrote:</div>` +
          `<blockquote style="margin:0 0 0 12px;padding-left:10px;border-left:2px solid #ccc">` +
          (replyTo.body.contentType === "html"
            ? replyTo.body.content
            : escapeHtml(replyTo.body.content).replace(/\r?\n/g, "<br>")) +
          `</blockquote>`
        : sig;

  /**
   * What the box opens with.
   *
   * The salutation, then room to write, then the tail. Prefilled because every
   * reply this desk sends opens the same way, and typing it forty times a day
   * is forty chances to send one without it — deleted in a keystroke when it is
   * not wanted.
   */
  const initialBody =
    initial?.body !== undefined
      ? `${initial.body}${tail}`
      : replyTo
        ? greetingHtml(replyTo.from.emailAddress.name, replyTo.from.emailAddress.address) + tail
        : tail;

  const [content, setContent] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Drafting: state, and the one thing that makes re-drafting safe.
   *
   * `base` is the body as it was before any draft went in — the signature and
   * the quoted thread. A draft is written as `draft + base` rather than
   * appended to whatever is on screen, so pressing the button twice replaces
   * the draft instead of stacking two of them above the same quote.
   *
   * The cost of that is real and is stated on screen: a re-draft discards
   * anything typed above the quoted thread since the last one.
   */
  // The TAIL, not the whole body: a draft supplies its own opening, so writing
  // it above the prefilled greeting would produce two salutations.
  const base = useRef(tail);
  const [attachments, setAttachments] = useState<Attached[]>(() =>
    (initialAttachments ?? []).map((a, i) => ({
      key: `initial-${i}-${a.name}`,
      name: a.name,
      contentType: a.contentType,
      contentBytes: bytesToBase64(a.bytes),
      size: a.bytes.byteLength,
      origin: "generated" as const,
    }))
  );
  const [drafting, setDrafting] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  async function draft() {
    if (!replyTo) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const text = await draftReply(replyTo, instruction);
      // Plain text into a rich-text field: escaped so an ampersand in a company
      // name cannot become markup, and line breaks preserved.
      const html = escapeHtml(text).replace(/\r?\n/g, "<br>");
      setContent(`${html}${base.current}`);
      setDrafted(true);
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "Could not draft a reply.");
    } finally {
      setDrafting(false);
    }
  }

  /**
   * Whether this will actually leave the building.
   *
   * Read once when the dialog opens, and everything the user sees follows from
   * it -- the banner, the footer, and the wording on the button. The dialog
   * previously said "Demo mailbox" no matter what, which is worse than saying
   * nothing: it was wrong when the mailbox was real, and it was a footnote
   * nobody reads when the mailbox was not.
   */
  const live = mailIsLive();

  // Escape closes, as it does in every mail client.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const addresses = (s: string) =>
    s
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const recipients = addresses(to);
    if (!recipients.length) return setError("Add at least one recipient.");

    const bad = recipients.find((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
    if (bad) return setError(`"${bad}" is not a valid email address.`);

    if (!subject.trim()) return setError("Add a subject.");

    setBusy(true);
    try {
      await sendMail({
        mailbox,
        fromName,
        to: recipients,
        cc: addresses(cc),
        subject: subject.trim(),
        content,
        conversationId: replyTo?.conversationId,
        /*
          The id is what threads it. conversationId alone was being passed and
          is ignored by the live send path — Graph threads a reply from the
          message being replied TO, not from the conversation it sits in.
        */
        replyToId: replyTo?.id,
        // Stripped of the display-only fields the picker carries around.
        attachments: attachments.length
          ? attachments.map((a) => ({
              name: a.name,
              contentType: a.contentType,
              contentBytes: a.contentBytes,
            }))
          : undefined,
      });

      /*
        Record that this went out, and when, against the message it answers.
        Only for a reply: a new message answers nothing, so there is no delay to
        measure and a row for it would dilute the one number the log exists to
        show. It never throws — the mail has already left, and a bookkeeping
        failure reported here would read as a send failure and invite a second
        copy of the same reply.
      */
      if (replyTo) await recordReply({ repliedTo: replyTo, partnerId });

      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the message.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-2xl rounded-t-card sm:card shadow-xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={replyTo ? "Reply" : "New message"}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-[14px] font-medium text-text-primary">
            {replyTo ? "Reply" : "New message"}
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4" noValidate>
          {!live && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
              <AlertCircle size={13} className="mt-px shrink-0" />
              <span>
                <strong className="font-medium">This will not be delivered.</strong> Outlook is
                not connected on this session, so the message is only filed in the demo Sent
                folder. Sign in with Microsoft to send for real.
              </span>
            </div>
          )}

          <Row label="From">
            {/* Fixed, not a field. You send as the account you signed in with. */}
            <span className="text-[13px] text-text-secondary">{mailbox}</span>
          </Row>

          <Row label="To">
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="name@company.com"
              className="w-full"
              autoComplete="off"
            />
          </Row>

          <Row label="Cc">
            <input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="Optional, comma separated"
              className="w-full"
              autoComplete="off"
            />
          </Row>

          <Row label="Subject">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full"
              autoComplete="off"
            />
          </Row>

          {/*
            Offered on replies only. A new message has no thread to answer, and
            a model given nothing to work from writes filler.
          */}
          {replyTo && (
            <div className="mt-3 overflow-hidden rounded-card border border-border bg-surface-2">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-lg border border-border bg-surface-1 text-text-secondary"
                  aria-hidden
                >
                  <Sparkles size={12} />
                </span>

                <input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter drafts rather than submitting the form, which would
                    // send a half-written reply.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!drafting) void draft();
                    }
                  }}
                  placeholder="What should it say? e.g. confirm space, ask for the packing list"
                  aria-label="What the reply should say"
                  className="h-8 min-w-0 flex-1 border-border bg-surface-1 text-[12px]"
                  autoComplete="off"
                />

                <button
                  type="button"
                  onClick={() => void draft()}
                  disabled={drafting}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2 disabled:opacity-60"
                >
                  {drafting ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  {drafting ? "Writing…" : drafted ? "Draft again" : "Draft a reply"}
                </button>
              </div>

              {/*
                The warning belongs inside this block, not floating under it.
                What it is warning about is the text this control just wrote,
                and the strongest line is the one about figures — an invented
                rate is the failure that actually costs money here.
              */}
              {(drafted || draftError) && (
                <div className="border-t border-border px-3 py-2">
                  {draftError ? (
                    <p className="break-words text-[11px] text-text-danger">{draftError}</p>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-text-muted">
                      <span className="font-medium text-text-warning">Check every figure.</span>{" "}
                      This was written by a model and has not been checked against anything you
                      quoted. Drafting again replaces everything above the quoted thread.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/*
            While the model writes, the editor gives way to the waiting state
            rather than sitting there inviting typing that is about to be
            replaced — a re-draft overwrites everything above the quoted thread,
            so anything typed here in the meantime would be lost.
          */}
          <div className="mt-3">
            {drafting ? (
              <Drafting label="Drafting a reply" lines={5} />
            ) : (
              <RichTextEditor
                value={content}
                onChange={setContent}
                minHeight={220}
                placeholder="Write your message…"
              />
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger"
            >
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </form>

        <MailAttachments
          enquiryRef={enquiryRef}
          generated={attachables}
          loadGenerated={loadAttachables}
          value={attachments}
          onChange={setAttachments}
        />

        <footer className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
          <p className="text-[11px] text-text-muted">
            {live
              ? `Sending as ${mailbox} — this will be delivered.`
              : "Demo mailbox — nothing leaves this machine."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {busy ? (live ? "Sending…" : "Saving…") : live ? "Send" : "Save to demo Sent"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-border">
      <span className="w-14 shrink-0 text-[12px] text-text-secondary">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
