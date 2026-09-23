-- ---------------------------------------------------------------------------
-- Warehouse receipts: what actually arrived at our warehouse or the CFS.
--
-- WHY
--
-- The quotation was priced on what the shipper SAID: 14 pieces, 496 kg,
-- 3.2 CBM. The warehouse counts, weighs and measures what turns up — and it
-- is routinely different. A short delivery is a claim waiting to happen; a
-- heavier or bigger one is a chargeable weight the invoice has to follow, or
-- the difference comes out of the margin.
--
-- A RECEIPT PER DELIVERY
--
-- Cargo arrives in parts often enough — two trucks, a second lot three days
-- later — so each arrival is its own receipt, numbered on our own series,
-- and the totals are their sum.
--
-- WIRED TO THE WORKFLOW
--
-- The first receipt ticks the step that marks the cargo received (066) at the
-- time it was received; removing the last one unticks it.
-- ---------------------------------------------------------------------------

create sequence if not exists public.warehouse_receipt_seq;

create table if not exists public.warehouse_receipts (
  id              uuid primary key default gen_random_uuid(),
  shipment_id     text not null references public.shipments(id) on delete cascade,
  receipt_no      text not null unique
                    default ('WR-' || lpad(nextval('public.warehouse_receipt_seq')::text, 5, '0')),
  received_at     timestamptz not null default now(),
  location        text,
  partner_id      uuid references public.partners(id) on delete set null,
  pieces          int     check (pieces is null or pieces >= 0),
  gross_weight_kg numeric check (gross_weight_kg is null or gross_weight_kg >= 0),
  volume_cbm      numeric check (volume_cbm is null or volume_cbm >= 0),
  condition       text not null default 'good'
                    check (condition in ('good', 'damaged', 'short', 'wet')),
  bay             text,
  remarks         text,
  received_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists warehouse_receipts_idx on public.warehouse_receipts (shipment_id, received_at);

alter table public.warehouse_receipts enable row level security;
drop policy if exists warehouse_receipts_all on public.warehouse_receipts;
create policy warehouse_receipts_all on public.warehouse_receipts
  for all to authenticated using (true) with check (true);


create or replace function public.receipt_to_checkpoint()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ship  text := coalesce(new.shipment_id, old.shipment_id);
  v_first timestamptz;
begin
  select min(received_at) into v_first from public.warehouse_receipts where shipment_id = v_ship;

  if v_first is not null then
    -- Received: the milestone is done, at the first arrival — unless somebody
    -- already ticked it by hand, which stands.
    update public.shipment_checkpoints
       set done_at = v_first, done_by = coalesce(done_by, auth.uid())
     where shipment_id = v_ship and stage = 'cargo_received' and done_at is null;
  elsif tg_op = 'DELETE' then
    -- The last receipt removed: nothing has been received after all.
    update public.shipment_checkpoints
       set done_at = null, done_by = null
     where shipment_id = v_ship and stage = 'cargo_received';
  end if;
  return null;
end $fn$;

drop trigger if exists warehouse_receipts_checkpoint on public.warehouse_receipts;
create trigger warehouse_receipts_checkpoint
  after insert or delete or update of received_at on public.warehouse_receipts
  for each row execute function public.receipt_to_checkpoint();
