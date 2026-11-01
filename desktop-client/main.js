const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const nmea = require('./nmea');
const { parseGpx, Track, destination } = require('./gpx');

const BAUD = 9600;
const EPOCH_MS = 200; // 5 Hz

let mainWindow = null;
let port = null;

// Manual values; speed + heading move the position each tick
const manual = { speedKmh: 18, heading: 90, lat: 50.08804, lon: 14.42076, sats: 9, fix: true };

// GPX playback
let track = null;
let playing = false;
let elapsedMs = 0;   // timed tracks
let distanceM = 0;   // untimed tracks, moved at manual.speedKmh

function computeFix(dtMs) {
  let pos;
  if (track) {
    if (playing) {
      elapsedMs += dtMs;
      distanceM += (manual.speedKmh / 3.6) * (dtMs / 1000);
      if (track.timed ? elapsedMs >= track.duration : distanceM >= track.length) playing = false;
    }
    const s = track.timed ? track.sampleByTime(elapsedMs) : track.sampleByDistance(distanceM);
    const speed = !playing ? 0 : track.timed ? s.speedKmh : manual.speedKmh;
    pos = { lat: s.lat, lon: s.lon, alt: s.alt, course: s.course, speedKmh: speed };
  } else {
    const p = destination(manual.lat, manual.lon, manual.heading, (manual.speedKmh / 3.6) * (dtMs / 1000));
    manual.lat = p.lat;
    manual.lon = p.lon;
    pos = { lat: p.lat, lon: p.lon, alt: 250, course: manual.heading, speedKmh: manual.speedKmh };
  }
  return {
    ...pos,
    time: new Date(Math.round(Date.now() / EPOCH_MS) * EPOCH_MS),
    valid: manual.fix && manual.sats >= 3,
    sats: manual.sats,
  };
}

let lastTick = Date.now();
function tick() {
  const now = Date.now();
  const fix = computeFix(now - lastTick);
  lastTick = now;

  const out = nmea.buildRmc(fix) + nmea.buildGga(fix);
  if (port && port.isOpen) port.write(out, 'ascii');

  if (mainWindow) mainWindow.webContents.send('telemetry', { ...fix, nmea: out, playing, hasTrack: !!track });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('list-ports', async () => (await SerialPort.list()).map(p => p.path));

ipcMain.handle('connect', (_e, portPath) => new Promise((resolve) => {
  if (port && port.isOpen) port.close();
  port = new SerialPort({ path: portPath, baudRate: BAUD }, (err) => resolve(err ? err.message : 'ok'));
}));

ipcMain.handle('disconnect', () => {
  if (port && port.isOpen) port.close();
  port = null;
});

ipcMain.on('set-manual', (_e, values) => Object.assign(manual, values));

ipcMain.handle('load-gpx', (_e, text) => {
  try {
    track = new Track(parseGpx(text));
    elapsedMs = 0;
    distanceM = 0;
    playing = true;
    const s = track.summary();
    return `${s.points} points, ${(s.lengthM / 1000).toFixed(2)} km` + (s.timed ? '' : ' (no timestamps, using speed slider)');
  } catch (e) {
    return 'Error: ' + e.message;
  }
});

ipcMain.on('gpx', (_e, action) => {
  if (action === 'toggle') playing = !playing;
  if (action === 'restart') { elapsedMs = 0; distanceM = 0; }
  if (action === 'stop') track = null; // back to manual
});

app.whenReady().then(() => {
  createWindow();
  setInterval(tick, EPOCH_MS);
});

app.on('window-all-closed', () => {
  if (port && port.isOpen) port.close();
  app.quit();
});
