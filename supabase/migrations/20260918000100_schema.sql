-- ArkStore: catalog schema, publishing, release sync and download stats.
--
-- Trust model
--   * Anyone can read published listings.
--   * Listings are created only through public.publish_app(), which proves the caller
--     controls the GitHub repo (repo owner == caller's GitHub login, or the caller's
--     GitHub token has push/maintain/admin on it).
--   * Version and APK data always comes from GitHub via Postgres, never from the client.
--   * Owners may edit presentation fields (name, subtitle, description, category,
--     icon, screenshots, homepage, visibility). Everything else is guarded by a trigger.

create schema if not exists arkstore_private;
revoke all on schema arkstore_private from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.categories (
  slug text primary key,
  name text not null,
  icon text not null,
  sort integer not null default 0
);

create table if not exists public.apps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete set null,
  source text not null default 'developer' check (source in ('developer', 'curated')),
  repo_full_name text not null,
  name text not null check (char_length(name) between 1 and 40),
  subtitle text not null default '' check (char_length(subtitle) <= 80),
  description text not null default '' check (char_length(description) <= 4000),
  category text not null references public.categories (slug),
  icon_url text,
  screenshots text[] not null default '{}' check (cardinality(screenshots) <= 10),
  homepage text,
  developer_login text not null,
  developer_avatar text,
  license text,
  package_name text,
  min_sdk integer,
  stars integer not null default 0,
  topics text[] not null default '{}',
  latest_version text,
  latest_release_name text,
  latest_release_notes text,
  latest_published_at timestamptz,
  latest_prerelease boolean not null default false,
  apk_name text,
  apk_url text,
  apk_size bigint,
  -- Every APK in the release; phones pick the one matching their CPU (see src/lib/apk-choice.ts).
  apk_assets jsonb not null default '[]',
  downloads bigint not null default 0,
  status text not null default 'published' check (status in ('published', 'hidden')),
  featured boolean not null default false,
  release_etag text,
  last_synced_at timestamptz,
  repo_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists apps_repo_key on public.apps (lower(repo_full_name));
create index if not exists apps_category_idx on public.apps (category) where status = 'published';
create index if not exists apps_released_idx on public.apps (latest_published_at desc nulls last);
create index if not exists apps_downloads_idx on public.apps (downloads desc);
create index if not exists apps_owner_idx on public.apps (owner_id);

create table if not exists public.app_versions (
  id bigint generated always as identity primary key,
  app_id uuid not null references public.apps (id) on delete cascade,
  version text not null,
  name text,
  notes text,
  published_at timestamptz,
  prerelease boolean not null default false,
  apk_name text,
  apk_url text,
  apk_size bigint,
  apk_assets jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (app_id, version)
);

create index if not exists app_versions_app_idx on public.app_versions (app_id, published_at desc);

-- Daily rollup that developers see in Studio.
create table if not exists public.app_download_stats (
  app_id uuid not null references public.apps (id) on delete cascade,
  day date not null,
  installs integer not null default 0,
  updates integer not null default 0,
  primary key (app_id, day)
);

-- Raw events, private. Used to ignore repeat taps from the same device.
create table if not exists arkstore_private.download_events (
  id bigint generated always as identity primary key,
  app_id uuid not null references public.apps (id) on delete cascade,
  device_id text not null,
  version text,
  kind text not null check (kind in ('install', 'update')),
  created_at timestamptz not null default now()
);

create index if not exists download_events_dedupe_idx
  on arkstore_private.download_events (app_id, device_id, kind, version);

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

insert into public.categories (slug, name, icon, sort) values
  ('productivity', 'Productivity', 'check-square', 10),
  ('tools', 'Tools', 'wrench', 20),
  ('communication', 'Communication', 'chat-circle', 30),
  ('social', 'Social', 'users-three', 40),
  ('music-audio', 'Music & Audio', 'music-notes', 50),
  ('video', 'Video', 'film-strip', 60),
  ('photography', 'Photography', 'camera', 70),
  ('security', 'Privacy & Security', 'shield-check', 80),
  ('personalization', 'Personalization', 'paint-brush', 90),
  ('reading', 'Books & Reading', 'book-open', 100),
  ('news', 'News & Feeds', 'newspaper', 110),
  ('maps', 'Maps & Travel', 'map-trifold', 120),
  ('health', 'Health & Fitness', 'heartbeat', 130),
  ('finance', 'Finance', 'wallet', 140),
  ('education', 'Education', 'graduation-cap', 150),
  ('weather', 'Weather', 'cloud-sun', 160),
  ('files', 'Files & Storage', 'folder-open', 170),
  ('developer', 'Developer Tools', 'code', 180),
  ('games', 'Games', 'game-controller', 190)
