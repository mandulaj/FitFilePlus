// Minimal FIT decoder: enough for activity files (records, laps, session, events).
// Works in browser and node. parseFit(ArrayBuffer) -> { records, laps, session, events, device, devFields }
(function (root) {
  'use strict';

  // base type number -> [size, reader, invalid]
  const BASE = {
    0: [1, 'getUint8', 0xff], 1: [1, 'getInt8', 0x7f], 2: [1, 'getUint8', 0xff],
    3: [2, 'getInt16', 0x7fff], 4: [2, 'getUint16', 0xffff],
    5: [4, 'getInt32', 0x7fffffff], 6: [4, 'getUint32', 0xffffffff],
    7: [1, 'string', null], 8: [4, 'getFloat32', null], 9: [8, 'getFloat64', null],
    10: [1, 'getUint8', 0], 11: [2, 'getUint16', 0], 12: [4, 'getUint32', 0],
    13: [1, 'getUint8', 0xff],
  };
  const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z in unix seconds
  const SEMI = 180 / 2147483648;

  function readField(dv, off, size, baseType, little) {
    const b = BASE[baseType & 0x1f];
    if (!b) return null;
    const [bs, fn, invalid] = b;
    if (fn === 'string') {
      let s = '';
      const bytes = new Uint8Array(dv.buffer, dv.byteOffset + off, size);
      let end = bytes.indexOf(0); if (end < 0) end = size;
      try { s = new TextDecoder('utf-8').decode(bytes.subarray(0, end)); } catch (e) { s = ''; }
      return s;
    }
    if (size < bs || size % bs) return null;
    const n = size / bs;
    const one = (o) => {
      const v = bs === 1 ? dv[fn](o) : dv[fn](o, little);
      if (invalid !== null && v === invalid) return null;
      if (invalid === null && Number.isNaN(v)) return null;
      return v;
    };
    if (n === 1) return one(off);
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(one(off + i * bs));
    return arr;
  }

  function decodeRaw(buf) {
    const dv = new DataView(buf);
    const hs = dv.getUint8(0);
    if (dv.byteLength < 12 || String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11)) !== '.FIT')
      throw new Error('Not a FIT file');
    const dataSize = dv.getUint32(4, true);
    let p = hs;
    const end = Math.min(hs + dataSize, dv.byteLength);
    const defs = {};
    const msgs = {}; // global num -> array of {fieldNum: value, dev: {"idx_num": value}}
    const devFieldDefs = {}; // "devIdx_fieldNum" -> {name, units, baseType}
    let lastTs = 0;

    while (p < end) {
      const h = dv.getUint8(p++);
      let local, compressedOffset = null;
      if (h & 0x80) { local = (h >> 5) & 3; compressedOffset = h & 0x1f; }
      else {
        local = h & 0x0f;
        if (h & 0x40) { // definition
          const little = dv.getUint8(p + 1) === 0;
          const global = dv.getUint16(p + 2, little);
          const n = dv.getUint8(p + 4);
          p += 5;
          const fields = [];
          for (let i = 0; i < n; i++, p += 3) fields.push([dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2)]);
          const dev = [];
          if (h & 0x20) {
            const nd = dv.getUint8(p++);
            for (let i = 0; i < nd; i++, p += 3) dev.push([dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2)]);
          }
          defs[local] = { little, global, fields, dev };
          continue;
        }
      }
      const d = defs[local];
      if (!d) throw new Error('FIT data message without definition at byte ' + p);
      const m = {};
      for (const [num, size, bt] of d.fields) {
        m[num] = readField(dv, p, size, bt, d.little);
        p += size;
      }
      for (const [num, size, devIdx] of d.dev) {
        const key = devIdx + '_' + num;
        const fd = devFieldDefs[key];
        if (fd) (m.dev || (m.dev = {}))[key] = readField(dv, p, size, fd.baseType, d.little);
        p += size;
      }
      if (compressedOffset !== null) {
        let ts = (lastTs & ~0x1f) | compressedOffset;
        if (compressedOffset < (lastTs & 0x1f)) ts += 0x20;
        m[253] = ts;
      }
      if (m[253] != null) lastTs = m[253];
      if (d.global === 206) { // field_description
        const one = (v) => (Array.isArray(v) ? v[0] : v);
        devFieldDefs[m[0] + '_' + m[1]] = { name: one(m[3]), units: one(m[8]), baseType: m[2], scale: one(m[6]), offset: one(m[7]), nativeMesg: m[14], nativeField: m[15] };
      }
      (msgs[d.global] || (msgs[d.global] = [])).push(m);
    }
    return { msgs, devFieldDefs };
  }

  // Further standard `record` fields (FIT profile): num -> [key, label, unit, scale].
  // Shown automatically when a file contains them.
  const REC_EXTRA = {
    9: ['dev_grade', 'Grade (device)', '%', 100], 10: ['resistance', 'Resistance', '', 1], 12: ['cycle_length', 'Cycle Length', 'm', 100],
    31: ['gps_accuracy', 'GPS Accuracy', 'm', 1], 32: ['vertical_speed', 'Vertical Speed', 'm/s', 1000],
    40: ['stance_pct', 'Stance Time', '%', 100],
    43: ['torque_eff_l', 'Torque Effectiveness L', '%', 2], 44: ['torque_eff_r', 'Torque Effectiveness R', '%', 2],
    45: ['pedal_smooth_l', 'Pedal Smoothness L', '%', 2], 46: ['pedal_smooth_r', 'Pedal Smoothness R', '%', 2], 47: ['pedal_smooth', 'Pedal Smoothness', '%', 2],
    51: ['ball_speed', 'Ball Speed', 'm/s', 100],
    54: ['thb', 'Total Haemoglobin', 'g/dL', 100], 57: ['smo2', 'Muscle Oxygen (SmO2)', '%', 10],
    67: ['pco_l', 'Platform Centre Offset L', 'mm', 1], 68: ['pco_r', 'Platform Centre Offset R', 'mm', 1],
    81: ['battery', 'Battery', '%', 2], 82: ['motor_power', 'Motor Power', 'W', 1], 87: ['cycle_length', 'Cycle Length', 'm', 100],
    91: ['pressure', 'Air Pressure', 'hPa', 100], 92: ['depth', 'Depth', 'm', 1000],
    97: ['cns_load', 'CNS Load', '%', 1], 98: ['n2_load', 'N2 Load', '%', 1],
    99: ['respiration', 'Respiration Rate', 'brpm', 1], 108: ['respiration', 'Respiration Rate', 'brpm', 100],
    114: ['grit', 'Grit', '', 1], 115: ['flow', 'Flow', '', 1], 116: ['stress', 'Stress', '', 100],
    117: ['ebike_range', 'E-bike Range', 'km', 1], 118: ['ebike_battery', 'E-bike Battery', '%', 1], 120: ['ebike_assist', 'E-bike Assist', '%', 1],
    124: ['pressure_sac', 'Pressure SAC', 'bar/min', 100], 125: ['volume_sac', 'Volume SAC', 'L/min', 100], 126: ['rmv', 'Respiratory Minute Volume', 'L/min', 100],
    127: ['ascent_rate', 'Ascent Rate', 'm/s', 1000], 129: ['po2', 'PO2', '%', 100], 139: ['core_temp', 'Core Temperature', '°C', 100],
  };
  // record fields that are handled elsewhere or are not metrics (ids, enums, counters, raw/packed duplicates)
  const REC_SKIP = new Set([253, 0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 13, 17, 18, 19, 28, 29, 33, 39, 41, 42, 48, 49, 50, 52, 53, 55, 56, 58, 59, 62,
    69, 70, 71, 72, 73, 78, 83, 84, 85, 93, 94, 95, 96, 119, 123]);
  // developer fields that declare themselves as a native record field fill that metric when the device left it empty
  const NATIVE_REC = { 3: 'hr', 7: 'power', 13: 'temp' };

  const sc = (v, scale, offset) => (v == null ? null : v / scale - (offset || 0));
  const tsMs = (v) => (v == null ? null : (v + FIT_EPOCH) * 1000);

  function parseFit(buf) {
    const { msgs, devFieldDefs } = decodeRaw(buf);

    // developer field lookup by name
    const devKey = {};
    for (const k in devFieldDefs) devKey[(devFieldDefs[k].name || '').toLowerCase()] = k;
    const effortKey = devKey['effort pace'], lssKey = devKey['leg spring stiffness'];
    const extras = new Map(); // key -> { key, label, unit, unknown }
    const addX = (x, key, label, unit, v, unknown) => {
      if (typeof v !== 'number' || !isFinite(v)) return x;
      if (!extras.has(key)) extras.set(key, { key, label, unit: unit || '', unknown: !!unknown });
      (x || (x = {}))[key] = v; return x;
    };
    // everything in a record beyond the fixed metrics: known standard fields, unidentified fields, developer fields
    const extraOf = (m, r) => {
      let x = null;
      for (const num in m) {
        if (num === 'dev' || REC_SKIP.has(+num)) continue;
        const v = m[num]; if (v == null || typeof v !== 'number') continue;
        if (+num === 30) { x = addX(x, 'power_balance', 'Power Balance', '% L', v & 0x80 ? 100 - (v & 0x7f) : v & 0x7f); continue; }
        const d = REC_EXTRA[num];
        if (d) x = addX(x, d[0], d[1], d[2], v / d[3]);
        else x = addX(x, 'f' + num, 'Field ' + num, '', v, true);
      }
      if (m.dev) for (const key in m.dev) {
        if (key === effortKey || key === lssKey) continue;
        const fd = devFieldDefs[key]; let v = m.dev[key];
        if (!fd || typeof v !== 'number' || !isFinite(v)) continue;
        if (fd.scale) v /= fd.scale; if (fd.offset) v -= fd.offset;
        const nat = fd.nativeMesg === 20 ? NATIVE_REC[fd.nativeField] : null;
        if (nat) { if (r[nat] == null) r[nat] = v; continue; }
        x = addX(x, 'dev_' + key, fd.name || 'Developer field ' + key, fd.units, v);
      }
      return x;
    };
    const dev = (m, key) => (key && m.dev && m.dev[key] != null ? m.dev[key] : null);

    const rawRecords = (msgs[20] || []).map((m) => { const r = {
      t: tsMs(m[253]),
      lat: m[0] == null ? null : m[0] * SEMI,
      lon: m[1] == null ? null : m[1] * SEMI,
      alt: sc(m[78] != null ? m[78] : m[2], 5, 500),
      hr: m[3],
      cadence: m[4] == null ? null : (m[4] + (m[53] != null ? m[53] / 128 : 0)) * 2, // steps/min
      dist: sc(m[5], 100),                                   // m
      speed: sc(m[73] != null ? m[73] : m[6], 1000),         // m/s
      power: m[7],
      vo: m[39] == null ? null : m[39] / 100,                // cm (raw: 0.1 mm)
      gct: sc(m[41], 10),                                    // ms
      vr: sc(m[83], 100),                                    // %
      balance: sc(m[84], 100),                               // % left
      stride: m[85] == null ? null : m[85] / 100,            // cm (raw: 0.1 mm)
      effort: dev(m, effortKey),                             // m/s
      lss: dev(m, lssKey),                                   // kN/m (developer field, running form tests)
      temp: m[13],                                           // deg C
    }; r.x = extraOf(m, r); return r; }).filter((r) => r.t != null);
    // Some exporters split one moment over several record messages (distance in one,
    // position/speed in the next, cadence in a third). Merge records sharing a timestamp.
    for (let i = 1; i < rawRecords.length; i++) if (rawRecords[i].t < rawRecords[i - 1].t) { rawRecords.sort((x, y) => x.t - y.t); break; } // out-of-order timestamps
    const merged = [];
    for (const r of rawRecords) {
      const last = merged[merged.length - 1];
      if (last && last.t === r.t) { for (const k in r) if (r[k] != null) { if (k === 'x' && last.x) Object.assign(last.x, r.x); else last[k] = r[k]; } }
      else merged.push(r);
    }
    const records = merged;

    const laps = (msgs[19] || []).map((m, i) => ({
      index: i + 1,
      start: tsMs(m[2]), end: tsMs(m[253]),
      elapsed: sc(m[7], 1000), timer: sc(m[8], 1000),
      dist: sc(m[9], 100), calories: m[11],
      avgSpeed: sc(m[13], 1000), maxSpeed: sc(m[14], 1000),
      avgHr: m[15], maxHr: m[16],
      avgCadence: m[17] == null ? null : m[17] * 2, maxCadence: m[18] == null ? null : m[18] * 2,
      avgPower: m[19], ascent: m[21], descent: m[22],
      avgVo: m[77] == null ? null : m[77] / 100, avgGct: sc(m[79], 10),
      avgVr: sc(m[118], 100), avgStride: m[120] == null ? null : m[120] / 100,
      avgBalance: sc(m[78], 100),
      avgEffort: dev(m, effortKey), avgTemp: m[50],
    }));

    const s = (msgs[18] || [])[0] || {};
    const session = {
      sport: s[5], start: tsMs(s[2]), end: tsMs(s[253]),
      elapsed: sc(s[7], 1000), timer: sc(s[8], 1000), dist: sc(s[9], 100),
      calories: s[11], avgSpeed: sc(s[14], 1000), maxSpeed: sc(s[15], 1000),
      avgHr: s[16], maxHr: s[17],
      avgCadence: s[18] == null ? null : s[18] * 2, maxCadence: s[19] == null ? null : s[19] * 2,
      avgPower: s[20], ascent: s[22], descent: s[23],
      avgVo: s[89] == null ? null : s[89] / 100, avgGct: sc(s[91], 10),
      avgVr: sc(s[132], 100), avgBalance: sc(s[133], 100), avgStride: s[134] == null ? null : s[134] / 100,
      avgEffort: dev(s, effortKey), avgTemp: s[57], subSport: s[6],
      aerobicTE: sc(s[24], 10), anaerobicTE: sc(s[137], 10),
    };

    // timer events: event 0 = timer; type 0 start, 1 stop, 4 stop_all
    const events = (msgs[21] || []).filter((m) => m[0] === 0).map((m) => ({
      t: tsMs(m[253]), type: m[1] === 0 ? 'start' : 'stop',
    }));

    const fid = (msgs[0] || [])[0] || {};
    const di = (msgs[23] || [])[0] || {};
    const device = { name: fid[8] || di[27] || null, manufacturer: fid[1], product: fid[2] };

    return { records, laps, session, events, device, devFields: devFieldDefs, extras: Array.from(extras.values()) };
  }

  root.parseFit = parseFit;
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseFit };
})(typeof globalThis !== 'undefined' ? globalThis : this);
