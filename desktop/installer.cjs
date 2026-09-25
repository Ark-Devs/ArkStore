// Runs a downloaded installer the way each platform expects, and finds something ArkStore
// can open afterwards.
//
//   Windows  .exe / .msi run and are waited on (Windows asks for admin rights when the
//            installer needs them); MSIX and ZIP files open in their own handlers.
//   macOS    .dmg / .zip: the .app inside is copied to /Applications (or ~/Applications).
//            .pkg opens in Installer.
//   Linux    AppImage goes to ~/Applications with a menu entry; .deb / .rpm install through
//            the package manager (pkexec asks for the password); Flatpak installs per user.
//
// install() resolves { outcome: 'installed' | 'handed-off' | 'cancelled', launchPath }.
const { shell, net } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, ...opts });
    } catch (e) {
      resolve({ code: -1, stdout, stderr: String(e) });
      return;
    }
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    // Nothing waits on a prompt we can't answer: stdin gets the input, or closes.
    child.stdin?.end(opts.input ?? undefined);
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: String(e) }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

const which = (cmd) =>
  (process.env.PATH || '')
    .split(path.delimiter)
    .map((dir) => path.join(dir, cmd))
    .find((p) => exists(p)) || null;

const slug = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app';

const lower = (name) => name.toLowerCase();

function tail(text) {
  const lines = String(text || '').trim().split('\n');
  return lines.slice(-3).join(' ').slice(0, 300);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

// Start-Process goes through ShellExecute, so installers that need admin rights get the
// usual Windows prompt, and -Wait / ExitCode tell us how it ended.
async function runWindowsInstaller(file, args = []) {
  const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const argList = args.length ? ` -ArgumentList ${args.map(quote).join(',')}` : '';
  const script = `$ErrorActionPreference = 'Stop'; try { $p = Start-Process -FilePath ${quote(file)}${argList} -Wait -PassThru; exit $p.ExitCode } catch { exit 1223 }`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { code } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
  return code;
}

function startMenuDirs() {
  return [
    process.env.APPDATA && path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    process.env.ProgramData && path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ].filter(Boolean);
}

/** The Start menu shortcut an installer created for `appName`, if there is one. */
function findWindowsShortcut(appName) {
  const want = lower(appName).replace(/[^a-z0-9]/g, '');
  if (!want) return null;
  const found = [];
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 2) walk(full, depth + 1);
      else if (e.isFile() && lower(e.name).endsWith('.lnk') && !/uninstall/i.test(e.name)) {
        const base = lower(e.name.slice(0, -4)).replace(/[^a-z0-9]/g, '');
        if (base === want) found.unshift(full);
        else if (base.includes(want) || want.includes(base)) found.push(full);
      }
    }
  };
  for (const dir of startMenuDirs()) walk(dir, 0);
  return found[0] || null;
}

