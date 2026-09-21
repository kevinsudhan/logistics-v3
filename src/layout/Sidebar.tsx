import { NavLink } from "react-router-dom";
import { CompanyBrand, PoweredByAraxys } from "../components/Brand";
import { useAuth } from "../lib/auth";
import { ACCOUNTS_DESK } from "../lib/features";
import {
  Handshake,
  LayoutDashboard,
  Inbox,
  ClipboardList,
  Mail,
  PackageSearch,
  PackageCheck,
  Boxes,
  Ship,
  Layers,
  FileCheck2,
  MessageSquareWarning,
  Receipt,
  HandCoins,
  FileDown,
  FileText,
  FilePlus,
  FileMinus,
  Scale,
  Globe,
  Wallet,
  ListChecks,
  BarChart3,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  /** Only the overview matches on the exact path; the rest own their subtrees. */
  end?: boolean;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
  adminOnly?: boolean;
  /**
   * Draw a rule above this group.
   *
   * Accounts is not another kind of operation, it is a different desk — the
   * people who chase a payment are not the people who book a container, and
   * running them together in one list makes the accounts screens look like an
   * afterthought attached to operations.
   */
  separated?: boolean;
}

const groups: NavGroup[] = [
  { items: [{ to: "/", label: "Overview", icon: LayoutDashboard, end: true }] },
  {
    title: "Pipeline",
    items: [
      // In the order the work moves: the queue, the shared board, then the
      // slice of that board this person has taken on.
      { to: "/intake", label: "Enquiries", icon: ClipboardList },
      { to: "/enquiries", label: "Inbound enquiries", icon: Inbox },
      { to: "/my-enquiries", label: "My enquiries", icon: UserCheck },
      { to: "/shipments/in-process", label: "In-process shipments", icon: PackageSearch },
      { to: "/shipments/completed", label: "Completed shipments", icon: PackageCheck },
    ],
  },
  {
    title: "Operations",
    items: [
      // Before containers: a console is the commercial object and the
      // container is the space it fills.
      { to: "/consoles", label: "Consoles", icon: Layers },
      { to: "/containers", label: "Containers", icon: Ship },
      { to: "/space-containers", label: "Space & containers", icon: Boxes },
      { to: "/documentation", label: "Documentation", icon: FileCheck2 },
      { to: "/mail", label: "Mail", icon: Mail },
      { to: "/complaints", label: "Complaints", icon: MessageSquareWarning },
      { to: "/partners", label: "Partners", icon: Handshake },
    ],
  },
  // Spread rather than filtered at render, so that with the desk off the group
  // is not in the array at all. A runtime filter hides the links correctly but
  // still ships fourteen labels and their paths in the bundle, which is a list
  // of what this build is pretending not to have.
  ...(!ACCOUNTS_DESK
    ? []
    : [
  {
    // Its own group rather than a line in Operations. The money is a different
    // kind of work from moving a box, and it is the half of the desk that had
    // no surface at all until now.
    //
    // Raising an invoice is not here — that happens on the shipment, because an
    // invoice is about a job. What is here are the questions that span jobs.
    title: "Accounts",
    separated: true,
    items: [
      // In the order money moves: what we raise, what comes in, what goes out,
      // then the questions asked across all of it.
      { to: "/accounts/invoices", label: "Invoices", icon: Receipt },
      { to: "/accounts/proformas", label: "Proformas", icon: FileText },
      { to: "/accounts/debit-notes", label: "Debit notes", icon: FilePlus },
      { to: "/accounts/credit-notes", label: "Credit notes", icon: FileMinus },
      { to: "/accounts/receipts", label: "Receipts", icon: HandCoins },
      { to: "/accounts/payments", label: "Payments", icon: FileDown },
      { to: "/accounts/final-bill", label: "Final bill", icon: Scale },
      { to: "/accounts/overseas-debit-notes", label: "Overseas debit notes", icon: Globe },
      { to: "/accounts/overseas-credit-notes", label: "Overseas credit notes", icon: Globe },
      { to: "/accounts/agent-soa", label: "Agent SOA", icon: Handshake },
      { to: "/accounts/outstanding", label: "Outstanding", icon: Wallet },
      { to: "/accounts/payables", label: "Payables", icon: Wallet },
      { to: "/accounts/receipt-details", label: "Receipt details", icon: ListChecks },
      { to: "/accounts/payment-details", label: "Payment details", icon: ListChecks },
    ],
  },
      ]),
  {
    title: "Insights",
    // Accounts carries the rule when it is there. With it off, Insights would
    // otherwise run straight on from Operations as though it were more of the
    // same, so it takes the rule instead.
    separated: !ACCOUNTS_DESK,
    items: [{ to: "/analytics", label: "Analytics", icon: BarChart3 }],
  },
  // Only an administrator sees this group. The check is cosmetic — the page
  // refuses an employee on its own — but a link that leads to a refusal is a
  // worse interface than no link.
  { title: "Admin", adminOnly: true, items: [{ to: "/oversight", label: "Team oversight", icon: ShieldCheck }] },
];

