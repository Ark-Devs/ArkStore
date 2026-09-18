-- ArkStore: count downloads (APK fetched) and installs (install confirmed) separately.
--   apps.downloads        APK files downloaded through ArkStore
--   apps.installs         installs Android confirmed (first install, not updates)
--   app_download_stats    per day: downloads, installs, updates

alter table public.apps add column if not exists installs bigint not null default 0;
alter table public.app_download_stats add column if not exists downloads integer not null default 0;

alter table arkstore_private.download_events drop constraint if exists download_events_kind_check;
alter table arkstore_private.download_events
  add constraint download_events_kind_check check (kind in ('download', 'install', 'update'));

create or replace function arkstore_private.guard_app_installs()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.installs := old.installs;
  end if;
  return new;
end;
$$;

drop trigger if exists apps_guard_installs on public.apps;
create trigger apps_guard_installs
  before update on public.apps
  for each row execute function arkstore_private.guard_app_installs();

-- kind: 'download' when the APK finishes downloading, 'install' / 'update' once Android
-- confirms the install. Repeats from one device for the same version count once.
-- Returns the listing's download total.
create or replace function public.record_download(
  p_app_id uuid,
  p_device_id text,
  p_kind text default 'download',
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
  v_day date := (now() at time zone 'utc')::date;
begin
  if p_kind not in ('download', 'install', 'update') then
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

  insert into public.app_download_stats (app_id, day, downloads, installs, updates)
  values (
    p_app_id,
    v_day,
    case when p_kind = 'download' then 1 else 0 end,
    case when p_kind = 'install' then 1 else 0 end,
    case when p_kind = 'update' then 1 else 0 end
  )
  on conflict (app_id, day) do update set
    downloads = public.app_download_stats.downloads + excluded.downloads,
    installs = public.app_download_stats.installs + excluded.installs,
    updates = public.app_download_stats.updates + excluded.updates;

  update public.apps set
    downloads = downloads + case when p_kind = 'download' then 1 else 0 end,
    installs = installs + case when p_kind = 'install' then 1 else 0 end
  where id = p_app_id
  returning downloads into v_total;
  return v_total;
end;
$$;

revoke all on function public.record_download(uuid, text, text, text) from public;
grant execute on function public.record_download(uuid, text, text, text) to anon, authenticated;
revoke all on function arkstore_private.guard_app_installs() from public, anon, authenticated;
