// Recognize an app from its GitHub repo: listing text, icon, screenshots, package id and
// the newest stable release that ships something installable (APK, or Windows / macOS /
// Linux installers).
// Platform-agnostic (plain fetch), shared by the app and scripts/discover.ts.
import { pickApk, type ReleaseAsset } from './apk';
import { installableAssets, platformsOf, type ReleaseFile, type StoreOS } from './assets';
import { suggestCategory } from './category';
import { readmeImages, readmeSummary } from './markdown';
import type { RepoRef } from './repo';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export type GitHubRepo = {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count?: number;
  topics?: string[];
  language?: string | null;
  license?: { spdx_id?: string | null; name?: string | null } | null;
  default_branch: string;
  private: boolean;
  archived?: boolean;
  fork?: boolean;
  owner: { login: string; avatar_url: string; type?: string };
};

export type GitHubRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: ReleaseAsset[];
};

export type DetectedRelease = {
  version: string;
  name: string | null;
  notes: string;
  publishedAt: string | null;
  prerelease: boolean;
  /** Best APK in the release, or null for desktop-only releases. */
  apk: ReleaseAsset | null;
  /** Every APK in the release, so phones can pick the build for their CPU. */
  apks: ReleaseAsset[];
  /** Every installable file, for every platform. */
  files: ReleaseFile[];
  platforms: StoreOS[];
};

export type Detection = {
  repo: GitHubRepo;
  release: DetectedRelease | null;
  releases: DetectedRelease[];
  name: string;
  subtitle: string;
  description: string;
  category: string;
  iconCandidates: string[];
  screenshotCandidates: string[];
  packageName: string | null;
  minSdk: number | null;
  /** Where the listing text came from, for the "recognized" chips in the publish flow. */
  metadataSource: 'fastlane' | 'play-listing' | 'readme' | 'repo';
};

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
    public rateLimited = false,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

type Options = {
  token?: string | null;
  /** Skip the repo request when the caller already has it (search results). */
  repo?: GitHubRepo;
  /** Skip the releases request when the caller already fetched them. */
  releases?: DetectedRelease[];
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

async function api<T>(path: string, opts: Options): Promise<T> {
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    signal: opts.signal,
  });
  if (!res.ok) {
    const rateLimited =
      res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');
    const message =
      res.status === 404
        ? 'Repository not found. Check the link, and make sure the repo is public.'
        : rateLimited
          ? 'GitHub is rate limiting requests. Sign in with GitHub or try again in a few minutes.'
          : `GitHub returned ${res.status}.`;
    throw new GitHubError(message, res.status, rateLimited);
  }
  return (await res.json()) as T;
}

