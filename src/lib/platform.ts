// Which store this is: Android on phones, Windows / macOS / Linux in the desktop app.
// In a browser nothing is filtered; builds are picked for the visitor's computer or phone.
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { desktop } from './desktop';
import type { Arch, StoreOS } from './github/assets';

/** The platform whose apps the catalog shows, or null to show everything (browsers, iOS). */
export function catalogOS(): StoreOS | null {
  if (desktop) return desktop.os;
  if (Platform.OS === 'android') return 'android';
  return null;
}

export type Visitor = { os: StoreOS | 'ios' | null; arch: Arch | null; label: string };

/** Best guess at the browser's device, from the user agent. */
export function detectVisitor(ua: string, platformHint = ''): Visitor {
  const s = `${ua} ${platformHint}`;
  if (/android/i.test(s)) return { os: 'android', arch: /arm64|aarch64/i.test(s) ? 'arm64' : null, label: 'Android' };
  if (/iphone|ipad|ipod/i.test(s)) return { os: 'ios', arch: 'arm64', label: 'iPhone or iPad' };
  if (/windows/i.test(s)) {
    // Browsers on Windows on Arm often still say x64; getHighEntropyValues() refines it.
    return { os: 'windows', arch: /arm64|aarch64/i.test(s) ? 'arm64' : 'x64', label: 'Windows' };
  }
  if (/mac os x|macintosh|macos/i.test(s)) {
    // Safari and Chrome both report "Intel" on Apple silicon; getHighEntropyValues() refines it.
    return { os: 'macos', arch: null, label: 'Mac' };
  }
  if (/cros/i.test(s)) return { os: 'linux', arch: /aarch64|arm/i.test(s) ? 'arm64' : 'x64', label: 'Chromebook (Linux)' };
  if (/linux|x11|ubuntu|fedora/i.test(s)) {
    return { os: 'linux', arch: /aarch64|arm64/i.test(s) ? 'arm64' : /armv7|armhf/i.test(s) ? 'armv7' : 'x64', label: 'Linux' };
  }
  return { os: null, arch: null, label: 'this device' };
}

type UAData = {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string; platform?: string }>;
};

/** The device this runs on. Exact in the apps; a user-agent guess (refined where Chromium allows) in browsers. */
export async function currentDevice(): Promise<Visitor> {
  if (desktop) return { os: desktop.os, arch: desktop.arch, label: deviceLabel(desktop.os) };
  if (Platform.OS === 'android') {
    const abi = Device.supportedCpuArchitectures?.[0];
    return { os: 'android', arch: abi === 'arm64-v8a' ? 'arm64' : abi === 'armeabi-v7a' ? 'armv7' : abi === 'x86_64' ? 'x64' : null, label: 'Android' };
  }
  if (Platform.OS === 'ios') return { os: 'ios', arch: 'arm64', label: 'iPhone or iPad' };
  if (typeof navigator === 'undefined') return { os: null, arch: null, label: 'this device' };

  const uaData = (navigator as unknown as { userAgentData?: UAData }).userAgentData;
  const guess = detectVisitor(navigator.userAgent, uaData?.platform ?? '');
  if (uaData?.getHighEntropyValues && (guess.os === 'macos' || guess.os === 'windows' || guess.os === 'linux')) {
    try {
      const v = await uaData.getHighEntropyValues(['architecture', 'bitness']);
      if (v.architecture === 'arm') return { ...guess, arch: v.bitness === '32' ? 'armv7' : 'arm64' };
      if (v.architecture === 'x86') return { ...guess, arch: v.bitness === '32' ? 'x86' : 'x64' };
    } catch {
      // Keep the guess.
    }
  }
  if (guess.os === 'macos' && !guess.arch) {
    // Apple silicon Macs expose an Apple GPU through WebGL; Intel Macs don't.
    guess.arch = appleGpu() ? 'arm64' : null;
  }
  return guess;
}

function deviceLabel(os: StoreOS) {
  return os === 'macos' ? 'Mac' : os === 'windows' ? 'Windows PC' : os === 'linux' ? 'Linux computer' : 'Android';
}

function appleGpu(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    return /apple/i.test(renderer) && !/intel/i.test(renderer);
  } catch {
    return false;
  }
}
