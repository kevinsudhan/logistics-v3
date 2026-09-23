/**
 * Reading a spreadsheet somebody uploads: .xlsx or .csv, first sheet only.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A LIBRARY
 *
 * The workbook writer in xlsx.ts is hand-rolled for the same reason: the
 * common spreadsheet libraries are a large dependency with a history of
 * security advisories, for a job that is a zip and two XML files. An .xlsx is
 * a zip; its cells are in xl/worksheets/sheetN.xml, and text cells point into
 * xl/sharedStrings.xml (Excel) or carry the text inline (our own export).
 *
 * Entries are stored or deflated; deflate is undone by the browser's own
 * DecompressionStream, so nothing is shipped to do it.
 *
 * WHAT COMES BACK
 *
 * Rows of raw values — strings, numbers, booleans, nulls — in column order,
 * gaps kept. Dates come back as Excel serial numbers because that is what the
 * file holds; the importer knows which columns are dates and converts them.
 * ---------------------------------------------------------------------------
 */

export type Raw = string | number | boolean | null;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // Copied into a fresh ArrayBuffer: a subarray may sit on a shared buffer,
  // which Blob does not accept.
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Every file in a zip, by name. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  // The end-of-central-directory record, found from the back: it may be
  // followed by a comment of up to 64 KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This is not a spreadsheet file (.xlsx) or it is damaged.");

  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();

  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error("The spreadsheet file is damaged.");
    const method = u16(bytes, p + 10);
    const size = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflateRaw(data));
    // Anything else is not something Excel writes; skipped rather than fatal.

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

/** All the <t> runs in a fragment, joined — rich text is several runs. */
const textOf = (xml: string) =>
  unescapeXml([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

const colIndex = (letters: string) =>
  [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

export function parseSheet(sheetXml: string, shared: string[]): Raw[][] {
  const rows: Raw[][] = [];
  for (const row of sheetXml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: Raw[] = [];
    for (const c of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Raw = null;
      if (t === "s") value = v === undefined ? null : (shared[Number(v)] ?? null);
      else if (t === "inlineStr") value = textOf(body);
      else if (t === "b") value = v === "1";
      else if (t === "str") value = v === undefined ? null : unescapeXml(v);
      else if (t === "e") value = null;
      else if (v !== undefined && v !== "") value = Number(v);
      const at = ref ? colIndex(ref[1]) : cells.length;
      while (cells.length < at) cells.push(null);
      cells[at] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** The first sheet of an .xlsx, as rows of raw values. */
export async function readXlsx(bytes: Uint8Array): Promise<Raw[][]> {
  const files = await unzip(bytes);
  const dec = new TextDecoder();
  const shared = files.has("xl/sharedStrings.xml")
    ? [...dec.decode(files.get("xl/sharedStrings.xml")!).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];
  const sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error("The spreadsheet has no sheets.");
  return parseSheet(dec.decode(files.get(sheetName)!), shared);
}

/** A CSV file, quotes and commas inside quotes handled. */
export function readCsv(text: string): Raw[][] {
  const rows: Raw[][] = [];
  let row: Raw[] = [];
  let cell = "";
  let quoted = false;
  const clean = text.replace(/^﻿/, "");
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell === "" ? null : cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell === "" ? null : cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell === "" ? null : cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== null && String(v).trim() !== ""));
}

/** Whichever the file is. */
export async function readSpreadsheet(file: File): Promise<Raw[][]> {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") return readCsv(await file.text());
  return readXlsx(new Uint8Array(await file.arrayBuffer()));
}

/** An Excel date serial (1900 system) as YYYY-MM-DD. */
export function serialToDate(serial: number): string {
  // Day 0 is 1899-12-30 once Excel's leap-1900 bug is allowed for.
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
