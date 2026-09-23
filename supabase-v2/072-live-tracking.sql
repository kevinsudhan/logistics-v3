-- 072: Live tracking — what the airline, the carrier, the ship and the mail say.
--
-- ---------------------------------------------------------------------------
-- WHERE THE ANSWERS COME FROM
--
-- The `track-shipment` edge function asks the free sources — AeroDataBox for
-- a flight's status, adsb.lol for an aircraft's position, a carrier's DCSA
-- feed for container events (Hapag-Lloyd), aisstream for a ship's position —
-- and writes what they said here. The desk's mail is read for the same kind
-- of news (departed, arrived, delayed, delivered) by the Gemini function that
-- already reads enquiries.
--
-- WHAT A SOURCE MAY DO
--
-- A source never unticks anything and never ticks a step on its own word
-- unless the word is about our cargo: a container event from the carrier
-- ticks; a flight taking off, a ship's position and a line read from a mail
-- are offered to a person, who ticks with one click. Estimates tick nothing.
-- Every tick says where it came from, in the step's note.
--
-- WHO WRITES
--
-- Snapshots and provider events are written by the edge function with the
-- service key — there is no insert policy, so a browser cannot put words in a
-- carrier's mouth. People act on events through the functions below.
-- ---------------------------------------------------------------------------

alter table public.shipments
  add column if not exists vessel_mmsi text check (vessel_mmsi ~ '^\d{9}$'),
  add column if not exists vessel_imo  text check (vessel_imo ~ '^\d{7}$');

comment on column public.shipments.vessel_mmsi is
  'The ship''s radio identity (9 digits). What AIS positions are filed under; the IMO number is not.';


-- ---------------------------------------------------------------------------
-- The latest answer from each source, per shipment
-- ---------------------------------------------------------------------------
create table if not exists public.tracking_snapshots (
  shipment_id text not null references public.shipments(id) on delete cascade,
  source      text not null check (source in ('aerodatabox', 'adsb', 'hapag_lloyd', 'aisstream')),
  fetched_at  timestamptz not null default now(),
  state       text not null check (state in ('ok', 'not_found', 'not_configured', 'not_applicable', 'error')),
  message     text not null default '',
  summary     jsonb not null default '{}'::jsonb,
  primary key (shipment_id, source)
);


