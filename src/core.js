/* Helpers shared by the analyzer (app.js) and the compare page (compare.js). No state, no DOM. */
(function (root) {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  function fmtDur(s) {
    if (s == null || !isFinite(s)) return '–';
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
  }
  function fmtPace(secPerKm) {
    if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return '–';
    const s = Math.round(secPerKm);
    return `${Math.floor(s / 60)}'${pad(s % 60)}"`;
  }
  const fx = (d) => (v) => (v == null || !isFinite(v) ? '–' : v.toFixed(d));

  function lerpStops(stops, t) {
    t = Math.max(0, Math.min(1, t));
    const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
    const a = parseInt(stops[i].slice(1), 16), b = parseInt(stops[i + 1].slice(1), 16);
    const ch = (sh) => Math.round(((a >> sh) & 255) * (1 - f) + ((b >> sh) & 255) * f);
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }

  function roll(arr, half, median) {
    const n = arr.length, out = new Array(n).fill(null), buf = [];
    for (let i = 0; i < n; i++) {
      buf.length = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) if (arr[j] != null) buf.push(arr[j]);
      if (!buf.length || arr[i] == null) continue;
      if (median) { buf.sort((a, b) => a - b); out[i] = buf[buf.length >> 1]; }
      else { let s = 0; for (const v of buf) s += v; out[i] = s / buf.length; }
    }
    return out;
  }
  function quantile(arr, q) {
    const v = arr.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    return v.length ? v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))] : null;
  }

  // Moving time and distance for a parsed activity (records as produced by fit.js / formats.js).
  // Pauses = gaps much longer than the normal recording interval; distance is taken from the file or,
  // when missing, integrated from GPS. Returns { mt[], dist[] (metres), pauses, step }.
  function baseTrack(R) {
    const n = R.length, dts = []; for (let i = 1; i < n; i++) dts.push((R[i].t - R[i - 1].t) / 1000);
    const step = quantile(dts, 0.5) || 1, gap = Math.max(10, step * 5), mt = new Array(n), dist = new Array(n);
    const hasDist = R.some((r) => r.dist > 0); let m = 0, d = 0, pl = null, po = null, pauses = 0; const rad = Math.PI / 180;
    for (let i = 0; i < n; i++) {
      if (i) { const dt = (R[i].t - R[i - 1].t) / 1000; if (dt > gap) { m += step; pauses++; } else m += dt; }
      mt[i] = m;
      if (hasDist) { if (R[i].dist != null && R[i].dist > d) d = R[i].dist; }
      else if (R[i].lat != null && R[i].lon != null) {
        if (pl != null) { const dy = (R[i].lat - pl) * rad, dx = (R[i].lon - po) * rad * Math.cos(R[i].lat * rad); d += 6371000 * Math.sqrt(dx * dx + dy * dy); }
        pl = R[i].lat; po = R[i].lon;
      }
      dist[i] = d;
    }
    return { mt, dist, pauses, step };
  }

  root.FFCore = { pad, fmtDur, fmtPace, fx, lerpStops, roll, quantile, baseTrack };
})(typeof globalThis !== 'undefined' ? globalThis : this);
