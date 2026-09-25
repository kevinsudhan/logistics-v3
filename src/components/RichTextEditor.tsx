import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bold,
  Eraser,
  Image as ImageIcon,
  Indent,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Outdent,
  Redo2,
  Strikethrough,
  Subscript,
  Superscript,
  Table as TableIcon,
  Underline,
  Undo2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { inlineForeign, sanitise } from "../lib/mailHtml";
import { MAIL_COLOR, MAIL_FONT, MAIL_IMAGE_MAX, MAIL_SIZE, MAIL_SIZE_PT, fontChoiceFor, fontName, ptFromPx, stepSize } from "../lib/mailStyle";
import { AlignMenu, ColorMenu, Divider, FontMenu, LinkMenu, SizeMenu, TableMenu, ToolButton } from "./editor/EditorMenus";

/**
 * The mail editor: Outlook's formatting, on a page that is the mail.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES (25 Sep 2026)
 *
 * Font and size, bold, italic, underline, strike-through, sub- and
 * superscript, font colour and highlight, bullets and numbering, indent,
 * alignment, links, pictures, tables and a rule, clear formatting, undo and
 * redo — with Outlook's shortcuts (Ctrl+B/I/U, Ctrl+K, Ctrl+] and Ctrl+[,
 * Ctrl+Shift+L, Ctrl+Space, Tab in a list or a table).
 *
 * WHAT YOU SEE IS WHAT THEY GET
 *
 * The page is white and set in the desk's mail font, size and colour
 * (lib/mailStyle.ts) — the very values the send wraps the body in — in light
 * and dark mode alike. Every button writes inline HTML Outlook keeps: <b>,
 * <font face>, a size in points, a colour, a background colour for highlight.
 * A paste out of Word, Excel or Outlook keeps its look (its stylesheet is
 * folded into the text, lib/mailHtml.ts), and a pasted or dropped picture is
 * uploaded rather than left as a data: image, which Outlook throws away.
 *
 * WHY contentEditable AND NOT AN EDITOR LIBRARY
 *
 * Designed mails — the quotation, the booking confirmation — are table
 * layouts that open here to be written into. Schema-based editors rebuild
 * whatever they are given into their own document model, and a layout table
 * does not survive that. The browser's own editing keeps any HTML it is given
 * and has undo built in; this adds the toolbar and the care around it.
 * ---------------------------------------------------------------------------
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 180,
  autoFocus = false,
  imageMax = MAIL_IMAGE_MAX,
  keepCid = false,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  autoFocus?: boolean;
  /** The widest a picture is drawn: 220 in a signature, a reading pane's width in a mail. */
  imageMax?: number;
  /** Keep cid: pictures — a forward carries the original's attachments with it. */
  keepCid?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [state, setState] = useState<Fmt>(EMPTY);
  const [lastColor, setLastColor] = useState("#c00000");
  const [lastHighlight, setLastHighlight] = useState("#ffff00");
  const opts = { imageMax, keepCid };
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // --- keeping the page and the value in step --------------------------------

  /**
   * What this editor last handed out. The DOM is only rewritten when the value
   * coming in is something else (a drafted reply, a template): rewriting it
   * with its own cleaned copy would throw the caret to the start on every
   * keystroke, and the cleaner rewrites style text (colours especially), so
   * "is it different" was true after any formatting at all.
   */
  const lastEmitted = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const html = sanitise(ref.current?.innerHTML ?? "", optsRef.current);
    lastEmitted.current = html;
    onChangeRef.current(html);
  }, []);
  // Cleaning a long quoted thread on every keystroke is wasted work: once typing pauses.
  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 150);
  }, [flush]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const el = ref.current;
    if (!el || value === lastEmitted.current) return;
    const clean = sanitise(value, optsRef.current);
    el.innerHTML = clean;
    lastEmitted.current = clean;
    if (clean !== value) onChangeRef.current(clean);
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // --- the selection -----------------------------------------------------------

  /**
   * Clicking into a menu field (a link address, a colour) moves focus out of
   * the page and the browser drops the selection with it. The range is kept
   * as the selection moves, and put back before any command runs.
   */
  const savedRange = useRef<Range | null>(null);
  const inside = (n: Node | null) => !!n && !!ref.current?.contains(n);

  const restore = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel && inside(savedRange.current.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const refresh = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !inside(sel.anchorNode)) return;
    savedRange.current = sel.getRangeAt(0).cloneRange();
    const node = sel.anchorNode;
    const el = (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement) as HTMLElement | null;
    const cs = el ? getComputedStyle(el) : null;
    const q = (c: string) => {
      try {
        return document.queryCommandState(c);
      } catch {
        return false;
      }
    };
    const family = cs?.fontFamily ?? MAIL_FONT;
    setState({
      bold: q("bold"),
      italic: q("italic"),
      underline: q("underline"),
      strike: q("strikeThrough"),
      sub: q("subscript"),
      sup: q("superscript"),
      ul: q("insertUnorderedList"),
      ol: q("insertOrderedList"),
      align: q("justifyCenter") ? "justifyCenter" : q("justifyRight") ? "justifyRight" : q("justifyFull") ? "justifyFull" : "justifyLeft",
      font: fontChoiceFor(family)?.label ?? fontName(family),
      size: cs ? ptFromPx(parseFloat(cs.fontSize)) : MAIL_SIZE_PT,
      link: el?.closest("a") && inside(el.closest("a")) ? (el.closest("a") as HTMLAnchorElement) : null,
      cell: el?.closest("td, th") && inside(el.closest("td, th")) ? (el.closest("td, th") as HTMLTableCellElement) : null,
      selectedText: sel.toString(),
    });
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", refresh);
    return () => document.removeEventListener("selectionchange", refresh);
  }, [refresh]);

  // --- commands ------------------------------------------------------------------

  /**
   * One command, run where the selection was. Tags for bold and the like
   * (<b>, <i>, <u>, <strike>), which every client keeps; styles only where
   * there is no tag for it.
   */
  const run = (command: string, arg?: string, withCss = false) => {
    restore();
    document.execCommand("styleWithCSS", false, withCss ? "true" : "false");
    document.execCommand(command, false, arg);
    document.execCommand("styleWithCSS", false, "false");
    setMenu(null);
    refresh();
    schedule();
  };

  /** Inside a new <font> just made for the selection, an older setting of the same thing gives way. */
  const giveWay = (selector: string, prop: "fontFamily" | "fontSize" | "color", attr: string) => {
    const sel = window.getSelection();
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    ref.current?.querySelectorAll<HTMLElement>(selector).forEach((f) => {
      if (range && !range.intersectsNode(f)) return;
      f.querySelectorAll<HTMLElement>("*").forEach((d) => {
        if (d.style[prop]) d.style[prop] = "";
        if (d.tagName === "FONT") d.removeAttribute(attr);
      });
    });
  };

  const setFont = (css: string) => {
    run("fontName", css);
    giveWay(`font[face="${css.replace(/"/g, '\\"')}"]`, "fontFamily", "face");
    schedule();
  };

  /**
   * A size in points. The browser only knows HTML's seven sizes, so size 7 is
   * asked for and every <font size="7"> it makes is turned straight into the
   * size chosen. With nothing selected the browser makes that <font> on the
   * next keystroke instead, which is why `pendingSize` is kept for onInput.
   */
  const pendingSize = useRef<number | null>(null);
  const settleSizes = () => {
    const pt = pendingSize.current;
    if (!pt || !ref.current) return;
    ref.current.querySelectorAll<HTMLElement>('font[size="7"]').forEach((f) => {
      f.removeAttribute("size");
      f.style.fontSize = `${pt}pt`;
      f.querySelectorAll<HTMLElement>("*").forEach((d) => {
        if (d.style.fontSize) d.style.fontSize = "";
        if (d.tagName === "FONT") d.removeAttribute("size");
      });
    });
  };
  const setSize = (pt: number) => {
    pendingSize.current = pt;
    run("fontSize", "7");
    settleSizes();
    refresh();
    schedule();
  };

  const setColor = (hex: string | null) => {
    if (hex) setLastColor(hex);
    run("foreColor", hex ?? MAIL_COLOR);
    giveWay(`font[color="${hex ?? MAIL_COLOR}"]`, "color", "color");
    schedule();
  };

  const setHighlight = (hex: string | null) => {
    if (hex) setLastHighlight(hex);
    run("hiliteColor", hex ?? "transparent", true);
  };

  const clearFormatting = () => {
    run("removeFormat");
    run("unlink");
  };

  // --- links -----------------------------------------------------------------------

  /** Scheme first, then a bare address: "mailto:x@y" also looks like an address. */
  const toHref = (s: string) =>
    /^(https?:|mailto:|tel:)/i.test(s) ? s : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? `mailto:${s}` : `https://${s}`;

  const suggestedHref = () => {
    if (state.link) return state.link.getAttribute("href") ?? "";
    const t = state.selectedText.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? `mailto:${t}` : /^https?:\/\//i.test(t) ? t : "";
  };

  const applyLink = (raw: string, text: string) => {
    const href = toHref(raw);
    if (state.link) {
      state.link.setAttribute("href", href);
      setMenu(null);
      schedule();
      return;
    }
    if (!savedRange.current || savedRange.current.collapsed) {
      restore();
      document.execCommand("insertHTML", false, `<a href="${escapeAttr(href)}">${escapeHtml(text || raw)}</a>&nbsp;`);
      setMenu(null);
      schedule();
      return;
    }
    run("createLink", href);
  };

  const removeLink = () => {
    const a = state.link;
    if (a) {
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(a);
      sel?.removeAllRanges();
      sel?.addRange(r);
      savedRange.current = r.cloneRange();
    }
    run("unlink");
  };

  // --- pictures --------------------------------------------------------------------

  /**
   * Uploaded to the public bucket and shown by its address; at send it is
   * carried inside the message (graphMail, `outgoing`), so Outlook shows it
   * without "download pictures". A data: image would look right here and be
   * missing from every copy received.
   */
  async function uploadImages(files: File[]) {
    setError(null);
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return setError("Only pictures go into the text. Attach other files with the paperclip below.");
    const big = images.find((f) => f.size > 4 * 1024 * 1024);
    if (big) return setError(`${big.name || "That picture"} is over 4 MB. Make it smaller first.`);

    setUploading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Not signed in.");
      const html: string[] = [];
      for (const file of images) {
        // Stored under the owner's uuid: the storage policy allows writes only there.
        const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
        const path = `${uid}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("signatures").upload(path, file, { cacheControl: "31536000", upsert: false, contentType: file.type });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from("signatures").getPublicUrl(path);
        const natural = await naturalWidth(file);
        // The width as an attribute: the one thing Outlook sizes a picture by.
        const width = natural ? Math.min(natural, imageMax) : imageMax;
        html.push(`<img src="${escapeAttr(data.publicUrl)}" alt="" width="${width}" style="max-width:${imageMax}px;height:auto">`);
      }
      restore();
      document.execCommand("insertHTML", false, html.join("&nbsp;"));
      schedule();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload the picture.");
    } finally {
      setUploading(false);
    }
  }

  // --- tables ----------------------------------------------------------------------

  /**
   * A plain grid: each cell draws its right and bottom line, the first row and
   * column their top and left, so every line is single without relying on
   * border-collapse (which the browser's own insert strips).
   */
  const insertTable = (rows: number, cols: number) => {
    const line = "1px solid #a6a6a6";
    const cell = (r: number, c: number) =>
      `<td style="border-right:${line};border-bottom:${line};${r === 0 ? `border-top:${line};` : ""}${c === 0 ? `border-left:${line};` : ""}padding:4px 8px;min-width:64px;vertical-align:top"><br></td>`;
    const body = Array.from({ length: rows }, (_, r) => `<tr>${Array.from({ length: cols }, (_, c) => cell(r, c)).join("")}</tr>`).join("");
    run("insertHTML", `<table cellpadding="0" cellspacing="0"><tbody>${body}</tbody></table><div><br></div>`);
  };

  const tableOp = (op: "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "delRow" | "delCol" | "delTable") => {
    const cell = state.cell;
    const table = cell?.closest("table");
    if (!cell || !table) return;
    const row = cell.parentElement as HTMLTableRowElement;
    const idx = cell.cellIndex;
    const blank = (c: Element) => {
      c.innerHTML = "<br>";
      return c;
    };
    if (op === "rowAbove" || op === "rowBelow") {
      const fresh = row.cloneNode(true) as HTMLTableRowElement;
      Array.from(fresh.cells).forEach(blank);
      row.parentElement!.insertBefore(fresh, op === "rowAbove" ? row : row.nextSibling);
    } else if (op === "colLeft" || op === "colRight") {
      for (const r of Array.from(table.rows)) {
        const at = r.cells[Math.min(idx, r.cells.length - 1)];
        if (!at) continue;
        r.insertBefore(blank(at.cloneNode(false) as Element), op === "colLeft" ? at : at.nextSibling);
      }
    } else if (op === "delRow") {
      row.remove();
      if (!table.rows.length) table.remove();
    } else if (op === "delCol") {
      for (const r of Array.from(table.rows)) r.cells[idx]?.remove();
      if (!Array.from(table.rows).some((r) => r.cells.length)) table.remove();
    } else {
      table.remove();
    }
    ref.current?.focus();
    refresh();
    schedule();
  };

  /** Tab moves to the next cell, adding a row at the end, as in Outlook. */
  const nextCell = (back: boolean) => {
    const cell = state.cell;
    const table = cell?.closest("table");
    if (!cell || !table) return false;
    const cells = Array.from(table.querySelectorAll("td, th")).filter((c) => c.closest("table") === table);
    let i = cells.indexOf(cell) + (back ? -1 : 1);
    if (i >= cells.length && !back) {
      tableOp("rowBelow");
      i = cells.length;
    }
    const target = Array.from(table.querySelectorAll("td, th")).filter((c) => c.closest("table") === table)[i];
    if (!target) return true;
    const r = document.createRange();
    r.selectNodeContents(target);
    r.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    return true;
  };

  // --- keys, paste, drop ---------------------------------------------------------------

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      refresh();
      setMenu("link");
    } else if (mod && (e.key === "]" || (e.shiftKey && e.key === ">"))) {
      e.preventDefault();
      setSize(stepSize(state.size ?? MAIL_SIZE_PT, 1));
    } else if (mod && (e.key === "[" || (e.shiftKey && e.key === "<"))) {
      e.preventDefault();
      setSize(stepSize(state.size ?? MAIL_SIZE_PT, -1));
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      run("insertUnorderedList");
    } else if (mod && e.key === " ") {
      e.preventDefault();
      clearFormatting();
    } else if (e.key === "Tab") {
      if (state.cell) {
        e.preventDefault();
        nextCell(e.shiftKey);
      } else if (state.ul || state.ol) {
        e.preventDefault();
        run(e.shiftKey ? "outdent" : "indent");
      } else if (!e.shiftKey) {
        e.preventDefault();
        document.execCommand("insertText", false, "    ");
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const data = e.clipboardData;
    const html = data.getData("text/html");
    const files = Array.from(data.files ?? []).filter((f) => f.type.startsWith("image/"));
    // A picture on its own (a screenshot), or a paste whose HTML is only a picture that cannot travel.
    const onlyPicture = !html || !new DOMParser().parseFromString(html, "text/html").body.textContent?.trim();
    if (files.length && onlyPicture) {
      e.preventDefault();
      void uploadImages(files);
      return;
    }
    if (html) {
      e.preventDefault();
      const clean = sanitise(inlineForeign(html), optsRef.current);
      document.execCommand("insertHTML", false, clean);
      schedule();
    }
    // Plain text: the browser's own paste keeps the lines.
  };

  const onDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    // Put the caret where the files were dropped.
    const pos = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(e.clientX, e.clientY);
    if (pos) savedRange.current = pos;
    void uploadImages(files);
  };

  const onInput = () => {
    settleSizes();
    schedule();
  };

  // --- the page ------------------------------------------------------------------------

  const open = (name: string) => () => {
    refresh();
    setMenu(name);
  };
  const close = useCallback(() => setMenu(null), []);

  return (
    <div className="rounded-lg border border-border">
      <div
        className="sticky top-0 z-20 flex flex-wrap items-center gap-0.5 rounded-t-lg border-b border-border bg-surface-2 px-1.5 py-1"
        role="toolbar"
        aria-label="Formatting"
      >
        <ToolButton label="Undo (Ctrl+Z)" onClick={() => run("undo")}>
          <Undo2 size={14} />
        </ToolButton>
        <ToolButton label="Redo (Ctrl+Y)" onClick={() => run("redo")}>
          <Redo2 size={14} />
        </ToolButton>
        <Divider />
        <FontMenu current={state.font} open={menu === "font"} onOpen={open("font")} onClose={close} onPick={setFont} />
        <SizeMenu current={state.size} open={menu === "size"} onOpen={open("size")} onClose={close} onPick={setSize} />
        <Divider />
        <ToolButton label="Bold (Ctrl+B)" active={state.bold} onClick={() => run("bold")}>
          <Bold size={14} />
        </ToolButton>
        <ToolButton label="Italic (Ctrl+I)" active={state.italic} onClick={() => run("italic")}>
          <Italic size={14} />
        </ToolButton>
        <ToolButton label="Underline (Ctrl+U)" active={state.underline} onClick={() => run("underline")}>
          <Underline size={14} />
        </ToolButton>
        <ToolButton label="Strikethrough" active={state.strike} onClick={() => run("strikeThrough")}>
          <Strikethrough size={14} />
        </ToolButton>
        <ToolButton label="Subscript" active={state.sub} onClick={() => run("subscript")}>
          <Subscript size={14} />
        </ToolButton>
        <ToolButton label="Superscript" active={state.sup} onClick={() => run("superscript")}>
          <Superscript size={14} />
        </ToolButton>
        <Divider />
        <ColorMenu
          kind="highlight"
          open={menu === "highlight"}
          onOpen={open("highlight")}
          onClose={close}
          onPick={setHighlight}
          last={lastHighlight}
          onRemember={refresh}
        />
        <ColorMenu kind="text" open={menu === "color"} onOpen={open("color")} onClose={close} onPick={setColor} last={lastColor} onRemember={refresh} />
        <Divider />
        <ToolButton label="Bullets (Ctrl+Shift+L)" active={state.ul} onClick={() => run("insertUnorderedList")}>
          <List size={14} />
        </ToolButton>
        <ToolButton label="Numbering" active={state.ol} onClick={() => run("insertOrderedList")}>
          <ListOrdered size={14} />
        </ToolButton>
        <ToolButton label="Decrease indent" onClick={() => run("outdent")}>
          <Outdent size={14} />
        </ToolButton>
        <ToolButton label="Increase indent" onClick={() => run("indent")}>
          <Indent size={14} />
        </ToolButton>
        <AlignMenu current={state.align} open={menu === "align"} onOpen={open("align")} onClose={close} onPick={(c) => run(c)} />
        <Divider />
        <LinkMenu
          open={menu === "link"}
          onOpen={open("link")}
          onClose={close}
          selectedText={state.selectedText}
          initialHref={menu === "link" ? suggestedHref() : ""}
          onApply={applyLink}
          onRemove={state.link ? removeLink : null}
          icon={<Link2 size={14} />}
        />
        <label
          title="Insert picture"
          onMouseDown={(e) => e.preventDefault()}
          className="h-7 w-7 grid place-items-center rounded text-text-secondary hover:bg-surface-1 hover:text-text-primary cursor-pointer"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = Array.from(e.target.files ?? []);
              if (f.length) void uploadImages(f);
              e.target.value = "";
            }}
          />
        </label>
        <TableMenu open={menu === "table"} onOpen={open("table")} onClose={close} onPick={insertTable} icon={<TableIcon size={14} />} />
        <ToolButton label="Horizontal line" onClick={() => run("insertHorizontalRule")}>
          <Minus size={14} />
        </ToolButton>
        <Divider />
        <ToolButton label="Clear formatting (Ctrl+Space)" onClick={clearFormatting}>
          <Eraser size={14} />
        </ToolButton>

        {/* Only while the caret is in a table: what can be done to it. */}
        {state.cell && (
          <div className="flex w-full flex-wrap items-center gap-1 border-t border-border pt-1 text-[11px]">
            <span className="px-1 text-text-muted">Table</span>
            {(
              [
                ["rowAbove", "Row above"],
                ["rowBelow", "Row below"],
                ["colLeft", "Column left"],
                ["colRight", "Column right"],
                ["delRow", "Delete row"],
                ["delCol", "Delete column"],
                ["delTable", "Delete table"],
              ] as const
            ).map(([op, label]) => (
              <button
                key={op}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => tableOp(op)}
                className={`h-6 rounded px-1.5 hover:bg-surface-1 ${op.startsWith("del") ? "text-text-danger" : "text-text-secondary hover:text-text-primary"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onInput={onInput}
        onBlur={flush}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDrop={onDrop}
        onFocus={() => {
          document.execCommand("defaultParagraphSeparator", false, "div");
          document.execCommand("styleWithCSS", false, "false");
        }}
        data-placeholder={placeholder}
        // The page the recipient gets: the mail's own font, size, colour and
        // white paper, whatever the app's theme.
        style={{ minHeight, fontFamily: MAIL_FONT, fontSize: MAIL_SIZE, color: MAIL_COLOR, background: "#ffffff", lineHeight: "normal", colorScheme: "light" }}
        className="rich-editor w-full rounded-b-lg px-4 py-3 outline-none overflow-x-auto"
      />

      {error && (
        <div role="alert" className="m-2 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-[11px] underline">
            OK
          </button>
        </div>
      )}
    </div>
  );
}

interface Fmt {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  sub: boolean;
  sup: boolean;
  ul: boolean;
  ol: boolean;
  align: string;
  font: string;
  size: number | null;
  link: HTMLAnchorElement | null;
  cell: HTMLTableCellElement | null;
  selectedText: string;
}

const EMPTY: Fmt = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  sub: false,
  sup: false,
  ul: false,
  ol: false,
  align: "justifyLeft",
  font: "Microsoft YaHei",
  size: MAIL_SIZE_PT,
  link: null,
  cell: null,
  selectedText: "",
};

/** A picture's own width in pixels, or null if it cannot be read. */
async function naturalWidth(file: File): Promise<number | null> {
  try {
    const bmp = await createImageBitmap(file);
    const w = bmp.width;
    bmp.close();
    return w;
  } catch {
    return null;
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, "&quot;");
