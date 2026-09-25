import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, KeyRound, Loader2, Plus, UserPlus, Users } from "lucide-react";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { addStaff, listStaff, setStaffDisabled, setStaffFlags, setStaffPassword, setStaffRole, type StaffMember } from "../services/staff";

/**
 * Who can sign in to the CRM, for an administrator.
 *
 * Public sign-up is off, so this is the door: an account made here, with its
 * email confirmed, signs in with Microsoft (the Microsoft identity links to it
 * by the email) or with a password set here. Disabling somebody signs them out
 * of everything and keeps them out, without losing what they did.
 */
/** The project's password rule (26 Sep 2026); the staff-accounts function checks the same. */
const weakPassword = (pw: string) => pw.length < 10 || !/[a-z]/i.test(pw) || !/\d/.test(pw);

export default function StaffAccounts() {
  const { session } = useAuth();
  const [people, setPeople] = useState<StaffMember[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", role: "employee" as "admin" | "employee", password: "" });
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [pw, setPw] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setPeople(await listStaff());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the accounts.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<StaffMember[]>, said?: string) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      setPeople(await fn());
      if (said) setNote(said);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const input = "h-8 rounded-lg border border-border bg-surface-1 px-2.5 text-[12.5px] text-text-primary";
  const small = "inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-50";

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-medium text-text-primary">
            <Users size={15} className="text-brand" /> Staff accounts
          </h2>
          <p className="mt-1 max-w-prose text-[12.5px] text-text-secondary">
            Nobody can sign themselves up: an account exists because it was added here. New people sign in with Microsoft using their company email, or with a password you set.
          </p>
        </div>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark">
            <UserPlus size={13} /> Add a person
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" /> {error}
        </p>
      )}
      {note && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-bg-success px-3 py-2 text-[12px] text-text-success">
          <Check size={13} className="mt-px shrink-0" /> {note}
        </p>
      )}

      {adding && (
        <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input className={input} placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} aria-label="Full name" />
            <input className={input} placeholder="name@aashishlogistics.com" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="Email" />
            <select className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "employee" })} aria-label="Role">
              <option value="employee">Employee</option>
              <option value="admin">Administrator</option>
            </select>
            <input
              className={input}
              type="password"
              autoComplete="new-password"
              placeholder="Password (optional)"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              aria-label="Starting password, optional"
            />
          </div>
          <p className="mt-2 text-[11.5px] text-text-muted">
            Leave the password blank for someone who will sign in with Microsoft. A password needs 10 or more characters, with letters and a number.
            {form.email && !/@aashishlogistics\.com$/i.test(form.email.trim()) && (
              <span className="ml-1 text-text-warning">Not a company address: Microsoft sign-in will not work for it, so give it a password.</span>
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy !== null || !form.full_name.trim() || !form.email.trim() || (form.password !== "" && weakPassword(form.password))}
              onClick={() =>
                void run(
                  "add",
                  async () => {
                    const r = await addStaff({ ...form, password: form.password || undefined });
                    setAdding(false);
                    setForm({ full_name: "", email: "", role: "employee", password: "" });
                    return r;
                  },
                  `${form.full_name.trim()} can sign in now${form.password ? " with the password you set" : " with Microsoft"}.`
                )
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {busy === "add" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
            </button>
            <button type="button" onClick={() => setAdding(false)} className="h-8 px-3 text-[12px] text-text-secondary hover:text-text-primary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!people ? (
        !error && (
          <p className="mt-4 flex items-center gap-2 text-[12px] text-text-muted">
            <Loader2 size={12} className="animate-spin" /> Loading the accounts…
          </p>
        )
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                <th className="py-1.5 pr-3 font-medium">Person</th>
                <th className="py-1.5 pr-3 font-medium">Role</th>
                <th className="py-1.5 pr-3 font-medium">May</th>
                <th className="py-1.5 pr-3 font-medium">Signs in with</th>
                <th className="py-1.5 pr-3 font-medium">Last sign-in</th>
                <th className="py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {people.map((p) => {
                const me = p.id === session?.userId;
                return (
                  <tr key={p.id} className={p.disabled ? "opacity-60" : undefined}>
                    <td className="py-2 pr-3">
                      <span className="block font-medium text-text-primary">
                        {p.full_name || p.email}
                        {me && <span className="ml-1.5 text-[11px] font-normal text-text-muted">(you)</span>}
                        {p.disabled && <span className="ml-1.5 rounded-full bg-bg-danger px-1.5 text-[10.5px] font-medium text-text-danger">Disabled</span>}
                      </span>
                      <span className="block text-[11.5px] text-text-muted">{p.email}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className={`${input} h-7`}
                        value={p.role}
                        disabled={busy !== null || me}
                        title={me ? "You cannot change your own role" : undefined}
                        onChange={(e) => void run(`role-${p.id}`, () => setStaffRole(p.id, e.target.value as "admin" | "employee"), `${p.full_name || p.email} is now ${e.target.value === "admin" ? "an administrator" : "an employee"}.`)}
                        aria-label={`Role of ${p.full_name || p.email}`}
                      >
                        <option value="employee">Employee</option>
                        <option value="admin">Administrator</option>
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      {p.role === "admin" ? (
                        <span className="text-[11.5px] text-text-muted">Everything</span>
                      ) : (
                        <span className="flex flex-col gap-0.5 text-[11.5px] text-text-secondary">
                          <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={p.can_approve_quotes} disabled={busy !== null} onChange={(e) => void run(`flag-${p.id}`, () => setStaffFlags(p.id, { can_approve_quotes: e.target.checked }))} />
                            Approve quotations
                          </label>
                          <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={p.can_assign} disabled={busy !== null} onChange={(e) => void run(`flag-${p.id}`, () => setStaffFlags(p.id, { can_assign: e.target.checked }))} />
                            Assign enquiries
                          </label>
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[11.5px] text-text-secondary">
                      {p.sign_in.map((m) => (m === "microsoft" ? "Microsoft" : m === "password" ? "Password" : m)).join(" · ") || "—"}
                    </td>
                    <td className="py-2 pr-3 text-[11.5px] tabular-nums text-text-secondary">
                      {p.last_sign_in_at ? formatDate(p.last_sign_in_at, { day: "numeric", month: "short", year: "numeric" }) : "Never"}
                    </td>
                    <td className="py-2 text-right">
                      {pwFor === p.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <input
                            className={`${input} h-7 w-44`}
                            type="password"
                            autoComplete="new-password"
                            placeholder="10+, letters and a number"
                            value={pw}
                            onChange={(e) => setPw(e.target.value)}
                            aria-label={`New password for ${p.full_name || p.email}`}
                          />
                          <button
                            type="button"
                            className={small}
                            disabled={busy !== null || weakPassword(pw)}
                            onClick={() =>
                              void run(
                                `pw-${p.id}`,
                                async () => {
                                  const r = await setStaffPassword(p.id, pw);
                                  setPwFor(null);
                                  setPw("");
                                  return r;
                                },
                                `New password set for ${p.full_name || p.email}. Give it to them in person or by phone, not by email.`
                              )
                            }
                          >
                            Set
                          </button>
                          <button type="button" className="text-[11.5px] text-text-muted hover:text-text-primary" onClick={() => { setPwFor(null); setPw(""); }}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1.5">
                          <button type="button" className={small} disabled={busy !== null} onClick={() => { setPwFor(p.id); setPw(""); }}>
                            <KeyRound size={11} /> Password
                          </button>
                          {!me && (
                            <button
                              type="button"
                              className={small}
                              disabled={busy !== null}
                              onClick={() => {
                                if (!p.disabled && !window.confirm(`Disable ${p.full_name || p.email}? They are signed out and cannot sign back in; everything they did stays.`)) return;
                                void run(`dis-${p.id}`, () => setStaffDisabled(p.id, !p.disabled), `${p.full_name || p.email} ${p.disabled ? "can sign in again" : "is disabled"}.`);
                              }}
                            >
                              {p.disabled ? "Enable" : "Disable"}
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
