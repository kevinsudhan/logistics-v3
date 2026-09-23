-- ---------------------------------------------------------------------------
-- Signing a job off: operations says it is finished, and it stays finished.
--
-- THE CHECKLIST IS THE DATABASE'S
--
-- `shipment_signoff_checklist` answers "is this job ready to close" and both
-- the screen and `sign_off_shipment` ask it — so the list somebody reads and
-- the rule that is enforced cannot drift apart.
--
--   Must pass    delivered; every step done; a proof of delivery filed.
--   Warnings     no tax invoice issued; no costs recorded; the house bill not
--                issued on a job that is not direct; a receipt that arrived
--                damaged, short or wet.
--
-- Warnings do not stop a sign-off — accounts often invoices after operations
-- closes a job — but they are said, and kept in the snapshot, so "it was
-- signed off without a POD" has a name and a reason attached.
--
-- WHO MAY OVERRIDE
--
-- A must-pass item that fails can be signed past by an admin only, with a
-- reason. An employee sees what is missing.
--
-- SIGNED OFF MEANS LOCKED
--
-- The stage of a signed-off job cannot move — unticking "delivered" on a job
-- accounts has closed would reopen it silently. Reopening is its own act, by
-- an admin, with a reason, on the timeline.
-- ---------------------------------------------------------------------------

alter table public.shipments
  add column if not exists signed_off_at     timestamptz,
  add column if not exists signed_off_by     uuid references auth.users(id) on delete set null,
  add column if not exists sign_off_note     text,
  add column if not exists sign_off_snapshot jsonb;


