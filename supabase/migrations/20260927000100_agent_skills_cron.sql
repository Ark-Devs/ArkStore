-- Schedules for supabase/migrations/20260927000000_agent_skills.sql (kept apart: pg_cron only
-- exists on Supabase, not in the test database). Between app discovery runs: 00:15, then every
-- 30 minutes 00:45-04:15 Asia/Kolkata (18:45, 19:15-22:45 UTC).
select cron.unschedule(jobname) from cron.job where jobname in ('arkstore-agent-sources-first', 'arkstore-agent-sources');
select cron.schedule('arkstore-agent-sources-first', '45 18 * * *',
  'select arkstore_private.discover_agent_sources(); select arkstore_private.sync_skills();');
select cron.schedule('arkstore-agent-sources', '15-59/30 19-22 * * *',
  'select arkstore_private.discover_agent_sources(); select arkstore_private.sync_skills();');
