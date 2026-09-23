-- 073: The hourly tracking sweep.
--
-- ---------------------------------------------------------------------------
-- Every hour, `track-shipment` is asked to look at every job in motion. It
-- decides per source whether there could be news — a flight on its day, a
-- ship between sailing and arrival — and how long since it last asked, so
-- the free allowances go on the hours that matter (see SWEEP_EVERY_HOURS in
-- the function).
--
-- The credentials are read from Vault when the job runs, never written here:
-- `supabase-v2/set-track-secret.mjs` puts the shared secret in Vault and in
-- the function's secrets together, and puts the anonymous key beside it for
-- the gateway (the function refuses the anonymous key on its own).
--
-- A run with no key connected still helps: adsb.lol needs none, and a
-- carrier's or airline's key added later is picked up by the next run.
-- ---------------------------------------------------------------------------

select cron.unschedule('araxys-v2-track-shipments')
  where exists (select 1 from cron.job where jobname = 'araxys-v2-track-shipments');

select cron.schedule(
  'araxys-v2-track-shipments',
  '17 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://izgbrdeybhbepftloxgk.supabase.co/functions/v1/track-shipment',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'Authorization',  'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'track_anon_key'),
      'x-track-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'track_cron_secret')
    ),
    body    := jsonb_build_object('sweep', true),
    timeout_milliseconds := 120000
  );
  $cron$
);
