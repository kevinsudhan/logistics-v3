/**
 * Our own logo in an outgoing mail, carried inside the message.
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * A mail that points at an image on a web server shows a blank box in Outlook
 * until the reader chooses "download pictures", and a quotation opening with
 * a blank box where the letterhead should be is the first thing a customer
 * sees. An image attached to the message and referred to as `cid:` is part of
 * the message, so Outlook and Gmail draw it straight away.
 *
 * HOW
 *
 * The body names the image by its address on this app — /brand/… — which the
 * compose window can show. At send, each such <img> is found here, its bytes
 * are fetched (services/graphMail.ts), it goes as an inline attachment, and
 * its src becomes `cid:`. Only /brand/ on this app's own origin is touched: a
 * signature image in the public bucket, or anything pasted in, stays as it
 * was rather than this reaching out to fetch arbitrary addresses.
 * ---------------------------------------------------------------------------
 */

const BRAND_DIR = "/brand/";

export interface BrandImage {
  /** The src as written in the body. */
  src: string;
  /** "aashish-logo-email.jpg" */
  file: string;
  /** What the message refers to it by. */
  contentId: string;
}

const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi;

/** The distinct brand images an HTML body shows, on this origin. */
export function brandImages(html: string, origin: string): BrandImage[] {
  const out = new Map<string, BrandImage>();
  for (const m of html.matchAll(IMG_SRC)) {
    const src = m[2].replace(/&amp;/g, "&");
    let path: string;
    try {
      const url = new URL(src, origin);
      if (url.origin !== new URL(origin).origin) continue;
      path = url.pathname;
    } catch {
      continue;
    }
    if (!path.startsWith(BRAND_DIR)) continue;
    const file = path.slice(BRAND_DIR.length);
    if (!/^[\w.-]+\.(png|jpe?g|gif)$/i.test(file)) continue;
    out.set(m[2], { src: m[2], file, contentId: `${file}@aashish-logistics` });
  }
  return [...out.values()];
}

/** The body with each image's src replaced by its cid. */
export function withContentIds(html: string, images: BrandImage[]): string {
  if (!images.length) return html;
  const by = new Map(images.map((i) => [i.src, i.contentId]));
  return html.replace(IMG_SRC, (whole, quote: string, src: string) => {
    const cid = by.get(src);
    return cid ? whole.replace(`${quote}${src}${quote}`, `${quote}cid:${cid}${quote}`) : whole;
  });
}

export const imageType = (file: string) =>
  /\.png$/i.test(file) ? "image/png" : /\.gif$/i.test(file) ? "image/gif" : "image/jpeg";
