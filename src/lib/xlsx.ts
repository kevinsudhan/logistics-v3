/**
 * Writing a real .xlsx file, without a dependency.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT SheetJS
 *
 * The `xlsx` package on npm stops at 0.18.5 and carries two high-severity
 * advisories — a prototype pollution and a ReDoS — both marked "no fix
 * available", because SheetJS moved distribution off npm at 0.20. Neither is
 * reachable from what this app does: they are in the parsing path and we only
 * ever write. But this repository fails its own build on a credential reaching
 * the bundle, and carrying a high-severity dependency with no upgrade path, for
 * a feature this small, is the wrong trade.
 *
 * WHY NOT CSV
 *
 * CSV opens in Excel and loses everything on the way: a money column arrives as
 * text in some locales, dates are ambiguous between two continents, and a
 * single embedded comma in a consignee's address shifts the rest of the row.
 * A desk sending statements to customers should not be sending those.
 *
 * WHAT AN .xlsx ACTUALLY IS
 *
 * A zip of XML files. Stored, not deflated — a reader accepts either, and
 * uncompressed entries mean no compression code and nothing to get subtly
 * wrong. A ledger export is tens of kilobytes; the size is not worth the risk.
 * ---------------------------------------------------------------------------
 */

export type CellValue = string | number | boolean | Date | null | undefined;

export interface Column {
  /** Printed in the header row. */
  header: string;
  /** Width in characters. Excel's own unit, roughly one digit wide. */
  width?: number;
  /**
   * How a report lays the column out (see `ReportLayout`); a plain sheet
   * ignores it. `wrap` breaks long text over lines, `key` is the bold
   * reference column, `days` prints 22 as "22 days" and still sorts as 22.
   */
  kind?: ColumnKind;
}

export type ColumnKind = "text" | "wrap" | "center" | "key" | "date" | "money" | "number" | "days";

/**
 * A sheet that is read and printed as a report rather than worked on as data.
 *
 * A title block over the table, a coloured header row, a light grid with
 * banded rows, the header and the first columns frozen, a filter on the
 * header, and a landscape page that repeats the header and numbers itself.
 */
export interface ReportLayout {
  title: string;
  /** Lines under the title: whose report, the period, when it was made. */
  lines?: string[];
  /** Columns that stay put as the sheet scrolls sideways. */
  freezeColumns?: number;
  /** Printed at the foot of each page, beside the page number. */
  footer?: string;
}

export interface Sheet {
  /** The tab name. Excel refuses > 31 chars and the characters in SHEET_BAD. */
  name: string;
  columns: Column[];
  rows: CellValue[][];
  /** Lay it out as a report. Without it, a plain header row and the data. */
  report?: ReportLayout;
}

/* -------------------------------------------------------------------------- */
/* zip                                                                         */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

interface Entry {
  name: string;
  bytes: Uint8Array;
}

/**
 * A zip archive with every entry stored rather than deflated.
 *
 * Written by hand because the alternative is a compression library for files
 * that are a few tens of kilobytes. The format is a local header per entry,
 * then a central directory repeating them, then an end-of-directory record
 * saying where that starts — and getting the offsets right is the whole job.
 */
function zip(entries: Entry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = utf8(e.name);
    const crc = crc32(e.bytes);
    const size = e.bytes.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, 0, true); // time
    lv.setUint16(12, 0, true); // date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed
    lv.setUint32(22, size, true); // uncompressed
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra
    local.set(nameBytes, 30);

    chunks.push(local, e.bytes);

    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); // central directory header
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true); // version needed
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint16(14, 0, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, size, true);
    dv.setUint32(24, size, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true); // where the local header is
    dir.set(nameBytes, 46);
    central.push(dir);

    offset += local.length + size;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total =
    chunks.reduce((n, c) => n + c.length, 0) + centralSize + end.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of [...chunks, ...central, end]) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* the spreadsheet itself                                                      */
/* -------------------------------------------------------------------------- */

