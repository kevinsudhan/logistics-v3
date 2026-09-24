-- 079: Pickup and delivery, as a transport desk runs them.
--
-- ---------------------------------------------------------------------------
-- MORE THAN ONE
--
-- A consolidation often collects from two or three suppliers for one house
-- bill, and a delivery can be split. A job now has as many pickups and
-- deliveries as it needs (seq 1, 2, …). The workflow step is done when the
-- last of them is done, dated by the last; its due date is the earliest one
-- planned. The first pickup's address is still the enquiry's own (065) —
-- one record for the job — and the others carry theirs.
--
-- WHAT A MOVE CARRIES NOW
--
--   The route:     the door (place) and where the cargo goes — the CFS, the
--                  airline terminal, our warehouse (drop_point) — or, for a
--                  delivery, where it is collected from.
--   The window:    from planned_time to window_end.
--   The arranging: when the transport order went (requested_at); the truck
--                  and driver say it is assigned.
--   The papers:    the lorry receipt (LR) number and date; the e-way bill —
--                  GST Rule 138: road movement of goods over ₹50,000 needs one,
--                  valid a day per 200 km (per 20 km over-dimensional),
--                  counted from when the vehicle is entered (Part B) — its
--                  number, when it started, the distance and whether ODC.
--                  The expiry is worked out in the app (src/lib/movements.ts).
--   The handover:  pieces, weight and condition as counted, what was wrong,
--                  the container and seal on an FCL move, and the signed LR
--                  or POD (pod_file_id, filed with the job's documents).
--   What went wrong: each failed attempt, when and why.
--   The cost:      what the transporter charges; "record as a cost" makes it
--                  a draft vendor bill on the Costs tab (036), linked here.
-- ---------------------------------------------------------------------------

alter table public.shipment_movements
  add column if not exists seq              int not null default 1 check (seq >= 1),
  add column if not exists place            text,
  add column if not exists drop_point       text,
  add column if not exists window_end       time,
  add column if not exists requested_at     timestamptz,
  add column if not exists lr_number        text,
  add column if not exists lr_date          date,
  add column if not exists eway_bill_no     text check (eway_bill_no is null or eway_bill_no ~ '^\d{12}$'),
  add column if not exists eway_bill_at     timestamptz,
  add column if not exists eway_distance_km int check (eway_distance_km is null or eway_distance_km between 1 and 4000),
  add column if not exists eway_odc         boolean not null default false,
  add column if not exists container_number text,
  add column if not exists seal_number      text,
  add column if not exists gross_weight_kg  numeric(12, 2) check (gross_weight_kg is null or gross_weight_kg >= 0),
  add column if not exists condition        text check (condition in ('good', 'damaged', 'short')),
  add column if not exists exception_note   text,
  add column if not exists attempts         jsonb not null default '[]'::jsonb,
  add column if not exists cost_inr         numeric(12, 2) check (cost_inr is null or cost_inr >= 0),
  add column if not exists bill_id          uuid references public.bills(id) on delete set null;

alter table public.shipment_movements drop constraint if exists shipment_movements_shipment_id_kind_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shipment_movements_seq_key') then
    alter table public.shipment_movements add constraint shipment_movements_seq_key unique (shipment_id, kind, seq);
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- The step follows all of them
-- ---------------------------------------------------------------------------
create or replace function public.movements_to_checkpoint(p_shipment_id text, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count   int;
  v_open    int;
  v_last    timestamptz;
  v_planned date;
begin
  select count(*), count(*) filter (where actual_at is null), max(actual_at), min(planned_date)
    into v_count, v_open, v_last, v_planned
    from public.shipment_movements
   where shipment_id = p_shipment_id and kind = p_kind;

  -- Done when every one is done, dated by the last.
  update public.shipment_checkpoints
     set done_at = case when v_count > 0 and v_open = 0 then v_last end,
         done_by = case when v_count > 0 and v_open = 0 then coalesce(done_by, auth.uid()) end
   where shipment_id = p_shipment_id and code = p_kind
     and done_at is distinct from case when v_count > 0 and v_open = 0 then v_last end;

  -- Due by the earliest planned; none planned hands the date back to the rule.
  if v_planned is not null then
    update public.shipment_checkpoints set due_on = v_planned, due_manual = true
     where shipment_id = p_shipment_id and code = p_kind;
  else
    update public.shipment_checkpoints set due_manual = false
     where shipment_id = p_shipment_id and code = p_kind and due_manual;
    perform public.refresh_checkpoint_dues(p_shipment_id);
  end if;
end $fn$;

revoke execute on function public.movements_to_checkpoint(text, text) from public, anon;

create or replace function public.movement_to_checkpoint()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'DELETE' then
    perform public.movements_to_checkpoint(old.shipment_id, old.kind);
    return null;
  end if;
  if tg_op = 'INSERT'
     or old.actual_at is distinct from new.actual_at
     or old.planned_date is distinct from new.planned_date
  then
    perform public.movements_to_checkpoint(new.shipment_id, new.kind);
  end if;
  return null;
end $fn$;

drop trigger if exists shipment_movements_checkpoint on public.shipment_movements;
create trigger shipment_movements_checkpoint
  after insert or update of actual_at, planned_date or delete on public.shipment_movements
  for each row execute function public.movement_to_checkpoint();


-- A signed-off job's moves are closed with it.
create or replace function public.movement_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if exists (select 1 from public.shipments
              where id = coalesce(new.shipment_id, old.shipment_id) and signed_off_at is not null) then
    raise exception '% is signed off; its pickups and deliveries are closed with it', coalesce(new.shipment_id, old.shipment_id)
      using hint = 'Reopen the sign-off first.';
  end if;
  return coalesce(new, old);
end $fn$;

drop trigger if exists shipment_movements_guard on public.shipment_movements;
create trigger shipment_movements_guard
  before insert or update or delete on public.shipment_movements
  for each row execute function public.movement_guard();


-- ---------------------------------------------------------------------------
-- The transporter's charge, as a draft bill on the Costs tab
--
-- Draft, because the transporter's own invoice has not arrived: accounts
-- replace the number with theirs and receive it. The LR number stands in as
-- the bill number until then (unique per vendor, so suffixed if taken).
-- ---------------------------------------------------------------------------
create or replace function public.record_movement_cost(p_movement_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  m      public.shipment_movements;
  v_no   text;
  v_bill uuid;
  v_n    int := 1;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into m from public.shipment_movements where id = p_movement_id for update;
  if not found then
    raise exception 'No such pickup or delivery';
  end if;
  if m.bill_id is not null then
    return m.bill_id;
  end if;
  if m.transporter_partner_id is null then
    raise exception 'Choose the transporter from the partner book first'
      using hint = 'A bill is owed to a partner.';
  end if;
  if coalesce(m.cost_inr, 0) <= 0 then
    raise exception 'Enter what the transporter charges first';
  end if;

  v_no := coalesce(nullif(btrim(m.lr_number), ''), 'TRN-' || upper(left(replace(m.id::text, '-', ''), 8)));
  while exists (select 1 from public.bills where partner_id = m.transporter_partner_id and bill_no = v_no) loop
    v_n := v_n + 1;
    v_no := v_no || '-' || v_n;
  end loop;

  insert into public.bills (bill_no, partner_id, kind, status, shipment_id, remarks, recorded_by)
  values (v_no, m.transporter_partner_id, 'vendor_invoice', 'draft', m.shipment_id,
          format('%s %s, recorded from the job. Replace the number with the transporter''s invoice.',
                 initcap(m.kind), m.seq),
          auth.uid())
  returning id into v_bill;

  insert into public.bill_lines (bill_id, position, description, sac_code, quantity, unit, rate)
  values (v_bill, 1,
          format('%s: %s → %s%s', initcap(m.kind),
                 coalesce(nullif(m.place, ''), 'door'), coalesce(nullif(m.drop_point, ''), 'destination'),
                 case when m.lr_number is not null then ' (LR ' || m.lr_number || ')' else '' end),
          '996511', 1, 'trip', m.cost_inr);

  update public.shipment_movements set bill_id = v_bill, updated_at = now() where id = p_movement_id;
  return v_bill;
end $fn$;

grant execute on function public.record_movement_cost(uuid) to authenticated;
revoke execute on function public.record_movement_cost(uuid) from public, anon;


-- ---------------------------------------------------------------------------
-- The customer's page: more than one delivery can be signed for.
-- (074's function, with the signatures joined and the moves in order.)
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
  v_eta  jsonb;
  v_seen timestamptz;
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

  update public.shipment_track_links
     set opened_at = coalesce(opened_at, now()),
         last_opened_at = now()
   where id = v_link.id;

  -- The airline's or carrier's latest word on arrival, where it has one. Not
  -- the ship's own AIS ETA: that is typed by the crew for the next port.
  select jsonb_build_object(
           'eta', t.summary->>'eta_local',
           'source', case t.source when 'aerodatabox' then 'airline' else 'carrier' end,
           'at', t.fetched_at)
    into v_eta
    from public.tracking_snapshots t
   where t.shipment_id = s.id
     and t.state = 'ok'
     and t.source in ('aerodatabox', 'hapag_lloyd')
     and nullif(t.summary->>'eta_local', '') is not null
   order by t.fetched_at desc
   limit 1;

  -- "Last updated": the latest thing that moved on this job.
  select max(x) into v_seen from (
    select max(done_at) as x from public.shipment_checkpoints where shipment_id = s.id
    union all select max(actual_at) from public.shipment_movements where shipment_id = s.id
    union all select max(received_at) from public.warehouse_receipts where shipment_id = s.id
    union all select max(created_at) from public.tracking_events
               where shipment_id = s.id and status in ('applied', 'info') and source <> 'mail'
    union all select max(fetched_at) from public.tracking_snapshots where shipment_id = s.id and state = 'ok'
    union all select s.updated_at
  ) u;

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
    'latest_eta',        case when v_eta->>'eta' is distinct from s.eta::text then v_eta end,
    'house_bill',        s.bl_number,
    'cargo',             s.cargo,
    'pieces',            s.piece_count,
    'gross_weight_kg',   s.gross_weight_kg,
    'volume_cbm',        s.volume_cbm,
    'updated_at',        v_seen,
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'label', c.label,
               'done_at', c.done_at,
               'due_on', c.due_on,
               'milestone', c.stage is not null,
               'stage', c.stage)
             order by c.position)
        from public.shipment_checkpoints c
       where c.shipment_id = s.id), '[]'::jsonb),
    'delivered_to', (select string_agg(distinct received_by, ', ') from public.shipment_movements
                      where shipment_id = s.id and kind = 'delivery' and actual_at is not null and received_by is not null),
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', m.kind,
               'planned_date', m.planned_date,
               'planned_time', m.planned_time,
               'actual_at', m.actual_at,
               'pieces', m.pieces,
               'received_by', case when m.kind = 'delivery' then m.received_by end)
             order by m.kind desc, m.seq)
        from public.shipment_movements m
       where m.shipment_id = s.id), '[]'::jsonb),
    'received', (
      select jsonb_build_object(
               'first_at', min(r.received_at),
               'receipts', count(*),
               'pieces', sum(r.pieces),
               'gross_weight_kg', sum(r.gross_weight_kg),
               'volume_cbm', sum(r.volume_cbm))
        from public.warehouse_receipts r
       where r.shipment_id = s.id
      having count(*) > 0),
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'move', l.move,
               'from', l.from_place,
               'to', l.to_place,
               'etd', l.etd,
               'eta', l.eta,
               'carrier', l.carrier,
               'voyage_flight', l.voyage_flight,
               'status', l.status)
             order by l.position)
        from public.shipment_routings l
       where l.shipment_id = s.id), '[]'::jsonb),
    'containers', coalesce((
      select jsonb_agg(jsonb_build_object('number', c.container_no, 'type', c.size_type) order by c.position)
        from public.shipment_containers c
       where c.shipment_id = s.id and nullif(c.container_no, '') is not null), '[]'::jsonb),
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
