// Builds supabase/seed.sql: catalog records for trending Android apps on GitHub that ship
// APKs, plus every repo in supabase/seed-repos.txt. Nothing here is baked into the app;
// the output is plain rows that the app reads like any developer-published listing.
//
//   npx tsx scripts/discover.ts [--limit 24] [--only-new existing.txt] [--out supabase/seed-new.sql]
//
// --only-new  skip repos listed in the file (one owner/repo per line, e.g. exported from
//             `select repo_full_name from public.apps`), so the output holds new apps only.
// --out       where to write the SQL (default supabase/seed.sql).
//
// Set GITHUB_TOKEN for 5,000 requests/hour instead of 60. Responses are cached in
// .cache/github for 12 hours, so re-runs are cheap.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { suggestCategory } from '../src/lib/github/category';
import {
  currentRelease,
  detectRepo,
  fetchReleases,
  GitHubError,
  type Detection,
  type GitHubRepo,
} from '../src/lib/github/detect';
import { parseRepoInput } from '../src/lib/github/repo';

const root = join(import.meta.dirname, '..');
const cacheDir = join(root, '.cache', 'github');
const token = process.env.GITHUB_TOKEN ?? null;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const LIMIT = Number(arg('--limit') ?? 24);
const OUT = arg('--out') ?? join('supabase', 'seed.sql');
const ONLY_NEW = arg('--only-new');
const existing = new Set(
  ONLY_NEW
    ? readFileSync(ONLY_NEW, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean)
    : [],
);
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

class QuotaExhausted extends Error {}

let apiRemaining = Infinity;

// fetch with an on-disk cache and a guard that stops before the rate limit is hit.
const cachedFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${createHash('sha1').update(url).digest('hex')}.json`);
  if (existsSync(file)) {
    const hit = JSON.parse(readFileSync(file, 'utf8'));
    if (Date.now() - hit.at < CACHE_TTL_MS) {
      return new Response(hit.body, { status: hit.status, headers: hit.headers });
    }
  }
  const isApi = url.startsWith('https://api.github.com/');
  if (isApi && apiRemaining <= 2) throw new QuotaExhausted('GitHub API quota nearly used up');

  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers as Record<string, string>), 'User-Agent': 'ArkStore-discover' },
  });
  if (isApi) {
    const left = Number(res.headers.get('x-ratelimit-remaining'));
    if (Number.isFinite(left) && !url.includes('/search/')) apiRemaining = left;
  }
  const body = await res.text();
  const headers = { 'x-ratelimit-remaining': res.headers.get('x-ratelimit-remaining') ?? '' };
  if (res.status === 200 || res.status === 404) {
    writeFileSync(file, JSON.stringify({ at: Date.now(), status: res.status, headers, body }));
  }
  return new Response(body, { status: res.status, headers });
};

async function api<T>(path: string): Promise<T> {
  const res = await cachedFetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new GitHubError(`GitHub ${res.status} for ${path}`, res.status);
  return (await res.json()) as T;
}

// Keep the catalog to apps an everyday person would install from a store.
const DENY = /(revanced|vanced|morphe|patcher|\bmods?\b|mod-?apk|crack|cheat|hack|piracy|pirate|cloudstream|pixiv|spoof|bypass|magisk|xposed|lsposed|root\b|frida|awesome|sample|samples|demo|template|boilerplate|tutorial|course|example|library|\bsdk\b|framework|clone|starter|playground|interview|issue track)/i;

function acceptable(r: GitHubRepo) {
  if (r.archived || r.fork || r.private) return false;
  const text = `${r.full_name} ${r.description ?? ''} ${(r.topics ?? []).join(' ')}`;
  return !DENY.test(text);
}

// The store UI is English; skip listings whose text is mostly CJK.
function mostlyEnglish(d: Detection) {
  const text = `${d.subtitle} ${d.description.slice(0, 600)}`;
  const cjk = text.match(/[぀-ヿ㐀-鿿가-힯]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return cjk < latin * 0.25;
}

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

async function searchCandidates(): Promise<GitHubRepo[]> {
  const active = isoDaysAgo(120);
  const queries = [
    // Established apps that are still shipping.
    `topic:android-app stars:>=1500 pushed:>=${active} archived:false`,
    `topic:f-droid stars:>=500 pushed:>=${active} archived:false`,
    // Rising: new this year and picking up stars fast.
    `topic:android-app created:>=${isoDaysAgo(420)} stars:>=150 archived:false`,
    `topic:android created:>=${isoDaysAgo(420)} stars:>=300 language:Kotlin archived:false`,
  ];
  const seen = new Set<string>();
  const lists: GitHubRepo[][] = [];
  for (const q of queries) {
    const res = await api<{ items: GitHubRepo[] }>(
      `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`,
    );
    lists.push(res.items.filter(acceptable));
  }
  // Interleave so both established and rising apps make the cut.
  const out: GitHubRepo[] = [];
  for (let i = 0; i < 30; i++) {
    for (const list of lists) {
      const r = list[i];
      if (r && !seen.has(r.full_name.toLowerCase())) {
        seen.add(r.full_name.toLowerCase());
        out.push(r);
      }
    }
  }
  return out;
}

// seed-repos.txt: "owner/repo [category] [featured]" always includes (with that category,
// optionally featured); "!owner/repo" keeps a repo out even if it's trending.
function readSeedList() {
  const text = readFileSync(join(root, 'supabase', 'seed-repos.txt'), 'utf8');
  const include: { fullName: string; category?: string; featured: boolean }[] = [];
  const exclude = new Set<string>();
  for (const line of text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)) {
    const [repo, ...rest] = line.split(/\s+/);
    const ref = parseRepoInput(repo.replace(/^!/, ''));
    if (!ref) throw new Error(`Bad repo in seed-repos.txt: ${repo}`);
    if (repo.startsWith('!')) exclude.add(ref.fullName.toLowerCase());
    else
      include.push({
        fullName: ref.fullName,
        category: rest.find((w) => w !== 'featured'),
        featured: rest.includes('featured'),
      });
  }
  return { include, exclude };
}

// ---------------------------------------------------------------------------
// SQL output
// ---------------------------------------------------------------------------

const q = (v: string | null | undefined) => (v == null ? 'null' : `'${v.replace(/'/g, "''")}'`);
const ts = (v: string | null | undefined) => (v ? `${q(v)}::timestamptz` : 'null');
const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? 'null' : String(Math.trunc(v)));
const arr = (v: string[]) => (v.length ? `array[${v.map(q).join(', ')}]::text[]` : `'{}'::text[]`);
const apkJson = (apks: { name: string; browser_download_url: string; size: number }[]) =>
  `${q(JSON.stringify(apks.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }))))}::jsonb`;