/**
 * XML escaping.
 *
 * `&`, `<` and `>` break the document; the quotes break attributes.
 *
 * The control-character strip is a codepoint test rather than a regex range on
 * purpose. Written as a character class it needs \u escapes, and those have a
 * habit of arriving as the characters they denote rather than as the escape —
 * which leaves raw control bytes sitting in this source file, makes it binary
 * to every tool that reads it, and still works, so nothing complains.
 */
const PRINTABLE = (code: number) =>
  code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20;

export const esc = (s: string) => {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (!PRINTABLE(code)) continue;
    out +=
      ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : ch;
  }
  return out;
};

/** A1, B1 … Z1, AA1. */
export function colName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Excel counts days from 30 December 1899.
 *
 * Not 31 December, and not 1 January 1900: the serial numbering has to absorb
 * Lotus 1-2-3's belief that 1900 was a leap year, which Excel kept for
 * compatibility and has never fixed.
 */
export function excelSerial(d: Date): number {
  const utcDays = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  return utcDays + 25569;
}

/**
 * Sheet names may not carry these, and Excel truncates past 31 characters.
 *
 * Runs of whitespace collapse afterwards: "P/L [2026]" strips two characters
 * that sit next to each other and would otherwise leave a double space in the
 * tab, which looks like a mistake because it is one.
 */
const SHEET_BAD = /[\\/?*[\]:]/g;
export const safeSheetName = (name: string) =>
  (name.replace(SHEET_BAD, " ").replace(/\s+/g, " ").trim() || "Sheet").slice(0, 31);

/**
 * The styles, referenced by index from the cells.
 *
 * `0` plain, `1` money to two decimals with thousands separators, `2` a date,
 * `3` a bold header: what a plain sheet uses, and fixed, because every export
 * already written depends on them. Money has to be a real number or the column
 * will not sum, which is the first thing anybody does to an exported ledger.
 *
 * From `4` on, the report's: its title, the lines under it, the header row,
 * and one body style per column kind, plain and banded.
 */
