-- 092: Nothing for the anonymous key but the customer's two pages.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- The anonymous key is in the website's JavaScript: anybody can read it and
-- call the database with it. Supabase grants that role SELECT on every new
-- table and view and EXECUTE on every new function by default, and a view or
-- a SECURITY DEFINER function runs as its owner, past row-level security.
-- Found on 25 Sep 2026 with the key alone and no sign-in:
--
--   - the 14 reporting views were readable (customer_summary, customer_balances,
--     quote_margin, partner_balances, shipment_margin …): customers, balances
--     and margins;
--   - 88 SECURITY DEFINER functions were executable, 24 of them with no check
--     of who was calling (create_customer, set_quote, update_container,
--     reopen_intake, link_email_to_customer …), and others that skip their
--     admin check when there is no signed-in user at all.
--
-- 082 closed five functions by hand; this closes the class.
--
-- WHAT STAYS OPEN
--
-- The customer's quotation page (/q/:token) and tracking page (/t/:token),
-- which have no account behind them: quote_by_token, accept_quote_by_token,
-- shipment_tracking, shipment_track_points, shipment_customs_public. Each takes
-- the unguessable token as its whole authority (053, 073, 077).
--
-- Signed-in staff keep exactly what they had: a function they could execute
-- through PUBLIC is granted to them by name before PUBLIC loses it.
-- ---------------------------------------------------------------------------

do $$
declare
  f      record;
  o      record;
  keep   text[] := array['quote_by_token', 'accept_quote_by_token', 'shipment_tracking', 'shipment_track_points', 'shipment_customs_public'];
begin
  -- Functions, every one in public (definer or not: an invoker function the
  -- anonymous role can call still runs whatever it runs).
  for f in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    -- What signed-in staff and the server could run through PUBLIC, by name.
    if has_function_privilege('authenticated', f.oid, 'execute') then
      execute format('grant execute on function public.%I(%s) to authenticated', f.proname, f.args);
    end if;
    execute format('grant execute on function public.%I(%s) to service_role', f.proname, f.args);
    if not (f.proname = any (keep)) then
      execute format('revoke execute on function public.%I(%s) from public, anon', f.proname, f.args);
    else
      execute format('grant execute on function public.%I(%s) to anon', f.proname, f.args);
    end if;
  end loop;

  -- Tables, views and sequences: the anonymous role reads nothing directly.
  for o in
    select c.relname, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'S')
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    if o.relkind = 'S' then
      execute format('revoke all on sequence public.%I from anon', o.relname);
    else
      execute format('revoke all on public.%I from anon', o.relname);
    end if;
  end loop;
end $$;

-- And for whatever is created from here on, by whoever runs the migrations.
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
