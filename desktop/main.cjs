// ArkStore for Windows, macOS and Linux: the ArkStore web UI (Expo's web build, copied into
// ./web) in an Electron window, plus what a browser can't do: download installers and run
// them, open installed apps, sign-in links, notifications, and updating ArkStore itself.
// The renderer reaches all of it through window.arkDesktop (preload.cjs).
const { app, BrowserWindow, ipcMain, Notification, net, protocol, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const installer = require('./installer.cjs');

const WEB_DIR = path.join(__dirname, 'web');
const APP_ORIGIN = 'app://arkstore';
// `npm run dev` points the window at the Expo dev server (npx expo start --web).
const DEV_URL = process.env.ARKSTORE_DEV_URL || null;
const PROTOCOL = 'arkstore';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;
let rendererListening = false;
const pendingUrls = [];

const installersDir = () => {
  const dir = path.join(app.getPath('userData'), 'installers');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const inside = (dir, p) => {
  const rel = path.relative(dir, path.resolve(p));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

function focus() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** arkstore:// links and notification targets go to the renderer once it listens. */
function openUrl(url) {
  if (!url) return;
  if (win && rendererListening) win.webContents.send('open-url', url);
  else pendingUrls.push(url);
  focus();
}

// ---------------------------------------------------------------------------
// One window, one instance, arkstore:// links
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  // Windows and Linux start a second copy with the link in argv; macOS sends open-url.
  app.on('second-instance', (_event, argv) => openUrl(argv.find((a) => a.startsWith(`${PROTOCOL}://`))));
  app.on('open-url', (event, url) => {
    event.preventDefault();
    openUrl(url);
  });
  const launchUrl = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (launchUrl) pendingUrls.push(launchUrl);

  app.whenReady().then(() => {
    serveWebBuild();
    createWindow();
    setupUpdates();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

/** app://arkstore/... serves the web build, falling back to index.html for app routes. */
function serveWebBuild() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    let file = path.join(WEB_DIR, decodeURIComponent(pathname));
    if (!file.startsWith(WEB_DIR)) return new Response('Not found', { status: 404 });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIR, 'index.html');
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  rendererListening = false;
  win = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 420,
    minHeight: 600,
    title: 'ArkStore',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  const home = DEV_URL || `${APP_ORIGIN}/`;
  const isOwn = (url) => url.startsWith(APP_ORIGIN) || (DEV_URL && url.startsWith(DEV_URL));
  const external = (url) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
  };

  // Links to GitHub, developer sites etc. open in the browser, never inside ArkStore.
  win.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isOwn(url)) {
      event.preventDefault();
      external(url);
    }
  });
  win.on('closed', () => {
    win = null;
    rendererListening = false;
  });

  win.loadURL(home);
}

// ---------------------------------------------------------------------------
// About this computer
// ---------------------------------------------------------------------------

function machine() {
  const osName = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform] || 'linux';
  // An Intel build running through Rosetta should still pick Apple silicon downloads.
  const arm = process.arch === 'arm64' || app.runningUnderARM64Translation;
  const arch = arm ? 'arm64' : { x64: 'x64', ia32: 'x86', arm: 'armv7' }[process.arch] || 'x64';
  return {
    os: osName,
    arch,
    linuxPackage: installer.linuxPackageFormat(),
    hostname: os.hostname().replace(/\.local$/, '').slice(0, 80),
    osVersion: installer.osVersion(),
    appVersion: app.getVersion(),
  };
}

ipcMain.on('machine', (event) => {
  event.returnValue = machine();
});

// ---------------------------------------------------------------------------
// Downloads and installs
// ---------------------------------------------------------------------------

const downloads = new Map();

ipcMain.handle('download', async (event, id, url, fileName) => {
  if (!/^https:\/\//i.test(url)) throw new Error('Only https downloads are allowed.');
  const safe = String(fileName).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);
  const dest = path.join(installersDir(), safe);
  const part = `${dest}.part`;
  const controller = new AbortController();
  downloads.get(id)?.abort();
  downloads.set(id, controller);

  try {
    const res = await net.fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`The download failed (HTTP ${res.status}).`);
    const total = Number(res.headers.get('content-length') || 0);
    const out = fs.createWriteStream(part);
    let received = 0;
    let lastReport = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      if (Date.now() - lastReport > 150) {
        lastReport = Date.now();
        if (!event.sender.isDestroyed()) event.sender.send('download-progress', id, received, total);
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    fs.renameSync(part, dest);
    if (!event.sender.isDestroyed()) event.sender.send('download-progress', id, received, total || received);
    return { path: dest, size: received };
  } catch (e) {
    fs.rmSync(part, { force: true });
    if (controller.signal.aborted) return null;
    throw e;
  } finally {
    if (downloads.get(id) === controller) downloads.delete(id);
  }
});

