-- iPhone and iPad apps: releases with an .ipa (or a TrollStore .tipa) count as installable and tag
-- the app with the 'ios' platform. iOS can't install apps from another app, so ArkStore lists them
-- in an AltStore-format source (supabase/functions/ios-source) that SideStore, AltStore and Feather
-- install from, and links IPAs for TrollStore and on-device signers.

create or replace function arkstore_private.asset_os(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when n like '%.apk' then 'android'
    when n ~ '\.(ipa|tipa)$' then 'ios'
    when n ~ '\.(exe|msi|msix|msixbundle|appx|appxbundle)$' then 'windows'
    when n ~ '\.(dmg|pkg)$' then 'macos'
    when n ~ '\.(appimage|deb|rpm|flatpak)$' then 'linux'
    when n like '%.zip' then case
      when n ~ '(^|[^a-z0-9])(mac|macos|osx|darwin|apple)([^a-z]|$)' then 'macos'
      when n ~ '(^|[^a-z0-9])(win|windows|win32|win64)([^a-z]|$)' then 'windows'
      when n ~ '(^|[^a-z0-9])linux([^a-z]|$)' then 'linux'
    end
    when n ~ '\.(tar\.gz|tgz|tar\.xz|tar\.bz2)$' then case
      when n ~ '(^|[^a-z0-9])linux([^a-z]|$)' then 'linux'
      when n ~ '(^|[^a-z0-9])(mac|macos|osx|darwin|apple)([^a-z]|$)' then 'macos'
    end
  end
  from (select lower(coalesce(p_name, '')) as n) s
$$;

create or replace function arkstore_private.asset_platforms(p_assets jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(os order by array_position(array['android', 'ios', 'windows', 'macos', 'linux'], os)), '{}')
  from (
    select distinct a ->> 'os' as os
    from jsonb_array_elements(case when jsonb_typeof(p_assets) = 'array' then p_assets else '[]'::jsonb end) a
    where a ->> 'os' in ('android', 'ios', 'windows', 'macos', 'linux')
  ) s
$$;

create or replace function arkstore_private.derive_app_assets()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.assets is null or new.assets = '[]'::jsonb)
     and jsonb_typeof(new.apk_assets) = 'array' and new.apk_assets <> '[]'::jsonb then
    new.assets := (
      select coalesce(jsonb_agg(a || jsonb_build_object('os', 'android', 'arch',
        case
          when a ->> 'name' ~* 'universal' then 'universal'
          when a ->> 'name' ~* '(arm64|aarch64|v8a)' then 'arm64'
          when a ->> 'name' ~* '(armeabi-?v7a|armv7|arm-v7|v7a)' then 'armv7'
          when a ->> 'name' ~* 'x86[_-]?64' then 'x64'
          when a ->> 'name' ~* 'x86' then 'x86'
        end) order by a ->> 'name'), '[]'::jsonb)
      from jsonb_array_elements(new.apk_assets) a
    );
  end if;
  if tg_table_name = 'apps' then
    -- Inlined (not asset_platforms()) because this runs as the client role on owner edits.
    new.platforms := (
      select coalesce(array_agg(os order by array_position(array['android', 'ios', 'windows', 'macos', 'linux'], os)), '{}')
      from (
        select distinct a ->> 'os' as os
        from jsonb_array_elements(case when jsonb_typeof(new.assets) = 'array' then new.assets else '[]'::jsonb end) a
        where a ->> 'os' in ('android', 'ios', 'windows', 'macos', 'linux')
      ) s
    );
  end if;
  return new;
end;
$$;

-- What the iOS source knows about each IPA, read from its Info.plist by the ios-source function
-- (bundle ID, version, minimum iOS). Keyed by download URL, so a new release is read again.
create table if not exists public.ios_builds (
  url text primary key,
  bundle_id text,
  version text,
  build text,
  min_os text,
  app_name text,
  privacy jsonb not null default '{}',
  error text,
  checked_at timestamptz not null default now()
);
-- Only the ios-source function (service role) reads and writes it.
alter table public.ios_builds enable row level security;

-- Discovery also looks for iOS apps that ship IPAs.
create or replace function arkstore_private.discover_apps(p_searches integer default 3, p_max_queue integer default 400)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_queries text[] := array[
    'topic:android-app stars:>=300',
    'topic:windows-app stars:>=150',
    'topic:macos-app stars:>=200',
    'topic:linux-app stars:>=150',
    'topic:ios-app stars:>=100',
    'topic:electron-app stars:>=800',
    'topic:tauri-app stars:>=250',
    'topic:f-droid stars:>=150',
    'topic:sideloading stars:>=50',
    'topic:desktop-app stars:>=600',
    'topic:winui stars:>=150',
    'topic:ipa stars:>=30',
    'topic:menubar topic:macos stars:>=200',
    'topic:gtk4 stars:>=200',
    'topic:altstore stars:>=20',
    'topic:appimage stars:>=150',
    'topic:flutter-app stars:>=400',
    'topic:trollstore stars:>=30',
    'topic:android language:Kotlin stars:>=1200',
    'topic:wpf topic:windows stars:>=300',
    'topic:swiftui topic:ios stars:>=300',
    'topic:swiftui topic:macos stars:>=500',
    'topic:qt topic:desktop stars:>=300',
    'topic:cross-platform topic:desktop stars:>=400',
    'topic:jetpack-compose topic:app stars:>=400',
    'topic:electron topic:app stars:>=1500'
  ];
  v_state record;
  v_since text := to_char(now() - interval '1 year', 'YYYY-MM-DD');
  v_q text;
  v_page integer;
  r record;
  item jsonb;
  v_added integer := 0;
  i integer;
begin
  select * into v_state from arkstore_private.discovery_state for update;

  for i in 0 .. p_searches - 1 loop
    if (select count(*) from public.apps where status = 'hidden' and source = 'curated' and last_synced_at is null) >= p_max_queue then
      exit;
    end if;
    v_q := v_queries[1 + ((v_state.run * p_searches + i) % array_length(v_queries, 1))];
    v_page := 1 + (((v_state.run * p_searches + i) / array_length(v_queries, 1)) % 5);
    v_q := v_q || ' archived:false fork:false pushed:>=' || v_since;

    select * into r from arkstore_private.gh_get(
      '/search/repositories?q=' || replace(extensions.urlencode(v_q), '+', '%20') ||
      '&sort=stars&order=desc&per_page=50&page=' || v_page
    );
    if r.status in (401, 403, 429) then exit; end if;
    continue when r.status <> 200 or r.body is null;

    for item in select * from jsonb_array_elements(r.body -> 'items') loop
      if arkstore_private.add_found_repo(item) then
        v_added := v_added + 1;
      end if;
    end loop;
  end loop;

  update arkstore_private.discovery_state
     set run = run + 1, last_run_at = now(), last_added = v_added;
  return v_added;
end;
$$;

revoke all on function arkstore_private.discover_apps(integer, integer) from public, anon, authenticated;
