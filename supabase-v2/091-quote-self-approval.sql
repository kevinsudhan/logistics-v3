-- 091: Approving a quotation yourself, with a reason the admins read.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- A quotation written by somebody who is not an approver waits for one
-- (052, 062). That is right most of the time and wrong when the approvers are
-- out and the customer is on the phone. The user asked for a second way: the
-- person writing it may clear it themselves, but only by saying why, and that
-- reason goes to the administrators — who can accept it, or withdraw the
-- approval while the quotation has not yet gone.
--
-- WHAT IT IS NOT
--
-- A way round an approver. A quotation an approver has sent back cannot be
-- self-approved: their "no" stands until it is changed and sent for approval
-- again. And the reason is a sentence, not a tick: the database refuses one
-- under ten characters.
--
-- An edit after approval still sends it back to draft (064); approving it
-- again needs a new reason.
-- ---------------------------------------------------------------------------

alter table public.quotes
  add column if not exists self_approved              boolean not null default false,
  add column if not exists self_approval_reason       text    not null default '',
  add column if not exists self_approval_reviewed_at  timestamptz,
  add column if not exists self_approval_reviewed_by  uuid references auth.users(id) on delete set null,
  add column if not exists self_approval_review_note  text    not null default '';

create index if not exists quotes_self_approval_review_idx
  on public.quotes (approved_at desc)
  where self_approved and self_approval_reviewed_at is null;


-- The guard on who may approve (064), letting self_approve_quote through.
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
  --    Or self_approve_quote (091), which sets the flag for its own
  --    transaction only; nothing a browser sends can set it.
  if new.approval_status = 'approved'
     and (tg_op = 'INSERT' or old.approval_status is distinct from 'approved')
     and auth.uid() is not null
     and not public.approval_exempt(auth.uid())
     and coalesce(current_setting('app.self_approving', true), '') <> 'on'
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


-- The writer clears it, saying why.
create or replace function public.self_approve_quote(p_quote_id uuid, p_reason text)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row    public.quotes;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name   text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if length(v_reason) < 10 then
    raise exception 'Say why you are approving it yourself, in a sentence the admins will read';
  end if;

  select * into v_row from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'no such quote';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'That quotation has already gone to the customer';
  end if;
  if v_row.approval_status = 'rejected' then
    raise exception 'An approver sent this quotation back'
      using hint = 'Change it and send it for approval again; their decision stands until then.';
  end if;
  if v_row.approval_status = 'approved' then
    return v_row;
  end if;

  perform set_config('app.self_approving', 'on', true);
  update public.quotes
     set approval_status           = 'approved',
         submitted_at              = coalesce(submitted_at, now()),
         submitted_by              = coalesce(submitted_by, auth.uid()),
         approved_at               = now(),
         approved_by               = auth.uid(),
         approval_note             = 'Self-approved: ' || v_reason,
         self_approved             = true,
         self_approval_reason      = v_reason,
         self_approval_reviewed_at = null,
         self_approval_reviewed_by = null,
         self_approval_review_note = ''
   where id = p_quote_id
   returning * into v_row;
  perform set_config('app.self_approving', 'off', true);

  select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = auth.uid();
  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_row.enquiry_ref,
    'quote_self_approved',
    format('Quotation v%s self-approved by %s: %s', v_row.version, coalesce(v_name, 'the writer'), v_reason),
    jsonb_build_object('quote_id', v_row.id, 'version', v_row.version, 'reason', v_reason),
    auth.uid()
  );
  return v_row;
end $fn$;


-- An administrator reads the reason: fine, or the approval withdrawn while
-- the quotation has not gone (a note required, as on any send-back).
create or replace function public.review_self_approval(p_quote_id uuid, p_withdraw boolean, p_note text default '')
returns public.quotes
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row   public.quotes;
  v_note  text := btrim(coalesce(p_note, ''));
  v_admin boolean;
begin
  select coalesce(bool_or(role = 'admin'), false) into v_admin from public.profiles where id = auth.uid();
  if not v_admin then
    raise exception 'Only an administrator reviews a self-approval';
  end if;

  select * into v_row from public.quotes where id = p_quote_id;
  if not found or not v_row.self_approved then
    raise exception 'That quotation was not self-approved';
  end if;

  if p_withdraw then
    if v_row.status <> 'draft' then
      raise exception 'It has already gone to the customer; the approval cannot be withdrawn now';
    end if;
    if v_note = '' then
      raise exception 'Say why the approval is being withdrawn';
    end if;
    update public.quotes
       set approval_status           = 'rejected',
           approved_at               = now(),
           approved_by               = auth.uid(),
           approval_note             = 'Self-approval withdrawn: ' || v_note,
           self_approval_reviewed_at = now(),
           self_approval_reviewed_by = auth.uid(),
           self_approval_review_note = v_note
     where id = p_quote_id
     returning * into v_row;
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (v_row.enquiry_ref, 'quote_rejected',
            format('Quotation v%s: self-approval withdrawn by an admin: %s', v_row.version, v_note),
            jsonb_build_object('quote_id', v_row.id, 'version', v_row.version), auth.uid());
  else
    update public.quotes
       set self_approval_reviewed_at = now(),
           self_approval_reviewed_by = auth.uid(),
           self_approval_review_note = v_note
     where id = p_quote_id
     returning * into v_row;
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (v_row.enquiry_ref, 'quote_self_approval_reviewed',
            format('Self-approval of quotation v%s reviewed by an admin%s', v_row.version, case when v_note <> '' then ': ' || v_note else '' end),
            jsonb_build_object('quote_id', v_row.id, 'version', v_row.version), auth.uid());
  end if;
  return v_row;
end $fn$;

revoke execute on function public.self_approve_quote(uuid, text)                 from public, anon;
revoke execute on function public.review_self_approval(uuid, boolean, text)      from public, anon;
grant  execute on function public.self_approve_quote(uuid, text)                 to authenticated;
grant  execute on function public.review_self_approval(uuid, boolean, text)      to authenticated;
