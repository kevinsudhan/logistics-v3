-- 088: A house B/L somebody else issued, received on our job.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- On an import the origin agent issues the house B/L and names us as the party
-- to apply to for delivery: World Jaguar's QDWJ26093202 from Qingdao, with
-- "For delivery of goods please apply to: AASHISH LOGISTICS GLOBAL PVT LTD".
-- Until now the job could only record their number (shipments.
-- forwarders_bl_no, 033). Nothing held the bill itself, whether we had checked
-- their draft, the house-level manifest we file as consol agent, or whether
-- the cargo could be released.
--
-- WHAT IS KEPT
--
--   the bill      who issued it (a partner, and the name as printed), their
--                 number and reference, its boxes as the same JSON our own
--                 B/L keeps (lib/hbl.ts), and the PDF they sent, on the
--                 Documents tab
--   the check     draft received → confirmed to the agent → final received,
--                 and the corrections we sent back
--   release       how it is released (originals, telex, express), an original
--                 surrendered, the telex received, charges paid, and our DO
--
-- The house-level manifest (IGM number and date, line, sub-line, CSN, CFS)
-- goes on the job's import customs record (077), where the bill of entry
-- already reads the IGM: one place for it, however the page gets there.
--
-- Their number is copied to shipments.forwarders_bl_no, so everything that
-- already reads it — the pre-alert, the arrival notice, the DO — prints it.
-- ---------------------------------------------------------------------------

create table if not exists public.received_house_bills (
  shipment_id        text primary key references public.shipments(id) on delete cascade,
  issuer_partner_id  uuid references public.partners(id) on delete set null,
  issuer_name        text not null default '',
  hbl_no             text not null default '',
  agent_ref          text not null default '',
  stage              text not null default 'draft' check (stage in ('draft', 'confirmed', 'final')),
  confirmed_at       timestamptz,
  confirmed_by       uuid references auth.users(id) on delete set null,
  corrections        text not null default '',
  release_mode       text not null default 'original' check (release_mode in ('original', 'telex', 'express')),
  originals          int  not null default 3 check (originals between 0 and 3),
  data               jsonb not null default '{}'::jsonb,
  file_id            uuid references public.enquiry_files(id) on delete set null,

  originals_surrendered_on date,
  telex_received_on        date,
  charges_cleared_on       date,
  do_issued_on             date,
  do_valid_until           date,

  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id) on delete set null,

  -- A sea waybill has no originals.
  check (release_mode <> 'express' or originals = 0),
  -- The DO goes out once the cargo can be released, never before it is dated.
  check (do_valid_until is null or do_issued_on is null or do_valid_until >= do_issued_on)
);

alter table public.received_house_bills enable row level security;

drop policy if exists received_house_bills_read on public.received_house_bills;
create policy received_house_bills_read on public.received_house_bills for select to authenticated using (true);
drop policy if exists received_house_bills_insert on public.received_house_bills;
create policy received_house_bills_insert on public.received_house_bills for insert to authenticated with check (true);
drop policy if exists received_house_bills_update on public.received_house_bills;
create policy received_house_bills_update on public.received_house_bills for update to authenticated using (true) with check (true);
revoke all on public.received_house_bills from anon;


-- ---------------------------------------------------------------------------
-- On every write: the sign-off lock, who and when, their number onto the job,
-- and the moments worth a line on the case file's timeline.
-- ---------------------------------------------------------------------------
create or replace function public.received_house_bill_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref text;
  v_no  text;
  v_by  text := coalesce(nullif(btrim(new.issuer_name), ''), 'the agent');
begin
  select enquiry_ref into v_ref from public.shipments where id = new.shipment_id;
  if exists (select 1 from public.shipments where id = new.shipment_id and signed_off_at is not null) then
    raise exception '% is signed off; its B/L is closed with it', new.shipment_id
      using hint = 'Reopen the sign-off first.';
  end if;

  new.hbl_no := upper(btrim(new.hbl_no));
  v_no := nullif(new.hbl_no, '');
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;

  -- Confirmed: when and by whom, set here so the page cannot claim either.
  if new.stage <> 'draft' and (tg_op = 'INSERT' or old.stage = 'draft') then
    new.confirmed_at := coalesce(new.confirmed_at, now());
    new.confirmed_by := coalesce(new.confirmed_by, auth.uid());
  elsif new.stage = 'draft' then
    new.confirmed_at := null;
    new.confirmed_by := null;
  end if;

  -- Their number is the job's house B/L from here on.
  if tg_op = 'INSERT' or new.hbl_no is distinct from old.hbl_no then
    update public.shipments
       set bl_type = 'forwarder', forwarders_bl_no = v_no, updated_at = now()
     where id = new.shipment_id
       and (bl_type is distinct from 'forwarder' or forwarders_bl_no is distinct from v_no);
  end if;

  if v_ref is not null then
    if tg_op = 'INSERT' then
      insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
      values (v_ref, 'hbl_received', format('House B/L %s received from %s', coalesce(v_no, '(unnumbered)'), v_by),
              jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', v_no, 'stage', new.stage), auth.uid());
    else
      if new.stage is distinct from old.stage and new.stage <> 'draft' then
        insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
        values (v_ref, case new.stage when 'confirmed' then 'hbl_confirmed' else 'hbl_final' end,
                case new.stage
                  when 'confirmed' then format('Draft B/L %s confirmed to %s', coalesce(v_no, ''), v_by)
                  else format('Final B/L %s received from %s', coalesce(v_no, ''), v_by)
                end,
                jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', v_no), auth.uid());
      end if;
      if new.do_issued_on is not null and old.do_issued_on is null then
        insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
        values (v_ref, 'do_issued', format('Delivery order issued against B/L %s', coalesce(v_no, '')),
                jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', v_no, 'valid_until', new.do_valid_until), auth.uid());
      end if;
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists received_house_bills_write on public.received_house_bills;
create trigger received_house_bills_write
  before insert or update on public.received_house_bills
  for each row execute function public.received_house_bill_write();

revoke execute on function public.received_house_bill_write() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- The house-level manifest, on the import customs record beside the IGM the
-- bill of entry reads (077).
-- ---------------------------------------------------------------------------
alter table public.shipment_customs
  add column if not exists igm_subline  text,
  add column if not exists csn_no       text,
  add column if not exists csn_filed_on date,
  add column if not exists cfs_code     text;


-- Live on the job file (084).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'received_house_bills'
  ) then
    alter publication supabase_realtime add table public.received_house_bills;
  end if;
end $$;
