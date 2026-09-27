-- iOS apps from AltStore-format sources run by open-source projects (SideStore's community
-- source, Quark's, UTM's, Provenance's, iSH's). Only apps whose IPA is a GitHub release are
-- taken: their repos go through the same import queue and rules as Orion Store's list, and
-- the release sync lists them once a release has an IPA. Tweaked, decrypted or cracked IPA
-- libraries are not feeds: ArkStore lists developers' own open-source builds only.

alter table arkstore_private.catalog_feeds drop constraint if exists catalog_feeds_format_check;
alter table arkstore_private.catalog_feeds add constraint catalog_feeds_format_check check (format in ('orion', 'altstore'));

insert into arkstore_private.catalog_feeds (url, format) values
  ('https://community-apps.sidestore.io/sidecommunity.json', 'altstore'),
  ('https://quarksources.github.io/dist/quantumsource.min.json', 'altstore'),
  ('https://alt.getutm.app', 'altstore'),
  ('https://provenance-emu.com/apps.json', 'altstore'),
  ('https://ish.app/altstore.json', 'altstore')
on conflict do nothing;

-- Listed in those sources but not a developer's own open-source app: another store, repos that
-- re-host other people's apps, a re-upload of a closed-source game.
insert into arkstore_private.discovery_rejects (repo, reason) values
  ('n3d1117/appdb', 'another app store'),
  ('quarksources/quarksources.github.io', 're-hosts other apps'),
  ('crypticplank/flappybird', 're-upload of a closed-source game')
on conflict do nothing;

-- Also never: tweaked ("++") and decrypted App Store apps, IPA libraries, jailbreaks.
create or replace function arkstore_private.deny_pattern()
returns text
language sql
immutable
set search_path to ''
as $$
  select '(awesome|sample|\mdemos?\M|template|boilerplate|tutorial|course|example|\mlibrary\M|\msdk\M|framework|starter|playground|interview|\mclone\M|revanced|vanced|morphe|patcher|\mpatched\M|\mmods?\M|\mmodded\M|mod-?apk|crack|cheat|\mhacks?\M|premium unlocked|\munlocked\M|piracy|pirate|cloudstream|spoof|bypass|keylogger|stealer|malware|\mrat\M|nsfw|porn|hentai|adult|xposed|lsposed|frida|dotfiles|\mcli\M|command.?line|\+\+|tweaked|decrypted|ipa.?library|jailbreak)'::text;
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
  v_items jsonb;
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
    -- Orion: a JSON array. AltStore: an object whose "apps" is the array.
    v_items := case f.format when 'orion' then v_json when 'altstore' then v_json -> 'apps' end;
    continue when v_items is null or jsonb_typeof(v_items) <> 'array';

    with entries as (
      select case f.format
               when 'orion' then coalesce(
                 nullif(btrim(e ->> 'githubRepo'), ''),
                 substring(e ->> 'repoUrl' from '^https?://github\.com/([A-Za-z0-9-]+/[A-Za-z0-9._-]+?)(?:\.git)?/?$'))
               -- The repo whose GitHub release hosts the IPA (newest-style versions[] or legacy downloadURL).
               else (select substring(d from '^https://github\.com/([A-Za-z0-9-]+/[A-Za-z0-9._-]+)/releases/download/')
                       from (select e ->> 'downloadURL' as d
                             union all
                             select v ->> 'downloadURL'
                               from jsonb_array_elements(case when jsonb_typeof(e -> 'versions') = 'array' then e -> 'versions' else '[]'::jsonb end) v) dl
                      where d ~ '^https://github\.com/[^/]+/[^/]+/releases/download/'
                      limit 1)
             end as repo,
             coalesce(e ->> 'name', '') || ' ' ||
               case f.format when 'orion' then coalesce(e ->> 'description', '') else coalesce(e ->> 'subtitle', '') end as text
        from jsonb_array_elements(v_items) e
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

revoke all on function arkstore_private.sync_catalog_feeds() from public, anon, authenticated;
