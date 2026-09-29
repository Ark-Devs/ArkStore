// iPhone: ArkStore installs iPhone apps itself, signed with the person's own free Apple Account,
// over USB (or Wi-Fi once the iPhone has been set up for it). No SideStore, AltServer or iloader.
// The work is done by ark-sideload (sideload/, Rust), run once per job; this file runs it,
// relays its questions (two-factor code, which certificate to replace) to the window, keeps the
// Apple Account password encrypted with the operating system's keychain (safeStorage) when the
// person asks it to, and re-signs installed apps before their 7 days run out.
const { app, ipcMain, net, safeStorage, shell, Notification } = require('electron');
const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REFRESH_AFTER = 4 * 24 * 60 * 60 * 1000; // free-account signatures last 7 days
const REFRESH_CHECK_EVERY = 20 * 60 * 1000;

let getWindow = () => null;
let job = null; // { id, child, background }

const dataDir = () => path.join(app.getPath('userData'), 'iphone');
const stateFile = () => path.join(dataDir(), 'state.json');
const ipaDir = () => path.join(dataDir(), 'apps');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { email: null, password: null, apps: [] };
  }
}

function writeState(state) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), { mode: 0o600 });
}

function savedPassword(state) {
  if (!state.password || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(state.password, 'base64'));
  } catch {
    return null;
  }
}

function sidecar() {
  const exe = process.platform === 'win32' ? 'ark-sideload.exe' : 'ark-sideload';
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'sideload', exe)]
    : ['release', 'debug'].map((p) => path.join(__dirname, '..', 'sideload', 'target', p, exe));
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('The iPhone installer is missing from this ArkStore build.');
  return found;
}

const send = (event) => {
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send('iphone-event', event);
};

/**
 * Runs one ark-sideload command. Resolves with the final event (done / devices / ...), rejects
 * with its error message. `onEvent` sees progress and questions.
 */
function run(command, request, { onEvent = () => {}, background = false } = {}) {
  if (job && command !== 'devices') throw new Error('ArkStore is already installing something on the iPhone.');
  return new Promise((resolve, reject) => {
    const child = spawn(sidecar(), [command], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const id = crypto.randomUUID();
    if (command !== 'devices') job = { id, child, background };
    let result = null;
    let error = null;
    let stderr = '';
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.event === 'error') error = event.message;
        else if (['done', 'devices', 'devmode', 'signedIn', 'paired', 'pong'].includes(event.event)) result = event;
        else onEvent(event);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-20000);
    });
    // The installer couldn't start at all (missing, or blocked by antivirus).
    child.on('error', (e) => reject(new Error(`Couldn't start ArkStore's iPhone installer.${DETAILS}${e.message}`)));
    child.on('close', (code) => {
      if (job?.id === id) job = null;
      if (result && code === 0) return resolve(result);
      const log = path.join(dataDir(), 'last-error.log');
      try {
        fs.mkdirSync(dataDir(), { recursive: true });
        fs.writeFileSync(log, `${command} failed (exit ${code})\n${error || ''}\n\n${stderr}`);
      } catch {}
      // Crashed before it could report an error: its last log lines are the best explanation.
      const tail = stderr.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-8).join('\n');
      const detail = error || tail || `The iPhone installer stopped (exit ${code}).`;
      reject(new Error(`${friendly(error || `The iPhone installer stopped (exit ${code}).`)}${DETAILS}${detail}`));
    });
    child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

/** Separates the sentence shown in the app from the full error behind "Show details". */
const DETAILS = '\n\n--- details ---\n';

