// ArkStore on iPhone installs and renews apps by itself, with the person's own Apple Account and
// no computer after the first setup. It signs apps with the installer in sideload/ (Rust, through
// modules/ark-sideload) and installs them on this same iPhone: LocalDevVPN routes its connection
// back to the iPhone's own lockdownd, which accepts it with the pairing file ArkStore on a
// computer left in ArkStore's Documents during the first setup.
//
// This is the same IPhoneBridge the desktop app provides (desktop/iphone.cjs), so /iphone works
// on both. The Apple Account password is kept in the iOS Keychain only when the person asks.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { arkSideload } from '../../modules/ark-sideload';
import type { IPhoneAnswer, IPhoneApp, IPhoneBridge, IPhoneDevice, IPhoneEvent } from './desktop';
import { readExpiry } from './ios-expiry';
import { fetchLatestArkStore } from './self-update';

/** LocalDevVPN's address for the iPhone itself. */
const SELF_IP = '10.7.0.1';
const PAIRING_FILE = 'ArkStorePairing.plist';
const STATE_KEY = 'arkstore.iphone.state';
const PASSWORD_KEY = 'arkstore.iphone.password';
const SELF_ID = 'self';
const DAY = 24 * 60 * 60 * 1000;
const RENEW_AFTER = 4 * DAY;

type State = { email: string | null; apps: IPhoneApp[] };

