-- ---------------------------------------------------------------------------
-- How far the correspondence has been read for shipment details.
--
-- WHAT IT IS FOR
--
-- A consol enquiry is answered in pieces: the CFS comes in one mail, the
-- cut-off in the agent's reply three days later, the UN number when somebody
-- finally asks whether it is hazardous. Nobody goes back to a details form to
-- type in what they have just read in a mail, so the fields stay blank while
-- the answers sit in the thread.
--
-- This column is the high-water mark: the `receivedDateTime` of the newest
-- message already read for details. When a thread gains a message newer than
-- it, and the enquiry still has blanks, the new correspondence is read once and
-- the blanks are filled. When it does not, nothing is read at all.
--
-- WHY A HIGH-WATER MARK AND NOT A FLAG
--
-- A flag answers "has this been read", which stops being true the moment a
-- reply arrives. A timestamp answers "read up to when", which stays true and
-- makes re-reading the same thread on every page load impossible. That matters
-- twice over: the reading costs a model call against live customer mail, and a
-- second reading of an unchanged thread can only produce what the first one
-- already did.
--
-- WHY IT IS NOT A GUARANTEE THAT EVERY FIELD WAS TRIED
--
-- It records that the correspondence was read, not that it yielded anything. A
-- thread read to its end that never mentioned a UN number leaves the field
-- blank and the mark set, which is correct — there is nothing there to find
-- until somebody writes another mail.
-- ---------------------------------------------------------------------------

alter table public.enquiries
  add column if not exists details_read_at timestamptz;

comment on column public.enquiries.details_read_at is
  'receivedDateTime of the newest message already read for shipment details. Blanks are re-read only when mail arrives after it.';
