-- 096: The last two security advisor findings.
--
-- ---------------------------------------------------------------------------
-- 1. FUNCTIONS WITH NO FIXED search_path (13)
--
-- A function without one resolves every unqualified name through whatever
-- search_path its caller happens to have, so a caller who could create an
-- object earlier on that path could have it run in place of the one meant.
-- Nobody but the owner can create in `public` here, so this was never open
-- to a stranger; it is fixed so it cannot become so.
--
-- Each of the thirteen was read first: they call only built-in functions,
-- which are always found in pg_catalog whatever the path, and every table or
-- function of ours they touch is already written `public.…`. So the strictest
-- setting, an empty path, changes nothing they do.
--
-- 2. VIEWS THAT RAN WITH THEIR OWNER'S RIGHTS (14)
--
-- A view in Postgres runs as its owner unless told otherwise, which skips the
-- row-level security of every table under it. For thirteen of these it made
-- no difference: every table they read lets any signed-in member of staff see
-- every row. For one it did:
--
--   partner_reply_log reads mail_replies, whose policy (045) says an employee
--   sees their own replies and an administrator sees the desk — and
--   services/replyLog.ts relies on exactly that ("RLS decides what comes
--   back"). Through the view, every employee saw everybody's.
--
-- With security_invoker every view reads as the person asking, so the tables'
-- own rules hold. A SECURITY DEFINER function that reads one still reads as
-- the function's owner, as before, and the anonymous key has no access to any
-- of them (092).
--
-- KEEP IT SO. CREATE OR REPLACE VIEW resets a view's options: a migration that
-- redefines one of these has to say `with (security_invoker = true)` again,
-- or the advisor will flag it the next day.
-- ---------------------------------------------------------------------------

alter function public.checkpoint_due(jsonb, date, date, date, date, date, date) set search_path = '';
alter function public.checkpoint_mode(text)                    set search_path = '';
alter function public.derive_cargo_figures()                   set search_path = '';
alter function public.derive_quote_line_cost()                 set search_path = '';
alter function public.fy_of(date)                              set search_path = '';
alter function public.guard_signed_off()                       set search_path = '';
alter function public.guard_signoff_columns()                  set search_path = '';
alter function public.guess_trade_direction(text, text)        set search_path = '';
alter function public.is_indian_port(text)                     set search_path = '';
alter function public.note_adjustment_deadline(date)           set search_path = '';
alter function public.stage_words(text, text)                  set search_path = '';
alter function public.suggest_tax_treatment(text, text)        set search_path = '';
alter function public.tracking_stage(text)                     set search_path = '';

alter view public.console_margin            set (security_invoker = true);
alter view public.console_summary           set (security_invoker = true);
alter view public.container_load            set (security_invoker = true);
alter view public.customer_balances         set (security_invoker = true);
alter view public.customer_summary          set (security_invoker = true);
alter view public.invoice_settlement        set (security_invoker = true);
alter view public.job_final_bill            set (security_invoker = true);
alter view public.partner_balances          set (security_invoker = true);
alter view public.partner_reply_log         set (security_invoker = true);
alter view public.quote_margin              set (security_invoker = true);
alter view public.sailing_space             set (security_invoker = true);
alter view public.shipment_billing          set (security_invoker = true);
alter view public.shipment_container_totals set (security_invoker = true);
alter view public.shipment_margin           set (security_invoker = true);
