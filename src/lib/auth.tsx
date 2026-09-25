import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";
import { adoptMicrosoftSession, clearGraphToken, finishOutlookConnect } from "../services/graphMail";

/**
 * Authentication, for real this time.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, AND WHY IT MATTERS
 *
 * This used to be a list of email/password pairs compiled into the bundle. That
 * could never be secure: the check ran on the visitor's machine, and anyone who
 * opened devtools could read every credential. It was a gate, not a lock.
 *
 * Now Supabase holds bcrypt hashes and does the verification. The browser sends
 * a password to Supabase's auth endpoint and gets back a signed JWT; it never
 * sees another user's credential, and no password exists anywhere in this
 * codebase. Rate limiting, lockout, refresh-token rotation and password reset
 * come with it.
 *
 * THE ROLE IS NOT SELF-REPORTED. It is read from the `profiles` table, whose RLS
 * policy lets a signed-in user select only their own row and gives nobody an
 * UPDATE path. The underlying claim lives in auth.users.app_metadata, which the
 * user cannot write to -- deliberately not user_metadata, which they can. If the
 * role were stored where the user could edit it, any employee could PATCH
 * themselves to admin and this app would believe them.
 *
 * STILL TO DO before this faces the public internet: serve over HTTPS (a JWT on
 * a plain connection is readable in transit), and replace the shared starter
 * password so each person holds their own.
 * ---------------------------------------------------------------------------
 */

export type Role = "admin" | "employee";

/**
 * Admin is a superset of employee, not a sibling of it.
 *
 * Treating the two as separate sets meant an administrator could not open the
 * operations CRM at all: the link on the admin page navigated to it and the
 * guard bounced them straight back, so the button looked dead. The person who
 * runs the company is not locked out of the desk their staff use.
 */
export function canAccess(userRole: Role, areaRole: Role): boolean {
  return userRole === "admin" || userRole === areaRole;
}

export interface Session {
  userId: string;
  email: string;
  name: string;
  role: Role;
  /** Appended to new messages. Graph cannot read the Outlook one, so we keep our own. */
  signature: string;
  /**
   * Never waits for quote approval, and may clear other people's (062).
   *
   * Admins, plus anyone flagged as an approver on their profile. The same rule
   * as `approval_exempt()` in the database, which is what actually enforces it;
   * this copy only decides which buttons to show.
   */
  canApproveQuotes: boolean;
}

interface AuthValue {
  session: Session | null;
  /** True until the stored session has been checked, so guards do not bounce too early. */
  loading: boolean;
  /** Resolves to an error message, or null on success. */
  signIn: (email: string, password: string, expectedRole: Role) => Promise<string | null>;
  /** Redirects to Microsoft; returns only if starting the redirect failed. */
  signInWithMicrosoft: () => Promise<string | null>;
  /** Saves the caller's own signature. Returns an error message, or null. */
  saveSignature: (signature: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Reads the caller's own profile row. RLS makes any other row unreachable. */
async function loadProfile(userId: string, fallbackEmail: string): Promise<Session | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, signature, can_approve_quotes")
    .eq("id", userId)
    .single();

  if (error || !data) return null;

  return {
    userId: data.id,
    email: data.email ?? fallbackEmail,
    name: data.full_name || (data.email ?? fallbackEmail).split("@")[0],
    role: data.role === "admin" ? "admin" : "employee",
    signature: data.signature ?? "",
    canApproveQuotes: data.role === "admin" || data.can_approve_quotes === true,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Held while an explicit sign-in is in flight.
   *
   * signInWithPassword makes Supabase emit SIGNED_IN the moment the password is
   * accepted -- before this code has checked whether the account's role matches
   * the door it came in through. Without this guard the listener publishes a
   * session, the login page's redirect effect fires on it, and the user is sent
   * into the app a beat before being signed out again: no error message, and a
   * visible flash of a page they are not entitled to.
   *
   * So during signIn the listener stays quiet and signIn alone decides what the
   * session becomes.
   */
  const signingIn = useRef(false);

  /**
   * Restore an existing session on load, and follow it thereafter.
   *
   * onAuthStateChange covers token refresh and sign-out from another tab, so the
   * app cannot sit on a session Supabase has already invalidated.
   */
  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      // Microsoft's own tokens ride along on the session Supabase built from
      // the OAuth callback. It is the only moment they are available, so they
      // are taken up here rather than fetched later -- there is no later. The
      // refresh token goes to the server, which keeps Outlook connected (094).
      adoptMicrosoftSession(data.session);
      // Back from connecting Outlook on the Mail page (095): its first token
      // is fetched before the app shows, so the page opens already connected.
      if (user) await finishOutlookConnect();
      if (!cancelled) {
        setSession(user ? await loadProfile(user.id, user.email ?? "") : null);
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (cancelled || signingIn.current) return;
      // Deferred: handing the refresh token over calls a function, and a
      // Supabase call made inside this callback waits on the lock it holds.
      setTimeout(() => adoptMicrosoftSession(s), 0);
      const user = s?.user;
      setSession(user ? await loadProfile(user.id, user.email ?? "") : null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string, expectedRole: Role): Promise<string | null> => {
      signingIn.current = true;
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });

        // Supabase returns one message for a bad address and a bad password
        // alike, which is what we want: telling someone which half they got
        // right is a gift to whoever is guessing.
        if (error || !data.user) {
          return (
            error?.message?.replace(/^Invalid login credentials$/, "Incorrect email or password.") ??
            "Incorrect email or password."
          );
        }

        const profile = await loadProfile(data.user.id, data.user.email ?? "");
        if (!profile) {
          await supabase.auth.signOut();
          return "This account has no profile set up. Contact your administrator.";
        }

        /**
         * The door has to match the account. Signing out on a mismatch matters:
         * the credentials were valid, so a session now exists, and leaving it in
         * place would let someone who signed in at the wrong door simply
         * navigate to the right one.
         */
        if (!canAccess(profile.role, expectedRole)) {
          await supabase.auth.signOut();
          return "This account does not have admin access. Use the employee sign-in.";
        }

        setSession(profile);
        return null;
      } finally {
        // Cleared only once the outcome is decided, so the listener never
        // publishes a session this function is about to reject.
        signingIn.current = false;
      }
    },
    []
  );

  /**
   * Microsoft sign-in.
   *
   * The mail scopes are requested here, not in the Azure app registration, so
   * the consent screen names exactly what the CRM will do with the mailbox.
   * offline_access is included because without it Microsoft issues no refresh
   * token at all.
   */
  const signInWithMicrosoft = useCallback(async (): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "profile email offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send",
        redirectTo: `${window.location.origin}/`,
      },
    });
    return error?.message ?? null;
  }, []);

  /**
   * Writes the signature to the caller's own profile row.
   *
   * RLS allows this update and nothing else: the policy pins `role` to its
   * current value, so this path cannot be turned into self-promotion.
   */
  const saveSignature = useCallback(
    async (signature: string): Promise<string | null> => {
      if (!session) return "Not signed in.";
      const { error } = await supabase
        .from("profiles")
        .update({ signature })
        .eq("id", session.userId);
      if (error) return error.message;
      setSession({ ...session, signature });
      return null;
    },
    [session]
  );

  const signOut = useCallback(async () => {
    // The mailbox token must go with the session. Leaving it behind would let
    // the next person in this tab read the previous one's Outlook.
    clearGraphToken();
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ session, loading, signIn, signInWithMicrosoft, saveSignature, signOut }),
    [session, loading, signIn, signInWithMicrosoft, saveSignature, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
