/**
 * Swapping `cid:` references in a mail body for something a browser can draw.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE
 *
 * So it can be tested. `graphMail.ts` builds the Supabase client at import time,
 * which needs Vite's `import.meta.env` and will not load under plain Node — the
 * same reason `applyPlan` was split out of `intake`. The fiddly part is here and
 * the network is there.
 *
 * WHAT IS FIDDLY ABOUT IT
 *
 * A Content-ID is written three ways by three clients. Outlook produces
 * `<image001.png@01DA...>` in the attachment metadata and `cid:image001.png@01DA...`
 * in the body -- angle brackets on one side and not the other. Others keep the
 * brackets in both, or drop them in both. Matching the wrong one leaves the
 * image as a `cid:` the view then deletes, which is exactly the failure this
 * exists to fix and looks identical to doing nothing.
 * ---------------------------------------------------------------------------
 */

export interface ResolvedImage {
  /** The Content-ID as the attachment reported it, brackets or not. */
  cid: string;
  /** A `data:` URI carrying the bytes. */
  uri: string;
}

/** `<image001@01DA>` and `image001@01DA` are the same id written two ways. */
export const bareCid = (cid: string) => cid.trim().replace(/^<+/, "").replace(/>+$/, "");

/**
 * Rewrites every `cid:` src that has a resolved image behind it.
 *
 * Anything without one is left exactly as it was, for the view to drop. A
 * half-resolved body with one real logo and one broken-image icon is worse than
 * either outcome on its own.
 */
export function rewriteCidImages(html: string, images: ResolvedImage[]): string {
  if (!html || !images.length || !html.includes("cid:")) return html;

  let out = html;
  for (const image of images) {
    const id = bareCid(image.cid);
    if (!id) continue;

    // Split/join rather than a regex: a Content-ID contains dots, and can
    // contain the other characters a filename can, all of which would need
    // escaping to go into a pattern safely.
    out = out.split(`cid:<${id}>`).join(image.uri);
    out = out.split(`cid:${id}`).join(image.uri);
  }
  return out;
}

/** Whether an attachment is an image the message draws in its own body. */
export function isEmbeddedImage(a: {
  contentType?: string | null;
  isInline?: boolean | null;
  contentId?: string | null;
}): boolean {
  return Boolean(a.isInline && a.contentId && a.contentType?.startsWith("image/"));
}
