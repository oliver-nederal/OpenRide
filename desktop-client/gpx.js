// ================================================================
//  GPX parsing, track sampling, geodesy helpers
// ================================================================

const EARTH_RADIUS_M = 6371008.8;
const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;

// ================================================================
//  Geodesy
// ================================================================

function distance(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearing(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Point reached by travelling `meters` from (lat, lon) along `headingDeg`
function destination(lat, lon, headingDeg, meters) {
  const d = meters / EARTH_RADIUS_M;
  const h = toRad(headingDeg);
  const p1 = toRad(lat), l1 = toRad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(h));
  const l2 = l1 + Math.atan2(Math.sin(h) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: toDeg(p2), lon: ((toDeg(l2) + 540) % 360) - 180 };
}

// ================================================================
//  Parser — dependency-free; handles trkpt, falls back to rtept / wpt
// ================================================================

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`));
  return m ? parseFloat(m[1]) : NaN;
}

function child(inner, tag) {
  if (!inner) return null;
  const m = inner.match(new RegExp(`<(?:\\w+:)?${tag}>\\s*([^<]*?)\\s*</(?:\\w+:)?${tag}>`));
  return m ? m[1] : null;
}

function parsePoints(xml, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'g');
  const points = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    const lat = attr(m[1], 'lat');
    const lon = attr(m[1], 'lon');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const ele = parseFloat(child(m[2], 'ele'));
    const timeStr = child(m[2], 'time');
    const time = timeStr ? Date.parse(timeStr) : NaN;
    points.push({
      lat, lon,
      ele: Number.isFinite(ele) ? ele : null,
      time: Number.isFinite(time) ? time : null,
    });
  }
  return points;
}

function parseGpx(xml) {
  if (typeof xml !== 'string' || !/<gpx[\s>]/i.test(xml)) {
    throw new Error('Not a GPX document');
  }
  for (const tag of ['trkpt', 'rtept', 'wpt']) {
    const points = parsePoints(xml, tag);
    if (points.length >= 2) return points;
  }
  throw new Error('GPX contains fewer than 2 track points');
}

// ================================================================
//  Track — precomputed segments, sampled by time or by distance
// ================================================================

class Track {
  constructor(points) {
    this.points = points;
    this.cumDist = [0];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      this.cumDist.push(this.cumDist[i - 1] + distance(a.lat, a.lon, b.lat, b.lon));
    }
    this.length = this.cumDist[this.cumDist.length - 1];

    // Timed playback iff every point is stamped and time never goes backwards
    const t0 = points[0].time;
    this.timed = points.every((p, i) => p.time !== null && (i === 0 || p.time >= points[i - 1].time)) &&
                 points[points.length - 1].time > t0;
    this.duration = this.timed ? points[points.length - 1].time - t0 : 0;
    this.times = this.timed ? points.map(p => p.time) : null;
    this.lastHeading = points.length > 1 ? bearing(points[0].lat, points[0].lon, points[1].lat, points[1].lon) : 0;
  }

  summary() {
    return {
      points: this.points.length,
      lengthM: this.length,
      durationMs: this.duration,
      timed: this.timed,
    };
  }

  // Interpolate inside segment i at fraction f
  _at(i, f) {
    const a = this.points[i], b = this.points[i + 1];
    const segLen = this.cumDist[i + 1] - this.cumDist[i];
    if (segLen > 0.05) this.lastHeading = bearing(a.lat, a.lon, b.lat, b.lon);
    const ele = a.ele !== null && b.ele !== null ? a.ele + (b.ele - a.ele) * f : (a.ele ?? b.ele ?? 0);
    return {
      lat: a.lat + (b.lat - a.lat) * f,
      lon: a.lon + (b.lon - a.lon) * f,
      alt: ele,
      course: this.lastHeading,
      segLen,
    };
  }

  _segmentFor(arr, value) {
    let lo = 0, hi = arr.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid] <= value) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // elapsedMs since track start
  sampleByTime(elapsedMs) {
    const t = this.points[0].time + Math.max(0, Math.min(elapsedMs, this.duration));
    const times = this.times;
    const i = this._segmentFor(times, t);
    const dt = times[i + 1] - times[i];
    const f = dt > 0 ? (t - times[i]) / dt : 1;
    const s = this._at(i, f);
    return { ...s, speedKmh: dt > 0 ? (s.segLen / (dt / 1000)) * 3.6 : 0, progress: this.duration ? (t - times[0]) / this.duration : 1 };
  }

  // distance along track in metres
  // speed is supplied by the caller
  sampleByDistance(meters) {
    const d = Math.max(0, Math.min(meters, this.length));
    const i = this._segmentFor(this.cumDist, d);
    const segLen = this.cumDist[i + 1] - this.cumDist[i];
    const f = segLen > 0 ? (d - this.cumDist[i]) / segLen : 1;
    return { ...this._at(i, f), progress: this.length ? d / this.length : 1 };
  }
}

module.exports = { parseGpx, Track, distance, bearing, destination };