create or replace function public.shipment_signoff_checklist(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  s        public.shipments;
  v_open   int;
  v_pod    boolean;
  v_inv    int;
  v_bills  int;
  v_bad    int;
begin
  select * into s from public.shipments where id = p_id;
  if not found then
    raise exception 'no shipment %', p_id;
  end if;

  select count(*) into v_open from public.shipment_checkpoints where shipment_id = p_id and done_at is null;
  select exists (
           select 1 from public.shipment_movements m
            where m.shipment_id = p_id and m.kind = 'delivery' and m.pod_file_id is not null)
      or exists (
           select 1 from public.enquiry_files f
            where f.enquiry_ref = s.enquiry_ref and f.document_type = 'Proof of delivery')
    into v_pod;
  select count(*) into v_inv from public.invoices
   where shipment_id = p_id and kind = 'tax_invoice' and status in ('issued', 'part_paid', 'paid');
  select count(*) into v_bills from public.bills
   where shipment_id = p_id and status not in ('draft', 'cancelled');
  select count(*) into v_bad from public.warehouse_receipts
   where shipment_id = p_id and condition <> 'good';

  return jsonb_build_array(
    jsonb_build_object('key', 'delivered', 'blocking', true, 'ok', s.stage = 'delivered',
      'label', 'Delivered',
      'detail', case when s.stage = 'delivered' then null else 'The shipment is at ' || public.stage_words(s.stage, s.transport_mode) end),
    jsonb_build_object('key', 'steps', 'blocking', true, 'ok', v_open = 0,
      'label', 'Every workflow step done',
      'detail', case when v_open = 0 then null else v_open || ' still open' end),
    jsonb_build_object('key', 'pod', 'blocking', true, 'ok', v_pod,
      'label', 'Proof of delivery filed',
      'detail', case when v_pod then null else 'Attach it on Pickup & delivery or Documents' end),
    jsonb_build_object('key', 'invoice', 'blocking', false, 'ok', v_inv > 0,
      'label', 'Tax invoice issued',
      'detail', case when v_inv > 0 then v_inv || ' issued' else 'None issued yet' end),
    jsonb_build_object('key', 'costs', 'blocking', false, 'ok', v_bills > 0,
      'label', 'Costs recorded',
      'detail', case when v_bills > 0 then v_bills || ' bill(s)' else 'No carrier or vendor bills recorded' end),
    jsonb_build_object('key', 'house_bill', 'blocking', false, 'ok', s.direct or s.bl_number is not null,
      'label', 'House bill issued',
      'detail', case when s.direct then 'Direct — no house bill' when s.bl_number is not null then s.bl_number else 'Not issued' end),
    jsonb_build_object('key', 'condition', 'blocking', false, 'ok', v_bad = 0,
      'label', 'Received in good condition',
      'detail', case when v_bad = 0 then null else v_bad || ' receipt(s) damaged, short or wet' end)
  );
end $fn$;

grant execute on function public.shipment_signoff_checklist(text) to authenticated;
revoke execute on function public.shipment_signoff_checklist(text) from public, anon;


create or replace function public.sign_off_shipment(p_id text, p_note text default '')
returns public.shipments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row     public.shipments;
  v_list    jsonb;
  v_failing text;
  v_admin   boolean;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into v_row from public.shipments where id = p_id for update;
  if not found then
    raise exception 'no shipment %', p_id;
  end if;
  if v_row.signed_off_at is not null then
    raise exception 'already signed off';
  end if;

  v_list := public.shipment_signoff_checklist(p_id);
  select string_agg(item->>'label', ', ') into v_failing
    from jsonb_array_elements(v_list) item
   where (item->>'blocking')::boolean and not (item->>'ok')::boolean;

  if v_failing is not null then
    select role = 'admin' into v_admin from public.profiles where id = auth.uid();
    if not coalesce(v_admin, false) then
      raise exception 'not ready to sign off: %', v_failing
        using hint = 'An admin can sign it off anyway, with a reason.';
    end if;
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'signing off without %: say why', v_failing;
    end if;
  end if;

  update public.shipments
     set signed_off_at = now(),
         signed_off_by = auth.uid(),
         sign_off_note = nullif(btrim(p_note), ''),
         sign_off_snapshot = v_list,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (v_row.enquiry_ref, 'signed_off',
          p_id || ' signed off' ||
            case when v_failing is not null then ' without: ' || v_failing else '' end ||
            case when coalesce(btrim(p_note), '') <> '' then ' — ' || btrim(p_note) else '' end,
          jsonb_build_object('shipment_id', p_id, 'checklist', v_list),
          auth.uid());
  return v_row;
end $fn$;

grant execute on function public.sign_off_shipment(text, text) to authenticated;
revoke execute on function public.sign_off_shipment(text, text) from public, anon;


create or replace function public.reopen_signoff(p_id text, p_reason text)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.shipments;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'only an admin can reopen a signed-off job';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'say why it is being reopened';
  end if;

  update public.shipments
     set signed_off_at = null, signed_off_by = null, sign_off_note = null,
         sign_off_snapshot = null, updated_at = now()
   where id = p_id and signed_off_at is not null
   returning * into v_row;
  if not found then
    raise exception 'that job is not signed off';
  end if;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (v_row.enquiry_ref, 'signoff_reopened', p_id || ' reopened: ' || btrim(p_reason),
          jsonb_build_object('shipment_id', p_id), auth.uid());
  return v_row;
end $fn$;

grant execute on function public.reopen_signoff(text, text) to authenticated;
revoke execute on function public.reopen_signoff(text, text) from public, anon;


-- ---------------------------------------------------------------------------
-- The lock: a signed-off job's stage does not move, and the sign-off itself is
-- only set or cleared through the two functions above.
-- ---------------------------------------------------------------------------
create or replace function public.guard_signed_off()
returns trigger
language plpgsql
as $fn$
begin
  if old.signed_off_at is not null
     and new.signed_off_at is not null
     and new.stage is distinct from old.stage
  then
    raise exception '% is signed off; an admin has to reopen it before its progress can change', old.id;
  end if;
  return new;
end $fn$;

drop trigger if exists shipments_signed_off_lock on public.shipments;
create trigger shipments_signed_off_lock
  before update of stage on public.shipments
  for each row execute function public.guard_signed_off();

-- A plain update cannot sign a job off or clear a sign-off: only the functions,
-- which check the list and log it, may. They run as the table owner; a signed-
-- in user's own update does not.
create or replace function public.guard_signoff_columns()
returns trigger
language plpgsql
as $fn$
begin
  if current_user in ('authenticated', 'anon')
     and (new.signed_off_at is distinct from old.signed_off_at
          or new.signed_off_by is distinct from old.signed_off_by
          or new.sign_off_snapshot is distinct from old.sign_off_snapshot)
  then
    raise exception 'sign off or reopen through the Sign-off tab';
  end if;
  return new;
end $fn$;

drop trigger if exists shipments_signoff_columns on public.shipments;
create trigger shipments_signoff_columns
  before update on public.shipments
  for each row execute function public.guard_signoff_columns();
