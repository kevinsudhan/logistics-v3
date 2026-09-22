-- ---------------------------------------------------------------------------
-- The follow-ups a booking is actually worked through.
--
-- WHY THESE ARE NOT `stage`
--
-- `shipments.stage` is where the cargo IS — booked, stuffed, sailed, arrived.
-- It moves forward, one value at a time, and the boards are built on it.
--
-- These are a different thing: the chasing. Ringing the warehouse, getting the
-- HAWB draft back, confirming with the origin customer. They are not mutually
-- exclusive, they do not always happen in order, and half of them are complete
-- while the cargo sits at one stage. Folding them into `stage` would mean a
-- shipment that is "stuffed" and also "waiting on documents" having to pick
-- one, and the boards would start lying about where cargo is.
--
-- So: a checklist per booking, alongside the stage rather than instead of it.
--
-- WHY THE LIST DEPENDS ON THE MODE
--
-- An air job has a HAWB draft and a loading follow-up. A sea job has a VGM
-- filing and an SI cut-off. Giving both the same list means half of every
-- checklist is ticked "not applicable", which is how a checklist stops being
-- read.
--
-- WHY THEY ARE COPIED ONTO THE SHIPMENT AND NOT READ FROM THE TEMPLATE
--
-- The same reason the quotation copies its terms: editing the template must
-- not rewrite the history of a booking already worked. A job done last month
-- shows the steps it actually had.
-- ---------------------------------------------------------------------------

create table if not exists public.checkpoint_templates (
  id        uuid primary key default gen_random_uuid(),
  -- 'air', 'sea_lcl', 'sea_fcl', 'road', or 'default' where the mode is unknown.
  mode      text not null default 'default',
  position  int  not null,
  code      text not null,
  label     text not null,
  active    boolean not null default true,
  unique (mode, code)
);

create index if not exists checkpoint_templates_mode_idx
  on public.checkpoint_templates (mode, position) where active;

create table if not exists public.shipment_checkpoints (
  id          uuid primary key default gen_random_uuid(),
  shipment_id text not null references public.shipments(id) on delete cascade,

  position    int  not null,
  code        text not null,
  label       text not null,

  -- Null until somebody says it is done. The timestamp IS the record: "when did
  -- we get the HAWB draft back" is the question this answers.
  done_at     timestamptz,
  done_by     uuid references auth.users(id) on delete set null,
  -- What happened, where it is worth saying. "Warehouse says Thursday."
  note        text not null default '',

  created_at  timestamptz not null default now(),
  unique (shipment_id, code)
);

create index if not exists shipment_checkpoints_idx
  on public.shipment_checkpoints (shipment_id, position);

alter table public.checkpoint_templates  enable row level security;
alter table public.shipment_checkpoints  enable row level security;

drop policy if exists checkpoint_templates_read on public.checkpoint_templates;
create policy checkpoint_templates_read on public.checkpoint_templates
  for select to authenticated using (true);
drop policy if exists checkpoint_templates_write on public.checkpoint_templates;
create policy checkpoint_templates_write on public.checkpoint_templates
  for all to authenticated using (true) with check (true);

drop policy if exists shipment_checkpoints_read on public.shipment_checkpoints;
create policy shipment_checkpoints_read on public.shipment_checkpoints
  for select to authenticated using (true);
drop policy if exists shipment_checkpoints_write on public.shipment_checkpoints;
create policy shipment_checkpoints_write on public.shipment_checkpoints
  for all to authenticated using (true) with check (true);


-- ---------------------------------------------------------------------------
-- The standing lists
-- ---------------------------------------------------------------------------
insert into public.checkpoint_templates (mode, position, code, label) values
  ('air', 1, 'order_confirm',    'Order confirm'),
  ('air', 2, 'pickup',           'Pickup follow-up'),
  ('air', 3, 'warehouse',        'Warehouse follow-up'),
  ('air', 4, 'documents',        'Document follow-up'),
  ('air', 5, 'origin_customer',  'Origin customer follow-up'),
  ('air', 6, 'hawb_draft',       'HAWB draft follow-up'),
  ('air', 7, 'hawb_confirm',     'HAWB confirmation'),
  ('air', 8, 'loading',          'Loading follow-up'),

  ('sea_lcl', 1, 'order_confirm', 'Order confirm'),
  ('sea_lcl', 2, 'pickup',        'Pickup follow-up'),
  ('sea_lcl', 3, 'cfs',           'CFS delivery follow-up'),
  ('sea_lcl', 4, 'documents',     'Document follow-up'),
  ('sea_lcl', 5, 'si_cutoff',     'SI submitted'),
  ('sea_lcl', 6, 'bl_draft',      'B/L draft follow-up'),
  ('sea_lcl', 7, 'bl_confirm',    'B/L confirmation'),
  ('sea_lcl', 8, 'sailing',       'Sailing confirmation'),

  ('sea_fcl', 1, 'order_confirm', 'Order confirm'),
  ('sea_fcl', 2, 'empty_pickup',  'Empty container pickup'),
  ('sea_fcl', 3, 'stuffing',      'Stuffing follow-up'),
  ('sea_fcl', 4, 'vgm',           'VGM filed'),
  ('sea_fcl', 5, 'gate_in',       'Gate-in follow-up'),
  ('sea_fcl', 6, 'si_cutoff',     'SI submitted'),
  ('sea_fcl', 7, 'bl_confirm',    'B/L confirmation'),
  ('sea_fcl', 8, 'sailing',       'Sailing confirmation'),

  ('default', 1, 'order_confirm', 'Order confirm'),
  ('default', 2, 'pickup',        'Pickup follow-up'),
  ('default', 3, 'documents',     'Document follow-up'),
  ('default', 4, 'dispatch',      'Dispatch confirmation'),
  ('default', 5, 'delivery',      'Delivery confirmation')
