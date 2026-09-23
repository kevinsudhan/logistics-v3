-- 077: Customs clearance on a shipment — export and import, the Indian way.
--
-- ---------------------------------------------------------------------------
-- WHAT IS KEPT
--
-- Export: the shipping bill filed on ICEGATE (seven digits and its date), the
-- customs station it was filed at (INMAA4 is Chennai air cargo), the checklist
-- the exporter approved, whether customs examined the cargo, the Let Export
-- Order date — the goods may be loaded from then — and the EGM the carrier
-- filed after departure.
--
-- Import: the IGM and its line, the bill of entry (seven digits, its date and
-- whether for home consumption, warehousing or ex-bond), the duty and when it
-- was paid, and the out-of-charge date — the goods may leave customs from then.
--
-- Who clears it: us, a customs broker (a partner, or a name), the customer's
-- own broker, or the overseas agent. A hold says why, in the desk's words.
--
-- ON THE WORKFLOW
--
-- Two steps join the templates: "Export customs cleared (LEO)" before the
-- cargo is loaded, and "Import customs cleared (OOC)" after arrival. Each is
-- seeded only on a job going that way (trade direction), and a customs record
-- started by hand adds its step if the job lacks it. The LEO or OOC date
-- ticks the step, dated that day; clearing the date unticks it — the same
-- pattern as collection and delivery (067).
--
-- Positions are spread ×10 to make room, which changes no order.
-- ---------------------------------------------------------------------------

-- ---- room between the steps ----
do $$
begin
  if (select max(position) from public.checkpoint_templates) < 50 then
    update public.checkpoint_templates set position = position * 10;
    update public.shipment_checkpoints set position = position * 10;
  end if;
end $$;

alter table public.checkpoint_templates
  add column if not exists direction text check (direction in ('export', 'import'));

insert into public.checkpoint_templates (mode, position, code, label, direction, due_rule) values
  ('air',     45, 'customs_export', 'Export customs cleared (LEO)', 'export', '[{"anchor":"cargo_cutoff","days":0},{"anchor":"etd","days":-1}]'),
  ('sea_lcl', 45, 'customs_export', 'Export customs cleared (LEO)', 'export', '[{"anchor":"cargo_cutoff","days":0},{"anchor":"etd","days":-2}]'),
  ('sea_fcl', 45, 'customs_export', 'Export customs cleared (LEO)', 'export', '[{"anchor":"cargo_cutoff","days":-1},{"anchor":"etd","days":-3}]'),
  ('default', 35, 'customs_export', 'Export customs cleared (LEO)', 'export', '[{"anchor":"etd","days":-1}]'),
  ('air',     95, 'customs_import', 'Import customs cleared (OOC)', 'import', '[{"anchor":"eta","days":1}]'),
  ('sea_lcl', 95, 'customs_import', 'Import customs cleared (OOC)', 'import', '[{"anchor":"eta","days":2}]'),
  ('sea_fcl', 95, 'customs_import', 'Import customs cleared (OOC)', 'import', '[{"anchor":"eta","days":2}]'),
  ('default', 45, 'customs_import', 'Import customs cleared (OOC)', 'import', '[{"anchor":"eta","days":0}]')
on conflict (mode, code) do update
  set label = excluded.label, direction = excluded.direction, due_rule = excluded.due_rule, position = excluded.position;


-- ---- seeding: only the customs step for the way the job goes ----
create or replace function public.seed_shipment_checkpoints()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_mode  text;
  v_dir   text;
  v_first int;
begin
  -- The shipment's own mode first: 065 has already copied it from the enquiry.
  select public.checkpoint_mode(coalesce(new.transport_mode, e.transport_mode)), coalesce(new.trade_direction, e.trade_direction)
    into v_mode, v_dir
    from public.enquiries e where e.ref = new.enquiry_ref;
  v_mode := coalesce(v_mode, 'default');

  -- The first step is done on creation: a booking exists because the order was confirmed.
  select min(position) into v_first from public.checkpoint_templates where mode = v_mode and active;

  insert into public.shipment_checkpoints (shipment_id, position, code, label, stage, due_rule, done_at)
  select new.id, t.position, t.code, t.label, t.stage, t.due_rule,
         case when t.position = v_first then now() else null end
    from public.checkpoint_templates t
   where t.mode = v_mode and t.active
     and (t.direction is null or t.direction = v_dir)
   order by t.position
  on conflict (shipment_id, code) do nothing;

  perform public.refresh_checkpoint_dues(new.id);
  return new;
end $fn$;


