/**
 * Where the Microsoft token is kept (services/graphMail).
 *
 * On its own so that signing in and out, and the sent-mail copy's "is Outlook
 * connected here?", can read and clear it without the mail client coming down
 * with the first screen (25 Oct): that client is most of what the app used to
 * load before it could show anything.
 *
 * sessionStorage, alongside the Supabase session and for the same reason: desk
 * machines are shared, and a mailbox token must not outlive the browser tab.
 */
export const TOKEN_KEY = "araxys.graphToken";
/** When that token runs out (epoch ms); absent while its lifetime is unknown. */
export const EXPIRES_KEY = "araxys.graphTokenExpires";
/** Which sign-in's refresh token the server already holds, so a reload does not hand it over again. */
export const LINKED_KEY = "araxys.outlookLinked";
/** Set while this tab is away at Microsoft connecting Outlook (095). */
export const CONNECTING_KEY = "araxys.outlookConnecting";
/** How the last connect went, until the Mail page has shown it. */
export const NOTICE_KEY = "araxys.outlookNotice";

export function storeGraphToken(token: string | null, expiresInSeconds?: number) {
  if (!token) return;
  sessionStorage.setItem(TOKEN_KEY, token);
  if (expiresInSeconds) sessionStorage.setItem(EXPIRES_KEY, String(Date.now() + expiresInSeconds * 1000));
  else sessionStorage.removeItem(EXPIRES_KEY);
}

export function hasGraphToken(): boolean {
  return !!sessionStorage.getItem(TOKEN_KEY);
}

/** What else goes with the token: the mail client's opened messages, once it has loaded. */
const alsoForget: Array<() => void> = [];
export function forgetWithToken(fn: () => void) {
  alsoForget.push(fn);
}

export function clearGraphToken() {
  for (const fn of alsoForget) fn();
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXPIRES_KEY);
  sessionStorage.removeItem(LINKED_KEY);
  sessionStorage.removeItem(CONNECTING_KEY);
  sessionStorage.removeItem(NOTICE_KEY);
}
