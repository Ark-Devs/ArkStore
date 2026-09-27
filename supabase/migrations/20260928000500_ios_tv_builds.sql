-- Apple TV builds (tvOS .ipa files, e.g. "streamyfin-ios-tv.ipa", "Provenance-tvOS.ipa") don't
-- install on an iPhone or iPad, so they aren't iOS builds; listings synced before this drop them.

create or replace function arkstore_private.asset_os(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when n like '%.apk' then 'android'
    when n ~ '\.(ipa|tipa)$' then case when n ~ '(tvos|appletv|(^|[^a-z0-9])tv([^a-z0-9]|$))' then null else 'ios' end
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

-- Drop Apple TV builds already stored on listings (the trigger recomputes platforms).
update public.apps a
   set assets = (select coalesce(jsonb_agg(x), '[]'::jsonb)
                   from jsonb_array_elements(a.assets) x
                  where not (x ->> 'os' = 'ios' and lower(x ->> 'name') ~ '(tvos|appletv|(^|[^a-z0-9])tv([^a-z0-9]|$))'))
 where jsonb_typeof(a.assets) = 'array'
   and exists (select 1 from jsonb_array_elements(a.assets) x
                where x ->> 'os' = 'ios' and lower(x ->> 'name') ~ '(tvos|appletv|(^|[^a-z0-9])tv([^a-z0-9]|$))');