const BRAND = "FF0F6E56";
const REPORT_KINDS: ColumnKind[] = ["text", "wrap", "center", "key", "date", "money", "number", "days"];
const KIND_FORMAT: Record<ColumnKind, number> = { text: 0, wrap: 0, center: 0, key: 0, date: 165, money: 164, number: 166, days: 167 };
const KIND_ALIGN: Record<ColumnKind, string> = {
  text: 'horizontal="left" vertical="top"',
  wrap: 'horizontal="left" vertical="top" wrapText="1"',
  center: 'horizontal="center" vertical="top"',
  key: 'horizontal="center" vertical="top"',
  date: 'horizontal="center" vertical="top"',
  money: 'horizontal="right" vertical="top"',
  number: 'horizontal="right" vertical="top"',
  days: 'horizontal="center" vertical="top"',
};
const bodyXf = (kind: ColumnKind, banded: boolean) =>
  `<xf numFmtId="${KIND_FORMAT[kind]}" fontId="${kind === "key" ? 6 : 5}" fillId="${banded ? 3 : 0}" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment ${KIND_ALIGN[kind]}/></xf>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/><numFmt numFmtId="166" formatCode="#,##0"/><numFmt numFmtId="167" formatCode="0&quot; days&quot;"/></numFmts>
<fonts count="7">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><color rgb="${BRAND}"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FF5F6B66"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FF1F2A26"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><color rgb="FF1F2A26"/><name val="Calibri"/></font>
</fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="${BRAND}"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F7F5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD3DCD8"/></left><right style="thin"><color rgb="FFD3DCD8"/></right><top style="thin"><color rgb="FFD3DCD8"/></top><bottom style="thin"><color rgb="FFD3DCD8"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${7 + REPORT_KINDS.length * 2}">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
${[false, true].map((banded) => REPORT_KINDS.map((k) => bodyXf(k, banded)).join("\n")).join("\n")}
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const STYLE_PLAIN = 0;
const STYLE_MONEY = 1;
const STYLE_DATE = 2;
const STYLE_HEADER = 3;
const STYLE_REPORT_TITLE = 4;
const STYLE_REPORT_LINE = 5;
const STYLE_REPORT_HEADER = 6;
const reportStyle = (kind: ColumnKind, banded: boolean) => 7 + (banded ? REPORT_KINDS.length : 0) + REPORT_KINDS.indexOf(kind);

function cellXml(ref: string, v: CellValue): string {
  if (v === null || v === undefined || v === "") return "";

  if (v instanceof Date) {
    return `<c r="${ref}" s="${STYLE_DATE}"><v>${excelSerial(v)}</v></c>`;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    // Whole numbers stay plain so a count of containers does not print as 3.00.
    const s = Number.isInteger(v) ? STYLE_PLAIN : STYLE_MONEY;
    return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  }
  if (typeof v === "boolean") {
    return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
  }
  // Inline strings rather than a shared string table: one fewer file, one fewer
  // index to keep consistent, and nothing here repeats enough to pay for it.
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`)
    .join("");

  const header = sheet.columns
    .map(
      (c, i) =>
        `<c r="${colName(i)}1" s="${STYLE_HEADER}" t="inlineStr"><is><t xml:space="preserve">${esc(
          c.header
        )}</t></is></c>`
    )
    .join("");

  const body = sheet.rows
    .map((row, r) => {
      const cells = row.map((v, i) => cellXml(`${colName(i)}${r + 2}`, v)).join("");
      return `<row r="${r + 2}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${cols}</cols>
<sheetData><row r="1">${header}</row>${body}</sheetData>
</worksheet>`;
}

/* -------------------------------------------------------------------------- */
/* a report                                                                    */
/* -------------------------------------------------------------------------- */

/** Where the header row of a report sits: under the title, its lines and a gap. */
export const reportHeaderRow = (layout: ReportLayout) => (layout.lines?.length ?? 0) + 3;

/**
 * One body cell, styled even when empty.
 *
 * A plain sheet leaves an empty cell out; a report writes it, so the grid and
 * the banding run the whole width of the row instead of stopping at the gaps.
 */
function reportCellXml(ref: string, v: CellValue, kind: ColumnKind, banded: boolean): string {
  const s = reportStyle(kind, banded);
  if (v === null || v === undefined || v === "") return `<c r="${ref}" s="${s}"/>`;
  if (v instanceof Date) return `<c r="${ref}" s="${s}"><v>${excelSerial(v)}</v></c>`;
  if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}" s="${s}"><v>${v}</v></c>` : `<c r="${ref}" s="${s}"/>`;
  if (typeof v === "boolean") return `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${v ? "Yes" : "No"}</t></is></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

/**
 * How tall a row needs to be for its wrapped text.
 *
 * Excel does not measure wrapped text in a file it did not write, so a report
 * row is sized here: the lines the longest wrapped cell breaks into, at the
 * body font's line height. An estimate — a few characters either way costs a
 * little white space, never a clipped line.
 */
export function reportRowHeight(row: CellValue[], columns: Column[]): number | null {
  let lines = 1;
  row.forEach((v, i) => {
    const c = columns[i];
    if (c?.kind !== "wrap" || v === null || v === undefined || v === "") return;
    const perLine = Math.max(4, Math.floor((c.width ?? 16) * 1.15));
    const n = String(v)
      .split("\n")
      .reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / perLine)), 0);
    lines = Math.max(lines, n);
  });
  return lines > 1 ? Math.round(lines * 13.2 + 3) : null;
}

function reportSheetXml(sheet: Sheet, layout: ReportLayout): string {
  const width = sheet.columns.length;
  const last = colName(width - 1);
  const h = reportHeaderRow(layout);
  const lastRow = h + Math.max(sheet.rows.length, 0);
  const freeze = Math.min(layout.freezeColumns ?? 0, width - 1);
  const topLeft = `${colName(freeze)}${h + 1}`;
  const pane = freeze
    ? `<pane xSplit="${freeze}" ySplit="${h}" topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/><selection pane="topRight"/><selection pane="bottomLeft"/><selection pane="bottomRight" activeCell="${topLeft}" sqref="${topLeft}"/>`
    : `<pane ySplit="${h}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/>`;

  const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`).join("");
  const text = (ref: string, style: number, v: string) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;

  const top = [
    `<row r="1" ht="26" customHeight="1">${text("A1", STYLE_REPORT_TITLE, layout.title)}</row>`,
    ...(layout.lines ?? []).map((line, i) => `<row r="${i + 2}">${text(`A${i + 2}`, STYLE_REPORT_LINE, line)}</row>`),
    `<row r="${h - 1}" ht="6" customHeight="1"/>`,
    `<row r="${h}" ht="30" customHeight="1">${sheet.columns.map((c, i) => text(`${colName(i)}${h}`, STYLE_REPORT_HEADER, c.header)).join("")}</row>`,
  ].join("");

  const body = sheet.rows
    .map((row, r) => {
      const n = h + 1 + r;
      const ht = reportRowHeight(row, sheet.columns);
      const cells = sheet.columns.map((c, i) => reportCellXml(`${colName(i)}${n}`, row[i], c.kind ?? "text", r % 2 === 1)).join("");
      return `<row r="${n}"${ht ? ` ht="${ht}" customHeight="1"` : ""}>${cells}</row>`;
    })
    .join("");

  // In a page footer "&" starts a code (&P is the page number), so a literal one is doubled.
  const footer = `&amp;L&amp;8${esc((layout.footer ?? layout.title).replace(/&/g, "&&"))}&amp;R&amp;8Page &amp;P of &amp;N`;

  // The element order is the schema's; Excel refuses a file with them out of place.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${last}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${top}${body}</sheetData>
<autoFilter ref="A${h}:${last}${lastRow}"/>
<printOptions horizontalCentered="1"/>
<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
<headerFooter><oddFooter>${footer}</oddFooter></headerFooter>
</worksheet>`;
}

