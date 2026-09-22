-- ---------------------------------------------------------------------------
-- Submitting your own quotation, when you are the one who clears them.
--
-- WHAT 056 MISSED
--
-- It fires on insert, so an approver's NEW quotation arrives cleared. It does
-- nothing for a quotation that already existed and was then submitted — and
-- that is not a migration-day edge case, it is the ordinary path for every
-- quotation written before 056 and for anyone who presses the button out of
-- habit.
--
-- The symptom was exactly that: Aashish, a named approver, looking at his own
-- quotation reading "Waiting for approval. It cannot go to the customer until
-- one of them clears it" — waiting for himself.
--
-- WHY THE SUBMIT PATH DECIDES RATHER THAN THE BUTTON BEING HIDDEN
--
-- Hiding the button in the browser leaves the rule in one place and the
-- behaviour in another. Whatever calls `submit_quote_for_approval`, an
-- approver's own quotation comes back cleared rather than queued — so there is
-- no sequence of clicks, stale tab or replayed request that can park one of
-- their quotations in a queue only they can empty.
-- ---------------------------------------------------------------------------

create or replace function public.submit_quote_for_approval(p_quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.quotes;
  v_may boolean;
begin
  select coalesce(can_approve_quotes, false) into v_may
    from public.profiles where id = auth.uid();

  if coalesce(v_may, false) then
    -- The caller holds the authority. Sending it to themselves is not a
    -- review, so it is recorded as cleared by them, now.
    update public.quotes
       set approval_status = 'approved',
           submitted_at    = now(),
           submitted_by    = auth.uid(),
           approved_at     = now(),
           approved_by     = auth.uid(),
           approval_note   = 'Cleared on submission: you are an approver'
     where id = p_quote_id
       and status = 'draft'
     returning * into v_row;
  else
    update public.quotes
       set approval_status = 'pending',
           submitted_at    = now(),
           submitted_by    = auth.uid(),
           approval_note   = ''
     where id = p_quote_id
       and status = 'draft'
     returning * into v_row;
  end if;

  if not found then
    raise exception 'that quote cannot be submitted: it is not a draft, or it does not exist';
  end if;
  return v_row;
end $fn$;

grant execute on function public.submit_quote_for_approval(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- The ones already sitting in the queue
--
-- Quotations written by an approver that are waiting for approval under the old
-- rule. Under the new one they never needed it.
--
-- Deliberately narrow:
--   * `status = 'draft'` only — nothing already sent to a customer is touched.
--   * 'rejected' is left alone. Somebody deliberately sent that one back, and a
--     migration should not overturn a decision a person made.
-- ---------------------------------------------------------------------------
update public.quotes q
   set approval_status = 'approved',
       approved_at     = coalesce(q.approved_at, now()),
       approved_by     = coalesce(q.approved_by, q.created_by),
       approval_note   = 'Cleared: written by an approver'
  from public.profiles p
 where p.id = q.created_by
   and p.can_approve_quotes
   and q.status = 'draft'
   and q.approval_status in ('draft', 'pending');
