// Export of the loaded activity (or a selected part of it) as FIT or GPX.
//   same format, whole activity  -> the original bytes
//   same format, selection       -> the original messages / points copied unchanged, the rest left out
//   other format                 -> written from the decoded data, keeping as much as the target format can hold
(function (root) {
  'use strict';
  const FIT_EPOCH = 631065600;
  const fitTime = (ms) => Math.round(ms / 1000) - FIT_EPOCH;

  function kindOf(buf) {
    const b = new Uint8Array(buf);
    if (b.length > 12 && b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54) return 'fit';
    const head = new TextDecoder('utf-8').decode(b.subarray(0, 4000));
    return /<gpx[\s>]/i.test(head) ? 'gpx' : /<TrainingCenterDatabase[\s>]/i.test(head) ? 'tcx' : /<kml[\s>]/i.test(head) ? 'kml' : 'other';
  }

  const CRC_T = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];
  function crc16(bytes, from, to, crc) {
    crc = crc || 0;
    for (let i = from; i < to; i++) {
      const b = bytes[i];
      let tmp = CRC_T[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc = crc ^ tmp ^ CRC_T[b & 0xF];
      tmp = CRC_T[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc = crc ^ tmp ^ CRC_T[(b >> 4) & 0xF];
    }
    return crc;
  }
  // header + message bytes -> complete FIT file (sizes and checksums filled in)
  function sealFit(header, body) {
    const hs = header.length, out = new Uint8Array(hs + body.length + 2), dv = new DataView(out.buffer);
    out.set(header, 0); out.set(body, hs);
    dv.setUint32(4, body.length, true);
    if (hs >= 14) dv.setUint16(12, crc16(out, 0, 12), true);
    dv.setUint16(hs + body.length, crc16(out, 0, hs + body.length), true);
    return out;
  }
  // moving time, elapsed time and distance of a record range (same pause rule as the app: gaps over 10 s do not count)
  function totals(R, lo, hi) {
    let timer = 0; for (let i = lo + 1; i <= hi; i++) { const dt = (R[i].t - R[i - 1].t) / 1000; if (dt <= 10) timer += dt; }
    let d0 = null, d1 = null; for (let i = lo; i <= hi; i++) if (R[i].dist != null) { if (d0 == null) d0 = R[i].dist; d1 = R[i].dist; }
    return { timer, elapsed: (R[hi].t - R[lo].t) / 1000, dist: d0 == null ? null : d1 - d0 };
  }

  // ----- FIT -> FIT, selection: copy the original messages, leave out what lies outside the time range -----
  const KEEP = new Set([0, 2, 3, 7, 12, 18, 23, 34, 49, 206, 207]); // file / settings / session / activity / device / developer-field descriptions
  function cropFit(buf, R, lo, hi) {
    const src = new Uint8Array(buf), t0 = fitTime(R[lo].t), t1 = fitTime(R[hi].t), parts = [], tot = totals(R, lo, hi);
    let inside = false, compressed = false;
    const w = root.fitWalk(buf, (v) => {
      if (v.def) { parts.push([v.start, v.end]); return; }
      if (v.compressed) compressed = true;
      const ts = v.m[253];
      if (v.global === 20 && ts != null) inside = ts >= t0 && ts <= t1;
      let keep;
      if (KEEP.has(v.global)) keep = true;
      else if (v.global === 19) keep = ts != null && ts <= t1 + 1 && (v.m[2] != null ? v.m[2] : ts) >= t0 - 1; // whole laps only
      else if (ts != null) keep = ts >= t0 && ts <= t1;
      else keep = v.global === 78 ? inside : true; // heartbeat intervals carry no time: they follow the records around them
      if (!keep) return;
      parts.push([v.start, v.end, v.global === 18 ? v.d : null]);
    });
    if (compressed) return null; // compressed timestamps depend on the messages before them: cannot simply cut
    let len = 0; for (const p of parts) len += p[1] - p[0];
    const body = new Uint8Array(len), dv = new DataView(body.buffer); let o = 0;
    for (const [a, b, sess] of parts) {
      body.set(src.subarray(a, b), o);
      if (sess) { // session totals now describe the selection
        let f = o + 1; const put = { 2: t0, 7: Math.round(tot.elapsed * 1000), 8: Math.round(tot.timer * 1000), 9: tot.dist == null ? null : Math.round(tot.dist * 100) };
        for (const [num, size] of sess.fields) { if (put[num] != null && size === 4) dv.setUint32(f, put[num], sess.little); f += size; }
      }
      o += b - a;
    }
    return sealFit(src.subarray(0, w.headerSize), body);
  }

  // ----- anything -> FIT: written from the decoded activity -----
  const T = { enum: [0x00, 1, 'setUint8', 0xFF], u8: [0x02, 1, 'setUint8', 0xFF], s8: [0x01, 1, 'setInt8', 0x7F], u16: [0x84, 2, 'setUint16', 0xFFFF],
    s32: [0x85, 4, 'setInt32', 0x7FFFFFFF], u32: [0x86, 4, 'setUint32', 0xFFFFFFFF], f32: [0x88, 4, 'setFloat32', null] };
  function FitWriter() {
    let buf = new Uint8Array(1 << 16), dv = new DataView(buf.buffer), n = 0; const defs = {};
    const need = (k) => { if (n + k <= buf.length) return; const nb = new Uint8Array(Math.max(buf.length * 2, n + k)); nb.set(buf); buf = nb; dv = new DataView(buf.buffer); };
    const enc = new TextEncoder();
    // fields: [num, type] with type a key of T, or ['str', bytes] / ['bytes', n]; dev: developer field numbers (float32 each)
    this.define = (local, global, fields, dev) => {
      dev = dev || []; need(6 + fields.length * 3 + 1 + dev.length * 3);
      buf[n++] = 0x40 | (dev.length ? 0x20 : 0) | local; buf[n++] = 0; buf[n++] = 0; dv.setUint16(n, global, true); n += 2; buf[n++] = fields.length;
      for (const [num, ty] of fields) { buf[n++] = num; if (Array.isArray(ty)) { buf[n++] = ty[1]; buf[n++] = ty[0] === 'str' ? 0x07 : 0x0D; } else { buf[n++] = T[ty][1]; buf[n++] = T[ty][0]; } }
      if (dev.length) { buf[n++] = dev.length; for (const num of dev) { buf[n++] = num; buf[n++] = 4; buf[n++] = 0; } }
      defs[local] = { fields, dev };
    };
    this.write = (local, vals, devVals) => {
      const d = defs[local]; need(1 + d.fields.length * 64 + d.dev.length * 4); buf[n++] = local;
      d.fields.forEach(([, ty], i) => {
        const v = vals[i];
        if (Array.isArray(ty)) { const len = ty[1]; buf.fill(0, n, n + len); if (v != null && ty[0] === 'str') { const b = enc.encode(String(v)).subarray(0, len - 1); buf.set(b, n); } n += len; return; }
        const [, size, fn, inv] = T[ty];
        if (ty === 'f32') { if (v == null || !isFinite(v)) dv.setUint32(n, 0xFFFFFFFF, true); else dv.setFloat32(n, v, true); }
        else {
          let x = v == null || !isFinite(v) ? inv : Math.round(v);
          const min = ty === 's8' ? -128 : ty === 's32' ? -2147483648 : 0; if (x < min || x >= inv) x = inv;
          dv[fn](n, x, true);
        }
        n += size;
      });
      d.dev.forEach((_, i) => { const v = devVals && devVals[i]; if (v == null || !isFinite(v)) dv.setUint32(n, 0xFFFFFFFF, true); else dv.setFloat32(n, v, true); n += 4; });
    };
    this.bytes = () => buf.subarray(0, n);
  }
  const mul = (v, k, off) => (v == null ? null : (v + (off || 0)) * k);
  function writeFit(fit, foot, lo, hi, whole) {
    const R = fit.records, W = new FitWriter(), cad = (v) => (v == null ? null : foot ? v / 2 : v), s = fit.session || {};
    const tA = fitTime(R[lo].t), tB = fitTime(R[hi].t), tot = totals(R, lo, hi);
    W.define(0, 0, [[0, 'enum'], [1, 'u16'], [2, 'u16'], [4, 'u32'], [8, ['str', 32]]]);
    W.write(0, [4, 255, 0, tA, (fit.device && fit.device.name) || 'FitFilePlus']);
    // developer fields: the two named ones the app knows, then every extra value found in the file
    const devs = [];
    if (R.some((r) => r.effort != null)) devs.push({ name: 'Effort Pace', unit: 'm/s', get: (r) => r.effort });
    if (R.some((r) => r.lss != null)) devs.push({ name: 'Leg Spring Stiffness', unit: 'kN/m', get: (r) => r.lss });
    for (const x of fit.extras || []) { if (devs.length >= 250) break; devs.push({ name: x.label, unit: x.unit, get: (r) => (r.x ? r.x[x.key] : null) }); }
    if (devs.length) {
      W.define(1, 207, [[3, 'u8'], [1, ['bytes', 16]]]); W.write(1, [0, null]);
      W.define(2, 206, [[0, 'u8'], [1, 'u8'], [2, 'u8'], [3, ['str', 64]], [8, ['str', 16]]]);
      devs.forEach((d, i) => W.write(2, [0, i, 136, d.name, d.unit || '']));
    }
    W.define(3, 21, [[253, 'u32'], [0, 'enum'], [1, 'enum']]); W.write(3, [tA, 0, 0]);
    // record: only the fields this activity has
    const F = [
      [253, 'u32', (r) => fitTime(r.t), true],
      [0, 's32', (r) => mul(r.lat, 2147483648 / 180)], [1, 's32', (r) => mul(r.lon, 2147483648 / 180)],
      [78, 'u32', (r) => mul(r.alt, 5, 500)], [3, 'u8', (r) => r.hr],
      [4, 'u8', (r) => (r.cadence == null ? null : Math.floor(cad(r.cadence)))], [53, 'u8', (r) => (r.cadence == null ? null : (cad(r.cadence) % 1) * 128)],
      [5, 'u32', (r) => mul(r.dist, 100)], [73, 'u32', (r) => mul(r.speed, 1000)], [7, 'u16', (r) => r.power], [13, 's8', (r) => r.temp],
      [39, 'u16', (r) => mul(r.vo, 100)], [41, 'u16', (r) => mul(r.gct, 10)], [83, 'u16', (r) => mul(r.vr, 100)], [84, 'u16', (r) => mul(r.balance, 100)], [85, 'u16', (r) => mul(r.stride, 100)],
    ].filter((f) => f[3] || R.some((r) => f[2](r) != null));
    W.define(4, 20, F.map((f) => [f[0], f[1]]), devs.map((_, i) => i));
    for (let i = lo; i <= hi; i++) W.write(4, F.map((f) => f[2](R[i])), devs.map((d) => d.get(R[i])));
    W.write(3, [tB, 0, 4]);
    const SUM = (o, start, end, el, ti, di) => [end, start, mul(el, 1000), mul(ti, 1000), mul(di, 100), o.calories, mul(o.avgSpeed, 1000), mul(o.maxSpeed, 1000), o.avgHr, o.maxHr, cad(o.avgCadence), cad(o.maxCadence), o.avgPower, o.ascent, o.descent];
    const SUMF = (c1, c2, p, a, d) => [[253, 'u32'], [2, 'u32'], [7, 'u32'], [8, 'u32'], [9, 'u32'], [11, 'u16'], [c1[0], 'u16'], [c1[1], 'u16'], [c1[2], 'u8'], [c1[3], 'u8'], [c2[0], 'u8'], [c2[1], 'u8'], [p, 'u16'], [a, 'u16'], [d, 'u16']];
    const laps = (fit.laps || []).filter((l) => l.start != null && l.end != null && (whole || (l.start >= R[lo].t - 1000 && l.end <= R[hi].t + 1000)));
    if (laps.length) {
      W.define(5, 19, SUMF([13, 14, 15, 16], [17, 18], 19, 21, 22));
      for (const l of laps) W.write(5, SUM(l, fitTime(l.start), fitTime(l.end > l.start ? l.end : l.start + (l.elapsed || l.timer || 0) * 1000), l.elapsed, l.timer, l.dist));
    }
    const so = whole ? s : { calories: null, avgSpeed: tot.dist != null && tot.timer > 0 ? tot.dist / tot.timer : null };
    W.define(6, 18, SUMF([14, 15, 16, 17], [18, 19], 20, 22, 23).concat([[5, 'enum'], [6, 'enum']]));
    W.write(6, SUM(so, tA, tB, whole && s.elapsed ? s.elapsed : tot.elapsed, whole && s.timer ? s.timer : tot.timer, whole && s.dist ? s.dist : tot.dist).concat([s.sport == null ? 0 : s.sport, s.subSport == null ? 0 : s.subSport]));
    W.define(7, 34, [[253, 'u32'], [0, 'u32'], [1, 'u16'], [2, 'enum'], [3, 'enum'], [4, 'enum']]);
    W.write(7, [tB, mul(whole && s.timer ? s.timer : tot.timer, 1000), 1, 0, 26, 1]);
    const header = new Uint8Array(14); header[0] = 14; header[1] = 0x20; new DataView(header.buffer).setUint16(2, 2132, true); header.set([0x2e, 0x46, 0x49, 0x54], 8);
    return sealFit(header, W.bytes());
  }

  // ----- GPX -> GPX, selection: remove the points outside the range from the original document -----
  function cropGpx(buf, R, lo, hi, noTime) {
    const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(new Uint8Array(buf)), 'application/xml');
    let pts = doc.getElementsByTagName('trkpt'); if (!pts.length) pts = doc.getElementsByTagName('rtept'); if (!pts.length) pts = doc.getElementsByTagName('wpt');
    const a = R[lo].t, b = R[hi].t, drop = [];
    Array.prototype.forEach.call(pts, (p, i) => {
      let t = i * 1000;
      if (!noTime) { let te = null; for (const c of p.children) if (c.localName === 'time') te = c; t = te ? Date.parse(te.textContent.trim()) : NaN; }
      if (!(t >= a && t <= b)) drop.push(p);
    });
    if (!noTime) for (const l of Array.from(doc.getElementsByTagName('*'))) { // laps written by this app: keep those inside the range
      if (l.localName !== 'lap' || !l.getAttribute('start')) continue;
      if (!(Date.parse(l.getAttribute('start')) >= a - 1000 && Date.parse(l.getAttribute('end')) <= b + 1000)) drop.push(l);
    }
    for (const p of drop) { const prev = p.previousSibling; if (prev && prev.nodeType === 3 && !prev.nodeValue.trim()) prev.remove(); p.remove(); }
    return new TextEncoder().encode(new XMLSerializer().serializeToString(doc));
  }

  // ----- anything -> GPX -----
  const FFP_TAGS = { vo: 'vertical_oscillation', gct: 'ground_contact_time', vr: 'vertical_ratio', balance: 'ground_contact_balance', stride: 'stride_length', effort: 'effort_pace', lss: 'leg_spring_stiffness' };
  const FFP_UNITS = { vo: 'cm', gct: 'ms', vr: '%', balance: '% left', stride: 'cm', effort: 'm/s', lss: 'kN/m' };
  const GPX_SPORT = { 1: 'running', 2: 'cycling', 5: 'swimming', 11: 'walking', 17: 'hiking' };
  const LAP_KEYS = ['elapsed', 'timer', 'dist', 'calories', 'avgSpeed', 'maxSpeed', 'avgHr', 'maxHr', 'avgCadence', 'maxCadence', 'avgPower', 'ascent', 'descent', 'avgVo', 'avgGct', 'avgVr', 'avgStride', 'avgBalance', 'avgEffort', 'avgTemp'];
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const nf = (v, d) => String(+v.toFixed(d));
  function writeGpx(fit, foot, lo, hi, noTime, name, whole) {
    const R = fit.records, iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z'), s = fit.session || {};
    // extra values: tag named after the label (made XML-safe, unique)
    const used = new Set(Object.values(FFP_TAGS).concat(['speed', 'distance', 'cadence_exact', 'lap', 'laps']));
    const xs = (fit.extras || []).map((x) => { let tag = x.label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field'; if (/^[^A-Za-z]/.test(tag)) tag = 'f_' + tag; while (used.has(tag.toLowerCase())) tag += '_'; used.add(tag.toLowerCase()); return { key: x.key, tag, unit: x.unit }; });
    const o = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="FitFilePlus" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:ffp="https://github.com/mandulaj/FitFilePlus">'];
    if (!noTime) o.push(` <metadata><time>${iso(R[lo].t)}</time></metadata>`);
    o.push(' <trk>', `  <name>${esc(name)}</name>`);
    if (fit.device && fit.device.name) o.push(`  <src>${esc(fit.device.name)}</src>`);
    if (GPX_SPORT[s.sport]) o.push(`  <type>${GPX_SPORT[s.sport]}</type>`);
    const laps = noTime ? [] : (fit.laps || []).filter((l) => l.start != null && l.end != null && (whole || (l.start >= R[lo].t - 1000 && l.end <= R[hi].t + 1000)));
    if (laps.length) {
      o.push('  <extensions><ffp:laps>');
      for (const l of laps) o.push(`   <ffp:lap start="${iso(l.start)}" end="${iso(l.end > l.start ? l.end : l.start + (l.elapsed || l.timer || 0) * 1000)}"${LAP_KEYS.map((k) => (l[k] == null || !isFinite(l[k]) ? '' : ` ${k}="${nf(l[k], 3)}"`)).join('')}/>`);
      o.push('  </ffp:laps></extensions>');
    }
    o.push('  <trkseg>');
    let lat = null, lon = null;
    for (let i = lo; i <= hi; i++) {
      const r = R[i]; if (r.lat != null && r.lon != null) { lat = r.lat; lon = r.lon; }
      if (lat == null) continue; // GPX points need a position: seconds before the first fix are left out, later gaps reuse the last one
      let p = `   <trkpt lat="${nf(lat, 7)}" lon="${nf(lon, 7)}">`;
      if (r.alt != null) p += `<ele>${nf(r.alt, 2)}</ele>`;
      if (!noTime) p += `<time>${iso(r.t)}</time>`;
      let e = '', tp = '';
      if (r.temp != null) tp += `<gpxtpx:atemp>${nf(r.temp, 1)}</gpxtpx:atemp>`;
      if (r.hr != null) tp += `<gpxtpx:hr>${Math.round(r.hr)}</gpxtpx:hr>`;
      if (r.cadence != null) tp += `<gpxtpx:cad>${Math.round(foot ? r.cadence / 2 : r.cadence)}</gpxtpx:cad>`; // convention: revolutions (one leg) per minute
      if (tp) e += `<gpxtpx:TrackPointExtension>${tp}</gpxtpx:TrackPointExtension>`;
      if (r.power != null) e += `<power>${nf(r.power, 1)}</power>`;
      if (r.cadence != null) e += `<ffp:cadence_exact>${nf(r.cadence, 2)}</ffp:cadence_exact>`;
      if (r.speed != null && !noTime) e += `<ffp:speed>${nf(r.speed, 3)}</ffp:speed>`;
      if (r.dist != null) e += `<ffp:distance>${nf(r.dist, 2)}</ffp:distance>`;
      for (const k in FFP_TAGS) if (r[k] != null) e += `<ffp:${FFP_TAGS[k]} unit="${FFP_UNITS[k]}">${nf(r[k], 3)}</ffp:${FFP_TAGS[k]}>`;
      if (r.x) for (const x of xs) { const v = r.x[x.key]; if (v != null && isFinite(v)) e += `<ffp:${x.tag}${x.unit ? ` unit="${esc(x.unit)}"` : ''}>${nf(v, 4)}</ffp:${x.tag}>`; }
      if (e) p += `<extensions>${e}</extensions>`;
      o.push(p + '</trkpt>');
    }
    o.push('  </trkseg>', ' </trk>', '</gpx>', '');
    return new TextEncoder().encode(o.join('\n'));
  }

  // { buf, name, fit (decoded), foot, noTime, range: [lo, hi] | null, format: 'fit' | 'gpx' } -> { data, mime, name }
  function run(o) {
    const R = o.fit.records, src = kindOf(o.buf), whole = !o.range, lo = whole ? 0 : o.range[0], hi = whole ? R.length - 1 : o.range[1];
    const base = (o.name || 'activity').replace(/\.(fit|gpx|tcx|kml|xml)$/i, ''), ext = '.' + o.format;
    const name = whole && src === o.format ? o.name : base + (whole ? '' : '_selection') + ext;
    let data;
    if (o.format === 'fit') {
      if (o.noTime) throw new Error('this file has no timestamps');
      data = src === 'fit' ? (whole ? new Uint8Array(o.buf) : cropFit(o.buf, R, lo, hi)) : null;
      if (!data) data = writeFit(o.fit, o.foot, lo, hi, whole);
      return { data, mime: 'application/octet-stream', name };
    }
    data = src === 'gpx' ? (whole ? new Uint8Array(o.buf) : cropGpx(o.buf, R, lo, hi, o.noTime)) : writeGpx(o.fit, o.foot, lo, hi, o.noTime, base, whole);
    return { data, mime: 'application/gpx+xml', name };
  }

  root.FFExport = { run, kindOf };
})(typeof globalThis !== 'undefined' ? globalThis : this);
