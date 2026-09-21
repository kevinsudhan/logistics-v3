import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { ChevronDown, MessagesSquare } from "lucide-react";
import type { MailMessage } from "../services/backend";

/**
 * A message rendered the way it was written.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG
 *
 * The reading pane printed the body into a `<pre>`, and the body it printed was
 * `bodyPreview` — Graph's plain-text snippet, capped around 255 characters —
 * because the list query never asked for the real one and nothing fetched it on
 * open. So every message lost its tables, its formatting and most of its text,
 * and a rate card with eleven rows of charges arrived as three lines of prose.
 *
 * WHY THE HTML IS SANITISED AND NOT SANDBOXED
 *
 * Email is the least trustworthy HTML a business handles: it arrives from
 * anybody, and dropping it into the page raw is the textbook way to hand a
 * stranger a script running as the signed-in user.
 *
 * DOMPurify removes scripts, event handlers and every tag that can fetch or
 * execute. What it keeps is what business mail is actually made of — tables,
 * inline styles, colours, links — so a quotation looks like the quotation the
 * sender sent.
 *
 * `<style>` blocks are refused even though they are safe to execute, because
 * their rules are not scoped to this container and a sender's `td { }` would
 * quietly restyle the CRM around it. Outlook-generated mail styles inline
 * anyway, which is why the tables survive without it.
 *
 * WHAT IS DELIBERATELY LOST
 *
 * Images embedded in the message itself arrive as `cid:` references to
 * attachments Graph serves separately. `getMessage` now fetches those and
 * rewrites them to data URIs before the body gets here, so a signature logo
 * draws — which it did not for a long time, because this used to be the end of
 * the line for them.
 *
 * What still goes is the ones it could not resolve: an inline image over the
 * size cap, or one whose attachment would not load. `cid:` is not a scheme a
 * browser knows, so the alternative is a broken-image icon in the middle of
 * every signature.
 *
 * Images hosted elsewhere do load, which is how a sender's logo appears and
 * also how a tracking pixel reports that the message was opened. Outlook makes
 * the same trade for known senders. It is worth knowing rather than hiding.
 * ---------------------------------------------------------------------------
 */

/** Tags that either execute, fetch, or restyle their surroundings. */
const FORBID_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "base",
  "link",
  "meta",
  "noscript",
];

/**
 * Where a client marks the start of the conversation it is quoting.
 *
 * Outlook writes a divRplyFwdMsg block holding the From/Sent/To header of the
 * message being answered; Graph prefixes ids and classes it does not own with
 * `x_`, so both spellings appear. Gmail uses gmail_quote. A top-level
 * blockquote is the older convention and still common.
 *
 * These are conventions rather than a standard, so a miss is expected and
 * harmless: the body renders whole, exactly as it did before, and nothing is
 * hidden. Only a hit changes anything.
 */
const QUOTE_MARKERS = [
  "#divRplyFwdMsg",
  "#x_divRplyFwdMsg",
  "#appendonsend",
  "#x_appendonsend",
  ".gmail_quote",
  ".x_gmail_quote",
  ".OutlookMessageHeader",
  ".x_OutlookMessageHeader",
].join(",");

/**
 * The old convention, checked only when none of the above matched.
 *
 * A blockquote means quoted history most of the time, and an indented aside in
 * the middle of a paragraph the rest of it. Folded into the list above it would
 * be found first whenever it appears earlier in the document — querySelector
 * answers in document order, not in the order the selectors are written — so a
 * sender who indents one line would have the rest of their message cut away
 * behind the toggle and read as mail that did not load.
 *
 * Kept as a fallback because a client that marks its quoting no other way is
 * still worth splitting.
 */
const QUOTE_FALLBACK = "blockquote";

/**
 * Separates what this message says from the thread it is quoting.
 *
 * A reply-to-a-reply-to-a-reply arrives as one blob in which the two sentences
 * somebody actually wrote sit above four screens of everything already said.
 * Reading that means scrolling past history to find the new part, every time.
 *
 * The split happens at the top level: the marker may be nested, so this climbs
 * to whichever direct child of body contains it and cuts there, which keeps
 * both halves as valid standalone fragments. A horizontal rule immediately
 * before the marker belongs to the history and goes with it.
 *
 * If the cut would leave nothing above it, the whole message IS history — a
 * bare forward — so it is left intact rather than collapsed into nothing.
 */
function splitQuoted(doc: Document): { latest: string; history: string | null } {
  const body = doc.body;
  const marker = body.querySelector(QUOTE_MARKERS) ?? body.querySelector(QUOTE_FALLBACK);
  if (!marker) return { latest: body.innerHTML, history: null };

  let top: Node | null = marker;
  while (top && top.parentNode !== body) top = top.parentNode;
  if (!top) return { latest: body.innerHTML, history: null };

  const children = [...body.childNodes];
  let cut = children.indexOf(top as ChildNode);
  if (cut < 0) return { latest: body.innerHTML, history: null };

  // A rule drawn immediately above the quote is part of it.
  for (let i = cut - 1; i >= 0; i--) {
    const n = children[i];
    if (n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()) continue;
    if (n.nodeName === "HR") cut = i;
    break;
  }

  const before = children.slice(0, cut);
  const after = children.slice(cut);
  const text = before.map((n) => n.textContent ?? "").join("").trim();

  // Nothing above the quote means there is nothing to separate it from.
  if (!text && !before.some((n) => n.nodeName === "IMG")) {
    return { latest: body.innerHTML, history: null };
  }

  const html = (nodes: ChildNode[]) => {
    const d = document.createElement("div");
    for (const n of nodes) d.appendChild(n.cloneNode(true));
    return d.innerHTML;
  };
  return { latest: html(before), history: html(after) };
}

