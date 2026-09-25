import { FONT_CHOICES, MAIL_FONT, fontChoiceFor, fontName, hexColor, ptFromPx, stepSize } from "../../src/lib/mailStyle";
import { composeSubject, quoteHeaderHtml, quotedBodyHtml, replyRecipients } from "../../src/lib/mailQuote";

/**
 * The mail editor's toolbar readings, and reply / reply all / forward the
 * way Outlook writes them (25 Sep 2026).
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

console.log("sizes and faces");
is("14px is the desk's 10.5pt", ptFromPx(14), 10.5);
is("16px is 12pt", ptFromPx(16), 12);
is("a size between halves rounds to the half", ptFromPx(14.6667), 11);
is("the mail font is Microsoft YaHei", fontChoiceFor(MAIL_FONT)?.label, "Microsoft YaHei");
is("a computed family with quotes", fontChoiceFor('"Times New Roman", Times, serif')?.label, "Times New Roman");
is("case does not matter", fontChoiceFor("calibri, sans-serif")?.label, "Calibri");
is("a face not on the list", fontChoiceFor("Comic Sans MS, cursive"), null);
is("and is named by its first face", fontName("'Comic Sans MS', cursive"), "Comic Sans MS");
is("every choice finds itself", FONT_CHOICES.every((f) => fontChoiceFor(f.css)?.label === f.label), true);
is("Ctrl+] from 10.5 is 11", stepSize(10.5, 1), 11);
is("Ctrl+[ from 10.5 is 10", stepSize(10.5, -1), 10);
is("an odd size steps to the next on the list", stepSize(13, 1), 14);
is("the top stays the top", stepSize(72, 1), 72);
is("the bottom stays the bottom", stepSize(8, -1), 8);

console.log("\ncolours");
is("rgb to hex", hexColor("rgb(255, 0, 0)"), "#ff0000");
is("short hex", hexColor("#0af"), "#00aaff");
is("transparent is no colour", hexColor("rgba(0, 0, 0, 0)"), null);
is("a name is not read", hexColor("red"), null);

console.log("\nsubjects");
is("reply", composeSubject("Rate for 1x40HC", "reply"), "Re: Rate for 1x40HC");
is("no second Re:", composeSubject("RE: Rate", "replyAll"), "RE: Rate");
is("forward", composeSubject("Rate", "forward"), "Fw: Rate");
is("no second Fw:", composeSubject("FWD: Rate", "forward"), "FWD: Rate");
is("a forward of a reply", composeSubject("Re: Rate", "forward"), "Fw: Re: Rate");

console.log("\nwho it goes to");
const r = (address: string, name = "") => ({ emailAddress: { name, address } });
const msg = {
  from: r("omar@gfp.ae", "Omar"),
  toRecipients: [r("info@aashishlogistics.com"), r("docs@gfp.ae")],
  ccRecipients: [r("aashish@aashishlogistics.com"), r("INFO@aashishlogistics.com"), r("omar@gfp.ae")],
};
is("reply: the sender", replyRecipients(msg, "reply", "info@aashishlogistics.com"), { to: ["omar@gfp.ae"], cc: [] });
is(
  "reply all: sender and To, then Cc, without me or anybody twice",
  replyRecipients(msg, "replyAll", "info@aashishlogistics.com"),
  { to: ["omar@gfp.ae", "docs@gfp.ae"], cc: ["aashish@aashishlogistics.com"] }
);
is("forward: nobody yet", replyRecipients(msg, "forward", "info@aashishlogistics.com"), { to: [], cc: [] });
const mine = { from: r("info@aashishlogistics.com"), toRecipients: [r("omar@gfp.ae"), r("docs@gfp.ae")], ccRecipients: [] };
is("reply to my own sent mail goes to who I sent it to", replyRecipients(mine, "reply", "info@aashishlogistics.com"), { to: ["omar@gfp.ae", "docs@gfp.ae"], cc: [] });

console.log("\nthe quoted message");
const head = quoteHeaderHtml({ ...msg, subject: "Rate <1x40HC> & DG", receivedDateTime: "2026-09-25T09:05:00Z" });
is("From names the sender", head.includes("<b>From:</b> Omar &lt;omar@gfp.ae&gt;"), true);
is("To lists everyone on it", head.includes("<b>To:</b> info@aashishlogistics.com; docs@gfp.ae"), true);
is("Cc is there when there was one", head.includes("<b>Cc:</b>"), true);
is("the subject is escaped", head.includes("Rate &lt;1x40HC&gt; &amp; DG"), true);
is("under Outlook's rule", head.startsWith('<div style="border:none;border-top:solid #e1e1e1 1.0pt'), true);
is("no Cc line without one", quoteHeaderHtml({ ...mine, subject: "x", receivedDateTime: "2026-09-25T09:05:00Z" }).includes("Cc:"), false);
is("plain text keeps its lines, escaped", quotedBodyHtml({ body: { contentType: "text", content: "a < b\nnext" } }), "a &lt; b<br>next");
is("HTML as it came", quotedBodyHtml({ body: { contentType: "html", content: "<p>x</p>" } }), "<p>x</p>");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
