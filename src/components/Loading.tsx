/**
 * Waiting, shown in the shape of what is coming.
 *
 * One set for the whole app so every wait looks like the same product:
 *
 *   BootScreen      the whole window, while a stored session is restored
 *   PageSkeleton    a page on its way: its header, a toolbar, a list
 *   ListSkeleton    rows under a header and toolbar already drawn
 *   SectionSkeleton a few lines inside a panel or a tab
 *   InlineLoading   a word and three dots, where there is room for no more
 *
 * Each announces itself once to a screen reader ("Loading") and hides its
 * shapes, which mean nothing read aloud. The shapes fade in after 140ms, so
 * a quick load shows nothing at all (index.css, "Loading").
 */

/** Widths that vary row to row, so the list reads as content rather than a pattern. */
const WIDTHS = ["72%", "58%", "84%", "64%", "76%", "52%", "80%", "68%"];

function Status({ label = "Loading", className = "", children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" className={`load-appear ${className}`}>
      <span className="sr-only">{label}</span>
      <div aria-hidden>{children}</div>
    </div>
  );
}

function Bar({ w, h = 10, block = false, delay = 0 }: { w: string | number; h?: number; block?: boolean; delay?: number }) {
  return (
    <span
      className={`skeleton ${block ? "skeleton-block" : ""}`}
      style={{ width: w, height: h, animationDelay: delay ? `${delay}ms` : undefined }}
    />
  );
}

function Rows({ rows, avatar }: { rows: number; avatar: boolean }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          {avatar && <Bar w={32} h={32} block delay={i * 90} />}
          <div className="min-w-0 flex-1 space-y-2">
            <Bar w={WIDTHS[i % WIDTHS.length]} h={10} delay={i * 90} />
            <Bar w={`calc(${WIDTHS[(i + 3) % WIDTHS.length]} - 20%)`} h={8} delay={i * 90 + 45} />
          </div>
          <Bar w={64} h={20} delay={i * 90 + 90} />
        </div>
      ))}
    </>
  );
}

/** A page on its way: a title, a line under it, a toolbar and a card of rows. */
export function PageSkeleton({ rows = 7, label }: { rows?: number; label?: string }) {
  return (
    <Status label={label} className="py-1">
      <div className="mb-6 space-y-2.5">
        <Bar w={200} h={18} />
        <Bar w="min(420px, 80%)" h={10} delay={60} />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Bar w={112} h={32} block />
        <Bar w="min(320px, 55%)" h={32} block delay={40} />
        <Bar w={84} h={32} block delay={80} />
      </div>
      <div className="card divide-y divide-border overflow-hidden">
        <Rows rows={rows} avatar />
      </div>
    </Status>
  );
}

/** Rows in a card, for a list whose header and toolbar are already on screen. */
export function ListSkeleton({ rows = 6, bare = false, avatar = true, label }: { rows?: number; bare?: boolean; avatar?: boolean; label?: string }) {
  return (
    <Status label={label}>
      <div className={bare ? "divide-y divide-border" : "card divide-y divide-border overflow-hidden"}>
        <Rows rows={rows} avatar={avatar} />
      </div>
    </Status>
  );
}

/** A few lines, for a panel or a tab that fills a space already laid out. */
export function SectionSkeleton({ lines = 3, label, className = "py-4" }: { lines?: number; label?: string; className?: string }) {
  return (
    <Status label={label} className={className}>
      <div className="space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="space-y-2">
            <Bar w={WIDTHS[i % WIDTHS.length]} h={10} delay={i * 110} />
            <Bar w={`calc(${WIDTHS[(i + 5) % WIDTHS.length]} - 25%)`} h={8} delay={i * 110 + 55} />
          </div>
        ))}
      </div>
    </Status>
  );
}

/** "Loading the quotation" and three dots, where a skeleton would be too much. */
export function InlineLoading({ label = "Loading", className = "py-6" }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={`load-appear flex items-center gap-2.5 text-[13px] text-text-muted ${className}`}>
      <span aria-hidden className="flex items-center gap-1">
        <span className="load-dot" />
        <span className="load-dot" style={{ animationDelay: "0.15s" }} />
        <span className="load-dot" style={{ animationDelay: "0.3s" }} />
      </span>
      {label}
    </div>
  );
}

/** The whole window, while the app finds out who is signed in. */
export function BootScreen() {
  return (
    <div role="status" aria-live="polite" className="grid min-h-screen place-items-center bg-surface-0 px-6">
      <span className="sr-only">Loading</span>
      <div aria-hidden className="load-appear flex w-48 flex-col items-center">
        <img src="/media/mark-v1.webp" alt="" className="load-breathe h-16 w-16 rounded-[24%] object-cover shadow-[0_10px_24px_-10px_rgba(15,33,58,0.6)]" />
        <p className="mt-4 text-[13px] font-medium tracking-wide text-text-secondary">Aashish Logistics Global</p>
        <div className="load-bar mt-4 w-full" />
      </div>
    </div>
  );
}
