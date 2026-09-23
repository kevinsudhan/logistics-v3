-- ---------------------------------------------------------------------------
-- One progress model: the steps are the record, the stage follows them, and
-- every open step has a date.
--
-- WHAT WAS WRONG
--
-- A booking had two ways of saying how far it had got — the checkpoints on the
-- workflow bar and a `stage` moved with its own button — and nothing tied them
-- together. A job could read "Sailed" with "Sailing confirmation" unticked, or
-- the other way round, depending on which button somebody pressed. Neither had
-- a date, so "what is late" had no answer; and the step lists stopped at the
-- sailing or the loading, so arrival and delivery were recorded nowhere.
--
-- THE MODEL
--
-- Some steps are MILESTONES: they say where the cargo physically is. Ticking
-- "Sailing confirmation" is the cargo having sailed. Those steps carry the
-- stage they mark, and the shipment's stage is the furthest milestone ticked —
-- derived, never set on its own. "Move to sailed" now ticks the step that
-- says so. The chasing steps (documents, drafts) carry no stage and move
-- nothing.
--
-- Every step carries a rule for its due date, anchored on the dates the
-- booking already holds: the ready date, the cut-offs, the ETD, the ETA. When
-- an anchor moves, the open steps' dates move with it — unless somebody set
-- one by hand, which then stands.
-- ---------------------------------------------------------------------------

alter table public.checkpoint_templates
  add column if not exists stage    text check (stage in ('booked','cargo_received','stuffed','gated_in','sailed','arrived','delivered')),
  add column if not exists due_rule jsonb;

alter table public.shipment_checkpoints
  add column if not exists stage       text check (stage in ('booked','cargo_received','stuffed','gated_in','sailed','arrived','delivered')),
  add column if not exists due_rule    jsonb,
  add column if not exists due_on      date,
  -- Set by hand: the anchor moving no longer moves it.
  add column if not exists due_manual  boolean not null default false,
  -- Who is chasing this step. Null: whoever handles the job.
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;

create index if not exists shipment_checkpoints_open_idx
  on public.shipment_checkpoints (shipment_id, position) where done_at is null;


