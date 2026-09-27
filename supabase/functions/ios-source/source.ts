// ArkStore's iOS apps as an AltStore-format source (the format SideStore, AltStore and Feather
// read). Only apps whose IPA has been read (bundle ID known) are listed: those clients refuse an
// app whose bundle ID doesn't match the source.

export type IosApp = {
  id: string;
  repo_full_name: string;
  name: string;
  subtitle: string;
  description: string;
  category: string;
  icon_url: string | null;
  screenshots: string[] | null;
  developer_login: string;
  latest_version: string | null;
  latest_published_at: string | null;
  latest_release_notes: string | null;
  featured: boolean;
  assets: { name: string; url: string; size: number; os: string }[] | null;
};

export type IosBuild = {
  url: string;
  bundle_id: string | null;
  version: string | null;
  build: string | null;
  min_os: string | null;
  app_name: string | null;
  privacy: Record<string, string> | null;
};

export const SOURCE_IDENTIFIER = 'io.github.ark-devs.arkstore';
const TINT = '#D71921';

// AltStore's categories.
const CATEGORY: Record<string, string> = {
  games: 'games',
  developer: 'developer',
  social: 'social',
  communication: 'social',
  'music-audio': 'entertainment',
  video: 'photo-video',
  photography: 'photo-video',
  reading: 'entertainment',
  news: 'lifestyle',
  health: 'lifestyle',
  education: 'lifestyle',
  maps: 'utilities',
};

/** The IPA ArkStore lists for an app: a plain .ipa before a TrollStore .tipa. */
export function ipaOf(app: Pick<IosApp, 'assets'>) {
  const ipas = (app.assets ?? []).filter((a) => a.os === 'ios');
  return ipas.find((a) => /\.ipa$/i.test(a.name)) ?? ipas[0] ?? null;
}

const clean = (s: string | null | undefined, n: number) => (s ?? '').replace(/\r/g, '').trim().slice(0, n);
const bare = (v: string | null | undefined) => (v ?? '').replace(/^v(?=\d)/i, '');

/** Imported listings are often named after the repo ("moonlight-ios"); the IPA knows the real name. */
export function displayName(app: Pick<IosApp, 'name' | 'developer_login'> & { repo_full_name?: string }, b?: Pick<IosBuild, 'app_name'> | null) {
  const name = clean(app.name, 60);
  const slug = app.repo_full_name?.split('/')[1] ?? '';
  const repoNamed = !name || name.toLowerCase() === slug.toLowerCase() || /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(name) || name === 'app';
  return (repoNamed && clean(b?.app_name, 60)) || name || clean(b?.app_name, 60) || app.developer_login;
}

export function buildSource(apps: IosApp[], builds: Map<string, IosBuild>, sourceURL: string, website: string) {
  const listed = apps
    .map((app) => ({ app, ipa: ipaOf(app) }))
    .filter((x): x is { app: IosApp; ipa: NonNullable<ReturnType<typeof ipaOf>> } => Boolean(x.ipa && builds.get(x.ipa.url)?.bundle_id))
    // Clients refuse a source that lists a bundle ID twice (forks): the first (most starred) wins.
    .filter(({ ipa }, i, all) => all.findIndex((x) => builds.get(x.ipa.url)!.bundle_id === builds.get(ipa.url)!.bundle_id) === i)
    .map(({ app, ipa }) => {
      const b = builds.get(ipa.url)!;
      const version = b.version || bare(app.latest_version) || '1.0';
      const date = app.latest_published_at ?? new Date().toISOString();
      const notes = clean(app.latest_release_notes, 1500);
      return {
        name: displayName(app, b),
        bundleIdentifier: b.bundle_id!,
        developerName: app.developer_login,
        subtitle: clean(app.subtitle, 120),
        localizedDescription: clean(app.description || app.subtitle, 4000) || app.name,
        iconURL: app.icon_url ?? `https://github.com/${app.developer_login}.png`,
        tintColor: TINT,
        category: CATEGORY[app.category] ?? 'utilities',
        screenshots: (app.screenshots ?? []).slice(0, 8),
        versions: [
          {
            version,
            ...(b.build ? { buildVersion: b.build } : {}),
            date,
            localizedDescription: notes,
            downloadURL: ipa.url,
            size: ipa.size,
            ...(b.min_os ? { minOSVersion: b.min_os } : {}),
          },
        ],
        // Pre-versions fields, for older clients.
        version,
        versionDate: date,
        versionDescription: notes,
        downloadURL: ipa.url,
        size: ipa.size,
        appPermissions: { entitlements: [], privacy: b.privacy ?? {} },
        // Not marketplaceID: in AltStore's format it marks an app as notarized for the EU app
        // marketplace, and SideStore then refuses the whole source.
        githubRepository: `https://github.com/${app.repo_full_name}`,
      };
    });

  return {
    name: 'ArkStore',
    identifier: SOURCE_IDENTIFIER,
    subtitle: 'Open-source iPhone and iPad apps from GitHub',
    description:
      'Every open-source app on ArkStore that ships an IPA in its GitHub releases, updated automatically when a new release comes out. ArkStore lists apps; it does not sign them.',
    iconURL: 'https://github.com/Ark-Devs.png',
    website,
    sourceURL,
    tintColor: TINT,
    featuredApps: [...new Set(apps.filter((a) => a.featured).map((a) => builds.get(ipaOf(a)?.url ?? '')?.bundle_id).filter(Boolean))],
    apps: listed,
    news: [],
  };
}

/**
 * The feed the ArkStore shortcut reads (ios-source?format=shortcut): `names` for Choose from List,
 * and each name as a key whose value is the link to open, so the shortcut needs only Get
 * Dictionary Value. Every published iOS app with an IPA is in it (installing from a link doesn't
 * need the IPA to have been read). `via` picks SideStore's or TrollStore's install link, and
 * `extras` are menu entries listed before the apps.
 */
export function buildShortcutFeed(
  apps: (Pick<IosApp, 'name' | 'developer_login' | 'assets'> & { repo_full_name?: string })[],
  via: 'sidestore' | 'trollstore',
  builds: Map<string, Pick<IosBuild, 'app_name'>> = new Map(),
  extras: [label: string, url: string][] = [],
) {
  const feed: Record<string, unknown> = Object.fromEntries(extras);
  const names: string[] = [];
  for (const app of apps) {
    const ipa = via === 'trollstore'
      ? (app.assets ?? []).find((a) => a.os === 'ios' && /\.tipa$/i.test(a.name)) ?? ipaOf(app)
      : ipaOf(app);
    if (!ipa) continue;
    const main = ipaOf(app);
    let name = displayName(app, main ? builds.get(main.url) : null);
    if (name === 'names' || name in feed) name = `${name} (${app.developer_login})`;
    if (name in feed) continue;
    const url = encodeURIComponent(ipa.url);
    feed[name] = via === 'trollstore' ? `apple-magnifier://install?url=${url}` : `sidestore://install?url=${url}`;
    names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  // Menu entries (add the source, the setup guide) come first, then the apps A to Z.
  return { names: [...extras.map(([label]) => label), ...names], ...feed };
}
