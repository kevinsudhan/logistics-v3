import { Suspense, lazy, type ComponentType } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./layout/AppLayout";
import RequireAuth from "./components/RequireAuth";
import { ACCOUNTS_DESK } from "./lib/features";

/**
 * A page that only exists when the accounts desk is switched on.
 *
 * `lazy(() => import(...))` at module scope is a dynamic import Rollup can see,
 * and it emits a chunk for it whether or not a route ever points at it.
 * Unreferenced chunks are never fetched, so hiding the routes alone is enough
 * for the person using the app -- but it still ships the accounts pages to the
 * server, and "off" ought to mean the code is not there.
 *
 * `ACCOUNTS_DESK` folds to a literal at build time, because Vite substitutes
 * `import.meta.env.VITE_ACCOUNTS_DESK` before Rollup runs. The dead branch and
 * the import inside it are then dropped.
 */
type PageModule = { default: ComponentType<Record<string, never>> };
const noPage = (): Promise<PageModule> => Promise.resolve({ default: () => null });
const accountsPage = (load: () => Promise<PageModule>) => lazy(ACCOUNTS_DESK ? load : noPage);

const Login = lazy(() => import("./pages/Login"));
const AdminControl = lazy(() => import("./pages/AdminControl"));

const Overview = lazy(() => import("./pages/Overview"));
const ShipmentsInProcess = lazy(() => import("./pages/ShipmentsInProcess"));
const ShipmentsCompleted = lazy(() => import("./pages/ShipmentsCompleted"));
const ShipmentDetail = lazy(() => import("./pages/ShipmentDetail"));
const ShipmentOverview = lazy(() => import("./pages/shipment/ShipmentOverview"));
const ShipmentInvoices = accountsPage(() => import("./pages/shipment/ShipmentInvoices"));
const ShipmentContainers = lazy(() => import("./pages/shipment/ShipmentContainers"));
const ShipmentMail = lazy(() => import("./pages/shipment/ShipmentMail"));
const ShipmentParties = lazy(() => import("./pages/shipment/ShipmentParties"));
const ShipmentCargo = lazy(() => import("./pages/shipment/ShipmentCargo"));
const ShipmentBill = lazy(() => import("./pages/shipment/ShipmentBill"));
const ShipmentDocuments = lazy(() => import("./pages/shipment/ShipmentDocuments"));
const ShipmentPickupDelivery = lazy(() => import("./pages/shipment/ShipmentPickupDelivery"));
const ShipmentWarehouse = lazy(() => import("./pages/shipment/ShipmentWarehouse"));
const ShipmentCustoms = lazy(() => import("./pages/shipment/ShipmentCustoms"));
const ShipmentTracking = lazy(() => import("./pages/shipment/ShipmentTracking"));
const ShipmentSignOff = lazy(() => import("./pages/shipment/ShipmentSignOff"));
const ShipmentCosts = accountsPage(() => import("./pages/shipment/ShipmentCosts"));
const Consoles = lazy(() => import("./pages/Consoles"));
const Documentation = lazy(() => import("./pages/Documentation"));
const Mail = lazy(() => import("./pages/Mail"));
const Intake = lazy(() => import("./pages/Intake"));
const Enquiries = lazy(() => import("./pages/Enquiries"));
const MyEnquiries = lazy(() => import("./pages/MyEnquiries"));
const Oversight = lazy(() => import("./pages/Oversight"));
const CaseFile = lazy(() => import("./pages/CaseFile"));
const Complaints = lazy(() => import("./pages/Complaints"));
// Accounts — one page per document, the way the desk's own menu reads.
const AcInvoices   = accountsPage(() => import("./pages/accounts/Invoices"));
const AcProformas  = accountsPage(() => import("./pages/accounts/Proformas"));
const AcDebit      = accountsPage(() => import("./pages/accounts/DebitNotes"));
const AcCredit     = accountsPage(() => import("./pages/accounts/CreditNotes"));
const AcOvDebit    = accountsPage(() => import("./pages/accounts/OverseasDebitNotes"));
const AcOvCredit   = accountsPage(() => import("./pages/accounts/OverseasCreditNotes"));
const AcFinalBill  = accountsPage(() => import("./pages/accounts/FinalBill"));
const AcReceipts   = accountsPage(() => import("./pages/accounts/Receipts"));
const AcPayments   = accountsPage(() => import("./pages/accounts/Payments"));
const AcOutstanding= accountsPage(() => import("./pages/accounts/Outstanding"));
const AcPayables   = accountsPage(() => import("./pages/accounts/PayablesReport"));
const AcRcptDetail = accountsPage(() => import("./pages/accounts/ReceiptDetails"));
const AcPayDetail  = accountsPage(() => import("./pages/accounts/PaymentDetails"));
const AcAgentSOA   = accountsPage(() => import("./pages/accounts/AgentSOA"));
const QuoteAccept = lazy(() => import("./pages/QuoteAccept"));
const TrackShipment = lazy(() => import("./pages/TrackShipment"));
const RateMaster = lazy(() => import("./pages/RateMaster"));
const QuoteApprovals = lazy(() => import("./pages/QuoteApprovals"));
const SailingSchedules = lazy(() => import("./pages/SailingSchedules"));
const Customers = lazy(() => import("./pages/Customers"));
const CustomerFile = lazy(() => import("./pages/CustomerFile"));
const CustomerEdit = lazy(() => import("./pages/CustomerEdit"));
const Partners = lazy(() => import("./pages/Partners"));
const PartnerEdit = lazy(() => import("./pages/PartnerEdit"));
const PartnerMail = lazy(() => import("./pages/PartnerMail"));
const PartnerThreads = lazy(() => import("./pages/PartnerThreads"));
const Analytics = lazy(() => import("./pages/Analytics"));

