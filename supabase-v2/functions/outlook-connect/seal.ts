/**
 * Sealing a Microsoft refresh token for private.outlook_links (094, 095).
 *
 * AES-GCM with OUTLOOK_TOKEN_KEY (32 random bytes, base64url, in the functions'
 * secrets: supabase-v2/set-outlook-key.mjs) and the Supabase session id as
 * associated data, so the database alone holds nothing usable and a sealed
 * token copied onto another sign-in's row does not open.
 *
 * outlook-token and outlook-connect each carry this file; the copies are kept
 * identical by scripts/tests/outlookConnect.test.ts.
 */

const SEAL_KEY = Deno.env.get("OUTLOOK_TOKEN_KEY");

export const sealReady = () => !!SEAL_KEY;

export const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

let keyP: Promise<CryptoKey> | null = null;
const sealKey = () => (keyP ??= crypto.subtle.importKey("raw", unb64u(SEAL_KEY!), "AES-GCM", false, ["encrypt", "decrypt"]));

export async function seal(plain: string, session: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(session) }, await sealKey(), new TextEncoder().encode(plain));
  return `${b64u(iv)}.${b64u(new Uint8Array(ct))}`;
}

export async function unseal(sealed: string, session: string): Promise<string | null> {
  const [iv, ct] = sealed.split(".");
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv), additionalData: new TextEncoder().encode(session) }, await sealKey(), unb64u(ct));
    return new TextDecoder().decode(pt);
  } catch {
    // Another sign-in's row, or a key that has since been replaced.
    return null;
  }
}

/** The caller's user and Supabase session, from a JWT the auth server has accepted. */
export function sessionOf(authorization: string): { sub: string; session: string } | null {
  try {
    const part = authorization.replace(/^Bearer\s+/i, "").split(".")[1];
    const claims = JSON.parse(new TextDecoder().decode(unb64u(part)));
    return claims.sub && claims.session_id ? { sub: claims.sub, session: claims.session_id } : null;
  } catch {
    return null;
  }
}
