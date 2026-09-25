/**
 * Mail HTML: what may travel, how pasted and quoted mail keeps its look, and
 * the last touches that make Outlook draw a message as the CRM showed it.
 *
 * Browser-only (DOMParser, CSSStyleSheet). Moved out of RichTextEditor on
 * 25 Sep 2026, when the editor gained the full formatting toolbar.
 */
import { HTML_FONT_SIZE_PT, LINK_COLOR, MAIL_COLOR, MAIL_FONT, MAIL_SIZE } from "./mailStyle";

// ---------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------

/**
 * Tags a mail client will actually render. Everything else is unwrapped.
 *
 * The table parts are all here — head, foot and header cells too — because a
 * designed mail (the quotation) is laid out in tables, and it opens in this
 * editor to be written into. Unwrapping a <th> the moment somebody typed in
 * the covering note collapsed the whole quotation into loose text.
 *
 * Strike-through, sub/superscript, quotes, rules and headings joined on 25 Sep
 * with the toolbar that makes them; before that the cleaner quietly dropped
 * them, and with them the rule and indented block of every quoted reply.
 */
const ALLOWED = new Set([
  "A", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL", "SUB", "SUP", "BR", "DIV", "P", "SPAN",
  "IMG", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "FONT",
  "BLOCKQUOTE", "HR", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "CODE", "CAPTION",
]);

/** Gone with everything inside them: their text is not the message. */
const DROP = new Set(["SCRIPT", "STYLE", "TITLE", "HEAD", "META", "LINK", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "XML", "BASE", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA"]);

/** The presentational attributes email layout is built from; none of them runs anything. */
const CELL_ATTRS = ["style", "align", "valign", "width", "height", "colspan", "rowspan", "bgcolor", "nowrap"];
const STYLED = ["style"];
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "target", "rel", "style", "title"]),
  IMG: new Set(["src", "alt", "width", "height", "style", "align"]),
  TABLE: new Set(["role", "width", "cellpadding", "cellspacing", "border", "bgcolor", "align", "style"]),
  TR: new Set(["style", "bgcolor", "align", "valign"]),
  TD: new Set(CELL_ATTRS),
  TH: new Set(CELL_ATTRS),
  FONT: new Set(["color", "face", "style"]),
  HR: new Set(["style", "size", "width", "align", "color"]),
  DIV: new Set(["style", "align"]),
  P: new Set(["style", "align"]),
  OL: new Set(["style", "type", "start"]),
  UL: new Set(["style", "type"]),
};
for (const t of ["SPAN", "STRONG", "B", "I", "EM", "U", "S", "STRIKE", "DEL", "SUB", "SUP", "LI", "THEAD", "TBODY", "TFOOT", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "CODE", "CAPTION"]) {
  ALLOWED_ATTRS[t] ??= new Set(STYLED);
}

/**
 * Declarations that mean something in an email, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * WHY THE STYLE ATTRIBUTE HAS TO BE READ, NOT JUST ALLOWED
 *
 * The sanitiser whitelisted `style` by NAME and never looked inside it. So a
 * paste out of any Tailwind-styled page carried the whole `--tw-*` custom
 * property block — two hundred declarations of nothing — straight through, and
 * because a pasted style REPLACES the attribute, it took the
 * `max-width:220px` off the signature image with it.
 *
 * Custom properties (--anything) are dropped wholesale. They cannot affect a
 * mail client, which resolves no variables, and they are where the noise lives.
 * ---------------------------------------------------------------------------
 */
const STYLE_ALLOWED = new Set([
  "color", "background-color", "font-family", "font-size", "font-weight", "font-style", "font-variant",
  "text-align", "text-decoration", "text-decoration-line", "text-indent", "line-height", "vertical-align",
  "width", "height", "min-width", "max-width", "max-height",
  "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
  "padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
  "border", "border-left", "border-right", "border-top", "border-bottom", "border-color", "border-width", "border-style",
  "border-radius", "border-collapse", "border-spacing", "table-layout",
  // What a designed mail is drawn with. url() is refused below, so a
  // background here is a colour and never a fetch.
  "background", "letter-spacing", "text-transform", "white-space", "word-break",
  "list-style-type", "display", "overflow",
]);