/** The filter and the rows printed on every page, named the way Excel names its own. */
function reportNames(sheets: Array<Sheet & { name: string }>): string {
  const names = sheets.flatMap((s, i) => {
    if (!s.report) return [];
    const h = reportHeaderRow(s.report);
    const last = colName(s.columns.length - 1);
    const q = `'${esc(s.name).replace(/'/g, "''")}'`;
    return [
      `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${q}!$A$${h}:$${last}$${h + s.rows.length}</definedName>`,
      `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${q}!$${h}:$${h}</definedName>`,
    ];
  });
  return names.length ? `<definedNames>${names.join("")}</definedNames>` : "";
}

/** Build the workbook. Returns the bytes; the caller decides what to do with them. */
export function buildWorkbook(sheets: Sheet[]): Uint8Array {
  const named = sheets.map((s, i) => ({ ...s, name: safeSheetName(s.name || `Sheet${i + 1}`) }));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${named
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )
  .join("\n")}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${named
    .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("")}</sheets>${reportNames(named)}
</workbook>`;

  // The styles part takes the relationship id after the last sheet, so the
  // numbering here has to follow the sheets rather than being fixed.
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${named
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  )
  .join("\n")}
<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  return zip([
    { name: "[Content_Types].xml", bytes: utf8(contentTypes) },
    { name: "_rels/.rels", bytes: utf8(rootRels) },
    { name: "xl/workbook.xml", bytes: utf8(workbook) },
    { name: "xl/_rels/workbook.xml.rels", bytes: utf8(workbookRels) },
    { name: "xl/styles.xml", bytes: utf8(STYLES) },
    ...named.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      bytes: utf8(s.report ? reportSheetXml(s, s.report) : sheetXml(s)),
    })),
  ]);
}

/** Build it and hand it to the browser to save. */
export function downloadWorkbook(filename: string, sheets: Sheet[]): void {
  const bytes = buildWorkbook(sheets);
  // `.buffer` rather than the view: the array is allocated at exactly its own
  // length, so the two are the same bytes, and BlobPart will not take a
  // Uint8Array whose buffer TypeScript cannot prove is not shared.
  const blob = new Blob([bytes.buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Long enough for the save to start, short enough that a morning of exports
  // does not hold every one of them in memory.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A filename that sorts by date and says what it is. */
export const stamped = (base: string, d = new Date()) =>
  `${base}-${d.toISOString().slice(0, 10)}.xlsx`;
