/**
 * How a mail written in the CRM looks: the page, the fonts, the sizes and the
 * colours on offer (25 Sep 2026).
 *
 * ---------------------------------------------------------------------------
 * ONE SOURCE, TWO USES
 *
 * The compose window draws its page from these values, and the send wraps the
 * body in exactly the same ones (services/graphMail.ts, asOutgoingHtml). That
 * is what makes the editor a true preview: until now the editor showed 13px
 * text with loose line spacing in the app's theme colours, while the mail went
 * out at 10.5pt, single-spaced, near-black on white — close, never the same.
 *
 * Everything a toolbar button does is written as inline HTML a mail client
 * keeps: a font face, a size in points, a colour, a highlight as a background
 * colour on the text. Outlook drops stylesheets and classes, so nothing here
 * relies on one.
 * ---------------------------------------------------------------------------
 */

/** The desk's mail font: Latin and CJK in one face, on every Windows machine. */
export const MAIL_FONT = "'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
export const MAIL_SIZE_PT = 10.5;
export const MAIL_SIZE = `${MAIL_SIZE_PT}pt`;
export const MAIL_COLOR = "#14150f";
/** Outlook's own hyperlink blue. */
export const LINK_COLOR = "#0563c1";
/** The widest an image is drawn: a reading pane is about this wide. */
export const MAIL_IMAGE_MAX = 640;

export interface FontChoice {
  label: string;
  /** The font-family written into the mail, with fallbacks for machines without it. */
  css: string;
}

/** The faces Outlook offers that every recipient's machine can draw. */
export const FONT_CHOICES: FontChoice[] = [
  { label: "Microsoft YaHei", css: MAIL_FONT },
  { label: "Aptos", css: "Aptos, Calibri, Arial, sans-serif" },
  { label: "Calibri", css: "Calibri, Carlito, Arial, sans-serif" },
  { label: "Arial", css: "Arial, Helvetica, sans-serif" },
  { label: "Segoe UI", css: "'Segoe UI', Arial, sans-serif" },
  { label: "Tahoma", css: "Tahoma, Geneva, sans-serif" },
  { label: "Verdana", css: "Verdana, Geneva, sans-serif" },
  { label: "Trebuchet MS", css: "'Trebuchet MS', Arial, sans-serif" },
  { label: "Georgia", css: "Georgia, serif" },
  { label: "Times New Roman", css: "'Times New Roman', Times, serif" },
  { label: "Cambria", css: "Cambria, Georgia, serif" },
  { label: "Garamond", css: "Garamond, Georgia, serif" },
  { label: "Courier New", css: "'Courier New', Courier, monospace" },
];

/** Outlook's size list, in points. */
export const SIZE_CHOICES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

/** Font colours: the greys and the desk's navy, then Office's ten standard colours. */
export const TEXT_COLORS: Array<{ name: string; hex: string }> = [
  { name: "Black", hex: "#000000" },
  { name: "Dark grey", hex: "#404040" },
  { name: "Grey", hex: "#7f7f7f" },
  { name: "Light grey", hex: "#bfbfbf" },
  { name: "White", hex: "#ffffff" },
  { name: "Navy", hex: "#0f213a" },
  { name: "Dark blue", hex: "#002060" },
  { name: "Blue", hex: "#0070c0" },
  { name: "Light blue", hex: "#00b0f0" },
  { name: "Teal", hex: "#1f7a7a" },
  { name: "Dark red", hex: "#c00000" },
  { name: "Red", hex: "#ff0000" },
  { name: "Orange", hex: "#ed7d31" },
  { name: "Gold", hex: "#ffc000" },
  { name: "Yellow", hex: "#ffff00" },
  { name: "Light green", hex: "#92d050" },
  { name: "Green", hex: "#00b050" },
  { name: "Dark green", hex: "#375623" },
  { name: "Purple", hex: "#7030a0" },
  { name: "Brown", hex: "#843c0c" },
];

/** Word's and Outlook's highlighter colours. */
export const HIGHLIGHT_COLORS: Array<{ name: string; hex: string }> = [
  { name: "Yellow", hex: "#ffff00" },
  { name: "Bright green", hex: "#00ff00" },
  { name: "Turquoise", hex: "#00ffff" },
  { name: "Pink", hex: "#ff00ff" },
  { name: "Blue", hex: "#0000ff" },
  { name: "Red", hex: "#ff0000" },
  { name: "Dark blue", hex: "#000080" },
  { name: "Teal", hex: "#008080" },
  { name: "Green", hex: "#008000" },
  { name: "Violet", hex: "#800080" },
  { name: "Dark red", hex: "#800000" },
  { name: "Dark yellow", hex: "#808000" },
  { name: "Grey 50%", hex: "#808080" },
  { name: "Grey 25%", hex: "#c0c0c0" },
];

/** HTML's old <font size="1…7">, in points, for pasted mail that still uses it. */
export const HTML_FONT_SIZE_PT: Record<string, number> = { "1": 7.5, "2": 10, "3": 12, "4": 13.5, "5": 18, "6": 24, "7": 36 };

/** A computed size in pixels as Outlook would name it: points, to the half. */
export function ptFromPx(px: number): number {
  return Math.round(((px * 3) / 4) * 2) / 2;
}

/** The choice a computed font-family belongs to, by its first face; null for anything else. */
export function fontChoiceFor(family: string): FontChoice | null {
  const first = (s: string) => s.split(",")[0].trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  const want = first(family);
  return FONT_CHOICES.find((f) => first(f.css) === want) ?? null;
}

/** The first face of a font-family, as a person would name it. */
export function fontName(family: string): string {
  return family.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
}

/** One step up or down Outlook's size list (Ctrl+] and Ctrl+[). */
export function stepSize(currentPt: number, dir: 1 | -1): number {
  if (dir > 0) return SIZE_CHOICES.find((s) => s > currentPt) ?? SIZE_CHOICES[SIZE_CHOICES.length - 1];
  return [...SIZE_CHOICES].reverse().find((s) => s < currentPt) ?? SIZE_CHOICES[0];
}

/** A colour from rgb(…) or #…, as #rrggbb; null when it is neither. */
export function hexColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`;
}
