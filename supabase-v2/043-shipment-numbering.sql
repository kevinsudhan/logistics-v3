-- ---------------------------------------------------------------------------
-- A shipment number that does not collide with itself.
--
-- THE BUG
--
-- 014's `promote_enquiry` built the primary key by counting:
--
--     select count(*) into v_n from public.shipments;
--     v_id := 'ARX-SHP-' || lpad((v_n + 1)::text, 4, '0');
--
-- A count is not a sequence. It is only ever equal to "the next number" while
-- no row has been removed and nobody else is pressing the button, and it stops
-- being equal the moment either happens:
--
--   * Delete or re-seed one shipment and the count drops below the highest id
--     still in the table. The next promote computes an id that already exists
--     and the insert fails on `shipments_pkey`. It then fails on EVERY promote
--     after that, for everyone, until a row is added back.
--
--   * Two people promote at the same instant and both read the same count.
--     One wins; the other gets the same unique violation.
--
-- Either way the case file shows a raw Postgres error where it should show a
-- shipment. It reads as intermittent -- "sometimes it says it cannot push" --
-- because the arithmetic stays correct right up until it silently does not.
--
-- THE FIX
--
-- A sequence. nextval is atomic, never hands the same number to two callers,
-- and does not care what is in the table.
--
-- WHY GAPS ARE FINE HERE AND WERE NOT FINE IN 042
--
-- 042 went to real trouble for a GAPLESS invoice serial, because Rule 46(b)
-- requires one and a missing number on a tax invoice is a question from an
-- auditor. A shipment id is an internal operational handle: it identifies a
-- booking to us and to the customer, and nothing in law or accounting reads
-- the run of them. A rolled-back promote that burns 0007 costs nothing, and
-- paying for gaplessness here would mean serialising every promote behind one
-- lock for no benefit.
--
-- WHY THE SEQUENCE IS NOT GRANTED TO `authenticated`
--
-- `promote_enquiry` is security definer, so nextval runs as the function owner
-- and needs no grant. Granting usage directly would let any signed-in session
-- burn shipment numbers without creating a shipment, which is the one thing a
-- sequence cannot take back.
-- ---------------------------------------------------------------------------

create sequence if not exists public.shipment_no_seq as bigint minvalue 1;

-- Start above whatever is already there. Reading the highest id in the table
-- rather than the count is the whole point: these two numbers are exactly what
-- drifted apart.
do $$
declare
  v_max int;
begin
  select coalesce(max((substring(id from '[0-9]+$'))::int), 0)
    into v_max
    from public.shipments;

  -- is_called = false when the table is empty, so the first shipment is 0001
  -- rather than 0002.
  perform setval('public.shipment_no_seq', greatest(v_max, 1), v_max > 0);

  raise notice 'shipment_no_seq seeded from highest existing id: %', v_max;
end $$;


-- ---------------------------------------------------------------------------
-- The same function as 014, with the id taken from the sequence.
--
-- Everything else is unchanged and deliberately so: the written-acceptance
-- guard, the two different error messages, and the press-twice behaviour are
-- all still the rules 014 set out.
-- ---------------------------------------------------------------------------
create or replace function public.promote_enquiry(p_ref text)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_enq    public.enquiries;
  v_quote  public.quotes;
  v_verbal public.quotes;
  v_id     text;
  v_row    public.shipments;
begin
  select * into v_enq from public.enquiries where ref = upper(p_ref);
  if not found then
    raise exception 'No enquiry %', p_ref;
  end if;

  select * into v_quote
    from public.quotes
   where enquiry_ref = v_enq.ref
     and status = 'accepted'
     and accepted_via is not null
   order by version desc limit 1;

  if not found then
    -- Distinguish "they have not answered" from "they said yes on the phone
    -- and nobody got it in writing", because those need different actions.
    select * into v_verbal
      from public.quotes
     where enquiry_ref = v_enq.ref and verbal_accept_at is not null
     order by version desc limit 1;

    if found then
      raise exception 'Cannot start a shipment: % was accepted on a call but not confirmed in writing', v_enq.ref
        using hint = 'Send the quotation and confirm from their reply, or record the confirmation with a note.';
    end if;

    raise exception 'Cannot start a shipment: the customer has not accepted a quote on % yet', v_enq.ref
      using hint = 'Quote them first, then confirm their acceptance.';
  end if;

  -- Pressing twice returns what already exists rather than raising, because the
  -- second press means "did that work?" and an error there reads as a failure.
  --
  -- This check is also what makes the sequence safe to read afterwards: the
  -- number is only drawn once it is certain a row is going to be written.
  select * into v_row from public.shipments where enquiry_ref = v_enq.ref;
  if found then
    return v_row;
  end if;

  v_id := 'ARX-SHP-' || lpad(nextval('public.shipment_no_seq')::text, 4, '0');

  insert into public.shipments (id, enquiry_ref, customer_id, stage, sailing_date, agreed_inr)
  values (v_id, v_enq.ref, v_enq.customer_id, 'booked', v_quote.sailing_date, v_quote.amount_inr)
  returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (upper(p_ref), 'promoted', 'Moved to in-process shipments as ' || v_id,
          jsonb_build_object('shipment_id', v_id), auth.uid());

  return v_row;
end $fn$;

grant execute on function public.promote_enquiry(text) to authenticated;
