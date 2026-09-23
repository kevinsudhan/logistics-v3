-- 075: The house air waybill, as a document of its own.
--
-- ---------------------------------------------------------------------------
-- WHAT IT IS
--
-- On an air consolidation the airline issues one MAWB for the consol and we
-- issue each shipper a HAWB under it. The HAWB is the document the shipper
-- holds, laid out box for box like the IATA air waybill: parties, routing,
-- flights, the rate line, the charges and who they are due to, and the two
-- signatures.
--
-- WHY ITS OWN RECORD, NOT MORE COLUMNS ON THE SHIPMENT
--
-- The shipment is the job as it is; the HAWB is what was printed on the day.
-- It starts as a copy of the job ("Fetch details"), the desk then adjusts
-- what the document should say — the handling note, the charges shown, the
-- accounting line — and those edits belong to the document, not to the job.
-- The boxes are kept as one JSON document for the same reason the paper form
-- is one sheet: they are read and written together, and the form is what
-- decides their shape (src/lib/hawb.ts).
--
-- THE NUMBER
--
-- Its own series, in the form the desk already uses: origin / destination /
-- HAWB and seven digits — MAA/DXB/HAWB0000001. Allocated once, on the first
-- save, and written to the shipment's house bill so tracking, sign-off and
-- the customer's page show it. A job that was already given a house bill
-- number keeps it.
--
-- THE LOCK
--
-- Once the original is issued ("Original AWB issued: Yes") the shipper holds
-- it, and a change is a correction to be made deliberately: the boxes are
-- refused until an administrator sets it back to No. A signed-off job's HAWB
-- is closed with the job.
--
-- HISTORY
--
-- Every save writes which boxes changed, from what to what, and who — the
-- answer to "who changed the consignee on the HAWB" without asking round.
-- ---------------------------------------------------------------------------

create sequence if not exists public.hawb_seq;

create table if not exists public.house_airwaybills (
  shipment_id     text primary key references public.shipments(id) on delete cascade,
  hawb_no         text unique,
  hawb_date       date,
  -- A draft goes to the shipper for approval; the original is the one issued.
  awb_kind        text not null default 'draft' check (awb_kind in ('draft', 'original')),
  original_issued boolean not null default false,
  data            jsonb not null default '{}'::jsonb,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now()
);

create table if not exists public.house_airwaybill_history (
  id          uuid primary key default gen_random_uuid(),
  shipment_id text not null references public.shipments(id) on delete cascade,
  at          timestamptz not null default now(),
  actor       uuid references auth.users(id) on delete set null,
  action      text not null check (action in ('created', 'updated', 'numbered', 'issued', 'reopened', 'printed')),
  -- [{field, from, to}] for an update; empty otherwise.
  changes     jsonb not null default '[]'::jsonb,
  note        text not null default ''
);

create index if not exists house_airwaybill_history_idx
  on public.house_airwaybill_history (shipment_id, at desc);

alter table public.house_airwaybills        enable row level security;
alter table public.house_airwaybill_history enable row level security;

drop policy if exists house_airwaybills_read on public.house_airwaybills;
create policy house_airwaybills_read on public.house_airwaybills
  for select to authenticated using (true);
drop policy if exists house_airwaybills_write on public.house_airwaybills;
create policy house_airwaybills_write on public.house_airwaybills
  for insert to authenticated with check (true);
drop policy if exists house_airwaybills_update on public.house_airwaybills;
create policy house_airwaybills_update on public.house_airwaybills
  for update to authenticated using (true) with check (true);

drop policy if exists house_airwaybill_history_read on public.house_airwaybill_history;
create policy house_airwaybill_history_read on public.house_airwaybill_history
  for select to authenticated using (true);
-- No insert policy: history is written by the trigger and the functions below.


