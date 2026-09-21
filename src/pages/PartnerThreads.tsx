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
import ThreadReader from "../components/ThreadReader";
import { useAuth } from "../lib/auth";
import { failureText, type FailureText } from "../lib/errorText";
import { groupIntoThreads, involves } from "../lib/threads";
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

  /** The messages behind each list, filtered by the chips above them. */
  const correspondenceMessages = useMemo(
    () =>
      messages
        .filter((m) => involves(m, addresses))
        .filter((m) => refFilter === "all" || kindOf(m.conversationId) === refFilter),
    [messages, addresses, refFilter, kindOf]
  );

  const mentionMessages = useMemo(
    () =>
      messages
        .filter((m) => !involves(m, addresses))
        .filter((m) => refFilter === "all" || kindOf(m.conversationId) === refFilter),
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

          <ThreadReader
            mailbox={mailbox}
            fromName={session?.name ?? ""}
            signature={session?.signature ?? ""}
            partnerId={partner.id}
            messages={correspondenceMessages}
            refFor={(id) => refs.get(id) ?? null}
            onGiveRef={giveRef}
            assigning={assigning}
            title="Correspondence"
            hint={`Threads ${partner.organisation || partner.name} is on.`}
            emptyHint="Nothing exchanged with this address yet."
            onChanged={load}
          />

          {mentionMessages.length > 0 && (
            <ThreadReader
              mailbox={mailbox}
              fromName={session?.name ?? ""}
              signature={session?.signature ?? ""}
              partnerId={partner.id}
              messages={mentionMessages}
              refFor={(id) => refs.get(id) ?? null}
              onGiveRef={giveRef}
              assigning={assigning}
              title="Mentioned"
              hint="Their address appears in the message but they are not on it — usually somebody else discussing them."
              emptyHint=""
                onChanged={load}
            />
          )}
        </>
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