function toSql(d: Detection, category: string, featured: boolean): string {
  const r = d.release!;
  const repo = d.repo;
  const row = [
    String(featured),
    `'curated'`,
    q(repo.full_name),
    q(d.name),
    q(d.subtitle),
    q(d.description),
    q(category),
    q(d.iconCandidates[0] ?? repo.owner.avatar_url),
    arr(d.screenshotCandidates.slice(0, 8)),
    q(repo.homepage?.startsWith('https://') ? repo.homepage : null),
    q(repo.owner.login),
    q(repo.owner.avatar_url),
    q(repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : null),
    q(d.packageName),
    num(d.minSdk),
    num(repo.stargazers_count),
    arr(repo.topics ?? []),
    q(r.version),
    q(r.name),
    q(r.notes.slice(0, 8000)),
    ts(r.publishedAt),
    String(r.prerelease),
    q(r.apk.name),
    q(r.apk.browser_download_url),
    num(r.apk.size),
    apkJson(r.apks),
    'now()',
    'now()',
  ];

  const versions = d.releases.slice(0, 5).map(
    (v) =>
      `    (${[
        q(v.version),
        q(v.name),
        q(v.notes.slice(0, 8000)),
        ts(v.publishedAt),
        String(v.prerelease),
        q(v.apk.name),
        q(v.apk.browser_download_url),
        `${num(v.apk.size)}::bigint`,
        apkJson(v.apks),
      ].join(', ')})`,
  );

  return `-- ${repo.full_name} (${repo.stargazers_count} stars)
insert into public.apps (
  featured, source, repo_full_name, name, subtitle, description, category, icon_url, screenshots, homepage,
  developer_login, developer_avatar, license, package_name, min_sdk, stars, topics,
  latest_version, latest_release_name, latest_release_notes, latest_published_at, latest_prerelease,
  apk_name, apk_url, apk_size, apk_assets, repo_synced_at, last_synced_at
) values (
  ${row.join(',\n  ')}
) on conflict ((lower(repo_full_name))) do update set
  featured = excluded.featured,
  name = excluded.name,
  subtitle = excluded.subtitle,
  description = excluded.description,
  category = excluded.category,
  icon_url = excluded.icon_url,
  screenshots = excluded.screenshots,
  homepage = excluded.homepage,
  package_name = excluded.package_name,
  min_sdk = excluded.min_sdk
where public.apps.owner_id is null;

insert into public.app_versions (app_id, version, name, notes, published_at, prerelease, apk_name, apk_url, apk_size, apk_assets)
select a.id, v.*
from public.apps a
cross join (values
${versions.join(',\n')}
) as v(version, name, notes, published_at, prerelease, apk_name, apk_url, apk_size, apk_assets)
where lower(a.repo_full_name) = lower(${q(repo.full_name)})
on conflict (app_id, version) do nothing;
`;
}

