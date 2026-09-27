-- Schedule for supabase/migrations/20260927000300_catalog_feeds.sql (kept apart: pg_cron only
-- exists on Supabase). Every 30 minutes 00:35-05:05 Asia/Kolkata (19:05-23:35 UTC), between the
-- other discovery jobs so GitHub's 10-searches-a-minute limit isn't shared. Feeds are read once a
-- day (the first run); later runs work through the import queue.
select cron.unschedule(jobname) from cron.job where jobname = 'arkstore-catalog-feeds';
select cron.schedule('arkstore-catalog-feeds', '5-59/30 19-23 * * *',
  'select arkstore_private.sync_catalog_feeds(); select arkstore_private.import_queued_repos();');
