-- 098: The desk's IEC, for the export CSN (SCX).
--
-- On an export the CSN names the desk as the shipper on the carrier's master
-- B/L, and the guide asks for the shipper's IEC there ("in case of EX, IEC code
-- should be mentioned"). Since 2018 an IEC is the firm's PAN for most firms,
-- so the CSN uses the PAN when this is left blank; an older, different IEC goes
-- here. Set by an administrator, as the rest of icegate_settings (097).

alter table public.icegate_settings add column if not exists iec text not null default '';
