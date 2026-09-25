/**
 * Connecting Outlook from inside the CRM (095): which Microsoft account may be
 * connected to which CRM login, where the round trip may come back to, and
 * what it reports when it does.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 *
 * A CRM login connects its own mailbox and no other. Signed in as info@, the
 * Microsoft sign-in has to be info@ as well — its primary address or its
 * sign-in name, not an alias another mailbox happens to carry — or nothing is
 * connected. Mail leaves as whoever the Microsoft account is, so connecting
 * aashish@ under an info@ login would send info@'s work as aashish@, and file
 * aashish@'s sent mail under info@.
 *
 * The outlook-connect function decides (a copy of this file, kept identical by
 * scripts/tests/outlookConnect.test.ts); the Mail page words the answer from
 * the same code.
 * ---------------------------------------------------------------------------
 */

/** What Graph's /me says about the Microsoft account that signed in. */
export interface MicrosoftMe {
  mail?: string | null;
  userPrincipalName?: string | null;
}

/** The addresses that count as the account: its mailbox address and its sign-in name. */
export function microsoftAddresses(me: MicrosoftMe): string[] {
  const all = [me.mail, me.userPrincipalName]
    .filter((a): a is string => !!a && a.includes("@"))
    .map((a) => a.trim().toLowerCase());
  return [...new Set(all)];
}

/** The one to name to the person: the mailbox address, else the sign-in name. */
export function microsoftAddress(me: MicrosoftMe): string {
  return microsoftAddresses(me)[0] ?? "an account with no mailbox";
}

/** True when the Microsoft account is the CRM login's own mailbox. */
export function sameMailbox(crmEmail: string, me: MicrosoftMe): boolean {
  const want = crmEmail.trim().toLowerCase();
  return want.includes("@") && microsoftAddresses(me).includes(want);
}

/**
 * The sites a connect may return to. Anything else is refused at the start,
 * so the function can never be used to bounce somebody to a page of a
 * stranger's choosing. The function also reads OUTLOOK_APP_ORIGINS, for a
 * domain added later.
 */
export const APP_ORIGINS = ["https://logisticsdemosif.netlify.app", "http://localhost:5174"];

/** The page to come back to, if its site is allowed: origin and path only. */
export function returnTarget(returnTo: string, allowed: string[]): string | null {
  try {
    const u = new URL(returnTo);
    return allowed.includes(u.origin) ? `${u.origin}${u.pathname}` : null;
  } catch {
    return null;
  }
}

/** How the round trip ended. */
export type ConnectOutcome =
  | { kind: "connected" }
  | { kind: "refused"; as: string }
  | { kind: "failed"; why: string };

/**
 * Carried back in the URL's fragment, which the browser never sends to a
 * server or puts in a Referer.
 */
export function outcomeFragment(o: ConnectOutcome): string {
  const p = new URLSearchParams({ outlook: o.kind });
  if (o.kind === "refused") p.set("as", o.as);
  if (o.kind === "failed") p.set("why", o.why);
  return `#${p.toString()}`;
}

export function readOutcome(hash: string): ConnectOutcome | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  switch (p.get("outlook")) {
    case "connected":
      return { kind: "connected" };
    case "refused":
      return { kind: "refused", as: (p.get("as") ?? "").slice(0, 200) };
    case "failed":
      return { kind: "failed", why: (p.get("why") ?? "").slice(0, 300) || "Microsoft did not say why." };
    default:
      return null;
  }
}

/** What the Mail page says about it. */
export function outcomeText(o: ConnectOutcome, crmEmail: string): { tone: "success" | "warning" | "danger"; text: string } {
  switch (o.kind) {
    case "connected":
      return { tone: "success", text: `Outlook is connected for ${crmEmail}. It stays connected until you sign out.` };
    case "refused":
      return {
        tone: "warning",
        text: `This login is ${crmEmail}, but Microsoft signed in ${o.as || "a different account"}, so Outlook was not connected. Connect again and sign in to Microsoft as ${crmEmail}.`,
      };
    case "failed":
      return { tone: "danger", text: `Outlook was not connected: ${o.why}` };
  }
}

/** Microsoft's error text without the trace ids it appends. */
export function microsoftSaid(description: string | null | undefined): string {
  return String(description ?? "").split(/\r?\n| Trace ID:/)[0].trim();
}
