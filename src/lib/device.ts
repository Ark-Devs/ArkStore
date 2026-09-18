import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { chooseApkForDevice, type ApkAsset } from './github/apk';

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
