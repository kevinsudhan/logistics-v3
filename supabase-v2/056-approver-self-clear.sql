-- ---------------------------------------------------------------------------
-- A quotation written by an approver needs no approval.
--
-- WHY THIS IS NOT THE SAME AS SELF-APPROVAL
--
-- 052 forbids approving a quotation you submitted, and that rule stands. It
-- exists so somebody without the authority cannot wave their own work through
-- by pressing the button themselves.
--
-- This is the other case: the person writing the quotation already HOLDS the
-- authority. Making Aashish send his own rate to Parasu for clearance is not a
-- second pair of eyes, it is the same pair of eyes and a delay — and the
-- predictable result is that the pair of them stop using the desk for urgent
-- quotations and send them from Outlook instead, which is the outcome the
-- approval step was built to prevent.
--
-- So: cleared at the moment it is written, by the person who wrote it, with
-- both recorded. The record still says who approved it and when. What it does
-- not do is make them wait for themselves.
--
-- WHY A TRIGGER AND NOT THE APPLICATION
--
-- Because `approval_status` is what the send button reads, and a check that
-- lives in the browser is one a modified request skips. The gate matters in
-- both directions: an employee's quotation must not arrive pre-approved, and
-- an approver's must not need a second visit.
--
-- WHY IT FIRES ON INSERT ONLY
--
-- A revision is a new row, so revising is covered. An UPDATE is not: a
-- quotation sent back with "drop the freight by 200" and then edited must go
-- round again, because what is being cleared is the figure, not the author.
-- ---------------------------------------------------------------------------

create or replace function public.auto_clear_approver_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.created_by is not null
     and coalesce(
           (select can_approve_quotes from public.profiles where id = new.created_by),
           false
         )
  then
    new.approval_status := 'approved';
    new.approved_by     := new.created_by;
    new.approved_at     := now();
    -- Said plainly on the quotation rather than left to be inferred from an
    -- approver and a submitter being the same person.
    new.approval_note   := 'Cleared on creation: written by an approver';
  end if;
  return new;
end $fn$;

drop trigger if exists quotes_auto_clear on public.quotes;
create trigger quotes_auto_clear
  before insert on public.quotes
  for each row execute function public.auto_clear_approver_quote();
