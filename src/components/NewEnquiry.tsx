import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import Select from "./Select";
import { useDialog } from "../lib/useDialog";
import {
  createEnquiry,
  findOrCreateCustomer,
  listCustomers,
  type Customer,
  type EnquirySource,
} from "../services/enquiries";

/**
 * Opens an enquiry by hand.
 *
 * ---------------------------------------------------------------------------
 * IT NO LONGER STARTS FROM A MESSAGE
 *
 * This used to take a `fromMessage` and do three things at once: create the
 * customer from the sender, record them as a party, and bind the mail thread so
 * later replies filed themselves. All of that now happens when an intake row is
 * pushed through, which means mail has one route into the pipeline instead of
 * two that behaved differently.
 *
 * What is left is the case the queue does not cover: somebody at the desk who
 * already knows this is a real enquiry and wants to open it directly. There is
 * no message to bind, so there is nothing to carry.
 * ---------------------------------------------------------------------------
 */
export default function NewEnquiry({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (ref: string) => void;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [cargo, setCargo] = useState("");
  const [source, setSource] = useState<EnquirySource>("call");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listCustomers().then(setCustomers);
  }, []);

  // Tab stays inside, Escape closes (not when it only shut a dropdown), focus goes back on closing.
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, onClose);

  const newCustomer = !customerId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newCustomer && !name.trim()) return setError("Enter the customer's name.");

    setBusy(true);
    try {
      const customer = customerId
        ? customers.find((c) => c.id === customerId)!
        : await findOrCreateCustomer({
            name: name.trim(),
            company: company.trim(),
            email: email.trim() || undefined,
            phone: phone.trim() || undefined,
          });

      const enquiry = await createEnquiry({
        customerId: customer.id,
        source,
        origin: origin.trim() || undefined,
        destination: destination.trim() || undefined,
        cargo: cargo.trim() || undefined,
      });

      onCreated(enquiry.ref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the enquiry.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        ref={box}
        className="w-full max-w-lg card shadow-xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New enquiry"
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-[14px] font-medium text-text-primary">New enquiry</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4" noValidate>
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Customer
            </label>
            <Select
              label="Customer"
              value={customerId}
              onChange={setCustomerId}
              options={[
                { value: "", label: "New customer", hint: "Creates a record with its own id" },
                ...customers.map((c) => ({
                  value: c.id,
                  label: c.company || c.name,
                  hint: c.id,
                })),
              ]}
            />
          </div>

          {newCustomer && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" value={name} onChange={setName} placeholder="Contact name" />
              <Field label="Company" value={company} onChange={setCompany} placeholder="Company" />
              <Field label="Email" value={email} onChange={setEmail} placeholder="name@company.com" />
              <Field label="Phone" value={phone} onChange={setPhone} placeholder="+91…" />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Origin" value={origin} onChange={setOrigin} placeholder="Chennai" />
            <Field label="Destination" value={destination} onChange={setDestination} placeholder="Jebel Ali" />
          </div>

          <Field label="Cargo" value={cargo} onChange={setCargo} placeholder="What is being shipped" />

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Came in by
            </label>
            <Select
              label="Came in by"
              value={source}
              onChange={(v) => setSource(v as EnquirySource)}
              options={[
                { value: "email", label: "Email" },
                { value: "call", label: "Phone call" },
                { value: "whatsapp", label: "WhatsApp" },
                { value: "web", label: "Website form" },
                { value: "manual", label: "Entered by hand" },
              ]}
            />
          </div>

          <p className="text-[11px] text-text-muted">
            Only the customer is required. Route, cargo and dimensions can be filled in as the
            conversation goes on — the enquiry needs a reference now so everything else can hang
            off it.
          </p>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger"
            >
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </form>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {busy ? "Opening…" : "Open enquiry"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-text-secondary mb-1.5">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full"
        autoComplete="off"
      />
    </div>
  );
}
