-- 082: The master bill reaches the job.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS MISSING
--
-- 035 put the carrier's master B/L on the console, where one copy of it
-- belongs, and 032 gave the job a master number of its own (`mainline_no`).
-- Nothing joined the two, and nothing on screen wrote `mainline_no` at all.
-- So everything that asks the job for its master went without: the pre-alert
-- to the destination agent ("Master B/L"), tracking by B/L number, the
-- worklist search, and the arrival notice and delivery order, which quote the
-- master beside our house bill.
--
-- WHAT THIS DOES
--
-- A job on a console carries the console's master: it is copied across when
-- the job is put on, when the console's MBL is typed or corrected, and taken
-- off again when the job leaves the console. The console stays the one place
-- the number is entered. A job that is not on a console (a direct FCL under
-- the carrier's bill, a box co-loaded with another consolidator) has its
-- master typed on the job's Bill tab.
--
-- Each job the number reaches gets a line on its timeline, so "when did we
-- get the MBL" has an answer.
--
-- WHO MAY CALL THESE
--
-- open_console, attach_to_console, detach_from_console and issue_house_bl were
-- granted to signed-in users in 035, but a Postgres function is executable by
-- PUBLIC unless that is revoked, and it never was: the anonymous key in the
-- browser bundle could open consoles, move jobs on and off them and spend
-- house-bill numbers. allocate_invoice_number, which every one of those
-- numbering functions calls, was open the same way, and calling it directly
-- spends a number from the gapless GST invoice series. It is only ever called
-- from inside other functions, which run as its owner, so nobody needs to be
-- granted it. The same pattern on other functions is a separate audit.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- Putting a job on a console: the master comes with the voyage.
-- ---------------------------------------------------------------------------
create or replace function public.attach_to_console(p_shipment text, p_console uuid)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_con  public.consoles;
  v_row  public.shipments;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select * into v_con from public.consoles where id = p_console;
  if not found then
    raise exception 'No console %', p_console;
  end if;
  if v_con.status in ('sailed','arrived','cancelled') then
    raise exception 'Console % has already %', v_con.console_no, v_con.status
      using hint = 'Cargo cannot be added to a console that has gone.';
  end if;

  update public.shipments
     set console_id  = p_console,
         -- The console knows the voyage. Carried across so the shipment's own
         -- documents read the same as the manifest rather than being filled in
         -- twice and disagreeing.
         vessel      = coalesce(nullif(v_con.vessel, ''), vessel),
         voyage      = coalesce(nullif(v_con.voyage, ''), voyage),
         carrier     = coalesce(nullif(v_con.carrier, ''), carrier),
         etd         = coalesce(v_con.etd, etd),
         eta         = coalesce(v_con.eta, eta),
         -- And the master bill, once the console has one (082).
         mainline_no = coalesce(nullif(v_con.mbl_number, ''), mainline_no),
         updated_at  = now()
   where id = p_shipment
  returning * into v_row;

  if not found then
    raise exception 'No shipment %', p_shipment;
  end if;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (v_row.enquiry_ref, 'console_attached',
          format('Put on console %s', v_con.console_no)
            || coalesce(' (MBL ' || nullif(v_con.mbl_number, '') || ')', ''),
          jsonb_build_object('console_id', p_console, 'console_no', v_con.console_no,
                             'mbl_number', nullif(v_con.mbl_number, '')),
          auth.uid());

  return v_row;
end $fn$;


-- ---------------------------------------------------------------------------
-- Taking it off: the console's master goes with it, and the job has none until
-- one is recorded for it. A number that is not the console's stays — one
-- typed on the job while its console had no MBL yet.
--
-- A master the job had before it went on is not brought back: going onto a
-- console that has its own replaced it (above), and a job moving off a console
-- is rarely going back under the bill it had before.
-- ---------------------------------------------------------------------------
create or replace function public.detach_from_console(p_shipment text)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.shipments;
  v_mbl text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select nullif(c.mbl_number, '') into v_mbl
    from public.shipments s
    join public.consoles c on c.id = s.console_id
   where s.id = p_shipment;

  update public.shipments
     set console_id  = null,
         mainline_no = case when v_mbl is not null and mainline_no = v_mbl then null else mainline_no end,
         updated_at  = now()
   where id = p_shipment
  returning * into v_row;

  if not found then
    raise exception 'No shipment %', p_shipment;
  end if;

  insert into public.enquiry_events (enquiry_ref, kind, summary, actor)
  values (v_row.enquiry_ref, 'console_detached', 'Taken off its console', auth.uid());

  return v_row;
end $fn$;


-- ---------------------------------------------------------------------------
-- The MBL typed or corrected on the console reaches every job on it.
--
-- Cleared on the console, it is cleared on the jobs too: the number was the
-- console's, and a job keeping a master its console no longer has is the
-- disagreement this exists to prevent.
-- ---------------------------------------------------------------------------
create or replace function public.console_master_to_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_mbl text := nullif(btrim(coalesce(new.mbl_number, '')), '');
begin
  if v_mbl is not distinct from nullif(btrim(coalesce(old.mbl_number, '')), '') then
    return null;
  end if;

  with moved as (
    update public.shipments
       set mainline_no = v_mbl, updated_at = now()
     where console_id = new.id
       and mainline_no is distinct from v_mbl
    returning enquiry_ref, id
  )
  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  select m.enquiry_ref, 'mbl_recorded',
         case when v_mbl is null
              then format('Master B/L cleared on console %s', new.console_no)
              else format('Master B/L %s, from console %s', v_mbl, new.console_no) end,
         jsonb_build_object('shipment_id', m.id, 'console_id', new.id, 'mbl_number', v_mbl),
         auth.uid()
    from moved m;

  return null;
end $fn$;

drop trigger if exists consoles_master_to_jobs on public.consoles;
create trigger consoles_master_to_jobs
  after update of mbl_number on public.consoles
  for each row execute function public.console_master_to_jobs();


-- ---------------------------------------------------------------------------
-- Jobs already on a console that has its master.
-- ---------------------------------------------------------------------------
update public.shipments s
   set mainline_no = nullif(btrim(c.mbl_number), ''), updated_at = now()
  from public.consoles c
 where c.id = s.console_id
   and nullif(btrim(c.mbl_number), '') is not null
   and s.mainline_no is distinct from nullif(btrim(c.mbl_number), '');


-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.open_console(text, text, text)  from public, anon;
revoke execute on function public.attach_to_console(text, uuid)   from public, anon;
revoke execute on function public.detach_from_console(text)       from public, anon;
revoke execute on function public.issue_house_bl(text)            from public, anon;
grant  execute on function public.open_console(text, text, text)  to authenticated;
grant  execute on function public.attach_to_console(text, uuid)   to authenticated;
grant  execute on function public.detach_from_console(text)       to authenticated;
grant  execute on function public.issue_house_bl(text)            to authenticated;

revoke execute on function public.allocate_invoice_number(text, date) from public, anon, authenticated;

revoke execute on function public.console_master_to_jobs() from public, anon, authenticated;
