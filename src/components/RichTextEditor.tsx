import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline,
  Link2,
  Link2Off,
  Image as ImageIcon,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";

/**
 * A small rich-text editor, for signatures and message bodies.
 *
 * Built on contentEditable rather than a library, because what is needed is
 * narrow -- bold, italic, underline, links and images -- and email HTML has to
 * stay simple anyway. Mail clients strip stylesheets, ignore most modern CSS
 * and render a subset of tags, so a heavyweight editor producing rich markup
 * would mostly produce markup that gets thrown away in transit.
 *
 * Output is sanitised HTML suitable for sending: no scripts, no event handlers,
 * no styles beyond inline colour and simple layout.
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 180,
  autoFocus = false,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The saved selection.
   *
   * Clicking a toolbar button moves focus out of the editable area and the
   * browser drops the selection with it, so by the time a dialog is answered
   * there is nothing left to wrap in a link. The range is captured on mousedown,
   * before focus moves, and restored before the command runs.
   */
  const savedRange = useRef<Range | null>(null);

  const remember = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restore = () => {
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    ref.current?.focus();
  };

  // Only write into the DOM when the incoming value differs from what is
  // already there, otherwise every keystroke would reset the caret to the start.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const emit = () => onChange(sanitise(ref.current?.innerHTML ?? ""));

  const exec = (command: string, arg?: string) => {
    restore();
    document.execCommand(command, false, arg);
    emit();
  };

  /**
   * Wraps the selection in a link, defaulting to mailto: for an email address.
   *
   * Selecting an address and choosing "link" almost always means "make this
   * mailable" -- so that is offered as the default rather than making the user
   * type the mailto: prefix, which is the step people forget.
   */
  function addLink() {
    remember();
    const selected = savedRange.current?.toString().trim() ?? "";
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(selected);

    const suggestion = isEmail
      ? `mailto:${selected}`
      : /^https?:\/\//i.test(selected)
        ? selected
        : "https://";

    const url = window.prompt(
      isEmail
        ? `Link "${selected}" to an email address. Clicking it will start a new message.`
        : "Link address",
      suggestion
    );
    if (url === null) return;

    const trimmed = url.trim();
    if (!trimmed) return;

    /**
     * Scheme first, then bare address.
     *
     * The order matters: "mailto:someone@example.com" also satisfies a naive
     * email pattern -- "mailto:someone" is a valid local part as far as the
     * regex is concerned -- so testing for an address first produced
     * "mailto:mailto:someone@example.com" and a link that went nowhere.
     */
    const href = /^(https?:|mailto:|tel:)/i.test(trimmed)
      ? trimmed
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
        ? `mailto:${trimmed}`
        : `https://${trimmed}`;

    if (!savedRange.current || savedRange.current.collapsed) {
      // Nothing highlighted: insert the address itself as the link text.
      restore();
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${escapeAttr(href)}">${escapeHtml(trimmed)}</a>`
      );
      emit();
      return;
    }
    exec("createLink", href);
  }

  async function uploadImage(file: File) {
    setError(null);

    if (!file.type.startsWith("image/")) return setError("That file is not an image.");
    if (file.size > 2 * 1024 * 1024) return setError("Images must be under 2 MB.");

    setUploading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Not signed in.");

      // Stored under the owner's uuid: storage policy allows writes only there,
      // so nobody can overwrite another person's logo.
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${uid}/${Date.now().toString(36)}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("signatures")
        .upload(path, file, { cacheControl: "31536000", upsert: false });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from("signatures").getPublicUrl(path);

      /**
       * A public URL, not a data: URI.
       *
       * Gmail and Outlook both strip data: images, so an inlined logo would
       * look correct in this editor and be missing in every message actually
       * received. The bucket is public-read for exactly this reason: the
       * recipient's mail client is not signed into anything.
       */
      restore();
      document.execCommand(
        "insertHTML",
        false,
        `<img src="${escapeAttr(data.publicUrl)}" alt="" style="max-width:220px;height:auto" />`
      );
      emit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload the image.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-0.5 rounded-t-lg border border-border bg-surface-2 px-1.5 py-1">
        <ToolButton label="Bold" onClick={() => exec("bold")} onMouseDown={remember}>
          <Bold size={14} />
        </ToolButton>
        <ToolButton label="Italic" onClick={() => exec("italic")} onMouseDown={remember}>
          <Italic size={14} />
        </ToolButton>
        <ToolButton label="Underline" onClick={() => exec("underline")} onMouseDown={remember}>
          <Underline size={14} />
        </ToolButton>

        <span className="w-px h-4 bg-border mx-1" />

        <ToolButton label="Add link" onClick={addLink} onMouseDown={remember}>
          <Link2 size={14} />
        </ToolButton>
        <ToolButton label="Remove link" onClick={() => exec("unlink")} onMouseDown={remember}>
          <Link2Off size={14} />
        </ToolButton>

        <span className="w-px h-4 bg-border mx-1" />

        <label
          title="Insert image"
          onMouseDown={remember}
          className="h-7 w-7 grid place-items-center rounded text-text-secondary hover:bg-surface-1 hover:text-text-primary cursor-pointer"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadImage(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        onKeyUp={remember}
        onMouseUp={remember}
        data-placeholder={placeholder}
        /*
          The same face the message will be sent in.
          ------------------------------------------------------------------
          The editor showed the app's UI font and the sent mail arrived in
          Microsoft YaHei, so what was composed and what was delivered never
          quite matched — most visibly around a signature, where a line that
          fitted on screen wrapped in the recipient's client.
        */
        style={{ minHeight, fontFamily: "'Microsoft YaHei', 'Segoe UI', Arial, sans-serif" }}
        className="rich-editor w-full rounded-b-lg border border-t-0 border-border bg-surface-1 px-3 py-2.5 text-[13px] leading-relaxed text-text-primary outline-none focus:border-border-strong overflow-y-auto"
      />

      {error && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger"
        >
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  onMouseDown,
  children,
}: {
  label: string;
  onClick: () => void;
  onMouseDown: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => {
        // Prevent focus leaving the editable area, which would clear the selection
        // before the command has a chance to act on it.
        e.preventDefault();
        onMouseDown();
      }}
      onClick={onClick}
      className="h-7 w-7 grid place-items-center rounded text-text-secondary hover:bg-surface-1 hover:text-text-primary"
    >
      {children}
    </button>
  );
}

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
 */
