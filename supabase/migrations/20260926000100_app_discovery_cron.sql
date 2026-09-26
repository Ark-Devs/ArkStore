-- Schedules for supabase/migrations/20260926000000_app_discovery.sql (kept apart: pg_cron only
-- exists on Supabase, not in the test database).
-- 00:00 and then every 30 minutes until 05:00 Asia/Kolkata (UTC+5:30) = 18:30 to 23:30 UTC.
select cron.unschedule(jobname) from cron.job
 where jobname in ('arkstore-curated-publish', 'arkstore-discover-first', 'arkstore-discover');

select cron.schedule('arkstore-discover-first', '30 18 * * *', 'select arkstore_private.discover_apps()');
select cron.schedule('arkstore-discover', '*/30 19-23 * * *', 'select arkstore_private.discover_apps()');
select cron.schedule('arkstore-curated-publish', '*/10 * * * *', 'select arkstore_private.publish_discovered()');
