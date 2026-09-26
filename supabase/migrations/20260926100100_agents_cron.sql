-- Schedules for supabase/migrations/20260926100000_agents.sql (kept apart: pg_cron only exists on
-- Supabase, not in the test database).
-- ---------------------------------------------------------------------------
-- Schedule: agent tools refresh with app discovery, every 30 minutes 00:00-05:00 Asia/Kolkata.
-- ---------------------------------------------------------------------------

select cron.unschedule(jobname) from cron.job where jobname in ('arkstore-discover-first', 'arkstore-discover');
select cron.schedule('arkstore-discover-first', '30 18 * * *',
  'select arkstore_private.discover_apps(); select arkstore_private.sync_agent_tools();');
select cron.schedule('arkstore-discover', '*/30 19-23 * * *',
  'select arkstore_private.discover_apps(); select arkstore_private.sync_agent_tools();');
