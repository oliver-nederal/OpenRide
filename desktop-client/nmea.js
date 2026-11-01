// NMEA encoder, ATGM336H style with the '$GN' talker ID.
// Each 200 ms: $GNRMC + $GNGGA, about 150 bytes → 750 of 960 bytes/s at 9600 baud.

// XOR of every character between '$' and '*'
function checksum(body) {
  let cs = 0;
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
  return cs.toString(16).toUpperCase().padStart(2, '0');
}

function sentence(body) {
  return `$${body}*${checksum(body)}\r\n`;
}

const pad = (n, w) => String(n).padStart(w, '0');

// Degrees → (d)ddmm.mmmm, rounded on the 1/10000-minute grid so 59.99995' carries
function formatCoord(deg, degWidth) {
  const total = Math.round(Math.abs(deg) * 600000);
  const d = Math.floor(total / 600000);
  const m = total - d * 600000;
  return `${pad(d, degWidth)}${pad(Math.floor(m / 10000), 2)}.${pad(m % 10000, 4)}`;
}

function formatLat(lat) { return [formatCoord(lat, 2), lat < 0 ? 'S' : 'N']; }
function formatLon(lon) { return [formatCoord(lon, 3), lon < 0 ? 'W' : 'E']; }

function formatTime(t) {
  return `${pad(t.getUTCHours(), 2)}${pad(t.getUTCMinutes(), 2)}${pad(t.getUTCSeconds(), 2)}.${pad(t.getUTCMilliseconds(), 3)}`;
}

function formatDate(t) {
  return `${pad(t.getUTCDate(), 2)}${pad(t.getUTCMonth() + 1, 2)}${pad(t.getUTCFullYear() % 100, 2)}`;
}

// fix = { time: Date, valid, lat, lon, alt, speedKmh, course, sats }
function buildRmc(fix) {
  const t = formatTime(fix.time);
  const d = formatDate(fix.time);
  if (!fix.valid) return sentence(`GNRMC,${t},V,,,,,,,${d},,,N`);
  const [lat, ns] = formatLat(fix.lat);
  const [lon, ew] = formatLon(fix.lon);
  const knots = (fix.speedKmh / 1.852).toFixed(2);
  const course = (((fix.course % 360) + 360) % 360).toFixed(2);
  return sentence(`GNRMC,${t},A,${lat},${ns},${lon},${ew},${knots},${course},${d},,,A`);
}

function buildGga(fix) {
  const t = formatTime(fix.time);
  const sats = pad(Math.max(0, Math.min(99, fix.sats)), 2);
  if (!fix.valid) return sentence(`GNGGA,${t},,,,,0,${sats},99.9,,,,,,`);
  const [lat, ns] = formatLat(fix.lat);
  const [lon, ew] = formatLon(fix.lon);
  const hdop = Math.max(0.6, 6 / fix.sats).toFixed(1);
  return sentence(`GNGGA,${t},${lat},${ns},${lon},${ew},1,${sats},${hdop},${(fix.alt || 0).toFixed(1)},M,0.0,M,,`);
}

module.exports = { checksum, formatLat, formatLon, buildRmc, buildGga };
