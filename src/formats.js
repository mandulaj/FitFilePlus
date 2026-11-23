// GPX / TCX / KML readers. Each returns the same shape as parseFit():
//   { records, laps, session, events, device, devFields, noTime? }
// so the UI does not care where the data came from. Uses the browser's DOMParser.
(function (root) {
  'use strict';

  const num = (s) => { if (s == null) return null; const v = parseFloat(s); return isFinite(v) ? v : null; };
  const time = (s) => { if (!s) return null; const t = Date.parse(s.trim()); return isFinite(t) ? t : null; };
  const kids = (el, name) => Array.prototype.filter.call(el.children, (c) => c.localName === name);
  const kid = (el, name) => { for (const c of el.children) if (c.localName === name) return c; return null; };
  const txt = (el, name) => { const c = el && kid(el, name); return c ? c.textContent.trim() : null; };
  // first descendant with one of the given local names (extensions nest differently per exporter)
  const deep = (el, names) => { if (!el) return null; for (const c of el.getElementsByTagName('*')) if (names.includes(c.localName.toLowerCase())) return c.textContent.trim(); return null; };

  // Any other numeric value in a point's <extensions>: keep it as an extra series named after its tag.
  const pretty = (n) => n.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  function scanExtras(ext, known, r, extras) {
    if (!ext) return;
    for (const c of ext.getElementsByTagName('*')) {
      if (c.children.length) continue;
      const name = c.localName, low = name.toLowerCase(); if (known.includes(low)) continue;
      const s = c.textContent.trim(); if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) continue;
      const key = 'x_' + low;
      if (!extras.has(key)) extras.set(key, { key, label: pretty(name), unit: '', unknown: false });
      (r.x || (r.x = {}))[key] = parseFloat(s);
    }
  }
  const GPX_KNOWN = ['hr', 'heartrate', 'cad', 'cadence', 'runcadence', 'power', 'watts', 'pwr', 'atemp', 'temp', 'temperature', 'speed', 'distance'];
  const TCX_KNOWN = ['speed', 'watts', 'runcadence'];

  const SPORTS = [[/run|jog|trail/i, 1], [/cycl|bik|ride/i, 2], [/swim/i, 5], [/hik|trek|mountaineer/i, 17], [/walk/i, 11]];
  const sportOf = (s) => { if (!s) return null; for (const [re, id] of SPORTS) if (re.test(s)) return id; return 0; };

  const blank = () => ({ t: null, lat: null, lon: null, alt: null, hr: null, cadence: null, dist: null, speed: null, power: null,
    vo: null, gct: null, vr: null, balance: null, stride: null, effort: null, lss: null, temp: null, x: null });

  // Running cadence is often stored per leg (~85) rather than per step (~170); the UI expects steps/min.
  function fixCadence(records, sport) {
    if (sport != null && sport !== 1 && sport !== 11 && sport !== 17 && sport !== 0) return;
    const v = records.map((r) => r.cadence).filter((c) => c != null && c > 20).sort((a, b) => a - b);
    if (v.length && v[v.length >> 1] < 125) for (const r of records) if (r.cadence != null) r.cadence *= 2;
  }
  // Speed columns are not reliable across exporters (some write km/h instead of m/s). Compare with
  // distance over time: rescale if it is km/h, drop it (pace is then derived from distance) if it is nonsense.
  function fixSpeed(records) {
    let dd = 0, dt = 0, sv = 0, sn = 0;
    for (let i = 1; i < records.length; i++) {
      const a = records[i - 1], b = records[i], t = (b.t - a.t) / 1000;
      if (a.dist == null || b.dist == null || t <= 0 || t > 10 || b.dist < a.dist) continue;
      dd += b.dist - a.dist; dt += t;
      if (b.speed != null) { sv += b.speed * t; sn += t; }
    }
    if (dt < 30 || sn < 30 || dd <= 0) return;
    const ratio = (sv / sn) / (dd / dt);
    if (ratio > 3.2 && ratio < 4.0) { for (const r of records) if (r.speed != null) r.speed /= 3.6; }
    else if (ratio > 1.4 || ratio < 0.7) for (const r of records) r.speed = null;
  }
  const finish = (records, laps, sport, name, extra) => {
    records = records.filter((r) => r.t != null).sort((a, b) => a.t - b.t);
    fixCadence(records, sport);
    if (!(extra && extra.noTime)) fixSpeed(records);
    return Object.assign({ records, laps, session: { sport }, events: [], device: { name: name || null }, devFields: {}, extras: [] }, extra || {});
  };

  function parseGpx(doc) {
    const records = [], extras = new Map();
    let pts = doc.getElementsByTagName('trkpt');
    if (!pts.length) pts = doc.getElementsByTagName('rtept');
    if (!pts.length) pts = doc.getElementsByTagName('wpt');
    let timed = 0;
    for (const p of pts) {
      const r = blank();
      r.lat = num(p.getAttribute('lat')); r.lon = num(p.getAttribute('lon'));
      r.alt = num(txt(p, 'ele')); r.t = time(txt(p, 'time')); if (r.t != null) timed++;
      const ext = kid(p, 'extensions');
      if (ext) {
        r.hr = num(deep(ext, ['hr', 'heartrate']));
        r.cadence = num(deep(ext, ['cad', 'cadence', 'runcadence']));
        r.power = num(deep(ext, ['power', 'watts', 'pwr']));
        r.temp = num(deep(ext, ['atemp', 'temp', 'temperature']));
        r.speed = num(deep(ext, ['speed']));
        r.dist = num(deep(ext, ['distance']));
        scanExtras(ext, GPX_KNOWN, r, extras);
      }
      records.push(r);
    }
    const trk = doc.getElementsByTagName('trk')[0];
    const sport = sportOf(trk && (txt(trk, 'type') || txt(trk, 'name')));
    const noTime = timed < records.length * 0.5;
    if (noTime) records.forEach((r, i) => { r.t = i * 1000; r.speed = null; });
    // a distance column that never moves is a placeholder, not data
    if (!records.some((r) => r.dist > 0)) records.forEach((r) => { r.dist = null; });
    return finish(records, [], sport, null, { noTime, extras: Array.from(extras.values()) });
  }

  function parseTcx(doc) {
    const records = [], laps = [], extras = new Map();
    const act = doc.getElementsByTagName('Activity')[0] || doc.getElementsByTagName('Course')[0];
    const sport = sportOf(act && act.getAttribute('Sport'));
    const lapEls = doc.getElementsByTagName('Lap');
    const readPoints = (parent) => {
      const out = [];
      for (const tp of parent.getElementsByTagName('Trackpoint')) {
        const r = blank();
        r.t = time(txt(tp, 'Time'));
        const pos = kid(tp, 'Position');
        if (pos) { r.lat = num(txt(pos, 'LatitudeDegrees')); r.lon = num(txt(pos, 'LongitudeDegrees')); }
        r.alt = num(txt(tp, 'AltitudeMeters')); r.dist = num(txt(tp, 'DistanceMeters'));
        const hr = kid(tp, 'HeartRateBpm'); if (hr) r.hr = num(txt(hr, 'Value') || hr.textContent);
        r.cadence = num(txt(tp, 'Cadence'));
        const ext = kid(tp, 'Extensions');
        if (ext) {
          r.speed = num(deep(ext, ['speed']));
          r.power = num(deep(ext, ['watts']));
          if (r.cadence == null) r.cadence = num(deep(ext, ['runcadence']));
          scanExtras(ext, TCX_KNOWN, r, extras);
        }
        out.push(r);
      }
      return out;
    };
    if (lapEls.length) {
      let i = 0;
      for (const lap of lapEls) {
        const pts = readPoints(lap).filter((r) => r.t != null);
        for (const r of pts) records.push(r);
        const start = time(lap.getAttribute('StartTime')) || (pts[0] && pts[0].t);
        const end = pts.length ? pts[pts.length - 1].t : null;
        const timer = num(txt(lap, 'TotalTimeSeconds')), dist = num(txt(lap, 'DistanceMeters'));
        const ah = kid(lap, 'AverageHeartRateBpm'), mh = kid(lap, 'MaximumHeartRateBpm');
        if (start != null && end != null && end > start) laps.push({
          index: ++i, start, end, elapsed: (end - start) / 1000, timer: timer || (end - start) / 1000,
          dist, calories: num(txt(lap, 'Calories')) || null,
          avgSpeed: null, maxSpeed: num(txt(lap, 'MaximumSpeed')),
          avgHr: ah ? num(txt(ah, 'Value')) : null, maxHr: mh ? num(txt(mh, 'Value')) : null,
          avgCadence: null, maxCadence: null, avgPower: null, ascent: null, descent: null,
          avgVo: null, avgGct: null, avgVr: null, avgStride: null, avgBalance: null, avgEffort: null, avgTemp: null,
        });
      }
    } else for (const r of readPoints(doc)) records.push(r);
    if (!records.some((r) => r.dist > 0)) records.forEach((r) => { r.dist = null; });
    // one lap spanning the file says nothing; keep laps only when there are several
    const creator = doc.getElementsByTagName('Creator')[0];
    return finish(records, laps.length > 1 ? laps : [], sport, creator ? txt(creator, 'Name') : null, { extras: Array.from(extras.values()) });
  }

  function parseKml(doc) {
    const records = [];
    let timed = false;
    // gx:Track: parallel <when> and <gx:coord> lists
    for (const tr of doc.getElementsByTagName('*')) {
      if (tr.localName !== 'Track') continue;
      const whens = kids(tr, 'when'), coords = kids(tr, 'coord');
      coords.forEach((c, i) => {
        const p = c.textContent.trim().split(/\s+/).map(parseFloat), r = blank();
        r.lon = p[0]; r.lat = p[1]; r.alt = isFinite(p[2]) ? p[2] : null; r.t = whens[i] ? time(whens[i].textContent) : null;
        if (isFinite(r.lat) && isFinite(r.lon)) records.push(r);
      });
      if (whens.length) timed = true;
    }
    if (!records.length) {
      for (const ls of doc.getElementsByTagName('LineString')) {
        const c = txt(ls, 'coordinates'); if (!c) continue;
        for (const tok of c.split(/\s+/)) {
          const p = tok.split(',').map(parseFloat); if (!isFinite(p[0]) || !isFinite(p[1])) continue;
          const r = blank(); r.lon = p[0]; r.lat = p[1]; r.alt = isFinite(p[2]) ? p[2] : null; records.push(r);
        }
      }
    }
    const noTime = !timed || records.some((r) => r.t == null);
    if (noTime) records.forEach((r, i) => { r.t = i * 1000; });
    const sport = sportOf((doc.getElementsByTagName('type')[0] || {}).textContent);
    return finish(records, [], sport, null, { noTime });
  }

  // text of a .gpx / .tcx / .kml file -> activity object
  function parseActivityText(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('File is not valid XML');
    const rootName = doc.documentElement.localName.toLowerCase();
    let out;
    if (rootName === 'gpx') out = parseGpx(doc);
    else if (rootName === 'trainingcenterdatabase') out = parseTcx(doc);
    else if (rootName === 'kml') out = parseKml(doc);
    else throw new Error('Unsupported file: expected FIT, GPX, TCX or KML');
    if (out.records.length < 2) throw new Error('No track points found in this file');
    return out;
  }

  root.parseActivityText = parseActivityText;
})(typeof globalThis !== 'undefined' ? globalThis : this);
