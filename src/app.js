/* FitFilePlus UI. Depends on globals: L (Leaflet), uPlot, parseFit, parseActivityText. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  // one-time carry-over of settings saved under the project's earlier name
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.indexOf('corosplus.') === 0) { const nk = 'fitfileplus.' + k.slice(10); if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k)); localStorage.removeItem(k); }
    }
  } catch (e) { /* storage unavailable */ }
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fitfileplus.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('fitfileplus.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem('fitfileplus.' + k); } catch (e) { /* ignore */ } },
  };

  // formatting and numeric helpers shared with the compare page live in src/core.js
  const { fmtDur, fmtPace, fx, lerpStops, roll, quantile } = window.FFCore;

  // ---------- colours ----------
  const C = { purple: '#a855f7', blue: '#3b82f6', green: '#22c55e', orange: '#f59e0b', red: '#ef4444', grey: '#8a8f9c' };
  // relative colour scales; plasma has no greens so it stays readable over forest/terrain map colours
  const PALETTES = { plasma: ['#2c0594', '#7e03a8', '#cc4778', '#f89540', '#f0f921'], viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] };
  let SEQ = PALETTES[store.get('palette', 'plasma')] || PALETTES.plasma;
  // gradient (grade) colour scales, downhill -> flat -> uphill
  const GRADE_PALS = {
    rwg: { name: 'Red / green', stops: ['#16a34a', '#4ade80', '#f3edc0', '#f08a6c', '#dc2626'] },
    rwb: { name: 'Red / blue', stops: ['#2166ac', '#67a9cf', '#eeeeee', '#ef8a62', '#b2182b'] },
    plasma: { name: 'Plasma', stops: ['#2c0594', '#7e03a8', '#cc4778', '#f89540', '#f0f921'] },
  };
  let DIV = (GRADE_PALS[store.get('gradePal', 'rwg')] || GRADE_PALS.rwg).stops;

  const REF = 'https://www8.garmin.com/manuals/webhelp/GUID-1E5740B3-60A1-4890-B39A-7587060D785A/EN-US/GUID-EE9E7F6F-49BE-4452-82E6-B40371D0AEC1.html';
  const DYN_LABELS = { purple: 'Elite · top 5%', blue: 'Great · 70–95th pct', green: 'Good · 30–69th pct', orange: 'Fair · 5–29th pct', red: 'Low · bottom 5%' };
  const dynBands = (edges, order) => ({ edges, colors: order.map((k) => C[k]), labels: order.map((k) => DYN_LABELS[k]) });
  const lowIsGood = ['purple', 'blue', 'green', 'orange', 'red'];
  const DYN_NOTE = `Bands: published running-dynamics reference gauges (percentiles of a large runner population; chest-sensor column). <a href="${REF}" target="_blank" rel="noopener">Source</a>. Values shift with speed — easy-pace running naturally shows longer contact time and lower cadence, so read bands as orientation, not verdicts. Wrist-based watches may read slightly differently from a chest strap.`;

  // value < edges[i] -> colors[i]; value >= last edge -> last colour
  const METRICS = {
    pace: { label: 'Pace', unit: '/km', color: '#22e06b', fmt: fmtPace, dir: -1, seq: true, rev: true },
    effort: { label: 'Effort Pace', unit: '/km', color: '#7dd3fc', fmt: fmtPace, dir: -1, seq: true, rev: true },
    hr: { label: 'Heart Rate', unit: 'bpm', color: '#f87171', fmt: fx(0),
      bands: { edges: [114, 133, 152, 171], colors: [C.grey, C.blue, C.green, C.orange, C.red], labels: ['Z1 · <60% max', 'Z2 · 60–70%', 'Z3 · 70–80%', 'Z4 · 80–90%', 'Z5 · >90%'] },
      note: 'Zones as % of maximum heart rate (default max 190 bpm). Set your own max HR below to recompute.' },
    power: { label: 'Power', unit: 'W', color: '#c084fc', fmt: fx(0), seq: true },
    cadence: { label: 'Cadence', unit: 'spm', color: '#fb923c', fmt: fx(0),
      bands: dynBands([153, 164, 174, 184], ['red', 'orange', 'green', 'blue', 'purple']), note: DYN_NOTE },
    gct: { label: 'Ground Contact Time', short: 'Ground Time', unit: 'ms', color: '#facc15', fmt: fx(0),
      bands: dynBands([218, 249, 278, 309], lowIsGood), note: DYN_NOTE },
    balance: { label: 'L/R Balance', unit: '% L', color: '#a3e635', fmt: fx(1),
      bands: { edges: [47.8, 49.3, 50.8, 52.3], colors: ['#1d4ed8', '#93c5fd', C.green, '#fca5a5', '#dc2626'], labels: ['Right-heavy · >52.2% R', 'Slightly right', 'Balanced', 'Slightly left', 'Left-heavy · >52.2% L'] },
      note: `Share of ground contact time spent on the left foot (FIT field stance_time_balance, computed on the watch). Green = balanced, red = more time on left foot, blue = more time on right foot; stronger colour = larger asymmetry. Band edges: published ground-contact balance gauge (balanced = 49.3–50.7% L). <a href="${REF}" target="_blank" rel="noopener">Source</a>.` },
    vo: { label: 'Stride Height', unit: 'cm', color: '#2dd4bf', fmt: fx(1),
      bands: dynBands([6.4, 8.2, 9.8, 11.6], lowIsGood), note: DYN_NOTE },
    vr: { label: 'Stride Ratio', unit: '%', color: '#4ade80', fmt: fx(1),
      bands: dynBands([6.1, 7.5, 8.7, 10.2], lowIsGood), note: 'Stride height ÷ stride length (vertical ratio); lower = less bounce per metre travelled. ' + DYN_NOTE },
    stride: { label: 'Stride Length', unit: 'cm', color: '#f472b6', fmt: fx(0), seq: true,
      note: 'No universal target: stride length depends on speed and leg length. Colour scale spans this run’s 5th–95th percentile.' },
    lss: { label: 'Leg Spring Stiffness', short: 'Leg Stiffness', unit: 'kN/m', color: '#e879f9', fmt: fx(1), seq: true,
      note: 'Recorded only by some watches, typically during a dedicated running form test. Models the leg as a spring: higher = stiffer leg that returns more energy per step, generally linked to better running economy. Scales with body weight and speed, so there is no universal target — compare against your own earlier tests at the same pace. Colour scale spans this activity’s 5th–95th percentile.' },
    temp: { label: 'Temperature', unit: '°C', color: '#fdba74', fmt: fx(0), seq: true,
      note: 'Measured at the watch, so it is skewed by skin warmth — usually reads above air temperature.' },
    alt: { label: 'Elevation', unit: 'm', color: '#38bdf8', fmt: fx(0), seq: true, fill: true },
    grade: { label: 'Grade', unit: '%', color: '#94a3b8', fmt: fx(1), div: [-12, 12] },
  };
  // one-line explanations shown when hovering a metric button
  const DESC = {
    pace: 'How fast you are moving, shown as pace (time per km or mile; lower = faster) or as speed, depending on the sport and settings.',
    effort: 'Pace adjusted for hills: the flat-ground pace that would cost the same effort. Recorded by some watches.',
    hr: 'Heart beats per minute.',
    power: 'Mechanical power in watts: estimated by the watch when running, measured by a power meter when cycling.',
    cadence: 'Steps per minute when running or walking, pedal revolutions per minute when cycling.',
    gct: 'How long each foot stays on the ground per step. Shorter usually goes with faster, more economical running.',
    balance: 'Share of ground contact time spent on the left foot. 50% is perfectly symmetric.',
    vo: 'Vertical oscillation: how far the body bounces up and down with each step. Less bounce wastes less energy.',
    vr: 'Stride height divided by stride length (vertical ratio). Lower means more of each step goes forward rather than up.',
    stride: 'Distance covered by one step.',
    lss: 'Leg modelled as a spring: higher = stiffer leg returning more energy per step. Recorded during running form tests.',
    temp: 'Temperature measured at the watch; skin warmth usually makes it read above air temperature.',
    alt: 'Height above sea level.',
    grade: 'Slope of the ground, computed from elevation over distance. Positive = uphill, negative = downhill.',
    // extra metrics picked up from the file
    gps_accuracy: 'Position error estimated by the GPS receiver. Lower is better; high values mean the track and pace are less trustworthy there.',
    respiration: 'Breaths per minute.',
    core_temp: 'Body core temperature from a dedicated sensor.',
    smo2: 'Oxygen saturation of the working muscle, from a muscle-oxygen sensor. Drops when the muscle uses oxygen faster than it is delivered.',
    thb: 'Total haemoglobin concentration in the muscle, from a muscle-oxygen sensor; follows blood volume under the sensor.',
    vertical_speed: 'Rate of climbing or descending.',
    stance_pct: 'Share of each step cycle spent on the ground.',
    power_balance: 'Share of cycling power produced by the left leg. 50% is symmetric.',
    torque_eff_l: 'Left leg: how much of the pedal force pushes the crank forward rather than against it.',
    torque_eff_r: 'Right leg: how much of the pedal force pushes the crank forward rather than against it.',
    pedal_smooth_l: 'Left leg: how evenly power is applied around the pedal stroke.',
    pedal_smooth_r: 'Right leg: how evenly power is applied around the pedal stroke.',
    pedal_smooth: 'How evenly power is applied around the pedal stroke (both legs).',
    pco_l: 'Left pedal: where on the pedal platform force is applied, relative to its centre.',
    pco_r: 'Right pedal: where on the pedal platform force is applied, relative to its centre.',
    battery: 'Battery charge of the device or bike.',
    motor_power: 'Power delivered by the e-bike motor.',
    ebike_range: 'Remaining range estimated by the e-bike.', ebike_battery: 'E-bike battery charge.', ebike_assist: 'Level of motor assistance.',
    pressure: 'Barometric air pressure at the device.',
    depth: 'Depth below the water surface.', ascent_rate: 'Rate of ascent while diving.',
    cns_load: 'Central nervous system oxygen toxicity load (diving).', n2_load: 'Nitrogen tissue loading (diving).', po2: 'Partial pressure of oxygen in the breathing gas (diving).',
    pressure_sac: 'Surface air consumption as pressure drop per minute (diving).', volume_sac: 'Surface air consumption as gas volume per minute (diving).', rmv: 'Respiratory minute volume (diving).',
    grit: 'Mountain-bike trail difficulty score from GPS, elevation and motion.', flow: 'Mountain-bike score for how smoothly speed is kept through the trail. Lower is smoother.',
    stress: 'Stress score estimated by the watch from heart-rate variability.',
    dev_grade: 'Slope as computed by the recording device.', resistance: 'Trainer resistance level.', cycle_length: 'Distance per stroke or cycle.', ball_speed: 'Speed of the ball.',
  };
  const descOf = (k) => { const m = METRICS[k]; return DESC[k] || (m.unknown ? 'In the file, but not part of the documented FIT profile: meaning and unit unknown.' : k.indexOf('dev_') === 0 ? 'Custom field defined by a watch app or connected sensor; name and unit as declared in the file.' : m.dynamic ? 'Extra value found in this file.' : ''); };
  const KEYS = Object.keys(METRICS);
  // themes: line colours tuned for dark backgrounds get darker counterparts on the light theme
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const DARK_COLORS = {}; for (const k of KEYS) DARK_COLORS[k] = METRICS[k].color;
  const LIGHT_COLORS = { pace: '#16a34a', effort: '#0284c7', hr: '#dc2626', power: '#9333ea', cadence: '#ea580c', gct: '#b98a00', balance: '#5f9a0c', vo: '#0d9488', vr: '#059669', stride: '#db2777', lss: '#c026d3', temp: '#c2410c', alt: '#0284c7', grade: '#64748b' };
  const lightMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function applyTheme(name) {
    if (!['system', 'dark', 'black', 'light'].includes(name)) name = 'system';
    const eff = name === 'system' ? (lightMQ && lightMQ.matches ? 'light' : 'dark') : name;
    if (eff === 'dark') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = eff;
    for (const k of KEYS) METRICS[k].color = (eff === 'light' && LIGHT_COLORS[k]) || DARK_COLORS[k];
    return name;
  }
  applyTheme(store.get('theme', 'system'));

  // ---------- extra metrics discovered in the loaded file ----------
  // Parsers report any further series they found (fit.extras + record.x). Each usable one becomes a
  // regular metric for as long as that file is loaded: chart line, map colour, legend, stats.
  const X_DARK = ['#fda4af', '#67e8f9', '#d9f99d', '#c4b5fd', '#fcd34d', '#f0abfc', '#5eead4', '#fdba74'];
  const X_LIGHT = ['#be123c', '#0e7490', '#4d7c0f', '#6d28d9', '#b45309', '#a21caf', '#0f766e', '#c2410c'];
  function registerExtras(fit) {
    for (let i = KEYS.length - 1; i >= 0; i--) if (METRICS[KEYS[i]].dynamic) { delete DARK_COLORS[KEYS[i]]; delete LIGHT_COLORS[KEYS[i]]; delete METRICS[KEYS[i]]; KEYS.splice(i, 1); }
    const light = document.documentElement.dataset.theme === 'light';
    let n = 0;
    for (const e of fit.extras || []) {
      if (METRICS[e.key] || (e.unknown && !S.showUnknown)) continue;
      // usable = enough samples, actually varies, and is not a running total
      let cnt = 0, mn = Infinity, mx = -Infinity, prev = null, drops = 0;
      for (const r of fit.records) {
        const v = r.x ? r.x[e.key] : null; if (v == null) continue;
        cnt++; if (v < mn) mn = v; if (v > mx) mx = v;
        if (prev != null && v < prev) drops++; prev = v;
      }
      if (cnt < 20 || mx === mn) continue;
      if (drops === 0 && cnt > 50) continue; // never decreases: cumulative counter
      const span = mx - mn, dec = span >= 50 ? 0 : span >= 5 ? 1 : 2;
      DARK_COLORS[e.key] = X_DARK[n % X_DARK.length]; LIGHT_COLORS[e.key] = X_LIGHT[n % X_LIGHT.length]; n++;
      METRICS[e.key] = { label: e.label, unit: e.unit || '', fmt: fx(dec), seq: true, dynamic: true, unknown: e.unknown, color: light ? LIGHT_COLORS[e.key] : DARK_COLORS[e.key],
        note: e.unknown ? 'Unidentified field: present in the file but not part of the documented FIT profile, so its meaning and unit are unknown.' : 'Found in this file and shown as recorded (no unit conversion).' };
      KEYS.push(e.key);
    }
  }

  // ---------- units ----------
  // Data arrays are converted to the display unit when a file is processed, so charts, stats and
  // colour scales all work in what the user sees. Changing units re-processes the loaded activity.
  const U = (function () {
    const st = store.get('units', {});
    return { imp: !!st.imp, mode: st.mode || (st.speed === true ? 'speed' : 'auto'), speed: false, sport: null };
  })();
  // sports where speed is the natural reading (FIT sport ids: cycling, skiing, e-bike, motor, sailing, skating, board sports, ...); all others use pace
  const SPEED_SPORTS = new Set([2, 13, 14, 20, 21, 22, 23, 24, 26, 30, 32, 33, 34, 36, 38, 39, 40, 42, 43, 44, 76, 77, 81]);
  const SPORT_NAMES = { 1: 'Run', 2: 'Ride', 5: 'Swim', 11: 'Walk', 12: 'Cross-country ski', 13: 'Ski', 14: 'Snowboard', 15: 'Row', 16: 'Mountaineering', 17: 'Hike', 19: 'Paddle', 21: 'E-bike ride',
    30: 'Inline skate', 31: 'Climb', 32: 'Sail', 33: 'Ice skate', 35: 'Snowshoe', 37: 'Stand-up paddle', 38: 'Surf', 41: 'Kayak', 43: 'Windsurf', 44: 'Kitesurf', 53: 'Dive' };
  const saveUnits = () => store.set('units', { imp: U.imp, mode: U.mode });
  // "auto" follows the sport of the loaded activity
  function resolveSpeed(sport) { if (sport !== undefined) U.sport = sport; U.speed = U.mode === 'speed' || (U.mode === 'auto' && SPEED_SPORTS.has(U.sport)); }
  resolveSpeed();
  const UN = { DM: 1000, du: 'km', EF: 1, eu: 'm', tu: '°C' }; // metres per distance unit, labels, elevation factor
  function applyUnits() {
    UN.DM = U.imp ? 1609.344 : 1000; UN.du = U.imp ? 'mi' : 'km';
    UN.EF = U.imp ? 3.28084 : 1; UN.eu = U.imp ? 'ft' : 'm'; UN.tu = U.imp ? '°F' : '°C';
    const pu = U.speed ? (U.imp ? 'mph' : 'km/h') : '/' + UN.du;
    for (const [k, base] of [['pace', 'Pace'], ['effort', 'Effort Pace']])
      Object.assign(METRICS[k], { label: U.speed ? base.replace('Pace', 'Speed') : base, unit: pu, fmt: U.speed ? fx(1) : fmtPace, dir: U.speed ? 1 : -1, rev: !U.speed });
    METRICS.alt.unit = UN.eu; METRICS.temp.unit = UN.tu;
  }
  applyUnits();
  const spd = (v) => (v != null && v > 0.5 ? (U.speed ? (v * 3600) / UN.DM : UN.DM / v) : null);             // m/s -> pace or speed
  const paceOf = (sec, units) => (sec > 0 && units > 0 ? (U.speed ? (units / sec) * 3600 : sec / units) : null); // time + distance -> pace or speed
  const tempOf = (c) => (c == null ? null : U.imp ? (c * 9) / 5 + 32 : c);
  const elevOf = (m) => (m == null ? null : m * UN.EF);
  const PACE = () => (U.speed ? 'Speed' : 'Pace');
  const DEFAULT_EDGES = {};
  for (const k of KEYS) if (METRICS[k].bands) DEFAULT_EDGES[k] = METRICS[k].bands.edges.slice();
  const savedEdges = store.get('edges', {});
  for (const k in savedEdges) if (METRICS[k] && METRICS[k].bands && savedEdges[k].length === DEFAULT_EDGES[k].length) METRICS[k].bands.edges = savedEdges[k];

  function bandIndex(m, v) { const e = m.bands.edges; let i = 0; while (i < e.length && v >= e[i]) i++; return i; }
  // banded metrics can be drawn as zones (default) or as a continuous scale; choice saved per metric
  const modes = store.get('modes', {});
  const isZones = (key) => !!METRICS[key].bands && modes[key] !== 'cont';
  const BAL = ['#1d4ed8', '#93c5fd', '#22c55e', '#fca5a5', '#dc2626'], BAL_DOM = [47, 53]; // continuous L/R balance: blue = right, red = left
  const bandColor = (key, v) => METRICS[key].bands.colors[bandIndex(METRICS[key], v)];
  function colorOf(key, v) {
    const m = METRICS[key];
    if (v == null || !isFinite(v)) return C.grey;
    if (isZones(key)) return m.bands.colors[bandIndex(m, v)];
    if (m.div) return lerpStops(DIV, (v - m.div[0]) / (m.div[1] - m.div[0]));
    if (key === 'balance') return lerpStops(BAL, Math.round(((v - BAL_DOM[0]) / (BAL_DOM[1] - BAL_DOM[0])) * 23) / 23);
    const [lo, hi] = A.dom[key];
    let t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    if (m.rev) t = 1 - t;
    return lerpStops(SEQ, Math.round(t * 23) / 23); // quantised so segments merge
  }

  // ---------- activity state ----------
  let A = null; // processed activity
  const S = {
    metrics: store.get('metrics', ['pace', 'hr', 'alt']),
    xMode: store.get('xMode', 'mt'),
    colorBy: store.get('colorBy', 'gct'),
    layer: store.get('layer', 'topo'),
    follow: store.get('follow', true),
    chartColors: store.get('chartColors', false),
    gradeFill: store.get('gradeFill', true),
    smoothSec: store.get('smoothSec', 5),
    showUnknown: store.get('showUnknown', false),
    lineW: store.get('lineW', 6),
    preview: null,
    chartH: store.get('chartH', 300),
    sel: null, // [lo, hi] inclusive record indices, or null
    hover: null,
  };

  function fillNearest(arr) {
    const out = arr.slice(); let last = null;
    for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; }
    last = null;
    for (let i = out.length - 1; i >= 0; i--) { if (out[i] == null) out[i] = last; else last = out[i]; }
    return out;
  }

  function process(fit, fileName) {
    const R = fit.records;
    if (R.length < 2) throw new Error('No per-second records in this FIT file');
    const n = R.length, t0 = R[0].t;
    const sport = fit.session.sport, foot = sport == null || sport === 1 || sport === 11 || sport === 17;
    if (!foot && !fit._cadFixed) { // parser doubles cadence (strides -> steps); undo for cycling etc.
      fit._cadFixed = true;
      for (const r of R) if (r.cadence != null) r.cadence /= 2;
      for (const o of fit.laps.concat([fit.session])) for (const k of ['avgCadence', 'maxCadence']) if (o[k] != null) o[k] /= 2;
    }
    if (!R.some((r) => r.dist != null) && R.some((r) => r.lat != null)) { // no distance field: integrate GPS
      let acc = 0, pl = null, po = null; const rad = Math.PI / 180;
      for (const r of R) {
        if (r.lat != null && r.lon != null) {
          if (pl != null) { const dy = (r.lat - pl) * rad, dx = (r.lon - po) * rad * Math.cos(r.lat * rad); acc += 6371000 * Math.sqrt(dx * dx + dy * dy); }
          pl = r.lat; po = r.lon;
        }
        r.dist = acc;
      }
    }
    if (!fit.noTime && !R.some((r) => r.speed != null) && R.some((r) => r.dist > 0)) { // no speed field: differentiate distance
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 3), b = Math.min(n - 1, i + 3), dt = (R[b].t - R[a].t) / 1000;
        if (R[a].dist != null && R[b].dist != null && dt > 0 && dt < 60) R[i].speed = (R[b].dist - R[a].dist) / dt;
      }
    }
    const et = new Array(n), mt = new Array(n), km = new Array(n);
    const dts = []; for (let i = 1; i < n; i++) dts.push((R[i].t - R[i - 1].t) / 1000);
    const step = quantile(dts, 0.5) || 1, gap = Math.max(10, step * 5);
    let m = 0, d = 0;
    for (let i = 0; i < n; i++) {
      et[i] = (R[i].t - t0) / 1000;
      if (i) { const dt = (R[i].t - R[i - 1].t) / 1000; m += dt > gap ? step : dt; }
      mt[i] = m;
      if (R[i].dist != null && R[i].dist > d) d = R[i].dist;
      km[i] = d / UN.DM;
    }
    const pauses = [];
    for (let i = 0; i < n - 1; i++) { const dt = (R[i + 1].t - R[i].t) / 1000; if (dt > gap) pauses.push({ i, dur: dt }); }
    const pc = new Array(n).fill(0); // pc[i] = pauses before record i; pc[j] - pc[i] > 0 means a pause lies between i and j
    { let c = 0, q = 0; for (let i = 0; i < n; i++) { pc[i] = c; if (q < pauses.length && pauses[q].i === i) { c++; q++; } } }
    const raw = {};
    const col = (f) => R.map((r) => { const v = f(r); return v == null || !isFinite(v) ? null : v; });
    raw.pace = col((r) => spd(r.speed));
    raw.effort = col((r) => spd(r.effort));
    for (const k of ['hr', 'power', 'cadence', 'gct', 'balance', 'vo', 'vr', 'stride', 'lss', 'temp', 'alt']) raw[k] = col((r) => r[k]);
    const XK = KEYS.filter((k) => METRICS[k].dynamic);
    for (const k of XK) raw[k] = col((r) => (r.x ? r.x[k] : null));
    for (const k of ['cadence', 'gct', 'balance', 'vo', 'vr', 'stride', 'power', 'lss', 'hr']) raw[k] = raw[k].map((v) => (v === 0 ? null : v));
    // fields logged less often than the record rate (e.g. cadence every 2nd second): bridge gaps of up to 6 s
    for (const k of ['hr', 'power', 'cadence', 'gct', 'balance', 'vo', 'vr', 'stride', 'lss', 'alt', 'pace', 'effort'].concat(XK)) {
      const a = raw[k]; let li = -1;
      for (let i = 0; i < n; i++) {
        if (a[i] == null) continue;
        if (li >= 0 && i - li > 1 && R[i].t - R[li].t <= 6000) for (let j = li + 1; j < i; j++) a[j] = a[li];
        li = i;
      }
    }
    { let last = null; raw.temp = raw.temp.map((v) => tempOf(v != null ? (last = v) : last)); } // temperature is logged sparsely: carry forward
    // grade over a ~±15-sample window
    const altSm = roll(raw.alt, 7, false); // metres; grade is unit-independent
    raw.grade = altSm.map((_, i) => { const altS = altSm;
      const a = Math.max(0, i - 15), b = Math.min(n - 1, i + 15), dd = (km[b] - km[a]) * UN.DM;
      return altS[a] != null && altS[b] != null && dd > 15 ? ((altS[b] - altS[a]) / dd) * 100 : null;
    });
    raw.alt = raw.alt.map(elevOf);
    const altS = altSm.map(elevOf);
    const has = {}, chart = {}, smooth = {}, dom = {}, rng = {};
    for (const k of KEYS) {
      has[k] = raw[k].some((v) => v != null);
      // smoothing window (seconds, user setting) -> half-width in samples. Chart: rolling mean.
      // Map colours: 11-sample median to kill single-sample flicker, then the same mean when it is wider.
      const hs = S.smoothSec > 0 ? Math.max(1, Math.round(S.smoothSec / step / 2)) : 0;
      chart[k] = k === 'alt' || k === 'grade' || !hs ? raw[k] : roll(raw[k], hs, false);
      smooth[k] = k === 'grade' ? raw[k] : !hs ? roll(raw[k], 1, true) : hs > 5 ? roll(roll(raw[k], 5, true), hs, false) : roll(raw[k], 5, true);
      dom[k] = [quantile(smooth[k], 0.05), quantile(smooth[k], 0.95)];
      const lo = quantile(chart[k], 0.005), hi = quantile(chart[k], 0.995), p = ((hi - lo) || 1) * 0.08;
      rng[k] = [lo - p, hi + p];
    }
    if (!KEYS.some((k) => has[k])) throw new Error('No usable data fields in this FIT file');
    const hasDist = km[n - 1] > 0.01;
    // records without a position take the position of the valid record nearest in time
    // (so points just after a long pause belong to the new location, not the old one)
    const lat = new Array(n).fill(null), lon = new Array(n).fill(null);
    {
      const prev = new Array(n).fill(-1); let p = -1;
      for (let i = 0; i < n; i++) { if (R[i].lat != null && R[i].lon != null) p = i; prev[i] = p; }
      let q = -1;
      for (let i = n - 1; i >= 0; i--) {
        if (R[i].lat != null && R[i].lon != null) q = i;
        const a = prev[i], src = a < 0 ? q : q < 0 ? a : (R[i].t - R[a].t <= R[q].t - R[i].t ? a : q);
        if (src >= 0) { lat[i] = R[src].lat; lon[i] = R[src].lon; }
      }
    }
    const hasGps = lat[0] != null;
    const idxAt = (t) => { let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (R[mid].t < t) lo = mid + 1; else hi = mid; } return lo; };
    const laps = fit.laps.filter((l) => l.start != null && l.end != null).map((l) => {
      // some devices stamp the lap with its start time: fall back to start + elapsed
      const endT = l.end > l.start ? l.end : l.start + (l.elapsed || l.timer || 0) * 1000;
      const lo = idxAt(l.start), hi = Math.max(lo, Math.min(n - 1, idxAt(endT)));
      return Object.assign({}, l, { lo, hi });
    });
    // best rolling kilometre (moving time)
    let best = null, kmBest = null, kmWorst = null;
    // best / worst lap by pace; ignore partial laps (e.g. the short last one)
    const maxLapDist = Math.max(0, ...laps.map((l) => l.dist || 0));
    let lapBest = null, lapWorst = null;
    laps.forEach((l, i) => {
      if (!l.dist || !l.timer || l.dist < maxLapDist * 0.5) return;
      const pc = l.timer / (l.dist / UN.DM); // seconds per distance unit: lower = faster
      if (!lapBest || pc < lapBest.pace) lapBest = { lap: i, lo: l.lo, hi: l.hi, pace: pc };
      if (!lapWorst || pc > lapWorst.pace) lapWorst = { lap: i, lo: l.lo, hi: l.hi, pace: pc };
    });
    if (lapBest && lapBest.lap === lapWorst.lap) lapBest = lapWorst = null; // a single lap is neither best nor worst
    for (let i = 0, j = 0; i < n; i++) {
      while (j < n - 1 && km[j] - km[i] < 1) j++;
      if (km[j] - km[i] >= 1 && km[j] - km[i] < 1.2 && pc[j] === pc[i] && mt[j] > mt[i]) { // skip windows spanning a pause or a GPS jump
        const tt = (mt[j] - mt[i]) / (km[j] - km[i]);
        if (best == null || tt < best) { best = tt; kmBest = { lo: i, hi: j, pace: tt }; }
        if (kmWorst == null || tt > kmWorst.pace) kmWorst = { lo: i, hi: j, pace: tt };
      }
    }
    if (U.speed) { for (const r of [lapBest, lapWorst, kmBest, kmWorst]) if (r) r.pace = 3600 / r.pace; if (best) best = 3600 / best; }
    const noTime = !!fit.noTime; // track without timestamps (plain KML / GPX route): no pace, no durations
    if (noTime) { best = null; kmBest = kmWorst = null; }
    return { fit, fileName, noTime, n, R, et, mt, km, raw, chart, smooth, dom, rng, has, lat, lon, hasGps, laps, bestKm: best, altS, pauses, pc, foot, hasDist, kmBest, kmWorst, lapBest, lapWorst };
  }

  function stats(lo, hi) {
    const out = { dur: A.mt[hi] - A.mt[lo], elapsed: A.et[hi] - A.et[lo], dist: A.km[hi] - A.km[lo], m: {} };
    for (const k of KEYS) {
      let s = 0, c = 0, mn = Infinity, mx = -Infinity;
      for (let i = lo; i <= hi; i++) { const v = A.raw[k][i]; if (v == null) continue; s += v; c++; if (v < mn) mn = v; if (v > mx) mx = v; }
      out.m[k] = c ? { avg: s / c, min: mn, max: mx } : null;
    }
    // pace averages via speed, not mean of pace
    if (out.dist > 0.01 && out.m.pace) out.m.pace.avg = paceOf(out.dur, out.dist);
    if (out.m.effort) { let s = 0, c = 0; for (let i = lo; i <= hi; i++) { const v = A.R[i].effort; if (v != null && v > 0.5) { s += v; c++; } } if (c) out.m.effort.avg = spd(s / c); }
    let up = 0, down = 0, ref = null;
    for (let i = lo; i <= hi; i++) { const a = A.altS[i]; if (a == null) continue; if (ref == null) ref = a; const dd = a - ref; if (dd >= UN.EF) { up += dd; ref = a; } else if (dd <= -UN.EF) { down -= dd; ref = a; } }
    out.up = up; out.down = down;
    return out;
  }
  // S.preview = range being dragged on the chart right now (not yet zoomed); it wins over the committed selection
  const activeSel = () => S.preview || S.sel;
  const selRange = () => activeSel() || [0, A.n - 1];

  // ---------- chart ----------
  let plot = null, ov = null, syncing = false, chartHot = false;
  const xArr = () => A[S.xMode];
  const fmtX = (v) => (S.xMode === 'km' ? v.toFixed(2) + ' ' + UN.du : fmtDur(v));

  // metrics drawn in the chart: the chosen ones, plus the map's colour metric when "colours in chart" is on
  const chartMetrics = () => {
    const a = S.metrics.filter((k) => A.has[k]);
    if (S.chartColors && A.has[S.colorBy] && !a.includes(S.colorBy)) a.push(S.colorBy);
    return a;
  };
  // stroke for the colour metric: vertical gradient over its y-scale, so each part of the line takes the
  // colour of its value - exactly the zone / colour-map colours used on the map
  const gradStroke = (k) => (u) => {
    const sc = u.scales[k], base = METRICS[k].color;
    if (!sc || sc.min == null || sc.max == null || sc.max === sc.min) return base;
    const y0 = u.valToPos(sc.min, k, true), y1 = u.valToPos(sc.max, k, true);
    if (!isFinite(y0) || !isFinite(y1) || y0 === y1) return base;
    const g = u.ctx.createLinearGradient(0, y0, 0, y1), N = 200;
    for (let i = 0; i <= N; i++) g.addColorStop(i / N, colorOf(k, sc.min + ((sc.max - sc.min) * i) / N));
    return g;
  };
  // colour settings changed (metric, zones/continuous, palette, band edges): refresh everything that shows them
  const gradeFillOn = () => S.gradeFill && A.has.alt && A.has.grade;
  function refreshColors() { drawTrack(); renderLegend(); if (S.chartColors && plot) { buildToggles(); buildChart(); } widgetsUpdate('colors'); }

  // ---------- hover help ----------
  // One small card for the whole UI. Any element with a title / data-tip gets it (titles are moved to
  // data-tip so the browser's own slow tooltip does not show as well); metric buttons get a richer card.
  (function () {
    const tip = document.createElement('div'); tip.id = 'chipTip'; tip.hidden = true; document.body.appendChild(tip);
    let cur = null, timer = 0;
    const hide = () => { clearTimeout(timer); cur = null; tip.hidden = true; };
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const show = (el) => {
      if (el.classList.contains('chip') && METRICS[el.dataset.key]) {
        const m = METRICS[el.dataset.key], d = descOf(el.dataset.key);
        tip.innerHTML = `<b>${m.label}</b>${m.unit ? ` <span class="muted">${m.unit}</span>` : ''}${d ? `<div>${d}</div>` : ''}<div class="muted hint">Click: show / hide · Double-click: only this one (again: restore)</div>`;
      } else if (el.dataset.tip) tip.innerHTML = esc(el.dataset.tip);
      else return;
      tip.hidden = false;
      const r = el.getBoundingClientRect(), w = tip.offsetWidth, hgt = tip.offsetHeight;
      tip.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left))) + 'px';
      tip.style.top = Math.round(r.bottom + 6 + hgt > window.innerHeight - 4 ? Math.max(4, r.top - hgt - 6) : r.bottom + 6) + 'px';
    };
    document.addEventListener('mouseover', (e) => {
      if (!e.target.closest) return;
      if (e.target.closest('.leaflet-container')) { hide(); return; } // the map keeps its native tooltips
      const el = e.target.closest('[title], [data-tip], .chip');
      if (el && el.hasAttribute('title')) { if (el.getAttribute('title')) el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); }
      if (el === cur) return;
      hide(); if (!el) return;
      cur = el; timer = setTimeout(() => { if (cur === el && document.contains(el)) show(el); }, el.classList.contains('chip') ? 120 : 380);
    });
    document.addEventListener('mousedown', hide, true);
    document.addEventListener('mouseleave', hide);
    window.addEventListener('scroll', hide, true);
  })();
  let lastChip = null, isoPrev = null; // double-click tracking for the metric chips
  function buildToggles() {
    const box = $('metricToggles'); box.innerHTML = '';
    let sepDone = false;
    for (const k of KEYS) {
      if (!A.has[k]) continue;
      if (METRICS[k].dynamic && !sepDone) { sepDone = true; const sp = document.createElement('span'); sp.className = 'chipsep'; sp.title = 'Further metrics found in this file'; box.appendChild(sp); }
      const b = document.createElement('button');
      b.className = 'chip' + (chartMetrics().includes(k) ? ' on' : ''); b.style.setProperty('--c', METRICS[k].color);
      b.innerHTML = `<i></i>${METRICS[k].label}`; b.disabled = !A.has[k];
      b.dataset.key = k;
      b.onclick = () => {
        const now = Date.now(), dbl = lastChip && lastChip.k === k && now - lastChip.t < 400;
        if (dbl) { // second click of a double-click: isolate, or restore what was shown before isolating
          const before = lastChip.before, alone = before.length === 1 && before[0] === k;
          S.metrics = alone && isoPrev ? isoPrev : [k];
          isoPrev = alone ? null : before;
          lastChip = null;
        } else {
          lastChip = { k, t: now, before: S.metrics.slice() };
          S.metrics = S.metrics.includes(k) ? S.metrics.filter((x) => x !== k) : S.metrics.concat(k);
        }
        store.set('metrics', S.metrics); buildToggles(); buildChart();
      };
      box.appendChild(b);
    }
  }

  // uPlot updates u.select on every mouse move while dragging but only fires setSelect on release,
  // so this is called from setCursor too: preview the dragged range on map + stats before zooming.
  function previewFromSelect(u) {
    const x = xArr(); let next = null;
    if (u.select.width > 2) {
      const a = u.posToVal(u.select.left, 'x'), b = u.posToVal(u.select.left + u.select.width, 'x'), n = A.n;
      let l = 0, r = n - 1;
      while (l < r) { const mid = (l + r) >> 1; if (x[mid] < a) l = mid + 1; else r = mid; }
      const lo = l; l = 0; r = n - 1;
      while (l < r) { const mid = (l + r + 1) >> 1; if (x[mid] > b) r = mid - 1; else l = mid; }
      if (l > lo) next = [lo, l];
    }
    if ((next && S.preview && next[0] === S.preview[0] && next[1] === S.preview[1]) || (!next && !S.preview)) return;
    S.preview = next; scheduleSelUpdate();
  }

  function buildChart() {
    if (plot) { plot.destroy(); plot = null; } if (ov) { ov.destroy(); ov = null; }
    const act = chartMetrics();
    const x = xArr(), w = Math.max(300, $('chart').clientWidth);
    const xIncrs = S.xMode === 'km' ? [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50] : [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
    const TH = { muted: cssVar('--muted'), line: cssVar('--line'), grid: cssVar('--grid'), text: cssVar('--text'), bg: cssVar('--bg') };
    const axisBase = { stroke: TH.muted, ticks: { stroke: TH.line, size: 4 }, font: '11px system-ui' };
    const scales = { x: { time: false } }, series = [{}], data = [x];
    const axes = [Object.assign({}, axisBase, { grid: { stroke: TH.grid, width: 1 }, incrs: xIncrs, space: 90, values: (u, vals) => vals.map((v) => (S.xMode === 'km' ? +v.toFixed(2) + '' : fmtDur(v))) })];
    act.forEach((k, i) => {
      const m = METRICS[k];
      scales[k] = { dir: m.dir || 1, range: () => A.rng[k] };
      const colored = S.chartColors && k === S.colorBy;
      series.push({ label: m.label, scale: k, stroke: colored ? gradStroke(k) : m.color, width: colored ? 2.2 : 1.4, spanGaps: false, points: { show: false }, fill: m.fill ? (gradeFillOn() ? undefined : m.color + '2e') : undefined });
      axes.push(Object.assign({}, axisBase, { scale: k, side: i % 2 ? 1 : 3, stroke: m.color, size: 46, grid: { show: i === 0, stroke: TH.grid, width: 1 }, values: (u, vals) => vals.map((v) => m.fmt(v)) }));
      data.push(A.chart[k]);
    });
    plot = new uPlot({
      width: w, height: S.chartH, scales, series, axes, legend: { show: false },
      cursor: { drag: { x: true, y: false }, points: { size: 7 } },
      hooks: {
        setCursor: [(u) => { previewFromSelect(u); if (!syncing && chartHot) setHover(u.cursor.idx == null || u.cursor.left < 0 ? null : u.cursor.idx, 'chart'); }],
        setScale: [(u, key) => { if (key === 'x') onXScale(u.scales.x.min, u.scales.x.max); }],
        setSelect: [(u) => previewFromSelect(u)],
        drawClear: [(u) => { // area under the elevation line, coloured by gradient
          if (!gradeFillOn() || !u.scales.alt || u.scales.x.min == null) return;
          const ctx = u.ctx, { left, top, width, height } = u.bbox, alt = A.chart.alt, gr = A.raw.grade, bottom = top + height;
          const i0 = Math.max(0, u.valToIdx(u.scales.x.min) - 1), i1 = Math.min(A.n - 1, u.valToIdx(u.scales.x.max) + 1);
          const step = Math.max(1, Math.floor((i1 - i0) / (width * 0.75))); // no more than ~1 strip per pixel
          ctx.save(); ctx.beginPath(); ctx.rect(left, top, width, height); ctx.clip(); ctx.globalAlpha = 0.72;
          for (let i = i0; i < i1; i += step) {
            const j = Math.min(i1, i + step);
            if (alt[i] == null || alt[j] == null || (S.xMode === 'et' && A.pc[j] !== A.pc[i])) continue;
            const xa = u.valToPos(x[i], 'x', true), xb = u.valToPos(x[j], 'x', true) + 0.7;
            ctx.fillStyle = gr[i] == null && gr[j] == null ? '#4b5568' : colorOf('grade', gr[i] != null ? gr[i] : gr[j]);
            ctx.beginPath(); ctx.moveTo(xa, u.valToPos(alt[i], 'alt', true)); ctx.lineTo(xb, u.valToPos(alt[j], 'alt', true)); ctx.lineTo(xb, bottom); ctx.lineTo(xa, bottom); ctx.fill();
          }
          ctx.restore();
        }],
        draw: [(u) => { // pauses: dotted vertical (shaded band on the elapsed axis) + pause length
          const ctx = u.ctx, dpr = window.devicePixelRatio || 1, { left, top, width, height } = u.bbox;
          ctx.save(); ctx.beginPath(); ctx.rect(left, top, width, height); ctx.clip();
          ctx.setLineDash([3 * dpr, 4 * dpr]); ctx.strokeStyle = TH.text; ctx.lineWidth = 1.5 * dpr;
          ctx.font = `${11 * dpr}px system-ui`; ctx.textAlign = 'center';
          let lastRight = -1e9;
          for (const ps of A.pauses) {
            const x0 = u.valToPos(x[ps.i], 'x', true), x1 = u.valToPos(x[ps.i + 1], 'x', true);
            if (x1 < left || x0 > left + width) continue;
            if (x1 - x0 > 3 * dpr) { ctx.globalAlpha = 0.08; ctx.fillStyle = TH.text; ctx.fillRect(x0, top, x1 - x0, height); ctx.globalAlpha = 1; }
            for (const xx of (x1 - x0 > 3 * dpr ? [x0, x1] : [x0])) { ctx.beginPath(); ctx.moveTo(Math.round(xx) + 0.5, top); ctx.lineTo(Math.round(xx) + 0.5, top + height); ctx.stroke(); }
            const label = 'paused ' + fmtDur(ps.dur), tw = ctx.measureText(label).width, mid = Math.max(left + tw / 2 + 4, Math.min(left + width - tw / 2 - 4, (x0 + x1) / 2));
            if (mid - tw / 2 - 6 * dpr < lastRight) continue; // would overlap previous label
            lastRight = mid + tw / 2 + 6 * dpr;
            ctx.globalAlpha = 0.8; ctx.fillStyle = TH.bg; ctx.fillRect(mid - tw / 2 - 4 * dpr, top + 2 * dpr, tw + 8 * dpr, 16 * dpr);
            ctx.globalAlpha = 1; ctx.fillStyle = TH.text; ctx.fillText(label, mid, top + 14 * dpr);
          }
          ctx.restore();
        }],
      },
    }, data, $('chart'));
    plot.over.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { min, max } = plot.scales.x, x0 = x[0], x1 = x[x.length - 1], span = max - min;
      let a, b;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const d = ((e.deltaX || e.deltaY) > 0 ? 0.15 : -0.15) * span; a = min + d; b = max + d;
        if (a < x0) { b += x0 - a; a = x0; } if (b > x1) { a -= b - x1; b = x1; }
      } else {
        const c = plot.posToVal(e.offsetX, 'x'), f = e.deltaY < 0 ? 0.75 : 1 / 0.75;
        a = c - (c - min) * f; b = c + (max - c) * f;
      }
      plot.setScale('x', { min: Math.max(x0, a), max: Math.min(x1, b) });
    }, { passive: false });
    // chart-driven hover (and map follow) only while the mouse really is over the chart: uPlot also
    // re-fires its cursor hook when the x-range is changed from the map or the lap table
    chartHot = false;
    plot.over.addEventListener('mouseenter', () => { chartHot = true; });
    plot.over.addEventListener('mouseleave', () => { chartHot = false; setHover(null, 'chart'); });

    const ok = act[0] || KEYS.find((k) => A.has[k]);
    const om = METRICS[ok];
    ov = new uPlot({
      width: w, height: 56, legend: { show: false },
      scales: { x: { time: false }, y: { dir: om.dir || 1, range: () => A.rng[ok] } },
      axes: [{ show: false }, { show: false }],
      series: [{}, { stroke: om.color, width: 1, fill: om.color + '22', points: { show: false } }],
      cursor: { x: false, y: false, points: { show: false }, drag: { setScale: false, x: true, y: false } },
      hooks: {
        setCursor: [(u) => { if (u.select.width >= 3) plot.setScale('x', { min: u.posToVal(u.select.left, 'x'), max: u.posToVal(u.select.left + u.select.width, 'x') }); }],
        setSelect: [(u) => {
          if (u.select.width < 3) { plot.setScale('x', { min: x[0], max: x[x.length - 1] }); return; }
          plot.setScale('x', { min: u.posToVal(u.select.left, 'x'), max: u.posToVal(u.select.left + u.select.width, 'x') });
        }],
      },
    }, [x, A.chart[ok]], $('overview'));
    ov.over.addEventListener('dblclick', () => plot.setScale('x', { min: x[0], max: x[x.length - 1] }));
    // dragging inside the highlighted window moves it (keeps its width) instead of starting a new range.
    // Capture phase on the root so this runs before uPlot's own drag handler.
    const inWindow = (clientX) => {
      if (!S.sel) return false;
      const px = clientX - ov.over.getBoundingClientRect().left;
      return px >= ov.valToPos(x[S.sel[0]], 'x') && px <= ov.valToPos(x[S.sel[1]], 'x');
    };
    ov.root.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !inWindow(e.clientX)) return;
      e.stopImmediatePropagation(); e.preventDefault();
      const { min, max } = plot.scales.x, span = max - min, x0 = x[0], x1 = x[x.length - 1], perPx = (x1 - x0) / ov.over.clientWidth, startX = e.clientX;
      const move = (ev) => { const a = Math.max(x0, Math.min(x1 - span, min + (ev.clientX - startX) * perPx)); plot.setScale('x', { min: a, max: a + span }); };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.cursor = ''; };
      document.body.style.cursor = 'grabbing';
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }, true);
    ov.over.addEventListener('mousemove', (e) => { ov.over.style.cursor = inWindow(e.clientX) ? 'grab' : ''; });

    if (S.sel) plot.setScale('x', { min: x[S.sel[0]], max: x[S.sel[1]] });
    else syncOverview();
    renderReadout();
  }

  function syncOverview() {
    if (!ov) return;
    const x = xArr();
    if (!S.sel) { ov.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false); return; }
    const l = ov.valToPos(x[S.sel[0]], 'x'), r = ov.valToPos(x[S.sel[1]], 'x');
    ov.setSelect({ left: l, top: 0, width: Math.max(2, r - l), height: ov.over.clientHeight }, false);
  }

  function onXScale(min, max) {
    if (min == null || max == null) return;
    const x = xArr(), n = A.n;
    let lo = 0; while (lo < n - 1 && x[lo] < min - 1e-9) lo++;
    let hi = n - 1; while (hi > lo && x[hi] > max + 1e-9) hi--;
    const full = lo === 0 && hi === n - 1;
    const next = full ? null : [lo, hi];
    if ((next && S.sel && next[0] === S.sel[0] && next[1] === S.sel[1]) || (!next && !S.sel)) { syncOverview(); return; }
    S.sel = next;
    syncOverview(); scheduleSelUpdate();
  }
  function setSel(lo, hi, fit) {
    const x = xArr();
    if (lo == null) plot.setScale('x', { min: x[0], max: x[A.n - 1] });
    else plot.setScale('x', { min: x[lo], max: x[hi] });
    if (fit) fitMap();
  }
  let selRaf = 0;
  function scheduleSelUpdate() {
    if (selRaf) return;
    selRaf = requestAnimationFrame(() => { selRaf = 0; drawTrack(); renderSelStats(); renderLegend(); markLapRows(); widgetsUpdate('sel'); });
  }

  // "12:34 · 3.21 km" for a record; time is left out for tracks without timestamps
  const posLabel = (i) => [A.noTime ? null : fmtDur(A.mt[i]), A.hasDist ? A.km[i].toFixed(2) + ' ' + UN.du : null].filter(Boolean).join(' · ') || '#' + i;

  function renderReadout() {
    const i = S.hover, act = chartMetrics();
    if (i == null) { $('readout').innerHTML = '<span class="muted">Hover chart or track for values</span>'; return; }
    let h = `<span><b>${posLabel(i)}</b></span>`;
    for (const k of act) { const m = METRICS[k]; h += `<span style="color:${m.color}">${m.label} <b>${m.fmt(A.chart[k][i])}</b> ${m.unit}</span>`; }
    $('readout').innerHTML = h;
  }

  // ---------- hover sync ----------
  function setHover(i, src) {
    if (i === S.hover) return;
    S.hover = i; renderReadout(); widgetsUpdate('hover');
    if (src !== 'chart' && plot) {
      syncing = true;
      if (i == null) plot.setCursor({ left: -10, top: -10 });
      else { const l = plot.valToPos(xArr()[i], 'x'); plot.setCursor(l >= 0 && l <= plot.over.clientWidth ? { left: l, top: plot.over.clientHeight / 2 } : { left: -10, top: -10 }); }
      syncing = false;
    }
    if (!map) return;
    if (src === 'chart' && A.hasGps && S.follow) {
      if (i == null) restoreView();
      else {
        if (!savedView) savedView = { c: map.getCenter(), z: map.getZoom() };
        followTo = i;
        if (!followRaf) followRaf = requestAnimationFrame(() => { followRaf = 0; if (followTo != null && savedView) map.setView([A.lat[followTo], A.lon[followTo]], map.getZoom(), { animate: false }); });
      }
    }
    if (hoverMarker) {
      if (i == null || !A.hasGps) { hoverMarker.remove(); halo.remove(); return; }
      if (src === 'chart') { halo.setLatLng([A.lat[i], A.lon[i]]); if (!map.hasLayer(halo)) halo.addTo(map); } else halo.remove();
      hoverMarker.setLatLng([A.lat[i], A.lon[i]]);
      let h = `<b>${posLabel(i)}</b><br>`;
      for (const k of KEYS) {
        if (!A.has[k] || A.smooth[k][i] == null) continue;
        const m = METRICS[k], dot = m.bands ? `<span class="dot" style="background:${bandColor(k, A.smooth[k][i])}"></span>` : '';
        h += `<span class="k">${m.short || m.label}</span>${dot}${m.fmt(A.smooth[k][i])} ${m.unit}<br>`;
      }
      hoverMarker.setTooltipContent(h);
      if (!map.hasLayer(hoverMarker)) hoverMarker.addTo(map);
      hoverMarker.setStyle({ fillColor: colorOf(S.colorBy, A.smooth[S.colorBy][i]) });
      if (src === 'map') hoverMarker.openTooltip(); else hoverMarker.closeTooltip();
    }
  }

  // ---------- map ----------
  let savedView = null, followTo = null, followRaf = 0, halo = null;
  function restoreView() {
    followTo = null;
    if (savedView) { map.setView(savedView.c, savedView.z, { animate: false }); savedView = null; }
  }
  let canvasDim = null, scaleCtl = null;
  let map = null, baseLayer = null, trackGroup = null, markGroup = null, hoverMarker = null, canvas = null;
  const OSMA = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const LAYERS = {
    topo: { name: 'OpenTopoMap (trails, contours)', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', o: { maxNativeZoom: 17, subdomains: 'abc', attribution: OSMA + ', SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' } },
    osm: { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', o: { maxNativeZoom: 19, attribution: OSMA } },
    cyclosm: { name: 'CyclOSM (cycling)', url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', o: { maxNativeZoom: 20, subdomains: 'abc', attribution: OSMA + ' | <a href="https://www.cyclosm.org">CyclOSM</a>' } },
    swiss: { name: 'swisstopo (Switzerland only)', url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', o: { maxNativeZoom: 18, attribution: '&copy; <a href="https://www.swisstopo.admin.ch">swisstopo</a>' } },
    swissimg: { name: 'swisstopo aerial (Switzerland only)', url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg', o: { maxNativeZoom: 19, attribution: '&copy; <a href="https://www.swisstopo.admin.ch">swisstopo</a>' } },
    sat: { name: 'Esri satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', o: { maxNativeZoom: 19, attribution: 'Tiles &copy; Esri' } },
    none: { name: 'No basemap (dark)', url: '', o: {} },
    tf: { name: 'Thunderforest Outdoors (API key)', url: 'https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey={key}', o: { maxNativeZoom: 22, attribution: OSMA + ' | &copy; <a href="https://www.thunderforest.com">Thunderforest</a>' } },
  };

  function setLayer(id) {
    if (!LAYERS[id]) id = 'topo';
    let key = '';
    if (id === 'tf') {
      key = store.get('tfKey', '');
      if (!key) { key = (prompt('Thunderforest API key (free hobby tier at thunderforest.com). Stored only in this browser.') || '').trim(); if (!key) { $('layerSel').value = S.layer; return; } store.set('tfKey', key); }
    }
    S.layer = id; store.set('layer', id); $('layerSel').value = id;
    if (baseLayer) baseLayer.remove();
    baseLayer = null;
    if (!LAYERS[id].url) return;
    baseLayer = L.tileLayer(LAYERS[id].url, Object.assign({ maxZoom: 20, key }, LAYERS[id].o)).addTo(map);
    baseLayer.bringToBack();
  }

  function initMap() {
    if (map) return;
    canvas = L.canvas({ padding: 0.3, tolerance: 6 });
    map = L.map('map', { renderer: canvas, zoomSnap: 0.25, attributionControl: true });
    scaleCtl = L.control.scale({ imperial: U.imp, metric: !U.imp }).addTo(map);
    // de-emphasised (unselected) part of the track lives in its own semi-transparent layer: everything in it
    // is drawn opaque and the layer as a whole is faded, so overlapping line ends do not show as darker blobs
    const dimPane = map.createPane('trackDim'); dimPane.style.zIndex = 399; dimPane.style.opacity = 0.5; dimPane.style.pointerEvents = 'none';
    canvasDim = L.canvas({ pane: 'trackDim', padding: 0.3 });
    trackGroup = L.layerGroup().addTo(map); markGroup = L.layerGroup().addTo(map);
    hoverMarker = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 2.5, fillColor: '#000', fillOpacity: 1, interactive: false });
    halo = L.circleMarker([0, 0], { radius: 20, color: '#fff', weight: 2, opacity: 0.9, fillColor: '#fff', fillOpacity: 0.18, interactive: false });
    hoverMarker.bindTooltip('', { className: 'pt', direction: 'right', offset: [12, 0], opacity: 1 });
    // nearest track point to the mouse. near = index to stay close to (while dragging along the
    // track, so loops and out-and-back sections do not make the selection jump); anywhere = also
    // accept points further than the pick radius.
    const pick = (e, near, anywhere) => {
      const ll = e.latlng, kx = Math.cos(ll.lat * Math.PI / 180);
      const edge = map.containerPointToLatLng([e.containerPoint.x + 22, e.containerPoint.y]);
      const r2 = Math.pow((edge.lng - ll.lng) * kx, 2);
      const d2 = (i) => { const dx = (A.lon[i] - ll.lng) * kx, dy = A.lat[i] - ll.lat; return dx * dx + dy * dy; };
      if (near != null) {
        let best = -1, bi = Infinity, far = -1, fd = Infinity;
        // 1) closest point within the pick radius that is also close in time to where the drag is now
        // 2) else closest point anywhere on the track
        const win = Math.max(150, A.n / 15);
        let bd = r2;
        for (let i = 0; i < A.n; i++) {
          const d = d2(i);
          if (d < bd && Math.abs(i - near) <= win) { bd = d; best = i; }
          if (d < fd) { fd = d; far = i; }
        }
        return best >= 0 ? best : anywhere || fd < r2 ? far : -1;
      }
      let best = -1, bd = r2;
      const [lo, hi] = selRange();
      // prefer points inside the selection; fall back to any point
      for (let pass = 0; pass < 2 && best < 0; pass++) {
        const a = pass ? 0 : lo, b = pass ? A.n - 1 : hi;
        for (let i = a; i <= b; i++) { const d = d2(i); if (d < bd) { bd = d; best = i; } }
      }
      return best;
    };
    let mapDrag = null; // { start, last } while dragging along the track to select a section
    map.on('mousedown', (e) => {
      if (!A || !A.hasGps || (e.originalEvent && (e.originalEvent.button !== 0 || e.originalEvent.shiftKey))) return;
      const i = pick(e, null, false);
      if (i < 0) return;               // not on the track: normal map panning
      map.dragging.disable();          // on the track: this drag selects instead of panning
      mapDrag = { start: i, last: i };
    });
    map.on('mousemove', (e) => {
      if (!A || !A.hasGps) return;
      if (mapDrag) {
        const i = pick(e, mapDrag.last, true);
        if (i >= 0 && i !== mapDrag.last) {
          mapDrag.last = i;
          const lo = Math.min(mapDrag.start, i), hi = Math.max(mapDrag.start, i);
          if (hi - lo >= 2) setSel(lo, hi, false); // live: chart zoom, stats and map highlight follow
        }
        setHover(mapDrag.last, 'map');
        return;
      }
      const i = pick(e, null, false);
      map.getContainer().style.cursor = i < 0 ? '' : 'crosshair';
      setHover(i < 0 ? null : i, 'map');
    });
    window.addEventListener('mouseup', () => { if (mapDrag) { mapDrag = null; map.dragging.enable(); } });
    map.on('mouseout', () => setHover(null, 'map'));
    const ls = $('layerSel');
    for (const id in LAYERS) ls.add(new Option(LAYERS[id].name, id));
    ls.onchange = () => setLayer(ls.value);
    setLayer(S.layer);
  }

  function drawTrack() {
    if (!map) return;
    trackGroup.clearLayers(); markGroup.clearLayers();
    if (!A.hasGps) return;
    const n = A.n, [lo, hi] = selRange(), key = S.colorBy, vals = A.smooth[key];
    // draw at most ~12k vertices: idx[] = record indices actually drawn (always includes selection ends)
    const stepN = Math.max(1, Math.ceil(n / 12000)), idx = [];
    for (let i = 0; i < n; i += stepN) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    if (activeSel()) { for (const v of [lo, hi]) if (!idx.includes(v)) idx.push(v); idx.sort((a, b) => a - b); }
    const m = idx.length, all = idx.map((i) => [A.lat[i], A.lon[i]]);
    const pLo = idx.indexOf(lo), pHi = idx.indexOf(hi);
    const dimmed = !!activeSel(), W = S.lineW;
    // casing
    // double casing: white outer edge reads on dark/satellite maps, dark inner edge on light maps
    const line = (pts, color, weight, dim, opacity) => L.polyline(pts, { color, weight, opacity: opacity == null ? 1 : opacity, interactive: false,
      lineCap: 'round', lineJoin: 'round', smoothFactor: 0.6, renderer: dim ? canvasDim : canvas }).addTo(trackGroup);
    const casing = (pts, w, dim) => { line(pts, '#ffffff', w + 5, dim, dim ? 1 : 0.9); line(pts, '#0b0f1a', w + 2.5, dim); };
    const parts = (a, b) => { // vertices a..b split into pieces at pauses
      const out = []; let cur = [all[a]];
      for (let q = a; q < b; q++) { if (A.pc[idx[q + 1]] !== A.pc[idx[q]]) { out.push(cur); cur = []; } cur.push(all[q + 1]); }
      out.push(cur); return out.filter((x) => x.length > 1);
    };
    if (dimmed) { casing(parts(0, m - 1), W * 0.6, true); casing(parts(pLo, pHi), W, false); } else casing(parts(0, m - 1), W, false);
    // colour runs; segment p joins drawn vertices p and p+1
    const gapMs = 10000;
    let start = 0, cur = null;
    const segKey = (p) => {
      const i = idx[p], j = idx[p + 1];
      if (A.pc[j] !== A.pc[i]) return null; // pause between these points: leave a gap
      const c = colorOf(key, vals[i] != null ? vals[i] : vals[j]);
      return (p >= pLo && p < pHi ? '1' : '0') + c;
    };
    const flush = (end) => {
      if (cur == null) return;
      const inSel = cur[0] === '1';
      line(all.slice(start, end + 1), cur.slice(1), inSel ? W : W * 0.6, !inSel); // round caps + joins: consecutive colour runs overlap into one smooth line
    };
    for (let p = 0; p < m - 1; p++) {
      const k = segKey(p);
      if (k !== cur) { flush(p); cur = k; start = p; }
    }
    flush(m - 1);
    // km markers
    const total = A.km[n - 1], stepKm = Math.max(1, Math.ceil(total / 30));
    let next = stepKm;
    for (let i = 1; A.hasDist && i < n && next <= total; i++) {
      if (A.km[i] >= next) {
        L.marker([A.lat[i], A.lon[i]], { interactive: false, icon: L.divIcon({ className: 'kmicon', html: String(next), iconSize: [20, 20] }) }).addTo(markGroup);
        next += stepKm;
      }
    }
    const end = (i, c, size) => L.marker([A.lat[i], A.lon[i]], { interactive: false, zIndexOffset: 500, icon: L.divIcon({ className: 'endicon', html: `<div style="width:100%;height:100%;border-radius:50%;background:${c}"></div>`, iconSize: [size, size] }) }).addTo(markGroup);
    end(0, '#22c55e', 16); end(n - 1, '#ef4444', 16);
    if (dimmed) { end(lo, '#ffffff', 12); end(hi, '#111111', 12); }
  }
  function fitMap() {
    if (!map || !A.hasGps) return;
    const [lo, hi] = selRange(), pts = [];
    for (let i = lo; i <= hi; i++) pts.push([A.lat[i], A.lon[i]]);
    map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], animate: false });
  }

  // ---------- legend / thresholds ----------
  function renderLegend() {
    const key = S.colorBy, m = METRICS[key], [lo, hi] = selRange(), vals = A.smooth[key];
    $('legendTitle').innerHTML = `${m.label} <span class="muted small">— ${activeSel() ? 'selection' : 'whole activity'}${A.hasGps ? '' : ' · time in each band'}</span>`;
    $('legendPick').hidden = A.hasGps;
    if (!A.hasGps) { const lp = $('legendPick'); lp.innerHTML = ''; for (const k of KEYS) if (A.has[k]) lp.add(new Option(METRICS[k].label, k)); lp.value = key; lp.onchange = () => { S.colorBy = lp.value; store.set('colorBy', S.colorBy); refreshColors(); }; }
    const zones = isZones(key);
    let h = '';
    if (m.bands) h += '<div class="row" style="margin-bottom:8px" title="Zones: colour by reference bands. Continuous: smooth colour scale that also shows variation inside a band."><span class="muted small">Colour as</span><div class="seg" id="modeSeg">' + [['zones', 'Zones'], ['cont', 'Continuous']].map(([k, t]) => `<button data-mode="${k}" class="${(k === 'zones') === zones ? 'on' : ''}">${t}</button>`).join('') + '</div></div>';
    if (zones) {
      const e = m.bands.edges, cnt = new Array(e.length + 1).fill(0); let tot = 0;
      for (let i = lo; i <= hi; i++) if (vals[i] != null) { cnt[bandIndex(m, vals[i])]++; tot++; }
      // show best band first for readability when the scale runs low->good
      const order = cnt.map((_, i) => i); if (m.bands.colors[0] === C.red && m.bands.colors[e.length] !== C.red) order.reverse();
      for (const i of order) {
        const range = i === 0 ? `< ${e[0]}` : i === e.length ? `≥ ${e[i - 1]}` : `${e[i - 1]} – ${e[i]}`;
        const pct = tot ? (cnt[i] / tot) * 100 : 0;
        h += `<div class="lg-row"><span class="lg-sw" style="background:${m.bands.colors[i]}"></span><span>${m.bands.labels[i]}</span><span class="lg-range">${range} ${m.unit}</span><span class="lg-bar"><i style="width:${pct}%;background:${m.bands.colors[i]}"></i></span><span class="lg-pct">${pct.toFixed(0)}%</span></div>`;
      }
      h += `<div class="lg-edit" title="Boundaries between the bands. Edit to set your own targets; saved in this browser."><span class="muted">Band edges (${m.unit})</span>${e.map((v, i) => `<input type="number" step="any" data-edge="${i}" value="${v}">`).join('')}<button class="btn small" id="edgeReset">Reset</button>`;
      if (key === 'hr') h += `<span class="muted">· max HR</span><input type="number" id="maxHr" value="${store.get('maxHr', 190)}">`;
      h += '</div>';
    } else {
      const bal = key === 'balance';
      const stops = m.div ? DIV : bal ? BAL : m.rev ? SEQ.slice().reverse() : SEQ;
      const [a, b] = m.div || (bal ? BAL_DOM : A.dom[key]);
      h += `<div class="lg-grad" style="background:linear-gradient(90deg,${stops.join(',')})"></div><div class="row between small muted"><span>${m.fmt(a)} ${m.unit}</span><span>${m.div ? 'downhill ← flat → uphill' : bal ? 'right ← balanced → left' : m.rev ? 'faster → slower' : 'low → high'}</span><span>${m.fmt(b)} ${m.unit}</span></div>`;

    }
    if (!zones && !m.div && key !== 'balance') {
      const cur = store.get('palette', 'plasma');
      h += '<div class="row" style="margin-top:8px" title="Colour scale for continuous colouring, from low to high values"><span class="muted small">Colour map</span><div class="seg" id="palSeg">' + Object.keys(PALETTES).map((k) => `<button data-pal="${k}" class="${k === cur ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('') + '</div></div>';
    }
    if (m.div) h += '<div class="row" style="margin-top:8px" title="Colours for downhill → flat → uphill"><span class="muted small">Colour map</span><div class="seg" id="gradeSeg">' + Object.keys(GRADE_PALS).map((k) => `<button data-gp="${k}" class="${k === store.get('gradePal', 'rwg') ? 'on' : ''}">${GRADE_PALS[k].name}</button>`).join('') + '</div></div>';
    h += `<label class="row small" style="margin-top:10px;cursor:pointer" title="Colour this metric's line in the chart by value, with the same colours as on the map. Other lines keep their own colour."><input type="checkbox" id="chartColorsChk" ${S.chartColors ? 'checked' : ''}> Show these colours in the chart <span class="muted">(${m.label} line)</span></label>`;
    const tip = [zones ? 'Bars show the share of time spent in each band. Band edges are editable and saved in this browser.' : m.div ? 'Fixed scale from −12% (downhill) to +12% (uphill).' : key === 'balance' ? 'Fixed scale from 47% to 53% left.' : 'Relative scale: spans this activity’s 5th–95th percentile.', m.bands ? '<b>Zones / Continuous</b>: draw this metric in its reference bands, or as a smooth colour scale that shows finer variation within a band.' : null, '<b>Show these colours in the chart</b>: the line of this metric in the chart is coloured by value with the same colours as the map; other lines keep their own colour.', m.note].filter(Boolean).join('<br><br>');
    $('legendInfoTip').innerHTML = tip;
    $('legend').innerHTML = h;
    const apply = (edges) => {
      m.bands.edges = edges; const all = store.get('edges', {}); all[key] = edges; store.set('edges', all);
      refreshColors(); renderSelStats(); renderLaps(); renderSummary();
    };
    $('legend').querySelectorAll('[data-edge]').forEach((inp) => {
      inp.onchange = () => {
        const edges = Array.from($('legend').querySelectorAll('[data-edge]')).map((x) => parseFloat(x.value));
        if (edges.some((v) => !isFinite(v)) || edges.some((v, i) => i && v <= edges[i - 1])) { toast('Band edges must be ascending numbers'); renderLegend(); return; }
        apply(edges);
      };
    });
    const ps = $('palSeg'); if (ps) ps.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; store.set('palette', b.dataset.pal); SEQ = PALETTES[b.dataset.pal]; refreshColors(); };
    const gs = $('gradeSeg'); if (gs) gs.onclick = (e) => { const b = e.target.closest('button'); if (b) setGradePal(b.dataset.gp); };
    const ms = $('modeSeg'); if (ms) ms.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.mode === 'cont') modes[key] = 'cont'; else delete modes[key]; store.set('modes', modes); refreshColors(); };
    $('chartColorsChk').onchange = () => { S.chartColors = $('chartColorsChk').checked; store.set('chartColors', S.chartColors); buildToggles(); buildChart(); };
    const rs = $('edgeReset'); if (rs) rs.onclick = () => { if (key === 'hr') store.del('maxHr'); apply(DEFAULT_EDGES[key].slice()); };
    const mh = $('maxHr'); if (mh) mh.onchange = () => { const v = parseFloat(mh.value); if (v > 100 && v < 250) { store.set('maxHr', v); apply([0.6, 0.7, 0.8, 0.9].map((p) => Math.round(v * p))); } };
  }

  // ---------- stats / laps / summary ----------
  const dot = (k, v) => (METRICS[k].bands && v != null && isFinite(v) ? `<span class="dot" style="background:${bandColor(k, v)}"></span>` : ''); // table dots always show the zone
  function renderSelStats() {
    const [lo, hi] = selRange(), st = stats(lo, hi);
    $('selTitle').textContent = activeSel() ? 'Selection · ' + [A.noTime ? null : `${fmtDur(A.mt[lo])} – ${fmtDur(A.mt[hi])}`, A.hasDist ? `${UN.du} ${A.km[lo].toFixed(2)} – ${A.km[hi].toFixed(2)}` : null].filter(Boolean).join(' · ') : 'Whole activity';
    $('resetSel').hidden = !S.sel; $('chartReset').hidden = !S.sel;
    const tl = [];
    if (A.hasDist) tl.push(['Distance', st.dist.toFixed(2), UN.du]);
    if (!A.noTime) tl.push(['Moving time', fmtDur(st.dur), '']);
    if (A.has.alt) tl.push(['Elev gain', st.up.toFixed(0), UN.eu], ['Descent', st.down.toFixed(0), UN.eu]);
    let h = `<div class="tiles" style="grid-template-columns:repeat(${tl.length},1fr);margin-bottom:10px">` + tl.map((t) => `<div class="tile"><div class="k">${t[0]}</div><div class="v">${t[1]}<span class="u">${t[2]}</span></div></div>`).join('') + '</div>';
    $('selStats').innerHTML = h;
    h = '<div class="tablewrap"><table><thead><tr><th>Metric</th><th>Avg</th><th>Min</th><th>Max</th></tr></thead><tbody>';
    for (const k of KEYS) {
      const s = st.m[k]; if (!s || k === 'alt') continue;
      const m = METRICS[k], slow = m.dir === -1; // for pace, "max" = fastest
      h += `<tr><td><span class="dot" style="background:${m.color}"></span>${m.label} <span class="muted small">${m.unit}</span></td><td>${dot(k, s.avg)}<b>${m.fmt(s.avg)}</b></td><td>${m.fmt(slow ? s.max : s.min)}</td><td>${m.fmt(slow ? s.min : s.max)}</td></tr>`;
    }
    $('selTable').innerHTML = h + '</tbody></table></div>';
  }

  // ---- lap table: sortable columns, column chooser, drag across rows to select several laps
  const lapUI = { sort: null, shownX: store.get('lapShownX', []), hidden: store.get('lapHidden', []), dots: store.get('lapDots', true), order: [], cols: [], drag: null };
  // built-in columns are shown unless hidden; columns for extra metrics (key "xm:...") are hidden unless switched on
  const lapHidden = (key) => (key.indexOf('xm:') === 0 ? !lapUI.shownX.includes(key) : lapUI.hidden.includes(key));
  function lapColumns() {
    const pc = (l) => (l.timer && l.dist ? paceOf(l.timer, l.dist / UN.DM) : null), pf = METRICS.pace.fmt;
    const cu = METRICS.cadence.unit, d = (k, v) => (lapUI.dots ? dot(k, v) : '');
    const eff = (l) => l.st.m.effort && l.st.m.effort.avg, lss = (l) => l.st.m.lss && l.st.m.lss.avg;
    // [key, title, cell html, raw value (sorting + "has data" test)]
    return [
      ['lap', 'Lap', (l) => l.index, (l) => l.index],
      ['dist', 'Distance', (l) => (l.dist / UN.DM).toFixed(2) + ' ' + UN.du, (l) => l.dist], ['time', 'Time', (l) => fmtDur(l.timer), (l) => l.timer], ['total', 'Total', (l) => fmtDur(A.mt[l.hi]), (l) => A.mt[l.hi]],
      ['pace', 'Avg ' + PACE(), (l) => pf(pc(l)), pc], ['effort', 'Effort ' + PACE() + ' ≈', (l) => pf(eff(l)), eff],
      ['hr', 'Avg HR', (l) => d('hr', l.avgHr) + fx(0)(l.avgHr), (l) => l.avgHr], ['power', 'Power', (l) => fx(0)(l.avgPower) + ' W', (l) => l.avgPower],
      ['cadence', 'Cadence', (l) => d('cadence', l.avgCadence) + fx(0)(l.avgCadence) + ' ' + cu, (l) => l.avgCadence], ['gct', 'Ground Time', (l) => d('gct', l.avgGct) + fx(0)(l.avgGct) + ' ms', (l) => l.avgGct],
      ['vo', 'Stride Height', (l) => d('vo', l.avgVo) + fx(1)(l.avgVo) + ' cm', (l) => l.avgVo], ['vr', 'Stride Ratio', (l) => d('vr', l.avgVr) + fx(1)(l.avgVr) + ' %', (l) => l.avgVr],
      ['stride', 'Stride Length', (l) => fx(0)(l.avgStride) + ' cm', (l) => l.avgStride], ['balance', 'L/R Balance', (l) => d('balance', l.avgBalance) + fx(1)(l.avgBalance) + ' %', (l) => l.avgBalance],
      ['lss', 'Leg Stiffness', (l) => fx(1)(lss(l)) + ' kN/m', lss],
      ['ascent', 'Elev Gain', (l) => fx(0)(elevOf(l.ascent)) + ' ' + UN.eu, (l) => l.ascent], ['descent', 'Descent', (l) => fx(0)(elevOf(l.descent)) + ' ' + UN.eu, (l) => l.descent], ['temp', 'Temp', (l) => fx(0)(tempOf(l.avgTemp)) + ' ' + UN.tu, (l) => l.avgTemp],
    ].concat(KEYS.filter((k) => METRICS[k].dynamic && A.has[k]).map((k) => { const m = METRICS[k], av = (l) => l.st.m[k] && l.st.m[k].avg; return ['xm:' + k, m.label, (l) => m.fmt(av(l)) + (m.unit ? ' ' + m.unit : ''), av]; }))
      .filter((c) => A.laps.some((l) => { const v = c[3](l); return v != null && isFinite(v) && v !== 0; }));
  }
  function renderLaps() {
    $('lapsCard').hidden = !A.laps.length;
    if (!A.laps.length) { $('laps').innerHTML = ''; return; }
    A.laps.forEach((l) => { if (!l.st) l.st = stats(l.lo, l.hi); });
    const avail = lapUI.cols = lapColumns();
    const cols = avail.filter((c) => c[0] === 'lap' || !lapHidden(c[0]));
    const num = (v) => (v == null || !isFinite(v) ? null : v);
    const order = A.laps.map((_, i) => i), srt = lapUI.sort && cols.find((c) => c[0] === lapUI.sort.key);
    if (srt) order.sort((a, b) => {
      const va = num(srt[3](A.laps[a])), vb = num(srt[3](A.laps[b]));
      if (va == null || vb == null) return (va == null) - (vb == null) || a - b; // empty cells always last
      return (va - vb) * lapUI.sort.dir || a - b;
    });
    lapUI.order = order;
    let h = '<thead><tr>' + cols.map((c) => `<th data-key="${c[0]}" title="Click to sort">${c[1]}${srt && srt[0] === c[0] ? (lapUI.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '</tr></thead><tbody>';
    order.forEach((i, pos) => {
      const l = A.laps[i];
      const tag = A.lapBest && A.lapBest.lap === i ? ['best', ' <span class="tag">★ best</span>'] : A.lapWorst && A.lapWorst.lap === i ? ['worst', ' <span class="tag">slowest</span>'] : ['', ''];
      h += `<tr data-lap="${i}" data-pos="${pos}" class="${tag[0]}">` + cols.map((c, ci) => { const v = c[3](l); return `<td>${v == null || !isFinite(v) ? '–' : c[2](l)}${ci === 0 ? tag[1] : ''}</td>`; }).join('') + '</tr>';
    });
    $('laps').innerHTML = h + '</tbody>';
    markLapRows();
    // column chooser menu
    const menu = $('lapMenu');
    menu.innerHTML = '<div class="mh">Columns</div>' + avail.filter((c) => c[0] !== 'lap').map((c) => `<label><input type="checkbox" data-col="${c[0]}" ${lapHidden(c[0]) ? '' : 'checked'}> ${c[1]}</label>`).join('') +
      `<div class="mh">Display</div><label><input type="checkbox" id="lapDots" ${lapUI.dots ? 'checked' : ''}> Colour indicators</label><button class="btn small" id="lapColsAll">Show all columns</button>`;
  }
  // delegated handlers (table and menu elements persist across re-renders)
  $('laps').addEventListener('click', (e) => {
    const th = e.target.closest('th'); if (!th || !A) return;
    const k = th.dataset.key, cur = lapUI.sort;
    lapUI.sort = !cur || cur.key !== k ? { key: k, dir: 1 } : cur.dir > 0 ? { key: k, dir: -1 } : null; // asc -> desc -> original order
    renderLaps();
  });
  const lapSpan = (a, b) => { // selection covering every lap between two displayed row positions
    let lo = Infinity, hi = -Infinity;
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) { const l = A.laps[lapUI.order[p]]; lo = Math.min(lo, l.lo); hi = Math.max(hi, l.hi); }
    return [lo, hi];
  };
  $('laps').addEventListener('mousedown', (e) => {
    const tr = e.target.closest('tbody tr'); if (!tr || e.button !== 0) return;
    lapUI.drag = { from: +tr.dataset.pos, to: +tr.dataset.pos, moved: false }; e.preventDefault();
  });
  $('laps').addEventListener('mouseover', (e) => {
    const tr = e.target.closest('tbody tr'), dg = lapUI.drag; if (!tr || !dg || +tr.dataset.pos === dg.to) return;
    dg.to = +tr.dataset.pos; dg.moved = true;
    const [lo, hi] = lapSpan(dg.from, dg.to); setSel(lo, hi, false); // live: chart, map highlight and stats follow the drag
  });
  window.addEventListener('mouseup', () => {
    const dg = lapUI.drag; if (!dg) return; lapUI.drag = null;
    if (dg.moved) { fitMap(); return; }
    const l = A.laps[lapUI.order[dg.from]]; // plain click: toggle that lap
    if (S.sel && S.sel[0] === l.lo && S.sel[1] === l.hi) setSel(null, null, true); else setSel(l.lo, l.hi, true);
  });
  // chart options menu: gradient-coloured elevation fill and its colour scale
  function setGradePal(k) {
    if (!GRADE_PALS[k]) return;
    store.set('gradePal', k); DIV = GRADE_PALS[k].stops; syncChartMenu();
    if (A) { drawTrack(); renderLegend(); if (plot) plot.redraw(false); }
  }
  function syncChartMenu() {
    $('gradeFillChk').checked = S.gradeFill; $('unknownChk').checked = S.showUnknown;
    $('smoothSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.s === S.smoothSec));
    $('gradePalBox').innerHTML = Object.keys(GRADE_PALS).map((k) => `<label><input type="radio" name="gradePal" value="${k}" ${k === store.get('gradePal', 'rwg') ? 'checked' : ''}> <span class="swatch" style="background:linear-gradient(90deg,${GRADE_PALS[k].stops.join(',')})"></span> ${GRADE_PALS[k].name}</label>`).join('');
  }
  syncChartMenu();
  $('chartGear').onclick = (e) => { e.stopPropagation(); $('lapMenu').hidden = true; $('chartMenu').hidden = !$('chartMenu').hidden; };
  $('chartMenu').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { $('chartMenu').hidden = true; });
  $('smoothSeg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.smoothSec = +b.dataset.s; store.set('smoothSec', S.smoothSec); syncChartMenu(); reprocess();
  };
  $('chartMenu').addEventListener('change', (e) => {
    if (e.target.id === 'unknownChk') { S.showUnknown = e.target.checked; store.set('showUnknown', S.showUnknown); if (A) { registerExtras(A.fit); reprocess(); } }
    else if (e.target.id === 'gradeFillChk') { S.gradeFill = e.target.checked; store.set('gradeFill', S.gradeFill); if (A && plot) buildChart(); }
    else if (e.target.name === 'gradePal') setGradePal(e.target.value);
  });
  $('lapGear').onclick = (e) => { e.stopPropagation(); $('chartMenu').hidden = true; $('lapMenu').hidden = !$('lapMenu').hidden; };
  $('lapMenu').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { $('lapMenu').hidden = true; });
  $('lapMenu').addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'lapDots') { lapUI.dots = t.checked; store.set('lapDots', lapUI.dots); }
    else if (t.dataset.col && t.dataset.col.indexOf('xm:') === 0) { lapUI.shownX = lapUI.shownX.filter((k) => k !== t.dataset.col); if (t.checked) lapUI.shownX.push(t.dataset.col); store.set('lapShownX', lapUI.shownX); }
    else if (t.dataset.col) { lapUI.hidden = lapUI.hidden.filter((k) => k !== t.dataset.col); if (!t.checked) lapUI.hidden.push(t.dataset.col); store.set('lapHidden', lapUI.hidden); }
    renderLaps();
  });
  $('lapMenu').addEventListener('click', (e) => { if (e.target.id === 'lapColsAll') { lapUI.hidden = []; store.set('lapHidden', []); lapUI.shownX = lapUI.cols.map((c) => c[0]).filter((k) => k.indexOf('xm:') === 0); store.set('lapShownX', lapUI.shownX); renderLaps(); } });

  function renderQuick() {
    const Q = [['Best lap', A.lapBest, 'best'], ['Worst lap', A.lapWorst, 'worst'], ['Best ' + UN.du, A.kmBest, 'best'], ['Worst ' + UN.du, A.kmWorst, 'worst']];
    const box = $('quickSel'); box.innerHTML = '';
    for (const [label, r, cls] of Q) {
      if (!r) continue;
      const b = document.createElement('button'); b.className = 'btn small q ' + cls;
      b.innerHTML = `${label}${r.lap != null ? ' ' + A.laps[r.lap].index : ''} · <b>${METRICS.pace.fmt(r.pace)}</b>${U.speed ? ' ' + METRICS.pace.unit : ''}`;
      b.title = `Select this section on chart and map · ${UN.du} ${A.km[r.lo].toFixed(2)} – ${A.km[r.hi].toFixed(2)}`;
      b.onclick = () => setSel(r.lo, r.hi, true);
      box.appendChild(b);
    }
  }
  function markLapRows() {
    $('laps').querySelectorAll('tbody tr').forEach((tr) => {
      const l = A.laps[+tr.dataset.lap];
      tr.classList.toggle('sel', !!S.sel && l.lo >= S.sel[0] - 1 && l.hi <= S.sel[1] + 1);
    });
  }

  function renderSummary() {
    const s = A.fit.session, st = stats(0, A.n - 1), g = (k) => (st.m[k] ? st.m[k].avg : null);
    const or = (a, b) => (a != null && isFinite(a) && a !== 0 ? a : b);
    const dist = A.hasDist ? or(s.dist, A.km[A.n - 1] * UN.DM) / UN.DM : null, pf = METRICS.pace.fmt, pu = METRICS.pace.unit, timer = A.noTime ? null : or(s.timer, A.mt[A.n - 1]);
    // [label, raw value, formatter, unit, band metric]; tiles without a value are dropped
    const T = [
      ['Distance', dist, fx(2), UN.du], ['Activity Time', timer, fmtDur, ''],
      ['Total Time', A.noTime ? null : or(s.elapsed, A.et[A.n - 1]), fmtDur, ''], ['Avg ' + PACE(), dist && timer ? paceOf(timer, dist) : null, pf, pu],
      ['Best ' + UN.du, A.bestKm, pf, pu], ['Effort ' + PACE(), s.avgEffort > 0.5 ? spd(s.avgEffort) : g('effort'), pf, pu],
      ['Avg HR', or(s.avgHr, g('hr')), fx(0), 'bpm'], ['Max HR', or(s.maxHr, st.m.hr ? st.m.hr.max : null), fx(0), 'bpm'],
      ['Avg Power', or(s.avgPower, g('power')), fx(0), 'W'], ['Calories', s.calories, fx(0), 'kcal'],
      ['Elev Gain', or(elevOf(s.ascent), A.has.alt ? st.up : null), fx(0), UN.eu], ['Total Descent', or(elevOf(s.descent), A.has.alt ? st.down : null), fx(0), UN.eu],
      ['Avg Cadence', or(s.avgCadence, g('cadence')), fx(0), METRICS.cadence.unit, 'cadence'],
      ['Ground Time', or(s.avgGct, g('gct')), fx(0), 'ms', 'gct'],
      ['Stride Height', or(s.avgVo, g('vo')), fx(1), 'cm', 'vo'],
      ['Stride Ratio', or(s.avgVr, g('vr')), fx(1), '%', 'vr'],
      ['Stride Length', or(s.avgStride, g('stride')), fx(0), 'cm'],
      ['L/R Balance', or(s.avgBalance, g('balance')), fx(1), '% L', 'balance'],
      ['Aerobic TE', s.aerobicTE, fx(1), ''], ['Anaerobic TE', s.anaerobicTE, fx(1), ''],
      ['Leg Stiffness', g('lss'), fx(1), 'kN/m'], ['Avg Temp', or(tempOf(s.avgTemp), g('temp')), fx(0), UN.tu],
    ].filter((t) => t[1] != null && isFinite(t[1]) && t[1] !== 0);
    $('summary').innerHTML = T.map((t) => `<div class="tile"><div class="k">${t[0]}</div><div class="v">${t[4] ? dot(t[4], t[1]) : ''}${t[2](t[1])}<span class="u">${t[3]}</span></div></div>`).join('');
  }

  // ---------- load ----------
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 4500); }

  // test hook: #drop=gps,laps,session,dist,speed,power,gct,... blanks those fields to simulate sparse files
  function dropFields(fit) {
    const list = (new URLSearchParams(location.hash.slice(1)).get('drop') || '').split(',').filter(Boolean);
    const avg = (k) => 'avg' + k[0].toUpperCase() + k.slice(1);
    for (const k of list) {
      if (k === 'laps') fit.laps = [];
      else if (k === 'session') fit.session = {};
      else if (k === 'gps') fit.records.forEach((r) => { r.lat = r.lon = null; });
      else { fit.records.forEach((r) => { r[k] = null; }); fit.laps.concat([fit.session]).forEach((o) => { o[avg(k)] = null; if (k === 'alt') o.ascent = o.descent = null; if (k === 'speed') o.avgSpeed = null; }); }
    }
    return fit;
  }
  const CAD_BANDS = METRICS.cadence.bands, CAD_NOTE = METRICS.cadence.note;
  const safe = (name, fn) => { try { fn(); } catch (e) { console.error(name, e); toast('Part of the page failed (' + name + '): ' + e.message); } };

  // FIT is binary with ".FIT" at byte 8; everything else supported is XML (GPX / TCX / KML)
  function parseAny(buf) {
    const b = new Uint8Array(buf);
    if (b.length > 12 && b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54) return parseFit(buf);
    return parseActivityText(new TextDecoder('utf-8').decode(b));
  }

  function syncUnits() {
    $('setMenu').querySelectorAll('[data-u]').forEach((b) => b.classList.toggle('on', String(U[b.dataset.u]) === b.dataset.v));
    const ab = $('autoBtn'); ab.removeAttribute('title');
    ab.dataset.tip = 'Chosen by sport: pace for running, walking, hiking, swimming; speed for cycling, skiing and similar.' + (A ? ` This ${(SPORT_NAMES[U.sport] || 'activity').toLowerCase()}: ${U.speed ? 'speed' : 'pace'}.` : '');
  }

  // The last opened file is kept in the browser (IndexedDB: binary-safe, no practical size limit) so a
  // reload brings it straight back. It never leaves the machine; "Close file" forgets it.
  const fileDB = {
    open() { return new Promise((res, rej) => { const r = indexedDB.open('fitfileplus', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    tx(mode, fn) { return this.open().then((db) => new Promise((res, rej) => { const t = db.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => { db.close(); res(q && q.result); }; t.onerror = t.onabort = () => { db.close(); rej(t.error); }; })); },
    set(v) { return this.tx('readwrite', (st) => st.put(v, 'last')); },
    get() { return this.tx('readonly', (st) => st.get('last')); },
    del() { return this.tx('readwrite', (st) => st.delete('last')); },
  };
  let lastFile = null; // raw bytes of the loaded file
  function load(buf, name, opts) {
    let act;
    try { const fit = dropFields(parseAny(buf)); registerExtras(fit); resolveSpeed(fit.session.sport == null ? null : fit.session.sport); applyUnits(); syncUnits(); act = process(fit, name); } catch (e) { console.error(e); toast('Could not read file: ' + e.message); return; }
    lastFile = { buf, name };
    if (!(opts && opts.noSave)) { try { fileDB.set({ name, buf, saved: Date.now() }).catch(() => {}); } catch (e) { /* storage unavailable */ } }
    $('closeFile').hidden = false;
    stopReplay();
    A = act; S.sel = null; S.preview = null; S.hover = null; lapUI.sort = null; savedView = null; followTo = null;
    syncUnits(); // now that an activity is loaded, the Auto tooltip can say what it resolved to
    $('empty').hidden = true; $('app').hidden = false;
    // cadence: steps/min with form bands for running/walking, plain rpm otherwise
    Object.assign(METRICS.cadence, A.foot ? { unit: 'spm', bands: CAD_BANDS, seq: false, note: CAD_NOTE } : { unit: 'rpm', bands: null, seq: true, note: null });
    const s = A.fit.session, d = new Date(A.R[0].t);
    const kind = SPORT_NAMES[s.sport] || (A.noTime ? 'Track' : 'Activity');
    $('actName').textContent = A.noTime ? kind + ' · no timestamps in file' : kind + ' · ' + d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('actSub').textContent = [A.noTime ? null : d.toLocaleTimeString(undefined, { timeStyle: 'short' }), A.fit.device.name, name, A.hasDist ? A.km[A.n - 1].toFixed(2) + ' ' + UN.du : null].filter(Boolean).join(' · ');
    document.title = 'FitFilePlus — ' + (A.noTime ? name || 'track' : d.toLocaleDateString());
    // only offer what this file contains
    const pref = store.get('colorBy', 'gct');
    S.colorBy = A.has[pref] ? pref : (['gct', 'cadence', 'hr', 'pace'].find((k) => A.has[k]) || KEYS.find((k) => A.has[k]));
    const cb = $('colorBy'); cb.innerHTML = '';
    for (const k of KEYS) if (A.has[k]) cb.add(new Option(METRICS[k].label, k));
    cb.value = S.colorBy;
    cb.onchange = () => { S.colorBy = cb.value; store.set('colorBy', S.colorBy); refreshColors(); };
    const prefX = store.get('xMode', 'mt');
    S.xMode = prefX === 'km' && !A.hasDist ? 'mt' : prefX;
    $('xMode').querySelector('[data-x=km]').hidden = !A.hasDist;
    $('xMode').querySelector('[data-x=et]').hidden = !A.pauses.length || A.noTime;
    $('xMode').querySelector('[data-x=mt]').hidden = A.noTime && A.hasDist;
    if (A.noTime && A.hasDist) S.xMode = 'km';
    if (S.xMode === 'et' && !A.pauses.length) S.xMode = 'mt';
    $('xMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.x === S.xMode));
    if (!S.metrics.some((k) => A.has[k])) S.metrics = S.metrics.concat(['pace', 'hr', 'alt', 'power', 'cadence'].filter((k) => A.has[k]).slice(0, 2));
    $('mapCard').hidden = !A.hasGps;
    if (A.hasGps) safe('map', initMap);
    safe('state', applyHash);
    safe('chart', () => { buildToggles(); buildChart(); });
    if (A.hasGps) safe('map', () => { map.invalidateSize(); fitMap(); drawTrack(); });
    safe('legend', renderLegend); safe('stats', renderSelStats); safe('laps', renderLaps); safe('summary', renderSummary); safe('quick', renderQuick);
    widgetsUpdate('load');
  }

  // optional state in URL hash: #color=gct&layer=topo&sel=1996-2777 (moving seconds)&m=pace,hr
  function applyHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('color') && A.has[p.get('color')]) { S.colorBy = p.get('color'); $('colorBy').value = S.colorBy; }
    if (map && p.get('layer') && LAYERS[p.get('layer')] && p.get('layer') !== 'tf') setLayer(p.get('layer'));
    if (p.get('cc')) S.chartColors = p.get('cc') === '1';
    if (p.get('mode') && METRICS[S.colorBy].bands) { if (p.get('mode') === 'cont') modes[S.colorBy] = 'cont'; else delete modes[S.colorBy]; }
    if (p.get('m')) S.metrics = p.get('m').split(',').filter((k) => METRICS[k]);
    if (p.get('wide')) setLayoutVars(Math.round(window.innerWidth / 2), Math.round(window.innerHeight * 0.7));
    const sel = (p.get('sel') || '').split('-').map(Number);
    if (sel.length === 2 && sel[1] > sel[0]) {
      let lo = 0; while (lo < A.n - 1 && A.mt[lo] < sel[0]) lo++;
      let hi = A.n - 1; while (hi > lo && A.mt[hi] > sel[1]) hi--;
      S.sel = [lo, hi];
    }
  }

  function readFile(f) {
    if (!f) return;
    const r = new FileReader(); r.onload = () => load(r.result, f.name); r.onerror = () => toast('Could not read file'); r.readAsArrayBuffer(f);
  }
  $('fileInput').onchange = (e) => { readFile(e.target.files[0]); e.target.value = ''; };
  let dragDepth = 0;
  const isFile = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (!isFile(e)) return; e.preventDefault(); dragDepth++; $('dropveil').hidden = false; });
  window.addEventListener('dragleave', (e) => { if (!isFile(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('dropveil').hidden = true; } });
  window.addEventListener('dragover', (e) => { if (isFile(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (!isFile(e)) return; e.preventDefault(); dragDepth = 0; $('dropveil').hidden = true; readFile(e.dataTransfer.files[0]); });

  $('xMode').onclick = (e) => {
    const b = e.target.closest('button'); if (!b || !A) return;
    S.xMode = b.dataset.x; store.set('xMode', S.xMode);
    $('xMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    buildChart();
  };
  $('resetSel').onclick = () => setSel(null, null, true);
  $('chartReset').onclick = () => setSel(null, null, true);
  $('fitBtn').onclick = () => fitMap();
  // replay: move the position dot along the selection (or whole track) at a multiple of real time
  let replay = null;
  function stopReplay() { if (!replay) return; cancelAnimationFrame(replay.raf); replay = null; $('playBtn').textContent = '▶'; }
  $('playSpeed').value = String(store.get('playSpeed', 60));
  $('playSpeed').onchange = () => { store.set('playSpeed', +$('playSpeed').value); if (replay) replay.speed = +$('playSpeed').value; };
  $('playBtn').onclick = () => {
    if (replay) { stopReplay(); return; }
    if (!A) return;
    const [lo, hi] = selRange();
    let i = S.hover != null && S.hover >= lo && S.hover < hi ? S.hover : lo, t = A.mt[i], last = performance.now();
    $('playBtn').textContent = '⏸';
    const step = (now) => {
      if (!replay) return;
      t += ((now - last) / 1000) * replay.speed; last = now;
      while (i < hi && A.mt[i + 1] <= t) i++;
      setHover(i, 'replay');
      if (S.follow && map && A.hasGps && !map.getBounds().pad(-0.15).contains([A.lat[i], A.lon[i]])) map.panTo([A.lat[i], A.lon[i]], { animate: false });
      if (i >= hi) { stopReplay(); return; }
      replay.raf = requestAnimationFrame(step);
    };
    replay = { speed: +$('playSpeed').value, raf: requestAnimationFrame(step) };
  };
  // a setting that changes the computed data (units, smoothing) was changed: recompute from the parsed
  // file and redraw. Same records, so indices - and with them the current selection - stay valid.
  function reprocess() {
    if (!A) return;
    const sel = S.sel; A = process(A.fit, A.fileName); S.sel = sel; S.preview = null;
    // the set of metrics may have changed (unidentified fields switched on/off): keep "Colour by" valid
    if (!A.has[S.colorBy]) S.colorBy = ['gct', 'cadence', 'hr', 'pace'].find((k) => A.has[k]) || KEYS.find((k) => A.has[k]);
    const cb = $('colorBy'); cb.innerHTML = ''; for (const k of KEYS) if (A.has[k]) cb.add(new Option(METRICS[k].label, k)); cb.value = S.colorBy;
    safe('chart', () => { buildToggles(); buildChart(); });
    safe('map', drawTrack); safe('legend', renderLegend); safe('stats', renderSelStats); safe('laps', renderLaps); safe('summary', renderSummary); safe('quick', renderQuick);
    widgetsUpdate('data');
  }
  // settings menu (gear, top right): theme and units
  $('setGear').onclick = (e) => { e.stopPropagation(); $('lapMenu').hidden = true; $('chartMenu').hidden = true; $('setMenu').hidden = !$('setMenu').hidden; };
  $('setMenu').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { $('setMenu').hidden = true; });
  syncUnits();
  $('setMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-u]'); if (!b) return;
    if (b.dataset.u === 'mode') U.mode = b.dataset.v; else U.imp = b.dataset.v === 'true';
    saveUnits(); resolveSpeed(); applyUnits(); syncUnits();
    if (scaleCtl && map) { scaleCtl.remove(); scaleCtl = L.control.scale({ imperial: U.imp, metric: !U.imp }).addTo(map); }
    if (!A) return;
    reprocess();
    $('actSub').textContent = $('actSub').textContent.replace(/[\d.]+ (km|mi)$/, A.hasDist ? A.km[A.n - 1].toFixed(2) + ' ' + UN.du : '');
  });
  $('themeSel').value = store.get('theme', 'system');
  const themeChanged = () => {
    if (!A) return;
    buildToggles(); buildChart(); renderSelStats(); renderLegend(); renderLaps(); renderSummary(); drawTrack(); widgetsUpdate('theme');
  };
  $('themeSel').onchange = () => { store.set('theme', applyTheme($('themeSel').value)); themeChanged(); };
  // "System": follow the device when it switches between light and dark
  if (lightMQ) { const onMQ = () => { if (store.get('theme', 'system') === 'system') { applyTheme('system'); themeChanged(); } }; if (lightMQ.addEventListener) lightMQ.addEventListener('change', onMQ); else if (lightMQ.addListener) lightMQ.addListener(onMQ); }
  $('lineW').value = S.lineW;
  $('lineW').oninput = () => { S.lineW = +$('lineW').value; store.set('lineW', S.lineW); if (A) drawTrack(); };
  $('followChk').checked = S.follow;
  $('followChk').onchange = () => { S.follow = $('followChk').checked; store.set('follow', S.follow); if (!S.follow && map) restoreView(); };
  $('wideBtn').onclick = () => {
    const big = $('map').clientHeight > 500;
    setLayoutVars(big ? 440 : Math.round(window.innerWidth / 2), big ? 400 : Math.round(window.innerHeight * 0.7), true);
    setTimeout(() => { if (map) { map.invalidateSize(); fitMap(); } }, 60);
  };
  function resize() {
    if (!plot || !$('chart').clientWidth) return;
    const w = Math.max(300, $('chart').clientWidth);
    plot.setSize({ width: w, height: S.chartH }); ov.setSize({ width: w, height: 56 }); syncOverview();
  }
  // ---------- layout: resizable columns / heights, draggable panels ----------
  function setLayoutVars(rw, mh, save) {
    if (rw != null) { $('app').style.setProperty('--rw', rw + 'px'); if (save) store.set('rw', rw); }
    if (mh != null) { $('map').style.height = mh + 'px'; if (save) store.set('mapH', mh); }
  }
  setLayoutVars(store.get('rw', null), store.get('mapH', null));
  function dragHandle(el, onMove, onEnd) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag');
      const move = (ev) => onMove(ev);
      const up = () => { el.classList.remove('drag'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); if (onEnd) onEnd(); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  }
  let curRw = null, curMh = null;
  dragHandle($('split'), (e) => {
    const r = $('app').getBoundingClientRect();
    curRw = Math.round(Math.max(260, Math.min(r.width - 28 - 320, r.right - 14 - e.clientX - 7)));
    setLayoutVars(curRw, null);
  }, () => { if (curRw != null) store.set('rw', curRw); });
  dragHandle($('mapGrip'), (e) => {
    curMh = Math.round(Math.max(160, e.clientY - $('map').getBoundingClientRect().top));
    setLayoutVars(null, curMh);
  }, () => { if (curMh != null) store.set('mapH', curMh); });
  dragHandle($('chartGrip'), (e) => {
    S.chartH = Math.round(Math.max(140, e.clientY - $('chart').getBoundingClientRect().top - 62));
    resize();
  }, () => store.set('chartH', S.chartH));

  // ---------- panels and widgets ----------
  // Every panel is a .card in one of the two columns. The six original panels are static HTML
  // ("built-ins", can be switched off); add-on widgets are registered by src/widgets.js and get
  // their card created on demand. Which ones are shown, their options, order and collapsed state
  // are all saved in the browser.
  const cols = [$('colL'), $('colR')];
  const folded = store.get('folded', {});
  const BUILTIN = { chartCard: 'Chart', mapCard: 'Map', legendCard: 'Legend', selCard: 'Selection stats', lapsCard: 'Laps', summaryCard: 'Summary' };
  const WDEF = {};                                   // add-on widget types: type -> definition
  const WLIVE = {};                                  // card id -> { type, card, inst, dirty }
  const WST = Object.assign({ off: {}, cards: [] }, store.get('widgets', {})); // off: hidden built-ins; cards: [{ id, type, opts }]
  const saveW = () => store.set('widgets', WST);
  const saveOrder = () => store.set('order', cols.map((c) => Array.from(c.children).map((x) => x.id)));
  let dragCard = null;

  function initCard(card) {
    const btn = card.querySelector('.fold');
    if (btn) {
      const set = (v) => { card.classList.toggle('collapsed', v); btn.textContent = v ? '▸' : '▾'; };
      set(!!folded[card.id]);
      btn.onclick = () => {
        const v = !card.classList.contains('collapsed'); set(v);
        if (v) folded[card.id] = true; else delete folded[card.id];
        store.set('folded', folded);
        if (!v) setTimeout(() => { resize(); if (map) map.invalidateSize(); const w = WLIVE[card.id]; if (w && w.dirty) widgetRun(w, 'load'); }, 30);
      };
    }
    card.querySelectorAll('.info').forEach((el) => { // keep info tooltips inside the viewport
      const tip = el.querySelector('.tip');
      const place = () => { tip.style.left = '-8px'; const r = tip.getBoundingClientRect(), over = r.right - (window.innerWidth - 12); if (over > 0) tip.style.left = Math.round(-8 - over) + 'px'; };
      el.addEventListener('mouseenter', place); el.addEventListener('focus', place);
    });
    card.querySelectorAll('.grip').forEach((g) => {
      g.draggable = true;
      g.addEventListener('dragstart', (e) => {
        dragCard = g.closest('.card'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragCard.id);
        e.dataTransfer.setDragImage(dragCard, 16, 16);
        const c = dragCard; setTimeout(() => c.classList.add('dragging'), 0);
      });
      g.addEventListener('dragend', () => {
        if (!dragCard) return;
        dragCard.classList.remove('dragging'); dragCard = null; saveOrder();
        if (map) map.invalidateSize();
      });
    });
  }
  document.querySelectorAll('.card').forEach(initCard);
  document.querySelectorAll('header .info').forEach((el) => el);
  $('selDetails').open = store.get('selDetails', false);
  $('selDetails').addEventListener('toggle', () => store.set('selDetails', $('selDetails').open));

  const DEFAULT_ORDER = cols.map((c) => Array.from(c.children).map((x) => x.id));
  function applyOrder(order) {
    order.forEach((ids, ci) => ids.forEach((id) => { const el = $(id); if (el && el.classList.contains('card')) cols[ci].appendChild(el); }));
  }
  const applySavedOrder = () => { const o = store.get('order', null); if (Array.isArray(o) && o.length === 2) applyOrder(o); };
  applySavedOrder();
  cols.forEach((col) => {
    col.addEventListener('dragover', (e) => {
      if (!dragCard) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      const cards = Array.from(col.children).filter((c) => c !== dragCard && !c.classList.contains('woff') && !c.hidden);
      const after = cards.find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (after) { if (after.previousElementSibling !== dragCard) col.insertBefore(dragCard, after); }
      else if (col.lastElementChild !== dragCard) col.appendChild(dragCard);
    });
    col.addEventListener('drop', (e) => { if (dragCard) e.preventDefault(); });
  });

  // built-ins: switched off = hidden with a class (their own data-dependent [hidden] logic stays untouched)
  function applyBuiltins() {
    for (const id in BUILTIN) $(id).classList.toggle('woff', !!WST.off[id]);
    setTimeout(() => { resize(); if (map) map.invalidateSize(); }, 30);
  }
  applyBuiltins();

  function widgetRun(w, reason) {
    if (!A || !w.inst) return;
    if (w.card.classList.contains('collapsed') || w.card.classList.contains('woff')) { w.dirty = true; return; }
    const def = WDEF[w.type], ok = !def.available || def.available(A);
    w.card.querySelector('.wna').hidden = ok; w.card.querySelector('.wbody').hidden = !ok;
    if (!ok) return;
    w.dirty = false;
    try { w.inst.update(reason); } catch (e) { console.error('widget ' + w.type, e); }
  }
  function widgetsUpdate(reason) { for (const id in WLIVE) widgetRun(WLIVE[id], reason); }

  function mountWidget(rec, colIdx) {
    const def = WDEF[rec.type]; if (!def || WLIVE[rec.id]) return;
    const card = document.createElement('div'); card.className = 'card'; card.id = rec.id;
    card.innerHTML = `<div class="hd"><span class="grip" title="Drag to move this panel">⠿</span><h3>${def.title}</h3><span class="info" tabindex="0">i<span class="tip"><span class="tb">${def.tip || ''}</span></span></span><span class="wctl"></span><span class="sp"></span>` +
      '<button class="iconbtn wclose" title="Remove this widget (add it again from the Widgets menu)" aria-label="Remove widget">×</button><button class="fold" title="Collapse / expand panel" aria-label="Collapse or expand panel">▾</button></div>' +
      '<div class="wna muted small" hidden>Not available: this file does not contain the data this widget needs.</div><div class="wbody"></div>';
    cols[colIdx == null ? (def.col === 'R' ? 1 : 0) : colIdx].appendChild(card);
    initCard(card);
    const w = WLIVE[rec.id] = { type: rec.type, card, inst: null, dirty: true };
    card.querySelector('.wclose').onclick = () => removeWidget(rec.id);
    rec.opts = rec.opts || {};
    try { w.inst = def.create({ card, body: card.querySelector('.wbody'), ctl: card.querySelector('.wctl'), opts: rec.opts, save: saveW, title: (t) => { card.querySelector('h3').textContent = t; } }); }
    catch (e) { console.error('widget ' + rec.type, e); }
    widgetRun(w, 'load');
  }
  function addWidget(type) {
    const def = WDEF[type]; if (!def) return;
    if (!def.multi) { const ex = WST.cards.find((c) => c.type === type); if (ex) { removeWidget(ex.id); return; } }
    let n = 1; while (WST.cards.some((c) => c.id === 'w_' + type + '_' + n)) n++;
    const rec = { id: 'w_' + type + '_' + n, type, opts: {} };
    WST.cards.push(rec); saveW(); mountWidget(rec); saveOrder(); renderWidgetMenu();
    WLIVE[rec.id].card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function removeWidget(id) {
    const w = WLIVE[id];
    if (w) { try { if (w.inst && w.inst.destroy) w.inst.destroy(); } catch (e) { /* ignore */ } w.card.remove(); delete WLIVE[id]; }
    WST.cards = WST.cards.filter((c) => c.id !== id); delete folded[id]; store.set('folded', folded);
    saveW(); saveOrder(); renderWidgetMenu();
  }
  function renderWidgetMenu() {
    let h = '<div class="mh">Panels</div>';
    for (const id in BUILTIN) h += `<label title="Show or hide the ${BUILTIN[id]} panel"><input type="checkbox" data-builtin="${id}" ${WST.off[id] ? '' : 'checked'}> ${BUILTIN[id]}</label>`;
    const types = Object.keys(WDEF);
    if (types.length) h += '<div class="mh">Add-ons</div>';
    for (const t of types) {
      const def = WDEF[t], na = A && def.available && !def.available(A), cnt = WST.cards.filter((c) => c.type === t).length;
      const tip = (def.tip || '').replace(/<[^>]*>/g, ' ').replace(/"/g, '&quot;') + (na ? ' — not available for the loaded file.' : '');
      h += def.multi
        ? `<button class="btn small wadd${na ? ' na' : ''}" data-add="${t}" title="${tip}">＋ ${def.title}${cnt ? ` <span class="muted">(${cnt})</span>` : ''}</button>`
        : `<label class="${na ? 'na' : ''}" title="${tip}"><input type="checkbox" data-add="${t}" ${cnt ? 'checked' : ''}> ${def.title}</label>`;
    }
    $('widgetMenu').innerHTML = h;
  }
  $('widgetBtn').onclick = (e) => { e.stopPropagation(); ['lapMenu', 'chartMenu', 'setMenu'].forEach((m) => { $(m).hidden = true; }); renderWidgetMenu(); $('widgetMenu').hidden = !$('widgetMenu').hidden; };
  $('widgetMenu').addEventListener('click', (e) => { e.stopPropagation(); const b = e.target.closest('button[data-add]'); if (b) addWidget(b.dataset.add); });
  $('widgetMenu').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.builtin) { if (t.checked) delete WST.off[t.dataset.builtin]; else WST.off[t.dataset.builtin] = true; saveW(); applyBuiltins(); }
    else if (t.dataset.add) addWidget(t.dataset.add);
  });
  document.addEventListener('click', () => { $('widgetMenu').hidden = true; });

  $('resetLayout').onclick = () => {
    ['rw', 'mapH', 'chartH', 'order', 'folded', 'widgets'].forEach((k) => store.del(k));
    for (const k in folded) delete folded[k];
    Object.keys(WLIVE).forEach((id) => { const w = WLIVE[id]; try { if (w.inst && w.inst.destroy) w.inst.destroy(); } catch (e) { /* ignore */ } w.card.remove(); delete WLIVE[id]; });
    WST.off = {}; WST.cards = []; applyBuiltins(); renderWidgetMenu();
    document.querySelectorAll('.card.collapsed').forEach((c) => { c.classList.remove('collapsed'); c.querySelector('.fold').textContent = '▾'; });
    $('app').style.removeProperty('--rw'); $('map').style.height = ''; S.chartH = 300;
    applyOrder(DEFAULT_ORDER); resize();
    setTimeout(() => { if (map) { map.invalidateSize(); fitMap(); } }, 60);
  };

  // API for src/widgets.js (and nothing else): read-only access to the loaded activity and the linking functions
  window.FFP = {
    get A() { return A; }, S, METRICS, KEYS, UN, U, LAYERS, store, cssVar,
    fmtDur, fmtPace, fx, quantile, roll, descOf, spd, paceOf, elevOf, PACE,
    colorOf, isZones, stats, selRange, activeSel, setSel, setHover, fitMap, posLabel,
    getMap: () => map,
    registerWidget(type, def) { WDEF[type] = def; },
    // called once by widgets.js after it registered everything: create the saved cards and restore their places
    widgetsReady() { WST.cards = WST.cards.filter((c) => WDEF[c.type]); WST.cards.forEach((c) => mountWidget(c)); applySavedOrder(); renderWidgetMenu(); },
  };

  if (window.ResizeObserver) {
    let rz = 0, lastW = 0;
    new ResizeObserver(() => { const w = $('chart').clientWidth; if (w === lastW) return; lastW = w; clearTimeout(rz); rz = setTimeout(resize, 30); }).observe($('chart'));
    let mz = 0;
    new ResizeObserver(() => { clearTimeout(mz); mz = setTimeout(() => { if (map) map.invalidateSize(); }, 30); }).observe($('map'));
  } else window.addEventListener('resize', resize);

  // test/demo hook: build.py --embed puts a base64 FIT file here
  $('resetAll').onclick = () => {
    if (!confirm('Reset all settings to their defaults?\n\nLayout, theme, units, chart metrics, smoothing, colours, band edges, map choice and lap table columns go back to default.')) return;
    try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.indexOf('fitfileplus.') === 0) localStorage.removeItem(k); } } catch (e) { /* ignore */ }
    // keep the activity open across the reload (session only; skipped if the file is too large for session storage)
    try {
      if (lastFile) { const b = new Uint8Array(lastFile.buf); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); sessionStorage.setItem('fitfileplus.reopen', JSON.stringify({ name: lastFile.name, data: btoa(bin) })); }
    } catch (e) { /* too large: user re-opens the file */ }
    location.reload();
  };
  const b64ToBuf = (s64) => { const bin = atob(s64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8.buffer; };
  try {
    const re = sessionStorage.getItem('fitfileplus.reopen');
    if (re) { sessionStorage.removeItem('fitfileplus.reopen'); const o = JSON.parse(re); load(b64ToBuf(o.data), o.name); }
  } catch (e) { /* ignore */ }
  $('closeFile').onclick = () => {
    const done = () => location.reload();
    try { fileDB.del().then(done, done); } catch (e) { done(); }
  };
  if (!A && window.FITFILEPLUS_EMBED) {
    const bin = atob(window.FITFILEPLUS_EMBED.data), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    load(u8.buffer, window.FITFILEPLUS_EMBED.name, { noSave: true });
  }
  // nothing loaded yet: bring back the file from the previous visit
  if (!A) { try { fileDB.get().then((v) => { if (v && v.buf && !A) load(v.buf, v.name, { noSave: true }); }, () => {}); } catch (e) { /* storage unavailable */ } }
})();