async function raw(fullName: string, branch: string, path: string, opts: Options): Promise<string | null> {
  try {
    const res = await (opts.fetch ?? fetch)(`${RAW}/${fullName}/${branch}/${encodePath(path)}`, {
      signal: opts.signal,
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const rawUrl = (fullName: string, branch: string, path: string) =>
  `${RAW}/${fullName}/${branch}/${encodePath(path)}`;

const IMAGE = /\.(png|jpe?g|webp)$/i;
const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

// ---------------------------------------------------------------------------
// Store listing metadata committed in the repo (fastlane / F-Droid, or Gradle Play Publisher)
// ---------------------------------------------------------------------------

type Listing = {
  kind: 'fastlane' | 'play-listing';
  base: string;
  files: { title: string; short: string; full: string; icon: RegExp; screenshots: RegExp };
};

const LOCALES = ['en-US', 'en-GB', 'en', 'en-AU', 'en-CA'];

function findListing(paths: string[]): Listing | null {
  const candidates: Listing[] = [];
  for (const p of paths) {
    const fastlane = p.match(/^((?:.*\/)?(?:fastlane\/metadata\/android|metadata)\/([A-Za-z-]+)\/)(?:full_description|short_description|title)\.txt$/);
    if (fastlane) {
      candidates.push({
        kind: 'fastlane',
        base: fastlane[1],
        files: {
          title: 'title.txt',
          short: 'short_description.txt',
          full: 'full_description.txt',
          icon: /^images\/icon\.(png|jpe?g|webp)$/i,
          screenshots: /^images\/phoneScreenshots\/[^/]+\.(png|jpe?g|webp)$/i,
        },
      });
      continue;
    }
    const play = p.match(/^((?:.*\/)?src\/main\/play\/listings\/([A-Za-z-]+)\/)(?:full-description|short-description|title)\.txt$/);
    if (play) {
      candidates.push({
        kind: 'play-listing',
        base: play[1],
        files: {
          title: 'title.txt',
          short: 'short-description.txt',
          full: 'full-description.txt',
          icon: /^graphics\/icon\/[^/]+\.(png|jpe?g|webp)$/i,
          screenshots: /^graphics\/phone-screenshots\/[^/]+\.(png|jpe?g|webp)$/i,
        },
      });
    }
  }
  if (candidates.length === 0) return null;
  const rank = (l: Listing) => {
    const locale = l.base.split('/').filter(Boolean).pop() ?? '';
    const i = LOCALES.indexOf(locale);
    return (i === -1 ? 100 : i) * 10 + l.base.split('/').length;
  };
  return candidates.sort((a, b) => rank(a) - rank(b))[0];
}

// ---------------------------------------------------------------------------
// Icons and screenshots from the file tree
// ---------------------------------------------------------------------------

function iconPaths(paths: string[], listing: Listing | null): string[] {
  const out: string[] = [];
  const add = (list: string[]) => list.forEach((p) => !out.includes(p) && out.push(p));
  const preferApp = (a: string, b: string) =>
    Number(!a.startsWith('app/')) - Number(!b.startsWith('app/')) || a.length - b.length;

  if (listing) {
    add(paths.filter((p) => p.startsWith(listing.base) && listing.files.icon.test(p.slice(listing.base.length))));
  }
  add(paths.filter((p) => /(^|\/)src\/main\/ic_launcher-(playstore|web)\.png$/i.test(p)).sort(preferApp));
  // Flutter / React Native projects often carry a 1024px iOS icon, the sharpest one in the repo.
  add(paths.filter((p) => /AppIcon\.appiconset\/[^/]*1024[^/]*\.png$/i.test(p)));
  for (const density of ['xxxhdpi', 'xxhdpi']) {
    add(
      paths
        .filter((p) => new RegExp(`(^|/)src/main/res/mipmap-${density}(-v\\d+)?/ic_launcher(_round)?\\.(png|webp)$`, 'i').test(p))
        .sort(preferApp),
    );
  }
  add(
    paths
      .filter((p) => {
        if (!IMAGE.test(p) || p.split('/').length > 3) return false;
        const file = p.split('/').pop()!.toLowerCase();
        if (/(badge|github|fdroid|f-droid|google|play|screenshot|banner|feature)/.test(file)) return false;
        return /(^|[-_.])(logo|icon|app[-_]?icon|launcher)([-_.]|$)/.test(file);
      })
      .sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length),
  );
  return out.slice(0, 6);
}

function screenshotPaths(paths: string[], listing: Listing | null): string[] {
  if (listing) {
    const own = paths
      .filter((p) => p.startsWith(listing.base) && listing.files.screenshots.test(p.slice(listing.base.length)))
      .sort(naturalSort);
    if (own.length > 0) return own.slice(0, 12);
  }
  return paths
    .filter(
      (p) =>
        IMAGE.test(p) &&
        /(^|\/)(screenshots?|screens|previews?|phoneScreenshots)\//i.test(p) &&
        !/(tenInch|sevenInch|tv|wear|desktop|tablet)/i.test(p),
    )
    .sort(naturalSort)
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// Gradle: application id and minSdk
// ---------------------------------------------------------------------------

async function gradleInfo(paths: string[], repo: GitHubRepo, opts: Options) {
  // Module build files, e.g. app/build.gradle.kts or (Flutter) app/android/app/build.gradle.kts.
  const gradle = paths
    .filter((p) => /\/build\.gradle(\.kts)?$/.test(p) && !/(^|\/)(buildSrc|build-logic|plugins?)\//.test(p))
    .sort(
      (a, b) =>
        Number(!/(^|\/)app\/build\.gradle/.test(a)) - Number(!/(^|\/)app\/build\.gradle/.test(b)) ||
        a.split('/').length - b.split('/').length,
    );
  for (const path of gradle.slice(0, 3)) {
    const text = await raw(repo.full_name, repo.default_branch, path, opts);
    if (!text) continue;
    const id =
      text.match(/applicationId\s*=?\s*["']([A-Za-z][\w]*(?:\.[A-Za-z_][\w]*)+)["']/)?.[1] ??
      (/com\.android\.application|android\.application/.test(text)
        ? text.match(/namespace\s*=?\s*["']([A-Za-z][\w]*(?:\.[A-Za-z_][\w]*)+)["']/)?.[1]
        : undefined);
    const minSdk = Number(text.match(/minSdk(?:Version)?\s*(?:=|\()?\s*(\d{2})/)?.[1]);
    if (id) return { packageName: id, minSdk: Number.isFinite(minSdk) ? minSdk : null };
  }
  return { packageName: null, minSdk: null };
}

// ---------------------------------------------------------------------------

export function prettifyRepoName(name: string): string {
  // "thunderbird-android" -> "Thunderbird", but "web-to-app" stays "Web To App".
  const stripped = name.replace(/[-_](android|app|mobile|client)$/i, '').replace(/^(android)[-_]/i, '');
  const cleaned = (/[-_]/.test(stripped) ? name : stripped).replace(/[-_]+/g, ' ').trim();
  const base = cleaned || name;
  return base
    .split(' ')
    .map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
    .slice(0, 40);
}

const oneLine = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function firstSentence(text: string) {
  const line = oneLine(text.split('\n\n')[0]);
  const end = line.search(/[.!?](\s|$)/);
  const sentence = end > 0 ? line.slice(0, end + 1) : line;
  return sentence.length <= 80 ? sentence : '';
}

function toRelease(r: GitHubRelease): DetectedRelease | null {
  if (r.draft) return null;
  const files = installableAssets(r.assets);
  if (files.length === 0) return null;
  const apk = pickApk(r.assets);
  return {
    version: r.tag_name,
    name: r.name || null,
    notes: (r.body ?? '').trim(),
    publishedAt: r.published_at,
    prerelease: r.prerelease,
    apk,
    apks: r.assets.filter((a) => a.name.toLowerCase().endsWith('.apk')),
    files,
    platforms: platformsOf(files),
  };
}

/** Published releases that ship something installable, newest first (drafts excluded, prereleases kept). */
export function installableReleases(releases: GitHubRelease[]): DetectedRelease[] {
  return releases
    .map(toRelease)
    .filter((r): r is DetectedRelease => r !== null)
    .sort((a, b) => Date.parse(b.publishedAt ?? '0') - Date.parse(a.publishedAt ?? '0'));
}

/**
 * The release ArkStore installs: newest stable one with an installer, or the newest prerelease
 * when the project has only ever shipped betas. Mirrors arkstore_private.fetch_release().
 */
export function currentRelease(releases: DetectedRelease[]): DetectedRelease | null {
  return releases.find((r) => !r.prerelease) ?? releases[0] ?? null;
}

export async function fetchReleases(fullName: string, opts: Options = {}) {
  const list = await api<GitHubRelease[]>(`/repos/${fullName}/releases?per_page=15`, opts);
  return installableReleases(list);
}

export async function detectRepo(ref: RepoRef, opts: Options = {}): Promise<Detection> {
  const repo = opts.repo ?? (await api<GitHubRepo>(`/repos/${ref.fullName}`, opts));
  if (repo.private) {
    throw new GitHubError('This repo is private. ArkStore can only list public repos.', 403);
  }
  const full = repo.full_name;
  const branch = repo.default_branch;

  const [releases, tree] = await Promise.all([
    opts.releases ?? fetchReleases(full, opts),
    api<{ tree: { path: string; type: string }[] }>(
      `/repos/${full}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      opts,
    ).catch(() => ({ tree: [] })),
  ]);
  const paths = tree.tree.filter((t) => t.type === 'blob').map((t) => t.path);

  const listing = findListing(paths);
  const readmePath = paths.find((p) => /^readme(\.md|\.markdown)?$/i.test(p));

  const [title, short, full_, readme, gradle] = await Promise.all([
    listing ? raw(full, branch, listing.base + listing.files.title, opts) : null,
    listing ? raw(full, branch, listing.base + listing.files.short, opts) : null,
    listing ? raw(full, branch, listing.base + listing.files.full, opts) : null,
    readmePath ? raw(full, branch, readmePath, opts) : null,
    gradleInfo(paths, repo, opts),
  ]);

  const fullText = full_
    ? full_
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(p|div|ul|ol)>/gi, '\n')
        .replace(/<li>/gi, '• ')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : '';
  const readmeText = readme ? readmeSummary(readme) : '';

  const name = oneLine(title).slice(0, 40) || prettifyRepoName(repo.name);
  const description = (fullText || readmeText || oneLine(repo.description)).slice(0, 4000);
  const subtitle = (oneLine(short) || oneLine(repo.description) || firstSentence(description)).slice(0, 80);

  const readmeDir = readmePath?.includes('/') ? readmePath.slice(0, readmePath.lastIndexOf('/')) : '';
  const rawBase = `${RAW}/${full}/${branch}${readmeDir ? `/${readmeDir}` : ''}`;
  const screenshots = [
    ...screenshotPaths(paths, listing).map((p) => rawUrl(full, branch, p)),
    ...(readme ? readmeImages(readme, rawBase) : []),
  ].filter((u, i, all) => all.indexOf(u) === i);

  const icons = [...iconPaths(paths, listing).map((p) => rawUrl(full, branch, p)), repo.owner.avatar_url];

  return {
    repo,
    release: currentRelease(releases),
    releases: releases.slice(0, 10),
    name,
    subtitle,
    description,
    category: suggestCategory({
      topics: repo.topics,
      name: repo.name,
      description: repo.description,
      extra: `${subtitle} ${description.slice(0, 400)}`,
    }),
    iconCandidates: icons,
    screenshotCandidates: screenshots.slice(0, 12),
    packageName: gradle.packageName,
    minSdk: gradle.minSdk,
    metadataSource: listing ? listing.kind : readmeText ? 'readme' : 'repo',
  };
}
