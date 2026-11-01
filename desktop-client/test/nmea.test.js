// Run: npm test
const assert = require('assert');
const nmea = require('../nmea');
const { parseGpx, Track, distance, destination } = require('../gpx');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// Independent checksum check, as TinyGPS++ does it
function verify(line) {
  const m = line.match(/^\$([^*]+)\*([0-9A-F]{2})\r\n$/);
  assert.ok(m, `malformed: ${JSON.stringify(line)}`);
  let cs = 0;
  for (const ch of m[1]) cs ^= ch.charCodeAt(0);
  assert.strictEqual(cs, parseInt(m[2], 16), `bad checksum: ${line}`);
  return m[1].split(',');
}

const fix = {
  time: new Date(Date.UTC(2026, 10, 1, 8, 37, 35, 200)),
  valid: true,
  lat: 50.08804, lon: -14.42076, alt: 245.36,
  speedKmh: 25.0, course: 87.4, sats: 9,
};

test('checksum matches NMEA reference sentence', () => {
  assert.strictEqual(nmea.checksum('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,'), '47');
});

test('coordinate formatting and minute carry', () => {
  assert.deepStrictEqual(nmea.formatLat(50.08804), ['5005.2824', 'N']);
  assert.deepStrictEqual(nmea.formatLon(-14.42076), ['01425.2456', 'W']);
  assert.deepStrictEqual(nmea.formatLat(-33.9999999), ['3400.0000', 'S']);
  assert.deepStrictEqual(nmea.formatLon(0.5), ['00030.0000', 'E']);
});

test('$GNRMC fields', () => {
  const f = verify(nmea.buildRmc(fix));
  assert.strictEqual(f[0], 'GNRMC');
  assert.strictEqual(f[1], '083735.200');
  assert.strictEqual(f[2], 'A');
  assert.strictEqual(f[3], '5005.2824');
  assert.strictEqual(f[6], 'W');
  assert.strictEqual(f[7], (25 / 1.852).toFixed(2));
  assert.strictEqual(f[8], '87.40');
  assert.strictEqual(f[9], '011126');
  assert.strictEqual(f[12], 'A');
});

test('$GNGGA fields', () => {
  const f = verify(nmea.buildGga(fix));
  assert.strictEqual(f[0], 'GNGGA');
  assert.strictEqual(f[6], '1');
  assert.strictEqual(f[7], '09');
  assert.strictEqual(f[9], '245.4');
  assert.strictEqual(f.length, 15);
});

test('no-fix sentences', () => {
  const nf = { ...fix, valid: false, sats: 2 };
  assert.strictEqual(verify(nmea.buildRmc(nf))[2], 'V');
  const g = verify(nmea.buildGga(nf));
  assert.strictEqual(g[6], '0');
  assert.strictEqual(g[7], '02');
});

test('5 Hz output fits 9600 baud', () => {
  const worst = { ...fix, lat: -89.99999, lon: -179.99999, speedKmh: 199.99, course: 359.99, alt: 8848.9, sats: 24 };
  const bytes = 5 * (nmea.buildRmc(worst) + nmea.buildGga(worst)).length;
  assert.ok(bytes < 960, `${bytes} bytes/s exceeds 960`);
  console.log(`      worst case ${bytes} B/s = ${Math.round(bytes / 9.6)}% of link`);
});

test('dead reckoning: 1 km east', () => {
  const p = destination(50, 14, 90, 1000);
  assert.ok(Math.abs(distance(50, 14, p.lat, p.lon) - 1000) < 0.01);
});

const gpxTimed = `<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
  <trkpt lat="50.0000" lon="14.0000"><ele>200</ele><time>2026-11-01T08:00:00Z</time></trkpt>
  <trkpt lon='14.0014' lat='50.0000'><ele>210</ele><time>2026-11-01T08:00:10Z</time></trkpt>
  <trkpt lat="50.0009" lon="14.0014"><ele>220</ele><time>2026-11-01T08:00:20Z</time></trkpt>
</trkseg></trk></gpx>`;

test('GPX parse + timed sampling', () => {
  const t = new Track(parseGpx(gpxTimed));
  assert.strictEqual(t.timed, true);
  assert.strictEqual(t.duration, 20000);
  const s = t.sampleByTime(5000);
  assert.ok(Math.abs(s.lon - 14.0007) < 1e-9);
  assert.ok(Math.abs(s.alt - 205) < 1e-9);
  assert.ok(Math.abs(s.course - 90) < 0.1);
  assert.ok(Math.abs(s.speedKmh - 36) < 1, `speed ${s.speedKmh}`); // ~100 m in 10 s
  assert.ok(Math.abs(t.sampleByTime(15000).course - 0) < 0.1);
});

test('GPX route without timestamps → distance sampling', () => {
  const t = new Track(parseGpx('<gpx><rte><rtept lat="1" lon="1"/><rtept lat="1" lon="1.001"/></rte></gpx>'));
  assert.strictEqual(t.timed, false);
  assert.ok(Math.abs(t.sampleByDistance(t.length / 2).lon - 1.0005) < 1e-9);
});

test('rejects non-GPX', () => {
  assert.throws(() => parseGpx('<kml></kml>'), /Not a GPX/);
  assert.throws(() => parseGpx('<gpx><trk><trkpt lat="1" lon="1"/></trk></gpx>'), /fewer than 2/);
});

console.log(`\n${passed} passed`);
