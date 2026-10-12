import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { PageSkeleton } from "../components/Loading";
import PageErrorBoundary from "../components/PageErrorBoundary";
import { syncSentMail } from "../services/mailLog";
import { useAuth } from "../lib/auth";
import { keepLineWarm } from "../lib/warmLine";

/**
 * The shell every signed-in page sits inside.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NAVIGATION STATE LIVES HERE
 *
 * Below the `lg` breakpoint the sidebar becomes a drawer, which means the
 * Topbar's button and the Sidebar itself have to agree on whether it is open.
 * The nearest place both can see is this component, so the state sits here and
 * is handed down rather than lifted through a context nobody else would use.
 *
 * The drawer closes on navigation. Leaving it open over the page somebody just
 * asked for is the single most irritating thing a mobile nav can do, and it is
 * not obvious from a desktop browser that it is happening.
 *
 * THE RAIL
 *
 * On a small laptop (1366 px, and 1093 of them at Windows' 125%) the 240-px
 * sidebar took a fifth of the width from every page. It folds to a 64-px rail of
 * icons, by default below 1440 px, and the person's own choice is remembered in
 * this browser. The margins around the page tighten below `xl` as well.
 * ---------------------------------------------------------------------------
 */
const RAIL_KEY = "araxys:nav-rail";

function initialRail(): boolean {
  try {
    const kept = localStorage.getItem(RAIL_KEY);
    if (kept === "1" || kept === "0") return kept === "1";
  } catch {
    /* storage refused: fall back to the width */
  }
  return typeof window !== "undefined" && window.innerWidth < 1440;
}

