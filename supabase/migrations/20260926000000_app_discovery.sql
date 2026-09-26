-- Finds new apps for every platform on GitHub, inside the database.
--
-- arkstore_private.discover_apps() searches GitHub for Android, Windows, macOS, Linux and
-- cross-platform desktop apps and queues the new ones as hidden curated listings. The release
-- sync (sync_all) then reads each one's latest release, and arkstore_private.publish_discovered()
-- publishes the ones with a build ArkStore can install and drops the rest (remembering them, so
-- they aren't searched up again).
--
-- Each run takes the next few searches from a rotating list and the next page of results, so
-- a night of runs covers far more than one search could. Schedule (pg_cron, UTC): every 30
-- minutes from 00:00 to 05:00 Asia/Kolkata / Asia/Colombo.
--
-- Without a GitHub token in the vault (arkstore_github_token) GitHub allows 10 searches a
-- minute and 60 other requests an hour, which limits how fast queued apps get their releases.

create table if not exists arkstore_private.discovery_state (
  id boolean primary key default true check (id),
  run bigint not null default 0,
  last_run_at timestamptz,
  last_added integer not null default 0
);
insert into arkstore_private.discovery_state (id) values (true) on conflict do nothing;

-- Repos looked at and turned down (no installable release, filtered out), never re-queued.
create table if not exists arkstore_private.discovery_rejects (
  repo text primary key,
  reason text not null,
  at timestamptz not null default now()
);

create or replace function arkstore_private.guess_category(p_text text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when t ~ '(emulator|\mgames?\M|gaming|minecraft|steam|launcher for games)' then 'games'
    when t ~ '(launcher|keyboard|wallpaper|icon.?pack|\mthemes?\M|customi[sz])' then 'personalization'
    when t ~ '(password|security|vpn|2fa|\motp\M|authenticator|encrypt|firewall|privacy|\mtor\M)' then 'security'
    when t ~ '(video|youtube|media.?player|\mmpv\M|\mvlc\M|jellyfin|anime|screen.?record)' then 'video'
    when t ~ '(podcast|music|audio|spotify|\mmp3\M|sound|synth)' then 'music-audio'
    when t ~ '(photo|image|screenshot|camera|gallery|\mraw\M)' then 'photography'
    when t ~ '(mastodon|fediverse|reddit|twitter|bluesky|lemmy|social)' then 'social'
    when t ~ '(\mrss\M|news|hacker.?news|feed reader)' then 'news'
    when t ~ '(ebook|epub|manga|comic|\mbooks?\M|reader|wikipedia)' then 'reading'
    when t ~ '(chat|messenger|messaging|e-?mail|\mmail\M|browser|matrix|xmpp|\msms\M|discord|telegram)' then 'communication'
    when t ~ '(finance|budget|money|wallet|expense|accounting)' then 'finance'
    when t ~ '(flashcard|education|learn|anki|school)' then 'education'
    when t ~ '(health|fitness|workout|medical)' then 'health'
    when t ~ '(\mmaps?\M|navigation|openstreetmap|\mosm\M|\mgps\M)' then 'maps'
    when t ~ 'weather' then 'weather'
    when t ~ '(file.?manager|\msync|backup|download manager|torrent|archiver|\mzip\M|cloud storage)' then 'files'
    when t ~ '(\mnotes?\M|note.?taking|todo|to-do|\mtasks?\M|calendar|markdown|office|productivity|knowledge|clipboard|pdf)' then 'productivity'
    when t ~ '(developer|terminal|\mide\M|code editor|\mgit\M|database|\msql\M|\mapi\M|devtools|docker|kubernetes|\mllm\M|\mai\M)' then 'developer'
    else 'tools'
  end
  from (select lower(coalesce(p_text, '')) as t) s;
$$;

create or replace function arkstore_private.discover_apps(p_searches integer default 3, p_max_queue integer default 400)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  -- The rotation: one GitHub search per entry (archived repos, forks and projects without a
  -- push in the last year are excluded below).
  v_queries text[] := array[
    'topic:android-app stars:>=300',
    'topic:windows-app stars:>=150',
    'topic:macos-app stars:>=200',
    'topic:linux-app stars:>=150',
    'topic:electron-app stars:>=800',
    'topic:tauri-app stars:>=250',
    'topic:f-droid stars:>=150',
    'topic:desktop-app stars:>=600',
    'topic:winui stars:>=150',
    'topic:menubar topic:macos stars:>=200',
    'topic:gtk4 stars:>=200',
    'topic:appimage stars:>=150',
    'topic:flutter-app stars:>=400',
    'topic:android language:Kotlin stars:>=1200',
    'topic:wpf topic:windows stars:>=300',
    'topic:swiftui topic:macos stars:>=500',
    'topic:qt topic:desktop stars:>=300',
    'topic:cross-platform topic:desktop stars:>=400',
    'topic:jetpack-compose topic:app stars:>=400',
    'topic:electron topic:app stars:>=1500'
  ];
  v_deny text := '(awesome|sample|\mdemos?\M|template|boilerplate|tutorial|course|example|\mlibrary\M|\msdk\M|framework|starter|playground|interview|\mclone\M|revanced|vanced|patcher|\mmods?\M|mod-?apk|crack|cheat|\mhacks?\M|piracy|pirate|cloudstream|spoof|bypass|keylogger|stealer|malware|\mrat\M|nsfw|porn|hentai|adult|xposed|lsposed|frida|dotfiles|\mcli\M|command.?line)';
  v_state record;
  v_since text := to_char(now() - interval '1 year', 'YYYY-MM-DD');
  v_q text;
  v_page integer;
  r record;
  item jsonb;
  v_text text;
  v_desc text;
  v_added integer := 0;
  i integer;
begin
  select * into v_state from arkstore_private.discovery_state for update;

  for i in 0 .. p_searches - 1 loop
    if (select count(*) from public.apps where status = 'hidden' and source = 'curated' and last_synced_at is null) >= p_max_queue then
      exit;
    end if;
    v_q := v_queries[1 + ((v_state.run * p_searches + i) % array_length(v_queries, 1))];
    -- The same search comes round again with the next page (1..5).
    v_page := 1 + (((v_state.run * p_searches + i) / array_length(v_queries, 1)) % 5);
    v_q := v_q || ' archived:false fork:false pushed:>=' || v_since;

    select * into r from arkstore_private.gh_get(
      '/search/repositories?q=' || replace(extensions.urlencode(v_q), '+', '%20') ||
      '&sort=stars&order=desc&per_page=50&page=' || v_page
    );
    if r.status in (401, 403, 429) then exit; end if;
    continue when r.status <> 200 or r.body is null;

    for item in select * from jsonb_array_elements(r.body -> 'items') loop
      v_desc := coalesce(item ->> 'description', '');
      v_text := (item ->> 'full_name') || ' ' || v_desc || ' ' ||
        coalesce((select string_agg(t, ' ') from jsonb_array_elements_text(item -> 'topics') t), '');
      continue when coalesce((item ->> 'archived')::boolean, false) or coalesce((item ->> 'fork')::boolean, false);
      continue when v_text ~* v_deny;
      continue when v_desc = '';
      -- The store is in English: skip listings written mostly in CJK scripts.
      continue when length(regexp_replace(v_desc, '[^぀-ヿ㐀-鿿가-힯]', '', 'g'))
                    > length(regexp_replace(v_desc, '[^A-Za-z]', '', 'g')) * 0.25;
      continue when exists (select 1 from public.apps a where lower(a.repo_full_name) = lower(item ->> 'full_name'));
      continue when exists (select 1 from arkstore_private.discovery_rejects d where d.repo = lower(item ->> 'full_name'));

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
      if found then v_added := v_added + 1; end if;
    end loop;
  end loop;

  update arkstore_private.discovery_state
     set run = run + 1, last_run_at = now(), last_added = v_added;
  return v_added;
end;
$$;

-- Queued apps go live once the sync finds an installable build; the rest are dropped and
-- remembered so discovery skips them.
create or replace function arkstore_private.publish_discovered()
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.apps set status = 'published'
   where source = 'curated' and status = 'hidden' and owner_id is null and cardinality(platforms) > 0;

  with gone as (
    delete from public.apps
     where source = 'curated' and status = 'hidden' and owner_id is null
       and last_synced_at is not null and cardinality(platforms) = 0
       and created_at > '2026-09-25'
    returning repo_full_name
  )
  insert into arkstore_private.discovery_rejects (repo, reason)
  select lower(repo_full_name), 'no installable release' from gone
  on conflict do nothing;
end;
$$;

revoke all on function arkstore_private.discover_apps(integer, integer) from public, anon, authenticated;
revoke all on function arkstore_private.publish_discovered() from public, anon, authenticated;
