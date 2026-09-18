export type ReleaseAsset = {
  name: string;
  size: number;
  browser_download_url: string;
  download_count?: number;
};

/** An APK as stored in apps.apk_assets / app_versions.apk_assets. */
export type ApkAsset = { name: string; url: string; size: number };

function abiRank(name: string) {
  if (/universal/i.test(name)) return 0;
  if (/(arm64|aarch64|v8a)/i.test(name)) return 2;
  if (/(armeabi|armv7|arm-v7|v7a|x86|mips)/i.test(name)) return 3;
  return 1;
}

/**
 * Best APK in a release: universal, then ABI-less, then arm64, then other ABIs, debug builds last.
 * Keep in sync with arkstore_private.pick_apk() in the database.
 */
export function pickApk<T extends { name: string; size: number }>(assets: T[] | null | undefined): T | null {
  const apks = (assets ?? []).filter((a) => a.name.toLowerCase().endsWith('.apk'));
  if (apks.length === 0) return null;
  const score = (a: T) => (/debug/i.test(a.name) ? 10 : 0) + abiRank(a.name);
  return [...apks].sort(
    (a, b) => score(a) - score(b) || (b.size ?? 0) - (a.size ?? 0) || a.name.localeCompare(b.name),
  )[0];
}

const ABI_PATTERNS: Record<string, RegExp> = {
  'arm64-v8a': /(arm64|aarch64|v8a)/i,
  'armeabi-v7a': /(armeabi-?v7a|armv7|arm-v7|v7a)/i,
  x86_64: /x86[_-]?64/i,
  x86: /x86(?![_-]?64)/i,
};

/**
 * The APK built for this phone's CPU, like Play Store split APKs. Falls back to the
 * universal pick when the release has no per-ABI builds or none match.
 * `abis` is the device's supported list in preference order (expo-device supportedCpuArchitectures).
 */
export function chooseApkForDevice(assets: ApkAsset[], abis: string[] | null | undefined): ApkAsset | null {
  const apks = assets.filter((a) => a.name.toLowerCase().endsWith('.apk') && !/debug/i.test(a.name));
  for (const abi of abis ?? []) {
    const pattern = ABI_PATTERNS[abi];
    if (!pattern) continue;
    const match = apks
      .filter((a) => pattern.test(a.name) && !/universal/i.test(a.name))
      .sort((a, b) => a.size - b.size)[0];
    if (match) return match;
  }
  return pickApk(apks.length ? apks : assets);
}
