-- Schedule for 20260928000600_apk_packages.sql (kept apart: pg_cron only exists on Supabase).
-- Every 30 minutes, read up to 25 APKs' package names (a few hundred KB each, not the whole APK).

select cron.unschedule(jobname) from cron.job where jobname = 'arkstore-apk-packages';
select cron.schedule('arkstore-apk-packages', '7,37 * * * *', $$
  select extensions.http_set_curlopt('CURLOPT_TIMEOUT', '140');
  select status from extensions.http_get('https://wblaxicltignfcxxskjp.supabase.co/functions/v1/ios-source?task=apk-packages&refresh=25&t=' || extract(epoch from now())::bigint);
$$);
