import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import {
  Archive,
  Inbox,
  Mail as MailIcon,
  Paperclip,
  PenSquare,
  PenLine,
  RefreshCw,
  Reply,
  Search,
  Send,
  FileEdit,
  AlertCircle,
  Loader2,
  Package,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import ComposeMail from "../components/ComposeMail";
import SignatureEditor from "../components/SignatureEditor";
import PushMailToQueue from "../components/PushMailToQueue";
import MailBody from "../components/MailBody";
import MessageHeader from "../components/MessageHeader";
import MailListRow from "../components/MailListRow";
import { useAuth } from "../lib/auth";
import {
  getMailFolders,
  getMailMessage,
  getMailMessages,
  getMoreMailMessages,
  moveMailMessage,
  setMailRead,
  mailIsLive,
  whoami,
  GraphAuthError,
  type FolderId,
  type MailFolder,
  type MailMessage,
} from "../services/backend";
import { intakeByMessage, type Intake } from "../services/intake";
import { refsFor } from "../services/threadRefs";
import { listPeople, type Person } from "../services/enquiries";

const FOLDER_ICON: Record<FolderId, React.ElementType> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileEdit,
  archive: Archive,
};

/**
 * Outlook inside the CRM.
 *
 * Three panes, because that is what a mail client is and inventing a novel
 * layout for one only makes it slower to use: folders, the list, the message.
 *
 * The mailbox is the signed-in account and nothing else. There is no mailbox
 * picker, because a person signed in as imports@ has no business reading
 * aarathy@ -- and a picker is how that ends up happening by accident.
 */
