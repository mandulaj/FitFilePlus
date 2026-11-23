/* FitFilePlus compare page: several activities side by side.
   Depends on globals: L (Leaflet), uPlot, FFCore, parseFit, parseActivityText. */
(function () {
  'use strict';
  const { fmtDur, fmtPace, fx, roll, baseTrack } = window.FFCore;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fitfileplus.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('fitfileplus.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const finite = (v) => v != null && isFinite(v);
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 4500); }

  // ---------- units (taken from the analyzer's settings) ----------
  const us = store.get('units', {}), imp = !!us.imp, DM = imp ? 1609.344 : 1000, du = imp ? 'mi' : 'km', EF = imp ? 3.28084 : 1, eu = imp ? 'ft' : 'm';
  const SPEED_SPORTS = new Set([2, 13, 14, 20, 21, 22, 23, 24, 26, 30, 32, 33, 34, 36, 38, 39, 40, 42, 43, 44, 76, 77, 81]);
  let speedMode = us.mode === 'speed';
  const pv = (ms) => (ms > 0.3 ? (speedMode ? (ms * 3600) / DM : DM / ms) : null); // m/s -> pace or speed in display units
  const paceLabel = () => (speedMode ? 'Speed' : 'Pace'), paceUnit = () => (speedMode ? (imp ? 'mph' : 'km/h') : '/' + du), paceFmt = () => (speedMode ? fx(1) : fmtPace);

  // metrics available for overlay / summary / trend. get(r) reads the per-record value (SI); conv converts for display.
  const MET = {
    pace: { label: paceLabel, unit: paceUnit, fmt: () => paceFmt(), rev: () => !speedMode },
    hr: { label: 'Heart Rate', unit: 'bpm', fmt: fx(0), get: (r) => r.hr },
    power: { label: 'Power', unit: 'W', fmt: fx(0), get: (r) => r.power },
    cadence: { label: 'Cadence', unit: '/min', fmt: fx(0), get: (r) => r.cadence },
    gct: { label: 'Ground Contact Time', unit: 'ms', fmt: fx(0), get: (r) => r.gct },
    vo: { label: 'Stride Height', unit: 'cm', fmt: fx(1), get: (r) => r.vo },
    vr: { label: 'Stride Ratio', unit: '%', fmt: fx(1), get: (r) => r.vr },
    stride: { label: 'Stride Length', unit: 'cm', fmt: fx(0), get: (r) => r.stride },
    lss: { label: 'Leg Spring Stiffness', unit: 'kN/m', fmt: fx(1), get: (r) => r.lss },
    alt: { label: 'Elevation', unit: eu, fmt: fx(0), get: (r) => (r.alt == null ? null : r.alt * EF) },
  };
  const mLabel = (k) => (typeof MET[k].label === 'function' ? MET[k].label() : MET[k].label);
  const mUnit = (k) => (typeof MET[k].unit === 'function' ? MET[k].unit() : MET[k].unit);
  const mFmt = (k) => (k === 'pace' ? paceFmt() : MET[k].fmt);
  const COLORS = ['#22e06b', '#38bdf8', '#f59e0b', '#f472b6', '#a78bfa', '#f87171', '#2dd4bf', '#facc15', '#fb923c', '#94a3b8'];
  const SPORT = { 1: 'Run', 2: 'Ride', 5: 'Swim', 11: 'Walk', 17: 'Hike' };

  // ---------- state ----------
  let acts = [];   // { id, name, color, show, ... derived }
  const S = Object.assign({ metric: 'pace', x: 'dist', trend: 'pace', ref: null, layer: 'topo' }, store.get('compare', {}));
  const save = () => store.set('compare', { metric: S.metric, x: S.x, trend: S.trend, ref: S.ref, layer: S.layer, hidden: acts.filter((a) => !a.show).map((a) => a.id) });
  const shown = () => acts.filter((a) => a.show);
  const refAct = () => acts.find((a) => a.id === S.ref) || shown()[0] || acts[0] || null;

  // ---------- storage of the files themselves (IndexedDB) ----------
  const db = {
    open() { return new Promise((res, rej) => { const r = indexedDB.open('fitfileplus-compare', 1); r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    tx(mode, fn) { return this.open().then((d) => new Promise((res, rej) => { const t = d.transaction('files', mode), q = fn(t.objectStore('files')); t.oncomplete = () => { d.close(); res(q && q.result); }; t.onerror = t.onabort = () => { d.close(); rej(t.error); }; })); },
    put(v) { return this.tx('readwrite', (s) => s.put(v)); }, all() { return this.tx('readonly', (s) => s.getAll()); },
    del(id) { return this.tx('readwrite', (s) => s.delete(id)); }, clear() { return this.tx('readwrite', (s) => s.clear()); },
  };

  // ---------- one activity -> derived series and summary ----------
  function parseAny(buf) {
    const b = new Uint8Array(buf);
    if (b.length > 12 && b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54) return window.parseFit(buf);
    return window.parseActivityText(new TextDecoder('utf-8').decode(b));
  }
  function buildAct(buf, name, id) {
    const fit = parseAny(buf), R = fit.records; if (R.length < 2) throw new Error('no track points');
    const sport = fit.session.sport, foot = sport == null || sport === 0 || sport === 1 || sport === 11 || sport === 17;
    if (!foot) for (const r of R) if (r.cadence != null) r.cadence /= 2;
    const n = R.length, base = baseTrack(R), mt = base.mt, dist = base.dist;
    // speed from the file, else from distance over time
    const speed = R.map((r) => (finite(r.speed) ? r.speed : null));
    if (!speed.some(finite) && !fit.noTime) for (let i = 0; i < n; i++) { const a = Math.max(0, i - 3), b = Math.min(n - 1, i + 3), dt = mt[b] - mt[a]; if (dt > 0) speed[i] = (dist[b] - dist[a]) / dt; }
    const ser = {}, has = {};
    for (const k in MET) { const raw = k === 'pace' ? speed : R.map((r) => { const v = MET[k].get(r); return finite(v) && (v !== 0 || k === 'alt') ? v : null; }); has[k] = raw.some(finite); ser[k] = roll(raw, k === 'alt' ? 2 : 7, false); }
    if (fit.noTime) has.pace = false;
    const mean = (k) => { let s = 0, c = 0; for (const r of R) { const v = MET[k].get(r); if (finite(v) && v !== 0) { s += v; c++; } } return c ? s / c : null; };
    const ss = fit.session, total = finite(ss.dist) && ss.dist > 0 ? ss.dist : dist[n - 1], time = fit.noTime ? null : (finite(ss.timer) && ss.timer > 0 ? ss.timer : mt[n - 1]);
    let gain = finite(ss.ascent) && ss.ascent > 0 ? ss.ascent : null;
    if (gain == null && has.alt) { gain = 0; let ref = null; for (let i = 0; i < n; i++) { const a = ser.alt[i]; if (a == null) continue; if (ref == null) ref = a; if (a - ref >= EF) { gain += a - ref; ref = a; } else if (ref - a >= EF) ref = a; } gain /= EF; }
    const avgSpeed = time && total ? total / time : null, avgHr = finite(ss.avgHr) && ss.avgHr > 0 ? ss.avgHr : mean('hr');
    const sum = { dist: total, time, speed: avgSpeed, hr: avgHr, gain, ef: avgSpeed && avgHr ? (avgSpeed * 60) / avgHr : null };
    for (const k of ['power', 'cadence', 'gct', 'vo', 'vr', 'stride', 'lss']) sum[k] = mean(k);
    const lat = [], lon = []; for (const r of R) if (finite(r.lat) && finite(r.lon)) { lat.push(r.lat); lon.push(r.lon); }
    return { id, name, sport, date: fit.noTime ? null : R[0].t, n, mt, dist, ser, has, sum, lat, lon, noTime: !!fit.noTime, show: true };
  }

  // value of a series at arbitrary x positions (xs ascending), linear between samples
  function resample(xa, ya, xs) {
    const out = new Array(xs.length).fill(null), n = xa.length; let j = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i]; if (x < xa[0] || x > xa[n - 1]) continue;
      while (j < n - 2 && xa[j + 1] < x) j++;
      const a = ya[j], b = ya[j + 1]; if (!finite(a) || !finite(b)) { out[i] = finite(a) ? a : finite(b) ? b : null; continue; }
      const w = xa[j + 1] > xa[j] ? (x - xa[j]) / (xa[j + 1] - xa[j]) : 0; out[i] = a + (b - a) * w;
    }
    return out;
  }
  const grid = (max, n) => { const g = new Array(n); for (let i = 0; i < n; i++) g[i] = (max * i) / (n - 1); return g; };

  // ---------- rendering ----------
  let plots = {};
  function mkPlot(id, opts, data) { if (plots[id]) { plots[id].destroy(); delete plots[id]; } const box = $(id); box.innerHTML = ''; if (!data) return; plots[id] = new uPlot(Object.assign({ width: Math.max(300, box.clientWidth), legend: { show: false }, cursor: { drag: { x: true, y: false }, points: { size: 6 } } }, opts), data, box); }
  const axis = (extra) => Object.assign({ stroke: cssVar('--muted'), grid: { stroke: cssVar('--grid'), width: 1 }, ticks: { stroke: cssVar('--line'), size: 4 }, font: '11px system-ui' }, extra);

  function renderList() {
    const ref = refAct();
    $('list').innerHTML = acts.map((a) => `<div class="arow"><input type="checkbox" data-show="${a.id}" ${a.show ? 'checked' : ''} title="Show in charts and map"><input type="radio" name="ref" data-ref="${a.id}" ${ref && ref.id === a.id ? 'checked' : ''} title="Use as reference for differences and the gap chart"><span class="sw" style="background:${a.color}"></span><span class="nm" title="${a.name}">${a.date ? new Date(a.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'no date'} · ${SPORT[a.sport] || 'Activity'} <span class="sub">${(a.sum.dist / DM).toFixed(2)} ${du}${a.sum.time ? ' · ' + fmtDur(a.sum.time) : ''} · ${a.name}</span></span><button class="rm" data-rm="${a.id}" title="Remove this activity">×</button></div>`).join('');
    $('actSub').textContent = `${acts.length} activit${acts.length === 1 ? 'y' : 'ies'} · ${shown().length} shown`;
  }

  function renderSummary() {
    const list = shown(), ref = refAct();
    if (!list.length) { $('summary').innerHTML = ''; return; }
    const rows = [
      ['Date', (a) => (a.date ? new Date(a.date).toLocaleDateString() : '–')],
      ['Distance', (a) => (a.sum.dist / DM).toFixed(2) + ' ' + du, (a) => a.sum.dist / DM, 2],
      ['Moving time', (a) => fmtDur(a.sum.time), (a) => a.sum.time, 't'],
      ['Avg ' + paceLabel().toLowerCase(), (a) => paceFmt()(pv(a.sum.speed)) + ' ' + paceUnit(), (a) => pv(a.sum.speed), speedMode ? 1 : 't'],
      ['Avg heart rate', (a) => fx(0)(a.sum.hr), (a) => a.sum.hr, 0], ['Avg power', (a) => fx(0)(a.sum.power), (a) => a.sum.power, 0],
      ['Avg cadence', (a) => fx(0)(a.sum.cadence), (a) => a.sum.cadence, 0], ['Ground contact time', (a) => fx(0)(a.sum.gct) + ' ms', (a) => a.sum.gct, 0],
      ['Stride height', (a) => fx(1)(a.sum.vo) + ' cm', (a) => a.sum.vo, 1], ['Stride ratio', (a) => fx(1)(a.sum.vr) + ' %', (a) => a.sum.vr, 1],
      ['Stride length', (a) => fx(0)(a.sum.stride) + ' cm', (a) => a.sum.stride, 0], ['Leg stiffness', (a) => fx(1)(a.sum.lss) + ' kN/m', (a) => a.sum.lss, 1],
      ['Elevation gain', (a) => (a.sum.gain == null ? '–' : (a.sum.gain * EF).toFixed(0) + ' ' + eu), (a) => (a.sum.gain == null ? null : a.sum.gain * EF), 0],
      ['Efficiency', (a) => fx(2)(a.sum.ef), (a) => a.sum.ef, 2],
    ].filter((r) => !r[2] || list.some((a) => finite(r[2](a))));
    const delta = (r, a) => {
      if (!r[2] || !ref || a.id === ref.id) return ''; const v = r[2](a), b = r[2](ref); if (!finite(v) || !finite(b)) return '';
      const d = v - b; if (Math.abs(d) < 1e-9) return ''; const sgn = d > 0 ? '+' : '−';
      return `<small>${sgn}${r[3] === 't' ? fmtDur(Math.abs(d)) : Math.abs(d).toFixed(r[3])}</small>`;
    };
    $('summary').innerHTML = '<thead><tr><th></th>' + list.map((a) => `<th title="${a.name}"><span class="sw" style="background:${a.color}"></span>${a.date ? new Date(a.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : a.name.slice(0, 10)}${ref && a.id === ref.id ? ' ●' : ''}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map((r) => `<tr><td>${r[0]}</td>${list.map((a) => `<td>${r[2] && !finite(r[2](a)) ? '–' : r[1](a)}${delta(r, a)}</td>`).join('')}</tr>`).join('') + '</tbody>';
    $('sumNote').textContent = ref && list.length > 1 ? 'small numbers: difference to reference (●)' : '';
    $('summary').title = 'Efficiency = metres per minute per heartbeat (average speed ÷ average heart rate); higher means more speed for the same heart rate.';
  }

  function renderOverlay() {
    const list = shown().filter((a) => a.has[S.metric] && (S.x === 'dist' || !a.noTime));
    if (!list.length) { mkPlot('overlay', null, null); $('overlay').innerHTML = '<div class="wnote">None of the shown activities has this metric.</div>'; return; }
    const xOf = (a) => (S.x === 'dist' ? a.dist.map((d) => d / DM) : a.mt), max = Math.max(...list.map((a) => xOf(a)[a.n - 1])), xs = grid(max, 1400);
    const conv = S.metric === 'pace' ? pv : (v) => v, data = [xs].concat(list.map((a) => resample(xOf(a), a.ser[S.metric], xs).map((v) => (v == null ? null : conv(v)))));
    const fmt = mFmt(S.metric), rev = S.metric === 'pace' && !speedMode;
    const all = []; for (let i = 1; i < data.length; i++) for (const v of data[i]) if (finite(v)) all.push(v); all.sort((a, b) => a - b);
    const lo = all[Math.floor(all.length * 0.005)], hi = all[Math.floor(all.length * 0.995)], pad = ((hi - lo) || 1) * 0.08;
    mkPlot('overlay', {
      height: 300, scales: { x: { time: false }, y: { dir: rev ? -1 : 1, range: () => [lo - pad, hi + pad] } },
      axes: [axis({ values: (u, v) => v.map((x) => (S.x === 'dist' ? +x.toFixed(2) + '' : fmtDur(x))), space: 80 }), axis({ size: 52, values: (u, v) => v.map((x) => fmt(x)) })],
      series: [{}].concat(list.map((a) => ({ label: a.name, stroke: a.color, width: 1.6, points: { show: false } }))),
    }, data);
  }

  // time at a given distance for one activity (distance is monotonic)
  const timeAt = (a, ds) => resample(a.dist, a.mt, ds);
  function renderGap() {
    const ref = refAct(), others = shown().filter((a) => ref && a.id !== ref.id && !a.noTime);
    $('gapCard').hidden = !ref || ref.noTime || !others.length;
    if ($('gapCard').hidden) { mkPlot('gap', null, null); return; }
    const far = (a) => { if (!a.lat.length || !ref.lat.length) return false; const dy = (a.lat[0] - ref.lat[0]) * 111000, dx = (a.lon[0] - ref.lon[0]) * 111000 * Math.cos((ref.lat[0] * Math.PI) / 180); return Math.sqrt(dx * dx + dy * dy) > 400 || Math.abs(a.sum.dist - ref.sum.dist) / ref.sum.dist > 0.15; };
    const max = Math.max(...others.map((a) => Math.min(a.dist[a.n - 1], ref.dist[ref.n - 1]))), ds = grid(max, 900), tr = timeAt(ref, ds);
    const data = [ds.map((d) => d / DM)].concat(others.map((a) => { const t = timeAt(a, ds); return t.map((v, i) => (finite(v) && finite(tr[i]) ? v - tr[i] : null)); }));
    const sgn = (v) => (v == null ? '' : (v > 0 ? '+' : v < 0 ? '−' : '') + fmtDur(Math.abs(v)));
    mkPlot('gap', {
      height: 200, scales: { x: { time: false }, y: {} },
      axes: [axis({ values: (u, v) => v.map((x) => +x.toFixed(2) + ''), space: 80 }), axis({ size: 60, values: (u, v) => v.map(sgn) })],
      series: [{}].concat(others.map((a) => ({ label: a.name, stroke: a.color, width: 1.8, points: { show: false } }))),
    }, data);
    const diff = others.filter(far);
    $('gapNote').textContent = `above zero = behind the reference at that distance (${du})` + (diff.length ? ` · ${diff.length} of these start elsewhere or differ in length: the gap is only meaningful on the same route` : '');
  }

  const TREND = { pace: ['Avg ' + 'pace / speed', (a) => pv(a.sum.speed)], hr: ['Avg heart rate', (a) => a.sum.hr], ef: ['Efficiency (speed per heartbeat)', (a) => a.sum.ef], power: ['Avg power', (a) => a.sum.power], cadence: ['Avg cadence', (a) => a.sum.cadence], gct: ['Ground contact time', (a) => a.sum.gct], vo: ['Stride height', (a) => a.sum.vo], vr: ['Stride ratio', (a) => a.sum.vr], stride: ['Stride length', (a) => a.sum.stride], lss: ['Leg stiffness', (a) => a.sum.lss], dist: ['Distance', (a) => a.sum.dist / DM] };
  function renderTrend() {
    const pts = acts.filter((a) => a.date && finite(TREND[S.trend][1](a))).sort((a, b) => a.date - b.date);
    $('trendCard').hidden = acts.filter((a) => a.date).length < 2;
    if ($('trendCard').hidden) { mkPlot('trend', null, null); return; }
    if (pts.length < 2) { mkPlot('trend', null, null); $('trend').innerHTML = '<div class="wnote">Fewer than two activities have this value.</div>'; $('trendNote').textContent = ''; return; }
    const isPace = S.trend === 'pace', fmt = isPace ? paceFmt() : S.trend === 'ef' || S.trend === 'dist' ? fx(2) : mFmt(S.trend) || fx(1);
    mkPlot('trend', {
      height: 200, scales: { x: { time: true }, y: { dir: isPace && !speedMode ? -1 : 1 } },
      axes: [axis({}), axis({ size: 52, values: (u, v) => v.map((x) => fmt(x)) })],
      series: [{}, { stroke: cssVar('--accent'), width: 1.5, points: { show: true, size: 8, fill: cssVar('--accent') } }],
    }, [pts.map((a) => a.date / 1000), pts.map((a) => TREND[S.trend][1](a))]);
    const first = TREND[S.trend][1](pts[0]), last = TREND[S.trend][1](pts[pts.length - 1]);
    $('trendNote').textContent = `${pts.length} activities · first ${fmt(first)} → latest ${fmt(last)} · all activities count, shown or not`;
  }

  let map = null, base = null, tracks = null;
  const LAYERS = { topo: ['OpenTopoMap', 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxNativeZoom: 17, subdomains: 'abc', attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap (CC-BY-SA)' }], osm: ['OpenStreetMap', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' }], none: ['No basemap', '', {}] };
  function setLayer() { if (base) { base.remove(); base = null; } const l = LAYERS[S.layer] || LAYERS.topo; if (l[1]) base = L.tileLayer(l[1], Object.assign({ maxZoom: 20 }, l[2])).addTo(map).bringToBack(); }
  function renderMap() {
    const list = shown().filter((a) => a.lat.length > 1); $('mapCard').hidden = !list.length; if (!list.length) return;
    if (!map) { map = L.map('map', { renderer: L.canvas({ padding: 0.3 }), zoomSnap: 0.25 }); L.control.scale({ imperial: imp, metric: !imp }).addTo(map); tracks = L.layerGroup().addTo(map); for (const id in LAYERS) $('layerSel').add(new Option(LAYERS[id][0], id)); $('layerSel').value = S.layer; $('layerSel').onchange = () => { S.layer = $('layerSel').value; save(); setLayer(); }; setLayer(); }
    map.invalidateSize(); tracks.clearLayers(); let bounds = null;
    for (const a of list) {
      const step = Math.max(1, Math.ceil(a.lat.length / 2000)), pts = []; for (let i = 0; i < a.lat.length; i += step) pts.push([a.lat[i], a.lon[i]]);
      L.polyline(pts, { color: '#0b0f1a', weight: 6, opacity: 0.8, interactive: false }).addTo(tracks);
      L.polyline(pts, { color: a.color, weight: 3.5, interactive: false }).addTo(tracks);
      const b = L.latLngBounds(pts); bounds = bounds ? bounds.extend(b) : b;
    }
    map.fitBounds(bounds, { padding: [25, 25], animate: false });
  }

  function renderAll() {
    $('empty').hidden = acts.length > 0; $('app').hidden = acts.length === 0;
    if (!acts.length) { $('actSub').textContent = 'Drop two or more .fit, .gpx or .tcx files anywhere on this page'; return; }
    if (us.mode !== 'speed' && us.mode !== 'pace') speedMode = SPEED_SPORTS.has((refAct() || {}).sport);
    const ms = $('metricSel'); ms.innerHTML = ''; for (const k in MET) if (acts.some((a) => a.has[k])) ms.add(new Option(mLabel(k) + ' (' + mUnit(k) + ')', k)); ms.value = S.metric; if (ms.value !== S.metric) { S.metric = ms.value; }
    const ts = $('trendSel'); ts.innerHTML = ''; for (const k in TREND) if (acts.some((a) => finite(TREND[k][1](a)))) ts.add(new Option(k === 'pace' ? 'Avg ' + paceLabel().toLowerCase() : TREND[k][0], k)); ts.value = S.trend; if (ts.value !== S.trend) S.trend = ts.value;
    $('xSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.x === S.x));
    renderList(); renderSummary(); renderOverlay(); renderGap(); renderTrend(); renderMap();
  }

  // ---------- adding / removing ----------
  function addBuffer(buf, name, id, quiet) {
    try { const a = buildAct(buf, name, id); a.color = COLORS[acts.length % COLORS.length]; acts.push(a); return a; }
    catch (e) { console.error(e); if (!quiet) toast('Could not read ' + name + ': ' + e.message); return null; }
  }
  function sortActs() { acts.sort((a, b) => (a.date || 0) - (b.date || 0)); acts.forEach((a, i) => { a.color = COLORS[i % COLORS.length]; }); }
  function addFiles(files) {
    const list = Array.from(files); let left = list.length; if (!left) return;
    list.forEach((f) => { const r = new FileReader(); r.onload = () => { const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7); if (addBuffer(r.result, f.name, id)) { try { db.put({ id, name: f.name, buf: r.result }).catch(() => {}); } catch (e) { /* ignore */ } } if (--left === 0) { sortActs(); renderAll(); } }; r.onerror = () => { if (--left === 0) { sortActs(); renderAll(); } }; r.readAsArrayBuffer(f); });
  }
  $('fileInput').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  let depth = 0; const isFile = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (!isFile(e)) return; e.preventDefault(); depth++; $('dropveil').hidden = false; });
  window.addEventListener('dragleave', (e) => { if (!isFile(e)) return; if (--depth <= 0) { depth = 0; $('dropveil').hidden = true; } });
  window.addEventListener('dragover', (e) => { if (isFile(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (!isFile(e)) return; e.preventDefault(); depth = 0; $('dropveil').hidden = true; addFiles(e.dataTransfer.files); });

  $('list').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.show) { const a = acts.find((x) => x.id === t.dataset.show); if (a) a.show = t.checked; }
    else if (t.dataset.ref) S.ref = t.dataset.ref;
    save(); renderAll();
  });
  $('list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    acts = acts.filter((a) => a.id !== b.dataset.rm); try { db.del(b.dataset.rm).catch(() => {}); } catch (err) { /* ignore */ }
    sortActs(); save(); renderAll();
  });
  $('clearAll').onclick = () => { if (!confirm('Remove all activities from the compare page?')) return; acts = []; try { db.clear().catch(() => {}); } catch (e) { /* ignore */ } save(); renderAll(); };
  $('metricSel').onchange = () => { S.metric = $('metricSel').value; save(); renderOverlay(); };
  $('trendSel').onchange = () => { S.trend = $('trendSel').value; save(); renderTrend(); };
  $('xSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.x = b.dataset.x; save(); renderAll(); };
  let rz = 0; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (acts.length) { renderOverlay(); renderGap(); renderTrend(); if (map) map.invalidateSize(); } }, 120); });

  // ---------- start: test hook, then files kept from earlier visits ----------
  const hiddenIds = store.get('compare', {}).hidden || [];
  const b64 = (s64) => { const bin = atob(s64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8.buffer; };
  if (window.FFCOMPARE_EMBED) { window.FFCOMPARE_EMBED.forEach((f, i) => addBuffer(b64(f.data), f.name, 'embed' + i)); sortActs(); renderAll(); }
  else { try { db.all().then((rows) => { (rows || []).forEach((r) => { const a = addBuffer(r.buf, r.name, r.id, true); if (a && hiddenIds.includes(r.id)) a.show = false; }); sortActs(); renderAll(); }, () => renderAll()); } catch (e) { renderAll(); } }
})();
