-- Android package names for listings that lack one (curated imports), read from each APK's
-- AndroidManifest.xml by the ios-source function (?task=apk-packages; it shares the ZIP reader).
-- The Android app needs the package name to see whether an app is on the phone, whoever
-- installed it, and to notice when it's uninstalled. This table remembers each APK read, so a
-- bad APK is retried weekly rather than every run. Written only with the service role.

create table if not exists public.apk_packages (
  url text primary key,
  package_name text,
  error text,
  checked_at timestamptz not null default now()
);
alter table public.apk_packages enable row level security;
