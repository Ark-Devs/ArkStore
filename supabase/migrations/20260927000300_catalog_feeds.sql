-- Curated catalog feeds: other projects' public app lists (starting with Orion Store's
-- Orion-Data/apps.json), read nightly. New GitHub repos from a feed go into an import queue;
-- the importer looks them up through GitHub search (up to 10 repos per search with repo:
-- qualifiers, so it spends search quota, not the 60/hour core quota) and queues the ones that
-- pass the same rules as discovery as hidden listings. The release sync and publish_discovered()
-- then publish the ones with an installable build, exactly like discovered apps.

create table if not exists arkstore_private.catalog_feeds (
  url text primary key,
  -- How to read it. 'orion': a JSON array of objects with githubRepo / repoUrl, name, description.
  format text not null default 'orion' check (format in ('orion')),
  last_fetched_at timestamptz,
  last_queued integer
);
insert into arkstore_private.catalog_feeds (url, format) values
  ('https://raw.githubusercontent.com/RookieEnough/Orion-Data/main/apps.json', 'orion')
on conflict do nothing;

create table if not exists arkstore_private.import_queue (
  repo text primary key,
  source text,
  added_at timestamptz not null default now(),
  tried_at timestamptz
);

-- What ArkStore doesn't list: libraries and samples, and patched, cracked or adult apps.
create or replace function arkstore_private.deny_pattern()
returns text
language sql
immutable
set search_path to ''
as $$
  select '(awesome|sample|\mdemos?\M|template|boilerplate|tutorial|course|example|\mlibrary\M|\msdk\M|framework|starter|playground|interview|\mclone\M|revanced|vanced|morphe|patcher|\mpatched\M|\mmods?\M|\mmodded\M|mod-?apk|crack|cheat|\mhacks?\M|premium unlocked|\munlocked\M|piracy|pirate|cloudstream|spoof|bypass|keylogger|stealer|malware|\mrat\M|nsfw|porn|hentai|adult|xposed|lsposed|frida|dotfiles|\mcli\M|command.?line)'::text;
$$;

-- Queue one repo from a GitHub search result as a hidden curated listing, if it passes the rules.
create or replace function arkstore_private.add_found_repo(item jsonb)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_desc text := coalesce(item ->> 'description', '');
  v_text text := (item ->> 'full_name') || ' ' || coalesce(item ->> 'description', '') || ' ' ||
    coalesce((select string_agg(t, ' ') from jsonb_array_elements_text(item -> 'topics') t), '');
begin
  if coalesce((item ->> 'archived')::boolean, false) or coalesce((item ->> 'fork')::boolean, false)
     or coalesce((item ->> 'private')::boolean, false) then
    return false;
  end if;
  if v_text ~* arkstore_private.deny_pattern() or v_desc = '' then
    return false;
  end if;
  -- The store is in English: skip listings written mostly in CJK scripts.
  if length(regexp_replace(v_desc, '[^぀-ヿ㐀-鿿가-힯]', '', 'g')) > length(regexp_replace(v_desc, '[^A-Za-z]', '', 'g')) * 0.25 then
    return false;
  end if;
  if exists (select 1 from public.apps a where lower(a.repo_full_name) = lower(item ->> 'full_name'))
     or exists (select 1 from arkstore_private.discovery_rejects d where d.repo = lower(item ->> 'full_name')) then
    return false;
  end if;

  insert into public.apps (
    source, status, repo_full_name, name, subtitle, description, category, icon_url, homepage,
    developer_login, developer_avatar, license, stars, topics, repo_synced_at
  ) values (
    'curated', 'hidden', item ->> 'full_name',
    left(item ->> 'name', 40),
    left(v_desc, 80),
    left(v_desc, 4000),
    arkstore_private.guess_category(v_text),
    item -> 'owner' ->> 'avatar_url',
    case when item ->> 'homepage' like 'https://%' then item ->> 'homepage' else 'https://github.com/' || (item ->> 'full_name') end,
    item -> 'owner' ->> 'login',
    item -> 'owner' ->> 'avatar_url',
    nullif(nullif(item -> 'license' ->> 'spdx_id', 'NOASSERTION'), ''),
    coalesce((item ->> 'stargazers_count')::integer, 0),
    coalesce((select array_agg(t) from jsonb_array_elements_text(item -> 'topics') t), '{}'),
    now()
  )
  on conflict ((lower(repo_full_name))) do nothing;
  return found;