on conflict (mode, code) do nothing;


-- ---------------------------------------------------------------------------
-- Seeding a new booking
--
-- On insert, so a shipment has its checklist the moment it exists rather than
-- the first time somebody opens the page. The mode comes from the enquiry the
-- booking was promoted from; where it was never recorded, the default list.
--
-- The first step is marked done on creation: a booking exists BECAUSE the order
-- was confirmed. Leaving it open would put every new shipment at step zero of
-- something it has already passed.
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
  select coalesce(e.transport_mode, 'default') into v_mode
    from public.enquiries e where e.ref = new.enquiry_ref;

  if not exists (select 1 from public.checkpoint_templates where mode = coalesce(v_mode, 'default')) then
    v_mode := 'default';
  end if;

  insert into public.shipment_checkpoints (shipment_id, position, code, label, done_at)
  select new.id, t.position, t.code, t.label,
         case when t.position = 1 then now() else null end
    from public.checkpoint_templates t
   where t.mode = coalesce(v_mode, 'default') and t.active
   order by t.position
  on conflict (shipment_id, code) do nothing;

  return new;
end $fn$;

drop trigger if exists shipments_seed_checkpoints on public.shipments;
create trigger shipments_seed_checkpoints
  after insert on public.shipments
  for each row execute function public.seed_shipment_checkpoints();

-- Existing bookings are backfilled at the foot of this file.

-- ---------------------------------------------------------------------------
-- Sending a booking back to the enquiry it came from
--
-- WHY THIS IS A DELETE AND NOT A FLAG
--
-- A booking made by mistake is a booking that should not have happened. Left
-- as a cancelled row it stays on the containers, the console and the document
-- register, and every count that says "how much is in process" has to remember
-- to exclude it.
--
-- WHY IT REFUSES ONCE MONEY IS INVOLVED
--
-- An invoice references the shipment with `on delete restrict` and is a
-- statutory document; a shipment that has been invoiced cannot be un-made by
-- anybody, and the correct instrument is a credit note. The function says so
-- rather than letting the foreign key raise something cryptic.
--
-- The enquiry goes back to `accepted`, not to `quoted`. The customer did accept
-- — that happened and undoing the booking does not unhappen it. It returns to
-- the inbound board as a job waiting to be started.
-- ---------------------------------------------------------------------------
create or replace function public.revert_shipment(p_id text, p_reason text default '')
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ship public.shipments;
  v_invoices int;
begin
  select * into v_ship from public.shipments where id = p_id;
  if not found then
    raise exception 'no shipment %', p_id;
  end if;

  select count(*) into v_invoices from public.invoices where shipment_id = p_id;
  if v_invoices > 0 then
    raise exception 'this booking has % invoice(s) against it and cannot be reverted; raise a credit note instead', v_invoices;
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'say why the booking is being sent back';
  end if;

  delete from public.shipment_checkpoints where shipment_id = p_id;
  delete from public.shipments where id = p_id;

  update public.enquiries
     set status = 'accepted', updated_at = now()
   where ref = v_ship.enquiry_ref;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_ship.enquiry_ref,
    'booking_reverted',
    'Booking ' || v_ship.id || ' sent back to the enquiry: ' || btrim(p_reason),
    jsonb_build_object('shipment_id', v_ship.id),
    auth.uid()
  );

  return v_ship.enquiry_ref;
end $fn$;

grant execute on function public.revert_shipment(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Backfill, now that the seeding function exists
-- ---------------------------------------------------------------------------
insert into public.shipment_checkpoints (shipment_id, position, code, label, done_at)
select s.id, t.position, t.code, t.label,
       case when t.position = 1 then s.created_at else null end
  from public.shipments s
  join public.enquiries e on e.ref = s.enquiry_ref
  join public.checkpoint_templates t
    on t.mode = coalesce(
         (select mode from public.checkpoint_templates
           where mode = coalesce(e.transport_mode, 'default') limit 1),
         'default')
 where t.active
on conflict (shipment_id, code) do nothing;