const ALLOWED = new Set([
  "A", "B", "STRONG", "I", "EM", "U", "BR", "DIV", "P", "SPAN",
  "IMG", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "FONT",
]);

/** The presentational attributes email layout is built from; none of them runs anything. */
const CELL_ATTRS = ["style", "align", "valign", "width", "height", "colspan", "rowspan", "bgcolor"];
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "target", "rel", "style"]),
  IMG: new Set(["src", "alt", "width", "height", "style"]),
  SPAN: new Set(["style"]),
  DIV: new Set(["style"]),
  P: new Set(["style"]),
  STRONG: new Set(["style"]),
  OL: new Set(["style"]),
  UL: new Set(["style"]),
  LI: new Set(["style"]),
  TABLE: new Set(["role", "width", "cellpadding", "cellspacing", "border", "bgcolor", "align", "style"]),
  THEAD: new Set(["style"]),
  TBODY: new Set(["style"]),
  TFOOT: new Set(["style"]),
  TR: new Set(["style", "bgcolor"]),
  TD: new Set(CELL_ATTRS),
  TH: new Set(CELL_ATTRS),
  FONT: new Set(["color", "face", "size"]),
};

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
 * That is exactly how Parasu's signature ended up sending an unconstrained
 * image: not a bug in the image insert, which sets the width correctly, but a
 * sanitiser that would let anything survive as long as it was spelled "style".
 *
 * Custom properties (--anything) are dropped wholesale. They cannot affect a
 * mail client, which resolves no variables, and they are where the noise lives.
 * ---------------------------------------------------------------------------
 */
const STYLE_ALLOWED = new Set([
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-align",
  "text-decoration",
  "line-height",
  "width",
  "height",
  "max-width",
  "max-height",
  "margin",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "padding",
  "padding-top",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "border",
  "border-left",
  "border-right",
  "border-top",
  "border-bottom",
  "border-color",
  "border-radius",
  "border-collapse",
  "vertical-align",
  // What a designed mail is drawn with. url() is refused below, so a
  // background here is a colour and never a fetch.
  "background",
  "letter-spacing",
  "text-transform",
  "white-space",
  "word-break",
  "list-style-type",
  "display",
  "overflow",
]);

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
      return `${prop}:${val}`;
    })
    .filter(Boolean)
    .join(";");
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
export function sanitise(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      walk(child);

      if (!ALLOWED.has(child.tagName)) {
        // Keep the text, drop the wrapper.
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }

      const allowed = ALLOWED_ATTRS[child.tagName] ?? new Set<string>();
      for (const attr of Array.from(child.attributes)) {
        if (!allowed.has(attr.name.toLowerCase())) {
          child.removeAttribute(attr.name);
          continue;
        }
        // javascript: and data: hrefs are the two that turn a link into a payload.
        if (attr.name.toLowerCase() === "href") {
          const v = attr.value.trim().toLowerCase();
          if (!/^(https?:|mailto:|tel:|#)/.test(v)) child.removeAttribute("href");
        }
        if (attr.name.toLowerCase() === "src") {
          const v = attr.value.trim().toLowerCase();
          if (!/^https?:/.test(v)) child.removeAttribute("src");
        }
        // A colour, and nothing that could be read as anything else.
        if (attr.name.toLowerCase() === "bgcolor" && !/^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(attr.value.trim())) {
          child.removeAttribute("bgcolor");
          continue;
        }
        if (attr.name.toLowerCase() === "style") {
          const cleaned = sanitiseStyle(attr.value);
          if (cleaned) child.setAttribute("style", cleaned);
          else child.removeAttribute("style");
        }
      }

      /*
        An image in an email is constrained or it is enormous.
        --------------------------------------------------------------------
        Outlook renders a signature image at its intrinsic pixel size, so a
        600px scan of a signature arrives 600px wide however small it looked
        in the editor. The insert sets a max-width; this is the guarantee for
        everything else — pasted images, and anything whose style was just
        stripped for being junk.
      */
      if (child.tagName === "IMG") {
        const style = child.getAttribute("style") ?? "";
        if (!/max-width/i.test(style)) {
          child.setAttribute("style", `${style ? style + ";" : ""}max-width:220px;height:auto`);
        }
        // width/height attributes fight the style rule and win in some clients —
        // but Outlook sizes an image by its width attribute alone, so a small
        // one (a logo drawn at 300 from a 640px file) stays, and anything
        // larger goes.
        const w = Number(child.getAttribute("width"));
        if (!(Number.isFinite(w) && w > 0 && w <= 320)) child.removeAttribute("width");
        child.removeAttribute("height");
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

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, "&quot;");
