import { Suspense, useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { PageSkeleton } from "../components/Loading";

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
 * ---------------------------------------------------------------------------
 */
export default function AppLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();

  const closeNav = useCallback(() => setNavOpen(false), []);

  // A tap on a nav link is a navigation, so the drawer's work is done.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

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
      <Sidebar open={navOpen} onClose={closeNav} />

      {/*
        min-w-0 is load-bearing. Without it a flex child refuses to shrink
        below its content, so one wide table anywhere in the app makes the
        whole page scroll sideways instead of the table scrolling inside it.
      */}
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar onOpenNav={() => setNavOpen(true)} />
        <main className="flex-1 w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
          {/* A page still downloading waits here, under the sidebar and top bar,
              rather than taking the whole window with it. */}
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
