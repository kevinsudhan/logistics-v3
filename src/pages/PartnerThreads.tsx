import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  ChevronLeft,
  Handshake,
  Loader2,
  Mail as MailIcon,
  MessageSquare,
  Phone,
  Reply,
  Sparkles,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import MailBody from "../components/MailBody";
import MessageHeader from "../components/MessageHeader";
import ComposeMail from "../components/ComposeMail";
import PushMailToQueue from "../components/PushMailToQueue";
import ReadingPanel from "../components/ReadingPanel";
import Drafting from "../components/Drafting";
import { useAuth } from "../lib/auth";
import { failureText, type FailureText } from "../lib/errorText";
import { groupIntoThreads, involves, type Thread } from "../lib/threads";
import { getMessage, searchMailbox, messagesInConversation } from "../services/graphMail";
import { readMessage, type Reading } from "../services/classify";
import { listPartners, PARTNER_ROLE_LABEL, type Partner } from "../services/partners";
import { mailIsLive } from "../services/backend";
import type { MailMessage } from "../services/mockMail";

/**
 * One partner, and everything we have exchanged with them.
 *
 * ---------------------------------------------------------------------------
 * WHY A PARTNER HAS A MAIL VIEW OF THEIR OWN
 *
 * Because that is the unit of the relationship. An enquiry's case file answers
 * "what was said about this shipment"; this answers "what is going on with this
 * agent", which is the question you have when they ring, when a rate is late,
 * or when somebody new takes the account over. Until now the only way to that
 * answer was to search the mailbox by hand and hope you remembered the address.
 *
 * WHY IT IS BUILT ON SEARCH RATHER THAN ON A TABLE
 *
 * There is no partner_messages table and there should not be one. The mailbox
 * is the record; a copy of it in Postgres would be a second thing to keep in
 * step, and it would be wrong the first time somebody replied from Outlook
 * rather than from here. The address is the join, and Graph does the searching.
 *
 * WHAT "CORRESPONDENCE" MEANS HERE
 *
 * A thread where the partner is on the From, To or Cc of some message in it.
 * The search also returns mail that merely mentions the address in its body --
 * a colleague forwarding "chase Gulf Line on this" -- and those are shown, in
 * their own section, rather than thrown away or quietly mixed in.
 * ---------------------------------------------------------------------------
 */