/** Apple's and the device's errors, as something a person can act on. */
function friendly(message) {
  const m = String(message);
  const last = m.split('\n').filter(Boolean).pop() || m;
  const hint = (() => {
    if (/-20101|incorrect|invalid.*(password|credentials)/i.test(m)) return 'Wrong Apple Account email or password.';
    if (/-20209|-20283|account.{0,40}locked|locked.{0,40}account|disabled for security/i.test(m))
      return 'Apple has locked this Apple Account for security. Unlock it at iforgot.apple.com, then sign in again.';
    if (/-22421|-22411|too many/i.test(m)) return 'Apple is limiting sign-ins for this account right now. Wait an hour and try again.';
    if (/anisette/i.test(m)) return "Couldn't reach Apple's sign-in helper servers. Check the internet connection and try again.";
    if (/maximum.*app id|app id limit|-7011/i.test(m)) return 'Your free Apple Account can register 10 new apps a week, and that limit is reached. It resets within 7 days; apps you already have can still be refreshed.';
    if (/3 apps|maximum number of (installed )?apps|ApplicationVerificationFailed.*limit/i.test(m)) return 'A free Apple Account can have 3 apps signed this way on an iPhone. Delete one from the iPhone and try again.';
    // The iPhone itself: its lock screen, or "Trust This Computer" not accepted yet.
    if (/PasswordProtected|device is locked|DeviceLocked/i.test(m)) return 'Unlock the iPhone and try again.';
    if (/InvalidHostID|PairingDialogResponsePending|UserDeniedPairing|not paired/i.test(m)) return 'Unlock the iPhone and tap Trust when it asks about this computer, then try again.';
    if (/Cancelled/.test(m)) return 'Cancelled.';
    return null;
  })();
  // Apple's own words stay visible, so an unexpected error can still be diagnosed.
  return hint && hint !== 'Cancelled.' && last !== hint ? `${hint} (${last})` : hint || last;
}