function PageFallback() {
  return <div className="text-sm text-text-muted py-10">Loading…</div>;
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Sign-in — the two doors. */}
        <Route path="/login" element={<Login role="employee" />} />
        <Route path="/admin/login" element={<Login role="admin" />} />

        {/*
          The customer's quotation page — outside the guard, because the person
          reading it has no account here and should not need one to say yes.
          Its token is the whole of its authority, and everything it can reach
          is fixed by `quote_by_token` (053) rather than by a policy somebody
          could widen later.
        */}
        <Route path="/q/:token" element={<QuoteAccept />} />
        <Route path="/t/:token" element={<TrackShipment />} />

        {/* Admin area. */}
        <Route element={<RequireAuth role="admin" />}>
          <Route path="/admin" element={<AdminControl />} />
        </Route>

        {/* The CRM. Everything inside is employee-only. */}
        <Route element={<RequireAuth role="employee" />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Overview />} />
            <Route path="/shipments/in-process" element={<ShipmentsInProcess />} />
            <Route path="/shipments/completed" element={<ShipmentsCompleted />} />
            {/*
              The shipment is one page with sections, not several pages.
              Keeping the section in the path means a refresh lands where you
              were and a colleague can be sent straight to a job's invoices.
            */}
            <Route path="/shipments/:id" element={<ShipmentDetail />}>
              <Route index element={<ShipmentOverview />} />
              <Route path="mail" element={<ShipmentMail />} />
              <Route path="parties" element={<ShipmentParties />} />
              <Route path="cargo" element={<ShipmentCargo />} />
              <Route path="bill" element={<ShipmentBill />} />
              <Route path="documents" element={<ShipmentDocuments />} />
              <Route path="pickup-delivery" element={<ShipmentPickupDelivery />} />
              <Route path="warehouse" element={<ShipmentWarehouse />} />
              <Route path="customs" element={<ShipmentCustoms />} />
              <Route path="tracking" element={<ShipmentTracking />} />
              <Route path="sign-off" element={<ShipmentSignOff />} />
              <Route path="containers" element={<ShipmentContainers />} />
              {/*
                React Router skips non-elements among <Routes> children and
                flattens fragments, so a conditional here registers the routes
                or does not -- it does not leave a dead path behind.
              */}
              {ACCOUNTS_DESK && (
                <>
                  <Route path="invoices" element={<ShipmentInvoices />} />
                  <Route path="costs" element={<ShipmentCosts />} />
                </>
              )}
            </Route>
            <Route path="/consoles" element={<Consoles />} />
            {/* Containers live under their departure on the sailing schedule now; old links land there. */}
            <Route path="/containers" element={<Navigate to="/sailing-schedule" replace />} />
            <Route path="/space-containers" element={<Navigate to="/sailing-schedule" replace />} />
            <Route path="/documentation" element={<Documentation />} />
            <Route path="/mail" element={<Mail />} />
            <Route path="/intake" element={<Intake />} />
            <Route path="/enquiries" element={<Enquiries />} />
            <Route path="/my-enquiries" element={<MyEnquiries />} />
            <Route path="/oversight" element={<Oversight />} />
            {/*
              The case file, on two paths, rendering the same component.

              The sidebar matches on the path — `/enquiries` owns its subtree —
              so a case file opened from My enquiries at `/enquiries/ALG09002-26`
              lit up Inbound enquiries and read as though you had left your own
              list for the shared board. You had not; the URL simply said so.

              Under `/my-enquiries/:ref` the nav highlights where you actually
              are, the address bar agrees, and Back has somewhere obvious to go.
              `/enquiries/:ref` stays for every other way in — a pasted
              reference, a link from the mail screen, a shipment.
            */}
            <Route path="/enquiries/:ref" element={<CaseFile />} />
            <Route path="/my-enquiries/:ref" element={<CaseFile />} />
            <Route path="/complaints" element={<Complaints />} />
            {/* Accounts. Each document its own page; raising one still happens
                on the job, because a document is about a job.

                The whole desk is behind ACCOUNTS_DESK. With it off these paths
                do not exist, and the catch-all below sends anyone who follows
                an old link to the overview rather than to the sign-in page,
                which is where an unmatched path would otherwise land them. */}
            {ACCOUNTS_DESK ? (
              <>
                <Route path="/accounts/invoices" element={<AcInvoices />} />
                <Route path="/accounts/proformas" element={<AcProformas />} />
                <Route path="/accounts/debit-notes" element={<AcDebit />} />
                <Route path="/accounts/credit-notes" element={<AcCredit />} />
                <Route path="/accounts/overseas-debit-notes" element={<AcOvDebit />} />
                <Route path="/accounts/overseas-credit-notes" element={<AcOvCredit />} />
                <Route path="/accounts/final-bill" element={<AcFinalBill />} />
                <Route path="/accounts/receipts" element={<AcReceipts />} />
                <Route path="/accounts/payments" element={<AcPayments />} />
                <Route path="/accounts/outstanding" element={<AcOutstanding />} />
                <Route path="/accounts/payables" element={<AcPayables />} />
                <Route path="/accounts/receipt-details" element={<AcRcptDetail />} />
                <Route path="/accounts/payment-details" element={<AcPayDetail />} />
                <Route path="/accounts/agent-soa" element={<AcAgentSOA />} />
                {/* The old paths, so links already sent still land. */}
                <Route path="/billing" element={<Navigate to="/accounts/invoices" replace />} />
                <Route path="/receipts" element={<Navigate to="/accounts/receipts" replace />} />
                <Route path="/payables" element={<Navigate to="/accounts/payables" replace />} />
              </>
            ) : (
              <>
                <Route path="/accounts/*" element={<Navigate to="/" replace />} />
                <Route path="/billing" element={<Navigate to="/" replace />} />
                <Route path="/receipts" element={<Navigate to="/" replace />} />
                <Route path="/payables" element={<Navigate to="/" replace />} />
              </>
            )}
            {/*
              Three jobs, three pages. The directory is maintenance — somebody
              new, an address changed, somebody retired. Adding is its own page
              because a half-finished partner is a thing you get interrupted in
              the middle of, and a dialog has no URL to come back to. The mail
              is the daily work and does not belong behind either of them.

              `/partners/new` is declared before `/partners/mail/:id` only for
              reading order; React Router ranks static segments above dynamic
              ones regardless, so "new" is never taken for an id.
            */}
            {/*
              The customers, the same three jobs as partners and in the same
              shape: a directory to find them by, a file holding everything
              they have ever given us, and an edit page of its own because
              somebody typing a GSTIN off a letterhead gets interrupted.

              `/customers/new` is declared before `/customers/:id` for reading
              order only; React Router ranks static segments above dynamic ones,
              so "new" is never taken for a customer id.
            */}
            <Route path="/rates" element={<RateMaster />} />
            {/*
              Not gated by the router. The page checks the approver flag itself
              and explains, which is better than a 404 for somebody following a
              colleague's link — and the rule that matters is enforced in
              `decide_quote`, where the browser cannot reach it.
            */}
            <Route path="/approvals" element={<QuoteApprovals />} />
            <Route path="/sailing-schedule" element={<SailingSchedules />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/new" element={<CustomerEdit />} />
            <Route path="/customers/:id" element={<CustomerFile />} />
            <Route path="/customers/:id/edit" element={<CustomerEdit />} />

            <Route path="/partners" element={<Partners />} />
            <Route path="/partners/new" element={<PartnerEdit />} />
            <Route path="/partners/:id/edit" element={<PartnerEdit />} />
            <Route path="/partners/mail" element={<PartnerMail />} />
            <Route path="/partners/mail/:id" element={<PartnerThreads />} />
            <Route path="/analytics" element={<Analytics />} />
          </Route>
        </Route>

        {/* Unknown paths land on the employee door, which redirects on if signed in. */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
