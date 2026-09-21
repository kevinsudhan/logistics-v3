import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { CompanyBrand, PoweredByAraxys } from "../components/Brand";
import ReplyLog from "../components/ReplyLog";

/**
 * The administrator's landing page.
 *
 * Everything on it reads a table. It used to carry two panels listing features
 * that did not exist, under a banner admitting every figure was illustrative --
 * which is worse than a shorter page, because a reader cannot tell which half
 * of a screen like that is real.
 *
 * Team oversight answers "who has which enquiry and how long have they had
 * it". The reply log answers "is an agent being left waiting", which is the
 * same question about the half of the desk that has no enquiry attached to it.
 */
export default function AdminControl() {
  const { session, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-surface-0">
      <header className="h-14 border-b border-border bg-surface-1 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <CompanyBrand size="sm" />
          <span className="px-2 py-0.5 rounded-full bg-bg-warning text-text-warning text-[10px] font-medium">
            Admin
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-[12px] text-text-secondary">
            {session?.name} · administrator
          </span>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-text-primary">
              Admin control
            </h1>
            <p className="mt-1 text-[13px] text-text-secondary">
              System configuration, user access and voice-agent management.
            </p>
          </div>
          <Link
            to="/"
            className="flex items-center gap-1.5 text-[12px] text-text-accent hover:underline"
          >
            Open the operations CRM
            <ArrowUpRight size={13} />
          </Link>
        </div>

        <Link
          to="/oversight"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 card p-5 hover:border-border-strong transition-colors"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[15px] font-medium text-text-primary">
              <Activity size={15} className="text-brand" />
              Team oversight
            </p>
            <p className="mt-1 text-[13px] text-text-secondary max-w-prose">
              Every enquiry, when it came in, who took it on and how long that took. Open one to
              read everything that has been done to it and by whom.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand text-white text-[12px] font-medium shrink-0">
            Open
            <ArrowUpRight size={13} />
          </span>
        </Link>

        {/*
          Users, access and system configuration belonged here as two panels
          listing features that did not exist — "Role permissions", "Data
          retention" — under a banner admitting every figure was illustrative.
          A screen that describes what it might one day do is worse than a
          shorter screen that does something, because the reader cannot tell
          which half is real. They are gone; what is here reads a table.
        */}
        <div className="mt-6">
          <ReplyLog />
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-6 pb-8">
        <PoweredByAraxys />
      </footer>
    </div>
  );
}