/** Line ends, quote markers and a newline — named so the escaping is written once. */
const LF = String.fromCharCode(10);
const NEWLINE_RE = new RegExp(String.fromCharCode(92) + "r?" + String.fromCharCode(92) + "n");
const QUOTE_LINE_RE =
  /^\s*(-{2,}\s*Original Message\s*-{2,}|_{10,}|From:\s|On .+ wrote:\s*$)/i;

/** The same idea for a plain-text body, where quoting is a convention of prose. */
function splitQuotedText(text: string): { latest: string; history: string | null } {
  const lines = text.split(NEWLINE_RE);
  const at = lines.findIndex((l) => QUOTE_LINE_RE.test(l));
  // A marker on the very first line means the whole body is quoted, and there
  // is nothing above it to separate it from.
  if (at <= 0) return { latest: text, history: null };
  return {
    latest: lines.slice(0, at).join(LF).trimEnd(),
    history: lines.slice(at).join(LF),
  };
}

export default function MailBody({ message }: { message: MailMessage }) {
  const isHtml = message.body?.contentType === "html";
  const raw = message.body?.content ?? "";
  const ref = useRef<HTMLDivElement>(null);
  /** Quoted history starts folded. It is context, not the message. */
  const [showHistory, setShowHistory] = useState(false);

  // A new message means a new decision about its history.
  useEffect(() => setShowHistory(false), [message.id]);

  const text = useMemo(() => (isHtml ? null : splitQuotedText(raw)), [raw, isHtml]);

  const clean = useMemo(() => {
    if (!isHtml) return null;

    const html = DOMPurify.sanitize(raw, {
      FORBID_TAGS,
      FORBID_ATTR: ["srcset", "ping", "formaction"],
      // The presentational attributes business mail is actually built from.
      // DOMPurify drops these by default as legacy HTML, and dropping them is
      // what turned a rate card into a plain grid: the yellow header row and
      // the cyan cells in that table are bgcolor, and its rules are border.
      // None of them can execute anything; they only say how it looks.
      ADD_ATTR: [
        "bgcolor",
        "background",
        "border",
        "cellpadding",
        "cellspacing",
        "align",
        "valign",
        "width",
        "height",
        "color",
        "face",
        "size",
        "nowrap",
        "colspan",
        "rowspan",
      ],
      // ALLOWED_URI_REGEXP is deliberately NOT set. It reads like a way to
      // restrict link schemes, and it is applied to every attribute value
      // rather than only to URIs — so a tight pattern silently strips
      // border="1" and bgcolor="#FFFF00" along with the dangerous schemes, and
      // takes the colour out of every rate card in the process. Measured
      // against the default: javascript:, data:text/html, inline handlers, svg
      // onload, style, iframe and form are all removed, while tables, inline
      // styles, real links and remote images survive.
      //
      // Keep the fragment as a fragment; a full document would bring html and
      // body tags into the middle of the page.
      WHOLE_DOCUMENT: false,
    });

    // Embedded images are removed here rather than after the page has them.
    //
    // DOMPurify keeps a cid: src, and stripping the element in an effect is a
    // beat too late: React has already put it in the document and the browser
    // has already tried to fetch a scheme it does not know, which fails and
    // logs an error for every image in every signature.
    //
    // A DOMParser document is inert — nothing in it loads — so the removal
    // happens somewhere the fetch was never going to start.
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const img of doc.querySelectorAll('img:not([src]), img[src^="cid:"]')) img.remove();

    return splitQuoted(doc);
  }, [raw, isHtml]);

  /**
   * Every link in a message opens in a new tab and carries no referrer.
   *
   * A link inside untrusted mail should never navigate the CRM away from
   * itself, and `noopener` is what stops the page it opens from reaching back
   * through `window.opener`.
   */
  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    for (const a of root.querySelectorAll("a[href]")) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer nofollow");
    }

  }, [clean, showHistory]);

  if (!raw.trim()) {
    return <p className="text-[13px] text-text-muted">This message has no body.</p>;
  }

  if (!isHtml) {
    return (
      <div>
        <pre className="mail-body-text whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-text-primary">
          {text?.latest ?? raw}
        </pre>
        {text?.history && (
          <>
            <HistoryToggle open={showHistory} onToggle={() => setShowHistory((v) => !v)} />
            {showHistory && (
              <pre className="mt-2 whitespace-pre-wrap border-l-2 border-border-strong pl-3 font-sans text-[12.5px] leading-relaxed text-text-secondary">
                {text.history}
              </pre>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* overflow-x-auto is load-bearing: a rate card is a wide table, and
          without its own scroller it would push the whole page sideways. */}
      <div className="mail-body overflow-x-auto text-[13px] leading-relaxed text-text-primary">
        <div ref={ref} dangerouslySetInnerHTML={{ __html: clean?.latest ?? "" }} />
      </div>

      {clean?.history && (
        <>
          <HistoryToggle open={showHistory} onToggle={() => setShowHistory((v) => !v)} />
          {showHistory && (
            <div className="mail-body mt-2 overflow-x-auto border-l-2 border-border-strong pl-3 text-[12.5px] leading-relaxed text-text-secondary">
              <div dangerouslySetInnerHTML={{ __html: clean.history }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The line between what somebody wrote and what it quotes.
 *
 * Folded by default, and labelled so a reader knows there is more rather than
 * wondering whether the message was cut short. Nothing is hidden permanently:
 * one press brings the whole thread back.
 */
function HistoryToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
    >
      <MessagesSquare size={12} />
      {open ? "Hide earlier messages" : "Show earlier messages in this thread"}
      <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

