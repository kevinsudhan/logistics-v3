import { bareCid, isEmbeddedImage, rewriteCidImages } from "../../src/lib/inlineImages";

/**
 * Signature logos, and the three ways a Content-ID gets written.
 *
 * Every message from a desk with an Outlook signature carries one of these, so
 * getting it wrong is not an edge case — it is every message. And the failure
 * is quiet: an unmatched `cid:` is deleted by the view exactly as it was before
 * any of this existed, so a broken rewrite looks identical to no rewrite.
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

const URI = "data:image/png;base64,AAAA";

console.log("\nthe brackets come off an id");
is("bracketed", bareCid("<image001.png@01DA1234.5678>"), "image001.png@01DA1234.5678");
is("bare", bareCid("image001.png@01DA1234.5678"), "image001.png@01DA1234.5678");
is("padded", bareCid("  <logo@x>  "), "logo@x");

console.log("\nrewriting the src");
// Outlook: brackets in the attachment metadata, none in the body.
is(
  "attachment bracketed, body not",
  rewriteCidImages(
    `<img src="cid:image001.png@01DA.567">`,
    [{ cid: "<image001.png@01DA.567>", uri: URI }]
  ),
  `<img src="${URI}">`
);
is(
  "brackets on both sides",
  rewriteCidImages(`<img src="cid:<logo@x>">`, [{ cid: "<logo@x>", uri: URI }]),
  `<img src="${URI}">`
);
is(
  "brackets on neither",
  rewriteCidImages(`<img src="cid:logo@x">`, [{ cid: "logo@x", uri: URI }]),
  `<img src="${URI}">`
);
is(
  "single quotes in the markup",
  rewriteCidImages(`<img src='cid:logo@x'>`, [{ cid: "logo@x", uri: URI }]),
  `<img src='${URI}'>`
);

console.log("\nseveral images in one signature");
is(
  "each takes its own",
  rewriteCidImages(`<img src="cid:a@x"><img src="cid:b@x">`, [
    { cid: "a@x", uri: "data:image/png;base64,AAA" },
    { cid: "b@x", uri: "data:image/gif;base64,BBB" },
  ]),
  `<img src="data:image/png;base64,AAA"><img src="data:image/gif;base64,BBB">`
);
is(
  "the same logo used twice",
  rewriteCidImages(`<img src="cid:a@x"> and <img src="cid:a@x">`, [{ cid: "a@x", uri: URI }]),
  `<img src="${URI}"> and <img src="${URI}">`
);

console.log("\nwhat is left alone");
// Left as cid: on purpose — the view deletes it, which beats a broken-image
// icon in the middle of a signature.
is(
  "an id with no bytes behind it",
  rewriteCidImages(`<img src="cid:missing@x">`, [{ cid: "other@x", uri: URI }]),
  `<img src="cid:missing@x">`
);
is("nothing resolved", rewriteCidImages(`<img src="cid:a@x">`, []), `<img src="cid:a@x">`);
is("no cid in the body", rewriteCidImages(`<p>hello</p>`, [{ cid: "a@x", uri: URI }]), `<p>hello</p>`);
is("empty body", rewriteCidImages("", [{ cid: "a@x", uri: URI }]), "");
is("an empty id is skipped", rewriteCidImages(`<img src="cid:a@x">`, [{ cid: "<>", uri: URI }]), `<img src="cid:a@x">`);

console.log("\nwhich attachments are embedded images");
is("an inline png", isEmbeddedImage({ contentType: "image/png", isInline: true }), true);
// A packing list is a file somebody sent, not part of the body.
is("a pdf attachment", isEmbeddedImage({ contentType: "application/pdf", isInline: false }), false);
// An image sent as a real attachment belongs in the attachment list.
is("an image, not inline", isEmbeddedImage({ contentType: "image/png", isInline: false }), false);
// Inline but not an image — a signature stylesheet, say. Not ours to inline.
is("inline, not an image", isEmbeddedImage({ contentType: "text/css", isInline: true }), false);
is("missing fields", isEmbeddedImage({}), false);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
