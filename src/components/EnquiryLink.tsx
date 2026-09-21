import { Link, useLocation, type LinkProps } from "react-router-dom";

/**
 * A link into a case file that remembers which board it was clicked from.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CASE FILE CANNOT WORK THIS OUT ITSELF
 *
 * Its Back link used to say "All enquiries" and go to `/enquiries`, whatever
 * you had been looking at. Opening one of your own from My enquiries and
 * pressing Back put you on the shared board, which is the one page you were
 * deliberately not on — the whole point of having a personal list is that it is
 * narrower than the global one, and being returned to the global one throws
 * that away every time.
 *
 * React Router does not hand a route its predecessor, and `navigate(-1)` is not
 * it either: the case file is often opened from a fresh tab or a pasted
 * reference, where going back means leaving the CRM.
 *
 * So the link says where it came from, in `state`. The case file reads it and
 * falls back to the shared board when there is nothing — which is exactly the
 * old behaviour, and the right answer for a reference somebody typed in.
 *
 * WHY THE SEARCH IS CARRIED TOO
 *
 * The boards keep their filters in the query string. Returning to `/enquiries`
 * from a case file you reached through a tag filter should return to that
 * filter, not to the unfiltered list you would then have to narrow again.
 * ---------------------------------------------------------------------------
 */
export default function EnquiryLink({ children, ...props }: LinkProps) {
  const location = useLocation();
  return (
    <Link {...props} state={{ from: `${location.pathname}${location.search}` }}>
      {children}
    </Link>
  );
}
