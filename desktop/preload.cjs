// window.arkDesktop: the only bridge between the ArkStore UI and the computer. Runs sandboxed,
// so everything goes through main.cjs. Keep in sync with src/lib/desktop.ts.
const { contextBridge, ipcRenderer } = require('electron');

const machine = ipcRenderer.sendSync('machine');

// "Error invoking remote method 'install': Error: The package manager stopped" -> the sentence.
const invoke = (channel, ...args) =>
  ipcRenderer.invoke(channel, ...args).catch((e) => {
    throw new Error(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  });

const listen = (channel, cb) => {
  const handler = (_event, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('arkDesktop', {
  ...machine,

  download: (id, url, fileName) => invoke('download', id, url, fileName),
  cancelDownload: (id) => invoke('cancel-download', id),
  onDownloadProgress: (cb) => listen('download-progress', cb),
  install: (path, info) => invoke('install', path, info),
  exists: (path) => invoke('exists', path),
  remove: (path) => invoke('remove', path),
  launch: (path) => invoke('launch', path),

  openExternal: (url) => invoke('open-external', url),
  notify: (title, body, url) => ipcRenderer.send('notify', title, body, url),
  onOpenUrl: (cb) => {
    const stop = listen('open-url', cb);
    ipcRenderer.send('open-url-ready');
    return stop;
  },

  update: {
    check: () => invoke('update-check'),
    download: () => invoke('update-download'),
    install: () => ipcRenderer.send('update-install'),
    status: () => invoke('update-status'),
    onStatus: (cb) => listen('update-status', cb),
  },
});