async function installWindows(file, info) {
  const name = lower(file);
  if (name.endsWith('.exe')) {
    const code = await runWindowsInstaller(file);
    if (code !== 0) return { outcome: 'cancelled' };
    return { outcome: 'installed', launchPath: findWindowsShortcut(info.name) };
  }
  if (name.endsWith('.msi')) {
    const code = await runWindowsInstaller('msiexec.exe', ['/i', file]);
    // 3010: installed, restart required. 1602 / 1223: cancelled.
    if (code !== 0 && code !== 3010) return { outcome: 'cancelled' };
    return { outcome: 'installed', launchPath: findWindowsShortcut(info.name) };
  }
  // MSIX / APPX open in App Installer; archives in Explorer.
  const error = await shell.openPath(file);
  if (error) throw new Error(error);
  return { outcome: 'handed-off' };
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

function applicationsDir() {
  try {
    fs.accessSync('/Applications', fs.constants.W_OK);
    return '/Applications';
  } catch {
    const dir = path.join(os.homedir(), 'Applications');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}

function findBundle(dir, ext, depth = 0) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const hit = entries.find((e) => lower(e.name).endsWith(ext) && !e.name.startsWith('.'));
  if (hit) return path.join(dir, hit.name);
  if (depth >= 2) return null;
  for (const e of entries) {
    if (e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.') && !lower(e.name).endsWith('.app')) {
      const inner = findBundle(path.join(dir, e.name), ext, depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

async function copyApp(appPath) {
  const dest = path.join(applicationsDir(), path.basename(appPath));
  fs.rmSync(dest, { recursive: true, force: true });
  const { code, stderr } = await run('ditto', [appPath, dest]);
  if (code !== 0) throw new Error(`Couldn't copy the app into Applications. ${tail(stderr)}`);
  // Downloaded through ArkStore, not a browser: nothing to quarantine, but clear it if set.
  await run('xattr', ['-dr', 'com.apple.quarantine', dest]);
  return dest;
}

async function installMac(file, info, tmp) {
  const name = lower(file);
  if (name.endsWith('.pkg')) {
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
    return { outcome: 'handed-off' };
  }

  if (name.endsWith('.dmg')) {
    const mount = fs.mkdtempSync(path.join(tmp, 'dmg-'));
    // "Y" accepts a license agreement, if the image shows one.
    const attached = await run('hdiutil', ['attach', file, '-nobrowse', '-noautoopen', '-noverify', '-mountpoint', mount], { input: 'Y\n' });
    if (attached.code !== 0) throw new Error(`Couldn't open the disk image. ${tail(attached.stderr)}`);
    try {
      const appPath = findBundle(mount, '.app');
      if (appPath) return { outcome: 'installed', launchPath: await copyApp(appPath) };
      const pkg = findBundle(mount, '.pkg');
      if (pkg) {
        const copy = path.join(path.dirname(file), path.basename(pkg));
        fs.copyFileSync(pkg, copy);
        await shell.openPath(copy);
        return { outcome: 'handed-off' };
      }
      throw new Error(`No app inside ${path.basename(file)}.`);
    } finally {
      await run('hdiutil', ['detach', mount, '-force']);
      fs.rmSync(mount, { recursive: true, force: true });
    }
  }

  // .zip / .tar.*: unpack, then copy the .app.
  const out = fs.mkdtempSync(path.join(tmp, 'unpack-'));
  try {
    const unpacked = name.endsWith('.zip') ? await run('ditto', ['-x', '-k', file, out]) : await run('tar', ['-xf', file, '-C', out]);
    if (unpacked.code !== 0) throw new Error(`Couldn't unpack ${path.basename(file)}. ${tail(unpacked.stderr)}`);
    const appPath = findBundle(out, '.app');
    if (!appPath) throw new Error(`No app inside ${path.basename(file)}.`);
    return { outcome: 'installed', launchPath: await copyApp(appPath) };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

async function saveIcon(iconUrl, key) {
  if (!iconUrl || !/^https:\/\//.test(iconUrl)) return null;
  try {
    const res = await net.fetch(iconUrl);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    const ext = /svg/.test(type) ? 'svg' : /jpe?g/.test(type) ? 'jpg' : /webp/.test(type) ? 'webp' : 'png';
    const dir = path.join(os.homedir(), '.local', 'share', 'icons');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${key}.${ext}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  } catch {
    return null;
  }
}

async function installAppImage(file, info) {
  const key = `arkstore-${slug(info.name)}`;
  const dir = path.join(os.homedir(), 'Applications');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${info.name.replace(/[/\\]/g, '-')}.AppImage`);
  fs.copyFileSync(file, `${dest}.new`);
  fs.chmodSync(`${dest}.new`, 0o755);
  fs.renameSync(`${dest}.new`, dest);

  const icon = await saveIcon(info.iconUrl, key);
  const apps = path.join(os.homedir(), '.local', 'share', 'applications');
  fs.mkdirSync(apps, { recursive: true });
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${info.name}`,
    `Exec="${dest}" %U`,
    `Icon=${icon || 'application-x-executable'}`,
    'Terminal=false',
    'Categories=Utility;',
    'X-ArkStore=true',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(apps, `${key}.desktop`), entry);
  await run('update-desktop-database', [apps]);
  return { outcome: 'installed', launchPath: dest };
}

/** The menu entry a package installed, so OPEN can start it. */
async function packageDesktopFile(file, kind) {
  const listing = kind === 'deb' ? await run('dpkg-deb', ['-c', file]) : await run('rpm', ['-qlp', file]);
  if (listing.code !== 0) return null;
  const match = listing.stdout.match(/(\/usr\/share\/applications\/[^\s]+\.desktop)/) || listing.stdout.match(/\.(\/usr\/share\/applications\/[^\s]+\.desktop)/);
  return match ? match[1].replace(/^\./, '') : null;
}

async function installPackage(file, kind) {
  const pkexec = which('pkexec');
  let cmd = null;
  if (pkexec && kind === 'deb') {
    cmd = which('apt-get') ? ['apt-get', 'install', '-y', '--allow-downgrades', file] : ['dpkg', '-i', file];
  } else if (pkexec && kind === 'rpm') {
    if (which('dnf')) cmd = ['dnf', 'install', '-y', file];
    else if (which('zypper')) cmd = ['zypper', '--non-interactive', 'install', '--allow-unsigned-rpm', file];
    else cmd = ['rpm', '-Uvh', '--replacepkgs', file];
  }
  if (!cmd) {
    // No polkit: let the software center take it.
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
    return { outcome: 'handed-off' };
  }
  const { code, stderr, stdout } = await run(pkexec, cmd);
  // 126: the password prompt was dismissed; 127: not authorized.
  if (code === 126 || code === 127) return { outcome: 'cancelled' };
  if (code !== 0) throw new Error(`The package manager stopped: ${tail(stderr || stdout)}`);
  return { outcome: 'installed', launchPath: await packageDesktopFile(file, kind) };
}

async function installLinux(file, info) {
  const name = lower(file);
  if (name.endsWith('.appimage')) return installAppImage(file, info);
  if (name.endsWith('.deb')) return installPackage(file, 'deb');
  if (name.endsWith('.rpm')) return installPackage(file, 'rpm');
  if (name.endsWith('.flatpak') && which('flatpak')) {
    const { code, stderr } = await run('flatpak', ['install', '--user', '-y', '--noninteractive', file]);
    if (code !== 0) throw new Error(`Flatpak stopped: ${tail(stderr)}`);
    return { outcome: 'installed' };
  }
  // Archives: show the file, the person unpacks it.
  shell.showItemInFolder(file);
  return { outcome: 'handed-off' };
}

// ---------------------------------------------------------------------------

async function install(file, info) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arkstore-'));
  try {
    if (process.platform === 'win32') return await installWindows(file, info);
    if (process.platform === 'darwin') return await installMac(file, info, tmp);
    return await installLinux(file, info);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const LAUNCHABLE = /\.(app|appimage|lnk|desktop)$/i;

/** OPEN: start an app ArkStore installed. */
async function launch(target) {
  if (!LAUNCHABLE.test(target) || !exists(target)) return false;
  if (/\.appimage$/i.test(target)) {
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  if (/\.desktop$/i.test(target)) {
    if (which('gio')) spawn('gio', ['launch', target], { detached: true, stdio: 'ignore' }).unref();
    else spawn('gtk-launch', [path.basename(target, '.desktop')], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  return (await shell.openPath(target)) === '';
}

/** 'deb' on Debian / Ubuntu and friends, 'rpm' on Fedora / openSUSE, null elsewhere. */
function linuxPackageFormat() {
  if (process.platform !== 'linux') return null;
  let release = '';
  try {
    release = fs.readFileSync('/etc/os-release', 'utf8');
  } catch {
    // Fall through to the tools on disk.
  }
  if (/^ID(_LIKE)?=.*\b(debian|ubuntu)\b/m.test(release)) return 'deb';
  if (/^ID(_LIKE)?=.*\b(fedora|rhel|centos|suse|opensuse)\b/m.test(release)) return 'rpm';
  if (exists('/usr/bin/dpkg')) return 'deb';
  if (exists('/usr/bin/rpm')) return 'rpm';
  return null;
}

function osVersion() {
  if (process.platform === 'darwin') return process.getSystemVersion();
  if (process.platform === 'win32') {
    const build = Number(os.release().split('.')[2] || 0);
    return `${build >= 22000 ? '11' : '10'} (${build})`;
  }
  try {
    const release = fs.readFileSync('/etc/os-release', 'utf8');
    const pretty = release.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (pretty) return pretty[1].replace(/^Linux\s*/i, '').slice(0, 40);
  } catch {
    // Unknown distro.
  }
  return os.release().slice(0, 40);
}

module.exports = { install, launch, linuxPackageFormat, osVersion };