const path = (d: Directory | File) => decodeURI(d.uri.replace(/^file:\/\//, ''));
const dataDir = () => {
  const d = new Directory(Paths.document, 'sideload');
  if (!d.exists) d.create({ intermediates: true });
  return path(d);
};
const pairingFile = () => new File(Paths.document, PAIRING_FILE);
const target = () => ({ ip: SELF_IP, pairingFile: path(pairingFile()) });

async function readState(): Promise<State> {
  try {
    return { email: null, apps: [], ...JSON.parse((await AsyncStorage.getItem(STATE_KEY)) ?? '{}') };
  } catch {
    return { email: null, apps: [] };
  }
}
const writeState = (s: State) => AsyncStorage.setItem(STATE_KEY, JSON.stringify(s));
const savedPassword = () => SecureStore.getItemAsync(PASSWORD_KEY).catch(() => null);

const listeners = new Set<(e: IPhoneEvent) => void>();
const send = (e: IPhoneEvent) => listeners.forEach((l) => l(e));
let current: number | null = null;

const FINAL = ['done', 'devices', 'devmode', 'signedIn', 'paired', 'pong'];

/** Runs one installer job; resolves with its final event. Questions go to the listeners. */
function run(command: string, request: object, { quiet = false } = {}): Promise<Record<string, unknown>> {
  if (!arkSideload) return Promise.reject(new Error('This ArkStore build for iPhone has no installer.'));
  const native = arkSideload;
  if (current !== null && command !== 'ping') return Promise.reject(new Error('ArkStore is already installing something.'));
  return new Promise((resolve, reject) => {
    const job = native.start(command, JSON.stringify(request));
    if (command !== 'ping') current = job;
    let result: Record<string, unknown> | null = null;
    let error: string | null = null;
    const timer = setInterval(() => {
      for (let raw = native.next(job); raw; raw = native.next(job)) {
        const e = JSON.parse(raw) as Record<string, unknown> & { event: string };
        if (e.event === 'end') {
          clearInterval(timer);
          if (current === job) current = null;
          if (result && e.ok) resolve(result);
          else reject(new Error(friendly(error ?? 'The installer stopped.')));
          return;
        }
        if (e.event === 'error') error = String(e.message ?? '');
        else if (FINAL.includes(e.event)) result = e;
        else if (!quiet || e.event === 'progress') send(e as unknown as IPhoneEvent);
        if (quiet && (e.event === 'twoFactor' || e.event === 'maxCerts')) native.cancel(job);
      }
    }, 120);
  });
}

/** Apple's and the iPhone's errors, as something a person can act on (see desktop/iphone.cjs). */
function friendly(message: string): string {
  const m = String(message);
  const last = m.split('\n').filter(Boolean).pop() || m;
  if (/-20101|incorrect|invalid.*(password|credentials)/i.test(m)) return 'Wrong Apple Account email or password.';
  if (/-22421|-22411|too many/i.test(m)) return 'Apple is limiting sign-ins for this account right now. Wait an hour and try again.';
  if (/maximum.*app id|app id limit|-7011/i.test(m))
    return 'Your free Apple Account can register 10 new apps a week, and that limit is reached. It resets within 7 days; apps you already have can still be renewed.';
  if (/3 apps|maximum number of (installed )?apps/i.test(m)) return 'A free Apple Account can have 3 apps signed this way at a time. Delete one and try again.';
  if (/Connect LocalDevVPN|timed out|Connection refused|os error 6[01]/i.test(m)) return 'Connect LocalDevVPN (open it and tap Connect), then try again.';
  if (/pairing file/i.test(m)) return last;
  if (/Cancelled/.test(m)) return 'Cancelled.';
  return last;
}

async function downloadIpa(url: string): Promise<string> {
  const dir = new Directory(Paths.cache, 'ipas');
  if (!dir.exists) dir.create({ intermediates: true });
  let hash = 0;
  for (const ch of url) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const file = new File(dir, `${(hash >>> 0).toString(16)}.ipa`);
  if (!file.exists) {
    send({ event: 'progress', stage: 'download', percent: 0 });
    await File.downloadFileAsync(url, file, { idempotent: true });
  }
  return path(file);
}

async function installApp(app: { url: string; name: string; iconUrl?: string | null }, password: string, quiet = false) {
  const s = await readState();
  if (!s.email) throw new Error('Sign in with your Apple Account first.');
  const ipa = await downloadIpa(app.url);
  await run('install', { target: target(), email: s.email, password, ipa, dataDir: dataDir(), machineName: 'ArkStore on iPhone' }, { quiet });
  const next = await readState();
  next.apps = next.apps.filter((a) => a.url !== app.url);
  next.apps.push({ udid: SELF_ID, url: app.url, name: app.name, iconUrl: app.iconUrl ?? null, installedAt: new Date().toISOString() });
  await writeState(next);
}

/**
 * Renews apps with 3 days or less left (or all, when forced). ArkStore itself goes last: iOS
 * closes an app while it's being replaced.
 */
async function renew(force: boolean): Promise<{ refreshed: number; failed?: string[]; needsPassword?: boolean }> {
  const s = await readState();
  const password = await savedPassword();
  const due = s.apps
    .filter((a) => force || Date.now() - Date.parse(a.installedAt) > RENEW_AFTER)
    .sort((a, b) => Number(a.name === 'ArkStore') - Number(b.name === 'ArkStore'));
  if (!due.length) return { refreshed: 0 };
  if (!password) return { refreshed: 0, needsPassword: true };
  let refreshed = 0;
  const failed: string[] = [];
  for (const a of due) {
    try {
      await installApp(a, password, !force);
      refreshed++;
    } catch (e) {
      failed.push(`${a.name}: ${(e as Error).message}`);
    }
  }
  send({ event: 'refreshed', refreshed, failed });
  return { refreshed, failed };
}

export const iphoneLocal: IPhoneBridge | undefined =
  Platform.OS === 'ios' && arkSideload
    ? {
        async devices() {
          if (!pairingFile().exists) return { driver: true, devices: [], problem: 'no-pairing' as const };
          try {
            const r = await run('ping', { target: target() });
            const me: IPhoneDevice = { udid: SELF_ID, connection: 'other', trusted: true, name: String(r.name ?? 'This iPhone'), ios: String(r.ios ?? '') };
            return { driver: true, devices: [me] };
          } catch (e) {
            return { driver: true, devices: [], problem: 'vpn' as const, message: (e as Error).message };
          }
        },
        async account() {
          const s = await readState();
          return { email: s.email, remembered: Boolean(await savedPassword()), canRemember: true, apps: s.apps };
        },
        async signIn(email, password, remember) {
          const r = await run('signin', { email: email.trim(), password, dataDir: dataDir() });
          const s = await readState();
          if (s.email !== email.trim()) s.apps = [];
          s.email = email.trim();
          await writeState(s);
          if (remember) await SecureStore.setItemAsync(PASSWORD_KEY, password);
          else await SecureStore.deleteItemAsync(PASSWORD_KEY).catch(() => undefined);
          return { team: (r.team as { id: string; name: string | null } | null) ?? null };
        },
        async signOut() {
          await AsyncStorage.removeItem(STATE_KEY);
          await SecureStore.deleteItemAsync(PASSWORD_KEY).catch(() => undefined);
          const d = new Directory(Paths.document, 'sideload');
          if (d.exists) d.delete();
        },
        async install(t, password) {
          const pw = password || (await savedPassword());
          if (!pw) throw new Error('Enter your Apple Account password.');
          await installApp({ url: t.url, name: t.name, iconUrl: t.iconUrl }, pw);
        },
        refresh: () => renew(true),
        async forgetApp(_udid, url) {
          const s = await readState();
          s.apps = s.apps.filter((a) => a.url !== url);
          await writeState(s);
        },
        answer(answer: IPhoneAnswer) {
          if (current !== null) arkSideload!.answer(current, JSON.stringify(answer));
        },
        async cancel() {
          if (current !== null) arkSideload!.cancel(current);
        },
        // Developer Mode is already on: ArkStore itself wouldn't open otherwise.
        devMode: async () => ({ enabled: true }),
        installDriver: async () => 'none' as const,
        onEvent(cb) {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      }
    : undefined;

/**
 * Keeps ArkStore itself in the renew list: it was installed by a computer (or SideStore), so its
 * install date is its signature's expiry minus 7 days, and its IPA is the newest release's.
 */
async function trackSelf() {
  const expiry = readExpiry();
  if (!expiry) return;
  const installedAt = new Date(expiry.getTime() - 7 * DAY);
  const s = await readState();
  const mine = s.apps.find((a) => a.name === 'ArkStore');
  if (mine && Date.parse(mine.installedAt) >= installedAt.getTime() - 60_000) return;
  const release = await fetchLatestArkStore().catch(() => null);
  const ipa = release?.files.find((f) => f.os === 'ios' && /\.ipa$/i.test(f.name));
  if (!ipa) return;
  s.apps = s.apps.filter((a) => a.name !== 'ArkStore');
  s.apps.push({ udid: SELF_ID, url: ipa.url, name: 'ArkStore', iconUrl: 'https://github.com/Ark-Devs.png', installedAt: installedAt.toISOString() });
  await writeState(s);
}

let lastAuto = 0;

/**
 * Each time ArkStore comes to the foreground (at most every 30 minutes): renews what has 3 days
 * or less left, quietly, when LocalDevVPN is connected and the password is remembered.
 */
export async function renewIfDue() {
  if (!iphoneLocal || current !== null || Date.now() - lastAuto < 30 * 60 * 1000) return;
  lastAuto = Date.now();
  await trackSelf().catch(() => undefined);
  if (!pairingFile().exists) return;
  await renew(false).catch(() => undefined);
}
