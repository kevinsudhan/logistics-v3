-- 089: Releasing our own house B/L.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- 085 made our house B/L a document we issue and lock. What happened to it
-- afterwards lived in people's heads: whether the shipper had paid, who took
-- the originals and when, whether all three came back for a telex release,
-- whether the agent had the release message, whether the cargo was out. That
-- is the part that goes wrong — cargo released on a telex while one original
-- is still with the shipper's bank, or originals handed over before the
-- freight was paid.
--
-- THE STEPS, BY HOW IT IS RELEASED
--
--   original  charges received · originals handed to the shipper (or their
--             bank or courier) · released at destination, against one
--             original surrendered to our agent
--   telex     charges received · the full set surrendered back to us at
--             origin · the telex release sent to our agent · released
--   express   charges received · release instructions sent to our agent
--             (a sea waybill: no originals) · released
--
-- The database holds the two rules that must never be broken: nothing is
-- released before the B/L is issued, and a telex release goes only once
-- every original is back. Every step is on the B/L's history and the
-- important ones on the case file's timeline.
-- ---------------------------------------------------------------------------

alter table public.house_bills
  add column if not exists charges_received_on   date,
  add column if not exists originals_released_on date,
  add column if not exists originals_released_to text not null default '',
  add column if not exists originals_returned    int  not null default 0,
  add column if not exists originals_returned_on date,
  add column if not exists release_sent_on       date,
  add column if not exists release_sent_to       text not null default '',
  add column if not exists released_on           date,
  add column if not exists release_note          text not null default '';

alter table public.house_bills drop constraint if exists house_bills_originals_returned_check;
alter table public.house_bills add constraint house_bills_originals_returned_check
  check (originals_returned between 0 and 3 and originals_returned <= originals);

alter table public.house_bill_history drop constraint if exists house_bill_history_action_check;
alter table public.house_bill_history add constraint house_bill_history_action_check
  check (action in ('created', 'updated', 'numbered', 'issued', 'reopened', 'printed', 'released'));


-- ---------------------------------------------------------------------------
-- The guard and the history, on every write (085, with the release added)
-- ---------------------------------------------------------------------------
create or replace function public.house_bill_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_changes  jsonb;
  v_release  jsonb;
  v_admin    boolean;
  v_ref      text;
  v_moved    boolean;
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

  -- ---- the release (089) ----
  v_moved := new.charges_received_on   is distinct from old.charges_received_on
          or new.originals_released_on is distinct from old.originals_released_on
          or new.originals_released_to is distinct from old.originals_released_to
          or new.originals_returned    is distinct from old.originals_returned
          or new.originals_returned_on is distinct from old.originals_returned_on
          or new.release_sent_on       is distinct from old.release_sent_on
          or new.release_sent_to       is distinct from old.release_sent_to
          or new.released_on           is distinct from old.released_on
          or new.release_note          is distinct from old.release_note;

  if v_moved then
    if new.status <> 'issued' then
      raise exception 'Issue the house B/L before recording its release';
    end if;
    if new.release_mode = 'telex' and new.release_sent_on is not null and new.originals_returned < new.originals then
      raise exception 'A telex release goes only once all % originals are back (% returned)', new.originals, new.originals_returned
        using hint = 'Record the full set surrendered to us first.';
    end if;
    if new.release_mode = 'express' and (new.originals_released_on is not null or new.originals_returned > 0) then
      raise exception 'A sea waybill has no originals to hand over or take back';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('field', f, 'from', o, 'to', n) order by f), '[]'::jsonb)
      into v_release
      from (values
        ('charges_received_on',   to_jsonb(old.charges_received_on),   to_jsonb(new.charges_received_on)),
        ('originals_released_on', to_jsonb(old.originals_released_on), to_jsonb(new.originals_released_on)),
        ('originals_released_to', to_jsonb(old.originals_released_to), to_jsonb(new.originals_released_to)),
        ('originals_returned',    to_jsonb(old.originals_returned),    to_jsonb(new.originals_returned)),
        ('originals_returned_on', to_jsonb(old.originals_returned_on), to_jsonb(new.originals_returned_on)),
        ('release_sent_on',       to_jsonb(old.release_sent_on),       to_jsonb(new.release_sent_on)),
        ('release_sent_to',       to_jsonb(old.release_sent_to),       to_jsonb(new.release_sent_to)),
        ('released_on',           to_jsonb(old.released_on),           to_jsonb(new.released_on)),
        ('release_note',          to_jsonb(old.release_note),          to_jsonb(new.release_note))
      ) as t(f, o, n)
     where o is distinct from n;

    insert into public.house_bill_history (shipment_id, actor, action, changes)
    values (new.shipment_id, auth.uid(), 'released', v_release);

    -- The moments a colleague reading the case file needs to see.
    select enquiry_ref into v_ref from public.shipments where id = new.shipment_id;
    if v_ref is not null then
      if new.originals_released_on is not null and old.originals_released_on is null then
        insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
        values (v_ref, 'hbl_originals_out',
                format('%s original%s of B/L %s handed over%s', new.originals, case when new.originals = 1 then '' else 's' end,
                       coalesce(new.hbl_no, ''), case when btrim(new.originals_released_to) <> '' then ' to ' || btrim(new.originals_released_to) else '' end),
                jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', new.hbl_no), auth.uid());
      end if;
      if new.originals_returned = new.originals and new.originals > 0 and old.originals_returned < old.originals then
        insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
        values (v_ref, 'hbl_surrendered', format('Full set of B/L %s surrendered to us for telex release', coalesce(new.hbl_no, '')),
                jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', new.hbl_no), auth.uid());
      end if;
      if new.release_sent_on is not null and old.release_sent_on is null then
        insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
        values (v_ref, 'telex_released',
                format('%s for B/L %s sent%s', case when new.release_mode = 'express' then 'Release instructions' else 'Telex release' end,
                       coalesce(new.hbl_no, ''), case when btrim(new.release_sent_to) <> '' then ' to ' || btrim(new.release_sent_to) else '' end),
                jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', new.hbl_no), auth.uid());
      end if;
      if new.released_on is not null and old.released_on is null then
        insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
        values (v_ref, 'cargo_released', format('Cargo released at destination against B/L %s', coalesce(new.hbl_no, '')),
                jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', new.hbl_no), auth.uid());
      end if;
    end if;
  end if;

  -- Reopening an issued B/L is an administrator's call. Judged by the signed-in
  -- person: inside this function current_user is its owner. Not once the
  -- originals are out: they are in somebody's hands as printed.
  if old.status = 'issued' and new.status = 'draft' then
    select coalesce(bool_or(role = 'admin'), false) into v_admin from public.profiles where id = auth.uid();
    if auth.uid() is not null and not v_admin then
      raise exception 'Only an administrator can reopen an issued house B/L';
    end if;
    if old.originals_released_on is not null and old.originals_returned < old.originals then
      raise exception 'The originals of % are out with %', coalesce(old.hbl_no, 'this B/L'), coalesce(nullif(btrim(old.originals_released_to), ''), 'the shipper')
        using hint = 'Take the full set back (record them surrendered) before reopening it for a correction.';
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

revoke execute on function public.house_bill_write() from public, anon, authenticated;
