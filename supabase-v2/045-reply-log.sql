-- ---------------------------------------------------------------------------
-- Who answered, what they answered, and how long it took.
--
-- WHY THIS CANNOT BE READ OUT OF THE MAILBOX
--
-- Graph access here is delegated: the token is the signed-in person's, and it
-- reaches their mailbox and no other. That is the right permission to hold --
-- nobody needs to read a colleague's mail to run a desk -- but it means the
-- question an administrator actually has is unanswerable from Graph. "Did
-- anybody get back to Gulf Line" cannot be answered by a token that can only
-- see one inbox, and giving the app application-wide mail permissions to
-- answer it would be trading everyone's privacy for a timestamp.
--
-- So the timestamp is recorded here, at the moment the reply is sent, by the
-- person sending it. It is the one instant where all of it is known at once:
-- who is signed in, what they are answering, and when that thing arrived.
--
-- WHAT IT DOES NOT COVER, AND THIS MATTERS
--
-- Replies sent from Outlook directly. Somebody who answers an agent from their
-- phone leaves no row here, and the thread will look unanswered on this log
-- while plainly having been answered in the mailbox. That is a real gap and it
-- is stated on the screen rather than left for somebody to discover: this is a
-- record of what the CRM sent, not a claim about what the desk did.
--
-- WHY THE INBOUND TIME IS COPIED IN
--
-- `inbound_at` is the received time of the message being answered, taken from
-- Graph at send time and stored. Reading it back later would mean another
-- mailbox call per row, from an administrator whose token cannot see the
-- mailbox it lives in. Copied once, it is answerable forever and by anybody.
-- ---------------------------------------------------------------------------

create table if not exists public.mail_replies (
  id               uuid primary key default gen_random_uuid(),

  -- What was answered. The conversation is the thread; the message id is the
  -- particular mail, kept because a thread can be answered more than once.
  conversation_id  text not null,
  in_reply_to_id   text,
  subject          text not null default '',

  -- Who wrote in, and when it landed. Copied from the message at send time.
  inbound_from     text not null default '',
  inbound_at       timestamptz,

  -- The partner it concerns, where the reply was sent from their screen.
  -- Nullable on purpose: a reply to a customer is still worth logging, and
  -- `set null` rather than cascade so removing a partner does not erase the
  -- record that somebody answered them.
  partner_id       uuid references public.partners(id) on delete set null,

  -- Who answered, and when. `replied_at` is the server's clock, not the
  -- browser's: a desk machine with a wrong time would otherwise produce
  -- response times that are negative, which is the kind of number people stop
  -- trusting the whole screen over.
  replied_by       uuid references auth.users(id),
  replied_at       timestamptz not null default now()
);

create index if not exists mail_replies_partner_idx on public.mail_replies (partner_id, replied_at desc);
create index if not exists mail_replies_when_idx    on public.mail_replies (replied_at desc);

alter table public.mail_replies enable row level security;

-- Anyone signed in may record their own reply. `replied_by` is checked against
-- the caller so a row cannot be written in somebody else's name.
drop policy if exists mail_replies_insert on public.mail_replies;
create policy mail_replies_insert on public.mail_replies
  for insert to authenticated
  with check (replied_by = auth.uid());

-- Reading is the administrator's. This is a record of who did what and when,
-- which is oversight rather than operations, and 021 already draws that line
-- for the team page.
drop policy if exists mail_replies_read on public.mail_replies;
create policy mail_replies_read on public.mail_replies
  for select to authenticated
  using (
    replied_by = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- No update, no delete. A log that can be edited answers a different question
-- from the one it is being asked.


-- ---------------------------------------------------------------------------
-- What the administrator reads
--
-- A view rather than a query in the client, so the response time is computed
-- one way in one place. `null` where the inbound time was not known -- a reply
-- to something with no received time is still a reply, and inventing a
-- duration for it would be worse than admitting there is none.
-- ---------------------------------------------------------------------------
create or replace view public.partner_reply_log as
  select r.id,
         r.conversation_id,
         r.subject,
         r.inbound_from,
         r.inbound_at,
         r.replied_at,
         r.partner_id,
         coalesce(p.organisation, p.name, '')          as partner,
         coalesce(pr.full_name, pr.email, 'Unknown')   as replied_by_name,
         case
           when r.inbound_at is null then null
           else extract(epoch from (r.replied_at - r.inbound_at)) / 3600.0
         end                                           as hours_to_reply
    from public.mail_replies r
    left join public.partners p  on p.id = r.partner_id
    left join public.profiles pr on pr.id = r.replied_by
   order by r.replied_at desc;

grant select on public.partner_reply_log to authenticated;
