import { supabase } from "../lib/supabase";

/**
 * Staff accounts, for an administrator (the staff-accounts edge function).
 *
 * Public sign-up is off (25 Sep 2026): an account exists because an
 * administrator made it. Creating, re-roling and disabling accounts needs the
 * service key, so it happens in the function, which checks the caller is an
 * administrator; the browser only asks.
 */

export interface StaffMember {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "employee";
  can_approve_quotes: boolean;
  can_assign: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  /** "microsoft", "password". */
  sign_in: string[];
  disabled: boolean;
}

async function call(body: Record<string, unknown>): Promise<StaffMember[]> {
  const { data, error } = await supabase.functions.invoke("staff-accounts", { body });
  // The function's own refusal is in the body; supabase-js wraps a non-2xx.
  if (error) {
    const said = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(said?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return (data?.people ?? []) as StaffMember[];
}

export const listStaff = () => call({ action: "list" });

export const addStaff = (input: { email: string; full_name: string; role: "admin" | "employee"; password?: string }) =>
  call({ action: "create", ...input });

export const setStaffRole = (id: string, role: "admin" | "employee") => call({ action: "set_role", id, role });

export const setStaffFlags = (id: string, flags: { can_approve_quotes?: boolean; can_assign?: boolean }) =>
  call({ action: "set_flags", id, ...flags });

export const setStaffPassword = (id: string, password: string) => call({ action: "set_password", id, password });

export const setStaffDisabled = (id: string, disabled: boolean) => call({ action: "set_disabled", id, disabled });