ipcMain.handle('cancel-download', (_event, id) => {
  downloads.get(id)?.abort();
});

ipcMain.handle('install', async (_event, file, info) => {
  if (!inside(installersDir(), file)) throw new Error('ArkStore only runs installers it downloaded.');
  const result = await installer.install(path.resolve(file), {
    name: String(info?.name || 'App').slice(0, 60),
    iconUrl: typeof info?.iconUrl === 'string' ? info.iconUrl : null,
  });
  return { outcome: result.outcome, launchPath: result.launchPath || null };
});

ipcMain.handle('exists', (_event, p) => typeof p === 'string' && fs.existsSync(p));

ipcMain.handle('remove', (_event, p) => {
  if (typeof p === 'string' && inside(installersDir(), p)) fs.rmSync(p, { force: true });
});

ipcMain.handle('launch', (_event, p) => (typeof p === 'string' ? installer.launch(p) : false));

ipcMain.handle('open-external', (_event, url) => {
  if (/^(https?|mailto):/i.test(url)) return shell.openExternal(url);
});

ipcMain.on('open-url-ready', () => {
  rendererListening = true;
  while (pendingUrls.length) win?.webContents.send('open-url', pendingUrls.shift());
});

ipcMain.on('notify', (_event, title, body, url) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: String(title), body: String(body || '') });
  n.on('click', () => openUrl(url || '/updates'));
  n.show();
});

// ---------------------------------------------------------------------------
// ArkStore updating itself (electron-updater, from ArkStore's GitHub releases)
// ---------------------------------------------------------------------------

let updateStatus = { state: 'idle' };
let latestVersion = null;

function setUpdateStatus(status) {
  updateStatus = status;
  win?.webContents.send('update-status', status);
}

const notesText = (notes) =>
  Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n\n') : typeof notes === 'string' ? notes : null;

function updatesSupported() {
  if (!app.isPackaged || DEV_URL) return false;
  // Microsoft Store installs are updated by the Store.
  if (process.windowsStore) return false;
  // On Linux only the AppImage and the .deb / .rpm packages can replace themselves.
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE) || installer.linuxPackageFormat() !== null;
  return true;
}

function setupUpdates() {
  if (!updatesSupported()) {
    updateStatus = { state: 'unsupported' };
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => setUpdateStatus({ state: 'none' }));
  autoUpdater.on('update-available', (info) => {
    latestVersion = info.version;
    setUpdateStatus({ state: 'available', version: info.version, notes: notesText(info.releaseNotes) });
  });
  autoUpdater.on('download-progress', (p) =>
    setUpdateStatus({ state: 'downloading', version: latestVersion || '', progress: Math.min(1, (p.percent || 0) / 100) }),
  );
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateStatus({ state: 'ready', version: info.version, notes: notesText(info.releaseNotes) });
    if (Notification.isSupported()) {
      const n = new Notification({ title: `ArkStore ${info.version} is ready`, body: 'Restart ArkStore to finish updating.' });
      n.on('click', () => openUrl('/updates'));
      n.show();
    }
  });
  // Unsigned macOS builds can't replace themselves, for example: the app offers the download page.
  autoUpdater.on('error', (err) => setUpdateStatus({ state: 'error', message: String(err?.message || err), version: latestVersion || undefined }));

  let lastCheck = 0;
  const check = () => {
    lastCheck = Date.now();
    autoUpdater.checkForUpdates().catch(() => undefined);
  };
  setTimeout(check, 10_000);
  setInterval(check, 6 * 60 * 60 * 1000);
  // Coming back to ArkStore picks up a release published since, at most once an hour.
  app.on('browser-window-focus', () => {
    if (Date.now() - lastCheck > 60 * 60 * 1000) check();
  });
}

ipcMain.handle('update-status', () => updateStatus);
ipcMain.handle('update-check', () => (updatesSupported() ? autoUpdater.checkForUpdates().then(() => undefined) : undefined));
ipcMain.handle('update-download', () => (updatesSupported() ? autoUpdater.downloadUpdate().then(() => undefined) : undefined));
ipcMain.on('update-install', () => {
  if (updateStatus.state === 'ready') autoUpdater.quitAndInstall();
});