/**
 * Navigation, as a fixed rail on a desk and a drawer on a phone.
 *
 * ---------------------------------------------------------------------------
 * ONE COMPONENT, TWO PRESENTATIONS
 *
 * The list is rendered once and positioned differently by breakpoint rather
 * than duplicated into a separate mobile menu. A second copy of the nav is a
 * second place to add a link to, and the one that gets forgotten is always the
 * one you are not looking at.
 *
 * The drawer slides rather than appears, because a panel that covers most of
 * the screen instantly gives no clue where it came from or how to dismiss it.
 * It is translated off-screen instead of unmounted so the transition has
 * something to animate in both directions. That does leave the parked links
 * reachable by keyboard on a narrow screen, which is a real cost and the reason
 * the drawer also closes on Escape and on every navigation.
 * ---------------------------------------------------------------------------
 */
export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useAuth();
  const visible = groups.filter((g) => !g.adminOnly || session?.role === "admin");

  return (
    <>
      {/* The scrim. Tapping anywhere off the panel is the fastest way out. */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-30 bg-black/30 backdrop-blur-[1px] transition-opacity duration-200 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/*
        Two position values, one element. `fixed` is the drawer; at `lg` it
        becomes `sticky`, and `inset-y-auto` releases the top/bottom pinning the
        drawer needed so the sticky rail can size itself to the viewport
        instead. Never both `static` and `sticky` at the same breakpoint — which
        of those wins depends on the order Tailwind happens to emit them in, not
        on the order they are written here.
      */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-[17rem] shrink-0 border-r border-border bg-surface-1
          flex flex-col transition-transform duration-200 ease-out
          ${open ? "translate-x-0" : "-translate-x-full"}
          lg:sticky lg:inset-y-auto lg:top-0 lg:z-auto lg:w-60 lg:h-screen lg:translate-x-0
        `}
      >
        <div className="flex items-start justify-between gap-2 px-5 py-5">
          <CompanyBrand size="sm" descriptor="Freight ops CRM" />
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="lg:hidden -mr-1 rounded-lg p-1 text-text-muted hover:bg-surface-2 hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
          {visible.map((group, gi) => (
            <div
              key={gi}
              className={group.separated ? "mb-4 mt-4 border-t border-border pt-4" : "mb-4"}
            >
              {group.title && (
                <p className="px-2 mb-1 text-[11px] uppercase tracking-wide text-text-muted font-medium">
                  {group.title}
                </p>
              )}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] mb-0.5 transition-colors ${
                      isActive
                        ? "bg-surface-2 text-text-primary font-medium"
                        : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {/* A brand-coloured marker, so the active row reads at a glance. */}
                      <span
                        className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-brand transition-opacity ${
                          isActive ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <item.icon size={16} className={isActive ? "text-brand" : ""} />
                      <span className="truncate">{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-border">
          <PoweredByAraxys />
        </div>
      </aside>
    </>
  );
}