async function fetchIpa(url) {
  if (!/^https:\/\//i.test(url)) throw new Error('Only https downloads are allowed.');
  fs.mkdirSync(ipaDir(), { recursive: true });
  const name = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  const dest = path.join(ipaDir(), `${name}.ipa`);
  if (fs.existsSync(dest)) return dest;
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error(`The download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length') || 0);
  const part = `${dest}.part`;
  const out = fs.createWriteStream(part);
  const reader = res.body.getReader();
  let received = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (!out.write(value)) await new Promise((r) => out.once('drain', r));
    if (total && Date.now() - last > 200) {
      last = Date.now();
      send({ event: 'progress', stage: 'download', percent: Math.round((received / total) * 100) });
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  fs.renameSync(part, dest);
  return dest;
}

// ArkStore itself: after installing it, the desktop app also sets it up to install and renew
// apps on the iPhone without a computer (pairing file in its Documents; see sideload/src/lib.rs).
const ARKSTORE_BUNDLE_ID = 'com.arkdevs.arkstore';

/** Signs and installs one app. Used by the window and by the background refresh. */
async function installApp({ udid, url, name, iconUrl, pairFor }, { email, password, background = false }) {
  const ipa = await fetchIpa(url);
  const onEvent = (event) => {
    if (background && (event.event === 'twoFactor' || event.event === 'maxCerts')) {
      // Nobody is looking: stop, and ask the person to finish it in the window.
      job?.child.stdin.end();
      return;
    }
    send({ ...event, name });
  };
  await run(
    'install',
    {
      target: { udid },
      email,
      password,
      ipa,
      dataDir: path.join(dataDir(), 'account'),
      machineName: `ArkStore on ${os.hostname().replace(/\.local$/, '').slice(0, 30)}`,
      pairFor: pairFor === ARKSTORE_BUNDLE_ID ? pairFor : undefined,
    },
    { onEvent, background },
  );
  const state = readState();
  state.apps = (state.apps || []).filter((a) => !(a.udid === udid && a.url === url));
  state.apps.push({ udid, url, name, iconUrl: iconUrl || null, pairFor: pairFor || null, installedAt: new Date().toISOString() });
  writeState(state);
}

// ---------------------------------------------------------------------------
// Background refresh: re-sign apps before their 7 days run out, whenever the iPhone is
// connected by USB or reachable over Wi-Fi.
// ---------------------------------------------------------------------------

async function refreshDue({ force = false } = {}) {
  if (job) return { refreshed: 0 };
  const state = readState();
  const password = savedPassword(state);
  if (!state.email || !password) return { refreshed: 0, needsPassword: (state.apps || []).length > 0 };
  const due = (state.apps || []).filter((a) => force || Date.now() - Date.parse(a.installedAt) > REFRESH_AFTER);
  if (!due.length) return { refreshed: 0 };
  let present;
  try {
    present = new Set((await run('devices', {})).devices.filter((d) => d.trusted).map((d) => d.udid));
  } catch {
    return { refreshed: 0 };
  }
  let refreshed = 0;
  const failed = [];
  for (const a of due.filter((x) => present.has(x.udid))) {
    try {
      await installApp(a, { email: state.email, password, background: !force });
      refreshed++;
    } catch (e) {
      failed.push(`${a.name}: ${e.message.split(DETAILS)[0]}`);
    }
  }
  if (failed.length && Notification.isSupported()) {
    new Notification({ title: 'iPhone apps need a refresh', body: `Open ArkStore > iPhone. ${failed[0]}` }).show();
  }
  send({ event: 'refreshed', refreshed, failed });
  return { refreshed, failed };
}

// ---------------------------------------------------------------------------
// Windows / Linux: Apple's device service
// ---------------------------------------------------------------------------

function installDriver() {
  if (process.platform === 'win32') {
    // iTunes from Apple brings the Apple Mobile Device service. winget is on Windows 10 1809+ / 11.
    return new Promise((resolve) => {
      execFile(
        'winget',
        ['install', '-e', '--id', 'Apple.iTunes', '--accept-package-agreements', '--accept-source-agreements', '--silent'],
        { windowsHide: true, timeout: 20 * 60 * 1000 },
        (err) => {
          if (!err) return resolve('installed');
          shell.openExternal('https://apps.microsoft.com/detail/9np83lwlpz9k'); // Apple Devices
          resolve('opened');
        },
      );
    });
  }
  if (process.platform === 'linux') return Promise.resolve('linux');
  return Promise.resolve('none');
}

// ---------------------------------------------------------------------------

function register(windowGetter) {
  getWindow = windowGetter;

  ipcMain.handle('iphone-devices', () => run('devices', {}).then((r) => ({ driver: r.driver, devices: r.devices, message: r.error || undefined })));

  ipcMain.handle('iphone-account', () => {
    const s = readState();
    return {
      email: s.email || null,
      remembered: Boolean(savedPassword(s)),
      canRemember: safeStorage.isEncryptionAvailable(),
      apps: s.apps || [],
    };
  });

  ipcMain.handle('iphone-sign-in', async (_e, email, password, remember) => {
    email = String(email || '').trim();
    if (!email || !password) throw new Error('Enter your Apple Account email and password.');
    const r = await run('signin', { email, password, dataDir: path.join(dataDir(), 'account') }, { onEvent: send });
    const s = readState();
    if (s.email !== email) s.apps = [];
    s.email = email;
    s.password = remember && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(password).toString('base64') : null;
    writeState(s);
    return { team: r.team };
  });

  ipcMain.handle('iphone-sign-out', () => {
    fs.rmSync(dataDir(), { recursive: true, force: true });
  });

  ipcMain.handle('iphone-install', async (_e, target, password) => {
    const s = readState();
    const pw = password || savedPassword(s);
    if (!s.email || !pw) throw new Error('Sign in with your Apple Account first.');
    await installApp(
      {
        udid: String(target.udid),
        url: String(target.url),
        name: String(target.name || 'App').slice(0, 60),
        iconUrl: target.iconUrl,
        pairFor: target.pairFor === ARKSTORE_BUNDLE_ID ? ARKSTORE_BUNDLE_ID : undefined,
      },
      { email: s.email, password: pw },
    );
  });

  ipcMain.handle('iphone-refresh', () => refreshDue({ force: true }));
  ipcMain.handle('iphone-forget-app', (_e, udid, url) => {
    const s = readState();
    s.apps = (s.apps || []).filter((a) => !(a.udid === udid && a.url === url));
    writeState(s);
  });

  ipcMain.on('iphone-answer', (_e, answer) => {
    if (job && !job.background) job.child.stdin.write(`${JSON.stringify(answer)}\n`);
  });
  ipcMain.handle('iphone-cancel', () => {
    job?.child.stdin.end();
    job?.child.kill();
  });

  ipcMain.handle('iphone-dev-mode', (_e, udid) => run('devmode', { udid: String(udid) }).then((r) => ({ enabled: r.enabled })));
  ipcMain.handle('iphone-install-driver', () => installDriver());

  setTimeout(() => refreshDue().catch(() => {}), 60 * 1000);
  setInterval(() => refreshDue().catch(() => {}), REFRESH_CHECK_EVERY);
}

module.exports = { register };
