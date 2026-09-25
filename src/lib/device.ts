import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { desktop } from './desktop';
import { chooseApkForDevice, type ApkAsset } from './github/apk';
import { rankAssets, type DesktopTarget, type ReleaseFile, type StoreOS } from './github/assets';
import { detectVisitor } from './platform';
import type { ListApp } from './types';

/** CPU architectures this phone can run, best first (e.g. ["arm64-v8a", "armeabi-v7a"]). */
export function deviceAbis(): string[] {
  if (Platform.OS !== 'android') return [];
  return Device.supportedCpuArchitectures ?? [];
}

const ABI_LABEL: Record<string, string> = {
  'arm64-v8a': 'arm64',
  'armeabi-v7a': 'armv7',
  armeabi: 'arm',
  x86_64: 'x86-64',
  x86: 'x86',
};

export const abiLabel = (abi: string) => ABI_LABEL[abi] ?? abi;

/** Which CPU build an APK file is, from its name. */
export function assetAbi(name: string): string | null {
  if (/universal/i.test(name)) return 'universal';
  if (/(arm64|aarch64|v8a)/i.test(name)) return 'arm64-v8a';
  if (/(armeabi-?v7a|armv7|arm-v7|v7a)/i.test(name)) return 'armeabi-v7a';
  if (/x86[_-]?64/i.test(name)) return 'x86_64';
  if (/x86/i.test(name)) return 'x86';
  return null;
}

export type BuildChoice = {
  asset: ApkAsset;
  /** true when the store picked this build for the phone's CPU (vs. universal fallback). */
  matched: boolean;
  /** true when the person picked it by hand. */
  manual: boolean;
  abi: string | null;
};

/**
 * The APK this phone should install. A manual pick wins; otherwise the build for this CPU,
 * otherwise the universal one.
 */
export function chooseBuild(
  assets: ApkAsset[] | null | undefined,
  fallback: { name: string | null; url: string | null; size: number | null },
  manualName?: string,
): BuildChoice | null {
  const list = assets && assets.length > 0 ? assets : fallback.url ? [{ name: fallback.name ?? 'app.apk', url: fallback.url, size: fallback.size ?? 0 }] : [];
  if (list.length === 0) return null;
  const manual = manualName ? list.find((a) => a.name === manualName) : undefined;
  if (manual) return { asset: manual, matched: false, manual: true, abi: assetAbi(manual.name) };
  const abis = deviceAbis();
  const asset = chooseApkForDevice(list, abis)!;
  const abi = assetAbi(asset.name);
  const matched = Boolean(abi && abi !== 'universal' && abis.includes(abi));
  return { asset, matched, manual: false, abi };
}

/** What builds are picked for: this computer in the desktop app, this phone, or the browser's device. */
export function buildTarget(): DesktopTarget | null {
  if (desktop) return { os: desktop.os, arch: desktop.arch, linuxPackage: desktop.linuxPackage };
  if (Platform.OS === 'android') return { os: 'android' };
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    const v = detectVisitor(navigator.userAgent);
    if (v.os && v.os !== 'ios') return { os: v.os, arch: v.arch };
  }
  return null;
}

/** The file GET downloads on this device, whatever the platform. */
export type PickedFile = {
  name: string;
  url: string;
  size: number;
  os: StoreOS;
  /** Picked for this device's CPU (vs. a universal / fallback build). */
  matched: boolean;
  manual: boolean;
  /** Set for Windows / macOS / Linux files. */
  file?: ReleaseFile;
};

type Buildable = Pick<ListApp, 'apk_assets' | 'apk_name' | 'apk_url' | 'apk_size' | 'assets'>;

/** Windows / macOS / Linux files that run on this computer, best first. */
export function desktopChoices(app: Pick<ListApp, 'assets'>, target = buildTarget()): ReleaseFile[] {
  if (!target || target.os === 'android') return [];
  return rankAssets(app.assets, target);
}

/**
 * The file to download for this device. A manual pick wins. In a browser, an app with nothing
 * for the visitor's computer falls back to its APK (to put on a phone).
 */
export function pickDownload(app: Buildable, manualName?: string, target = buildTarget()): PickedFile | null {
  if (target && target.os !== 'android') {
    const ranked = desktopChoices(app, target);
    const manual = manualName ? ranked.find((f) => f.name === manualName) : undefined;
    const file = manual ?? ranked[0];
    if (file) {
      const matched = Boolean(target.arch && file.arch === target.arch);
      return { name: file.name, url: file.url, size: file.size, os: file.os, matched, manual: Boolean(manual), file };
    }
    if (desktop) return null;
  }
  const build = chooseBuild(app.apk_assets, { name: app.apk_name, url: app.apk_url, size: app.apk_size }, manualName);
  if (!build) return null;
  return { ...build.asset, os: 'android', matched: build.matched, manual: build.manual };
}
