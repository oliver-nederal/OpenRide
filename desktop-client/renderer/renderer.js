const $ = (id) => document.getElementById(id);

// Sliders
for (const id of ['speedKmh', 'heading', 'lat', 'lon', 'sats']) {
  $(id).addEventListener('input', () => {
    $(id + 'Val').textContent = $(id).value;
    window.sim.setManual({ [id]: parseFloat($(id).value) });
  });
}
$('fix').addEventListener('change', () => window.sim.setManual({ fix: $('fix').checked }));

// Serial port
async function refreshPorts() {
  const ports = await window.sim.listPorts();
  $('port').innerHTML = ports.map(p => `<option>${p}</option>`).join('');
}
$('refresh').addEventListener('click', refreshPorts);

$('connect').addEventListener('click', async () => {
  if ($('connect').textContent === 'Disconnect') {
    await window.sim.disconnect();
    $('connect').textContent = 'Connect';
    $('portStatus').textContent = 'Not connected';
    return;
  }
  const result = await window.sim.connect($('port').value);
  if (result === 'ok') {
    $('connect').textContent = 'Disconnect';
    $('portStatus').textContent = 'Sending at 9600 baud';
  } else {
    $('portStatus').textContent = result;
  }
});

// GPX
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  if (file) $('gpxStatus').textContent = await window.sim.loadGpx(await file.text());
});
$('play').addEventListener('click', () => window.sim.gpx('toggle'));
$('restart').addEventListener('click', () => window.sim.gpx('restart'));
$('stop').addEventListener('click', () => {
  window.sim.gpx('stop');
  $('file').value = '';
  $('gpxStatus').textContent = '';
});

// Live output
window.sim.onTelemetry((t) => {
  const mode = t.hasTrack ? (t.playing ? 'GPX playing' : 'GPX paused') : 'Manual';
  $('status').textContent =
    `${mode} | ${t.speedKmh.toFixed(1)} km/h | heading ${Math.round(t.course)}° | ` +
    `${t.lat.toFixed(5)}, ${t.lon.toFixed(5)} | ${t.sats} sats | ${t.valid ? 'FIX' : 'NO FIX'}`;
  $('nmea').textContent = t.nmea;

  if (!$('lat').matches(':active')) { $('lat').value = t.lat; $('latVal').textContent = t.lat.toFixed(5); }
  if (!$('lon').matches(':active')) { $('lon').value = t.lon; $('lonVal').textContent = t.lon.toFixed(5); }
});

refreshPorts();
