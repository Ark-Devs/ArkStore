-- Build status for ArkStore's own releases, one call for every platform: the newest run of each
-- release workflow (Android; Windows, macOS and Linux as the desktop run's jobs, with the step a
-- running job is on; the download page), the files in the latest GitHub release, and the iOS
-- source. Read by the Build Status dashboard through the Supabase connector:
--   select arkstore_private.build_status();          -- reuses an answer up to 90 s old
--   select arkstore_private.build_status(true);      -- asks GitHub now
-- Costs 2-3 GitHub requests per fresh answer. Without a server token GitHub allows 60 an hour,
-- so the release sync now leaves some of them free (sync_all's request budget below). When
-- GitHub says no, the last answer comes back marked stale, with when the limit resets.

create table if not exists arkstore_private.build_status_cache (
  id smallint primary key default 1 check (id = 1),
  data jsonb not null,
  fetched_at timestamptz not null
);

create or replace function arkstore_private.build_status(p_force boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_repo constant text := 'Ark-Devs/ArkStore';
  v_cache arkstore_private.build_status_cache;
  v_runs record;
  v_jobs record;
  v_rel record;
  v_limit record;
  v_latest jsonb := '{}'::jsonb;
  v_wf text;
  v_run jsonb;
  v_desktop_jobs jsonb := '[]'::jsonb;
  v_old_desktop jsonb;
  v_release jsonb;
  v_ios jsonb;
  v_data jsonb;
begin
  select * into v_cache from arkstore_private.build_status_cache where id = 1;
  if not p_force and v_cache.fetched_at > now() - interval '90 seconds' then
    return v_cache.data || jsonb_build_object('cached', true);
  end if;

  select * into v_runs from arkstore_private.gh_get('/repos/' || v_repo || '/actions/runs?per_page=30&exclude_pull_requests=true');
  if v_runs.status <> 200 or v_runs.body is null then
    -- /rate_limit itself is free.
    select * into v_limit from arkstore_private.gh_get('/rate_limit');
    return coalesce(v_cache.data, '{}'::jsonb) || jsonb_build_object(
      'stale', true,
      'error', case when v_runs.status in (403, 429) then 'github_limit' else 'github_' || v_runs.status end,
      'limit_resets_at', case when v_limit.status = 200
        then to_timestamp((v_limit.body #>> '{resources,core,reset}')::bigint) end,
      'fetched_at', v_cache.fetched_at
    );
  end if;

  -- The newest run of each workflow (runs come newest first).
  for v_run in select * from jsonb_array_elements(v_runs.body -> 'workflow_runs') loop
    v_wf := regexp_replace(v_run ->> 'path', '^.*/', '');
    if v_wf in ('android-release.yml', 'desktop-release.yml', 'pages.yml') and not v_latest ? v_wf then
      v_latest := v_latest || jsonb_build_object(v_wf, jsonb_build_object(
        'id', (v_run ->> 'id')::bigint,
        'status', v_run ->> 'status',
        'conclusion', v_run ->> 'conclusion',
        'event', v_run ->> 'event',
        'branch', v_run ->> 'head_branch',
        'commit', left(v_run ->> 'head_sha', 7),
        'title', v_run ->> 'display_title',
        'started_at', v_run ->> 'run_started_at',
        'updated_at', v_run ->> 'updated_at',
        'url', v_run ->> 'html_url'
      ));
    end if;
  end loop;

  -- Windows, macOS and Linux are jobs of the desktop run. A finished run's jobs don't change,
  -- so they're reused instead of asked for again.
  if v_latest ? 'desktop-release.yml' then
    v_old_desktop := v_cache.data #> '{runs,desktop-release.yml}';
    if v_old_desktop is not null
       and (v_old_desktop ->> 'id') = (v_latest #>> '{desktop-release.yml,id}')
       and (v_old_desktop ->> 'status') = 'completed' then
      v_desktop_jobs := coalesce(v_cache.data -> 'desktop_jobs', '[]'::jsonb);
    else
      select * into v_jobs from arkstore_private.gh_get(
        '/repos/' || v_repo || '/actions/runs/' || (v_latest #>> '{desktop-release.yml,id}') || '/jobs?per_page=20');
      if v_jobs.status = 200 then
        select coalesce(jsonb_agg(jsonb_build_object(
                 'name', j ->> 'name',
                 'status', j ->> 'status',
                 'conclusion', j ->> 'conclusion',
                 'started_at', j ->> 'started_at',
                 'completed_at', j ->> 'completed_at',
                 'url', j ->> 'html_url',
                 'step', (select s ->> 'name' from jsonb_array_elements(j -> 'steps') s
                           where s ->> 'status' = 'in_progress' limit 1),
                 'failed_step', (select s ->> 'name' from jsonb_array_elements(j -> 'steps') s
                                  where s ->> 'conclusion' = 'failure' limit 1)
               )), '[]'::jsonb)
          into v_desktop_jobs
          from jsonb_array_elements(v_jobs.body -> 'jobs') j;
      end if;
    end if;
  end if;

  select * into v_rel from arkstore_private.gh_get('/repos/' || v_repo || '/releases/latest');
  if v_rel.status = 200 then
    v_release := jsonb_build_object(
      'tag', v_rel.body ->> 'tag_name',
      'published_at', v_rel.body ->> 'published_at',
      'url', v_rel.body ->> 'html_url',
      'assets', (select coalesce(jsonb_agg(jsonb_build_object(
                   'name', a ->> 'name',
                   'size', (a ->> 'size')::bigint,
                   'downloads', (a ->> 'download_count')::integer) order by a ->> 'name'), '[]'::jsonb)
                   from jsonb_array_elements(v_rel.body -> 'assets') a)
    );
  else
    v_release := v_cache.data -> 'release';
  end if;

  -- iOS isn't built here: it's the source of iOS apps ArkStore lists.
  v_ios := jsonb_build_object(
    'apps', (select count(*) from public.apps where status = 'published' and 'ios' = any (platforms)),
    'readable', (select count(*) from public.ios_builds where bundle_id is not null),
    'failed', (select count(*) from public.ios_builds where bundle_id is null),
    'last_read_at', (select max(checked_at) from public.ios_builds)
  );

  v_data := jsonb_build_object(
    'repo', v_repo,
    'runs', v_latest,
    'desktop_jobs', v_desktop_jobs,
    'release', v_release,
    'ios', v_ios,
    'catalog', (select jsonb_object_agg(p, n) from (
                  select p, count(*) n from public.apps, unnest(platforms) p
                   where status = 'published' group by p) c),
    'fetched_at', now()
  );
  insert into arkstore_private.build_status_cache (id, data, fetched_at) values (1, v_data, now())
  on conflict (id) do update set data = excluded.data, fetched_at = excluded.fetched_at;
  return v_data || jsonb_build_object('cached', false);
end;
$$;

revoke all on function arkstore_private.build_status(boolean) from public, anon, authenticated;

-- The release sync stops after p_budget GitHub requests (it runs twice an hour), so without a
-- server token about 10 requests an hour stay free for build status and publishing checks.
drop function if exists arkstore_private.sync_all(integer);
create or replace function arkstore_private.sync_all(p_limit integer default 300, p_budget integer default 25)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a record;
  r record;
  m record;
  n integer := 0;
  v_used integer := 0;
  v_budget integer := case when arkstore_private.server_github_token() is null then p_budget else 1000000 end;
begin
  for a in
    select id, repo_full_name, release_etag, repo_synced_at
    from public.apps
    order by last_synced_at asc nulls first
    limit p_limit
  loop
    exit when v_used >= v_budget;
    select * into r from arkstore_private.fetch_release(a.repo_full_name, null, a.release_etag);
    v_used := v_used + 1;
    if r.status in (401, 403, 429) then
      exit;
    end if;
    if r.status = 200 and r.release is not null then
      perform arkstore_private.apply_release(a.id, r.release, r.apk);
    end if;

    if (a.repo_synced_at is null or a.repo_synced_at < now() - interval '1 day') and v_used < v_budget then
      select * into m from arkstore_private.gh_get('/repos/' || a.repo_full_name);
      v_used := v_used + 1;
      if m.status = 200 and m.body is not null then
        update public.apps set
          stars = coalesce((m.body ->> 'stargazers_count')::integer, stars),
          developer_avatar = coalesce(m.body -> 'owner' ->> 'avatar_url', developer_avatar),
          topics = coalesce((select array_agg(t) from jsonb_array_elements_text(m.body -> 'topics') t), topics),
          repo_synced_at = now()
        where id = a.id;
      end if;
    end if;

    update public.apps set
      last_synced_at = now(),
      release_etag = case when r.status = 200 then r.etag else release_etag end
    where id = a.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function arkstore_private.sync_all(integer, integer) from public, anon, authenticated;
