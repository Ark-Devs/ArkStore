// iPhone and iPad. iOS doesn't let one app install another, so ArkStore lists iOS apps in a source
// (supabase/functions/ios-source) that SideStore, AltStore and Feather install from, and links
// IPAs for TrollStore and for signing with your own certificate. See the guide on /download.
import { Linking } from 'react-native';

/** ArkStore's AltStore-format source: every iOS app ArkStore lists, updated with each release. */
export const IOS_SOURCE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://not-configured.supabase.co'}/functions/v1/ios-source`;

const enc = encodeURIComponent;

/** One tap adds ArkStore's source in these apps. */
export const addSourceLink = {
  sidestore: `sidestore://source?url=${enc(IOS_SOURCE_URL)}`,
  altstore: `altstore://source?url=${enc(IOS_SOURCE_URL)}`,
};

/** TrollStore's own URL scheme: installs an IPA from a link, permanently. */
export const trollStoreInstallLink = (ipaUrl: string) => `apple-magnifier://install?url=${enc(ipaUrl)}`;

export const IOS_LINKS = {
  sidestoreDocs: 'https://docs.sidestore.io',
  sidestore: 'https://sidestore.io',
  iloader: 'https://github.com/nab138/iloader',
  trollstore: 'https://github.com/opa334/TrollStore',
  trollstoreCompat: 'https://ios.cfw.guide/installing-trollstore/',
  feather: 'https://github.com/khcrysalis/Feather',
  appleDeveloper: 'https://developer.apple.com/programs/',
};

/** Opens a deep link into another app; resolves false when that app isn't installed. */
export async function openInApp(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** An iPhone or iPad browser (iPadOS Safari says "Macintosh" but has a touch screen). */
export function isIPhoneBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && ((navigator as { maxTouchPoints?: number }).maxTouchPoints ?? 0) > 1);
}
