/**
 * Brand lockups.
 *
 * Aashish Logistics Global is the company and owns the primary mark. Araxys is
 * the platform underneath, credited quietly — a corner byline, never competing
 * with the customer's own name.
 *
 * ---------------------------------------------------------------------------
 * BOTH MARKS ARE NOW THE REAL ARTWORK
 *
 * The company mark used to be an SVG globe drawn by hand, and the Araxys
 * wordmark was set in CSS as tracked-out uppercase. Both were stand-ins that
 * looked close enough at small sizes and were wrong in the ways stand-ins
 * always are: the drawn globe was a flat two-colour outline where the real mark
 * is a rendered sphere, and the set text matched neither the weight nor the
 * letterforms of the real wordmark.
 *
 * They are served from `public/`, trimmed to their own edges so the layout
 * controls the spacing rather than inheriting whatever margin the export had.
 *
 * WHY THE WORDMARK SHIPS TWICE
 *
 * The byline appears on a light sidebar and over dark video on the login
 * screen. The artwork is near-black navy, which vanishes against the second.
 * A CSS filter could invert it, but only correctly while the mark stays one
 * flat colour, so a white copy is generated instead and picked by `tone`. Both
 * come from the same source file and keep identical letterforms and edges.
 * ---------------------------------------------------------------------------
 */

/** The Araxys wordmark. `tone` picks the copy that will be legible. */
export function AraxysWordmark({
  className = "",
  tone = "light",
}: {
  className?: string;
  /** "light" means a light background, so the dark artwork is used. */
  tone?: "light" | "dark";
}) {
  return (
    <img
      src={tone === "dark" ? "/araxys-wordmark-light.png" : "/araxys-wordmark.png"}
      alt="Araxys"
      // Height is set by the caller and the width follows, because the mark is
      // much wider than it is tall and a fixed width would crush it.
      className={`w-auto object-contain ${className}`}
      draggable={false}
    />
  );
}

/** The byline. `tone` picks legible colours for light panels or dark imagery. */
export function PoweredByAraxys({
  tone = "light",
  className = "",
  stacked = false,
}: {
  tone?: "light" | "dark";
  className?: string;
  /** "Powered by" over the wordmark, for a centred credit like the sign-in panel's. */
  stacked?: boolean;
}) {
  const muted = tone === "dark" ? "text-white/40" : "text-text-muted";

  if (stacked) {
    return (
      <span className={`inline-flex flex-col items-center gap-1.5 ${className}`}>
        <span className={`text-[10px] uppercase tracking-[0.2em] ${muted}`}>Powered by</span>
        <AraxysWordmark tone={tone} className={`h-[13px] ${tone === "dark" ? "opacity-85" : "opacity-75"}`} />
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] ${muted} ${className}`}>
      Powered by
      {/*
        Slightly under the cap height of the words beside it, so the lockup
        reads as one line rather than as a logo dropped into a sentence. The
        opacity keeps it a credit rather than a second brand competing with the
        customer's own name at the foot of their sidebar.
      */}
      <AraxysWordmark tone={tone} className={`h-[9px] ${tone === "dark" ? "opacity-80" : "opacity-70"}`} />
    </span>
  );
}

/**
 * The company lockup: mark plus name.
 *
 * `descriptor` puts a second line under the name for the sidebar; leaving it
 * out keeps the lockup to one line where vertical space is tight.
 */
export function CompanyBrand({
  size = "md",
  descriptor,
  tone = "light",
}: {
  size?: "sm" | "md" | "lg";
  descriptor?: string;
  tone?: "light" | "dark";
}) {
  const box = size === "lg" ? "w-10 h-10" : size === "sm" ? "w-8 h-8" : "w-9 h-9";
  const name = size === "lg" ? "text-[16px]" : size === "sm" ? "text-[13px]" : "text-[14px]";
  const nameColor = tone === "dark" ? "text-white" : "text-text-primary";
  const descColor = tone === "dark" ? "text-white/50" : "text-text-muted";

  return (
    <div className="flex items-center gap-2.5">
      {/*
        No tinted tile behind it any more. The mark is a full-colour rendered
        sphere that brings its own shape and its own light; boxing it in a flat
        green square would fight both. It is a touch larger than the old glyph
        to compensate for losing that box.
      */}
      <img
        src="/media/mark-v1.webp"
        alt=""
        aria-hidden="true"
        className={`${box} shrink-0 rounded-[24%] object-cover shadow-sm`}
        draggable={false}
      />
      <div className="min-w-0">
        <p className={`${name} ${nameColor} font-semibold tracking-tight leading-tight truncate`}>
          Aashish Logistics Global
        </p>
        {descriptor && <p className={`text-[11px] ${descColor} leading-tight`}>{descriptor}</p>}
      </div>
    </div>
  );
}
