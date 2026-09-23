-- ---------------------------------------------------------------------------
-- A tracking link the customer can open without an account.
--
-- WHY
--
-- "Where is my cargo" is the mail the desk answers most, and the answer is
-- already in the system: the milestones ticked, the flight or vessel, the ETD
-- and ETA. A link the customer can open themselves answers it at three in the
-- morning without anybody typing it out.
--
-- WHAT IT SHOWS, AND WHAT IT DOES NOT
--
-- Shown: the reference, the route, the mode, where the cargo is, the steps
-- and when each was done or is due, the carrier and flight or vessel, the
-- dates, the house bill number, and the cargo's own pieces and weight.
--
-- Never shown: any money, notes, who in the office did what, the partners,
-- the costs, the other parties. `shipment_tracking` builds the answer column
-- by column, so a new column on shipments cannot leak onto this page by
-- being added.
--
-- THE TOKEN
--
-- The same as the quote links (053): two random uuids, 256 bits. One live
-- link per shipment; issuing again returns it. It lasts until revoked — a
-- delivered job's link still says it was delivered, which is the question
-- the customer's accounts department asks a month later.
-- ---------------------------------------------------------------------------

create table if not exists public.shipment_track_links (
  id          uuid primary key default gen_random_uuid(),
  shipment_id text not null references public.shipments(id) on delete cascade,
  token       text not null unique,
  revoked     boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  opened_at   timestamptz
);
create index if not exists shipment_track_links_idx on public.shipment_track_links (shipment_id) where not revoked;

alter table public.shipment_track_links enable row level security;
drop policy if exists shipment_track_links_read on public.shipment_track_links;
create policy shipment_track_links_read on public.shipment_track_links
  for select to authenticated using (true);
-- Written only through the functions below.


create or replace function public.issue_track_link(p_shipment_id text)
returns public.shipment_track_links
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.shipment_track_links;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from public.shipments where id = p_shipment_id) then
    raise exception 'no shipment %', p_shipment_id;
  end if;

  select * into v_row from public.shipment_track_links
   where shipment_id = p_shipment_id and not revoked limit 1;
  if found then
    return v_row;
  end if;

  insert into public.shipment_track_links (shipment_id, token, created_by)
  values (
    p_shipment_id,
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    auth.uid()
  )
  returning * into v_row;
  return v_row;
end $fn$;

grant execute on function public.issue_track_link(text) to authenticated;


create or replace function public.revoke_track_link(p_shipment_id text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  update public.shipment_track_links set revoked = true
   where shipment_id = p_shipment_id and not revoked;
end $fn$;

grant execute on function public.revoke_track_link(text) to authenticated;


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
                      where shipment_id = s.id and kind = 'delivery' and actual_at is not null)
  );
end $fn$;

-- The customer has no account: this is the one function the anonymous key
-- may call here, and it answers only for a token it is given.
grant execute on function public.shipment_tracking(text) to anon, authenticated;

-- Postgres grants EXECUTE to PUBLIC by default. Both refuse an anonymous
-- caller anyway; the grant is taken away so they are not even reachable.
revoke execute on function public.issue_track_link(text) from public, anon;
revoke execute on function public.revoke_track_link(text) from public, anon;