-- ---------------------------------------------------------------------------
-- The guard and the history, on every write
-- ---------------------------------------------------------------------------
create or replace function public.house_airwaybill_write()
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
    raise exception '% is signed off; its HAWB is closed with it', new.shipment_id
      using hint = 'Reopen the sign-off first.';
  end if;

  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    insert into public.house_airwaybill_history (shipment_id, actor, action)
    values (new.shipment_id, auth.uid(), 'created');
    return new;
  end if;

  -- Setting the original back to not issued is an administrator's call. Judged
  -- by the signed-in person: inside this function current_user is its owner,
  -- so a role check would pass everybody.
  if old.original_issued and not new.original_issued then
    select coalesce(bool_or(role = 'admin'), false) into v_admin from public.profiles where id = auth.uid();
    if auth.uid() is not null and not v_admin then
      raise exception 'Only an administrator can reopen an issued HAWB';
    end if;
    insert into public.house_airwaybill_history (shipment_id, actor, action, note)
    values (new.shipment_id, auth.uid(), 'reopened', 'Original AWB issued set back to No');
  end if;

  -- An issued original is not edited in place.
  if old.original_issued and new.original_issued
     and (new.data is distinct from old.data or new.hawb_date is distinct from old.hawb_date
          or new.awb_kind is distinct from old.awb_kind or new.hawb_no is distinct from old.hawb_no)
  then
    raise exception 'The original HAWB % has been issued', coalesce(old.hawb_no, '')
      using hint = 'Set "Original AWB issued" back to No to correct it (administrator).';
  end if;

  if not old.original_issued and new.original_issued then
    insert into public.house_airwaybill_history (shipment_id, actor, action, note)
    values (new.shipment_id, auth.uid(), 'issued', 'Original AWB issued');
  end if;

  -- Which boxes changed, from what to what.
  select coalesce(jsonb_agg(jsonb_build_object('field', k, 'from', old.data -> k, 'to', new.data -> k) order by k), '[]'::jsonb)
    into v_changes
    from (select jsonb_object_keys(old.data) as k union select jsonb_object_keys(new.data)) keys
   where (old.data -> k) is distinct from (new.data -> k);

  if new.hawb_date is distinct from old.hawb_date then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'hawb_date', 'from', old.hawb_date, 'to', new.hawb_date));
  end if;
  if new.awb_kind is distinct from old.awb_kind then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'awb_kind', 'from', old.awb_kind, 'to', new.awb_kind));
  end if;

  if jsonb_array_length(v_changes) > 0 then
    insert into public.house_airwaybill_history (shipment_id, actor, action, changes)
    values (new.shipment_id, auth.uid(), 'updated', v_changes);
  end if;
  return new;
end $fn$;

drop trigger if exists house_airwaybills_write on public.house_airwaybills;
create trigger house_airwaybills_write
  before insert or update on public.house_airwaybills
  for each row execute function public.house_airwaybill_write();


-- ---------------------------------------------------------------------------
-- The number
--
-- p_from and p_to are the airport codes printed on the form. A job that
-- already carries a house bill number keeps it rather than being given a
-- second one; either way the HAWB and the shipment agree afterwards.
-- ---------------------------------------------------------------------------
create or replace function public.number_hawb(p_shipment_id text, p_from text, p_to text)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ship public.shipments;
  v_hawb public.house_airwaybills;
  v_no   text;
  v_from text := upper(regexp_replace(coalesce(p_from, ''), '[^A-Za-z]', '', 'g'));
  v_to   text := upper(regexp_replace(coalesce(p_to, ''), '[^A-Za-z]', '', 'g'));
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'No shipment %', p_shipment_id;
  end if;

  select * into v_hawb from public.house_airwaybills where shipment_id = p_shipment_id for update;
  if not found then
    raise exception 'Save the HAWB before numbering it';
  end if;
  if v_hawb.hawb_no is not null then
    return v_hawb.hawb_no;
  end if;

  if coalesce(v_ship.bl_number, '') <> '' then
    v_no := v_ship.bl_number;
  else
    if length(v_from) <> 3 or length(v_to) <> 3 then
      raise exception 'The HAWB number needs the departure and destination airport codes'
        using hint = 'Three letters each, e.g. MAA and DXB.';
    end if;
    v_no := v_from || '/' || v_to || '/HAWB' || lpad(nextval('public.hawb_seq')::text, 7, '0');
    update public.shipments set bl_number = v_no, updated_at = now() where id = p_shipment_id;
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (v_ship.enquiry_ref, 'hbl_issued', format('HAWB %s numbered', v_no),
            jsonb_build_object('bl_number', v_no, 'shipment_id', p_shipment_id), auth.uid());
  end if;

  update public.house_airwaybills set hawb_no = v_no where shipment_id = p_shipment_id;
  insert into public.house_airwaybill_history (shipment_id, actor, action, note)
  values (p_shipment_id, auth.uid(), 'numbered', v_no);
  return v_no;
end $fn$;

grant execute on function public.number_hawb(text, text, text) to authenticated;
revoke execute on function public.number_hawb(text, text, text) from public, anon;


-- Printing is recorded: "which version did the shipper get" is a question.
create or replace function public.log_hawb_print(p_shipment_id text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from public.house_airwaybills where shipment_id = p_shipment_id) then
    raise exception 'Save the HAWB before printing it';
  end if;
  insert into public.house_airwaybill_history (shipment_id, actor, action, note)
  values (p_shipment_id, auth.uid(), 'printed', coalesce(p_note, ''));
end $fn$;

grant execute on function public.log_hawb_print(text, text) to authenticated;
revoke execute on function public.log_hawb_print(text, text) from public, anon;
