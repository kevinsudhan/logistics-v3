import { base64ToBytes, bytesToBase64 } from "../../src/lib/base64";

/**
 * The conversion every attachment passes through.
 *
 * It is worth testing because its failure mode is silent here and loud
 * somewhere else: a mail sends, an attachment arrives, and it is the customer
 * who discovers the PDF will not open. Nothing on this side reports anything.
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

const roundTrip = (bytes: Uint8Array) => base64ToBytes(bytesToBase64(bytes));
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

console.log("\nbytes survive the round trip");
const text = new TextEncoder().encode("Packing list — 42 cartons, Müller GmbH");
is("utf-8 text, accents and all", same(roundTrip(text), text), true);
is("empty", same(roundTrip(new Uint8Array(0)), new Uint8Array(0)), true);
is("a single zero byte", same(roundTrip(new Uint8Array([0])), new Uint8Array([0])), true);

// Every value a byte can take. A conversion that mangles the high half passes
// an ASCII test and corrupts every PDF.
const all = new Uint8Array(256);
for (let i = 0; i < 256; i++) all[i] = i;
is("all 256 byte values", same(roundTrip(all), all), true);

console.log("\nit does not fall over on a real attachment");
/*
  Past the 0x8000 chunk boundary, which is the whole reason the chunking is
  there. `String.fromCharCode(...bytes)` on this many arguments throws
  RangeError — and only ever on the files that matter, because a test with a
  short string in it never reaches the limit.
*/
const big = new Uint8Array(200_000);
for (let i = 0; i < big.length; i++) big[i] = (i * 31) % 256;
is("200KB round trips", same(roundTrip(big), big), true);
is("exactly one chunk", same(roundTrip(all.subarray(0, 1)), all.subarray(0, 1)), true);

const boundary = new Uint8Array(0x8000 + 1).fill(200);
is("one byte over a chunk", same(roundTrip(boundary), boundary), true);

console.log("\nit is base64, not a data url");
// The prefix is the bug this guards: Graph stores it as part of the file.
const b64 = bytesToBase64(new TextEncoder().encode("hello"));
is("no data: prefix", b64.startsWith("data:"), false);
is("no comma", b64.includes(","), false);
is("no newlines", /\s/.test(b64), false);
is("is what btoa says", b64, "aGVsbG8=");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
