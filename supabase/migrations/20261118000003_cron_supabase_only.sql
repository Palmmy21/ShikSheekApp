-- Hourly scheduler trigger (Supabase only: needs pg_cron + pg_net + Vault). Skipped by local tests.
--
-- BEFORE applying, store two secrets in Vault (SQL editor):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/scheduler', 'shiksheek_scheduler_url');
--   select vault.create_secret('<same value as the CRON_SECRET function secret>', 'shiksheek_cron_secret');
--
-- pg_cron runs in UTC; Bangkok is UTC+7 with no DST, so minute 5 of every UTC hour is minute 5 of
-- every Bangkok hour. The function itself decides which jobs are due (Asia/Bangkok).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'shiksheek-hourly',
  '5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'shiksheek_scheduler_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'shiksheek_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
