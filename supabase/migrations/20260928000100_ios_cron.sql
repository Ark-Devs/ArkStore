-- Schedule for supabase/migrations/20260928000000_ios.sql (kept apart: pg_cron only exists on
-- Supabase, not in the test database).
-- ---------------------------------------------------------------------------
-- Every 30 minutes, ask the ios-source function to read up to 25 IPAs it hasn't read yet
-- (bundle ID, version, minimum iOS), so new iOS apps and releases reach the source without
-- waiting for someone to open it. The t= parameter skips the gateway's 5-minute cache.
-- ---------------------------------------------------------------------------

select cron.unschedule(jobname) from cron.job where jobname = 'arkstore-ios-source';
select cron.schedule('arkstore-ios-source', '17,47 * * * *', $$
  select extensions.http_set_curlopt('CURLOPT_TIMEOUT', '140');
  select status from extensions.http_get('https://wblaxicltignfcxxskjp.supabase.co/functions/v1/ios-source?refresh=25&t=' || extract(epoch from now())::bigint);
$$);
