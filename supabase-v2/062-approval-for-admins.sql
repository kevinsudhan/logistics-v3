-- ---------------------------------------------------------------------------
-- Admins do not wait for approval, and nobody else can skip it.
--
-- WHO IS EXEMPT
--
-- 052 made approval a separate authority from `role = 'admin'`. In practice
-- the people who run the company are the people who set its prices: an admin
-- sending a quotation IS the approval, and asking them to clear it first is a
-- step that exists only to be clicked through. So the exemption is now:
--
--   role = 'admin'  OR  can_approve_quotes
--
-- One function answers it, and every rule below asks that function — so
-- creating, submitting, sending and the approvals queue cannot disagree about
-- who counts.
--
-- THE HOLE THIS ALSO CLOSES
--
-- Approval was enforced when a quotation was cleared and when an accept link
-- was issued, but never when a quotation became `sent`. The case file's second
-- "Draft quotation" button called markQuoteSent with no reference to approval,
-- and anyone able to patch `quotes` could do the same. An uncleared rate could
-- reach a customer through the other button on the page.
--
-- The rule now lives on the table. A quotation leaving `draft` for `sent` or
-- `accepted` must be approved — unless the person moving it is exempt, in which
-- case it is recorded as cleared by them, at that moment. So an admin who
-- sends an employee's draft never sees a refusal; the record simply says they
-- cleared it.
--
-- Transitions only. A quotation already sent before this is left alone, and
-- sent -> accepted (including the customer's own button, which has no user)
-- is not checked: it was vetted on its way to `sent`.
--
-- TWO MORE WAYS ROUND IT, ALSO CLOSED
--
-- `quotes` lets any signed-in user update any column, and `created_by` is
-- supplied by the browser. So an employee could simply write
-- `approval_status = 'approved'`, or insert a quotation naming an admin as its
-- author and have 056 clear it for them. Now only an exempt caller — or the
-- system itself, with no user, as in a migration — can make a quotation
-- approved, and the creation rule looks at who is actually calling.
-- ---------------------------------------------------------------------------

create or replace function public.approval_exempt(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select role = 'admin' or can_approve_quotes from public.profiles where id = p_user),
    false
  )
$fn$;

grant execute on function public.approval_exempt(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Written by an exempt person: cleared on creation (056, widened)
-- ---------------------------------------------------------------------------
create or replace function public.auto_clear_approver_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- The caller, not the `created_by` the browser sent. Falls back to
  -- created_by only where there is no caller (service key, SQL console).
  if public.approval_exempt(coalesce(auth.uid(), new.created_by)) then
    new.approval_status := 'approved';
    new.approved_by     := coalesce(auth.uid(), new.created_by);
    new.approved_at     := now();
    new.approval_note   := 'No approval needed: written by an admin';
  end if;
  return new;
end $fn$;


-- ---------------------------------------------------------------------------
-- Submitted by an exempt person: cleared, not queued (057, widened)
--
-- Also accepts a quotation already pending or sent back, when the caller is
-- exempt: an admin looking at an employee's pending quote and choosing to send
-- it is clearing it, and should not have to go to the queue to say so.
-- ---------------------------------------------------------------------------
create or replace function public.submit_quote_for_approval(p_quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.quotes;
begin
  if public.approval_exempt(auth.uid()) then
    update public.quotes
       set approval_status = 'approved',
           submitted_at    = coalesce(submitted_at, now()),
           submitted_by    = coalesce(submitted_by, auth.uid()),
           approved_at     = now(),
           approved_by     = auth.uid(),
           approval_note   = 'No approval needed: cleared by an admin'
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
-- The queue: admins may decide too (052, widened)
-- ---------------------------------------------------------------------------
create or replace function public.decide_quote(
  p_quote_id uuid,
  p_approve  boolean,
  p_note     text default ''
) returns public.quotes
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.quotes;
begin
  if not public.approval_exempt(auth.uid()) then
    raise exception 'you are not an approver';
  end if;

  select * into v_row from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'no such quote';
  end if;

  if v_row.approval_status <> 'pending' then
    raise exception 'that quote is not waiting for approval';
  end if;

  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'say why it is being sent back';
  end if;

  update public.quotes
     set approval_status = case when p_approve then 'approved' else 'rejected' end,
         approved_at     = now(),
         approved_by     = auth.uid(),
         approval_note   = coalesce(p_note, '')
   where id = p_quote_id
   returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_row.enquiry_ref,
    case when p_approve then 'quote_approved' else 'quote_rejected' end,
    case when p_approve
         then 'Quotation v' || v_row.version || ' approved to send'
         else 'Quotation v' || v_row.version || ' sent back: ' || coalesce(p_note, '')
    end,
    jsonb_build_object('quote_id', v_row.id, 'version', v_row.version),
    auth.uid()
  );

  return v_row;
end $fn$;

grant execute on function public.decide_quote(uuid, boolean, text) to authenticated;


-- ---------------------------------------------------------------------------
-- The guard on sending
--
-- Named so it sorts after `quotes_auto_clear` (BEFORE triggers fire in name
-- order), so a quote inserted by an admin is already cleared when this looks.
-- ---------------------------------------------------------------------------
create or replace function public.require_approval_to_send()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.approval_status = 'approved'
     and (tg_op = 'INSERT' or old.approval_status is distinct from 'approved')
     and auth.uid() is not null
     and not public.approval_exempt(auth.uid())
  then
    raise exception 'only an admin can approve a quotation';
  end if;

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

drop trigger if exists quotes_require_approval on public.quotes;
create trigger quotes_require_approval
  before insert or update on public.quotes
  for each row execute function public.require_approval_to_send();


-- ---------------------------------------------------------------------------
-- Anything an admin wrote that is still sitting unapproved
-- ---------------------------------------------------------------------------
update public.quotes q
   set approval_status = 'approved',
       approved_at     = coalesce(q.approved_at, now()),
       approved_by     = coalesce(q.approved_by, q.created_by),
       approval_note   = 'No approval needed: written by an admin'
 where q.status = 'draft'
   and q.approval_status in ('draft', 'pending')
   and public.approval_exempt(q.created_by);

-- Postgres grants EXECUTE to PUBLIC by default, which includes the anonymous
-- key. Whether a given user id is an admin is nobody's business outside.
revoke execute on function public.approval_exempt(uuid) from public, anon;
