import { deflateRawSync } from "node:zlib";
import { buildWorkbook, crc32 } from "../../src/lib/xlsx";
import { readCsv, readXlsx, serialToDate } from "../../src/lib/xlsxRead";

/**
 * Reading uploaded spreadsheets.
 *
 * Two kinds of file matter: our own export (stored entries, inline strings)
 * and what Excel saves (deflated entries, shared strings). Both are built here
 * and read back.
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${label}${
      ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`
    }`
  );
  ok ? pass++ : fail++;
};

/** A minimal zip with DEFLATED entries, as Excel writes them. */
function deflatedZip(files: Array<{ name: string; text: string }>): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[] = [];
  const central: number[] = [];
  const le16 = (n: number) => [n & 255, (n >> 8) & 255];
  const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const f of files) {
    const raw = enc.encode(f.text);
    const comp = new Uint8Array(deflateRawSync(raw));
    const name = enc.encode(f.name);
    const crc = crc32(raw);
    const offset = parts.length;
    parts.push(...le32(0x04034b50), ...le16(20), ...le16(0), ...le16(8), ...le16(0), ...le16(0), ...le32(crc), ...le32(comp.length), ...le32(raw.length), ...le16(name.length), ...le16(0), ...name, ...comp);
    central.push(...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(0), ...le16(8), ...le16(0), ...le16(0), ...le32(crc), ...le32(comp.length), ...le32(raw.length), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...name);
  }
  const cdStart = parts.length;
  return new Uint8Array([...parts, ...central, ...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(files.length), ...le16(files.length), ...le32(central.length), ...le32(cdStart), ...le16(0)]);
}

console.log("\nour own export reads back");
const ours = buildWorkbook([
  {
    name: "Schedules",
    columns: [{ header: "Port of loading" }, { header: "ETD" }, { header: "Transit" }],
    rows: [
      ["Chennai", "2026-10-02", 18],
      ["Nhava Sheva (JNPT) & Co", null, 21],
    ],
  },
]);
const back = await readXlsx(ours);
is("header row", back[0], ["Port of loading", "ETD", "Transit"]);
is("text and numbers", back[1], ["Chennai", "2026-10-02", 18]);
is("an ampersand survives", back[2][0], "Nhava Sheva (JNPT) & Co");

console.log("\nwhat Excel saves: deflated, shared strings, a gap, a date serial");
const excel = deflatedZip([
  { name: "xl/sharedStrings.xml", text: `<sst><si><t>Port of loading</t></si><si><t>ETD</t></si><si><r><t>Jebel </t></r><r><t>Ali</t></r></si></sst>` },
  { name: "xl/worksheets/sheet1.xml", text: `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2" s="1"><v>46297</v></c></row></sheetData></worksheet>` },
]);
const read = await readXlsx(excel);
is("shared strings resolve", read[0], ["Port of loading", null, "ETD"]);
is("rich text runs join", read[1][0], "Jebel Ali");
is("an empty column stays a gap", read[1][1], null);
is("a date arrives as a serial", read[1][2], 46297);
is("and converts", serialToDate(46297), "2026-10-02");

console.log("\nCSV");
is(
  "quotes, commas in quotes, CRLF, a BOM",
  readCsv('﻿Port,ETD,Notes\r\n"Chennai, TN",2026-10-02,"Said ""urgent"""\r\n\r\nJebel Ali,,\r\n'),
  [["Port", "ETD", "Notes"], ["Chennai, TN", "2026-10-02", 'Said "urgent"'], ["Jebel Ali", null, null]]
);

console.log("\nnot a spreadsheet");
let threw = false;
try {
  await readXlsx(new TextEncoder().encode("hello"));
} catch {
  threw = true;
}
is("says so rather than returning nothing", threw, true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