/** Values that say "nothing": a highlight taken off, a colour left to the parent. */
const EMPTY_VALUE = /^(transparent|initial|inherit|unset|none|rgba\(0,\s*0,\s*0,\s*0\))$/i;

export function sanitiseStyle(value: string): string {
  return value
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const at = d.indexOf(":");
      if (at < 0) return null;
      const prop = d.slice(0, at).trim().toLowerCase();
      const val = d.slice(at + 1).trim();
      if (!val || prop.startsWith("--")) return null;
      if (!STYLE_ALLOWED.has(prop)) return null;
      // A url() in a style is a fetch the recipient's client would make.
      if (/url\s*\(|expression\s*\(|javascript:/i.test(val)) return null;
      if ((prop === "background-color" || prop === "background" || prop === "color") && EMPTY_VALUE.test(val)) return null;
      return `${prop}:${val}`;
    })
    .filter(Boolean)
    .join(";");
}

export interface SanitiseOptions {
  /**
   * The widest an image may be drawn, in pixels: 220 in a signature, the
   * reading-pane width in a message. Outlook sizes an image by its width
   * attribute alone, so this is written as one.
   */
  imageMax?: number;
  /** Keep cid: images (a forward carries the original's attachments with it). */
  keepCid?: boolean;
}

/**
 * Strips anything that should not travel in an email.
 *
 * This output is stored and later sent to other people, so it is treated as
 * untrusted regardless of who typed it: script tags, event handlers and
 * javascript: URLs all come out. contentEditable also accumulates a lot of
 * browser-specific markup when content is pasted in from elsewhere, and most
 * of it would be discarded by the receiving client anyway.
 */
export function sanitise(html: string, opts: SanitiseOptions = {}): string {
  const imageMax = opts.imageMax ?? 220;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  stripComments(doc.body);
  normaliseLegacy(doc.body);

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (DROP.has(child.tagName) || child.tagName.includes(":")) {
        // <o:p> and friends from Word are empty; anything else namespaced is not mail.
        if (child.tagName.includes(":") && !DROP.has(child.tagName)) child.replaceWith(...Array.from(child.childNodes));
        else child.remove();
        continue;
      }
      walk(child);

      if (!ALLOWED.has(child.tagName)) {
        // Keep the text, drop the wrapper.
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }

      const allowed = ALLOWED_ATTRS[child.tagName] ?? new Set<string>();
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (!allowed.has(name)) {
          child.removeAttribute(attr.name);
          continue;
        }
        // javascript: and data: hrefs are the two that turn a link into a payload.
        if (name === "href") {
          const v = attr.value.trim().toLowerCase();
          if (!/^(https?:|mailto:|tel:|#)/.test(v)) child.removeAttribute("href");
        }
        if (name === "src") {
          const v = attr.value.trim().toLowerCase();
          if (!(/^https?:/.test(v) || (opts.keepCid && v.startsWith("cid:")))) child.removeAttribute("src");
        }
        // A colour, and nothing that could be read as anything else.
        if ((name === "bgcolor" || name === "color") && !/^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(attr.value.trim())) {
          child.removeAttribute(attr.name);
          continue;
        }
        if (name === "style") {
          const cleaned = sanitiseStyle(attr.value);
          if (cleaned) child.setAttribute("style", cleaned);
          else child.removeAttribute("style");
        }
      }

      if (/border/i.test(child.getAttribute("style") ?? "")) sideBorders(child as HTMLElement);

      // Outlook writes a list flush with the lines around it; a browser adds a line above and below.
      if (child.tagName === "UL" || child.tagName === "OL") {
        const st = (child as HTMLElement).style;
        if (!st.marginTop) st.marginTop = "0";
        if (!st.marginBottom) st.marginBottom = "0";
      }

      if (child.tagName === "IMG") {
        // A picture whose address could not travel (data:, file:, a reply's cid:) would arrive as an empty box.
        if (!child.getAttribute("src")) {
          child.remove();
          continue;
        }
        sizeImage(child as HTMLImageElement, imageMax);
      }

      // Links leaving in an email should not hand the opener a window reference.
      if (child.tagName === "A" && child.getAttribute("href")) {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
    }
  };

  walk(doc.body);
  return doc.body.innerHTML;
}

