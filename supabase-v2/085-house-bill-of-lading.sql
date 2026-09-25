-- 085: The house bill of lading, as a document of its own.
--
-- ---------------------------------------------------------------------------
-- WHAT IT IS
--
-- On a sea consolidation the carrier issues one master B/L for the box, to us,
-- and we issue each shipper a house B/L under it: shipper to consignee (or to
-- order), port to port, the marks, the containers and seals, what the goods
-- are said to be, freight prepaid or collect, where and when it was issued
-- and shipped on board, and how many originals. It is the document the
-- shipper holds, the bank negotiates and the consignee surrenders to get the
-- cargo. 035 gave it a number (shipments.bl_number) and nothing else.
--
-- The same shape as the HAWB (075): the boxes kept as one JSON document,
-- because the form decides their shape (src/lib/hbl.ts); numbered once on the
-- first save; locked once issued; every change and every print on its history.
--
-- HOW IT IS RELEASED
--
--   original  Originals are issued (one to three); the consignee surrenders one
--             at destination to get the cargo.
--   telex     Originals are issued and then surrendered back to us at origin;
--             the destination agent releases on our message.
--   express   No originals at all — a sea waybill, non-negotiable; the
--             consignee collects against identity.
--
-- UNDER WHOSE MTO
--
-- A house B/L issued from India is a multimodal transport document, and its
-- issuer has to be registered as a multimodal transport operator with the
-- DG Shipping. Until Aashish Logistics has its own registration it issues
-- them as agent under a partner's, so the partner record carries the MTO
-- registration number and each house B/L names the partner it was issued
-- under. The name and number are copied onto the document when it is filled,
-- so a partner's details changing later does not rewrite a B/L already out.
--
-- THE NUMBER
--
-- The FY series 035 introduced — HBL/26-27/0001 — which the desk chose to keep
-- (25 Sep 2026). A job already given a house bill number keeps it.
-- ---------------------------------------------------------------------------

alter table public.partners
  add column if not exists address          text not null default '',
  add column if not exists mto_registration text not null default '';


create table if not exists public.house_bills (
  shipment_id    text primary key references public.shipments(id) on delete cascade,
  hbl_no         text unique,
  status         text not null default 'draft' check (status in ('draft', 'issued')),
  release_mode   text not null default 'original' check (release_mode in ('original', 'telex', 'express')),
  -- How many originals are signed. None on a sea waybill.
  originals      int  not null default 3,
  mto_partner_id uuid references public.partners(id) on delete set null,
  data           jsonb not null default '{}'::jsonb,
  issued_at      timestamptz,
  issued_by      uuid references auth.users(id) on delete set null,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now(),
  constraint house_bills_originals_check check (
    (release_mode = 'express' and originals = 0) or (release_mode <> 'express' and originals between 1 and 3)
  )
);

create table if not exists public.house_bill_history (
  id          uuid primary key default gen_random_uuid(),
  shipment_id text not null references public.shipments(id) on delete cascade,
  at          timestamptz not null default now(),
  actor       uuid references auth.users(id) on delete set null,
  action      text not null check (action in ('created', 'updated', 'numbered', 'issued', 'reopened', 'printed')),
  -- [{field, from, to}] for an update; empty otherwise.
  changes     jsonb not null default '[]'::jsonb,
  note        text not null default ''
);

create index if not exists house_bill_history_idx on public.house_bill_history (shipment_id, at desc);

alter table public.house_bills        enable row level security;
alter table public.house_bill_history enable row level security;

drop policy if exists house_bills_read on public.house_bills;
create policy house_bills_read on public.house_bills for select to authenticated using (true);
drop policy if exists house_bills_insert on public.house_bills;
create policy house_bills_insert on public.house_bills for insert to authenticated with check (true);
drop policy if exists house_bills_update on public.house_bills;
create policy house_bills_update on public.house_bills for update to authenticated using (true) with check (true);

drop policy if exists house_bill_history_read on public.house_bill_history;
create policy house_bill_history_read on public.house_bill_history for select to authenticated using (true);
-- No insert policy: history is written by the trigger and the functions below.


-- ---------------------------------------------------------------------------
-- The guard and the history, on every write
-- ---------------------------------------------------------------------------
create or replace function public.house_bill_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_changes jsonb;
  v_admin   boolean;