// ---------------------------------------------------------------------------

async function main() {
  const picked: { d: Detection; category: string; featured: boolean }[] = [];
  const skipped: string[] = [];
  const done = new Set<string>();

  const seeds = readSeedList();
  const overrides = new Map(seeds.include.map((s) => [s.fullName.toLowerCase(), s.category]));
  const featured = new Set(seeds.include.filter((s) => s.featured).map((s) => s.fullName.toLowerCase()));

  async function consider(fullName: string, repo?: GitHubRepo, pinned = false) {
    const key = fullName.toLowerCase();
    if (done.has(key) || seeds.exclude.has(key) || existing.has(key)) return;
    done.add(key);
    const releases = await fetchReleases(fullName, { token, fetch: cachedFetch });
    if (!currentRelease(releases)) {
      skipped.push(`${fullName}: no release with an APK`);
      return;
    }
    const d = await detectRepo(parseRepoInput(fullName)!, { token, fetch: cachedFetch, repo, releases });
    if (!pinned && !mostlyEnglish(d)) {
      skipped.push(`${fullName}: listing text isn't in English`);
      return;
    }
    const chosen = overrides.get(key) ?? d.category ?? suggestCategory({ topics: d.repo.topics });
    picked.push({ d, category: chosen, featured: featured.has(key) });
    const r = d.release!;
    console.log(
      `+ ${d.repo.full_name.padEnd(40)} ${String(d.repo.stargazers_count).padStart(6)}★  ${chosen.padEnd(16)} ${r.version}${r.prerelease ? ' (beta)' : ''}  ${d.metadataSource}${featured.has(key) ? '  FEATURED' : ''}`,
    );
  }

  try {
    const candidates = await searchCandidates();
    const fromSearch = new Map(candidates.map((c) => [c.full_name.toLowerCase(), c]));
    // Pinned repos first; reuse search results to save a request when we have them.
    for (const s of seeds.include) await consider(s.fullName, fromSearch.get(s.fullName.toLowerCase()), true);
    console.log(`\n${candidates.length} trending candidates\n`);
    for (const c of candidates) {
      if (picked.length >= LIMIT) break;
      try {
        await consider(c.full_name, c);
      } catch (e) {
        if (e instanceof QuotaExhausted) throw e;
        skipped.push(`${c.full_name}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    if (!(e instanceof QuotaExhausted)) throw e;
    console.warn(`\nStopped early: ${e.message}. Re-run later (cached work is kept) or set GITHUB_TOKEN.`);
  }

  const header = `-- ArkStore catalog seed. Generated by scripts/discover.ts on ${new Date().toISOString().slice(0, 10)}.
-- Trending Android apps on GitHub that ship APKs, plus supabase/seed-repos.txt.
-- Safe to re-run: unclaimed curated listings get their text, images and featured flag refreshed;
-- release data (kept current by the sync job) and developer-owned listings are never touched.

`;
  writeFileSync(join(root, OUT), header + picked.map((p) => toSql(p.d, p.category, p.featured)).join('\n'));
  console.log(`\nWrote ${picked.length} ${ONLY_NEW ? 'new ' : ''}apps to ${OUT}`);
  if (skipped.length) console.log(`Skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
