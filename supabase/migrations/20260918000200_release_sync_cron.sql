-- ArkStore: check GitHub for new releases every 30 minutes.
-- Developers only have to publish a GitHub release; phones pick it up from the catalog.
select cron.schedule(
  'arkstore-release-sync',
  '*/30 * * * *',
  $$select arkstore_private.sync_all()$$
);