export default function PartnerThreads() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const mailbox = session?.email ?? "";

  const [partner, setPartner] = useState<Partner | null>(null);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FailureText | null>(null);

  /** The thread being read, and the full messages fetched for it. */
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<MailMessage[]>([]);
  const [threadBusy, setThreadBusy] = useState(false);

  const [composing, setComposing] = useState<null | { replyTo: MailMessage }>(null);

  /** The AI reading of one message, keyed by message id. */
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [reading, setReading] = useState<string | null>(null);

  const live = mailIsLive();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // listPartners rather than a getPartner: there is no single-row loader in
      // the service and adding one for this would be a query that returns what
      // the list already has in memory on the page you came from.
      const all = await listPartners(true);
      const p = all.find((x) => x.id === id) ?? null;
      setPartner(p);

      if (!p || !live || !mailbox) return;

      // One search per address, because Graph's $search takes a phrase rather
      // than a set. Two addresses is the usual case and three is rare, so this
      // is two requests, not twenty.
      const pages = await Promise.all(
        p.emails.map((e) => searchMailbox(mailbox, e).catch(() => [] as MailMessage[]))
      );

      // Deduplicated by id: a message addressed to two of their addresses comes
      // back from both searches and is still one message.
      const seen = new Map<string, MailMessage>();
      for (const page of pages) for (const m of page) seen.set(m.id, m);
      setMessages([...seen.values()]);
    } catch (e) {
      setError(failureText(e, "Could not load this partner's correspondence."));
    } finally {
      setLoading(false);
    }
  }, [id, mailbox, live]);

  useEffect(() => {
    void load();
  }, [load]);

  const addresses = useMemo(() => partner?.emails ?? [], [partner]);

  /** Threads where the partner is actually on the message. */
  const correspondence = useMemo(
    () => groupIntoThreads(messages.filter((m) => involves(m, addresses))),
    [messages, addresses]
  );

  /** Threads that only mention the address — kept apart, not discarded. */
  const mentions = useMemo(
    () => groupIntoThreads(messages.filter((m) => !involves(m, addresses))),
    [messages, addresses]
  );

  /**
   * Opens a thread, and fetches the messages in it.
   *
   * The search result carries a preview, not a body. Reading needs the whole
   * thing, and a thread is short enough that fetching all of them at once is
   * one wait rather than one per message as you scroll.
   */
  const openOn = useCallback(
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
        // Ask Graph for the conversation rather than reusing the search hits:
        // the search only found the messages that matched, and a thread is the
        // whole exchange including the ones that did not.
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

  async function readWithAi(m: MailMessage) {
    setReading(m.id);
    try {
      const r = await readMessage(m);
      setReadings((prev) => ({ ...prev, [m.id]: r }));
    } catch (e) {
      setError(failureText(e, "Could not read that message."));
    } finally {
      setReading(null);
    }
  }

  if (loading && !partner) {
    return <p className="py-10 text-[13px] text-text-muted">Loading…</p>;
  }

  if (!partner) {
    return (
      <EmptyState
        icon={Handshake}
        title="No partner with that id"
        hint="It may have been removed, or the link may be from an older record."
        action={
          <Link
            to="/partners"
            className="inline-flex h-8 items-center rounded-lg border border-border-strong bg-surface-1 px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2"
          >
            Back to partners
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <Link
        to="/partners"
        className="mb-4 inline-flex items-center gap-1 text-[12px] text-text-secondary hover:text-text-primary"
      >
        <ChevronLeft size={14} /> Back to partners
      </Link>

      <PageHeader
        title={partner.organisation || partner.name}
        // The address is the subtitle because it is the identity here: it is
        // what the mail is matched on, and the thing you check before writing.
        subtitle={partner.emails.join(" · ") || "No email address on file"}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill tone="accent">{PARTNER_ROLE_LABEL[partner.role]}</StatusPill>
        {!partner.active && <StatusPill tone="warning">Archived</StatusPill>}
        {partner.organisation && partner.name && (
          <span className="text-[12px] text-text-secondary">{partner.name}</span>
        )}
        {partner.phones.map((n) => (
          <a
            key={n}
            href={`tel:${n}`}
            className="inline-flex items-center gap-1 text-[12px] text-text-secondary hover:text-text-primary"
          >
            <Phone size={11} />
            {n}
          </a>
        ))}
        {partner.tags.length > 0 && (
          <span className="text-[11px] text-text-muted">{partner.tags.join(" · ")}</span>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            {error.message}
            {error.hint && <span className="mt-1 block opacity-80">{error.hint}</span>}
          </span>
        </div>
      )}

      {!partner.emails.length ? (
        <EmptyState
          icon={MailIcon}
          title="No address to match on"
          hint="Correspondence is found by email address. Add one to this partner and their threads will appear here."
          action={
            <Link
              to="/partners"
              className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark"
            >
              Edit this partner
            </Link>
          }
        />
      ) : !live ? (
        <EmptyState
          icon={MailIcon}
          title="Outlook is not connected on this session"
          hint="Sign in with Microsoft on the Mail screen and this fills itself in — the correspondence is read from the mailbox, not stored here."
          action={
            <Link
              to="/mail"
              className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark"
            >
              Go to Mail
            </Link>
          }
        />
      ) : (
        <>
          <ThreadList
            title="Correspondence"
            hint={`Threads ${partner.organisation || partner.name} is on.`}
            threads={correspondence}
            emptyHint="Nothing exchanged with this address yet."
            openThread={openThread}
            threadMessages={threadMessages}
            threadBusy={threadBusy}
            readings={readings}
            reading={reading}
            onOpen={openOn}
            onReply={(m) => setComposing({ replyTo: m })}
            onRead={readWithAi}
            onChanged={load}
          />

          {mentions.length > 0 && (
            <ThreadList
              title="Mentioned"
              hint="Their address appears in the message but they are not on it — usually somebody else discussing them."
              threads={mentions}
              emptyHint=""
              openThread={openThread}
              threadMessages={threadMessages}
              threadBusy={threadBusy}
              readings={readings}
              reading={reading}
              onOpen={openOn}
              onReply={(m) => setComposing({ replyTo: m })}
              onRead={readWithAi}
              onChanged={load}
            />
          )}
        </>
      )}

      {composing && (
        <ComposeMail
          mailbox={mailbox}
          fromName={session?.name ?? ""}
          // Same signature as a reply sent from the Mail screen. A reply that
          // goes out unsigned because of which page it was written on is the
          // kind of difference a customer notices and nobody here would.
          signature={session?.signature ?? ""}
          replyTo={composing.replyTo}
          onClose={() => setComposing(null)}
          onSent={() => {
            setComposing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/**
 * A list of threads, and whichever one is open expanded in place.
 *
 * In place rather than in a second pane, because a partner's list is short and
 * a two-pane layout would spend half the width on a list of five rows.
 */
function ThreadList({
  title,
  hint,
  threads,
  emptyHint,
  openThread,
  threadMessages,
  threadBusy,
  readings,
  reading,
  onOpen,
  onReply,
  onRead,
  onChanged,
}: {
  title: string;
  hint: string;
  threads: Thread[];
  emptyHint: string;
  openThread: string | null;
  threadMessages: MailMessage[];
  threadBusy: boolean;
  readings: Record<string, Reading>;
  reading: string | null;
  onOpen: (t: Thread) => void;
  onReply: (m: MailMessage) => void;
  onRead: (m: MailMessage) => void;
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
                        {threadMessages.map((m) => (
                          <article key={m.id} className="border-b border-border pb-5 last:border-0 last:pb-0">
                            <MessageHeader
                              message={m}
                              complete
                              when={new Date(m.receivedDateTime).toLocaleString("en-IN")}
                            />
                            <MailBody message={m} />

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <button
                                onClick={() => onReply(m)}
                                className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark"
                              >
                                <Reply size={13} />
                                Reply
                              </button>

                              {/* The same reading the intake queue uses. */}
                              <button
                                onClick={() => onRead(m)}
                                disabled={reading === m.id}
                                className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-60"
                              >
                                {reading === m.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Sparkles size={13} />
                                )}
                                Read it
                              </button>

                              {/* Turning an agent's mail into an enquiry is the
                                  same act as turning a customer's into one. */}
                              <PushMailToQueue message={m} onChanged={onChanged} />
                            </div>

                            {reading === m.id && !readings[m.id] && (
                              <div className="mt-3">
                                <Drafting label="Reading the message" lines={3} compact />
                              </div>
                            )}
                            {readings[m.id] && (
                              <div className="mt-3">
                                <ReadingPanel reading={readings[m.id]} />
                              </div>
                            )}
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
