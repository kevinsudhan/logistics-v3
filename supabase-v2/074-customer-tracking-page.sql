-- 074: The customer's tracking page, in full.
--
-- ---------------------------------------------------------------------------
-- WHAT THE PAGE NOW ANSWERS
--
-- 069 gave the customer the route, the steps and the dates; 072 added the
-- carrier's own lines and a map. This adds what a customer asks next: which
-- milestone it is at (each step now says which milestone it marks), the legs
-- of the journey, when it was collected and delivered and who signed, when
-- it reached the warehouse and how much, the container numbers, and the
-- airline's or carrier's latest estimate where it differs from the booking.
--
-- STILL BUILT FIELD BY FIELD
--
-- Nothing is passed through whole. From the pickup and delivery: the dates,
-- the pieces and who signed — not the driver's name or phone, the vehicle, or
-- the desk's notes. From the warehouse: the date and the totals — not the
-- condition remarks, the bay or who received it. From the legs: the places,
-- dates, carrier and flight or voyage — not the truck or its driver. No money,
-- anywhere.
--
-- WHEN IT WAS LOOKED AT
--
-- The first open was already kept (069); the latest is kept too, so the desk
-- can see that a customer is following the link before they call.
-- ---------------------------------------------------------------------------

alter table public.shipment_track_links
  add column if not exists last_opened_at timestamptz;


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
    'delivered_to', (select received_by from public.shipment_movements
                      where shipment_id = s.id and kind = 'delivery' and actual_at is not null),
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', m.kind,
               'planned_date', m.planned_date,
               'planned_time', m.planned_time,
               'actual_at', m.actual_at,
               'pieces', m.pieces,
               'received_by', case when m.kind = 'delivery' then m.received_by end)
             order by m.kind desc)
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
