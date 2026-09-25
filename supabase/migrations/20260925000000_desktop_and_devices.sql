-- ArkStore: Windows, macOS and Linux apps, and signed-in devices.
--
--   apps.assets / app_versions.assets   every installable file in the release, tagged with
--                                       the platform (os) and CPU (arch) it is for
--   apps.platforms                      which platforms the listing can be installed on
--                                       (always derived from assets; clients filter by it)
--   public.user_devices                 phones and computers signed in to an account, so the
--                                       profile can list them and sign one out remotely
--
-- A release now counts when it ships anything installable (APK, EXE, MSI, MSIX, DMG, PKG,
-- AppImage, DEB, RPM, Flatpak, or a ZIP / tarball named for its platform), not only an APK.

alter table public.apps add column if not exists assets jsonb not null default '[]';
alter table public.apps add column if not exists platforms text[] not null default '{}';
alter table public.app_versions add column if not exists assets jsonb not null default '[]';

create index if not exists apps_platforms_idx on public.apps using gin (platforms);

-- ---------------------------------------------------------------------------
-- Classifying release files. Keep in sync with src/lib/github/assets.ts.
-- ---------------------------------------------------------------------------

create or replace function arkstore_private.asset_os(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when n like '%.apk' then 'android'
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

create or replace function arkstore_private.asset_arch(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when n ~ 'universal' then 'universal'
    when n ~ '(arm64|aarch64|v8a)' then 'arm64'
    when n ~ '(armeabi-?v7a|armv7|armhf|arm-v7|v7a)' then 'armv7'
    when n ~ '(x86[_-]?64|x64|amd64|win64)' then 'x64'
    when n ~ '(i386|i686|ia32|win32|x86)' then 'x86'
  end
  from (select lower(coalesce(p_name, '')) as n) s
$$;

-- [{name, url, size, os, arch}] for every installable file attached to a release.
create or replace function arkstore_private.release_assets(p_release jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', a ->> 'name',
        'url', a ->> 'browser_download_url',
        'size', (a ->> 'size')::bigint,
        'os', arkstore_private.asset_os(a ->> 'name'),
        'arch', arkstore_private.asset_arch(a ->> 'name')
      )
      order by a ->> 'name'
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(case when jsonb_typeof(p_release -> 'assets') = 'array' then p_release -> 'assets' else '[]'::jsonb end) a
  where arkstore_private.asset_os(a ->> 'name') is not null
$$;

create or replace function arkstore_private.asset_platforms(p_assets jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(os order by array_position(array['android', 'windows', 'macos', 'linux'], os)), '{}')
  from (
    select distinct a ->> 'os' as os
    from jsonb_array_elements(case when jsonb_typeof(p_assets) = 'array' then p_assets else '[]'::jsonb end) a
    where a ->> 'os' in ('android', 'windows', 'macos', 'linux')
  ) s
$$;

-- Listings written before this migration (and seed rows, which only carry APKs) get their
-- assets from apk_assets; platforms always follow assets.
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
      select coalesce(array_agg(os order by array_position(array['android', 'windows', 'macos', 'linux'], os)), '{}')
      from (
        select distinct a ->> 'os' as os
        from jsonb_array_elements(case when jsonb_typeof(new.assets) = 'array' then new.assets else '[]'::jsonb end) a
        where a ->> 'os' in ('android', 'windows', 'macos', 'linux')
      ) s
    );
  end if;
  return new;
end;
$$;

drop trigger if exists apps_derive_assets on public.apps;
create trigger apps_derive_assets
  before insert or update on public.apps
  for each row execute function arkstore_private.derive_app_assets();

drop trigger if exists app_versions_derive_assets on public.app_versions;
create trigger app_versions_derive_assets
  before insert or update on public.app_versions
  for each row execute function arkstore_private.derive_app_assets();

-- ---------------------------------------------------------------------------
-- Release sync: any installable file counts, not just APKs.
-- ---------------------------------------------------------------------------

-- The release ArkStore installs: newest stable release with something installable, or the
-- newest prerelease when a project has only ever shipped betas. Drafts are ignored.
-- `apk` is the best APK in it, or null for desktop-only releases.
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
      and arkstore_private.release_assets(x.rel) <> '[]'::jsonb
    order by coalesce((x.rel ->> 'prerelease')::boolean, false),
             (x.rel ->> 'published_at')::timestamptz desc nulls last
    limit 1;
  end if;
  return next;
end;
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
  v_assets jsonb := arkstore_private.release_assets(p_release);
begin
  if p_release is null or v_tag is null or v_assets = '[]'::jsonb then
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
    apk_assets = arkstore_private.apk_assets(p_release),
    assets = v_assets
  where id = p_app_id;

  insert into public.app_versions (app_id, version, name, notes, published_at, prerelease, apk_name, apk_url, apk_size, apk_assets, assets)
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
    arkstore_private.apk_assets(p_release),
    v_assets
  )
  on conflict (app_id, version) do update set
    name = excluded.name,
    notes = excluded.notes,
    apk_name = excluded.apk_name,
    apk_url = excluded.apk_url,
    apk_size = excluded.apk_size,
    apk_assets = excluded.apk_assets,
    assets = excluded.assets;

  return v_old is distinct from v_tag;
