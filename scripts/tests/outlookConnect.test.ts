import {
  APP_ORIGINS,
  microsoftAddress,
  microsoftAddresses,
  microsoftSaid,
  outcomeFragment,
  outcomeText,
  readOutcome,
  returnTarget,
  sameMailbox,
  type ConnectOutcome,
} from "../../src/lib/outlookConnect";
import { readFileSync } from "node:fs";

/**
 * Connecting Outlook from inside the CRM (095): a login connects its own
 * mailbox and no other, and the round trip comes back only to the CRM.
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

console.log("whose mailbox");
const info = { mail: "info@aashishlogistics.com", userPrincipalName: "info@aashishlogistics.com" };
is("info@ signed in as info@", sameMailbox("info@aashishlogistics.com", info), true);
is("case and spaces do not matter", sameMailbox("  Info@AashishLogistics.com ", { mail: "INFO@aashishlogistics.com" }), true);
is("info@ signed in as aashish@ is refused", sameMailbox("info@aashishlogistics.com", { mail: "aashish@aashishlogistics.com", userPrincipalName: "aashish@aashishlogistics.com" }), false);
is("the sign-in name counts when the mail differs", sameMailbox("imports@aashishlogistics.com", { mail: "imports@aashishlogistics.onmicrosoft.com", userPrincipalName: "imports@aashishlogistics.com" }), true);
is("an account with no mailbox is refused", sameMailbox("info@aashishlogistics.com", { mail: null, userPrincipalName: null }), false);
is("an empty CRM email never matches", sameMailbox("", { mail: "", userPrincipalName: "" }), false);
is("addresses, deduplicated", microsoftAddresses({ mail: "A@x.com", userPrincipalName: "a@x.com" }), ["a@x.com"]);
is("named by the mailbox address", microsoftAddress({ mail: "Aashish@x.com", userPrincipalName: "aashish@x.onmicrosoft.com" }), "aashish@x.com");
is("named by the sign-in name without a mailbox", microsoftAddress({ mail: null, userPrincipalName: "guest@x.com" }), "guest@x.com");

console.log("\nwhere it may come back to");
is("the live site", returnTarget("https://logisticsdemosif.netlify.app/mail", APP_ORIGINS), "https://logisticsdemosif.netlify.app/mail");
is("query and fragment dropped", returnTarget("https://logisticsdemosif.netlify.app/mail?x=1#y", APP_ORIGINS), "https://logisticsdemosif.netlify.app/mail");
is("local development", returnTarget("http://localhost:5174/mail", APP_ORIGINS), "http://localhost:5174/mail");
is("somebody else's site refused", returnTarget("https://evil.example/mail", APP_ORIGINS), null);
is("a look-alike host refused", returnTarget("https://logisticsdemosif.netlify.app.evil.example/mail", APP_ORIGINS), null);
is("http for the live site refused", returnTarget("http://logisticsdemosif.netlify.app/mail", APP_ORIGINS), null);
is("not a URL", returnTarget("/mail", APP_ORIGINS), null);

console.log("\nhow it went, and back");
const round = (o: ConnectOutcome) => readOutcome(outcomeFragment(o));
is("connected", round({ kind: "connected" }), { kind: "connected" });
is("refused, with the account", round({ kind: "refused", as: "aashish@aashishlogistics.com" }), { kind: "refused", as: "aashish@aashishlogistics.com" });
is("failed, with the reason", round({ kind: "failed", why: "The Microsoft sign-in was cancelled. & = #" }), { kind: "failed", why: "The Microsoft sign-in was cancelled. & = #" });
is("no outlook in the fragment", readOutcome("#access_token=x"), null);
is("an empty fragment", readOutcome(""), null);
is("an overlong reason is cut", (readOutcome(`#outlook=failed&why=${"x".repeat(1000)}`) as { why: string }).why.length, 300);
is("said: connected", outcomeText({ kind: "connected" }, "info@aashishlogistics.com").tone, "success");
is(
  "said: refused names both",
  outcomeText({ kind: "refused", as: "aashish@aashishlogistics.com" }, "info@aashishlogistics.com").text,
  "This login is info@aashishlogistics.com, but Microsoft signed in aashish@aashishlogistics.com, so Outlook was not connected. Connect again and sign in to Microsoft as info@aashishlogistics.com."
);
is("Microsoft's text without its trace ids", microsoftSaid("AADSTS700082: The refresh token has expired. Trace ID: abc Correlation ID: def"), "AADSTS700082: The refresh token has expired.");
is("Microsoft's first line", microsoftSaid("AADSTS50011: Redirect mismatch.\r\nTrace ID: abc"), "AADSTS50011: Redirect mismatch.");

// The function decides with a copy of this file, and both functions seal with
// the same code, or a token kept by one could not be opened by the other.
console.log("\nthe server's copies");
const norm = (p: string) => readFileSync(p, "utf-8").replace(/\r\n/g, "\n");
is("outlook-connect/outlookConnect.ts is src/lib/outlookConnect.ts", norm("supabase-v2/functions/outlook-connect/outlookConnect.ts") === norm("src/lib/outlookConnect.ts"), true);
is("outlook-connect/seal.ts is outlook-token/seal.ts", norm("supabase-v2/functions/outlook-connect/seal.ts") === norm("supabase-v2/functions/outlook-token/seal.ts"), true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
