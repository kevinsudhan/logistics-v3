import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { useAuth, canAccess, type Role } from "../lib/auth";
import { CompanyBrand, PoweredByAraxys } from "../components/Brand";
/*
  From the registry, not from the barrel.

  This page wants one number — how many documents the desk can issue — for a
  line on the marketing panel. The barrel re-exports that list alongside
  `generateDocument`, which reaches jsPDF and, through it, html2canvas: about
  745KB of PDF machinery, pulled into the chunk that renders the sign-in screen,
  to print a count.

  `registry` imports nothing but types.
*/
import { BootScreen } from "../components/Loading";


/**
 * Split sign-in: the video carries the brand, the right half does the work.
 *
 * One component serves both doors. The role comes from the route rather than a
 * toggle inside the form, so /login and /admin/login are genuinely two pages --
 * they can be linked to, bookmarked, and put behind different links in the
 * product -- while the markup stays in one place.
 */
export default function Login({ role }: { role: Role }) {
  const { session, loading: restoring, signIn, signInWithMicrosoft } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const isAdmin = role === "admin";
  const home = isAdmin ? "/admin" : "/";

  /**
   * Already signed in: skip the form.
   *
   * Sent to the door they came to when their role allows it, not to whatever
   * their role's default is -- an admin who deliberately opens the employee
   * sign-in wants the CRM, and bouncing them to /admin would make that
   * impossible.
   */
  useEffect(() => {
    if (!session) return;
    const to = canAccess(session.role, role) ? home : session.role === "admin" ? "/admin" : "/";
    navigate(to, { replace: true });
  }, [session, role, home, navigate]);

  useEffect(() => {
    emailRef.current?.focus();
  }, [role]);

  // Switching doors should not carry a failed attempt's error across with it.
  useEffect(() => {
    setError(null);
    setPassword("");
  }, [role]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Enter both an email address and a password.");
      return;
    }

    setBusy(true);
    const message = await signIn(email, password, role);
    setBusy(false);

    if (message) {
      setError(message);
      setPassword("");
      return;
    }
    navigate(home, { replace: true });
  }

  // Don't flash the form at someone who is already signed in and about to be
  // redirected away from it.
  if (restoring) {
    return <BootScreen />;
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-surface-0">
      {/* ---------------------------------------------------------------- */}
      {/* Left: the video panel.                                            */}
      {/* Hidden below lg -- a background is not worth downloading on a      */}
      {/* phone to look at behind a form.                                    */}
      {/*                                                                    */}
      {/* The clip was 18 MB with its index at the end, so nothing played    */}
      {/* until nearly all of it had arrived. It is now ~1.5 MB, silent,     */}
      {/* index first (plays as it streams), with its first frame as the     */}
      {/* poster so the panel is never blank. Versioned names: cached for a */}
      {/* year (netlify.toml); a new clip gets a new name.                   */}
      {/* ---------------------------------------------------------------- */}
      <div className="relative hidden lg:block overflow-hidden bg-[#0b1a17]">
        <video
          className="absolute inset-0 w-full h-full object-cover"
          poster="/media/login-poster-v2.webp"
          autoPlay
          muted
          loop
          playsInline
          /* Autoplay only works muted. */
          preload="auto"
          aria-hidden="true"
          src="/media/login-v2.mp4"
        />

        {/* Darkened so white type stays legible over any frame of the footage. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(6,20,17,0.72) 0%, rgba(6,20,17,0.45) 40%, rgba(6,20,17,0.88) 100%)",
          }}
        />

        {/*
          Just the company: the mark and the name, large, where a slogan used
          to sit, and the platform's credit in the corner. The footage says
          what the business does.
        */}
        <div className="relative h-full flex flex-col p-12 text-white">
          <div className="my-auto">
            <CompanyBrand size="xl" tone="dark" />
          </div>
          <div className="flex justify-end">
            <PoweredByAraxys tone="dark" />
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Right: the form.                                                  */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px]">
          {/* Brand mark for small screens, where the video panel is hidden. */}
          <div className="lg:hidden mb-10">
            <CompanyBrand />
          </div>

          <div
            className={`inline-flex items-center gap-1.5 mb-5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
              isAdmin ? "bg-bg-warning text-text-warning" : "bg-bg-accent text-text-accent"
            }`}
          >
            <ShieldCheck size={12} />
            {isAdmin ? "Administrator access" : "Employee access"}
          </div>

          <h2 className="text-[24px] font-semibold tracking-tight text-text-primary">
            {isAdmin ? "Admin control" : "Sign in"}
          </h2>
          <p className="mt-1.5 text-[13px] text-text-secondary">
            {isAdmin
              ? "Manage agents, users and system configuration."
              : "Access the operations desk — requests, shipments and documents."}
          </p>

          {/*
            Microsoft first, and visually primary. It is the only route that
            also connects the person's Outlook mailbox, so it is the one we want
            people taking; the password form below stays for accounts that have
            not been moved across yet.
          */}
          <button
            type="button"
            onClick={async () => {
              setError(null);
              setBusy(true);
              const message = await signInWithMicrosoft();
              if (message) {
                setError(message);
                setBusy(false);
              }
              // On success the browser leaves for Microsoft; nothing to do here.
            }}
            disabled={busy}
            className="mt-7 w-full h-10 rounded-lg border border-border-strong bg-surface-1 hover:bg-surface-2 disabled:opacity-60 text-[13px] font-medium text-text-primary flex items-center justify-center gap-2.5 transition-colors"
          >
            <MicrosoftLogo />
            Sign in with Microsoft
          </button>

          <div className="flex items-center gap-3 my-5">
            <span className="flex-1 h-px bg-border" />
            <span className="text-[11px] text-text-muted">or use a password</span>
            <span className="flex-1 h-px bg-border" />
          </div>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="email"
                className="block text-[12px] font-medium text-text-secondary mb-1.5"
              >
                Email
              </label>
              <input
                id="email"
                ref={emailRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                className="w-full"
                placeholder={
                  isAdmin ? "aashish@aashishlogistics.com" : "name@aashishlogistics.com"
                }
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-[12px] font-medium text-text-secondary mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full pr-10"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger"
              >
                <AlertCircle size={13} className="mt-px shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-10 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13px] font-medium flex items-center justify-center gap-2 transition-colors"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? "Signing in…" : isAdmin ? "Sign in to admin" : "Sign in"}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-border">
            <Link
              to={isAdmin ? "/login" : "/admin/login"}
              className="text-[12px] text-text-accent hover:underline"
            >
              {isAdmin ? "← Employee sign-in" : "Administrator sign-in →"}
            </Link>
          </div>

          <p className="mt-8 text-[11px] leading-relaxed text-text-muted">
            Signing in with Microsoft also connects your Outlook mailbox to the CRM. Passwords
            are verified by Supabase and never stored in this application.
          </p>

          <div className="mt-5 pt-4 border-t border-border lg:hidden">
            <PoweredByAraxys />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Microsoft's four squares, drawn rather than fetched — no external asset. */
function MicrosoftLogo() {
  return (
    <svg width="15" height="15" viewBox="0 0 23 23" aria-hidden="true">
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}
