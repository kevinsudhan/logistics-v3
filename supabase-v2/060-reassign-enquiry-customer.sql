-- ---------------------------------------------------------------------------
-- Pointing an enquiry at the right customer.
--
-- WHAT KEEPS HAPPENING
--
-- Mail from an address nobody has seen creates a customer. A regular client
-- writing from a colleague's address, or from a personal Gmail, therefore
-- arrives as a brand-new customer called "info" or "mengpan@jctrans.net" —
-- and their history splits in two. The directory shows Prapti Logistics with
-- twelve shipments and a stranger with one, and the one is Prapti's.
--
-- The desk knows who it is the moment they read the mail. This is how they say
-- so.
--
-- WHY IT MOVES THE EMAIL AND NOT JUST THE ENQUIRY
--
-- Re-pointing the enquiry fixes this job and nothing after it: the next mail
-- from the same address would create the same stranger again, because
-- `create_customer` matches on email and the address still belongs to the
-- stray record. So where the stray record is left with no other work, its
-- addresses and phone numbers move to the chosen customer and it is archived.
-- Next time, that address resolves to the right company on its own.
--
-- WHY IT DOES NOT DO THAT WHEN THE OLD RECORD HAS OTHER WORK
--
-- Then it is not obviously a stray. It may be a real, separate customer who
-- sent one enquiry on behalf of somebody else. Moving their address would send
-- their future mail to the wrong company, and there is no telling from here.
-- So in that case only this enquiry moves, and the old record is left as it is
-- for a person to look at.
--
-- WHY IT REFUSES ONCE AN INVOICE EXISTS
--
-- A tax invoice is raised against a named party and cannot be quietly
-- re-addressed. Changing the customer under an invoiced job would leave the
-- invoice naming one company and the job another. The correction for that is a
-- credit note and a fresh invoice, which is an accounts decision, not this one.
-- ---------------------------------------------------------------------------

create or replace function public.reassign_enquiry_customer(p_ref text, p_customer_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref      text := upper(p_ref);
  v_enq      public.enquiries;
  v_old      public.customers;
  v_new      public.customers;
  v_invoices int;
  v_other    int;
  v_merged   boolean := false;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select * into v_enq from public.enquiries where ref = v_ref for update;
  if not found then
    raise exception 'no enquiry %', v_ref;
  end if;

  -- Locked, so two enquiries moving to the same customer at once cannot both
  -- claim the same `seq` below.
  select * into v_new from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'no customer %', p_customer_id;
  end if;

  if v_enq.customer_id = p_customer_id then
    return jsonb_build_object('changed', false);
  end if;

  select count(*) into v_invoices
    from public.invoices i
   where i.enquiry_ref = v_ref
      or i.shipment_id in (select id from public.shipments where enquiry_ref = v_ref);
  if v_invoices > 0 then
    raise exception 'this job has % invoice(s) raised against the current customer; changing the customer needs a credit note first', v_invoices;
  end if;

  select * into v_old from public.customers where id = v_enq.customer_id;

  /*
    `seq` renumbered on the way in.

    Enquiries carry `unique (customer_id, seq)` — a per-customer counter from
    when references were built from it (ARX-C0002-E01). Moving an enquiry with
    seq 1 onto a regular customer who already has a seq 1 breaks that
    constraint, and a regular customer is exactly who this is used for. The
    reference itself comes from `reference_series` since 044 and does not
    change: renumbering seq renames nothing anybody reads.
  */
  update public.enquiries
     set customer_id = p_customer_id,
         seq = (select coalesce(max(seq), 0) + 1 from public.enquiries where customer_id = p_customer_id),
         updated_at = now()
   where ref = v_ref;
  -- The booking follows. A shipment belonging to one company on an enquiry
  -- belonging to another is two answers to "whose job is this".
  update public.shipments set customer_id = p_customer_id, updated_at = now()
   where enquiry_ref = v_ref;

  -- What else the old record still has to its name, now this job has gone.
  select (select count(*) from public.enquiries where customer_id = v_old.id)
       + (select count(*) from public.shipments where customer_id = v_old.id)
       + (select count(*) from public.invoices  where customer_id = v_old.id)
    into v_other;

  if v_old.id is not null and v_other = 0 then
    -- A stray. Its contact details were this customer's all along.
    update public.customers c
       set emails = (select array_agg(distinct e) from unnest(c.emails || v_old.emails) e where e <> ''),
           phones = (select array_agg(distinct p) from unnest(c.phones || v_old.phones) p where p <> ''),
           updated_at = now()
     where c.id = p_customer_id;

    -- Addresses emptied so `create_customer` can no longer match them to the
    -- archived record. Archived, not deleted: customers are never deleted.
    update public.customers
       set emails = '{}', phones = '{}', active = false,
           notes = trim(both from notes || E'\n' ||
                   'Merged into ' || p_customer_id || ' on ' || to_char(now(), 'DD Mon YYYY') ||
                   ' from ' || v_ref || '.'),
           updated_at = now()
     where id = v_old.id;
    v_merged := true;
  end if;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_ref,
    'customer_changed',
    'Customer changed from ' || coalesce(nullif(v_old.company, ''), v_old.name, '?') ||
      ' to ' || coalesce(nullif(v_new.company, ''), v_new.name) ||
      case when v_merged then ' — the old record was a duplicate and has been merged' else '' end,
    jsonb_build_object('from', v_old.id, 'to', p_customer_id, 'merged', v_merged),
    auth.uid()
  );

  return jsonb_build_object('changed', true, 'merged', v_merged, 'from', v_old.id);
end $fn$;

grant execute on function public.reassign_enquiry_customer(text, text) to authenticated;
