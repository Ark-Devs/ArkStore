// Supabase Edge Function: https://<project>.supabase.co/functions/v1/ios-source
// ArkStore's iOS apps as an AltStore-format source for SideStore, AltStore and Feather.
// Public and read-only (deployed with verify_jwt off). It reads IPAs it hasn't seen yet
// (a few per request; ?refresh=N reads up to 25, which pg_cron does every 30 minutes) and caches
// what it learns in public.ios_builds.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { readIpaInfo } from './ipa.ts';
import { buildSource, ipaOf, type IosApp, type IosBuild } from './source.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// ios_builds is only writable with the service role; nothing here is exposed beyond the public catalog.
const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SOURCE_URL = `${SUPABASE_URL}/functions/v1/ios-source`;
const WEBSITE = 'https://ark-devs.github.io/ArkStore/download/';
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const params = new URL(req.url).searchParams;
  try {
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
    const urls = apps.map((a) => ipaOf(a)?.url).filter((u): u is string => Boolean(u));
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
        const info = await readIpaInfo(url);
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
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
