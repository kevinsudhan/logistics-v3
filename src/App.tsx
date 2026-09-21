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
const ShipmentParties = lazy(() => import("./pages/shipment/ShipmentParties"));
const ShipmentCosts = accountsPage(() => import("./pages/shipment/ShipmentCosts"));
const SpaceContainers = lazy(() => import("./pages/SpaceContainers"));
const Containers = lazy(() => import("./pages/Containers"));
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
const Partners = lazy(() => import("./pages/Partners"));
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
              <Route path="parties" element={<ShipmentParties />} />
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
            <Route path="/containers" element={<Containers />} />
            <Route path="/space-containers" element={<SpaceContainers />} />
            <Route path="/documentation" element={<Documentation />} />
            <Route path="/mail" element={<Mail />} />
            <Route path="/intake" element={<Intake />} />
            <Route path="/enquiries" element={<Enquiries />} />
            <Route path="/my-enquiries" element={<MyEnquiries />} />
            <Route path="/oversight" element={<Oversight />} />
            <Route path="/enquiries/:ref" element={<CaseFile />} />
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
            <Route path="/partners" element={<Partners />} />
            <Route path="/analytics" element={<Analytics />} />
          </Route>
        </Route>

        {/* Unknown paths land on the employee door, which redirects on if signed in. */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
