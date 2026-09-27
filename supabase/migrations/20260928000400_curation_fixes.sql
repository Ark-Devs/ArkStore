-- Curation fixes.
-- 1. The "++" and "jailbreak" rules from 20260928000200 were too broad: they'd refuse Notepad++,
--    Xournal++ or UTM. Now "++" only counts after the apps people tweak (YouTube++, Twitter++…),
--    and only jailbreak tools are refused.
-- 2. publish_discovered() skips rejected repos. "hidden" means "waiting for a release" for curated
--    listings, so hiding one only lasted until the next run; rejected listings are removed instead.

create or replace function arkstore_private.deny_pattern()
returns text
language sql
immutable
set search_path to ''
as $$
  select '(awesome|sample|\mdemos?\M|template|boilerplate|tutorial|course|example|\mlibrary\M|\msdk\M|framework|starter|playground|interview|\mclone\M|revanced|vanced|morphe|patcher|\mpatched\M|\mmods?\M|\mmodded\M|mod-?apk|crack|cheat|\mhacks?\M|premium unlocked|\munlocked\M|piracy|pirate|cloudstream|spoof|bypass|keylogger|stealer|malware|\mrat\M|nsfw|porn|hentai|adult|xposed|lsposed|frida|dotfiles|\mcli\M|command.?line|\m(youtube|yt|twitter|instagram|spotify|reddit|tiktok|snapchat|whatsapp|facebook|discord|netflix|uyou|apollo)\s?\+\+|tweaked (apps?|ipas?)|decrypted (apps?|ipas?)|\mipa.?library\M|jailbreak (tool|for ios|for iphone))'::text;
$$;

create or replace function arkstore_private.publish_discovered()
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  delete from public.apps a
   where a.source = 'curated' and a.owner_id is null
     and exists (select 1 from arkstore_private.discovery_rejects d
                  where d.repo = lower(a.repo_full_name) and d.reason <> 'no installable release');

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

revoke all on function arkstore_private.publish_discovered() from public, anon, authenticated;
