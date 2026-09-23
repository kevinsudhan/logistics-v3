-- 076: What the route map draws — where the cargo has been, and where places are.
--
-- ---------------------------------------------------------------------------
-- THE TRACK
--
-- 072 kept only the latest answer per source, which puts one dot on a map.
-- The route map draws the line the flight or ship actually took, so every
-- position a source reports is kept here: the AIS pings, the ADS-B sightings,
-- AeroDataBox's live position. Written by track-shipment with the service
-- key — no insert policy — once per source per timestamp.
--
-- WHERE PLACES ARE
--
-- The common ports and airports are listed in the app (src/lib/geo.ts). A
-- place that is not is looked up once, by a signed-in person's page, on
-- OpenStreetMap's Nominatim, and remembered here, so the next page — and the
-- customer's, which never looks anything up — has it. Place names and
-- coordinates only; nothing about any shipment.
-- ---------------------------------------------------------------------------

create table if not exists public.tracking_positions (
  id          bigint generated always as identity primary key,
  shipment_id text not null references public.shipments(id) on delete cascade,
  source      text not null check (source in ('aerodatabox', 'adsb', 'aisstream')),
  at          timestamptz not null,
  lat         double precision not null check (lat between -90 and 90),
  lon         double precision not null check (lon between -180 and 180),
  speed       double precision,
  heading     double precision,
  unique (shipment_id, source, at)
);

create index if not exists tracking_positions_idx on public.tracking_positions (shipment_id, at);

alter table public.tracking_positions enable row level security;
drop policy if exists tracking_positions_read on public.tracking_positions;
create policy tracking_positions_read on public.tracking_positions
  for select to authenticated using (true);


create table if not exists public.geo_places (
  query      text primary key,
  label      text not null,
  lat        double precision not null check (lat between -90 and 90),
  lon        double precision not null check (lon between -180 and 180),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.geo_places enable row level security;
drop policy if exists geo_places_read on public.geo_places;
create policy geo_places_read on public.geo_places
  for select to anon, authenticated using (true);

create or replace function public.remember_place(p_query text, p_label text, p_lat double precision, p_lon double precision)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if coalesce(btrim(p_query), '') = '' or length(p_query) > 200 then
    raise exception 'A place name is needed';
  end if;
  insert into public.geo_places (query, label, lat, lon, created_by)
  values (lower(btrim(p_query)), left(coalesce(p_label, p_query), 200), p_lat, p_lon, auth.uid())
  on conflict (query) do nothing;
end $fn$;

grant execute on function public.remember_place(text, text, double precision, double precision) to authenticated;
revoke execute on function public.remember_place(text, text, double precision, double precision) from public, anon;


-- The customer's page gets the track too: positions only, the last 500.
create or replace function public.shipment_track_points(p_token text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('lat', p.lat, 'lon', p.lon, 'at', p.at, 'source', p.source) order by p.at), '[]'::jsonb)
    from (
      select tp.* from public.tracking_positions tp
        join public.shipment_track_links l on l.shipment_id = tp.shipment_id
       where l.token = p_token and not l.revoked
       order by tp.at desc
       limit 500
    ) p
$fn$;

grant execute on function public.shipment_track_points(text) to anon, authenticated;
