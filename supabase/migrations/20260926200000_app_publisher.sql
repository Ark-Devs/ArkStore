-- Who published an app, and linking apps to their developer when they sign in.
--
-- 1. apps.publisher_github_id / publisher_login: the GitHub account of whoever published (or
--    last claimed) the listing, taken from auth.identities whenever apps.owner_id is set. It
--    stays when the owner's ArkStore account goes away (owner_id is "on delete set null"), so
--    the listing can find its way back to them.
-- 2. public.link_my_apps(p_github_token): run by the app after every sign-in. Gives the caller
--    every unowned listing that is provably theirs:
--      * listings they published before (same GitHub account id);
--      * listings of repos under their own GitHub login (what "Claim" in Studio did by hand);
--      * with their GitHub token: listings of repos in their organizations that GitHub says
--        they can push to.

alter table public.apps add column if not exists publisher_github_id text;
alter table public.apps add column if not exists publisher_login text;
create index if not exists apps_publisher_idx on public.apps (publisher_github_id) where publisher_github_id is not null;
create index if not exists apps_unowned_dev_idx on public.apps (lower(developer_login)) where owner_id is null;

-- Publisher follows the owner. Nobody sets it directly (clients have no column grant for it,
-- and this overrides whatever the statement wrote).
create or replace function arkstore_private.stamp_app_publisher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if tg_op = 'UPDATE' then
    new.publisher_github_id := old.publisher_github_id;
    new.publisher_login := old.publisher_login;
  else
    new.publisher_github_id := null;
    new.publisher_login := null;
  end if;
  if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    select * into v from arkstore_private.github_identity(new.owner_id);
    if v.provider_id is not null then
      new.publisher_github_id := v.provider_id;
      new.publisher_login := v.login;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists apps_stamp_publisher on public.apps;
create trigger apps_stamp_publisher
  before insert or update on public.apps
  for each row execute function arkstore_private.stamp_app_publisher();

-- Listings published before this migration.
update public.apps a
   set publisher_github_id = i.provider_id, publisher_login = i.login
  from (select a2.id, g.provider_id, g.login
          from public.apps a2, arkstore_private.github_identity(a2.owner_id) g
         where a2.owner_id is not null and a2.publisher_github_id is null) i
 where a.id = i.id;

create or replace function public.link_my_apps(p_github_token text default null)
returns setof public.apps
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ident record;
  v_user record;
  v_orgs record;
  v_repo record;
  r public.apps;
begin
  if v_uid is null then
    raise exception 'sign_in_required';
  end if;
  select * into v_ident from arkstore_private.github_identity(v_uid);
  if v_ident.provider_id is null then
    return;
  end if;

  -- Published by this GitHub account before, or a repo under their own login.
  return query
    update public.apps a
       set owner_id = v_uid, source = 'developer'
     where a.owner_id is null
       and (a.publisher_github_id = v_ident.provider_id
            or lower(a.developer_login) = lower(v_ident.login))
    returning a.*;

  -- Organization repos: only with a token that is really this user's, and only repos
  -- GitHub says they can push to (the same rule publish_app uses).
  if nullif(p_github_token, '') is null then
    return;
  end if;
  select * into v_user from arkstore_private.gh_get('/user', p_github_token);
  if v_user.status <> 200 or (v_user.body ->> 'id') is distinct from v_ident.provider_id then
    return;
  end if;
  select * into v_orgs from arkstore_private.gh_get('/user/orgs?per_page=100', p_github_token);
  if v_orgs.status <> 200 or jsonb_typeof(v_orgs.body) <> 'array' then
    return;
  end if;

  for r in
    select a.*
      from public.apps a
     where a.owner_id is null
       and lower(a.developer_login) in (select lower(o ->> 'login') from jsonb_array_elements(v_orgs.body) o)
     order by a.stars desc
     limit 20
  loop
    select * into v_repo from arkstore_private.gh_get('/repos/' || r.repo_full_name, p_github_token);
    if v_repo.status = 200
       and (coalesce((v_repo.body -> 'permissions' ->> 'admin')::boolean, false)
            or coalesce((v_repo.body -> 'permissions' ->> 'maintain')::boolean, false)
            or coalesce((v_repo.body -> 'permissions' ->> 'push')::boolean, false)) then
      return query
        update public.apps a set owner_id = v_uid, source = 'developer'
         where a.id = r.id and a.owner_id is null
        returning a.*;
    end if;
  end loop;
end;
$$;

revoke all on function public.link_my_apps(text) from public, anon;
grant execute on function public.link_my_apps(text) to authenticated;
revoke all on function arkstore_private.stamp_app_publisher() from public, anon, authenticated;