-- ---------------------------------------------------------------------------
-- Things that happened, as a source reported them
-- ---------------------------------------------------------------------------
create table if not exists public.tracking_events (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  text not null references public.shipments(id) on delete cascade,
  source       text not null check (source in ('aerodatabox', 'adsb', 'hapag_lloyd', 'aisstream', 'mail')),
  kind         text not null check (kind in (
                 'cargo_received', 'stuffed', 'gate_in', 'loaded', 'departed', 'in_transit',
                 'arrived', 'discharged', 'customs_cleared', 'gate_out', 'out_for_delivery',
                 'delivered', 'delayed', 'rolled_over', 'schedule_changed', 'cancelled', 'other')),
  occurred_at  timestamptz,
  estimated    boolean not null default false,
  location     text,
  detail       text not null default '',
  -- For a schedule change: the new {etd, eta} it proposes.
  data         jsonb not null default '{}'::jsonb,
  -- The source's own identity for the event, so a refresh never adds it twice.
  external_id  text not null,
  -- The mail it was read from.
  message_id   text,
  -- new: waiting for a person. applied: ticked a step (or moved a date).
  -- info: kept on the timeline, ticks nothing. dismissed: a person said no.
  status       text not null default 'new' check (status in ('new', 'applied', 'info', 'dismissed')),
  applied_step text,
  decided_by   uuid references auth.users(id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (shipment_id, source, external_id)
);

create index if not exists tracking_events_shipment_idx
  on public.tracking_events (shipment_id, occurred_at desc);
create index if not exists tracking_events_open_idx
  on public.tracking_events (shipment_id) where status = 'new';


-- Which mails have been read for news, so a message is read (and paid for) once.
create table if not exists public.tracking_mail_reads (
  shipment_id text not null references public.shipments(id) on delete cascade,
  message_id  text not null,
  read_at     timestamptz not null default now(),
  found       int not null default 0,
  read_by     uuid references auth.users(id) on delete set null,
  primary key (shipment_id, message_id)
);

alter table public.tracking_snapshots  enable row level security;
alter table public.tracking_events     enable row level security;
alter table public.tracking_mail_reads enable row level security;

drop policy if exists tracking_snapshots_read on public.tracking_snapshots;
create policy tracking_snapshots_read on public.tracking_snapshots
  for select to authenticated using (true);
drop policy if exists tracking_events_read on public.tracking_events;
create policy tracking_events_read on public.tracking_events
  for select to authenticated using (true);
drop policy if exists tracking_mail_reads_read on public.tracking_mail_reads;
create policy tracking_mail_reads_read on public.tracking_mail_reads
  for select to authenticated using (true);


-- ---------------------------------------------------------------------------
-- Which milestone an event is evidence for
-- ---------------------------------------------------------------------------
create or replace function public.tracking_stage(p_kind text)
returns text
language sql
immutable
as $fn$
  select case p_kind
    when 'cargo_received' then 'cargo_received'
    when 'stuffed'        then 'stuffed'
    when 'gate_in'        then 'gated_in'
    when 'departed'       then 'sailed'
    when 'arrived'        then 'arrived'
    when 'discharged'     then 'arrived'
    when 'delivered'      then 'delivered'
  end
$fn$;


-- An offer for a step already ticked is not a question any more: it is kept
-- on the timeline as evidence and asks nothing.
create or replace function public.tracking_event_settle()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status = 'new'
     and public.tracking_stage(new.kind) is not null
     and exists (select 1 from public.shipment_checkpoints c
                  where c.shipment_id = new.shipment_id
                    and c.stage = public.tracking_stage(new.kind)
                    and c.done_at is not null)
  then
    new.status := 'info';
  end if;
  return new;
end $fn$;

drop trigger if exists tracking_events_settle on public.tracking_events;
create trigger tracking_events_settle
  before insert on public.tracking_events
  for each row execute function public.tracking_event_settle();


-- ---------------------------------------------------------------------------
-- Acting on an event
--
-- Returns what happened: 'applied' (a step ticked or a date moved),
-- 'already' (that step was ticked before), 'no_step' (nothing on this job's
-- list is ticked by it — kept as a note). Refuses on a signed-off or
-- cancelled job, and for an estimate.
-- ---------------------------------------------------------------------------
create or replace function public.apply_tracking_event(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ev    public.tracking_events;
  v_ship  public.shipments;
  v_cp    public.shipment_checkpoints;
  v_stage text;
  v_src   text;
begin
  select * into v_ev from public.tracking_events where id = p_id for update;
  if not found then
    raise exception 'No such tracking update';
  end if;
  if v_ev.status in ('applied', 'dismissed') then
    return v_ev.status;
  end if;

  select * into v_ship from public.shipments where id = v_ev.shipment_id;
  if v_ship.signed_off_at is not null then
    raise exception '% is signed off', v_ship.id using hint = 'Reopen the sign-off first.';
  end if;
  if v_ship.stage = 'cancelled' then
    raise exception '% is cancelled', v_ship.id;
  end if;

  v_src := case v_ev.source
    when 'aerodatabox' then 'AeroDataBox' when 'adsb' then 'adsb.lol'
    when 'hapag_lloyd' then 'Hapag-Lloyd' when 'aisstream' then 'AIS' else 'mail' end;

  -- A changed plan — a new schedule, a rollover, a delay with its new dates —
  -- moves the booking's dates, and the due dates follow them (066).
  if v_ev.kind in ('schedule_changed', 'rolled_over', 'delayed')
     and (nullif(v_ev.data->>'etd', '') is not null or nullif(v_ev.data->>'eta', '') is not null)
  then
    update public.shipments
       set etd = coalesce(nullif(v_ev.data->>'etd', '')::date, etd),
           eta = coalesce(nullif(v_ev.data->>'eta', '')::date, eta),
           updated_at = now()
     where id = v_ship.id;
    update public.tracking_events
       set status = 'applied', decided_by = auth.uid(), decided_at = now()
     where id = p_id;
    return 'applied';
  end if;

  if v_ev.estimated then
    raise exception 'An estimate cannot tick a step';
  end if;

  v_stage := public.tracking_stage(v_ev.kind);
  if v_stage is not null then
    select * into v_cp from public.shipment_checkpoints
     where shipment_id = v_ship.id and stage = v_stage
     order by position limit 1
     for update;
  end if;
  if v_cp.id is null then
    update public.tracking_events
       set status = 'info', decided_by = auth.uid(), decided_at = now()
     where id = p_id;
    return 'no_step';
  end if;
  if v_cp.done_at is not null then
    update public.tracking_events
       set status = 'info', applied_step = v_cp.code, decided_by = auth.uid(), decided_at = now()
     where id = p_id;
    return 'already';
  end if;

  -- Ticked at the time it happened, never in the future.
  update public.shipment_checkpoints
     set done_at = least(coalesce(v_ev.occurred_at, now()), now()),
         done_by = auth.uid(),
         note    = btrim(note || case when note = '' then '' else E'\n' end
                         || format('From %s: %s', v_src, v_ev.detail))
   where id = v_cp.id;

  update public.tracking_events
     set status = 'applied', applied_step = v_cp.code, decided_by = auth.uid(), decided_at = now()
   where id = p_id;
  return 'applied';
end $fn$;

grant execute on function public.apply_tracking_event(uuid) to authenticated, service_role;
revoke execute on function public.apply_tracking_event(uuid) from public, anon;


-- "Keep as a note" or "not ours".
create or replace function public.dismiss_tracking_event(p_id uuid, p_keep boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  update public.tracking_events
     set status = case when p_keep then 'info' else 'dismissed' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id and status = 'new';
end $fn$;

grant execute on function public.dismiss_tracking_event(uuid, boolean) to authenticated;
revoke execute on function public.dismiss_tracking_event(uuid, boolean) from public, anon;


-- ---------------------------------------------------------------------------
-- What a mail said, as offers
--
-- The browser reads the mailbox (the only place the mail is), Gemini reads the
-- message, and this files what it found — every one of them an offer, because
-- a model read it. The message is marked read even when nothing was found, so
-- it is not sent again.
-- ---------------------------------------------------------------------------
create or replace function public.suggest_tracking_events(
  p_shipment_id text,
  p_message_id  text,
  p_events      jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_n int := 0;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from public.shipments where id = p_shipment_id) then
    raise exception 'no shipment %', p_shipment_id;
  end if;

  with ins as (
    insert into public.tracking_events
      (shipment_id, source, kind, occurred_at, estimated, location, detail, data, external_id, message_id, status)
    select p_shipment_id, 'mail', e->>'kind',
           nullif(e->>'occurred_at', '')::timestamptz,
           e->>'kind' in ('delayed', 'schedule_changed'),
           nullif(e->>'location', ''),
           coalesce(e->>'detail', ''),
           coalesce(e->'data', '{}'::jsonb),
           p_message_id || ':' || n,
           p_message_id,
           'new'
      from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) with ordinality as x(e, n)
     where e->>'kind' in ('cargo_received', 'stuffed', 'gate_in', 'loaded', 'departed', 'in_transit',
                          'arrived', 'discharged', 'customs_cleared', 'gate_out', 'out_for_delivery',
                          'delivered', 'delayed', 'rolled_over', 'schedule_changed', 'cancelled', 'other')
    on conflict (shipment_id, source, external_id) do nothing
    returning 1
  )
  select count(*) into v_n from ins;

  insert into public.tracking_mail_reads (shipment_id, message_id, found, read_by)
  values (p_shipment_id, p_message_id, v_n, auth.uid())
  on conflict (shipment_id, message_id) do update set read_at = now(), found = excluded.found;

  return v_n;
end $fn$;

grant execute on function public.suggest_tracking_events(text, text, jsonb) to authenticated;
revoke execute on function public.suggest_tracking_events(text, text, jsonb) from public, anon;


-- ---------------------------------------------------------------------------
-- The customer's page gets the carrier's news and where the cargo is
--
-- Provider events only — a line a model read from a mail reaches the customer
-- only by way of the step a person ticked from it. The position is shown
-- while the cargo is moving and the reading is less than three days old.
-- ---------------------------------------------------------------------------
create or replace function public.shipment_tracking(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_link public.shipment_track_links;
  s      public.shipments;
  v_cust text;
begin
  select * into v_link from public.shipment_track_links where token = p_token;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;
  if v_link.revoked then
    return jsonb_build_object('state', 'revoked');
  end if;

  select * into s from public.shipments where id = v_link.shipment_id;
  select coalesce(nullif(company, ''), name) into v_cust from public.customers where id = s.customer_id;

  -- The first open, for "opened by the customer" — not every refresh.
  update public.shipment_track_links set opened_at = now() where id = v_link.id and opened_at is null;

  return jsonb_build_object(
    'state',             'open',
    'reference',         s.enquiry_ref,
    'shipment',          s.id,
    'customer',          v_cust,
    'mode',              s.transport_mode,
    'stage',             s.stage,
    'stage_label',       case when s.stage = 'cancelled' then 'cancelled'
                              else public.stage_words(s.stage, s.transport_mode) end,
    'origin',            s.origin,
    'destination',       s.destination,
    'port_of_loading',   s.port_of_loading,
    'port_of_discharge', s.port_of_discharge,
    'carrier',           s.carrier,
    'flight_number',     s.flight_number,
    'vessel',            s.vessel,
    'voyage',            s.voyage,
    'etd',               coalesce(s.etd, s.sailing_date),
    'etd_time',          s.etd_time,
    'eta',               s.eta,
    'eta_time',          s.eta_time,
    'house_bill',        s.bl_number,
    'cargo',             s.cargo,
    'pieces',            s.piece_count,
    'gross_weight_kg',   s.gross_weight_kg,
    'volume_cbm',        s.volume_cbm,
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'label', c.label,
               'done_at', c.done_at,
               'due_on', c.due_on,
               'milestone', c.stage is not null)
             order by c.position)
        from public.shipment_checkpoints c
       where c.shipment_id = s.id), '[]'::jsonb),
    'delivered_to', (select received_by from public.shipment_movements
                      where shipment_id = s.id and kind = 'delivery' and actual_at is not null),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('at', e.occurred_at, 'what', e.detail, 'where', e.location)
             order by e.occurred_at desc)
        from public.tracking_events e
       where e.shipment_id = s.id
         and e.source <> 'mail'
         and e.status in ('applied', 'info')
         and not e.estimated
         and e.occurred_at is not null), '[]'::jsonb),
    'position', (
      select jsonb_build_object(
               'lat', (t.summary->>'lat')::numeric,
               'lon', (t.summary->>'lon')::numeric,
               'at',  coalesce(t.summary->>'position_at', t.fetched_at::text),
               'what', case t.source when 'aisstream' then coalesce(t.summary->>'name', s.vessel)
                                     else coalesce(s.flight_number, t.summary->>'flight', t.summary->>'callsign') end)
        from public.tracking_snapshots t
       where t.shipment_id = s.id
         and t.state = 'ok'
         and t.summary ? 'lat' and jsonb_typeof(t.summary->'lat') = 'number'
         and t.fetched_at > now() - interval '3 days'
         and s.stage not in ('delivered', 'cancelled')
       order by t.fetched_at desc
       limit 1)
  );
end $fn$;

grant execute on function public.shipment_tracking(text) to anon, authenticated;
