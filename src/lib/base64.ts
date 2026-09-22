/**
 * Bytes to base64 and back.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT FileReader.readAsDataURL
 *
 * That returns a `data:` URL — the mime type, a comma, and then the base64.
 * Graph wants `contentBytes` to be the base64 alone. Passing the whole URL
 * stores the prefix as part of the file, and the failure is invisible from
 * here: the send succeeds, the attachment arrives, and it is the recipient who
 * finds a PDF that will not open.
 *
 * WHY IT IS CHUNKED
 *
 * `String.fromCharCode(...bytes)` spreads every byte as a separate argument.
 * A one-megabyte attachment is a million arguments on the call stack, which
 * throws — and it throws on the big files rather than the small ones, so it
 * survives every test with a short string in it.
 *
 * 0x8000 is comfortably under the argument limit on every engine this runs in
 * and large enough that a 3MB attachment is fewer than a hundred passes.
 * ---------------------------------------------------------------------------
 */

const CHUNK = 0x8000;

/** Base64 for Graph's `contentBytes`: no `data:` prefix, no newlines. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The reverse, for bytes that arrived from Graph. */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
