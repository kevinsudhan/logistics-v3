import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import {
  Archive,
  Inbox,
  Mail as MailIcon,
  PenSquare,
  PenLine,
  RefreshCw,
  Forward,
  Reply,
  ReplyAll,
  Search,
  Send,
  FileEdit,
  AlertCircle,
  Check,
  Loader2,
  Package,
  X,
  Maximize2,
  Minimize2,
  Flag,
  Trash2,
  MailOpen,
  ExternalLink,
  Keyboard,
  ShieldAlert,
  Folder,
  FolderOpen,
  ChevronDown,
  Undo2,
  CheckSquare,
  MinusSquare,
  ListFilter,
  Users,
  Repeat2,
  User as UserIcon,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import ComposeMail from "../components/ComposeMail";
import MessageAttachments from "../components/MessageAttachments";
import SignatureEditor from "../components/SignatureEditor";
import PushMailToQueue from "../components/PushMailToQueue";
import FileToEnquiry from "../components/FileToEnquiry";
import MailBody from "../components/MailBody";
import MailListRow from "../components/MailListRow";
import MailConversation from "../components/MailConversation";
import MoveMenu from "../components/MoveMenu";
import SnoozeMenu from "../components/SnoozeMenu";
import RulesDialog from "../components/RulesDialog";
import { bringBack, listReturned, listSnoozes, markSeen, returnDue, snoozeMessages, type Snooze } from "../services/snooze";
import { snoozeLabel } from "../lib/snoozeTimes";
import Highlighted from "../components/Highlighted";
import { searchTerms } from "../lib/searchHighlight";
import { rememberAddresses } from "../services/addressBook";
import { groupIntoThreads } from "../lib/threads";
import {
  colleagues,
  copiers,
  copyNote,
  EVERYTHING,
  forwardSuspects,
  keepRuleForwards,
  keepViewChoice,
  readRuleForwards,
  readViewChoice,
  shownBy,
  type Bucket,
  type Lens,
  type ViewChoice,
} from "../lib/ccFilter";
import { useAuth } from "../lib/auth";
import { outcomeText } from "../lib/outlookConnect";
import type { ComposeMode } from "../lib/mailQuote";
import { clearOutlookNotice, connectOutlook, peekOutlookNotice } from "../services/graphMail";
import {
  getMailFolders,
  getMailMessage,
  getMailMessages,
  getMoreMailMessages,
  getRuleForwarders,
  prefetchMailMessage,
  searchMessages,
  setMailFlag,
  deleteMailMessage,
  searchMoreMessages,
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
import { ListSkeleton, SectionSkeleton } from "../components/Loading";
import { formatDate } from "../lib/dates";

import { peek, put } from "../lib/queryCache";

/** Where a folder's list is kept between opens (lib/queryCache). */
const mailKey = (mailbox: string, folder: string, filter: string) => `mail:${mailbox}:${folder}:${filter}`;

/**
 * While a view is on, older pages are fetched by themselves until it has this
 * many conversations to show, or this many pages have been looked through.
 * Eight pages, every time the page opened in a view, was four hundred messages
 * and their forward checks before anything settled; "Look further back" asks
 * for more.
 */
const VIEW_SCREENFUL = 15;
const VIEW_AUTO_PAGES = 2;

/** The four views (lib/ccFilter): what each is called, and what it holds. */
const VIEW_LABEL: Record<Bucket, string> = { mine: "My emails", primary: "Primary", cc: "CC'd", forwarded: "Auto-forwarded" };
const VIEW_TITLE: Record<Bucket, string> = {
  mine: "Mail written to you from outside the company: your address on the To line, not CC'd to you",
  primary: "Mail written to you from within the company: a colleague's, your address on the To line, not forwarded to you by a rule",
  cc: "Mail you were CC'd on: your address on the Cc line",
  forwarded: "Mail you were sent without being named on it: forwarded or copied to you by a rule from a colleague's mailbox, or a Bcc",
};
const FOLDER_ICON: Record<string, React.ElementType> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileEdit,
  archive: Archive,
  junk: ShieldAlert,
  deleted: Trash2,
};
const iconFor = (id: FolderId): React.ElementType => FOLDER_ICON[id] ?? Folder;
/** The four tabs; everything else (Junk, Deleted Items, the person's own) is under More. */
const MAIN_FOLDERS: FolderId[] = ["inbox", "sent", "drafts", "archive"];

/** Runs `fn` over `items` a few at a time: fifty moves at once is how Outlook starts saying 429. */
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

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
  const { session, saveSignature } = useAuth();
  const mailbox = session?.email ?? "";

  const [folders, setFolders] = useState<MailFolder[]>(() => peek<MailFolder[]>(`mail:${mailbox}:folders`) ?? []);
  const [folder, setFolder] = useState<FolderId>("inbox");
  const [messages, setMessages] = useState<MailMessage[]>(() => peek<MailMessage[]>(mailKey(mailbox, "inbox", "all")) ?? []);
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
  /** The reading pane, so a message opened from deep in a long thread starts at its top. */
  const reader = useRef<HTMLDivElement>(null);
  /** The part of the reading pane that scrolls on a wide screen. */
  const readerScroll = useRef<HTMLDivElement>(null);
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
  /**
   * What is typed in the search box, and what is searched for.
   *
   * Every keystroke used to be a search against Outlook: "chennai" was seven
   * requests, and whichever came back last won — often "chen", so the list
   * showed results for a word nobody finished typing. The search now waits
   * for a pause in typing, and an answer that is no longer the latest request
   * is dropped (`loadReq`).
   */
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);
  /**
   * Where a search looks: every folder, as Outlook searches by default — a
   * reference is in the customer's mail in the Inbox and in our answers in
   * Sent — or only the folder on screen.
   */
  const [scope, setScope] = useState<"all" | "folder">("all");
  /** Outlook's Filter: everything, unread only, or flagged only. */
  const [filter, setFilter] = useState<"all" | "unread" | "flagged">("all");
  /**
   * The mail in four — My emails (from outside, to you), Primary (from a
   * colleague, to you), CC'd, and the admin's Auto-forwarded — and in the last
   * two, whose (lib/ccFilter). aashish@ is sent all of parasuraman@'s and
   * info@'s mail by Exchange rules; this is how his own is found in it. Kept
   * per mailbox in this browser, so it opens the way it was left.
   */
  const [view, setViewState] = useState<ViewChoice>(() => readViewChoice(mailbox));
  const setView = (c: ViewChoice) => {
    setViewState(c);
    keepViewChoice(mailbox, c);
  };
  useEffect(() => setViewState(readViewChoice(mailbox)), [mailbox]);
  /** Only the admin is sent other people's mail by rule: the Auto-forwarded view, and the asking behind it, are his. */
  const isAdmin = session?.role === "admin";
  /**
   * Which messages an inbox rule forwarded here, by id (lib/ccFilter): the
   * answers kept in this browser, the ones being asked for, and the ones
   * asked for that did not come back — mail written to him for this visit.
   */
  const [ruleForwards, setRuleForwards] = useState<Map<string, string | null>>(() => readRuleForwards(mailbox));
  const [checking, setChecking] = useState<ReadonlySet<string>>(() => new Set());
  const unanswered = useRef(new Set<string>());
  useEffect(() => setRuleForwards(readRuleForwards(mailbox)), [mailbox]);
  const mailboxNow = useRef(mailbox);
  mailboxNow.current = mailbox;
  /** A line at the foot of the screen saying what just happened (deleted, draft saved). */
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);
  const [showKeys, setShowKeys] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  /** What is snoozed in this mailbox and not back yet, by the id it has in the Snoozed folder. */
  const [snoozes, setSnoozes] = useState<Snooze[]>([]);
  const snoozeOf = useMemo(() => new Map(snoozes.map((x) => [x.message_id, x])), [snoozes]);
  /** Back from snooze and not opened since: pinned to the top of the Inbox. */
  const [returned, setReturned] = useState<Snooze[]>([]);
  const returnedOf = useMemo(() => new Map(returned.map((x) => [x.message_id, x])), [returned]);
  /**
   * Rows ticked for a bulk action — conversations, or messages when searching —
   * and the last one ticked, for Shift-click ranges.
   */
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const lastChecked = useRef<string | null>(null);
  /** Whether older pages have been loaded, which a background refresh would throw away. */
  const morePages = useRef(false);
  /** Older pages fetched by themselves for the view on screen, since the list was last read from the top. */
  const autoPages = useRef(0);
  /** When the list was last fetched, so a refresh on returning to the tab is not one per click. */
  const lastLoad = useRef(0);
  const searching = Boolean(query);
  const terms = useMemo(() => searchTerms(query), [query]);
  /** Which folder load is the current one; an older answer arriving late is dropped. */
  const loadReq = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState<null | { replyTo?: MailMessage; mode?: ComposeMode; draft?: MailMessage }>(null);
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
  /** Bumped after a send, so the open conversation fetches the reply just sent. */
  const [sentTick, setSentTick] = useState(0);
  /**
   * How many messages each conversation holds, once one has been opened.
   *
   * The list only knows the messages in this folder — a customer's two mails in
   * Inbox, not our three replies in Sent — so the count on a row grows to the
   * real one when the conversation is read.
   */
  const [sizes, setSizes] = useState<Map<string, number>>(new Map());
  const noteSize = useCallback(
    (conversationId: string, n: number) =>
      setSizes((prev) => (prev.get(conversationId) === n ? prev : new Map(prev).set(conversationId, n))),
    []
  );
  const live = mailIsLive();

  /*
    "Read at full width": the list folds away while a message is open, for a
    small laptop or a wide mail. Remembered in this browser.
  */
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem("araxys:mail-wide") === "1";
    } catch {
      return false;
    }
  });
  const toggleWide = useCallback(() => {
    setWide((w) => {
      try {
        localStorage.setItem("araxys:mail-wide", w ? "0" : "1");
      } catch {
        /* for this visit only */
      }
      return !w;
    });
  }, []);

  /**
   * Connecting Outlook (095): how the last attempt went, shown once, and the
   * button's own state while the browser is on its way to Microsoft.
   */
  const [notice, setNotice] = useState(() => peekOutlookNotice());
  useEffect(() => {
    if (notice) clearOutlookNotice();
  }, [notice]);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const connect = () => {
    setConnecting(true);
    setConnectError(null);
    setNotice(null);
    connectOutlook("/mail").catch((e: unknown) => {
      setConnectError(e instanceof Error ? e.message : "Could not start connecting Outlook.");
      setConnecting(false);
    });
  };

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
    const req = ++loadReq.current;
    lastLoad.current = Date.now();
    setLoading(true);
    setError(null);
    try {
      // Snoozed mail whose time has come goes back to the Inbox (services/snooze.ts).
      // Alongside the list rather than before it (6 Oct): it is almost always
      // nothing, and when something did come back the list is read again.
      void returnDue(mailbox)
        .catch(() => 0)
        .then((back) => {
          if (!back || req !== loadReq.current) return;
          setToast(back === 1 ? "A snoozed message is back in the Inbox." : `${back} snoozed messages are back in the Inbox.`);
          if (folder === "inbox" && !query) void load();
        });
      void listSnoozes(mailbox)
        .then((sn) => req === loadReq.current && setSnoozes(sn))
        .catch(() => {});
      void listReturned(mailbox)
        .then((rt) => req === loadReq.current && setReturned(rt))
        .catch(() => {});
      const [f, m] = await Promise.all([
        getMailFolders(mailbox),
        query
          ? searchMessages(mailbox, query, scope === "all" ? null : folder)
          : getMailMessages(mailbox, folder, undefined, filter === "all" ? undefined : filter),
      ]);
      if (req !== loadReq.current) return;
      setFolders(f.folders);
      setMessages(m.messages);
      setNextLink(m.nextLink);
      // The folder as it is now, for the next time it is opened (lib/queryCache);
      // on screen at once, the list is no longer waiting on the lookup below.
      if (!query) put(mailKey(mailbox, folder, filter), m.messages);
      put(`mail:${mailbox}:folders`, f.folders);
      setLoading(false);
      morePages.current = false;
      autoPages.current = 0;
      // Everyone on screen is someone the compose window can suggest.
      rememberAddresses(
        m.messages.flatMap((x) => [x.from?.emailAddress, ...x.toRecipients.map((r) => r.emailAddress), ...x.ccRecipients.map((r) => r.emailAddress)])
          .filter((a) => a?.address && a.address.toLowerCase() !== mailbox.toLowerCase())
      );
      // One lookup for the whole folder, so each row can say whether it has
      // already been queued instead of offering a push that does nothing.
      const q = await intakeByMessage(m.messages.map((x) => x.id));
      if (req === loadReq.current) setQueued(q);
    } catch (e) {
      if (req !== loadReq.current) return;
      setError(
        e instanceof GraphAuthError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not load the mailbox."
      );
    } finally {
      if (req === loadReq.current) setLoading(false);
    }
  }, [mailbox, folder, query, scope, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    New mail arrives by itself, as it does in Outlook: the list is fetched again
    every minute while the page is in view, and on coming back to the tab. It
    used to change only when somebody pressed Refresh, so a customer's reply
    could sit unseen above a list that looked current. Not while searching.
    Once older pages are loaded — by hand, or by a view looking further back —
    the newest page is merged in on top rather than the list going back to its
    first page under the reader (13 Oct).
  */
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || query) return;
      if (Date.now() - lastLoad.current < 20_000) return;
      if (morePages.current) void refreshTop();
      else void load();
    };
    const every = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(every);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, query]);

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
   * The newest page again, merged over the list: new mail on top, what changed
   * in it (read, flagged) updated, the older pages below kept as they are.
   */
  async function refreshTop() {
    const req = loadReq.current;
    lastLoad.current = Date.now();
    try {
      const m = await getMailMessages(mailbox, folder, undefined, filter === "all" ? undefined : filter);
      if (req !== loadReq.current) return;
      const fresh = new Set(m.messages.map((x) => x.id));
      setMessages((prev) => [...m.messages, ...prev.filter((x) => !fresh.has(x.id))]);
      const q = await intakeByMessage(m.messages.map((x) => x.id));
      if (req === loadReq.current) setQueued((prev) => new Map([...prev, ...q]));
    } catch {
      // A missed refresh is the next minute's.
    }
  }

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
    morePages.current = true;
    // A page for the folder or search that was on screen when it was asked for.
    const req = loadReq.current;
    try {
      const more = query
        ? await searchMoreMessages(mailbox, query, scope === "all" ? null : folder, nextLink)
        : await getMoreMailMessages(mailbox, folder, nextLink);
      if (req !== loadReq.current) return;
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
    // The old folder's rows go at once. They used to stay until the new folder
    // arrived, drawn as the new folder's (Sent showed the Inbox with every
    // sender replaced by "Parasu"), and a click on one opened the wrong mail.
    // The new folder's own rows as last read show instead, until it is read again (6 Oct).
    setMessages(peek<MailMessage[]>(mailKey(mailbox, folder, filter)) ?? []);
    setNextLink(undefined);
    setChecked(new Set());
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

  /**
   * The folder as conversations, the way Outlook lists it: one row each, drawn
   * from its newest message here, most recent first. A reply and the mail it
   * answers were two rows that nothing tied together.
   */
  const conversations = useMemo(() => groupIntoThreads(messages), [messages]);
  /** The To-me and CC views mean something only for mail received; not for Sent and Drafts. */
  const ccApplies = folder !== "sent" && folder !== "drafts";
  const ccActive = !searching && ccApplies && view.view !== "all";
  // The staff's addresses: mail from one of them is from within the company, whatever their domain.
  const staff = useMemo(() => new Set(people.map((p) => p.email.trim().toLowerCase()).filter(Boolean)), [people]);
  const lens = useMemo<Lens>(() => ({ mailbox, forwards: ruleForwards, checking, people: staff }), [mailbox, ruleForwards, checking, staff]);
  /** The rows as drawn: a message each when searching, a conversation each otherwise. */
  const rows = useMemo(() => {
    if (searching) return messages.map((m) => ({ key: m.id, m, group: [m] }));
    /*
      In a view, a conversation is shown by the newest of its messages the view
      is for, and placed by it: a customer's mail to you is in My emails as the
      customer's, not under info@'s reply at the top of the thread.
    */
    const all = conversations
      .map((t) => ({
        key: t.conversationId,
        m: ccActive ? shownBy(t.messages, lens, view) : t.messages[t.messages.length - 1],
        group: t.messages,
      }))
      .filter((r): r is { key: string; m: MailMessage; group: MailMessage[] } => Boolean(r.m));
    if (ccActive) all.sort((a, b) => b.m.receivedDateTime.localeCompare(a.m.receivedDateTime));
    if (folder !== "inbox" || !returnedOf.size) return all;
    // Back from snooze, on top: Outlook keeps a moved message's received date,
    // so it would otherwise sit wherever that date puts it.
    const back = (r: (typeof all)[number]) => r.group.some((m) => returnedOf.has(m.id));
    return [...all.filter(back), ...all.filter((r) => !back(r))];
  }, [searching, messages, conversations, folder, returnedOf, ccActive, view, lens]);
  /** In CC'd, who copied the mailbox; in Auto-forwarded, whose mail it is: the picker's choices, from the mail loaded. */
  const picking = view.view === "cc" || view.view === "forwarded" ? view.view : null;
  const copies = useMemo(() => (picking ? copiers(messages, lens, picking) : []), [messages, lens, picking]);
  /** ALG's own people only — the staff and our addresses in the mail — with how much of the view is theirs. */
  const pickable = useMemo(() => (picking ? colleagues(copies, people, mailbox) : []), [picking, copies, people, mailbox]);
  const chosen = view.person ? pickable.find((p) => p.address === view.person) : undefined;
  /** How far back the list reaches: what a view has been looked for in. */
  const oldestLoaded = useMemo(
    () => messages.reduce<string | null>((o, m) => (!o || m.receivedDateTime < o ? m.receivedDateTime : o), null),
    [messages]
  );

  /*
    The messages that could be a rule's forward are asked about as they load,
    a hundred at a time at most (lib/ccFilter, HOW A FORWARD IS TOLD). While
    they are, they are in no view but everything; one whose answer does not
    come back stays mail written to him rather than being hidden.
  */
  useEffect(() => {
    if (!mailbox || !isAdmin || !ccApplies) return;
    const ask = forwardSuspects(messages, lens).filter((m) => !unanswered.current.has(m.id)).slice(0, 100);
    if (!ask.length) return;
    const ids = ask.map((m) => m.id);
    const box = mailbox;
    setChecking((prev) => new Set([...prev, ...ids]));
    void getRuleForwarders(ask)
      .catch(() => new Map<string, string | null>())
      .then((found) => {
        if (mailboxNow.current !== box) return;
        ids.forEach((id) => !found.has(id) && unanswered.current.add(id));
        if (!found.size) return;
        setRuleForwards((prev) => {
          const next = new Map(prev);
          found.forEach((by, id) => next.set(id, by));
          keepRuleForwards(box, next);
          return next;
        });
      })
      .finally(() =>
        setChecking((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        })
      );
  }, [messages, lens, mailbox, isAdmin, ccApplies]);

  /*
    A view is read off the mail loaded — Outlook cannot list by recipient — and
    a page of a cluttered Inbox may hold two conversations it wants. So while
    one is on, older pages are fetched by themselves until there is a
    screenful, or two more pages have been looked through; past that,
    "Look further back" asks for more.
  */
  useEffect(() => {
    autoPages.current = 0;
  }, [folder, filter, view, mailbox]);
  useEffect(() => {
    if (!ccActive || loading || loadingMore || !nextLink) return;
    if (rows.length >= VIEW_SCREENFUL || autoPages.current >= VIEW_AUTO_PAGES) return;
    autoPages.current++;
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ccActive, loading, loadingMore, nextLink, rows.length]);
  // A selection only ever names rows that are on screen.
  useEffect(() => {
    setChecked((prev) => {
      if (!prev.size) return prev;
      const keys = new Set(rows.map((r) => r.key));
      const next = new Set([...prev].filter((k) => keys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);
  const checkedMessages = useMemo(() => rows.filter((r) => checked.has(r.key)).flatMap((r) => r.group), [rows, checked]);

  /** A folder is a place to read: choosing one ends a search and a filter, as in Outlook. */
  function goToFolder(id: FolderId) {
    setSearch("");
    setQuery("");
    setFilter("all");
    setMoreOpen(false);
    setFolder(id);
  }

  /** Ticks a row; with Shift, everything between it and the last one ticked. */
  function toggleCheck(key: string, shift: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      const on = !prev.has(key);
      if (shift && lastChecked.current) {
        const a = rows.findIndex((r) => r.key === lastChecked.current);
        const b = rows.findIndex((r) => r.key === key);
        if (a >= 0 && b >= 0) {
          for (const r of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) on ? next.add(r.key) : next.delete(r.key);
          return next;
        }
      }
      on ? next.add(key) : next.delete(key);
      return next;
    });
    lastChecked.current = key;
  }

  /** Read or unread, flag or unflag, for everything ticked. */
  async function bulkSet(change: { isRead?: boolean; flagged?: boolean }) {
    const targets = checkedMessages.filter((m) =>
      change.isRead !== undefined ? m.isRead !== change.isRead : m.flagged !== change.flagged
    );
    if (!targets.length) return;
    const ids = new Set(targets.map((m) => m.id));
    setMessages((prev) => prev.map((x) => (ids.has(x.id) ? { ...x, ...change } : x)));
    try {
      await inBatches(targets, 6, (m) =>
        change.isRead !== undefined ? setMailRead(mailbox, m.id, change.isRead) : setMailFlag(mailbox, m.id, !!change.flagged)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change all of them.");
    } finally {
      void load();
    }
  }
  const selected = useMemo(
    () =>
      full && full.id === selectedId
        ? // Read and flagged as the list has them: it changes the moment they are pressed,
          // and a body opened earlier (kept, services/graphMail) has them as they were then.
          { ...row, ...full, ...(row ? { isRead: row.isRead, flagged: row.flagged } : {}) }
        : row,
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
    (id: string, from?: FolderId) => {
      const req = ++openReq.current;
      setFull(null);
      setBodyError(null);
      void getMailMessage(mailbox, id, from ?? folder)
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

  /**
   * Opens a message — from the list, the conversation's newest here — and marks
   * the conversation's unread ones in this folder read, as Outlook does when a
   * conversation is selected.
   */
  async function open(m: MailMessage, conversation: MailMessage[] = [m]) {
    setSelectedId(m.id);
    const seenNow = conversation.map((x) => returnedOf.get(x.id)?.id).filter((x): x is string => !!x);
    if (seenNow.length) {
      setReturned((prev) => prev.filter((r) => !seenNow.includes(r.id)));
      void markSeen(seenNow).catch(() => {});
    }

    // The next message opened starts at its own top, not part-way down where
    // the last one was left: the pane's own scroll on a wide screen, the
    // page's on a phone.
    readerScroll.current?.scrollTo({ top: 0 });
    if (window.matchMedia("(max-width: 1023px)").matches) {
      // One column: the message is drawn under the whole list, off the bottom
      // of a phone's screen, and tapping a row appeared to do nothing.
      window.setTimeout(() => reader.current?.scrollIntoView({ block: "start" }), 0);
    } else {
      const top = reader.current?.getBoundingClientRect().top;
      if (top !== undefined && top < 0) window.scrollBy({ top: top - 72 });
    }

    // The body has to be fetched; the row does not have one.
    loadBody(m.id, m.folder);

    const unread = conversation.filter((x) => !x.isRead);
    if (unread.length) {
      // Optimistic: the row should stop looking unread the instant it is clicked.
      const ids = new Set(unread.map((x) => x.id));
      setMessages((prev) => prev.map((x) => (ids.has(x.id) ? { ...x, isRead: true } : x)));
      setFolders((prev) => prev.map((f) => (f.id === m.folder ? { ...f, unread: Math.max(0, f.unread - unread.length) } : f)));
      try {
        await Promise.all(unread.map((x) => setMailRead(mailbox, x.id, true)));
      } catch {
        void load();
      }
    }
  }

  /**
   * Archives the conversation's messages in this folder, not only the one open:
   * the list shows the conversation as one row, and archiving one message of
   * three left the row standing on the next one, as if nothing had happened.
   */
  async function archive(m: MailMessage) {
    await moveTo(m, "archive", "Archive");
  }

  /**
   * Moves the conversation's messages in this folder (or the one result, when
   * searching — its conversation's other results may be in Sent or elsewhere)
   * to another folder: Archive, Junk, the Inbox, or one of the person's own.
   */
  async function moveTo(m: MailMessage, to: FolderId, label: string) {
    const going = m.conversationId && !searching ? messages.filter((x) => x.conversationId === m.conversationId) : [];
    if (!going.some((x) => x.id === m.id)) going.push(m);
    await moveMany(going, to, label);
  }

  /** Snoozes the conversation's messages here (or the one result, when searching). */
  async function snooze(m: MailMessage, until: Date) {
    const going = m.conversationId && !searching ? messages.filter((x) => x.conversationId === m.conversationId) : [];
    if (!going.some((x) => x.id === m.id)) going.push(m);
    await snoozeMany(going, until);
  }

  async function snoozeMany(going: MailMessage[], until: Date) {
    const ids = new Set(going.map((x) => x.id));
    setMessages((prev) => prev.filter((x) => !ids.has(x.id)));
    setChecked(new Set());
    if (selectedId && ids.has(selectedId)) {
      setSelectedId(null);
      setFull(null);
    }
    try {
      await snoozeMessages(mailbox, going, until);
      setToast(`Snoozed until ${snoozeLabel(until)}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not snooze that.");
    } finally {
      void load();
    }
  }

  /** A snoozed message back to the Inbox now. */
  async function unsnooze(sn: Snooze) {
    setSelectedId(null);
    setFull(null);
    try {
      await bringBack(sn);
      setToast("Back in the Inbox.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not bring that back.");
    } finally {
      void load();
    }
  }

  async function moveMany(going: MailMessage[], to: FolderId, label: string) {
    const ids = new Set(going.map((x) => x.id));
    setMessages((prev) => prev.filter((x) => !ids.has(x.id)));
    if (selectedId && ids.has(selectedId)) {
      setSelectedId(null);
      setFull(null);
    }
    try {
      await inBatches(going, 6, (x) => moveMailMessage(mailbox, x.id, to));
      setToast(going.length > 1 ? `${going.length} messages moved to ${label}.` : `Moved to ${label}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move that.");
    } finally {
      void load();
    }
  }

  /**
   * Delete, as Outlook's: to Deleted Items, where it can be got back — the
   * conversation's messages in this folder, as Archive does, or the one result
   * when searching.
   */
  async function remove(m: MailMessage) {
    const going = m.conversationId && !searching ? messages.filter((x) => x.conversationId === m.conversationId) : [];
    if (!going.some((x) => x.id === m.id)) going.push(m);
    await removeMany(going);
  }

  async function removeMany(going: MailMessage[]) {
    const ids = new Set(going.map((x) => x.id));
    setMessages((prev) => prev.filter((x) => !ids.has(x.id)));
    if (selectedId && ids.has(selectedId)) {
      setSelectedId(null);
      setFull(null);
    }
    try {
      await inBatches(going, 6, (x) => deleteMailMessage(mailbox, x.id));
      setToast(going.length > 1 ? `${going.length} messages moved to Deleted Items.` : "Moved to Deleted Items.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that.");
    } finally {
      void load();
    }
  }

  /** Flag for follow-up, or take the flag off. Shown at once; put back if Outlook says no. */
  async function toggleFlag(m: MailMessage) {
    const flagged = !m.flagged;
    const set = (v: boolean) => {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, flagged: v } : x)));
      setFull((prev) => (prev && prev.id === m.id ? { ...prev, flagged: v } : prev));
    };
    set(flagged);
    try {
      await setMailFlag(mailbox, m.id, flagged);
      if (!flagged && filter === "flagged") void load();
    } catch (e) {
      set(!flagged);
      setError(e instanceof Error ? e.message : "Could not change the flag.");
    }
  }

  /** Mark unread (or read again): the row goes bold and the Inbox count goes up. */
  async function toggleRead(m: MailMessage) {
    const isRead = !m.isRead;
    const set = (v: boolean) => {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, isRead: v } : x)));
      setFull((prev) => (prev && prev.id === m.id ? { ...prev, isRead: v } : prev));
      setFolders((prev) => prev.map((f) => (f.id === m.folder ? { ...f, unread: Math.max(0, f.unread + (v ? -1 : 1)) } : f)));
    };
    set(isRead);
    try {
      await setMailRead(mailbox, m.id, isRead);
    } catch (e) {
      set(!isRead);
      setError(e instanceof Error ? e.message : "Could not change that.");
    }
  }

  /*
    Opening a search result shows the first match, as Outlook scrolls to it: a
    reference in the fourth paragraph, or in a quoted reply, is otherwise below
    the fold. Desk width only — on a phone the message is brought into view as
    a whole (open) and the page is the thing that scrolls.
  */
  const landed = full && full.id === selectedId ? full.id : null;
  useEffect(() => {
    if (!landed || !query || !window.matchMedia("(min-width: 1024px)").matches) return;
    const t = window.setTimeout(() => {
      const hit = readerScroll.current?.querySelector(".mail-body mark.search-hit, .mail-body-text mark.search-hit");
      if (hit) hit.scrollIntoView({ block: "center" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [landed, query]);

  /*
    Keyboard shortcuts, for a desk that reads mail all day: the arrows (or j/k)
    move through the list, R / A / F answer, E archives, Delete deletes, U marks
    unread, N writes a new one, / goes to the search. Never while typing, and
    never with a window open over the page.
  */
  const isDraft = Boolean(selected && (selected.isDraft || selected.folder === "drafts"));
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="listbox"]')) return;
    if (composing || editingSignature || rulesOpen) return;
    const at = rows.findIndex((r) => r.group.some((x) => x.id === selectedId));
    const key = e.key;
    const go = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (r) void open(r.m, r.group);
    };
    if (key === "ArrowDown" || key === "j") {
      e.preventDefault();
      go(at + 1);
    } else if (key === "ArrowUp" || key === "k") {
      e.preventDefault();
      go(at < 0 ? 0 : at - 1);
    } else if (key === "n") {
      e.preventDefault();
      setComposing({});
    } else if (key === "/") {
      e.preventDefault();
      document.querySelector<HTMLInputElement>('input[aria-label="Search mail"]')?.focus();
    } else if (selected && !isDraft && (key === "r" || key === "a" || key === "f")) {
      e.preventDefault();
      setComposing({ replyTo: selected, mode: key === "r" ? "reply" : key === "a" ? "replyAll" : "forward" });
    } else if (selected && key === "e" && selected.folder !== "archive" && !isDraft) {
      e.preventDefault();
      void archive(selected);
    } else if (selected && (key === "Delete" || key === "#") && selected.folder !== "deleted") {
      e.preventDefault();
      void remove(selected);
    } else if (key === "x" && at >= 0) {
      e.preventDefault();
      toggleCheck(rows[at].key, false);
    } else if (key === "Escape" && checked.size) {
      setChecked(new Set());
    } else if (selected && key === "u") {
      e.preventDefault();
      void toggleRead(selected);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!mailbox) return null;

  // Reading at full width only applies while a message is open; the list comes back without one.
  const wideOpen = wide && Boolean(selected);
  const roomy = wideOpen;

  return (
    /*
      On a wide screen the page is exactly the window's height and does not
      scroll: the list and the message each scroll inside their own pane, the
      way Outlook does. It used to be a normal page with the list and the Reply
      bar pinned by `sticky`, which only takes hold once the page has scrolled
      past the header — so both rode up with the page first, and it read as the
      whole screen moving. The height is the window less the top bar (56) and
      main's padding (32 below xl, 48 from it). Below `lg` it is one column and
      scrolls as a page.

      Its floor is 360px, not the 560 it was: on a 768-px laptop the browser
      shows about 650 px (525 at 125% scaling, 470 on a 720-px one), and a floor
      taller than the window made the whole page scroll and cut the message off
      at the bottom.
    */
    <div className="lg:flex lg:h-[calc(100dvh-88px)] lg:min-h-[360px] lg:flex-col xl:h-[calc(100dvh-104px)]">
      <div className="lg:shrink-0">
      <PageHeader
        dense
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
      {notice &&
        (() => {
          const said = outcomeText(notice, mailbox);
          const tone =
            said.tone === "success"
              ? "bg-bg-success text-text-success"
              : said.tone === "warning"
                ? "bg-bg-warning text-text-warning"
                : "bg-bg-danger text-text-danger";
          return (
            <div role="status" className={`mb-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[12px] ${tone}`}>
              {said.tone === "success" ? <Check size={13} className="mt-px shrink-0" /> : <AlertCircle size={13} className="mt-px shrink-0" />}
              <span className="flex-1">{said.text}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
                <X size={13} />
              </button>
            </div>
          );
        })()}

      {/*
        Connecting adds the login's own mailbox to the session already open —
        it does not sign in again, and a Microsoft account other than this
        login's is refused on the server (095).
      */}
      {!live && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <div className="flex-1">
            <p>
              <strong className="font-medium">Outlook is not connected.</strong> These are sample
              messages, not your mailbox, and nothing can be sent until you connect it. Sign in to
              Microsoft as {mailbox}; another account will not be accepted.
            </p>
            <button
              onClick={connect}
              disabled={connecting}
              className="mt-2 inline-flex items-center gap-2 h-7 px-2.5 rounded-lg border border-border-strong bg-surface-1 text-[12px] font-medium text-text-primary hover:bg-surface-2 disabled:opacity-60"
            >
              {connecting ? <Loader2 size={13} className="animate-spin" /> : <MicrosoftMark />}
              Connect Outlook for {mailbox}
            </button>
            {connectError && <p className="mt-2 text-text-danger">{connectError}</p>}
          </div>
        </div>
      )}

      {/*
        One row: compose, the folders, search, and the two quieter buttons.
        ------------------------------------------------------------------
        The folders ran across a card of their own under this row. As a column
        they had cost 168px of width; as a row of their own they still cost a
        row of height — and on a 768-px laptop every row above the message is a
        line of the message not shown. So they sit in the toolbar, and Refresh
        and Signature keep their words only where there is room (xl).
      */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setComposing({})}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium"
        >
          <PenSquare size={13} />
          New message
        </button>

        <nav aria-label="Folders" className="flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-border bg-surface-1 p-0.5">
          {folders.filter((f) => MAIN_FOLDERS.includes(f.id)).map((f) => {
            const Icon = iconFor(f.id);
            const active = f.id === folder;
            return (
              <button
                key={f.id}
                onClick={() => goToFolder(f.id)}
                aria-current={active ? "page" : undefined}
                className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors ${
                  active ? "bg-surface-2 font-medium text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                }`}
              >
                <Icon size={13} />
                {f.label}
                {f.unread > 0 && (
                  <span className="flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-medium text-white">
                    {f.unread}
                  </span>
                )}
              </button>
            );
          })}

          {/*
            Everything else in the mailbox — Junk, Deleted Items and the
            person's own folders (a folder per customer under Inbox, and so on) —
            as Outlook's folder pane lists them. The button names the folder
            when one of them is open.
          */}
          {(() => {
            const others = folders.filter((f) => !MAIN_FOLDERS.includes(f.id));
            const here = others.find((f) => f.id === folder);
            const unread = others.filter((f) => f.id !== "deleted").reduce((n, f) => n + f.unread, 0);
            const HereIcon = here ? iconFor(here.id) : FolderOpen;
            return (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMoreOpen((o) => !o)}
                  aria-expanded={moreOpen}
                  aria-current={here ? "page" : undefined}
                  className={`flex h-7 max-w-[180px] items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors ${
                    here ? "bg-surface-2 font-medium text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                  }`}
                >
                  <HereIcon size={13} className="shrink-0" />
                  <span className="truncate">{here ? here.label : "More"}</span>
                  {!here && unread > 0 && (
                    <span className="flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-surface-3 px-1 text-[10px] font-medium text-text-secondary">
                      {unread}
                    </span>
                  )}
                  <ChevronDown size={11} className="shrink-0" />
                </button>
                {moreOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setMoreOpen(false)} />
                    <div className="absolute left-0 top-9 z-30 max-h-96 w-64 overflow-y-auto rounded-xl border border-border bg-surface-1 p-1 shadow-lg">
                      {others.length === 0 && <p className="px-2.5 py-2 text-[12px] text-text-muted">No other folders.</p>}
                      {others.map((f, i) => {
                        const Icon = iconFor(f.id);
                        const firstOwn = f.id.startsWith("id:") && (i === 0 || !others[i - 1].id.startsWith("id:"));
                        return (
                          <div key={f.id}>
                            {firstOwn && <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-text-muted">Your folders</p>}
                            <button
                              type="button"
                              onClick={() => goToFolder(f.id)}
                              style={{ paddingLeft: 10 + (f.depth ?? 0) * 14 }}
                              className={`flex w-full items-center gap-2 rounded-lg py-1.5 pr-2.5 text-left text-[13px] hover:bg-surface-2 ${
                                f.id === folder ? "bg-surface-2 font-medium text-text-primary" : "text-text-primary"
                              }`}
                            >
                              <Icon size={13} className="shrink-0 text-text-muted" />
                              <span className="min-w-0 flex-1 truncate">
                                {f.label}
                                {/* A folder inside the Inbox sits under a tab, not under the item above it. */}
                                {f.parent && MAIN_FOLDERS.some((m) => folders.find((x) => x.id === m)?.label === f.parent) && (
                                  <span className="text-text-muted"> · in {f.parent}</span>
                                )}
                              </span>
                              {f.unread > 0 && <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{f.unread}</span>}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </nav>

        <div className="relative min-w-[160px] flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Enter searches now rather than after the pause; Escape clears.
              if (e.key === "Enter") setQuery(search.trim());
              if (e.key === "Escape") {
                setSearch("");
                setQuery("");
              }
            }}
            placeholder="Search mail — a reference, a name, a word…"
            aria-label="Search mail"
            className="w-full pl-8 pr-8 h-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setQuery("");
              }}
              aria-label="Clear the search"
              title="Clear the search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text-primary"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <button
          onClick={() => void load()}
          title="Refresh"
          aria-label="Refresh"
          className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary xl:px-3"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          <span className="hidden xl:inline">Refresh</span>
        </button>

        <button
          type="button"
          onClick={() => setRulesOpen(true)}
          title="Rules — file incoming mail automatically"
          aria-label="Rules"
          className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary xl:px-3"
        >
          <ListFilter size={13} />
          <span className="hidden xl:inline">Rules</span>
        </button>

        <div className="relative hidden lg:block">
          <button
            type="button"
            onClick={() => setShowKeys((v) => !v)}
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            aria-expanded={showKeys}
            className="flex items-center h-8 px-2.5 rounded-lg border border-border bg-surface-1 text-text-secondary hover:text-text-primary"
          >
            <Keyboard size={14} />
          </button>
          {showKeys && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowKeys(false)} />
              <div className="absolute right-0 top-9 z-30 w-60 rounded-xl border border-border bg-surface-1 p-3 text-[12px] shadow-lg">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">Keyboard shortcuts</p>
                {[
                  ["↑ ↓  or  j k", "Previous / next"],
                  ["R", "Reply"],
                  ["A", "Reply all"],
                  ["F", "Forward"],
                  ["E", "Archive"],
                  ["Delete", "Delete"],
                  ["U", "Mark unread / read"],
                  ["X", "Tick for a bulk action"],
                  ["N", "New message"],
                  ["/", "Search"],
                ].map(([k, what]) => (
                  <div key={k} className="flex items-center justify-between py-0.5">
                    <span className="text-text-secondary">{what}</span>
                    <kbd className="rounded border border-border bg-surface-2 px-1.5 font-mono text-[11px] text-text-primary">{k}</kbd>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => setEditingSignature(true)}
          title="Signature"
          aria-label="Signature"
          className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary xl:px-3"
        >
          <PenLine size={13} />
          <span className="hidden xl:inline">Signature</span>
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      </div>

      {/* Two panes now, not three. The list keeps a readable column — a third
          of the width, between 240 and 360px, so a small laptop's message is
          not left with what a fixed 360 did not take — and the message takes
          the rest. "Wider" hides the list while a message is open. On a wide
          screen they fill what is left of the window and scroll separately. */}
      <div
        className={`grid grid-cols-1 items-start gap-3 lg:min-h-0 lg:flex-1 lg:items-stretch ${
          wideOpen ? "lg:grid-cols-[minmax(0,1fr)]" : "lg:grid-cols-[minmax(240px,min(360px,32%))_minmax(0,1fr)]"
        }`}
      >
        {/* ---- message list ---- */}
        <div className={`card flex flex-col overflow-hidden lg:min-h-0 ${wideOpen ? "lg:hidden" : ""}`}>
          {/*
            What a search found and where it looked, above the results — Outlook's
            "Results" header, with the choice of every folder or this one.
          */}
          {searching && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-3 py-2">
              <p className="min-w-0 text-[12px] text-text-secondary">
                {loading && messages.length === 0 ? (
                  "Searching…"
                ) : (
                  <>
                    <span className="font-medium text-text-primary">
                      {messages.length}
                      {nextLink ? "+" : ""} result{messages.length === 1 ? "" : "s"}
                    </span>{" "}
                    for <mark className="search-hit">{query}</mark>
                  </>
                )}
              </p>
              <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-1 p-0.5 text-[11.5px]" role="group" aria-label="Where to search">
                {(["all", "folder"] as const).map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => setScope(sc)}
                    aria-pressed={scope === sc}
                    className={`h-6 rounded-md px-2 transition-colors ${
                      scope === sc ? "bg-surface-2 font-medium text-text-primary" : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {sc === "all" ? "All folders" : folders.find((f) => f.id === folder)?.label ?? "This folder"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/*
            With rows ticked, the bar over the list acts on all of them:
            read, unread, flag, archive, move, delete — Outlook's bulk actions.
          */}
          {checked.size > 0 ? (
            <div className="flex flex-wrap items-center gap-1 border-b border-border bg-bg-accent/60 px-2 py-1.5 text-[12px]">
              <button
                type="button"
                onClick={() => setChecked(checked.size === rows.length ? new Set() : new Set(rows.map((r) => r.key)))}
                title={checked.size === rows.length ? "Untick all" : "Tick all"}
                aria-label={checked.size === rows.length ? "Untick all" : "Tick all"}
                className="grid size-7 place-items-center rounded-md text-text-secondary hover:bg-surface-2 hover:text-text-primary"
              >
                {checked.size === rows.length ? <CheckSquare size={15} /> : <MinusSquare size={15} />}
              </button>
              <span className="mr-1 font-medium text-text-primary">{checked.size} selected</span>
              <BulkButton label="Mark read" onClick={() => void bulkSet({ isRead: true })} icon={<MailOpen size={13} />} />
              <BulkButton label="Mark unread" onClick={() => void bulkSet({ isRead: false })} icon={<MailIcon size={13} />} />
              <BulkButton
                label={checkedMessages.every((m) => m.flagged) ? "Clear flag" : "Flag"}
                onClick={() => void bulkSet({ flagged: !checkedMessages.every((m) => m.flagged) })}
                icon={<Flag size={13} />}
              />
              {folder !== "archive" && (
                <BulkButton label="Archive" onClick={() => void moveMany(checkedMessages, "archive", "Archive")} icon={<Archive size={13} />} />
              )}
              <MoveMenu compact folders={folders} current={folder} onMove={(to, label) => void moveMany(checkedMessages, to, label)} />
              {folder !== "deleted" && folder !== "junk" && folder !== "drafts" && <SnoozeMenu compact onPick={(until) => void snoozeMany(checkedMessages, until)} />}
              {folder === "deleted" || folder === "junk" ? (
                <BulkButton label={folder === "junk" ? "Not junk" : "Restore"} onClick={() => void moveMany(checkedMessages, "inbox", "Inbox")} icon={<Undo2 size={13} />} />
              ) : (
                <BulkButton label="Delete" danger onClick={() => void removeMany(checkedMessages)} icon={<Trash2 size={13} />} />
              )}
              <button
                type="button"
                onClick={() => setChecked(new Set())}
                aria-label="Clear the selection"
                title="Clear the selection"
                className="ml-auto grid size-7 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary"
              >
                <X size={14} />
              </button>
            </div>
          ) : !searching && (
            <>
            {/*
              One choice, never two: All is everything, Unread and Flagged
              everything unread or flagged, and a view only its own mail.
              They were two groups, Outlook's filter and the views, and All
              stayed pressed beside My emails, as though both were on.
            */}
            <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5 text-[11.5px]" role="group" aria-label="Show">
              {(["all", "unread", "flagged"] as const).map((f) => {
                const on = filter === f && (!ccApplies || view.view === "all");
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setFilter(f);
                      if (view.view !== "all") setView(EVERYTHING);
                    }}
                    aria-pressed={on}
                    className={`flex h-6 items-center gap-1 rounded-md px-2 transition-colors ${
                      on ? "bg-surface-2 font-medium text-text-primary" : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {f === "flagged" && <Flag size={11} />}
                    {f === "all" ? "All" : f === "unread" ? "Unread" : "Flagged"}
                  </button>
                );
              })}
              {ccApplies && (
                <>
                  <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                  {((isAdmin ? ["mine", "primary", "cc", "forwarded"] : ["mine", "primary", "cc"]) as Bucket[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      // Pressed again, it is off: back to All.
                      onClick={() => {
                        setFilter("all");
                        setView(view.view === v ? EVERYTHING : { view: v, person: null, direction: "any" });
                      }}
                      aria-pressed={view.view === v}
                      title={VIEW_TITLE[v]}
                      className={`flex h-6 items-center gap-1 rounded-md px-2 transition-colors ${
                        view.view === v ? "bg-surface-2 font-medium text-text-primary" : "text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {v === "mine" && <UserIcon size={11} />}
                      {v === "cc" && <Users size={11} />}
                      {v === "forwarded" && <Repeat2 size={11} />}
                      {VIEW_LABEL[v]}
                    </button>
                  ))}
                </>
              )}
            </div>
            {ccActive && picking && (
              /*
                CC'd: which of ours copied him. Auto-forwarded: whose mail it
                is — of one of ours, both ways or one. ALG's people only:
                outside senders are hundreds, and are not who is looked for.
              */
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5 text-[11.5px]">
                <label className="text-text-muted" htmlFor="mail-whose">
                  {picking === "cc" ? "CC'd by" : "Whose mail"}
                </label>
                <div className="relative min-w-0 max-w-[14rem] flex-1">
                  <UserIcon size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden />
                  <select
                    id="mail-whose"
                    value={view.person ?? ""}
                    onChange={(e) => setView({ view: picking, person: e.target.value || null, direction: "any" })}
                    className="h-7 w-full truncate rounded-md border border-border bg-surface-1 py-0 pl-7 pr-2 text-[12px] leading-none text-text-primary"
                  >
                    <option value="">Everyone</option>
                    {pickable.map((p) => (
                      <option key={p.address} value={p.address}>
                        {p.name} ({picking === "cc" ? p.sent : p.sent + p.received})
                      </option>
                    ))}
                    {/* Kept when chosen but not in the list now, rather than silently dropped. */}
                    {view.person && !chosen && <option value={view.person}>{view.person}</option>}
                  </select>
                </div>
                {picking === "forwarded" && view.person && (!chosen || chosen.ours) && (
                  <select
                    value={view.direction}
                    onChange={(e) => setView({ ...view, direction: e.target.value as ViewChoice["direction"] })}
                    aria-label="Which way"
                    className="h-7 rounded-md border border-border bg-surface-1 px-2 py-0 text-[12px] leading-none text-text-primary"
                  >
                    <option value="any">In and out{chosen ? ` (${chosen.sent + chosen.received})` : ""}</option>
                    <option value="received">Received by them{chosen ? ` (${chosen.received})` : ""}</option>
                    <option value="sent">Sent by them{chosen ? ` (${chosen.sent})` : ""}</option>
                  </select>
                )}
              </div>
            )}
            </>
          )}

          {loading && messages.length === 0 ? (
            <ListSkeleton bare rows={7} />
          ) : messages.length === 0 ? (
            <div className="p-4 text-[13px] text-text-muted">
              {query ? (
                <>
                  <p>
                    Nothing found for <span className="font-medium text-text-primary">{query}</span>
                    {scope === "folder" ? ` in ${folders.find((f) => f.id === folder)?.label ?? "this folder"}` : ""}.
                  </p>
                  {scope === "folder" && (
                    <button type="button" onClick={() => setScope("all")} className="mt-2 text-[12px] text-text-accent hover:underline">
                      Search every folder instead
                    </button>
                  )}
                </>
              ) : filter === "unread" ? (
                "No unread mail here."
              ) : filter === "flagged" ? (
                "Nothing flagged here. Flag a message to keep it here until it is dealt with."
              ) : (
                "Nothing in this folder."
              )}
            </div>
          ) : searching ? (
            /*
              Search results are messages, not conversations: each is here because
              it matched, and each says so — the words marked in the name, the
              subject and the line of the message where they appear, and the
              folder it is in.
            */
            <ul className="divide-y divide-border max-h-[calc(100vh-260px)] min-h-[300px] overflow-y-auto overscroll-contain lg:max-h-none lg:min-h-0 lg:flex-1">
              {messages.map((m) => (
                <MailListRow
                  key={m.id}
                  message={m}
                  folder={m.folder}
                  selected={selectedId === m.id}
                  queued={queued.get(m.id)}
                  highlight={terms}
                  showFolder={scope === "all"}
                  checked={checked.has(m.id)}
                  selecting={checked.size > 0}
                  onCheck={(shift) => toggleCheck(m.id, shift)}
                  snoozedUntil={snoozeOf.get(m.id)?.until}
                  onOpen={() => void open(m)}
                  onWarm={() => prefetchMailMessage(mailbox, m.id, m.folder)}
                  onChanged={() => void load()}
                />
              ))}
            </ul>
          ) : ccActive && rows.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-[13px] text-text-muted">
              {loadingMore ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Looking further back…
                </>
              ) : (
                <span>
                  {checking.size > 0 && view.view !== "cc"
                    ? `Checking ${checking.size} message${checking.size === 1 ? "" : "s"} for auto-forwards…`
                    : view.view === "mine"
                      ? "Nothing from outside the company written to you"
                      : view.view === "primary"
                      ? "Nothing from a colleague written to you"
                      : view.view === "cc"
                        ? view.person
                          ? `Nothing ${chosen?.name ?? view.person} CC'd you on`
                          : "Nothing you were CC'd on"
                        : view.person
                          ? `None of ${chosen?.name ?? view.person}'s mail forwarded to you`
                          : "Nothing auto-forwarded to you"}
                  {checking.size > 0 && view.view !== "cc"
                    ? ""
                    : `${oldestLoaded ? ` since ${formatDate(oldestLoaded, { day: "numeric", month: "short", year: "numeric" })}` : ""}.${nextLink ? " Look further back below." : ""}`}
                </span>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border max-h-[calc(100vh-260px)] min-h-[300px] overflow-y-auto overscroll-contain lg:max-h-none lg:min-h-0 lg:flex-1">
              {rows.map(({ key, m: newest, group }) => {
                const t = { conversationId: key, messages: group, unread: group.some((x) => !x.isRead) };
                return (
                  <MailListRow
                    key={t.conversationId}
                    message={newest}
                    folder={folder}
                    selected={Boolean(selected) && (t.conversationId === selected?.conversationId || t.messages.some((m) => m.id === selectedId))}
                    queued={t.messages.map((m) => queued.get(m.id)).find(Boolean)}
                    count={Math.max(t.messages.length, sizes.get(t.conversationId) ?? 0)}
                    anyUnread={t.unread}
                    anyFlagged={t.messages.some((m) => m.flagged)}
                    checked={checked.has(t.conversationId)}
                    selecting={checked.size > 0}
                    onCheck={(shift) => toggleCheck(t.conversationId, shift)}
                    snoozedUntil={snoozeOf.get(newest.id)?.until}
                    backFromSnooze={t.messages.some((x) => returnedOf.has(x.id))}
                    copyNote={ccApplies && view.view !== "primary" && view.view !== "mine" ? copyNote(newest, lens) : null}
                    onOpen={() => void open(newest, t.messages)}
                    onWarm={() => prefetchMailMessage(mailbox, newest.id, newest.folder)}
                    onChanged={() => void load()}
                  />
                );
              })}
            </ul>
          )}

          {/*
            Sits under the scroller rather than inside it, so it does not have
            to be scrolled to twice — once to the bottom of the list, once to
            find the button.
          */}
          {messages.length > 0 && (
            <div className="border-t border-border px-3 py-2">
              {ccActive && view.view !== "cc" && checking.size > 0 && rows.length > 0 && (
                <p className="flex items-center justify-center gap-1.5 pb-1 text-[11px] text-text-muted">
                  <Loader2 size={11} className="animate-spin" /> Checking {checking.size} message{checking.size === 1 ? "" : "s"} for auto-forwards
                </p>
              )}
              {ccActive && nextLink && (
                <p className="pb-1 text-center text-[11px] text-text-muted">
                  {rows.length} of {conversations.length} conversations
                  {oldestLoaded ? `, back to ${formatDate(oldestLoaded, { day: "numeric", month: "short" })}` : ""}
                </p>
              )}
              {nextLink ? (
                <button
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-60"
                >
                  {loadingMore ? <Loader2 size={13} className="animate-spin" /> : null}
                  {loadingMore ? (ccActive ? "Looking further back…" : "Loading…") : searching ? "More results" : ccActive ? "Look further back" : "Load older mail"}
                </button>
              ) : (
                <p className="py-0.5 text-center text-[11px] text-text-muted">
                  {searching ? (
                    `${messages.length} result${messages.length === 1 ? "" : "s"} — that is all of them.`
                  ) : (
                    ccActive ? (
                      `${rows.length} of ${conversations.length} conversation${conversations.length === 1 ? "" : "s"} shown: that is the whole folder.`
                    ) : <>
                  {conversations.length} conversation{conversations.length === 1 ? "" : "s"}
                  {conversations.length !== messages.length ? ` (${messages.length} messages)` : ""} — that is the whole
                  folder.
                    </>
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ---- reading pane ---- */}
        <div ref={reader} className="card min-h-[320px] scroll-mt-16 p-5 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden lg:p-0">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-16 lg:px-5">
              <MailIcon size={22} className="text-text-muted mb-2" />
              <p className="text-[13px] text-text-muted">Select a message to read it.</p>
            </div>
          ) : (
            <article className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
              {/*
                The subject and what can be done with the message, above the
                part that scrolls: replying to the end of a long thread does not
                mean scrolling back to its start first.
              */}
              {/* `contents` below lg: a sticky bar only sticks within its parent,
                  and on a phone that has to be the whole message, not this. */}
              <div className="contents lg:block lg:shrink-0 lg:border-b lg:border-border lg:px-5 lg:pb-3 lg:pt-4 short:lg:pb-2.5 short:lg:pt-3">
              <div className="flex items-start gap-2">
                {/* Two lines at most above the message on a desk; the whole subject is its title. */}
                <h2 title={selected.subject} className="min-w-0 flex-1 text-[16px] font-semibold tracking-tight text-text-primary lg:line-clamp-2 short:lg:line-clamp-1 xl:text-[17px]">
                  <Highlighted text={selected.subject} terms={searching ? terms : undefined} />
                </h2>
                <button
                  type="button"
                  onClick={toggleWide}
                  title={wide ? "Show the list beside the message" : "Hide the list: read the message at full width"}
                  aria-label={wide ? "Show the message list" : "Read at full width"}
                  aria-pressed={wide}
                  className="hidden shrink-0 rounded-lg border border-border p-1.5 text-text-secondary hover:border-border-strong hover:text-text-primary lg:block"
                >
                  {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>

              {/*
                On a phone the page scrolls, so the bar pins under the top bar
                instead once it reaches it.
              */}
              <div className="sticky top-14 z-10 -mx-5 mt-2.5 flex flex-wrap items-start gap-2 border-b border-transparent bg-surface-1 px-5 py-2 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-0">
                {/*
                  A draft (one started in Outlook) is finished and sent, not
                  answered: it used to offer Reply, Forward and "make an enquiry
                  of this", on a mail that had not gone anywhere.
                */}
                {isDraft ? (
                  <>
                    <button
                      onClick={() => setComposing({ draft: selected })}
                      disabled={!(full && full.id === selectedId)}
                      className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium transition-colors disabled:opacity-60"
                    >
                      <PenSquare size={13} />
                      Edit and send
                    </button>
                    <button
                      onClick={() => void remove(selected)}
                      title="Discard the draft (to Deleted Items)"
                      className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
                    >
                      <Trash2 size={13} />
                      Discard
                    </button>
                    <span className="self-center text-[12px] text-text-muted">A draft — not sent yet.</span>
                  </>
                ) : (
                  <>
                  <button
                    onClick={() => setComposing({ replyTo: selected, mode: "reply" })}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium transition-colors"
                  >
                    <Reply size={13} />
                    Reply
                  </button>
                  {/* Their words only where there is room (xl, or reading at full width). */}
                  <button
                    onClick={() => setComposing({ replyTo: selected, mode: "replyAll" })}
                    title="Reply all"
                    aria-label="Reply all"
                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors ${roomy ? "px-3" : "lg:px-2.5 xl:px-3"}`}
                  >
                    <ReplyAll size={13} />
                    <span className={roomy ? "" : "lg:hidden xl:inline"}>Reply all</span>
                  </button>
                  <button
                    onClick={() => setComposing({ replyTo: selected, mode: "forward" })}
                    title="Forward"
                    aria-label="Forward"
                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors ${roomy ? "px-3" : "lg:px-2.5 xl:px-3"}`}
                  >
                    <Forward size={13} />
                    <span className={roomy ? "" : "lg:hidden xl:inline"}>Forward</span>
                  </button>

                  {/*
                    Filing onto an enquiry that already exists, which is a
                    different act from the queue buttons beside it: those mint a
                    reference, and most mail after the first on a job should not.
                    An enquiry collects threads — the customer's original, the
                    agent's rate, the carrier's booking note — and each arriving
                    as its own enquiry is how one job ends up holding four
                    references with a quarter of the correspondence under each.
                  */}
                  <FileToEnquiry message={selected} onFiled={() => void load()} />

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
                      title="Archive the conversation"
                      aria-label="Archive the conversation"
                      className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors ${roomy ? "px-3" : "lg:px-2.5 xl:px-3"}`}
                    >
                      <Archive size={13} />
                      <span className={roomy ? "" : "lg:hidden xl:inline"}>Archive</span>
                    </button>
                  )}

                  <MoveMenu compact folders={folders} current={selected.folder} onMove={(to, label) => void moveTo(selected, to, label)} />
                  {snoozeOf.get(selected.id) ? (
                    <button
                      onClick={() => void unsnooze(snoozeOf.get(selected.id)!)}
                      title={`Snoozed until ${snoozeLabel(new Date(snoozeOf.get(selected.id)!.until))} — bring it back now`}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                    >
                      <Undo2 size={13} />
                      Unsnooze
                    </button>
                  ) : (
                    selected.folder !== "deleted" &&
                    selected.folder !== "junk" && <SnoozeMenu compact onPick={(until) => void snooze(selected, until)} />
                  )}

                  {/* The rest of Outlook's bar, as icons: Delete, flag, unread, open in Outlook.
                      In Deleted Items and Junk, Delete gives way to Restore / Not junk. */}
                  {selected.folder === "deleted" || selected.folder === "junk" ? (
                    <button
                      onClick={() => void moveTo(selected, "inbox", "Inbox")}
                      title={selected.folder === "junk" ? "Not junk — back to the Inbox" : "Restore to the Inbox"}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                    >
                      <Undo2 size={13} />
                      {selected.folder === "junk" ? "Not junk" : "Restore"}
                    </button>
                  ) : (
                    <button
                      onClick={() => void remove(selected)}
                      title={searching ? "Delete (to Deleted Items)" : "Delete the conversation (to Deleted Items)"}
                      aria-label="Delete"
                      className="grid size-8 place-items-center rounded-lg border border-border text-text-secondary transition-colors hover:border-border-strong hover:text-text-danger"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  <button
                    onClick={() => void toggleFlag(selected)}
                    title={selected.flagged ? "Clear the flag" : "Flag for follow-up"}
                    aria-label={selected.flagged ? "Clear the flag" : "Flag for follow-up"}
                    aria-pressed={Boolean(selected.flagged)}
                    className={`grid size-8 place-items-center rounded-lg border transition-colors ${
                      selected.flagged
                        ? "border-text-danger/40 bg-bg-danger text-text-danger"
                        : "border-border text-text-secondary hover:border-border-strong hover:text-text-primary"
                    }`}
                  >
                    <Flag size={13} className={selected.flagged ? "fill-current" : ""} />
                  </button>
                  <button
                    onClick={() => void toggleRead(selected)}
                    title={selected.isRead ? "Mark unread" : "Mark read"}
                    aria-label={selected.isRead ? "Mark unread" : "Mark read"}
                    className="grid size-8 place-items-center rounded-lg border border-border text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                  >
                    {selected.isRead ? <MailIcon size={13} /> : <MailOpen size={13} />}
                  </button>
                  {selected.webLink && (
                    <a
                      href={selected.webLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open in Outlook on the web"
                      aria-label="Open in Outlook"
                      className="grid size-8 place-items-center rounded-lg border border-border text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                  </>
                )}
              </div>
              </div>

              <div ref={readerScroll} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:px-5 lg:pb-5">
              {/*
                The whole conversation, Outlook's way: this message open, every
                other one in the thread — from any folder — a line that opens in
                place. A conversation of one reads exactly as a single message.
              */}
              <MailConversation
                mailbox={mailbox}
                message={selected}
                complete={Boolean(full && full.id === selectedId)}
                when={fullTime}
                refresh={sentTick}
                onSize={noteSize}
                highlight={searching ? terms : undefined}
                onReply={(m, mode) => setComposing({ replyTo: m, mode })}
                opened={
                  <>
                    <ShipmentLinks text={`${selected.subject} ${selected.body.content}`} />

                    <div className="mt-4 pt-4 border-t border-border">
                      {/*
                        The body is only ever drawn from the fetched message. The list
                        row carries a 255-character preview in the same shape, and
                        rendering that on a failure is what made a broken request look
                        like a short mail.
                      */}
                      {full && full.id === selectedId ? (
                        <MailBody message={selected} highlight={searching ? terms : undefined} />
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
                        <SectionSkeleton lines={5} label="Loading the message" className="py-2" />
                      )}
                    </div>

                    {/*
                      No enquiryRef: this screen is the mailbox, not a case. A message
                      here may belong to no enquiry, or to one nobody has decided on
                      yet — saving an attachment would have to guess which, and a
                      customer's packing list filed onto the wrong job is worse than
                      one not filed at all. File the thread first, then save from the
                      case file.
                    */}
                    <MessageAttachments message={selected} />
                  </>
                }
              />
              </div>
            </article>
          )}
        </div>
      </div>

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-[#0F213A] px-3.5 py-2 text-[12.5px] text-white shadow-lg">
          {toast}
        </div>
      )}

      {rulesOpen && <RulesDialog mailbox={mailbox} folders={folders} onClose={() => setRulesOpen(false)} />}

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
          mode={composing.mode}
          draft={composing.draft}
          reference={replyRef}
          onClose={() => setComposing(null)}
          onDraftSaved={() => {
            setToast("Saved to Drafts.");
            void load();
          }}
          onSent={() => {
            // A sent draft has left Drafts; its pane goes with it.
            if (composing.draft) {
              setSelectedId(null);
              setFull(null);
            }
            setComposing(null);
            setSentTick((t) => t + 1);
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
  return formatDate(isoDate, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/** One action in the bulk bar: an icon, and its word where there is room. */
function BulkButton({ label, icon, onClick, danger }: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-7 items-center gap-1 rounded-md px-2 text-text-secondary transition-colors hover:bg-surface-2 ${danger ? "hover:text-text-danger" : "hover:text-text-primary"}`}
    >
      {icon}
      <span className="hidden 2xl:inline">{label}</span>
    </button>
  );
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