-- ---------------------------------------------------------------------------
-- The templates: which steps are milestones, and when each is due
--
-- A rule is a list of anchors tried in order — the first one the booking has
-- a date for wins. "Pickup: the ready date; failing that two days before the
-- cut-off; failing that five before the ETD." A step with no anchor available
-- has no date, which the worklist shows as undated rather than inventing one.
-- ---------------------------------------------------------------------------
create temp table rules (mode text, code text, stage text, rule jsonb) on commit drop;
insert into rules values
  -- air
  ('air', 'order_confirm',   'booked',         '[{"anchor":"booked","days":0}]'),
  ('air', 'pickup',          null,             '[{"anchor":"ready","days":0},{"anchor":"etd","days":-2}]'),
  ('air', 'warehouse',       'cargo_received', '[{"anchor":"cargo_cutoff","days":0},{"anchor":"etd","days":-1}]'),
  ('air', 'documents',       null,             '[{"anchor":"etd","days":-1}]'),
  ('air', 'origin_customer', null,             '[{"anchor":"etd","days":-1}]'),
  ('air', 'hawb_draft',      null,             '[{"anchor":"etd","days":-1}]'),
  ('air', 'hawb_confirm',    null,             '[{"anchor":"etd","days":0}]'),
  ('air', 'loading',         'sailed',         '[{"anchor":"etd","days":0}]'),
  ('air', 'arrival',         'arrived',        '[{"anchor":"eta","days":0}]'),
  ('air', 'delivery',        'delivered',      '[{"anchor":"eta","days":1}]'),
  -- sea LCL: the console, not the house shipment, is stuffed and gated in
  ('sea_lcl', 'order_confirm', 'booked',         '[{"anchor":"booked","days":0}]'),
  ('sea_lcl', 'pickup',        null,             '[{"anchor":"ready","days":0},{"anchor":"cargo_cutoff","days":-2},{"anchor":"etd","days":-5}]'),
  ('sea_lcl', 'cfs',           'cargo_received', '[{"anchor":"cargo_cutoff","days":0},{"anchor":"etd","days":-3}]'),
  ('sea_lcl', 'documents',     null,             '[{"anchor":"si_cutoff","days":-1},{"anchor":"etd","days":-3}]'),
  ('sea_lcl', 'si_cutoff',     null,             '[{"anchor":"si_cutoff","days":0},{"anchor":"etd","days":-2}]'),
  ('sea_lcl', 'bl_draft',      null,             '[{"anchor":"etd","days":-1}]'),
  ('sea_lcl', 'bl_confirm',    null,             '[{"anchor":"etd","days":1}]'),
  ('sea_lcl', 'sailing',       'sailed',         '[{"anchor":"etd","days":0}]'),
  ('sea_lcl', 'arrival',       'arrived',        '[{"anchor":"eta","days":0}]'),
  ('sea_lcl', 'delivery',      'delivered',      '[{"anchor":"eta","days":2}]'),
  -- sea FCL
  ('sea_fcl', 'order_confirm', 'booked',    '[{"anchor":"booked","days":0}]'),
  ('sea_fcl', 'empty_pickup',  null,        '[{"anchor":"cargo_cutoff","days":-4},{"anchor":"etd","days":-6}]'),
  ('sea_fcl', 'stuffing',      'stuffed',   '[{"anchor":"cargo_cutoff","days":-2},{"anchor":"etd","days":-4}]'),
  ('sea_fcl', 'vgm',           null,        '[{"anchor":"cargo_cutoff","days":-1},{"anchor":"etd","days":-3}]'),
  ('sea_fcl', 'gate_in',       'gated_in',  '[{"anchor":"cargo_cutoff","days":0},{"anchor":"etd","days":-2}]'),
  ('sea_fcl', 'si_cutoff',     null,        '[{"anchor":"si_cutoff","days":0},{"anchor":"etd","days":-2}]'),
  ('sea_fcl', 'bl_confirm',    null,        '[{"anchor":"etd","days":1}]'),
  ('sea_fcl', 'sailing',       'sailed',    '[{"anchor":"etd","days":0}]'),
  ('sea_fcl', 'arrival',       'arrived',   '[{"anchor":"eta","days":0}]'),
  ('sea_fcl', 'delivery',      'delivered', '[{"anchor":"eta","days":2}]'),
  -- road, other, and a mode nobody set
  ('default', 'order_confirm', 'booked',         '[{"anchor":"booked","days":0}]'),
  ('default', 'pickup',        'cargo_received', '[{"anchor":"ready","days":0},{"anchor":"etd","days":-1}]'),
  ('default', 'documents',     null,             '[{"anchor":"etd","days":-1}]'),
  ('default', 'dispatch',      'sailed',         '[{"anchor":"etd","days":0}]'),
  ('default', 'delivery',      'delivered',      '[{"anchor":"eta","days":0}]');

-- The arrival and delivery steps the sea and air lists never had.
insert into public.checkpoint_templates (mode, position, code, label) values
  ('air',     9,  'arrival',  'Arrival at destination'),
  ('air',     10, 'delivery', 'Delivery confirmation'),
  ('sea_lcl', 9,  'arrival',  'Arrival at destination'),
  ('sea_lcl', 10, 'delivery', 'Delivery confirmation'),
  ('sea_fcl', 9,  'arrival',  'Arrival at destination'),
  ('sea_fcl', 10, 'delivery', 'Delivery confirmation')
on conflict (mode, code) do nothing;

update public.checkpoint_templates t
   set stage = r.stage, due_rule = r.rule
  from rules r
 where r.mode = t.mode and r.code = t.code;


-- ---------------------------------------------------------------------------
-- Which template a shipment uses
-- ---------------------------------------------------------------------------
create or replace function public.checkpoint_mode(p_mode text)
returns text
language sql
stable
as $fn$
  select case
    when exists (select 1 from public.checkpoint_templates where mode = p_mode and active) then p_mode
    else 'default'
  end
$fn$;


-- ---------------------------------------------------------------------------
-- A step's date, from its rule and the booking's dates
-- ---------------------------------------------------------------------------
create or replace function public.checkpoint_due(
  p_rule jsonb,
  p_booked date,
  p_ready date,
  p_cargo_cutoff date,
  p_si_cutoff date,
  p_etd date,
  p_eta date
) returns date
language plpgsql
immutable
as $fn$
declare
  r jsonb;
  d date;
begin
  if p_rule is null or jsonb_typeof(p_rule) <> 'array' then
    return null;
  end if;
  for r in select * from jsonb_array_elements(p_rule) loop
    d := case r->>'anchor'
           when 'booked'       then p_booked
           when 'ready'        then p_ready
           when 'cargo_cutoff' then p_cargo_cutoff
           when 'si_cutoff'    then p_si_cutoff
           when 'etd'          then p_etd
           when 'eta'          then p_eta
         end;
    if d is not null then
      return d + coalesce((r->>'days')::int, 0);
    end if;
  end loop;
  return null;
