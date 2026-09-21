/**
 * Which desks this build shows.
 *
 * ---------------------------------------------------------------------------
 * WHY A FLAG AND NOT A SECOND CODEBASE
 *
 * Because the copy that goes into production has to be the copy that gets
 * maintained. A fork with the accounts pages deleted was built and thrown away
 * for exactly this reason: development carries on here, so every mail fix,
 * every Graph quirk, every threading bug would have had to be noticed and
 * hand-ported into the thing actually answering customer mail -- and the port
 * is where the bugs the original never had come from.
 *
 * One tree, one flag. Production runs with the accounts desk off; this is the
 * same code either way.
 *
 * TURNING IT BACK ON IS A BUILD SETTING, NOT A PROJECT
 *
 * That is the other half. The schema is whole in every environment -- invoices,
 * payments, bills and agent statements are all still there, created by the same
 * migrations -- so switching the desk on is a value in `.env.local` and a
 * rebuild. With a fork it would have meant applying fourteen migrations to a
 * live database that a different migration set had built.
 *
 * WHY THE ISOLATION IS NOT IN HERE
 *
 * A flag hides a surface; it does not separate data. What keeps production
 * records away from development is the Supabase project each build points at,
 * set by VITE_SUPABASE_URL. Two environments, one codebase.
 *
 * WHY IT DEFAULTS OFF
 *
 * It defaulted on at first, so that an existing checkout would not quietly
 * lose fourteen pages. That was the wrong way round the moment this desk went
 * to production on mail: `.env.local` is gitignored, so a deploy never sees it
 * and would have built with the default -- putting the accounts desk back on
 * the one build that is not supposed to have it.
 *
 * Off is what you get unless somebody asks for it. On is the deliberate act,
 * and `.env.local` in a development checkout is where that is said.
 * ---------------------------------------------------------------------------
 */

/**
 * Invoices, proformas, notes, receipts, payments, outstanding, payables and the
 * agent statement -- plus the Costs and Invoices sections of a shipment and the
 * Billing section of a case file.
 *
 * When this is false the routes are not registered at all, not merely hidden
 * from the sidebar. A nav that omits a link somebody can still reach by typing
 * the path is not a build without the accounts desk; it is a build with an
 * undocumented one.
 */
export const ACCOUNTS_DESK = import.meta.env.VITE_ACCOUNTS_DESK === "on";

/**
 * The case file, reduced to the correspondence.
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * While this desk is a mailbox, an enquiry is a conversation and nothing else.
 * The cargo fields, the partner rates, the quotation and the document register
 * are all real and all built, and every one of them is a form somebody has to
 * decide not to fill in. On a screen whose only job today is "read this and
 * answer it", four sections of empty fields are four invitations to go and do
 * something the desk is not doing yet.
 *
 * So the case file opens on the correspondence and shows only that. The
 * enquiry's own header stays -- the reference, the customer, the route -- which
 * is not a form, it is how you know which conversation you are in.
 *
 * WHAT THIS IS NOT
 *
 * Deletion. Every panel is still in the tree and still works; this decides
 * whether the tab strip offers them. Turning it back on is `off` in
 * `.env.local` and a rebuild, and the sections return exactly as they were.
 * ---------------------------------------------------------------------------
 */
export const MAIL_ONLY_CASE_FILE = import.meta.env.VITE_CASE_FILE !== "full";