on conflict (slug) do update set name = excluded.name, icon = excluded.icon, sort = excluded.sort;

-- ---------------------------------------------------------------------------
-- Helpers (private)
-- ---------------------------------------------------------------------------

-- "owner/repo" from a URL, git remote or plain slug. Null when it doesn't look like a repo.
create or replace function arkstore_private.normalize_repo(p_input text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_input, ''));
  m text[];
begin
  v := regexp_replace(v, '^(git\+)?(https?://)?(www\.)?github\.com[/:]', '', 'i');
  v := regexp_replace(v, '^git@github\.com:', '', 'i');
  v := regexp_replace(v, '\.git$', '', 'i');
  m := regexp_match(v, '^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/([A-Za-z0-9._-]{1,100})(?:[/?#].*)?$');
  if m is null or m[2] in ('.', '..') then
    return null;
  end if;
  return m[1] || '/' || m[2];
end;
$$;

-- The caller's GitHub identity. auth.identities is written by Supabase Auth,
-- so unlike user_metadata the user cannot edit it.
create or replace function arkstore_private.github_identity(p_uid uuid)
returns table (provider_id text, login text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.provider_id,
         coalesce(i.identity_data ->> 'user_name', i.identity_data ->> 'preferred_username')
  from auth.identities i
  where i.user_id = p_uid and i.provider = 'github'
  limit 1
$$;

-- Optional server token for higher GitHub rate limits:
--   select vault.create_secret('<token>', 'arkstore_github_token');
create or replace function arkstore_private.server_github_token()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v using 'arkstore_github_token';
  return nullif(v, '');
exception when others then
  return null;
end;
$$;

-- GET https://api.github.com<path>. status 0 means the request itself failed.
create or replace function arkstore_private.gh_get(p_path text, p_token text default null, p_etag text default null)
returns table (status integer, body jsonb, etag text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text := nullif(p_token, '');
  v_headers extensions.http_header[];
  v_resp extensions.http_response;
begin
  if v_token is null then
    v_token := arkstore_private.server_github_token();
  end if;

  v_headers := array[
    row('Accept', 'application/vnd.github+json')::extensions.http_header,
    row('User-Agent', 'ArkStore')::extensions.http_header,
    row('X-GitHub-Api-Version', '2022-11-28')::extensions.http_header
  ];
  if v_token is not null then
    v_headers := v_headers || row('Authorization', 'Bearer ' || v_token)::extensions.http_header;
  end if;
  if p_etag is not null then
    v_headers := v_headers || row('If-None-Match', p_etag)::extensions.http_header;
  end if;

  v_resp := extensions.http(
    row('GET', 'https://api.github.com' || p_path, v_headers, null, null)::extensions.http_request
  );

  status := v_resp.status;
  etag := (select h.value from unnest(v_resp.headers) h where lower(h.field) = 'etag' limit 1);
  body := null;
  if v_resp.status = 200 and coalesce(v_resp.content, '') <> '' then
    begin
      body := v_resp.content::jsonb;
    exception when others then
      body := null;
    end;
  end if;
  return next;
exception when others then
  status := 0;
  body := null;
  etag := null;
  return next;
end;
$$;

-- Best APK in a release: universal, then ABI-less, then arm64, then other ABIs. Debug builds last.
-- Keep in sync with pickApk() in src/lib/github/apk.ts.
create or replace function arkstore_private.pick_apk(p_assets jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select a
  from jsonb_array_elements(case when jsonb_typeof(p_assets) = 'array' then p_assets else '[]'::jsonb end) a
  where lower(a ->> 'name') like '%.apk'
  order by
    (case when a ->> 'name' ~* 'debug' then 10 else 0 end)
    + (case
         when a ->> 'name' ~* 'universal' then 0
         when a ->> 'name' ~* '(arm64|aarch64|v8a)' then 2
         when a ->> 'name' ~* '(armeabi|armv7|arm-v7|v7a|x86|mips)' then 3
         else 1
       end),
    (a ->> 'size')::bigint desc nulls last,
    a ->> 'name'
  limit 1
$$;

-- The release ArkStore installs: newest stable release with an APK, or the newest
-- prerelease when a project has only ever shipped betas. Drafts are ignored.
-- Mirrors currentRelease() in src/lib/github/detect.ts.
create or replace function arkstore_private.fetch_release(p_repo text, p_token text default null, p_etag text default null)
returns table (status integer, release jsonb, apk jsonb, etag text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select * into r from arkstore_private.gh_get('/repos/' || p_repo || '/releases?per_page=15', p_token, p_etag);
  status := r.status;
  etag := r.etag;
  release := null;
  apk := null;
  if r.status = 200 and jsonb_typeof(r.body) = 'array' then
    select x.rel, arkstore_private.pick_apk(x.rel -> 'assets')
      into release, apk
    from jsonb_array_elements(r.body) as x(rel)
    where not coalesce((x.rel ->> 'draft')::boolean, false)
      and arkstore_private.pick_apk(x.rel -> 'assets') is not null
    order by coalesce((x.rel ->> 'prerelease')::boolean, false),
             (x.rel ->> 'published_at')::timestamptz desc nulls last
    limit 1;
  end if;
  return next;
end;
$$;

-- [{name, url, size}] for every APK attached to a release.
create or replace function arkstore_private.apk_assets(p_release jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', a ->> 'name', 'url', a ->> 'browser_download_url', 'size', (a ->> 'size')::bigint)
      order by a ->> 'name'
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(case when jsonb_typeof(p_release -> 'assets') = 'array' then p_release -> 'assets' else '[]'::jsonb end) a
  where lower(a ->> 'name') like '%.apk'
$$;

-- Write a GitHub release onto a listing. Returns true when it is a new version.
create or replace function arkstore_private.apply_release(p_app_id uuid, p_release jsonb, p_apk jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_tag text := p_release ->> 'tag_name';
begin
  if p_release is null or p_apk is null or v_tag is null then
    return false;
  end if;

  select latest_version into v_old from public.apps where id = p_app_id for update;

  update public.apps set
    latest_version = v_tag,
    latest_release_name = nullif(p_release ->> 'name', ''),
    latest_release_notes = left(coalesce(p_release ->> 'body', ''), 8000),
    latest_published_at = coalesce((p_release ->> 'published_at')::timestamptz, now()),
    latest_prerelease = coalesce((p_release ->> 'prerelease')::boolean, false),
    apk_name = p_apk ->> 'name',
    apk_url = p_apk ->> 'browser_download_url',
    apk_size = (p_apk ->> 'size')::bigint,
    apk_assets = arkstore_private.apk_assets(p_release)
  where id = p_app_id;

  insert into public.app_versions (app_id, version, name, notes, published_at, prerelease, apk_name, apk_url, apk_size, apk_assets)
  values (
    p_app_id,
    v_tag,
    nullif(p_release ->> 'name', ''),
    left(coalesce(p_release ->> 'body', ''), 8000),
    coalesce((p_release ->> 'published_at')::timestamptz, now()),
    coalesce((p_release ->> 'prerelease')::boolean, false),
    p_apk ->> 'name',
    p_apk ->> 'browser_download_url',
    (p_apk ->> 'size')::bigint,
    arkstore_private.apk_assets(p_release)
  )
  on conflict (app_id, version) do update set
    name = excluded.name,
    notes = excluded.notes,
    apk_name = excluded.apk_name,
    apk_url = excluded.apk_url,
    apk_size = excluded.apk_size,
    apk_assets = excluded.apk_assets;

  return v_old is distinct from v_tag;
end;
$$;

-- Only https URLs, trimmed, max 10.
create or replace function arkstore_private.clean_urls(p jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(u order by ord), '{}')
  from (
    select btrim(x.v) as u, x.ord
    from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end)
      with ordinality as x(v, ord)
    where btrim(x.v) ~* '^https://\S+$'
    order by x.ord
    limit 10
  ) s
$$;

create or replace function arkstore_private.clean_url(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when btrim(coalesce(p, '')) ~* '^https://\S+$' then btrim(p) else null end
$$;

-- ---------------------------------------------------------------------------
-- Guard: clients can only change presentation fields.
-- Security definer functions run as the table owner, so they pass through.
-- ---------------------------------------------------------------------------

create or replace function arkstore_private.guard_app_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.source := old.source;
    new.repo_full_name := old.repo_full_name;
    new.developer_login := old.developer_login;
    new.developer_avatar := old.developer_avatar;
    new.license := old.license;
    new.package_name := old.package_name;
    new.min_sdk := old.min_sdk;
    new.stars := old.stars;
    new.topics := old.topics;
    new.latest_version := old.latest_version;
    new.latest_release_name := old.latest_release_name;
    new.latest_release_notes := old.latest_release_notes;
    new.latest_published_at := old.latest_published_at;
    new.latest_prerelease := old.latest_prerelease;
    new.apk_name := old.apk_name;
    new.apk_url := old.apk_url;
    new.apk_size := old.apk_size;
    new.apk_assets := old.apk_assets;
    new.downloads := old.downloads;
    new.featured := old.featured;
    new.release_etag := old.release_etag;
    new.last_synced_at := old.last_synced_at;
    new.repo_synced_at := old.repo_synced_at;
    new.created_at := old.created_at;
    -- Inlined on purpose: this runs as the client role, which can't call private helpers.
    new.icon_url := case when btrim(coalesce(new.icon_url, '')) ~* '^https://\S+$' then btrim(new.icon_url) end;
    new.homepage := case when btrim(coalesce(new.homepage, '')) ~* '^https://\S+$' then btrim(new.homepage) end;
    new.screenshots := coalesce(
      (select array_agg(btrim(u) order by ord)
       from unnest(new.screenshots) with ordinality as x(u, ord)
       where btrim(u) ~* '^https://\S+$'),
      '{}'
    );
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists apps_guard_update on public.apps;
create trigger apps_guard_update
  before update on public.apps
  for each row execute function arkstore_private.guard_app_update();

-- ---------------------------------------------------------------------------
-- Public API (RPC)
-- ---------------------------------------------------------------------------

-- Publish a repo, update your own listing, or claim a curated listing of a repo you control.
-- p: { repo, name, subtitle, description, category, icon_url, screenshots[], homepage,
--      package_name, min_sdk }
-- p_github_token: the caller's GitHub OAuth token. Needed only for repos owned by an
-- organisation or another account; used for this call and never stored.
create or replace function public.publish_app(p jsonb, p_github_token text default null)
returns public.apps
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ident record;
  v_repo text := arkstore_private.normalize_repo(p ->> 'repo');
  v_meta record;
  v_user record;
  v_rel record;
  v_json jsonb;
  v_allowed boolean := false;
  v_existing public.apps;
  v_app public.apps;
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_category text := coalesce(p ->> 'category', '');
begin
  if v_uid is null then
    raise exception 'sign_in_required';
  end if;

  select * into v_ident from arkstore_private.github_identity(v_uid);
  if v_ident.login is null then
    raise exception 'github_account_required';
  end if;

  if v_repo is null then
    raise exception 'invalid_repo';
  end if;
  if char_length(v_name) = 0 or char_length(v_name) > 40 then
    raise exception 'invalid_name';
  end if;
  if not exists (select 1 from public.categories c where c.slug = v_category) then
    raise exception 'invalid_category';
  end if;

  select * into v_meta from arkstore_private.gh_get('/repos/' || v_repo, p_github_token);
  if v_meta.status = 404 then
    raise exception 'repo_not_found';
  elsif v_meta.status in (401, 403, 429) then
    raise exception 'github_rate_limited';
  elsif v_meta.status <> 200 or v_meta.body is null then
    raise exception 'github_unavailable';
  end if;
  v_json := v_meta.body;
  if coalesce((v_json ->> 'private')::boolean, false) then
    raise exception 'repo_private';
  end if;
  v_repo := v_json ->> 'full_name';

  if lower(v_json -> 'owner' ->> 'login') = lower(v_ident.login) then
    v_allowed := true;
  elsif nullif(p_github_token, '') is not null then
    select * into v_user from arkstore_private.gh_get('/user', p_github_token);
    if v_user.status = 200 and (v_user.body ->> 'id') = v_ident.provider_id then
      v_allowed := coalesce((v_json -> 'permissions' ->> 'admin')::boolean, false)
        or coalesce((v_json -> 'permissions' ->> 'maintain')::boolean, false)
        or coalesce((v_json -> 'permissions' ->> 'push')::boolean, false);
    end if;
  end if;
  if not v_allowed then
    raise exception 'not_repo_owner';
  end if;

  select * into v_rel from arkstore_private.fetch_release(v_repo, p_github_token);
  if v_rel.release is null then
    raise exception 'no_apk_release';
  end if;

  select * into v_existing from public.apps a where lower(a.repo_full_name) = lower(v_repo) for update;
  if found and v_existing.owner_id is not null and v_existing.owner_id <> v_uid then
    raise exception 'already_listed';
  end if;

  if found then
    update public.apps set
      owner_id = v_uid,
      source = 'developer',
      repo_full_name = v_repo,
      name = v_name,
      subtitle = left(btrim(coalesce(p ->> 'subtitle', '')), 80),
      description = left(btrim(coalesce(p ->> 'description', '')), 4000),
      category = v_category,
      icon_url = coalesce(arkstore_private.clean_url(p ->> 'icon_url'), v_json -> 'owner' ->> 'avatar_url'),
      screenshots = arkstore_private.clean_urls(p -> 'screenshots'),
      homepage = coalesce(arkstore_private.clean_url(p ->> 'homepage'), arkstore_private.clean_url(v_json ->> 'homepage')),
      developer_login = v_json -> 'owner' ->> 'login',
      developer_avatar = v_json -> 'owner' ->> 'avatar_url',
      license = v_json -> 'license' ->> 'spdx_id',
      package_name = coalesce(nullif(btrim(p ->> 'package_name'), ''), package_name),
      min_sdk = coalesce((p ->> 'min_sdk')::integer, min_sdk),
      stars = coalesce((v_json ->> 'stargazers_count')::integer, 0),
      topics = coalesce((select array_agg(t) from jsonb_array_elements_text(v_json -> 'topics') t), '{}'),
      status = 'published',
      repo_synced_at = now(),
      last_synced_at = now(),
      release_etag = null
    where id = v_existing.id
    returning * into v_app;
  else
    insert into public.apps (
      owner_id, source, repo_full_name, name, subtitle, description, category, icon_url,
      screenshots, homepage, developer_login, developer_avatar, license, package_name, min_sdk,
      stars, topics, repo_synced_at, last_synced_at
    ) values (
      v_uid,
      'developer',
      v_repo,
      v_name,
      left(btrim(coalesce(p ->> 'subtitle', '')), 80),
      left(btrim(coalesce(p ->> 'description', '')), 4000),
      v_category,
      coalesce(arkstore_private.clean_url(p ->> 'icon_url'), v_json -> 'owner' ->> 'avatar_url'),
      arkstore_private.clean_urls(p -> 'screenshots'),
      coalesce(arkstore_private.clean_url(p ->> 'homepage'), arkstore_private.clean_url(v_json ->> 'homepage')),
      v_json -> 'owner' ->> 'login',
      v_json -> 'owner' ->> 'avatar_url',
      v_json -> 'license' ->> 'spdx_id',
      nullif(btrim(p ->> 'package_name'), ''),
      (p ->> 'min_sdk')::integer,
      coalesce((v_json ->> 'stargazers_count')::integer, 0),
      coalesce((select array_agg(t) from jsonb_array_elements_text(v_json -> 'topics') t), '{}'),
      now(),
      now()
    )
    returning * into v_app;
  end if;

  perform arkstore_private.apply_release(v_app.id, v_rel.release, v_rel.apk);

  select * into v_app from public.apps where id = v_app.id;
  return v_app;
end;
$$;

-- Owner-triggered "check GitHub now".
create or replace function public.refresh_app(p_app_id uuid, p_github_token text default null)
returns public.apps
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_app public.apps;
  v_rel record;
begin
  select * into v_app from public.apps where id = p_app_id;
  if not found then
    raise exception 'app_not_found';
  end if;
  if v_app.owner_id is distinct from auth.uid() then
    raise exception 'not_app_owner';
  end if;

  select * into v_rel from arkstore_private.fetch_release(v_app.repo_full_name, p_github_token);
  if v_rel.status in (401, 403, 429) then
    raise exception 'github_rate_limited';
  elsif v_rel.status <> 200 then
    raise exception 'github_unavailable';
  end if;
  if v_rel.release is not null then
    perform arkstore_private.apply_release(v_app.id, v_rel.release, v_rel.apk);
  end if;
  update public.apps set last_synced_at = now(), release_etag = v_rel.etag where id = v_app.id;

  select * into v_app from public.apps where id = p_app_id;
  return v_app;
end;
$$;

-- Count a download. Repeat taps from one device for the same version count once.
-- Returns the listing's new total.
create or replace function public.record_download(
  p_app_id uuid,
  p_device_id text,
  p_kind text default 'install',
  p_version text default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_total bigint;
begin
  if p_kind not in ('install', 'update') then
    raise exception 'invalid_kind';
  end if;
  if p_device_id is null or char_length(p_device_id) not between 8 and 64 then
    raise exception 'invalid_device';
  end if;
  if not exists (select 1 from public.apps where id = p_app_id and status = 'published') then
    raise exception 'app_not_found';
  end if;

  if exists (
    select 1 from arkstore_private.download_events e
    where e.app_id = p_app_id
      and e.device_id = p_device_id
      and e.kind = p_kind
      and e.version is not distinct from p_version
  ) then
    select downloads into v_total from public.apps where id = p_app_id;
    return v_total;
  end if;

  insert into arkstore_private.download_events (app_id, device_id, version, kind)
  values (p_app_id, p_device_id, p_version, p_kind);

  insert into public.app_download_stats (app_id, day, installs, updates)
  values (
    p_app_id,
    (now() at time zone 'utc')::date,
    case when p_kind = 'install' then 1 else 0 end,
    case when p_kind = 'update' then 1 else 0 end
  )
  on conflict (app_id, day) do update set
    installs = public.app_download_stats.installs + excluded.installs,
    updates = public.app_download_stats.updates + excluded.updates;

  update public.apps set downloads = downloads + 1 where id = p_app_id
  returning downloads into v_total;
  return v_total;
end;
$$;

-- Scheduled sync: new releases for every listing, repo stats once a day.
-- Stops early when GitHub rate-limits us. Returns how many listings were checked.
create or replace function arkstore_private.sync_all(p_limit integer default 300)
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
begin
  for a in
    select id, repo_full_name, release_etag, repo_synced_at
    from public.apps
    order by last_synced_at asc nulls first
    limit p_limit
  loop
    select * into r from arkstore_private.fetch_release(a.repo_full_name, null, a.release_etag);
    if r.status in (401, 403, 429) then
      exit;
    end if;
    if r.status = 200 and r.release is not null then
      perform arkstore_private.apply_release(a.id, r.release, r.apk);
    end if;

    if a.repo_synced_at is null or a.repo_synced_at < now() - interval '1 day' then
      select * into m from arkstore_private.gh_get('/repos/' || a.repo_full_name);
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

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.categories enable row level security;
alter table public.apps enable row level security;
alter table public.app_versions enable row level security;
alter table public.app_download_stats enable row level security;
alter table arkstore_private.download_events enable row level security;

drop policy if exists "categories are public" on public.categories;
create policy "categories are public" on public.categories
  for select to anon, authenticated using (true);

drop policy if exists "published apps are public" on public.apps;
create policy "published apps are public" on public.apps
  for select to anon, authenticated
  using (status = 'published' or owner_id = (select auth.uid()));

drop policy if exists "owners edit their apps" on public.apps;
create policy "owners edit their apps" on public.apps
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "owners delete their apps" on public.apps;
create policy "owners delete their apps" on public.apps
  for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "versions of visible apps are public" on public.app_versions;
create policy "versions of visible apps are public" on public.app_versions
  for select to anon, authenticated
  using (exists (select 1 from public.apps a where a.id = app_id));

drop policy if exists "owners read their stats" on public.app_download_stats;
create policy "owners read their stats" on public.app_download_stats
  for select to authenticated
  using (exists (select 1 from public.apps a where a.id = app_id and a.owner_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select on public.categories, public.apps, public.app_versions to anon, authenticated;
grant update (name, subtitle, description, category, icon_url, screenshots, homepage, status)
  on public.apps to authenticated;
grant delete on public.apps to authenticated;
grant select on public.app_download_stats to authenticated;

revoke all on all tables in schema arkstore_private from anon, authenticated;
revoke all on all functions in schema arkstore_private from public, anon, authenticated;

revoke all on function public.publish_app(jsonb, text) from public, anon;
revoke all on function public.refresh_app(uuid, text) from public, anon;
revoke all on function public.record_download(uuid, text, text, text) from public;
grant execute on function public.publish_app(jsonb, text) to authenticated;
grant execute on function public.refresh_app(uuid, text) to authenticated;
grant execute on function public.record_download(uuid, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: icons and screenshots uploaded from the app live in
-- media/<user id>/..., publicly readable.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 8388608, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "arkstore media upload" on storage.objects;
create policy "arkstore media upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "arkstore media delete" on storage.objects;
create policy "arkstore media delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