end;
$$;

-- Read every feed not read in the last 20 hours and queue the GitHub repos ArkStore doesn't list.
create or replace function arkstore_private.sync_catalog_feeds()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  f record;
  v_resp extensions.http_response;
  v_json jsonb;
  v_n integer;
  v_total integer := 0;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '60');
  for f in
    select * from arkstore_private.catalog_feeds
     where last_fetched_at is null or last_fetched_at < now() - interval '20 hours'
  loop
    begin
      v_resp := extensions.http_get(f.url);
      v_json := case when v_resp.status = 200 then v_resp.content::jsonb end;
    exception when others then
      v_json := null;
    end;
    continue when v_json is null or jsonb_typeof(v_json) <> 'array';

    with entries as (
      select coalesce(
               nullif(btrim(e ->> 'githubRepo'), ''),
               substring(e ->> 'repoUrl' from '^https?://github\.com/([A-Za-z0-9-]+/[A-Za-z0-9._-]+?)(?:\.git)?/?$')
             ) as repo,
             coalesce(e ->> 'name', '') || ' ' || coalesce(e ->> 'description', '') as text
        from jsonb_array_elements(v_json) e
    ),
    fresh as (
      insert into arkstore_private.import_queue (repo, source)
      select distinct on (lower(repo)) repo, f.url
        from entries
       where repo ~ '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$'
         and (repo || ' ' || text) !~* arkstore_private.deny_pattern()
         and not exists (select 1 from public.apps a where lower(a.repo_full_name) = lower(entries.repo))
         and not exists (select 1 from arkstore_private.discovery_rejects d where d.repo = lower(entries.repo))
      on conflict (repo) do nothing
      returning 1
    )
    select count(*) into v_n from fresh;

    update arkstore_private.catalog_feeds set last_fetched_at = now(), last_queued = v_n where url = f.url;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end;
$$;

-- Look queued repos up on GitHub (batched repo: searches) and add the ones that pass.
create or replace function arkstore_private.import_queued_repos(p_searches integer default 6)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_batch text[];
  v_q text;
  r record;
  item jsonb;
  v_added integer := 0;
  i integer;
begin
  for i in 1 .. p_searches loop
    -- Up to 10 repos whose qualifiers fit GitHub's 256-character query limit.
    select array_agg(repo order by added_at) into v_batch
      from (
        select repo, added_at, sum(length(repo) + 6) over (order by added_at, repo) as running
          from arkstore_private.import_queue
         where tried_at is null
         order by added_at, repo
         limit 10
      ) q
     where running <= 240;
    exit when v_batch is null;

    v_q := (select string_agg('repo:' || b, ' ') from unnest(v_batch) b);
    select * into r from arkstore_private.gh_get(
      '/search/repositories?q=' || replace(extensions.urlencode(v_q), '+', '%20') || '&per_page=10'
    );
    exit when r.status in (401, 403, 429);

    update arkstore_private.import_queue set tried_at = now() where repo = any (v_batch);
    continue when r.status <> 200 or r.body is null;

    for item in select * from jsonb_array_elements(r.body -> 'items') loop
      if arkstore_private.add_found_repo(item) then
        v_added := v_added + 1;
      end if;
    end loop;
  end loop;
  return v_added;
end;
$$;

revoke all on function arkstore_private.add_found_repo(jsonb) from public, anon, authenticated;
revoke all on function arkstore_private.sync_catalog_feeds() from public, anon, authenticated;
revoke all on function arkstore_private.import_queued_repos(integer) from public, anon, authenticated;
