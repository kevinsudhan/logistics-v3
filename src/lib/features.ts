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
 * WHY IT DEFAULTS ON
 *
 * So that an existing checkout does not quietly lose fourteen pages because
 * somebody's .env.local predates this file. Off is the deliberate act.
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
export const ACCOUNTS_DESK = import.meta.env.VITE_ACCOUNTS_DESK !== "off";
