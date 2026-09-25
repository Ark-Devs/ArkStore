// Which platform a GitHub release file installs on, and which file a given computer or phone
// should get. Platform-agnostic, shared by the app, the download page and the scripts.
// Keep classifyAsset() in sync with arkstore_private.asset_os() / asset_arch() in the database
// (tests/db.test.ts checks both on the same file names).

export type StoreOS = 'android' | 'windows' | 'macos' | 'linux';
export type Arch = 'x64' | 'arm64' | 'x86' | 'armv7' | 'universal';

/** What kind of installer a file is. */
export type AssetKind =
  | 'apk'
  | 'exe'
  | 'msi'
  | 'msix'
  | 'dmg'
  | 'pkg'
  | 'zip'
  | 'appimage'
  | 'deb'
  | 'rpm'
  | 'flatpak'
  | 'tar';

/** An installable file as stored in apps.assets / app_versions.assets. */
export type ReleaseFile = {
  name: string;
  url: string;
  size: number;
  os: StoreOS;
  /** null when the name doesn't say (usually x64, or a universal macOS build). */
  arch: Arch | null;
};

export const OS_LABEL: Record<StoreOS, string> = {
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

export const ALL_OS: StoreOS[] = ['android', 'windows', 'macos', 'linux'];

// Word-ish tokens, so "mac" matches "app-mac-arm64.zip" but not "machine.zip".
const WIN_WORD = /(^|[^a-z0-9])(win|windows|win32|win64)([^a-z]|$)/i;
const MAC_WORD = /(^|[^a-z0-9])(mac|macos|osx|darwin|apple)([^a-z]|$)/i;
const LINUX_WORD = /(^|[^a-z0-9])linux([^a-z]|$)/i;

export function assetKind(name: string): AssetKind | null {
  const n = name.toLowerCase();
  if (n.endsWith('.apk')) return 'apk';
  if (n.endsWith('.exe')) return 'exe';
  if (n.endsWith('.msi')) return 'msi';
  if (/\.(msix|msixbundle|appx|appxbundle)$/.test(n)) return 'msix';
  if (n.endsWith('.dmg')) return 'dmg';
  if (n.endsWith('.pkg')) return 'pkg';
  if (n.endsWith('.appimage')) return 'appimage';
  if (n.endsWith('.deb')) return 'deb';
  if (n.endsWith('.rpm')) return 'rpm';
  if (n.endsWith('.flatpak')) return 'flatpak';
  if (n.endsWith('.zip')) return 'zip';
  if (/\.(tar\.gz|tgz|tar\.xz|tar\.bz2)$/.test(n)) return 'tar';
  return null;
}

/** The platform a release file installs on, or null when it isn't an installer we recognize. */
export function assetOS(name: string): StoreOS | null {
  const kind = assetKind(name);
  switch (kind) {
    case null:
      return null;
    case 'apk':
      return 'android';
    case 'exe':
    case 'msi':
    case 'msix':
      return 'windows';
    case 'dmg':
    case 'pkg':
      return 'macos';
    case 'appimage':
    case 'deb':
    case 'rpm':
    case 'flatpak':
      return 'linux';
    case 'zip':
      if (MAC_WORD.test(name)) return 'macos';
      if (WIN_WORD.test(name)) return 'windows';
      if (LINUX_WORD.test(name)) return 'linux';
      return null;
    case 'tar':
      if (LINUX_WORD.test(name)) return 'linux';
      if (MAC_WORD.test(name)) return 'macos';
      return null;
  }
}

export function assetArch(name: string): Arch | null {
  if (/universal/i.test(name)) return 'universal';
  if (/(arm64|aarch64|v8a)/i.test(name)) return 'arm64';
  if (/(armeabi-?v7a|armv7|armhf|arm-v7|v7a)/i.test(name)) return 'armv7';
  if (/(x86[_-]?64|x64|amd64|win64)/i.test(name)) return 'x64';
  if (/(i386|i686|ia32|win32|x86)/i.test(name)) return 'x86';
  return null;
}

export function classifyAsset(name: string): { os: StoreOS; arch: Arch | null; kind: AssetKind } | null {
  const os = assetOS(name);
  if (!os) return null;
  return { os, arch: assetArch(name), kind: assetKind(name)! };
}

/** Every installable file in a GitHub release, in the stored shape. Debug builds, checksums etc. are skipped. */
export function installableAssets(
  assets: { name: string; size: number; browser_download_url: string }[] | null | undefined,
): ReleaseFile[] {
  return (assets ?? [])
    .map((a) => {
      const c = classifyAsset(a.name);
      return c ? { name: a.name, url: a.browser_download_url, size: a.size, os: c.os, arch: c.arch } : null;
    })
    .filter((a): a is ReleaseFile => a !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function platformsOf(files: Pick<ReleaseFile, 'os'>[] | null | undefined): StoreOS[] {
  const set = new Set((files ?? []).map((f) => f.os));
  return ALL_OS.filter((os) => set.has(os));
}

// Lower is better. Installers that set everything up beat archives people have to unpack.
const KIND_RANK: Record<StoreOS, Partial<Record<AssetKind, number>>> = {
  android: { apk: 0 },
  windows: { exe: 0, msi: 1, msix: 2, zip: 4 },
  macos: { dmg: 0, pkg: 1, zip: 2, tar: 4 },
  linux: { appimage: 0, deb: 1, rpm: 1, flatpak: 2, tar: 4 },
};

function kindScore(file: ReleaseFile, linuxPackage: 'deb' | 'rpm' | null | undefined) {
  const kind = assetKind(file.name)!;
  let score = KIND_RANK[file.os][kind] ?? 5;
  // A distro's own package format goes first when we know it; the other one is last resort.
  if (file.os === 'linux' && (kind === 'deb' || kind === 'rpm')) {
    if (linuxPackage === kind) score = -0.5;
    else if (linuxPackage) score = 4.5;
  }
  if (file.os === 'windows' && kind === 'exe') {
    if (/(setup|install)/i.test(file.name)) score -= 0.5;
    if (/portable/i.test(file.name)) score += 3;
  }
  if (/debug/i.test(file.name)) score += 10;
  return score;
}

/**
 * How well a file's CPU type fits the machine. 0 exact, 1 fits any (universal / unspecified),
 * 2 runs through emulation (x64 on Apple silicon or Windows on Arm), null won't run.
 */
function archFit(file: ReleaseFile, arch: Arch | null | undefined): number | null {
  if (file.arch === 'universal') return 1;
  if (!arch) return file.arch === null ? 0 : file.arch === 'x64' ? 1 : 2;
  if (file.arch === arch) return 0;
  // Unlabelled builds are almost always x64 (or universal, on macOS).
  if (file.arch === null) return arch === 'x64' ? 0 : file.os === 'macos' ? 1 : 2;
  if (arch === 'arm64' && file.arch === 'x64' && (file.os === 'macos' || file.os === 'windows')) return 2;
  if (arch === 'x64' && file.arch === 'x86' && file.os === 'windows') return 2;
  return null;
}

export type DesktopTarget = { os: StoreOS; arch?: Arch | null; linuxPackage?: 'deb' | 'rpm' | null };

/** Files for one platform that can run on the given CPU, best first. */
export function rankAssets(files: ReleaseFile[] | null | undefined, target: DesktopTarget): ReleaseFile[] {
  return (files ?? [])
    .filter((f) => f.os === target.os)
    .map((f) => ({ f, fit: archFit(f, target.arch) }))
    .filter((x): x is { f: ReleaseFile; fit: number } => x.fit !== null)
    .sort(
      (a, b) =>
        a.fit * 10 + kindScore(a.f, target.linuxPackage) - (b.fit * 10 + kindScore(b.f, target.linuxPackage)) ||
        a.f.name.localeCompare(b.f.name),
    )
    .map((x) => x.f);
}

/** The file this computer should download, or null when the release has nothing for it. */
export function bestAsset(files: ReleaseFile[] | null | undefined, target: DesktopTarget): ReleaseFile | null {
  return rankAssets(files, target)[0] ?? null;
}

const KIND_LABEL: Record<AssetKind, string> = {
  apk: 'APK',
  exe: 'Installer',
  msi: 'MSI installer',
  msix: 'MSIX package',
  dmg: 'Disk image',
  pkg: 'Installer package',
  zip: 'ZIP archive',
  appimage: 'AppImage',
  deb: 'Debian / Ubuntu package',
  rpm: 'Fedora / openSUSE package',
  flatpak: 'Flatpak bundle',
  tar: 'Archive',
};

const ARCH_LABEL: Record<Arch, string> = {
  x64: 'x64',
  arm64: 'ARM64',
  x86: '32-bit',
  armv7: 'ARMv7',
  universal: 'Universal',
};

export const archLabel = (arch: Arch | null | undefined) => (arch ? ARCH_LABEL[arch] : null);

/** "Installer · x64", "AppImage · ARM64", "Disk image · Universal". */
export function fileLabel(file: Pick<ReleaseFile, 'name' | 'arch'>): string {
  const kind = assetKind(file.name);
  return [kind ? KIND_LABEL[kind] : 'File', archLabel(file.arch)].filter(Boolean).join('  ·  ');
}
