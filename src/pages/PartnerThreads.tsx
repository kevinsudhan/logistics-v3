import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  ChevronLeft,
  Handshake,
  Hash,
  Loader2,
  Mail as MailIcon,
  MessageSquare,
  Phone,
  Reply,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import MailBody from "../components/MailBody";
import MessageHeader from "../components/MessageHeader";
import ComposeMail from "../components/ComposeMail";
import PushMailToQueue from "../components/PushMailToQueue";
import { useAuth } from "../lib/auth";
import { failureText, type FailureText } from "../lib/errorText";
import { groupIntoThreads, involves, type Thread } from "../lib/threads";
import {
  getMessage,
  mentionsQuery,
  messagesInConversation,
  participantsQuery,
  searchMailbox,
} from "../services/graphMail";
import {
  assignPartnerRef,
  refsFor,
  REF_FILTERS,
  type RefKind,
  type ThreadRef,
} from "../services/threadRefs";
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

  /** ALG / PALG references, by conversation id, and which series to show. */
  const [refs, setRefs] = useState<Map<string, ThreadRef>>(new Map());
  const [refFilter, setRefFilter] = useState<RefKind | "all">("all");
  const [assigning, setAssigning] = useState<string | null>(null);

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

      // Two searches per address, asking two different questions.
      //
      // `participants:` is the one that matters: it matches the from, to, cc
      // and bcc of every message, which is what correspondence is. A bare
      // phrase does not reliably match an address that appears only in a
      // recipient field, so on its own it finds the mail they sent us and
      // misses most of what we sent them — half an exchange, reading as though
      // nobody ever replied.
      //
      // The bare phrase is still asked, separately, because a message that
      // names the address in its body is about this partner and worth seeing.
      // It is shown apart rather than mixed in.
      const [onIt, named] = await Promise.all([
        Promise.all(
          p.emails.map((e) =>
            searchMailbox(mailbox, participantsQuery(e)).catch(() => [] as MailMessage[])
          )
        ),
        Promise.all(
          p.emails.map((e) =>
            searchMailbox(mailbox, mentionsQuery(e)).catch(() => [] as MailMessage[])
          )
        ),
      ]);

      // Deduplicated by id: a message addressed to two of their addresses comes
      // back from both searches and is still one message.
      const seen = new Map<string, MailMessage>();
      for (const page of [...onIt, ...named]) for (const m of page) seen.set(m.id, m);
      const found = [...seen.values()];
      setMessages(found);

      // Which of these threads already carry a reference. Best-effort: the mail
      // is the point of the screen and a reference lookup that fails should not
      // blank it.
      setRefs(await refsFor(found.map((x) => x.conversationId)).catch(() => new Map()));
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

  const kindOf = useCallback(
    (conversationId: string): RefKind => refs.get(conversationId)?.kind ?? "none",
    [refs]
  );

  /** Threads where the partner is actually on the message. */
  const correspondence = useMemo(
    () =>
      groupIntoThreads(messages.filter((m) => involves(m, addresses))).filter(
        (t) => refFilter === "all" || kindOf(t.conversationId) === refFilter
      ),
    [messages, addresses, refFilter, kindOf]
  );

  /** How many threads sit under each chip, so an empty one is visibly empty. */
  const refCounts = useMemo(() => {
    const all = groupIntoThreads(messages.filter((m) => involves(m, addresses)));
    const c: Record<string, number> = { all: all.length, shipment: 0, partner: 0, none: 0 };
    for (const t of all) c[kindOf(t.conversationId)] += 1;
    return c;
  }, [messages, addresses, kindOf]);

  /**
   * Gives a thread a PALG reference.
   *
   * Only offered on threads that have none. A thread already filed against an
   * enquiry keeps that reference — it is the one the customer has been quoted,
   * and a second number for the same conversation is how two people come to be
   * talking about the same job by different names.
   */
  const giveRef = useCallback(
    async (conversationId: string, subject: string) => {
      if (!partner) return;
      setAssigning(conversationId);
      setError(null);
      try {
        const ref = await assignPartnerRef({ conversationId, partnerId: partner.id, subject });
        setRefs((prev) => {
          const next = new Map(prev);
          next.set(conversationId, { conversationId, ref, kind: "partner" });
          return next;
        });
      } catch (e) {
        setError(failureText(e, "Could not give that thread a reference."));
      } finally {
        setAssigning(null);
      }
    },
    [partner]
  );

  /** Threads that only mention the address — kept apart, not discarded. */
  const mentions = useMemo(
    () =>
      groupIntoThreads(messages.filter((m) => !involves(m, addresses))).filter(
        (t) => refFilter === "all" || kindOf(t.conversationId) === refFilter
      ),
    [messages, addresses, refFilter, kindOf]
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
            to="/partners/mail"
            className="inline-flex h-8 items-center rounded-lg border border-border-strong bg-surface-1 px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2"
          >
            Back to partner mail
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <Link
        to="/partners/mail"
        className="mb-4 inline-flex items-center gap-1 text-[12px] text-text-secondary hover:text-text-primary"
      >
        <ChevronLeft size={14} /> Back to partner mail
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
              to={`/partners/${partner.id}/edit`}
              className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark"
            >
              Add an address
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
          {/*
            Which series to show. ALG threads are about a shipment and reached
            here through the enquiry they were filed against; PALG are the ones
            somebody chose to track on their own. Counts sit on the chips so an
            empty series is visible before it is opened.
          */}
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {REF_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setRefFilter(f.key)}
                title={f.hint}
                className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors ${
                  refFilter === f.key
                    ? "border-brand bg-brand text-white"
                    : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
                }`}
              >
                {f.label} <span className="opacity-60">{refCounts[f.key] ?? 0}</span>
              </button>
            ))}
          </div>

          <ThreadList
            title="Correspondence"
            hint={`Threads ${partner.organisation || partner.name} is on.`}
            refs={refs}
            assigning={assigning}
            onGiveRef={giveRef}
            threads={correspondence}
            emptyHint="Nothing exchanged with this address yet."
            openThread={openThread}
            threadMessages={threadMessages}
            threadBusy={threadBusy}
            onOpen={openOn}
            onReply={(m) => setComposing({ replyTo: m })}
            onChanged={load}
          />

          {mentions.length > 0 && (
            <ThreadList
              title="Mentioned"
              hint="Their address appears in the message but they are not on it — usually somebody else discussing them."
              refs={refs}
              assigning={assigning}
              onGiveRef={giveRef}
              threads={mentions}
              emptyHint=""
              openThread={openThread}
              threadMessages={threadMessages}
              threadBusy={threadBusy}
              onOpen={openOn}
              onReply={(m) => setComposing({ replyTo: m })}
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
          partnerId={partner.id}
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
}: {
  title: string;
  hint: string;
  refs: Map<string, ThreadRef>;
  /** The conversation currently being given a reference, if any. */
  assigning: string | null;
  onGiveRef: (conversationId: string, subject: string) => void;
  threads: Thread[];
  emptyHint: string;
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
                        {!refs.get(t.conversationId) && (
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
                            <PushMailToQueue message={newest} onChanged={onChanged} />
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
