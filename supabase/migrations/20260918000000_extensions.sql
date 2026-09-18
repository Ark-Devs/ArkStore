-- ArkStore: extensions
-- `http` lets Postgres call the GitHub API synchronously (ownership checks, release sync).
-- `pg_cron` runs the release sync on a schedule.
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;