export default function Mail() {
  const { session, signInWithMicrosoft, saveSignature } = useAuth();
  const mailbox = session?.email ?? "";

  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [folder, setFolder] = useState<FolderId>("inbox");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * The opened message, fetched in full.
   *
   * The list query does not ask for bodies — forty of them would be a slow
   * request and most are never read — so a row carries only Graph's plain-text
   * preview. The reading pane was rendering that preview and calling it the
   * message, which is why every mail arrived stripped of its formatting and cut
   * off around 255 characters. This holds the real one.
   */
  const [full, setFull] = useState<MailMessage | null>(null);
  /**
   * Why the body is not here, when it is not here.
   *
   * A failed fetch used to be swallowed, and the pane fell back to the list row
   * — whose body is Graph's 255-character preview wearing the same shape as a
   * real one. So a throttled or expired request looked exactly like a short
   * message, and the only symptom was mail that "doesn't load properly".
   */
  const [bodyError, setBodyError] = useState<string | null>(null);
  /**
   * Which open is the current one.
   *
   * Two clicks in quick succession are two requests, and they do not have to
   * come back in order. Guarding on the previous state could not tell them
   * apart — each open clears it first — so a slow first response could land
   * under the second message's header. A counter can.
   */
  const openReq = useRef(0);
  /** The desk, so a message can be handed straight to a colleague. */
  const [people, setPeople] = useState<Person[]>([]);
  /**
   * What the intake queue already knows about the messages on screen.
   *
   * Fetched once per folder load rather than per row, so a hundred-message
   * inbox is one request. Without it every row would offer to queue a message
   * that is already queued, and the press would silently return the same row.
   */
  const [queued, setQueued] = useState<Map<string, Pick<Intake, "id" | "status" | "enquiry_ref">>>(
    new Map()
  );
  /**
   * Graph's link to the next page, when there is one.
   *
   * Its absence is what "that is all of them" means — there is no count to
   * compare against, because the folder's total counts everything in the
   * mailbox while the list holds only what has been fetched.
   */
  const [nextLink, setNextLink] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState<null | { replyTo?: MailMessage }>(null);
  /**
   * The reference this conversation is already filed under, if any.
   *
   * Usually the subject still carries it and the reply inherits it for free.
   * This is for when it does not: plenty of senders rewrite a subject, and a
   * reply that goes back without the token breaks the filing for every message
   * after it. Looked up when the box opens, for the one conversation.
   */
  const [replyRef, setReplyRef] = useState<string | null>(null);
  const [editingSignature, setEditingSignature] = useState(false);
  const live = mailIsLive();

  /**
   * The address Microsoft says the token belongs to.
   *
   * Not the same thing as the CRM profile's email, and the difference matters:
   * /me/sendMail sends as whoever the token is, regardless of what this app
   * believes. A tenant with two domains can easily end up signing someone in as
   * one address while their Microsoft account sits on the other -- and mail then
   * goes out from a domain whose SPF may not be set up, which looks like the CRM
   * failing to send when it is actually sending as somebody else.
   */
  const [graphMailbox, setGraphMailbox] = useState<string | null>(null);

  /**
   * Opening one message by id, from a link somewhere else in the CRM.
   *
   * The partner-quotes panel links to the reply a rate was read out of, and
   * "open the mail it came from" has to land ON that mail rather than on the
   * inbox with an instruction to go and find it.
   *
   * It fetches the message directly rather than hunting the list for it: the
   * reply may be older than the fifty rows loaded, or filed in a folder that is
   * not the one showing. The id is the whole address.
   */
  const [params, setParams] = useSearchParams();
  const wanted = params.get("open");

  useEffect(() => {
    if (!live) {
      setGraphMailbox(null);
      return;
    }
    let cancelled = false;
    void whoami().then((who) => !cancelled && setGraphMailbox(who));
    return () => {
      cancelled = true;
    };
  }, [live]);

  const load = useCallback(async () => {
    if (!mailbox) return;
    setLoading(true);
    setError(null);
    try {
      const [f, m] = await Promise.all([
        getMailFolders(mailbox),
        getMailMessages(mailbox, folder, query || undefined),
      ]);
      setFolders(f.folders);
      setMessages(m.messages);
      setNextLink(m.nextLink);
      // One lookup for the whole folder, so each row can say whether it has
      // already been queued instead of offering a push that does nothing.
      setQueued(await intakeByMessage(m.messages.map((x) => x.id)));
    } catch (e) {
      setError(
        e instanceof GraphAuthError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not load the mailbox."
      );
    } finally {
      setLoading(false);
    }
  }, [mailbox, folder, query]);

  useEffect(() => {
    void load();
  }, [load]);

  // Resolve the conversation's reference when the compose box opens. Cancelled
  // on close so a slow lookup cannot land on the next message opened.
  useEffect(() => {
    const conversationId = composing?.replyTo?.conversationId;
    if (!conversationId) {
      setReplyRef(null);
      return;
    }
    let live = true;
    refsFor([conversationId])
      .then((found) => {
        if (live) setReplyRef(found.get(conversationId)?.ref ?? null);
      })
      // Best-effort: the subject usually carries the token already, and a
      // failed lookup must not stop somebody answering their mail.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [composing]);

  /**
   * Appends the next page.
   *
   * Appends rather than replaces, and de-duplicates on the way in: mail
   * arriving between two pages shifts everything down by one, which makes Graph
   * hand back a message the list already has.
   */
  async function loadMore() {
    if (!nextLink || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await getMoreMailMessages(mailbox, folder, nextLink);
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...more.messages.filter((m) => !seen.has(m.id))];
      });
      setNextLink(more.nextLink);
      // The new rows need their queue status too, or they would all offer to
      // queue a message that is already filed.
      const fresh = await intakeByMessage(more.messages.map((x) => x.id));
      setQueued((prev) => new Map([...prev, ...fresh]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more mail.");
    } finally {
      setLoadingMore(false);
    }
  }

  // Fetched once. It is four rows and it does not change while a folder is read.
  useEffect(() => {
    void listPeople().then(setPeople).catch(() => setPeople([]));
  }, []);

  // Changing folder should not leave the previous folder's message on screen,
  // nor its body waiting behind the next selection.
  useEffect(() => {
    setSelectedId(null);
    // Retire any request still in flight, so its answer cannot arrive into the
    // new folder and reopen a message from the old one.
    openReq.current++;
    setFull(null);
    setBodyError(null);
  }, [folder]);

  /**
   * The row, and the full message once it lands.
   *
   * The row arrives first and carries everything the header needs, so the pane
   * can draw immediately and fill in the body a moment later rather than
   * flashing empty.
   */
  const row = useMemo(
    () => messages.find((m) => m.id === selectedId) ?? null,
    [messages, selectedId]
  );
  const selected = useMemo(
    () => (full && full.id === selectedId ? { ...row, ...full } : row),
    [row, full, selectedId]
  );

  /**
   * Fetches the real body for a message, and says so when it cannot.
   *
   * Separate from `open` because it is also what Try again calls: a body that
   * failed to arrive is worth one press to ask for again, and re-opening the
   * message to get that press would mean marking it read a second time.
   */
  const loadBody = useCallback(
    (id: string) => {
      const req = ++openReq.current;
      setFull(null);
      setBodyError(null);
      void getMailMessage(mailbox, id, folder)
        .then((r) => {
          // A response for a message nobody is looking at any more is dropped.
          if (req !== openReq.current) return;
          setFull(r.message);
        })
        .catch((e) => {
          if (req !== openReq.current) return;
          setBodyError(e instanceof Error ? e.message : "The message could not be loaded.");
        });
    },
    [mailbox, folder]
  );

  useEffect(() => {
    if (!wanted) return;
    // Consumed once. Left in the URL it would reopen on every refetch and fight
    // whatever the operator clicked since.
    setParams((p) => {
      p.delete("open");
      return p;
    }, { replace: true });

    setSelectedId(wanted);
    loadBody(wanted);
  }, [wanted, setParams, loadBody]);

  async function open(m: MailMessage) {
    setSelectedId(m.id);

    // The body has to be fetched; the row does not have one.
    loadBody(m.id);

    if (!m.isRead) {
      // Optimistic: the row should stop looking unread the instant it is clicked.
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, isRead: true } : x)));
      setFolders((prev) =>
        prev.map((f) => (f.id === "inbox" ? { ...f, unread: Math.max(0, f.unread - 1) } : f))
      );
      try {
        await setMailRead(mailbox, m.id, true);
      } catch {
        void load();
      }
    }
  }

  async function archive(m: MailMessage) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    setSelectedId(null);
    try {
      await moveMailMessage(mailbox, m.id, "archive");
      void load();
    } catch {
      void load();
    }
  }

  if (!mailbox) return null;

  return (
    <div>
      <PageHeader
        title="Mail"
        subtitle={
          live && graphMailbox
            ? `Connected to Outlook as ${graphMailbox} — mail sent from here is sent as this address.`
            : `Outlook for ${mailbox} — the desk's mailbox, alongside the shipments it is about.`
        }
      />

      {/*
        A mismatch here is not cosmetic: mail leaves as the Microsoft address, so
        if the two disagree the sender is not who the CRM has been claiming.
      */}
      {live && graphMailbox && graphMailbox.toLowerCase() !== mailbox.toLowerCase() && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            You are signed into the CRM as <strong className="font-medium">{mailbox}</strong> but
            Outlook is connected as <strong className="font-medium">{graphMailbox}</strong>.
            Mail sent from here will come from the Outlook address, not the CRM one.
          </span>
        </div>
      )}

      {/*
        Whether this is a real mailbox is not a detail to leave people guessing
        about: "Send" means something very different in each case.
      */}
      {/*
        Connecting is offered here rather than only on the login page. Someone who
        signed in with a password has no way back to Microsoft short of signing
        out, and "sign out to fix your mail" is not an instruction worth giving.
      */}
      {!live && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <div className="flex-1">
            <p>
              <strong className="font-medium">Demonstration mailbox.</strong> These messages are
              samples, and anything sent from here is filed locally rather than delivered.
            </p>
            <button
              onClick={() => void signInWithMicrosoft()}
              className="mt-2 inline-flex items-center gap-2 h-7 px-2.5 rounded-lg border border-border-strong bg-surface-1 text-[12px] font-medium text-text-primary hover:bg-surface-2"
            >
              <MicrosoftMark />
              Connect Outlook for {mailbox}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setComposing({})}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium"
        >
          <PenSquare size={13} />
          New message
        </button>

        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this folder…"
            className="w-full pl-8 h-8"
          />
        </div>

        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>

        <button
          onClick={() => setEditingSignature(true)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <PenLine size={13} />
          Signature
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/*
        Folders run across the top rather than down the side.
        ------------------------------------------------------------------
        As a column they cost 168px of width permanently, to show four items
        that never change and are read once a session. Horizontally they cost a
        row of height and give that width back to the two panes that actually
        hold content — the list and the message. On a wide screen that is the
        difference between a rate card fitting and a rate card scrolling.
      */}
      <nav className="card mb-3 flex flex-wrap items-center gap-1 p-1.5">
          {folders.map((f) => {
            const Icon = FOLDER_ICON[f.id];
            const active = f.id === folder;
            return (
              <button
                key={f.id}
                onClick={() => setFolder(f.id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                  active
                    ? "bg-surface-2 text-text-primary font-medium"
                    : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                }`}
              >
                <Icon size={14} />
                {f.label}
                {f.unread > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[10px] font-medium flex items-center justify-center">
                    {f.unread}
                  </span>
                )}
              </button>
            );
          })}
      </nav>

      {/* Two panes now, not three. The list keeps a readable column and the
          message takes everything else. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-3 items-start">
        {/* ---- message list ---- */}
        <div className="card overflow-hidden">
          {loading && messages.length === 0 ? (
            <p className="text-[13px] text-text-muted p-4">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-[13px] text-text-muted p-4">
              {query ? "Nothing matches that search." : "Nothing in this folder."}
            </p>
          ) : (
            <ul className="divide-y divide-border max-h-[calc(100vh-260px)] min-h-[300px] overflow-y-auto">
              {messages.map((m) => (
                <MailListRow
                  key={m.id}
                  message={m}
                  folder={folder}
                  selected={selectedId === m.id}
                  queued={queued.get(m.id)}
                  onOpen={() => void open(m)}
                  onChanged={() => void load()}
                />
              ))}
            </ul>
          )}

          {/*
            Sits under the scroller rather than inside it, so it does not have
            to be scrolled to twice — once to the bottom of the list, once to
            find the button.
          */}
          {messages.length > 0 && (
            <div className="border-t border-border px-3 py-2">
              {nextLink ? (
                <button
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-60"
                >
                  {loadingMore ? <Loader2 size={13} className="animate-spin" /> : null}
                  {loadingMore ? "Loading…" : "Load older mail"}
                </button>
              ) : (
                <p className="py-0.5 text-center text-[11px] text-text-muted">
                  {messages.length} message{messages.length === 1 ? "" : "s"} — that is the whole
                  folder.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ---- reading pane ---- */}
        <div className="card p-5 min-h-[320px]">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-16">
              <MailIcon size={22} className="text-text-muted mb-2" />
              <p className="text-[13px] text-text-muted">Select a message to read it.</p>
            </div>
          ) : (
            <article>
              <h2 className="text-[17px] font-semibold tracking-tight text-text-primary">
                {selected.subject}
              </h2>

              {/* Sender, recipients and the forward chain, as one record of who
                  is involved rather than three lines of grey text. */}
              <MessageHeader
                message={selected}
                complete={Boolean(full && full.id === selectedId)}
                when={fullTime(selected.receivedDateTime)}
              />

              <ShipmentLinks text={`${selected.subject} ${selected.body.content}`} />

              <div className="mt-4 flex flex-wrap items-start gap-2">
                <button
                  onClick={() => setComposing({ replyTo: selected })}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium transition-colors"
                >
                  <Reply size={13} />
                  Reply
                </button>

                {/*
                  Beside reply and archive, because it is the third thing you do
                  with a message: answer it, file it away, or decide it is work.
                */}
                <PushMailToQueue
                  message={selected}
                  queued={queued.get(selected.id)}
                  people={people}
                  meId={session?.userId}
                  onChanged={() => void load()}
                />

                {selected.folder !== "archive" && (
                  <button
                    onClick={() => void archive(selected)}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
                  >
                    <Archive size={13} />
                    Archive
                  </button>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-border">
                {/*
                  The body is only ever drawn from the fetched message. The list
                  row carries a 255-character preview in the same shape, and
                  rendering that on a failure is what made a broken request look
                  like a short mail.
                */}
                {full && full.id === selectedId ? (
                  <MailBody message={selected} />
                ) : bodyError ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
                    <span className="inline-flex items-start gap-2">
                      <AlertCircle size={13} className="mt-px shrink-0" />
                      {bodyError}
                    </span>
                    <button
                      onClick={() => loadBody(selected.id)}
                      className="h-7 px-2.5 rounded-lg border border-current/30 text-[12px] hover:bg-white/40 transition-colors"
                    >
                      Try again
                    </button>
                  </div>
                ) : (
                  <p className="text-[13px] text-text-muted">Loading the message…</p>
                )}
              </div>

              {selected.attachments.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
                    {selected.attachments.length} attachment
                    {selected.attachments.length > 1 ? "s" : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selected.attachments.map((a) => (
                      <span
                        key={a.name}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] text-text-secondary"
                      >
                        <Paperclip size={11} />
                        {a.name}
                        <span className="text-text-muted">{Math.round(a.size / 1024)} KB</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </article>
          )}
        </div>
      </div>

      {editingSignature && (
        <SignatureEditor
          initial={session?.signature ?? ""}
          onSave={saveSignature}
          onClose={() => setEditingSignature(false)}
        />
      )}

      {composing && (
        <ComposeMail
          mailbox={mailbox}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          replyTo={composing.replyTo}
          reference={replyRef}
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
 * Shipment references found in the message, linked to the record.
 *
 * This is the only reason to read mail in the CRM rather than in Outlook: an
 * email about ARX-ENQ-0001 is one click from the shipment it concerns, instead
 * of a copy-paste into a search box.
 */
function ShipmentLinks({ text }: { text: string }) {
  const refs = useMemo(() => {
    const found = text.match(/ARX-[A-Z]{3}-\d{4}/g) ?? [];
    return [...new Set(found)];
  }, [text]);

  if (!refs.length) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-text-muted">Mentions</span>
      {refs.map((ref) => (
        <EnquiryLink
          key={ref}
          to={`/enquiries/${ref}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-accent px-2.5 py-1 text-[12px] font-mono text-text-accent hover:underline"
        >
          <Package size={11} />
          {ref}
        </EnquiryLink>
      ))}
    </div>
  );
}

function fullTime(isoDate: string) {
  return new Date(isoDate).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Microsoft's four squares, drawn rather than fetched. */
function MicrosoftMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 23 23" aria-hidden="true">
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}