end;
$$;

-- Fill in assets / platforms for existing rows, and make the next sync re-read every release
-- (skipping the ETag) so desktop files already on GitHub show up.
update public.apps set release_etag = null, updated_at = updated_at;
update public.app_versions set assets = assets where assets = '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Signed-in devices
-- ---------------------------------------------------------------------------

create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The random id the app keeps on the device (the same one download counts use).
  device_id text not null check (char_length(device_id) between 8 and 64),
  platform text not null check (platform in ('android', 'ios', 'windows', 'macos', 'linux', 'web')),
  name text not null default '' check (char_length(name) <= 80),
  os_version text check (char_length(os_version) <= 40),
  arch text check (char_length(arch) <= 20),
  app_version text check (char_length(app_version) <= 40),
  -- The Supabase Auth session the device signed in with (the JWT's session_id).
  session_id uuid,
  -- Set when the account signs this device out from another device.
  signed_out_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create index if not exists user_devices_user_idx on public.user_devices (user_id, last_seen_at desc);

alter table public.user_devices enable row level security;

drop policy if exists "people see their own devices" on public.user_devices;
create policy "people see their own devices" on public.user_devices
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.user_devices from anon, authenticated;
grant select on public.user_devices to authenticated;

-- Called by the app on sign-in and whenever it comes to the foreground.
-- Returns 'ok', or 'signed_out' when another device signed this one out: the app then drops
-- its session. Signing in again starts a new session, which clears the flag.
create or replace function public.register_device(
  p_device_id text,
  p_platform text,
  p_name text default null,
  p_os_version text default null,
  p_arch text default null,
  p_app_version text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid;
  v_row public.user_devices;
begin
  if v_uid is null then
    raise exception 'sign_in_required';
  end if;
  if p_device_id is null or char_length(p_device_id) not between 8 and 64 then
    raise exception 'invalid_device';
  end if;
  if p_platform is null or p_platform not in ('android', 'ios', 'windows', 'macos', 'linux', 'web') then
    raise exception 'invalid_platform';
  end if;

  begin
    v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    v_sid := null;
  end;

  select * into v_row from public.user_devices where user_id = v_uid and device_id = p_device_id;
  if found and v_row.signed_out_at is not null and v_row.session_id is not distinct from v_sid then
    return 'signed_out';
  end if;

  insert into public.user_devices (user_id, device_id, platform, name, os_version, arch, app_version, session_id)
  values (
    v_uid,
    p_device_id,
    p_platform,
    left(btrim(coalesce(p_name, '')), 80),
    left(nullif(btrim(p_os_version), ''), 40),
    left(nullif(btrim(p_arch), ''), 20),
    left(nullif(btrim(p_app_version), ''), 40),
    v_sid
  )
  on conflict (user_id, device_id) do update set
    platform = excluded.platform,
    name = excluded.name,
    os_version = excluded.os_version,
    arch = excluded.arch,
    app_version = excluded.app_version,
    session_id = excluded.session_id,
    signed_out_at = null,
    last_seen_at = now();
  return 'ok';
end;
$$;

-- Sign out one of your other devices. Its refresh token is revoked right away (so it can't
-- renew its session), and the app signs itself out the next time it checks in.
create or replace function public.sign_out_device(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.user_devices;
begin
  if v_uid is null then
    raise exception 'sign_in_required';
  end if;
  select * into v_row from public.user_devices where id = p_id and user_id = v_uid for update;
  if not found then
    raise exception 'device_not_found';
  end if;

  update public.user_devices set signed_out_at = now() where id = p_id;

  if v_row.session_id is not null then
    begin
      execute 'delete from auth.sessions where id = $1 and user_id = $2' using v_row.session_id, v_uid;
    exception when others then
      -- No access to auth.sessions: the device still signs out on its next check-in.
      null;
    end;
  end if;
end;
$$;

-- The device is signing itself out: drop it from the list.
create or replace function public.forget_device(p_device_id text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.user_devices where user_id = auth.uid() and device_id = p_device_id;
$$;

revoke all on function public.register_device(text, text, text, text, text, text) from public, anon;
revoke all on function public.sign_out_device(uuid) from public, anon;
revoke all on function public.forget_device(text) from public, anon;
grant execute on function public.register_device(text, text, text, text, text, text) to authenticated;
grant execute on function public.sign_out_device(uuid) to authenticated;
grant execute on function public.forget_device(text) to authenticated;

revoke all on all functions in schema arkstore_private from public, anon, authenticated;

grant select on public.apps, public.app_versions to anon, authenticated;
