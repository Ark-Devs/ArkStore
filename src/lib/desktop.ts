// The bridge the ArkStore desktop app (Electron, see desktop/) exposes to this web UI as
// `window.arkDesktop`. Undefined in browsers and on phones. Keep in sync with desktop/preload.cjs.
import type { Arch, StoreOS } from './github/assets';

export type DesktopOS = Exclude<StoreOS, 'android' | 'ios'>;

export type DesktopDownload = { path: string; size: number };

export type DesktopInstallResult = {
  /** installed: finished and confirmed. handed-off: another installer took over. cancelled: closed early. */
  outcome: 'installed' | 'handed-off' | 'cancelled';
  /** Something ArkStore can open later (an .app, an AppImage, a Start menu shortcut). */
  launchPath?: string | null;
};

export type SelfUpdateStatus =
  | { state: 'idle' | 'checking' | 'none' | 'unsupported' }
  | { state: 'available'; version: string; notes?: string | null }
  | { state: 'downloading'; version: string; progress: number }
  | { state: 'ready'; version: string; notes?: string | null }
  | { state: 'error'; message: string; version?: string };

export type IPhoneDevice = {
  udid: string;
  connection: 'usb' | 'wifi' | 'other';
  /** False until "Trust This Computer" is accepted on the iPhone. */
  trusted: boolean;
  name: string;
  ios: string;
};

export type IPhoneApp = { udid: string; url: string; name: string; iconUrl: string | null; installedAt: string };

/** What ark-sideload reports while it works (see desktop/iphone.cjs). */
export type IPhoneEvent =
  | { event: 'progress'; stage: 'download' | 'signin' | 'sign' | 'transfer' | 'pair' | 'done'; percent: number; name?: string }
  | {
      event: 'twoFactor';
      sms: boolean;
      unknown: boolean;
      numbers: { id: number; number: string }[];
      selected: number | null;
      lastError: string | null;
    }
  | { event: 'maxCerts'; certs: { serial: string | null; name: string | null; machine: string | null; expires: string | null }[] }
  | { event: 'refreshed'; refreshed: number; failed: string[] };

export type IPhoneAnswer =
  | { action: 'code'; code: string }
  | { action: 'sms'; id: number }
  | { action: 'devices' | 'resend' | 'abort' }
  | { revoke: string[] };

export type IPhoneBridge = {
  /**
   * On the iPhone itself (src/lib/ios-sideload.ts) the one device is the iPhone, and `problem`
   * says why it can't be reached: no pairing file yet, or LocalDevVPN not connected.
   */
  devices: () => Promise<{ driver: boolean; devices: IPhoneDevice[]; problem?: 'no-pairing' | 'vpn'; message?: string }>;
  account: () => Promise<{ email: string | null; remembered: boolean; canRemember: boolean; apps: IPhoneApp[] }>;
  signIn: (email: string, password: string, remember: boolean) => Promise<{ team: { id: string; name: string | null } | null }>;
  signOut: () => Promise<void>;
  /** Password only when it isn't remembered. */
  /** pairFor 'com.arkdevs.arkstore' (ArkStore itself) also sets it up to renew apps on the iPhone. */
  install: (target: { udid: string; url: string; name: string; iconUrl?: string | null; pairFor?: string }, password?: string) => Promise<void>;
  refresh: () => Promise<{ refreshed: number; failed?: string[]; needsPassword?: boolean }>;
  forgetApp: (udid: string, url: string) => Promise<void>;
  answer: (answer: IPhoneAnswer) => void;
  cancel: () => Promise<void>;
  devMode: (udid: string) => Promise<{ enabled: boolean }>;
  /** Windows: installs Apple's device driver (iTunes) or opens the Apple Devices app's page. */
  installDriver: () => Promise<'installed' | 'opened' | 'linux' | 'none'>;
  onEvent: (cb: (e: IPhoneEvent) => void) => () => void;
};

export type DesktopBridge = {
  os: DesktopOS;
  arch: Arch;
  /** 'deb' on Debian / Ubuntu, 'rpm' on Fedora / openSUSE, null elsewhere. */
  linuxPackage: 'deb' | 'rpm' | null;
  hostname: string;
  osVersion: string;
  appVersion: string;

  download: (id: string, url: string, fileName: string) => Promise<DesktopDownload | null>;
  cancelDownload: (id: string) => Promise<void>;
  onDownloadProgress: (cb: (id: string, received: number, total: number) => void) => () => void;
  install: (path: string, info: { name: string; iconUrl: string | null }) => Promise<DesktopInstallResult>;
  exists: (path: string) => Promise<boolean>;
  remove: (path: string) => Promise<void>;
  launch: (path: string) => Promise<boolean>;

  openExternal: (url: string) => Promise<void>;
  notify: (title: string, body: string, url?: string) => void;
  /** arkstore:// links (sign-in callbacks) and notification clicks. */
  onOpenUrl: (cb: (url: string) => void) => () => void;

  /** Missing in ArkStore builds from before 1.3. */
  iphone?: IPhoneBridge;

  update: {
    check: () => Promise<void>;
    download: () => Promise<void>;
    install: () => void;
    status: () => Promise<SelfUpdateStatus>;
    onStatus: (cb: (s: SelfUpdateStatus) => void) => () => void;
  };
};

export const desktop: DesktopBridge | undefined =
  typeof window !== 'undefined' ? (window as unknown as { arkDesktop?: DesktopBridge }).arkDesktop : undefined;

export const isDesktop = Boolean(desktop);

// One subscription to the bridge, shared: links that arrive while the app is still starting
// (a sign-in callback or a notification click that launched it) are replayed to handlers
// that subscribe a few seconds later.
const urlHandlers = new Set<(url: string) => void>();
const recentUrls: { url: string; at: number }[] = [];
let subscribed = false;

export function onDesktopUrl(cb: (url: string) => void): () => void {
  if (!desktop) return () => undefined;
  if (!subscribed) {
    subscribed = true;
    desktop.onOpenUrl((url) => {
      recentUrls.push({ url, at: Date.now() });
      if (recentUrls.length > 10) recentUrls.shift();
      urlHandlers.forEach((h) => h(url));
    });
  }
  urlHandlers.add(cb);
  for (const r of recentUrls) if (Date.now() - r.at < 15_000) cb(r.url);
  return () => urlHandlers.delete(cb);
}
