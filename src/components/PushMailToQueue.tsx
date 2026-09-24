import { useEffect, useRef, useState } from "react";
import { Check, ClipboardList, Loader2, Sparkles, UserPlus, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import EnquiryLink from "./EnquiryLink";
import Select from "./Select";
import { readMessage, type Reading } from "../services/classify";
import ReadingPanel from "./ReadingPanel";
import Drafting from "./Drafting";
import {
  assignMessageTo,
  promoteIntake,
  sendMessageToInbound,
  takeMessageOn,
  type Intake,
  type IntakeStatus,
} from "../services/intake";
import { mayAssignOthers, nameOf, type Person } from "../services/enquiries";
import { looksLikeWebEnquiry, parseWebEnquiry } from "../services/webEnquiry";
import type { MailMessage } from "../services/backend";

/**
 * Turns an email into work, from the list or from the reading pane.
 *
 * ---------------------------------------------------------------------------
 * TWO ACTIONS, BECAUSE THERE ARE TWO SITUATIONS
 *
 * Send to inbound opens an enquiry from the message on the shared inbound
 * board, under a reference of ours, for whoever takes it. The desk decides
 * from the mail itself, so it no longer stops in a queue first; if the push is
 * refused (nothing to name it by), the message waits on the Enquiries page.
 *
 * My enquiries is for mail you have just read and know is yours: the same, and
 * claimed in the same press, so it lands on your own list.
 *
 * Both go through the same functions and leave the same trail — somebody
 * reading the timeline afterwards cannot tell which button was used, and
 * should not need to.
 *
 * Only Send to inbound appears on a list row. Two icons per row in a 200px
 * column would make the list about its buttons, and the judgement that justifies
 * claiming something is one you make with the message open.
 *
 * ONE CONTROL, TWO SIZES
 *
 * The same action appears in two places that have very different room for it:
 * a 200px list row where only an icon fits, and the reading pane where it sits
 * beside Reply and Archive as a full button. Writing it twice would mean two
 * places to fix the day the wording or the guard changes, so it is one
 * component that renders narrow or wide.
 *
 * THE TRAIL
 *
 * Every route still passes through intake and is promoted by the same function
 * under the same guards, and the conversation id travels with it, so every
 * later reply in the thread files itself against the new reference.
 *
 * A submission from the website's own form is recognised and read on the way
 * in, so it arrives with its fields already filled.
 * ---------------------------------------------------------------------------
 */
export default function PushMailToQueue({
  message,
  queued,
  size = "full",
  people = [],
  meId,
  onChanged,
}: {
  message: MailMessage;
  /** What the queue already knows about this message, if anything. */
  queued?: Pick<Intake, "id" | "status" | "enquiry_ref">;
  size?: "icon" | "full";
  /** The desk, for the hand-off picker. Empty means it is not offered. */
  people?: Person[];
  meId?: string;
  /** Something happened; the page should refetch. */
  onChanged: () => void;
}) {
  // Which action is running, so only that button spins.
  const [busy, setBusy] = useState<null | "queue" | "take" | "assign">(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  /**
   * What a model made of this message, once somebody asked it to look.
   *
   * Asked for rather than run automatically: reading every message on open
   * would spend a request on the circulars and delivery notes that are most of
   * an inbox, to answer a question nobody had. The button is pressed on the
   * ones that are actually ambiguous.
   */
  const [reading, setReading] = useState<Reading | null>(null);
  const [readingBusy, setReadingBusy] = useState(false);
  const [readingError, setReadingError] = useState<string | null>(null);

  /**
   * A different message is a different everything.
   *
   * The reading pane keeps ONE instance of this and hands it a new `message`
   * prop, so nothing resets on its own. Left alone, opening a second mail
   * showed the first one's summary under the second one's subject — and hid the
   * Read this button, which only appears when there is no reading yet. One
   * cause, two symptoms, and the wrong half of it is the dangerous one: a
   * summary attributed to a message it was not written about.
   *
   * The picker and the errors go with it for the same reason. A half-opened
   * hand-off should not survive into a mail it was not opened on.
   */
  useEffect(() => {
    setReading(null);
    setReadingError(null);
    setReadingBusy(false);
    setPicking(false);
    setError(null);
  }, [message.id]);

  /**
   * Which message is on screen right now, readable from inside an async call.
   *
   * `message` captured in a closure is the message as it was when the button
   * was pressed, so comparing it against itself after an await proves nothing.
   * A ref is the only thing in a function component that reads the CURRENT
   * value from inside work that started earlier.
   */
  const currentId = useRef(message.id);
  currentId.current = message.id;

  async function readIt() {
    // Which message this read is about. A read takes a second or two and the
    // operator can move on inside it — without this, the answer for the message
    // they left lands under the one they are now looking at.
    const asked = message.id;
    setReadingBusy(true);
    setReadingError(null);
    try {
      const r = await readMessage(message);
      if (asked !== currentId.current) return;
      setReading(r);
    } catch (e) {
      if (asked !== currentId.current) return;
      setReadingError(e instanceof Error ? e.message : "Could not read that message.");
    } finally {
      if (asked === currentId.current) setReadingBusy(false);
    }
  }

  // Handing straight to a colleague needs the permission. The database checks
  // it inside the same transaction as the promotion, so a refusal leaves no
  // reference behind; hiding the control only saves somebody the refusal.
  const canHandOver = mayAssignOthers(people, meId);

  // A submission from the website's form, whose fields can be read before
  // anybody commits to them. Shown rather than silently applied, on the same
  // principle as the push panel: a parse is a guess until somebody looks.
  const web = looksLikeWebEnquiry(message) ? parseWebEnquiry(message) : null;

  async function run(which: "queue" | "take" | "assign", fn: () => Promise<unknown>) {
    setBusy(which);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  /** Onto the inbound board, for whoever takes it (or push the row already waiting). */
  const push = () => run("queue", () => (queued ? promoteIntake(queued.id) : sendMessageToInbound(message)));

  /**
   * Queue it, push it through and take it on.
   *
   * When the message is already in the queue there is nothing to capture, so it
   * promotes the row that exists rather than making a second one.
   */
  const take = () =>
    run("take", () =>
      queued ? promoteIntake(queued.id, undefined, true) : takeMessageOn(message)
    );

  /** Push it through and put it on that person's list rather than your own. */
  const giveTo = (userId: string) =>
    run("assign", () =>
      queued
        ? promoteIntake(queued.id, undefined, false, userId)
        : assignMessageTo(message, userId)
    );

  /**
   * The hand-off control, defined once and rendered in one place.
   *
   * The picker takes the button's own position rather than appearing under the
   * row. Rendering it in a second slot was what made it drop to a new line, and
   * a control that moves when you press it makes you re-find the thing you were
   * already pointing at.
   *
   * It also has to appear on two different render paths — a message nobody has
   * touched, and one already waiting in the queue. The first version of this
   * reached only the first of them, so a message already in the queue offered no
   * way to give it to anybody. Writing it twice is how that happens again.
   */
  const handOff = !canHandOver ? null : picking ? (
    <span className="inline-flex items-center gap-2">
      <Select
        label="Assign this enquiry to"
        className="w-52"
        value=""
        onChange={(v) => {
          setPicking(false);
          if (v) void giveTo(v);
        }}
        options={[
          { value: "", label: "Choose a person…" },
          ...people.map((p) => ({
            value: p.id,
            label: p.full_name?.trim() || p.email,
            hint: p.id === meId ? "you" : p.role === "admin" ? "administrator" : undefined,
          })),
        ]}
      />
      <button
        onClick={() => setPicking(false)}
        className="text-[11px] text-text-secondary hover:text-text-primary"
      >
        Cancel
      </button>
    </span>
  ) : (
    <button
      onClick={() => setPicking(true)}
      disabled={busy !== null}
      title="Open an enquiry from this and put it on a colleague's list"
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong disabled:opacity-60 transition-colors"
    >
      {busy === "assign" ? (
        <Loader2 size={13} className="animate-spin" />
      ) : (
        <UsersRound size={13} />
      )}
      Assign to
    </button>
  );

  /** Said under the row, so explaining it never moves the control. */
  const handOffHint = canHandOver && picking && (
    <p className="w-full text-[11px] text-text-muted">
      It opens as an enquiry and lands on their My enquiries, not yours.
    </p>
  );

  /**
   * The read control, defined once because it belongs on two paths.
   *
   * A message already in the queue is exactly the one worth reading: the queue
   * is where undecided mail waits, and the decision it is waiting for — push it
   * through, or set it aside — is the one a reading helps with. The first
   * version reached only untouched mail, which is the case where the operator
   * has the message open and needs it least.
   *
   * Not offered for a website submission: `webEnquiry` reads those exactly, for
   * free, and cannot invent a field. Not offered once a reading exists, because
   * the panel below replaces it with Read again.
   */
  const readControl = web ? null : (
    <button
      onClick={() => void readIt()}
      disabled={readingBusy}
      title="Ask the model whether this is an enquiry, and what is in it"
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong disabled:opacity-60 transition-colors"
    >
      {readingBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
      {reading ? "Read again" : "Read this"}
    </button>
  );

  /**
   * The reading, on its own line and the full width of the row.
   *
   * `w-full` in a wrapping flex row is what forces the break: the panel used to
   * be nested inside this component's own column, which sits as the third item
   * in the action row beside Reply and Archive — so it started wherever that
   * column started and read as though it were hanging off the Assign button
   * rather than describing the message.
   *
   * The root below is `display: contents` for the same reason, so these become
   * direct children of the action row instead of a nested column.
   */
  const readOutput = (readingBusy || readingError || reading) && (
    <div className="w-full">
      {/*
        The reading takes as long as a draft does and had only a spinner in the
        button to show for it, on a row where several other buttons also spin.
        It lands here, so the wait is where the answer will be.
      */}
      {readingBusy && !reading && (
        <Drafting label="Reading the message" lines={3} compact />
      )}
      {readingError && (
        <span className="block max-w-2xl break-words text-[11px] text-text-danger">
          {readingError}
        </span>
      )}
      {reading && <ReadingPanel reading={reading} />}
    </div>
  );

  // Already dealt with. Say which, and where it went.
  if (queued) {
    const label: Record<IntakeStatus, string> = {
      new: "Waiting — push it through",
      promoted: queued.enquiry_ref ?? "Pushed through",
      dismissed: "Set aside",
    };

    if (size === "icon") {
      return (
        <span
          title={label[queued.status]}
          className="grid size-6 place-items-center rounded text-text-success"
        >
          <Check size={12} />
        </span>
      );
    }

    if (queued.status === "promoted" && queued.enquiry_ref) {
      return (
        <EnquiryLink
          to={`/enquiries/${queued.enquiry_ref}`}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 font-mono text-[12px] text-text-accent hover:border-border-strong transition-colors"
        >
          <Check size={13} />
          {queued.enquiry_ref}
        </EnquiryLink>
      );
    }

    return (
      <div className="contents">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/intake"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
          >
            <Check size={13} />
            {label[queued.status]}
          </Link>

          {/* Still waiting in the queue, so it can still be taken straight on. */}
          {queued.status === "new" && (
            <button
              onClick={() => void take()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-[12px] font-medium text-white disabled:opacity-60 transition-colors"
            >
              {busy === "take" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <UserPlus size={13} />
              )}
              My enquiries
            </button>
          )}

          {queued.status === "new" && handOff}

          {/* Worth reading precisely because it is still undecided. */}
          {readControl}
        </div>

        {queued.status === "new" && handOffHint}
        {error && <p className="w-full text-[11px] text-text-danger">{error}</p>}
        {readOutput}
      </div>
    );
  }

  if (size === "icon") {
    return (
      <button
        onClick={(e) => {
          // The row behind this is a link into the message. Queueing is not
          // opening, so the click must not travel.
          e.preventDefault();
          e.stopPropagation();
          void push();
        }}
        disabled={busy !== null}
        title={error ?? "Send to inbound enquiries"}
        aria-label="Send to inbound enquiries"
        className={`grid size-6 place-items-center rounded transition-colors disabled:opacity-50 ${
          error
            ? "text-text-danger"
            : "text-text-muted hover:bg-surface-2 hover:text-text-primary"
        }`}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <ClipboardList size={12} />}
      </button>
    );
  }

  const READABLE: Array<[keyof ReturnType<typeof parseWebEnquiry>, string]> = [
    ["contact_name", "Name"],
    ["company", "Company"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["origin", "Origin"],
    ["destination", "Destination"],
    ["cargo", "Cargo"],
  ];

  return (
    <div className="contents">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          An outline in every case, including a website form. It used to go
          brand-green for those, which now puts two green buttons side by side
          and makes neither of them the obvious one. Filing it as your own work
          is the prominent action; sending it to the shared queue is the
          alternative, and an alternative should look like one.
        */}
        <button
          onClick={() => void push()}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong disabled:opacity-60 transition-colors"
        >
          {busy === "queue" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ClipboardList size={13} />
          )}
          {web ? "Send this enquiry through" : "Send to inbound"}
        </button>

        {/*
          The queue is for mail you have not decided about. This is for mail you
          have: it opens the enquiry and puts it on your own list in one press,
          through the same functions and leaving the same trail.
        */}
        <button
          onClick={() => void take()}
          disabled={busy !== null}
          title="Open an enquiry from this and put it on My enquiries"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-[12px] font-medium text-white disabled:opacity-60 transition-colors"
        >
          {busy === "take" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <UserPlus size={13} />
          )}
          My enquiries
        </button>


        {handOff}

        {/*
          Offered only when the form parser has not already answered. A website
          submission has a known shape and `webEnquiry` reads it exactly, for
          free and without the possibility of inventing anything — asking a
          model to re-read it would be slower, cost a request, and be less
          reliable at the one job the regex was written for.
        */}
        {readControl}
      </div>


      {handOffHint}

      {readOutput}

      {web && (
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px]">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            Website form
          </p>
          {web.found.length ? (
            <dl className="mt-1 space-y-0.5">
              {READABLE.filter(([k]) => web[k]).map(([k, label]) => (
                <div key={label} className="flex gap-2">
                  <dt className="w-20 shrink-0 text-text-muted">{label}</dt>
                  <dd className="min-w-0 text-text-primary break-words">{String(web[k])}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-1 text-text-secondary">
              No labelled fields found. It goes to the queue with the message as written.
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-text-muted">
            Read from the body, not the sender. Correct anything wrong in the queue before pushing
            it through.
          </p>
        </div>
      )}

      {error && <p className="w-full text-[11px] text-text-danger">{error}</p>}
    </div>
  );
}