/**
 * An image in an email is constrained or it is enormous.
 *
 * Outlook renders an image at its width attribute, or at its pixel size when
 * there is none — max-width means nothing to it. So a width the style states
 * becomes the attribute, capped at `max`; a larger attribute is brought down;
 * and max-width stays for every other client. An image with no width at all is
 * measured at send (graphMail, `outgoing`).
 */
function sizeImage(img: HTMLImageElement, imageMax: number) {
  const style = img.getAttribute("style") ?? "";
  const styled = style.match(/(?:^|;)\s*width\s*:\s*([\d.]+)px/i);
  // An image that already says it is narrower (a signature logo at 220)
  // keeps that when it lands in a message.
  const ownMax = style.match(/max-width\s*:\s*([\d.]+)px/i);
  const max = Math.min(imageMax, ownMax ? Number(ownMax[1]) : Infinity);
  let w = Number(img.getAttribute("width"));
  if (!(Number.isFinite(w) && w > 0) && styled) w = Number(styled[1]);
  if (Number.isFinite(w) && w > 0) img.setAttribute("width", String(Math.round(Math.min(w, max))));
  else img.removeAttribute("width");
  // The height follows the width; a fixed one would stretch it.
  img.removeAttribute("height");
  const rest = style
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && !/^(max-width|width|height)\s*:/i.test(d));
  img.setAttribute("style", [...rest, `max-width:${max}px`, "height:auto"].join(";"));
}

/**
 * Borders as four per-side declarations (border-top: 1px solid #a6a6a6 …).
 *
 * Chrome's own insert — the paste, a new table — rewrites a `border`
 * shorthand into width and colour and loses the line style, so a pasted Excel
 * table arrived with no lines at all. Per-side shorthands it keeps as written,
 * and so does every mail client.
 */
const EDGE_PROPS = ["border", "border-width", "border-style", "border-color", "border-image",
  ...["top", "right", "bottom", "left"].flatMap((side) => [`border-${side}`, `border-${side}-width`, `border-${side}-style`, `border-${side}-color`])];

function sideBorders(el: HTMLElement) {
  const st = el.style;
  const sides: string[] = [];
  for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
    const style = st[`border${side}Style`];
    if (!style) continue;
    const name = `border-${side.toLowerCase()}`;
    if (style === "none" || style === "hidden") {
      sides.push(`${name}:none`);
      continue;
    }
    sides.push(`${name}:${st[`border${side}Width`] || "1px"} ${style} ${st[`border${side}Color`] || "currentcolor"}`);
  }
  if (!sides.length) return;
  EDGE_PROPS.forEach((p) => st.removeProperty(p));
  el.setAttribute("style", [st.cssText.replace(/;\s*$/, ""), ...sides].filter(Boolean).join(";"));
}

function stripComments(root: Node) {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const dead: Node[] = [];
  while (walker.nextNode()) dead.push(walker.currentNode);
  dead.forEach((n) => n.parentNode?.removeChild(n));
}

/**
 * Old markup into what the toolbar writes: <font size="1…7"> into a size in
 * points, <center> into a centred block, <strike> and <del> into <s>.
 */
function normaliseLegacy(root: HTMLElement) {
  const doc = root.ownerDocument;
  root.querySelectorAll("font[size]").forEach((f) => {
    const pt = HTML_FONT_SIZE_PT[(f.getAttribute("size") ?? "").trim()];
    f.removeAttribute("size");
    if (pt) (f as HTMLElement).style.fontSize = `${pt}pt`;
  });
  root.querySelectorAll("center").forEach((c) => {
    const div = doc.createElement("div");
    div.style.textAlign = "center";
    div.append(...Array.from(c.childNodes));
    c.replaceWith(div);
  });
}

