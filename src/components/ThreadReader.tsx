import { useCallback, useMemo, useState } from "react";
import { AlertCircle, Hash, Loader2, MessageSquare, Reply } from "lucide-react";
import MailBody from "./MailBody";
import MessageAttachments from "./MessageAttachments";
import MessageHeader from "./MessageHeader";
import ComposeMail from "./ComposeMail";
import type { Attachable } from "./MailAttachments";
import { attachablesForEnquiry } from "../lib/attachableDocuments";
import PushMailToQueue from "./PushMailToQueue";
import FileToEnquiry from "./FileToEnquiry";
import StatusPill from "./StatusPill";
import { failureText, type FailureText } from "../lib/errorText";
import { groupIntoThreads, type Thread } from "../lib/threads";
import { getMessage, messagesInConversation } from "../services/graphMail";
import type { ThreadRef } from "../services/threadRefs";
import type { MailMessage } from "../services/mockMail";

/**
 * Mail, read and answered in place.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SHARED
 *
 * A partner's screen and an enquiry's case file ask the same thing of different
 * sets of mail: show me this exchange, let me read it, let me answer it. There
 * was one implementation between them and it lived on the partner page, which
 * is why the case file could only ever show previews — a list of subject lines
 * with no way to open one and no reply button anywhere on the screen.
 *
 * WHAT THE CALLER DECIDES
 *
 * Which messages, and what reference they carry. A case file has one reference
 * for everything on it, the enquiry's. A partner screen has a different one per
 * thread and some threads have none yet. Both arrive through `refFor`, and the
 * assign button appears only where `onGiveRef` is given — a case file cannot
 * assign one, because its threads already have the enquiry's.
 *
 * WHY THE BODIES ARE FETCHED ON OPEN
 *
 * A message from a list or a search carries a preview, not a body. Reading
 * needs the whole thing, and a thread is short enough that fetching all of it
 * at once is one wait rather than one per message as you scroll.
 * ---------------------------------------------------------------------------
 */
export interface ThreadReaderProps {
  mailbox: string;
  fromName: string;
  signature?: string;
  /** The messages to group into threads. Previews are fine; bodies are fetched. */
  messages: MailMessage[];
  /** The reference a thread carries, if any. Drives the badge and the subject. */
  refFor?: (conversationId: string) => ThreadRef | null;
  /** Offered only where given: a thread with no reference can be assigned one. */
  onGiveRef?: (conversationId: string, subject: string) => void;
  /** The conversation currently being assigned one, for the spinner. */
  assigning?: string | null;
  /** The partner this mail belongs to, when it belongs to one. */
  partnerId?: string | null;
  title: string;
  hint: string;
  emptyHint: string;
  /** Something changed that the page around this should reload. */
  onChanged: () => void;
  /**
   * The enquiry these threads belong to, on a case file.
   *
   * Absent on the partner screen, where a thread may concern several enquiries
   * or none — there is no single case to file an attachment onto, and guessing
   * one would put a customer's packing list on the wrong job.
   */
  enquiryRef?: string | null;
  /** Documents the case can generate, offered in the attachment menu. */
  attachables?: Attachable[];
}

