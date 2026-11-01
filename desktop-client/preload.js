const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sim', {
  onTelemetry: (cb) => ipcRenderer.on('telemetry', (_e, data) => cb(data)),
  listPorts:   ()     => ipcRenderer.invoke('list-ports'),
  connect:     (path) => ipcRenderer.invoke('connect', path),
  disconnect:  ()     => ipcRenderer.invoke('disconnect'),
  setManual:   (values) => ipcRenderer.send('set-manual', values),
  loadGpx:     (text) => ipcRenderer.invoke('load-gpx', text),
  gpx:         (action) => ipcRenderer.send('gpx', action),
});
