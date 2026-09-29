// Supabase Edge Function: https://<project>.supabase.co/functions/v1/ios-source
// ArkStore's iOS apps as an AltStore-format source for SideStore, AltStore and Feather.
// Public and read-only (deployed with verify_jwt off). It reads IPAs it hasn't seen yet
// (a few per request; ?refresh=N reads up to 25, which pg_cron does every 30 minutes) and caches
// what it learns in public.ios_builds. ?format=shortcut is the list the ArkStore shortcut reads.
// ?task=apk-packages is an Android job that lives here because it shares the ZIP reader: it reads
// the package name from the APKs of listings that don't have one yet (see apkPackages below).
import { createClient } from 'npm:@supabase/supabase-js@2';

import { readApkPackage } from './apk.ts';
import { readIpaInfo } from './ipa.ts';
import { buildShortcutFeed, buildSource, ipaOf, type IosApp, type IosBuild } from './source.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// ios_builds is only writable with the service role; nothing here is exposed beyond the public catalog.
const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SOURCE_URL = `${SUPABASE_URL}/functions/v1/ios-source`;
const WEBSITE = 'https://store.arkdevs.xyz/download/';
const COLUMNS =
  'id,repo_full_name,name,subtitle,description,category,icon_url,screenshots,developer_login,latest_version,latest_published_at,latest_release_notes,featured,assets';
const RETRY_FAILED_AFTER = 7 * 24 * 60 * 60 * 1000;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

async function loadBuilds(urls: string[]) {
  const builds = new Map<string, IosBuild & { error: string | null; checked_at: string }>();
  for (let i = 0; i < urls.length; i += 150) {
    const { data, error } = await supabase.from('ios_builds').select('*').in('url', urls.slice(i, i + 150));
    if (error) throw new Error(error.message);
    for (const b of data ?? []) builds.set(b.url, b);
  }
  return builds;
}

/**
 * Android: fills in package_name for listings that lack it (curated imports), read from each
 * APK's AndroidManifest.xml. The Android app needs it to see whether an app is on the phone
 * (installed through ArkStore or not) and to notice uninstalls. Results, including failures, are
 * kept in public.apk_packages so a bad APK is retried weekly, not every run.
 */
async function apkPackages(wanted: number) {
  const { data, error } = await supabase
    .from('apps')
    .select('id, apk_url, apk_size')
    .eq('status', 'published')
    .is('package_name', null)
    .not('apk_url', 'is', null)
    .order('stars', { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; apk_url: string; apk_size: number | null }[];
  const { data: seen } = await supabase.from('apk_packages').select('url, package_name, checked_at').in('url', rows.map((r) => r.apk_url));
  const known = new Map((seen ?? []).map((r) => [r.url as string, r]));
  const deadline = Date.now() + 100_000;
  let read = 0;
  let found = 0;
  for (const row of rows) {
    if (read >= wanted || Date.now() > deadline) break;
    const prev = known.get(row.apk_url);
    let pkg: string | null = prev?.package_name ?? null;
    if (!pkg) {
      if (prev && Date.now() - Date.parse(prev.checked_at) < RETRY_FAILED_AFTER) continue;
      read++;
      let err: string | null = null;
      try {
        pkg = await readApkPackage(row.apk_url, fetch, row.apk_size);
      } catch (e) {
        err = String((e as Error).message ?? e).slice(0, 300);
      }
      await supabase.from('apk_packages').upsert({ url: row.apk_url, package_name: pkg, error: err, checked_at: new Date().toISOString() });
    }
    if (pkg) {
      await supabase.from('apps').update({ package_name: pkg }).eq('id', row.id);
      found++;
    }
  }
  return { read, found, missing: rows.length - found };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const params = new URL(req.url).searchParams;
  // Someone opened the source link in a browser: send them to the guide, which has the
  // Add to SideStore button. SideStore, AltStore, Feather and Shortcuts don't ask for HTML.
  if ((req.headers.get('accept') ?? '').includes('text/html')) {
    return new Response(null, { status: 302, headers: { ...CORS, Location: WEBSITE, Vary: 'Accept' } });
  }
  try {
    if (params.get('task') === 'apk-packages') {
      const result = await apkPackages(Math.min(Math.max(Number(params.get('refresh')) || 10, 1), 40));
      return new Response(JSON.stringify(result), { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
    }

    const { data, error } = await supabase
      .from('apps')
      .select(COLUMNS)
      .contains('platforms', ['ios'])
      .eq('status', 'published')
      .order('featured', { ascending: false })
      .order('stars', { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    const apps = (data ?? []) as IosApp[];

    // The ArkStore shortcut's list: names and install links (no IPAs are read for it). A source
    // app given this link by mistake gets the source instead.
    const sourceApp = /sidestore|altstore|feather/i.test(req.headers.get('user-agent') ?? '');
    if (params.get('format') === 'shortcut' && !sourceApp) {
      const builds = await loadBuilds(apps.map((a) => ipaOf(a)?.url).filter((u): u is string => Boolean(u)));
      const via = params.get('via') === 'trollstore' ? 'trollstore' : 'sidestore';
      const extras: [string, string][] = [
        ...(via === 'sidestore' ? [['Add ArkStore to SideStore (for updates)', `sidestore://source?url=${encodeURIComponent(SOURCE_URL)}`] as [string, string]] : []),
        ['First-time setup guide', WEBSITE],
      ];
      const feed = buildShortcutFeed(apps, via, builds, extras);
      return new Response(JSON.stringify(feed), {
        headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300', Vary: 'Accept, User-Agent' },
      });
    }

    const sizes = new Map(apps.map((a) => ipaOf(a)).filter(Boolean).map((f) => [f!.url, f!.size] as const));
    const urls = [...sizes.keys()];
    const builds = await loadBuilds(urls);

    // Read IPAs not seen yet (and retry failures weekly), within a time budget.
    const wanted = Math.min(Math.max(Number(params.get('refresh')) || 3, 0), 25);
    const deadline = Date.now() + (params.has('refresh') ? 100_000 : 8_000);
    const todo = urls.filter((u) => {
      const b = builds.get(u);
      return !b || (!b.bundle_id && Date.now() - Date.parse(b.checked_at) > RETRY_FAILED_AFTER);
    });
    for (const url of todo.slice(0, wanted)) {
      if (Date.now() > deadline) break;
      let row: Record<string, unknown>;
      try {
        const info = await readIpaInfo(url, fetch, sizes.get(url));
        row = { url, bundle_id: info.bundleId, version: info.version, build: info.build, min_os: info.minOS, app_name: info.name, privacy: info.privacy, error: null };
      } catch (e) {
        row = { url, bundle_id: null, error: String((e as Error).message ?? e).slice(0, 300) };
      }
      row.checked_at = new Date().toISOString();
      await supabase.from('ios_builds').upsert(row);
      builds.set(url, row as never);
    }

    const source = buildSource(apps, builds, SOURCE_URL, WEBSITE);
    return new Response(JSON.stringify(source), {
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300', Vary: 'Accept, User-Agent' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
});