end $fn$;

create or replace function public.refresh_checkpoint_dues(p_shipment_id text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.shipment_checkpoints c
     set due_on = public.checkpoint_due(
           c.due_rule,
           -- Booked "today" is India's today, not UTC's.
           (s.created_at at time zone 'Asia/Kolkata')::date,
           coalesce(e.ready_date, s.shipment_date),
           s.cargo_cutoff,
           s.si_cutoff,
           coalesce(s.etd, s.sailing_date),
           s.eta)
    from public.shipments s
    left join public.enquiries e on e.ref = s.enquiry_ref
   where s.id = p_shipment_id
     and c.shipment_id = s.id
     and not c.due_manual;
end $fn$;

revoke execute on function public.refresh_checkpoint_dues(text) from public, anon;


-- ---------------------------------------------------------------------------
-- The stage, from the furthest milestone ticked
-- ---------------------------------------------------------------------------
create or replace function public.stage_words(p_stage text, p_mode text)
returns text
language sql
immutable
as $fn$
  select case
    when p_stage = 'sailed' and p_mode = 'air' then 'departed'
    when p_stage = 'sailed' and p_mode in ('road', 'other') then 'dispatched'
    else replace(p_stage, '_', ' ')
  end
$fn$;

create or replace function public.derive_shipment_stage(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ship  public.shipments;
  v_new   text;
  v_order text[] := array['booked','cargo_received','stuffed','gated_in','sailed','arrived','delivered'];
begin
  select * into v_ship from public.shipments where id = p_id;
  -- A cancelled job stays cancelled whatever is ticked; reopening it is a
  -- decision, made through set_shipment_stage.
  if not found or v_ship.stage = 'cancelled' then
    return;
  end if;

  select c.stage into v_new
    from public.shipment_checkpoints c
   where c.shipment_id = p_id and c.done_at is not null and c.stage is not null
   order by array_position(v_order, c.stage) desc
   limit 1;
  v_new := coalesce(v_new, 'booked');

  if v_new is distinct from v_ship.stage then
    update public.shipments set stage = v_new, updated_at = now() where id = p_id;
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (v_ship.enquiry_ref, 'stage_changed',
            format('%s %s %s', p_id,
                   case when array_position(v_order, v_new) > array_position(v_order, v_ship.stage)
                        then 'moved to' else 'moved back to' end,
                   public.stage_words(v_new, v_ship.transport_mode)),
            jsonb_build_object('shipment_id', p_id, 'from', v_ship.stage, 'to', v_new),
            auth.uid());
  end if;
end $fn$;

revoke execute on function public.derive_shipment_stage(text) from public, anon;

create or replace function public.checkpoint_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.stage is not null
     and (tg_op = 'INSERT' or old.done_at is distinct from new.done_at)
  then
    perform public.derive_shipment_stage(new.shipment_id);
  end if;
  return null;
end $fn$;

drop trigger if exists shipment_checkpoints_stage on public.shipment_checkpoints;
create trigger shipment_checkpoints_stage
  after insert or update of done_at on public.shipment_checkpoints
  for each row execute function public.checkpoint_moved();


-- ---------------------------------------------------------------------------
-- "Move to …" ticks the milestone that says so
--
-- Cancelling is the one stage set directly — nothing is ticked to cancel a
-- job — and a cancelled job is reopened here too, at whatever its steps say.
-- ---------------------------------------------------------------------------
create or replace function public.set_shipment_stage(p_id text, p_stage text)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.shipments;
  v_cp  uuid;
begin
  select * into v_row from public.shipments where id = p_id for update;
  if not found then
    raise exception 'No shipment %', p_id;
  end if;

  if p_stage = 'cancelled' then
    update public.shipments set stage = 'cancelled', updated_at = now()
     where id = p_id returning * into v_row;
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (v_row.enquiry_ref, 'stage_changed', p_id || ' cancelled',
            jsonb_build_object('shipment_id', p_id, 'to', 'cancelled'), auth.uid());
    return v_row;
  end if;

  if v_row.stage = 'cancelled' then
    update public.shipments set stage = 'booked', updated_at = now() where id = p_id;
    perform public.derive_shipment_stage(p_id);
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (v_row.enquiry_ref, 'stage_changed', p_id || ' reopened',
            jsonb_build_object('shipment_id', p_id), auth.uid());
    select * into v_row from public.shipments where id = p_id;
    return v_row;
  end if;

  select id into v_cp
    from public.shipment_checkpoints
   where shipment_id = p_id and stage = p_stage
   order by position
   limit 1;
  if v_cp is null then
    raise exception 'this shipment has no step that marks it %', public.stage_words(p_stage, v_row.transport_mode)
      using hint = 'Tick the matching step on the workflow bar.';
  end if;

  update public.shipment_checkpoints
     set done_at = coalesce(done_at, now()),
         done_by = coalesce(done_by, auth.uid())
   where id = v_cp;

  select * into v_row from public.shipments where id = p_id;
  return v_row;
end $fn$;

grant execute on function public.set_shipment_stage(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- A date set by hand, or handed back to the rule
-- ---------------------------------------------------------------------------
create or replace function public.set_checkpoint_due(p_id uuid, p_due date)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ship text;
begin
  select shipment_id into v_ship from public.shipment_checkpoints where id = p_id;
  if not found then
    raise exception 'no such step';
  end if;
  if p_due is null then
    update public.shipment_checkpoints set due_manual = false where id = p_id;
    perform public.refresh_checkpoint_dues(v_ship);
  else
    update public.shipment_checkpoints set due_on = p_due, due_manual = true where id = p_id;
  end if;
end $fn$;

grant execute on function public.set_checkpoint_due(uuid, date) to authenticated;


-- ---------------------------------------------------------------------------
-- Seeding: the template's milestones and rules come with the steps
-- ---------------------------------------------------------------------------
create or replace function public.seed_shipment_checkpoints()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_mode text;
begin
  -- The shipment's own mode first: 065 has already copied it from the enquiry.
  select public.checkpoint_mode(coalesce(new.transport_mode, e.transport_mode))
    into v_mode
    from public.enquiries e where e.ref = new.enquiry_ref;
  v_mode := coalesce(v_mode, 'default');

  insert into public.shipment_checkpoints (shipment_id, position, code, label, stage, due_rule, done_at)
  select new.id, t.position, t.code, t.label, t.stage, t.due_rule,
         case when t.position = 1 then now() else null end
    from public.checkpoint_templates t
   where t.mode = v_mode and t.active
   order by t.position
  on conflict (shipment_id, code) do nothing;

  perform public.refresh_checkpoint_dues(new.id);
  return new;
end $fn$;


-- ---------------------------------------------------------------------------
-- Dates move with their anchors
-- ---------------------------------------------------------------------------
create or replace function public.shipment_dates_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.refresh_checkpoint_dues(new.id);
  return null;
end $fn$;

drop trigger if exists shipments_dates_moved on public.shipments;
create trigger shipments_dates_moved
  after update of etd, eta, sailing_date, cargo_cutoff, si_cutoff, shipment_date on public.shipments
  for each row execute function public.shipment_dates_moved();

create or replace function public.enquiry_ready_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id text;
begin
  if old.ready_date is distinct from new.ready_date then
    select id into v_id from public.shipments where enquiry_ref = new.ref;
    if v_id is not null then
      perform public.refresh_checkpoint_dues(v_id);
    end if;
  end if;
  return null;
end $fn$;

drop trigger if exists enquiries_ready_moved on public.enquiries;
create trigger enquiries_ready_moved
  after update of ready_date on public.enquiries
  for each row execute function public.enquiry_ready_moved();


-- ---------------------------------------------------------------------------
-- Existing bookings: milestones, rules, the missing steps, their dates, and a
-- stage that agrees with what is ticked
-- ---------------------------------------------------------------------------
update public.shipment_checkpoints c
   set stage = t.stage, due_rule = t.due_rule
  from public.shipments s
  left join public.enquiries e on e.ref = s.enquiry_ref
  join public.checkpoint_templates t
    on t.mode = public.checkpoint_mode(coalesce(s.transport_mode, e.transport_mode))
 where c.shipment_id = s.id and t.code = c.code;

insert into public.shipment_checkpoints (shipment_id, position, code, label, stage, due_rule)
select s.id, t.position, t.code, t.label, t.stage, t.due_rule
  from public.shipments s
  left join public.enquiries e on e.ref = s.enquiry_ref
  join public.checkpoint_templates t
    on t.mode = public.checkpoint_mode(coalesce(s.transport_mode, e.transport_mode))
 where t.active
on conflict (shipment_id, code) do nothing;

select public.refresh_checkpoint_dues(id) from public.shipments;
select public.derive_shipment_stage(id) from public.shipments;
