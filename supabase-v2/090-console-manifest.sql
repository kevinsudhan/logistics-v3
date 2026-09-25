-- 090: The console's cargo manifest, sent to the destination agent.
--
-- ---------------------------------------------------------------------------
-- The manifest itself is drawn from what is already recorded — the console's
-- master bill and voyage, and each house B/L under it (085, 088) — so nothing
-- about its contents is stored. What is stored is that it went: when, to
-- whom, how many house bills it listed and whether it was provisional. Then
-- the console can say "sent 25 Sep with 4 house bills — 1 added since", which
-- is the case that goes wrong: a shipment put on the box after the agent was
-- sent the list.
-- ---------------------------------------------------------------------------

alter table public.consoles
  add column if not exists manifest_sent_at     timestamptz,
  add column if not exists manifest_sent_to     text not null default '',
  add column if not exists manifest_bills       int,
  add column if not exists manifest_provisional boolean not null default false;