begin
  if exists (select 1 from public.shipments where id = new.shipment_id and signed_off_at is not null) then
    raise exception '% is signed off; its house B/L is closed with it', new.shipment_id
      using hint = 'Reopen the sign-off first.';
  end if;

  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.status = 'issued' then
      raise exception 'Save the house B/L before issuing it';
    end if;
    insert into public.house_bill_history (shipment_id, actor, action)
    values (new.shipment_id, auth.uid(), 'created');
    return new;
  end if;

  -- Reopening an issued B/L is an administrator's call. Judged by the signed-in
  -- person: inside this function current_user is its owner.
  if old.status = 'issued' and new.status = 'draft' then
    select coalesce(bool_or(role = 'admin'), false) into v_admin from public.profiles where id = auth.uid();
    if auth.uid() is not null and not v_admin then
      raise exception 'Only an administrator can reopen an issued house B/L';
    end if;
    new.issued_at := null;
    new.issued_by := null;
    insert into public.house_bill_history (shipment_id, actor, action, note)
    values (new.shipment_id, auth.uid(), 'reopened', 'Set back to draft');
    return new;
  end if;

  -- An issued B/L is not edited in place: the shipper, the bank or the
  -- consignee is holding it.
  if old.status = 'issued' and new.status = 'issued'
     and (new.data is distinct from old.data or new.release_mode is distinct from old.release_mode
          or new.originals is distinct from old.originals or new.hbl_no is distinct from old.hbl_no
          or new.mto_partner_id is distinct from old.mto_partner_id)
  then
    raise exception 'House B/L % has been issued', coalesce(old.hbl_no, '')
      using hint = 'An administrator can set it back to draft to correct it.';
  end if;

  if old.status = 'draft' and new.status = 'issued' then
    if new.hbl_no is null then
      raise exception 'Number the house B/L before issuing it';
    end if;
    new.issued_at := now();
    new.issued_by := auth.uid();
    insert into public.house_bill_history (shipment_id, actor, action, note)
    values (new.shipment_id, auth.uid(), 'issued',
            case new.release_mode
              when 'express' then 'Issued as a sea waybill (express release)'
              else format('%s original%s issued%s', new.originals, case when new.originals = 1 then '' else 's' end,
                          case when new.release_mode = 'telex' then ', for telex release' else '' end)
            end);
    return new;
  end if;

  -- Which boxes changed, from what to what.
  select coalesce(jsonb_agg(jsonb_build_object('field', k, 'from', old.data -> k, 'to', new.data -> k) order by k), '[]'::jsonb)
    into v_changes
    from (select jsonb_object_keys(old.data) as k union select jsonb_object_keys(new.data)) keys
   where (old.data -> k) is distinct from (new.data -> k);

  if new.release_mode is distinct from old.release_mode then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'release_mode', 'from', old.release_mode, 'to', new.release_mode));
  end if;
  if new.originals is distinct from old.originals then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'originals', 'from', old.originals, 'to', new.originals));
  end if;
  if new.mto_partner_id is distinct from old.mto_partner_id then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'mto_partner_id', 'from', old.mto_partner_id, 'to', new.mto_partner_id));
  end if;

  if jsonb_array_length(v_changes) > 0 then
    insert into public.house_bill_history (shipment_id, actor, action, changes)
    values (new.shipment_id, auth.uid(), 'updated', v_changes);
  end if;
  return new;
end $fn$;

drop trigger if exists house_bills_write on public.house_bills;
create trigger house_bills_write
  before insert or update on public.house_bills
  for each row execute function public.house_bill_write();


-- ---------------------------------------------------------------------------
-- The number
--
-- On the first save that names a consignee (or says "to order"). A job that
-- already carries a house bill number — issued from the console before this
-- form existed — keeps it; either way the B/L and the shipment agree.
-- ---------------------------------------------------------------------------
create or replace function public.number_hbl(p_shipment_id text)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ship public.shipments;
  v_hbl  public.house_bills;
  v_no   text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'No shipment %', p_shipment_id;
  end if;
  select * into v_hbl from public.house_bills where shipment_id = p_shipment_id for update;
  if not found then
    raise exception 'Save the house B/L before numbering it';
  end if;
  if v_hbl.hbl_no is not null then
    return v_hbl.hbl_no;
  end if;

  if coalesce(v_hbl.data ->> 'consignee_mode', 'named') <> 'to_order'
     and btrim(coalesce(v_hbl.data ->> 'consignee_name', '')) = '' then
    raise exception 'The house B/L needs a consignee before it is numbered'
      using hint = 'Name the consignee, or make it "to order".';
  end if;

  if coalesce(v_ship.bl_number, '') <> '' then
    v_no := v_ship.bl_number;
  else
    v_no := public.allocate_invoice_number('HBL', current_date);
    update public.shipments set bl_number = v_no, updated_at = now() where id = p_shipment_id;
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (v_ship.enquiry_ref, 'hbl_issued', format('House B/L %s numbered', v_no),
            jsonb_build_object('bl_number', v_no, 'shipment_id', p_shipment_id), auth.uid());
  end if;

  update public.house_bills set hbl_no = v_no where shipment_id = p_shipment_id;
  insert into public.house_bill_history (shipment_id, actor, action, note)
  values (p_shipment_id, auth.uid(), 'numbered', v_no);
  return v_no;
end $fn$;


-- Printing is recorded: "which copy did the shipper get, and when" is a question.
create or replace function public.log_hbl_print(p_shipment_id text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from public.house_bills where shipment_id = p_shipment_id) then
    raise exception 'Save the house B/L before printing it';
  end if;
  insert into public.house_bill_history (shipment_id, actor, action, note)
  values (p_shipment_id, auth.uid(), 'printed', coalesce(p_note, ''));
end $fn$;


-- ---------------------------------------------------------------------------
-- Grants (082: a function is callable by PUBLIC until that is revoked)
-- ---------------------------------------------------------------------------
revoke execute on function public.number_hbl(text)            from public, anon;
revoke execute on function public.log_hbl_print(text, text)   from public, anon;
revoke execute on function public.house_bill_write()          from public, anon, authenticated;
grant  execute on function public.number_hbl(text)            to authenticated;
grant  execute on function public.log_hbl_print(text, text)   to authenticated;


-- ---------------------------------------------------------------------------
-- Live for everyone with the job open (084)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['house_bills', 'house_bill_history'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