-- Adds a job's customs step if it lacks it: from its template, dated by its rule.
create or replace function public.ensure_customs_step(p_shipment_id text, p_side text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_mode text;
begin
  select public.checkpoint_mode(s.transport_mode) into v_mode from public.shipments s where s.id = p_shipment_id;
  insert into public.shipment_checkpoints (shipment_id, position, code, label, stage, due_rule)
  select p_shipment_id, t.position, t.code, t.label, t.stage, t.due_rule
    from public.checkpoint_templates t
   where t.mode = coalesce(v_mode, 'default') and t.code = 'customs_' || p_side and t.active
  on conflict (shipment_id, code) do nothing;
  perform public.refresh_checkpoint_dues(p_shipment_id);
end $fn$;

revoke execute on function public.ensure_customs_step(text, text) from public, anon;

-- Jobs already under way get the step for their direction.
do $$
declare r record;
begin
  for r in select id, trade_direction from public.shipments
            where trade_direction in ('export', 'import') and signed_off_at is null
  loop
    perform public.ensure_customs_step(r.id, r.trade_direction);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- The customs record
-- ---------------------------------------------------------------------------
create table if not exists public.shipment_customs (
  id                    uuid primary key default gen_random_uuid(),
  shipment_id           text not null references public.shipments(id) on delete cascade,
  side                  text not null check (side in ('export', 'import')),
  handled_by            text not null default 'us' check (handled_by in ('us', 'broker', 'customer', 'agent')),
  broker_partner_id     uuid references public.partners(id) on delete set null,
  broker_name           text,
  port_code             text check (port_code is null or port_code ~ '^[A-Z]{5}[0-9A-Z]?$'),

  -- export
  checklist_approved_on date,
  sb_number             text check (sb_number is null or sb_number ~ '^\d{7}$'),
  sb_date               date,
  examination           text check (examination in ('not_required', 'required', 'done')),
  examination_on        date,
  leo_date              date,
  egm_number            text,
  egm_date              date,

  -- import
  igm_number            text,
  igm_date              date,
  igm_item              text,
  be_number             text check (be_number is null or be_number ~ '^\d{7}$'),
  be_date               date,
  be_type               text check (be_type in ('home', 'warehouse', 'ex_bond')),
  duty_inr              numeric(14, 2) check (duty_inr is null or duty_inr >= 0),
  duty_paid_on          date,
  ooc_date              date,

  hold_reason           text,
  remarks               text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id) on delete set null,
  unique (shipment_id, side),
  constraint customs_leo_after_sb check (sb_date is null or leo_date is null or leo_date >= sb_date),
  constraint customs_ooc_after_be check (be_date is null or ooc_date is null or ooc_date >= be_date),
  constraint customs_egm_after_leo check (leo_date is null or egm_date is null or egm_date >= leo_date)
);

alter table public.shipment_customs enable row level security;
drop policy if exists shipment_customs_read on public.shipment_customs;
create policy shipment_customs_read on public.shipment_customs for select to authenticated using (true);
drop policy if exists shipment_customs_write on public.shipment_customs;
create policy shipment_customs_write on public.shipment_customs for insert to authenticated with check (true);
drop policy if exists shipment_customs_update on public.shipment_customs;
create policy shipment_customs_update on public.shipment_customs for update to authenticated using (true) with check (true);
drop policy if exists shipment_customs_delete on public.shipment_customs;
create policy shipment_customs_delete on public.shipment_customs for delete to authenticated using (true);


-- A closed job's customs are closed with it; a new record brings its step.
create or replace function public.customs_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id text := coalesce(new.shipment_id, old.shipment_id);
begin
  if exists (select 1 from public.shipments where id = v_id and signed_off_at is not null) then
    raise exception '% is signed off; its customs record is closed with it', v_id
      using hint = 'Reopen the sign-off first.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $fn$;

drop trigger if exists shipment_customs_guard on public.shipment_customs;
create trigger shipment_customs_guard
  before insert or update or delete on public.shipment_customs
  for each row execute function public.customs_guard();


-- The LEO or OOC date ticks the customs step, dated that day (India's day).
create or replace function public.customs_to_checkpoint()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_code text;
  v_day  date;
  v_old  date;
begin
  if tg_op = 'DELETE' then
    update public.shipment_checkpoints set done_at = null, done_by = null
     where shipment_id = old.shipment_id and code = 'customs_' || old.side and done_at is not null;
    -- A step the record brought to a job going the other way goes with it.
    delete from public.shipment_checkpoints c
     using public.shipments s
     where c.shipment_id = old.shipment_id and c.code = 'customs_' || old.side
       and s.id = c.shipment_id and s.trade_direction is distinct from old.side;
    return null;
  end if;

  v_code := 'customs_' || new.side;
  if tg_op = 'INSERT' then
    perform public.ensure_customs_step(new.shipment_id, new.side);
  end if;
  v_day := case new.side when 'export' then new.leo_date else new.ooc_date end;
  v_old := case when tg_op = 'UPDATE' then case old.side when 'export' then old.leo_date else old.ooc_date end end;

  if tg_op = 'INSERT' or v_day is distinct from v_old then
    update public.shipment_checkpoints
       set done_at = case when v_day is null then null else (v_day::timestamp at time zone 'Asia/Kolkata') end,
           done_by = case when v_day is null then null else coalesce(done_by, auth.uid()) end
     where shipment_id = new.shipment_id and code = v_code;
  end if;
  return null;
end $fn$;

drop trigger if exists shipment_customs_checkpoint on public.shipment_customs;
create trigger shipment_customs_checkpoint
  after insert or update or delete on public.shipment_customs
  for each row execute function public.customs_to_checkpoint();


-- ---------------------------------------------------------------------------
-- What the customer's page shows: numbers, dates and where it stands.
-- Not the duty, not the broker, not the desk's words about a hold.
-- ---------------------------------------------------------------------------
create or replace function public.shipment_customs_public(p_token text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'side', c.side,
           'status', case
             when c.side = 'export' and c.leo_date is not null then 'cleared'
             when c.side = 'import' and c.ooc_date is not null then 'cleared'
             when coalesce(c.sb_number, c.be_number) is not null then 'filed'
             else 'in_progress' end,
           'sb_number', c.sb_number, 'sb_date', c.sb_date, 'leo_date', c.leo_date,
           'be_number', c.be_number, 'be_date', c.be_date, 'ooc_date', c.ooc_date,
           'port_code', c.port_code)
         order by c.side desc), '[]'::jsonb)
    from public.shipment_customs c
    join public.shipment_track_links l on l.shipment_id = c.shipment_id
   where l.token = p_token and not l.revoked
$fn$;

grant execute on function public.shipment_customs_public(text) to anon, authenticated;
