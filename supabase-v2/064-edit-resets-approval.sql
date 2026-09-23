-- ---------------------------------------------------------------------------
-- Changing an approved quotation sends it back for approval.
--
-- WHAT WAS WRONG
--
-- Approval cleared a quotation, not a set of figures. Once cleared it could be
-- edited freely before sending — the freight dropped by 200, a charge removed,
-- the validity stretched — and it went to the customer still marked as
-- approved. The approver had seen something else.
--
-- THE RULE
--
-- A change to anything the customer reads — the charges (name, rate, units,
-- currency, minimum), the total, the currency and exchange rate, the basis,
-- the validity, the sailing, the quote type, the terms — moves an approved
-- draft back to "not submitted", with a note saying why.
--
-- NOT RESET BY
--
--   the cost side (buying rate, vendor, cost currency): the customer never
--       sees it, and the margin is the approver's concern only through the
--       sell figures, which are covered;
--   an admin or approver making the change: they are clearing it as they
--       make it (062), so sending it back to themselves is the same loop 057
--       removed;
--   the system itself (no signed-in user), e.g. a migration;
--   anything already sent or accepted: those are handled elsewhere (an
--       accepted quote's charges cannot change at all — quote_lines_touch).
--
-- Pending quotations are left pending: the approver decides on the figures as
-- they are when they look, and pulling one out of the queue silently would
-- leave its author wondering why nobody answered.
-- ---------------------------------------------------------------------------

create or replace function public.reset_approval_after_edit(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref     text;
  v_version int;
begin
  if auth.uid() is null or public.approval_exempt(auth.uid()) then
    return;
  end if;

  update public.quotes
     set approval_status = 'draft',
         approved_at     = null,
         approved_by     = null,
         approval_note   = 'Changed after approval — send it for approval again'
   where id = p_quote_id
     and status = 'draft'
     and approval_status = 'approved'
  returning enquiry_ref, version into v_ref, v_version;

  if found then
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (
      v_ref,
      'quote_approval_reset',
      'Quotation v' || v_version || ' changed after approval — needs approving again',
      jsonb_build_object('quote_id', p_quote_id, 'version', v_version),
      auth.uid()
    );
  end if;
end $fn$;

revoke execute on function public.reset_approval_after_edit(uuid) from public, anon;


-- ---------------------------------------------------------------------------
-- The quotation's own fields: folded into the guard from 062, so the order is
-- explicit — reset first, then the checks on approving and sending see the
-- reset. (Two triggers would run in name order, and an edit and a send in one
-- update could otherwise slip through between them.)
-- ---------------------------------------------------------------------------
create or replace function public.require_approval_to_send()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- 1. A change to what the customer reads un-approves an approved draft.
  if tg_op = 'UPDATE'
     and old.status = 'draft'
     and old.approval_status = 'approved'
     and new.approval_status = 'approved'
     and auth.uid() is not null
     and not public.approval_exempt(auth.uid())
     and (   new.amount_inr    is distinct from old.amount_inr
          or new.currency      is distinct from old.currency
          or new.fx_rate       is distinct from old.fx_rate
          or new.basis         is distinct from old.basis
          or new.valid_until   is distinct from old.valid_until
          or new.sailing_date  is distinct from old.sailing_date
          or new.quote_type    is distinct from old.quote_type
          or new.multi_carrier is distinct from old.multi_carrier
          or new.terms         is distinct from old.terms)
  then
    new.approval_status := 'draft';
    new.approved_at     := null;
    new.approved_by     := null;
    new.approval_note   := 'Changed after approval — send it for approval again';
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (
      new.enquiry_ref,
      'quote_approval_reset',
      'Quotation v' || new.version || ' changed after approval — needs approving again',
      jsonb_build_object('quote_id', new.id, 'version', new.version),
      auth.uid()
    );
  end if;

  -- 2. Only an exempt caller, or the system, can make a quotation approved.
  if new.approval_status = 'approved'
     and (tg_op = 'INSERT' or old.approval_status is distinct from 'approved')
     and auth.uid() is not null
     and not public.approval_exempt(auth.uid())
  then
    raise exception 'only an admin can approve a quotation';
  end if;

  -- 3. Nothing reaches the customer uncleared; an exempt sender clears it.
  if new.status in ('sent', 'accepted')
     and (tg_op = 'INSERT' or old.status = 'draft')
     and coalesce(new.approval_status, 'draft') <> 'approved'
  then
    if public.approval_exempt(auth.uid()) then
      new.approval_status := 'approved';
      new.approved_by     := auth.uid();
      new.approved_at     := now();
      new.approval_note   := 'No approval needed: sent by an admin';
    else
      raise exception 'quotation v% has not been approved, so it cannot be %',
        new.version, new.status
        using hint = 'Send it for approval first.';
    end if;
  end if;

  return new;
end $fn$;


-- ---------------------------------------------------------------------------
-- The charge lines. Sell side only — see the header.
--
-- A line change usually moves the total too, which the rule above would catch
-- through recompute_quote_total. Not always: renaming a charge, changing its
-- unit, or moving an amount between two charges leaves the total where it was
-- and changes what the customer reads all the same.
-- ---------------------------------------------------------------------------
create or replace function public.quote_lines_reset_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    -- A blank row added to be filled in changes nothing yet. (`rate`
    -- defaults to 0, so zero counts as blank here.)
    if coalesce(btrim(new.description), '') = ''
       and coalesce(new.rate, 0) = 0 and coalesce(new.amount, 0) = 0
       and coalesce(new.min_amount, 0) = 0
    then
      return null;
    end if;
  elsif tg_op = 'DELETE' then
    if coalesce(btrim(old.description), '') = ''
       and coalesce(old.rate, 0) = 0 and coalesce(old.amount, 0) = 0
       and coalesce(old.min_amount, 0) = 0
    then
      return null;
    end if;
  elsif not (   new.description is distinct from old.description
             or new.charge_code is distinct from old.charge_code
             or new.sac_code    is distinct from old.sac_code
             or new.quantity    is distinct from old.quantity
             or new.unit        is distinct from old.unit
             or new.rate        is distinct from old.rate
             or new.currency    is distinct from old.currency
             or new.fx_rate     is distinct from old.fx_rate
             or new.amount      is distinct from old.amount
             or new.amount_inr  is distinct from old.amount_inr
             or new.min_amount  is distinct from old.min_amount)
  then
    return null;  -- cost side, vendor or ordering only
  end if;

  perform public.reset_approval_after_edit(coalesce(new.quote_id, old.quote_id));
  return null;
end $fn$;

drop trigger if exists quote_lines_reset_approval on public.quote_lines;
create trigger quote_lines_reset_approval
  after insert or update or delete on public.quote_lines
  for each row execute function public.quote_lines_reset_approval();