// ---------------------------------------------------------------------------
// Pasted and quoted mail
// ---------------------------------------------------------------------------

/**
 * HTML from somewhere else — a paste out of Word, Excel or Outlook, or the
 * body of a message being answered — with its stylesheet folded into the
 * elements, ready for `sanitise`.
 *
 * Those sources style by class: Excel's cell borders live in `.xl65 {…}`,
 * Outlook's paragraph spacing in `p.MsoNormal {…}`. The cleaner drops classes
 * (no mail client keeps them), so without this a pasted rate table arrived
 * with no borders and a quoted Outlook mail lost its font. Each rule is
 * applied to what it matches, in order, under the element's own style.
 */
export function inlineForeign(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const css = Array.from(doc.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
  if (css.trim()) {
    const decls = new Map<Element, string[]>();
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css.replace(/<!--|-->/g, ""));
      for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSStyleRule)) continue;
        let hits: Element[] = [];
        try {
          hits = Array.from(doc.body.querySelectorAll(rule.selectorText));
        } catch {
          continue; // a selector this browser does not know (Word has a few)
        }
        const text = rule.style.cssText;
        if (!text) continue;
        for (const el of hits) {
          const list = decls.get(el) ?? [];
          list.push(text);
          decls.set(el, list);
        }
      }
    } catch {
      /* unparseable: the inline styles alone will have to do */
    }
    decls.forEach((list, el) => {
      const own = el.getAttribute("style") ?? "";
      el.setAttribute("style", [...list, own].filter(Boolean).join(";"));
    });
  }
  doc.querySelectorAll("style, head, title, meta, link, xml").forEach((n) => n.remove());
  stripComments(doc.body);
  return doc.body.innerHTML;
}

// ---------------------------------------------------------------------------
// On the way out
// ---------------------------------------------------------------------------

/**
 * The body as it leaves, with what Outlook will not inherit written in.
 *
 * Outlook draws mail with Word, and Word does not pass a font down into a
 * table: a table under a div set in Microsoft YaHei 10.5pt comes out in Times
 * New Roman 12pt, however it looked in the CRM. So every cell and heading gets
 * the face, size and colour it inherits, stated on itself. And a link gets its
 * colour written in, so it is Outlook's blue everywhere rather than each
 * reader's own.
 */
export function forOutlook(html: string, base = { font: MAIL_FONT, size: MAIL_SIZE, color: MAIL_COLOR }): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  const inherited = (el: Element, prop: "fontFamily" | "fontSize" | "color") => {
    for (let p: Element | null = el.parentElement; p && p !== doc.body; p = p.parentElement) {
      const v = (p as HTMLElement).style?.[prop];
      if (v) return v;
      if (p.tagName === "FONT") {
        if (prop === "fontFamily" && p.getAttribute("face")) return p.getAttribute("face")!;
        if (prop === "color" && p.getAttribute("color")) return p.getAttribute("color")!;
      }
    }
    return prop === "fontFamily" ? base.font : prop === "fontSize" ? base.size : base.color;
  };

  doc.body.querySelectorAll("td, th, caption, h1, h2, h3, h4, h5, h6").forEach((el) => {
    const s = (el as HTMLElement).style;
    if (!s.fontFamily) s.fontFamily = inherited(el, "fontFamily");
    // A heading keeps its own size: that is what makes it one.
    if (!/^H\d$/.test(el.tagName) && !s.fontSize) s.fontSize = inherited(el, "fontSize");
    if (!s.color) s.color = inherited(el, "color");
  });

  doc.body.querySelectorAll("a[href]").forEach((a) => {
    const s = (a as HTMLElement).style;
    // A colour chosen for the text around the link is the author's; leave it.
    let coloured = false;
    for (let p: Element | null = a.parentElement; p && p !== doc.body; p = p.parentElement) {
      if ((p as HTMLElement).style?.color || (p.tagName === "FONT" && p.getAttribute("color"))) coloured = true;
    }
    if (!s.color && !coloured) s.color = LINK_COLOR;
  });
  return doc.body.innerHTML;
}