export default function ThreadReader({
  mailbox,
  fromName,
  signature = "",
  messages,
  refFor,
  onGiveRef,
  assigning = null,
  partnerId,
  title,
  hint,
  emptyHint,
  onChanged,
  enquiryRef,
  attachables,
}: ThreadReaderProps) {
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<MailMessage[]>([]);
  const [threadBusy, setThreadBusy] = useState(false);
  const [composing, setComposing] = useState<null | { replyTo: MailMessage }>(null);
  const [error, setError] = useState<FailureText | null>(null);

  const threads = groupIntoThreads(messages);


  const onOpen = useCallback(
    async (t: Thread) => {
      if (openThread === t.conversationId) {
        setOpenThread(null);
        setThreadMessages([]);
        return;
      }
      setOpenThread(t.conversationId);
      setThreadMessages([]);
      setThreadBusy(true);
      try {
        // Ask Graph for the conversation rather than reusing what was handed
        // in: a list or a search only carries the messages that matched, and a
        // thread is the whole exchange including the ones that did not.
        const inThread = t.conversationId.startsWith("single:")
          ? t.messages
          : await messagesInConversation(mailbox, t.conversationId).catch(() => t.messages);

        const full = await Promise.all(
          inThread.map((m) => getMessage(mailbox, m.id, m.folder).catch(() => m))
        );
        setThreadMessages(
          full.sort(
            (a, b) =>
              (Date.parse(a.receivedDateTime) || 0) - (Date.parse(b.receivedDateTime) || 0)
          )
        );
      } catch (e) {
        setError(failureText(e, "Could not open that thread."));
      } finally {
        setThreadBusy(false);
      }
    },
    [openThread, mailbox]
  );

  const refs = new Map<string, ThreadRef>();
  if (refFor) {
    for (const t of threads) {
      const r = refFor(t.conversationId);
      if (r) refs.set(t.conversationId, r);
    }
  }

  /**
   * The enquiry a thread is about, or null.
   *
   * On a case file the prop answers it — every thread there belongs to that
   * enquiry. On the partner screen it depends on the reference the thread
   * carries: an ALG thread is about a shipment, a PALG thread is a rate
   * discussion or a claim belonging to no single job, and an unreferenced one
   * has nowhere to file anything.
   */
  const enquiryFor = (conversationId: string): string | null =>
    enquiryRef ??
    (refs.get(conversationId)?.kind === "shipment"
      ? refs.get(conversationId)?.ref ?? null
      : null);

  const composingRef = composing ? enquiryFor(composing.replyTo.conversationId) : null;

  /**
   * How the reply box finds this enquiry's documents.
   *
   * Only where the screen did not supply them outright — the case file has the
   * record in memory and has no reason to fetch it again. Memoised on the
   * reference rather than rebuilt each render: the picker runs this inside an
   * effect keyed on the function, so a fresh identity every render would
   * refetch continuously.
   */
  const loadAttachables = useMemo(
    () =>
      attachables?.length || !composingRef
        ? undefined
        : () => attachablesForEnquiry(composingRef),
    [attachables, composingRef]
  );

  return (
    <>
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            {error.message}
            {error.hint && <span className="mt-1 block opacity-80">{error.hint}</span>}
          </span>
        </div>
      )}

      <ThreadList
        title={title}
        hint={hint}
        refs={refs}
        assigning={assigning}
        onGiveRef={onGiveRef}
        threads={threads}
        emptyHint={emptyHint}
        openThread={openThread}
        threadMessages={threadMessages}
        threadBusy={threadBusy}
        onOpen={onOpen}
        onReply={(m) => setComposing({ replyTo: m })}
        onChanged={onChanged}
        enquiryFor={enquiryFor}
      />

      {composing && (
        <ComposeMail
          mailbox={mailbox}
          fromName={fromName}
          signature={signature}
          replyTo={composing.replyTo}
          partnerId={partnerId}
          reference={refs.get(composing.replyTo.conversationId)?.ref ?? null}
          // The enquiry this thread is about, so a reply to an agent can carry
          // the shipper's packing list without anybody hunting down the mail it
          // arrived on.
          enquiryRef={composingRef}
          attachables={attachables}
          /*
            No static list, but the thread names an enquiry — so the documents
            are fetched rather than done without. This is what lets an agent be
            sent the quotation from their own screen, instead of the operator
            navigating to the case file to attach it and losing the thread they
            were answering.
          */
          loadAttachables={loadAttachables}
          onClose={() => setComposing(null)}
          onSent={() => {
            setComposing(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}
function ThreadList({
  title,
  hint,
  refs,
  assigning,
  onGiveRef,
  threads,
  emptyHint,
  openThread,
  threadMessages,
  threadBusy,
  onOpen,
  onReply,
  onChanged,
  enquiryFor,
}: {
  title: string;
  hint: string;
  refs: Map<string, ThreadRef>;
  /** The conversation currently being given a reference, if any. */
  assigning?: string | null;
  onGiveRef?: (conversationId: string, subject: string) => void;
  threads: Thread[];
  emptyHint: string;
  /**
   * The case a given thread belongs to, so an attachment can be filed onto it.
   * Decided by the caller, which is the only place that knows whether this is a
   * case file or a partner's mixed correspondence.
   */
  enquiryFor: (conversationId: string) => string | null;
  openThread: string | null;
  threadMessages: MailMessage[];
  threadBusy: boolean;
  onOpen: (t: Thread) => void;
  onReply: (m: MailMessage) => void;
  onChanged: () => void;
}) {
  return (
    <section className="mt-4">
      <h2 className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
        <MessageSquare size={12} /> {title}
        <span className="text-text-muted">{threads.length}</span>
      </h2>
      <p className="mb-2 text-[12px] text-text-muted">{hint}</p>

      {!threads.length ? (
        <p className="py-6 text-[13px] text-text-muted">{emptyHint}</p>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => {
            const open = openThread === t.conversationId;
            const last = t.messages[t.messages.length - 1];
            /**
             * What the thread-level Reply answers.
             *
             * The last of the messages actually fetched, not `last` above —
             * that one comes from the search and is only the newest message the
             * search matched. Replying to it would answer the middle of the
             * thread whenever the final message was one the search did not hit,
             * which is exactly the case on a long exchange.
             */
            const newest = threadMessages[threadMessages.length - 1];
            return (
              <div key={t.conversationId} className="card overflow-hidden">
                <button
                  onClick={() => void onOpen(t)}
                  aria-expanded={open}
                  className="flex w-full items-start justify-between gap-4 p-4 text-left hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <p
                      className={`truncate text-[13px] ${
                        t.unread ? "font-medium text-text-primary" : "text-text-primary"
                      }`}
                    >
                      {t.subject}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-text-secondary">
                      {last.from?.emailAddress?.name || last.from?.emailAddress?.address} · {last.bodyPreview}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {(() => {
                      const r = refs.get(t.conversationId);
                      if (!r) return null;
                      // The series is legible from the reference itself, so the
                      // badge carries no second label saying which it is.
                      return (
                        <span
                          className={`font-mono text-[11px] ${
                            r.kind === "shipment" ? "text-text-accent" : "text-text-secondary"
                          }`}
                          title={r.kind === "shipment" ? "Filed against an enquiry" : "Partner correspondence"}
                        >
                          {r.ref}
                        </span>
                      );
                    })()}
                    {t.messages.length > 1 && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary">
                        {t.messages.length}
                      </span>
                    )}
                    {t.unread && <StatusPill tone="accent">New</StatusPill>}
                    <span className="text-[11px] tabular-nums text-text-muted">
                      {new Date(t.lastAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-border p-4">
                    {threadBusy ? (
                      <p className="flex items-center gap-2 py-4 text-[12px] text-text-muted">
                        <Loader2 size={13} className="animate-spin" />
                        Opening the thread…
                      </p>
                    ) : (
                      <div className="space-y-5">
                        {/*
                          Giving the thread a reference, where it has none.
                          Offered once per conversation and only when there is
                          nothing on it already: a thread filed against an
                          enquiry keeps that reference, because it is the one
                          the customer has been quoted and a second number for
                          the same exchange is how two people end up discussing
                          one job under different names.
                        */}
                        {onGiveRef && !refs.get(t.conversationId) && (
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border-strong px-3 py-2.5">
                            <p className="text-[12px] text-text-secondary">
                              No reference on this thread. Give it one if it is a conversation
                              worth tracking — a rate, a claim, a change of contact.
                            </p>
                            <button
                              onClick={() => onGiveRef(t.conversationId, t.subject)}
                              disabled={assigning === t.conversationId}
                              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2 disabled:opacity-60"
                            >
                              {assigning === t.conversationId ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <Hash size={13} />
                              )}
                              Assign partner ref
                            </button>
                          </div>
                        )}

                        {/*
                          The thread's actions, at the top, acting on its most
                          recent message.
                          ------------------------------------------------------
                          This is how every mail client does it and the reason
                          is the same here: answering a thread means answering
                          where it got to, so there is one Reply and it is
                          reachable without reading to the bottom first. The
                          buttons used to sit under every message, which meant
                          five identical rows on a five-message thread and the
                          only one you wanted at the very end of the scroll.

                          Read and Send-to-enquiries come from the same panel
                          the intake queue uses, so an agent's mail is turned
                          into an enquiry by the same act as a customer's.
                        */}
                        {newest && (
                          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
                            <button
                              onClick={() => onReply(newest)}
                              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark"
                            >
                              <Reply size={13} />
                              Reply
                            </button>

                            {/*
                              Making an enquiry out of this — but only where
                              there is not one already.

                              Both buttons in that panel mint a NEW enquiry:
                              one into the shared queue, one straight onto your
                              list. On a thread that is already filed against a
                              shipment reference, pressing either produces a
                              second reference for the same conversation. That
                              is not clutter, it is a duplicate the desk cannot
                              take back — a reference is never deleted, because
                              the correspondence under it is the record of what
                              a customer was told.

                              A partner thread with a PALG, or none at all, is
                              a different matter: a rate conversation becoming
                              a shipment is exactly how this desk works.
                            */}
                            {refs.get(t.conversationId)?.kind !== "shipment" && (
                              <>
                                {/*
                                  Filing onto a job that already exists, which
                                  is the common case for an agent: their rate
                                  reply belongs on the customer's enquiry, not
                                  on a new one of its own.
                                */}
                                <FileToEnquiry message={newest} onFiled={onChanged} />
                                <PushMailToQueue message={newest} onChanged={onChanged} />
                              </>
                            )}
                          </div>
                        )}

                        {threadMessages.map((m) => (
                          <article key={m.id} className="border-b border-border pb-5 last:border-0 last:pb-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <MessageHeader
                                  message={m}
                                  complete
                                  when={new Date(m.receivedDateTime).toLocaleString("en-IN")}
                                />
                              </div>

                              {/*
                                Per message, the arrow alone. Answering one
                                message in the middle of a thread is a real
                                thing to want — a rate quoted three replies
                                back — and it is rare enough that it does not
                                need a word next to it.
                              */}
                              <button
                                onClick={() => onReply(m)}
                                title="Reply to this message"
                                aria-label={`Reply to the message from ${
                                  m.from?.emailAddress?.name || m.from?.emailAddress?.address || "this sender"
                                }`}
                                className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
                              >
                                <Reply size={13} />
                              </button>
                            </div>

                            <MailBody message={m} />

                            {/*
                              The case this thread's attachments belong to.

                              Per thread, not per screen. On a case file every
                              thread is that enquiry's, so the prop answers it.
                              On the partner screen it depends: a thread
                              carrying an ALG reference is about that shipment
                              and its packing list belongs on it, while a PALG
                              thread is a rate discussion or a claim that
                              belongs to no single job — and an unreferenced
                              one has nowhere to put a file at all. Offering
                              "save" on those would mean guessing a case, and a
                              customer's document on the wrong job is worse
                              than one still in the mailbox.
                            */}
                            <MessageAttachments
                              message={m}
                              enquiryRef={enquiryFor(t.conversationId)}
                              onFiled={onChanged}
                            />
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
