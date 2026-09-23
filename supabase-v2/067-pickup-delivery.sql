-- ---------------------------------------------------------------------------
-- Pickup and delivery: the first and last mile of a shipment.
--
-- WHAT IS KEPT WHERE
--
-- WHETHER there is a pickup or a delivery, and the ADDRESS, are the job's
-- facts and stay on the enquiry (061) — the same fields Service details edits.
-- This table holds what only exists once somebody arranges it: when, who
-- drives, which truck, how many pieces went on it, who signed for it at the
-- other end, and the proof.
--
-- WIRED TO THE WORKFLOW
--
-- The planned date IS the due date of the matching step on the workflow bar,
-- and recording it done ticks that step — so "delivered" here moves the
-- shipment to Delivered through the same milestone as everything else (066).
-- Clearing it unticks the step. One record, one answer.
-- ---------------------------------------------------------------------------

create table if not exists public.shipment_movements (
  id                     uuid primary key default gen_random_uuid(),
  shipment_id            text not null references public.shipments(id) on delete cascade,
  kind                   text not null check (kind in ('pickup', 'delivery')),
  planned_date           date,
  planned_time           time,
  -- When it actually happened. Null: not yet.
  actual_at              timestamptz,
  contact_name           text,
  contact_phone          text,
  transporter_partner_id uuid references public.partners(id) on delete set null,
  transporter            text,
  vehicle_number         text,
  driver_name            text,
  driver_phone           text,
  pieces                 int check (pieces is null or pieces >= 0),
  -- Delivery: who signed, and the signed proof, filed with the job's files.
  received_by            text,
  pod_file_id            uuid references public.enquiry_files(id) on delete set null,
  notes                  text,
  updated_at             timestamptz not null default now(),
  unique (shipment_id, kind)
);

alter table public.shipment_movements enable row level security;
drop policy if exists shipment_movements_all on public.shipment_movements;
create policy shipment_movements_all on public.shipment_movements
  for all to authenticated using (true) with check (true);


create or replace function public.movement_to_checkpoint()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Done or undone: the step follows.
  if tg_op = 'INSERT' or old.actual_at is distinct from new.actual_at then
    update public.shipment_checkpoints
       set done_at = new.actual_at,
           done_by = case when new.actual_at is null then null else coalesce(done_by, auth.uid()) end
     where shipment_id = new.shipment_id
       and code = new.kind
       and done_at is distinct from new.actual_at;
  end if;

  -- The planned date is the step's due date; clearing it hands the date back
  -- to the rule.
  if tg_op = 'INSERT' or old.planned_date is distinct from new.planned_date then
    if new.planned_date is not null then
      update public.shipment_checkpoints
         set due_on = new.planned_date, due_manual = true
       where shipment_id = new.shipment_id and code = new.kind;
    elsif tg_op = 'UPDATE' then
      update public.shipment_checkpoints
         set due_manual = false
       where shipment_id = new.shipment_id and code = new.kind;
      perform public.refresh_checkpoint_dues(new.shipment_id);
    end if;
  end if;

  return null;
end $fn$;

drop trigger if exists shipment_movements_checkpoint on public.shipment_movements;
create trigger shipment_movements_checkpoint
  after insert or update of actual_at, planned_date on public.shipment_movements
  for each row execute function public.movement_to_checkpoint();