export default function AppLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const [rail, setRail] = useState(initialRail);
  const { pathname } = useLocation();
  const { session } = useAuth();
  const mailbox = useRef("");
  mailbox.current = session?.email ?? "";

  const closeNav = useCallback(() => setNavOpen(false), []);
  const toggleRail = useCallback(() => {
    setRail((r) => {
      try {
        localStorage.setItem(RAIL_KEY, r ? "0" : "1");
      } catch {
        /* remembered for this visit only */
      }
      return !r;
    });
  }, []);

  // A tap on a nav link is a navigation, so the drawer's work is done.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  /*
    The desk's sent mail, copied into the log Team oversight reads (086).

    Here because this is the one component every signed-in page sits inside:
    a few seconds after the app opens, every five minutes while it stays open,
    and whenever the tab comes back into view. Quiet on failure; see
    services/mailLog.ts.
  */
  useEffect(() => {
    const first = window.setTimeout(() => void syncSentMail(), 4_000);
    const every = window.setInterval(() => void syncSentMail(), 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncSentMail();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  /*
    A link's page read before the click (lib/warm, 7 Oct): when the pointer
    rests on a link for a moment, presses it, or the keyboard reaches it, the
    case file, job, customer or board it leads to starts reading — its file
    too — so the page opens on its data instead of a skeleton. One listener for
    every link in the app, rather than one per link.
  */
  useEffect(() => {
    let timer = 0;
    let over: string | null = null;
    const hrefOf = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      return a ? a.getAttribute("href") : null;
    };
    const warm = (href: string) =>
      void import("../lib/warm").then((m) => m.warmLink(href, mailbox.current)).catch(() => {});
    const onOver = (e: PointerEvent) => {
      // A finger has no hover: its pointerover comes with the touch itself (onDown).
      if (e.pointerType === "touch") return;
      const href = hrefOf(e);
      if (href === over) return;
      over = href;
      window.clearTimeout(timer);
      // A pointer passing over the board on its way somewhere reads nothing.
      if (href) timer = window.setTimeout(() => warm(href), 80);
    };
    /*
      On a phone or an iPad (7 Oct): a finger landing on a link is a tap or the
      start of a scroll, and the browser calls a scroll off (pointercancel)
      within a few tens of milliseconds. So a touch reads after 50 ms unless it
      was called off — or at once when the finger lifts first, a quick tap — and
      flicking through a list reads nothing.
    */
    let touchTimer = 0;
    let touched: string | null = null;
    const touchGo = () => {
      window.clearTimeout(touchTimer);
      if (touched) warm(touched);
      touched = null;
    };
    const onDown = (e: PointerEvent) => {
      const href = hrefOf(e);
      if (!href) return;
      window.clearTimeout(timer);
      if (e.pointerType === "touch") {
        touched = href;
        window.clearTimeout(touchTimer);
        touchTimer = window.setTimeout(touchGo, 50);
        return;
      }
      warm(href);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "touch" && touched) touchGo();
    };
    const onCancel = () => {
      window.clearTimeout(touchTimer);
      touched = null;
    };
    const onFocus = (e: FocusEvent) => {
      const href = hrefOf(e);
      if (href) warm(href);
    };
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true, capture: true });
    document.addEventListener("pointerup", onUp, { passive: true, capture: true });
    document.addEventListener("pointercancel", onCancel, { passive: true, capture: true });
    document.addEventListener("focusin", onFocus);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(touchTimer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", onDown, { capture: true });
      document.removeEventListener("pointerup", onUp, { capture: true });
      document.removeEventListener("pointercancel", onCancel, { capture: true });
      document.removeEventListener("focusin", onFocus);
    };
  }, []);

  // The connection to the database kept open while the desk is in use (lib/warmLine).
  useEffect(() => keepLineWarm(), []);

  /*
    Every desk page's file, fetched once the app is idle, the most used first
    (6 Oct): a click on any page then opens it without first waiting for its
    file to download. One at a time, so the page in front keeps the
    connection; not on a connection that asks to save data. Each file is
    fetched once and kept by the browser (and the service worker).

    A phone (7 Oct) takes only the pages used on one — the boards, a case
    file, a job and its common tabs, mail — and so does a slow connection:
    every file is also run once it arrives, and fifty of them is seconds of a
    phone's processor and a few megabytes of its data. Safari has no idle
    callback, so there a file waits for a second with no touch, scroll or key,
    rather than landing in the middle of a scroll.
  */
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData) return;
    const small = window.matchMedia("(max-width: 767px)").matches;
    const slow = ["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "");
    const core = [
      // First the data of the pages used most (lib/warm, 7 Oct): the boards'
      // rows — My enquiries among them — and the Inbox, so the first visit to
      // each in a tab opens on them, on a laptop, an iPad or a phone alike.
      // Not when that page is the one already open: it is reading for itself.
      () => import("../lib/warm").then((m) => m.warmBoards()),
      () =>
        window.location.pathname.startsWith("/mail")
          ? Promise.resolve()
          : import("../lib/warm").then((m) => m.warmMail(mailbox.current, { bodies: !small })),
      () => import("../pages/Overview"),
      () => import("../pages/Enquiries"),
      () => import("../pages/CaseFile"),
      () => import("../pages/ShipmentsInProcess"),
      () => import("../pages/ShipmentDetail"),
      () => import("../pages/shipment/ShipmentOverview"),
      () => import("../pages/shipment/ShipmentTracking"),
      () => import("../pages/MyEnquiries"),
      () => import("../pages/Mail"),
      () => import("../pages/shipment/ShipmentDocuments"),
      () => import("../pages/shipment/ShipmentMail"),
    ];
    const rest = [
      () => import("../pages/Consoles"),
      () => import("../pages/shipment/ShipmentBill"),
      () => import("../pages/shipment/ShipmentParties"),
      () => import("../pages/shipment/ShipmentCargo"),
      () => import("../pages/shipment/ShipmentContainers"),
      () => import("../pages/shipment/ShipmentCustoms"),
      () => import("../pages/shipment/ShipmentPickupDelivery"),
      () => import("../pages/shipment/ShipmentInvoices"),
      () => import("../pages/shipment/ShipmentCosts"),
      () => import("../pages/shipment/ShipmentSignOff"),
      () => import("../pages/shipment/ShipmentWarehouse"),
      () => import("../pages/Customers"),
      () => import("../pages/CustomerFile"),
      () => import("../pages/Partners"),
      () => import("../pages/PartnerThreads"),
      () => import("../pages/PartnerMail"),
      () => import("../pages/QuoteApprovals"),
      () => import("../pages/EnquiriesOverview"),
      () => import("../pages/ShipmentsCompleted"),
      () => import("../pages/SailingSchedules"),
      () => import("../pages/LiveRates"),
      () => import("../pages/RateMaster"),
      () => import("../pages/Documentation"),
      () => import("../pages/ManualDocuments"),
      () => import("../pages/JobClosing"),
      () => import("../pages/Analytics"),
      () => import("../pages/Oversight"),
      () => import("../pages/CustomerEdit"),
      () => import("../pages/PartnerEdit"),
      () => import("../pages/accounts/Invoices"),
      () => import("../pages/accounts/Receipts"),
      () => import("../pages/accounts/Payments"),
      () => import("../pages/accounts/Outstanding"),
      () => import("../pages/accounts/PayablesReport"),
      () => import("../pages/accounts/AgentSOA"),
      () => import("../pages/accounts/DebitCredit"),
      () => import("../pages/accounts/FinalBill"),
      () => import("../pages/accounts/Proformas"),
      () => import("../pages/accounts/DebitNotes"),
      () => import("../pages/accounts/CreditNotes"),
      () => import("../pages/accounts/OverseasDebitNotes"),
      () => import("../pages/accounts/OverseasCreditNotes"),
      () => import("../pages/accounts/ReceiptDetails"),
      () => import("../pages/accounts/PaymentDetails"),
    ];
    const pages = small || slow ? core : [...core, ...rest];
    let cancelled = false;
    let lastInput = 0;
    const onInput = () => {
      lastInput = Date.now();
    };
    const inputs = ["pointerdown", "keydown", "wheel", "touchmove", "scroll"] as const;
    for (const t of inputs) window.addEventListener(t, onInput, { passive: true, capture: true });
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const quiet = (fn: () => void) => {
      if (cancelled) return;
      if (Date.now() - lastInput < 1_000) window.setTimeout(() => quiet(fn), 800);
      else fn();
    };
    const idle = (fn: () => void) => (ric ? ric(fn, { timeout: 4000 }) : window.setTimeout(() => quiet(fn), 1200));
    // One at a time, so the page in front keeps the connection.
    const next = (i: number) => {
      if (cancelled || i >= pages.length) return;
      idle(() => void pages[i]().catch(() => {}).finally(() => next(i + 1)));
    };
    // Soon after the page in front has had its own reads (half a second or so).
    const start = window.setTimeout(() => next(0), 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      for (const t of inputs) window.removeEventListener(t, onInput, { capture: true });
    };
  }, []);

  // Escape closes it, and the page behind must not scroll while it is over it.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  return (
    <div className="flex min-h-screen bg-surface-0">
      <Sidebar open={navOpen} onClose={closeNav} rail={rail} onToggleRail={toggleRail} />

      {/*
        min-w-0 is load-bearing. Without it a flex child refuses to shrink
        below its content, so one wide table anywhere in the app makes the
        whole page scroll sideways instead of the table scrolling inside it.
      */}
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar onOpenNav={() => setNavOpen(true)} />
        {/* Below xl the margins give 32 px of height and width back to the page (Mail's
            height sums them: 56 + 32 at lg, 56 + 48 from xl). */}
        <main className="flex-1 w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6 lg:px-5 lg:py-4 xl:px-8 xl:py-6">
          {/* A page still downloading waits here, under the sidebar and top bar,
              rather than taking the whole window with it. */}
          <Suspense fallback={<PageSkeleton />}>
            {/* One page failing to draw stays on that page (7 Oct): the shell goes on working. */}
            <PageErrorBoundary key={pathname}>
              <Outlet />
            </PageErrorBoundary>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
