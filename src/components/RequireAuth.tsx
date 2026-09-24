import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth, canAccess, type Role } from "../lib/auth";
import { BootScreen } from "./Loading";

/**
 * Route guard. Wraps a group of routes and sends anyone without the right
 * session to the matching sign-in page.
 *
 * A signed-in user who reaches for the other role's area is sent to their own
 * home rather than to a sign-in form -- they are not unauthenticated, they are
 * in the wrong place, and showing them a login box implies the wrong fix.
 */
export default function RequireAuth({ role }: { role: Role }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  /**
   * Restoring a stored session is asynchronous. Redirecting before that settles
   * would bounce a signed-in user to the login page on every refresh, so hold
   * the render until we actually know.
   */
  if (loading) {
    return <BootScreen />;
  }

  if (!session) {
    const to = role === "admin" ? "/admin/login" : "/login";
    // `from` lets the sign-in bounce them back to the page they wanted.
    return <Navigate to={to} state={{ from: location.pathname }} replace />;
  }

  if (!canAccess(session.role, role)) {
    return <Navigate to={session.role === "admin" ? "/admin" : "/"} replace />;
  }

  return <Outlet />;
}
