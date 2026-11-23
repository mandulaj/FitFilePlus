/* Optional add-on widgets. Uses only window.FFP (see "API for src/widgets.js" in app.js).
   Each widget: F.registerWidget(type, { title, tip, multi, col, available(A), create(ctx) -> { update(reason), destroy() } })
   ctx = { card, body, ctl (header slot for controls), opts (persisted), save(), title(text) }
   update reasons: load | sel | hover | data | theme | colors */
(function () {
  'use strict';
  const F = window.FFP; if (!F) return;
  const M = F.METRICS;
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const finite = (v) => v != null && isFinite(v);

  // ---------- shared helpers ----------
  // metric <select>, rebuilt whenever the set of available metrics may have changed
  function metricSelect(label, get, set, filter, extra) {
    const wrap = el('label', null, label ? label + ' ' : ''), s = el('select'); wrap.appendChild(s);
    const fill = () => {
      const A = F.A, cur = get(); s.innerHTML = '';
      for (const [v, t] of extra || []) s.add(new Option(t, v));
      for (const k of F.KEYS) if (A && A.has[k] && (!filter || filter(k))) s.add(new Option(M[k].label, k));
      s.value = cur; if (s.value !== cur && s.options.length) { s.selectedIndex = 0; set(s.value, true); }
    };
    s.onchange = () => set(s.value);
    return { node: wrap, fill, sel: s };
  }
  function niceTicks(lo, hi, n) {
    const span = hi - lo; if (!(span > 0)) return [lo];
    const raw = span / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }
  // Canvas plot with axes. opts: { h, x:[lo,hi], y:[lo,hi], xRev, yRev, xFmt, yFmt, xLabel, yLabel, xTicks, logX }
  // returns { ctx, X(v), Y(v), box, dpr, ov (overlay canvas context for hover marks) }
  function makePlot(host, height) {
    const wrap = el('div', 'wplot'), base = el('canvas'), ov = el('canvas', 'ov'); wrap.appendChild(base); wrap.appendChild(ov); host.appendChild(wrap);
    const P = { wrap, base, ovc: ov, h: height || 240, frame: null };
    P.begin = (o) => {
      const dpr = window.devicePixelRatio || 1, w = Math.max(200, wrap.clientWidth), h = P.h;
      for (const c of [base, ov]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + 'px'; c.style.height = h + 'px'; }
      const ctx = base.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const octx = ov.getContext('2d'); octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const muted = F.cssVar('--muted'), grid = F.cssVar('--grid'), text = F.cssVar('--text');
      const box = { l: 52, r: w - (o.y2 ? 50 : 12), t: 10, b: h - (o.xLabel ? 36 : 24) };
      const tx = (v) => (o.logX ? Math.log(v) : v), x0 = tx(o.x[0]), x1 = tx(o.x[1]);
      const X = (v) => { const f = (tx(v) - x0) / ((x1 - x0) || 1); return box.l + (o.xRev ? 1 - f : f) * (box.r - box.l); };
      const Y = (v) => { const f = (v - o.y[0]) / ((o.y[1] - o.y[0]) || 1); return box.b - (o.yRev ? 1 - f : f) * (box.b - box.t); };
      ctx.font = '11px system-ui, sans-serif'; ctx.lineWidth = 1;
      const yt = niceTicks(Math.min(o.y[0], o.y[1]), Math.max(o.y[0], o.y[1]), Math.max(2, Math.round((box.b - box.t) / 42)));
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const v of yt) { const y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(box.l, y); ctx.lineTo(box.r, y); ctx.stroke(); ctx.fillStyle = o.yColor || muted; ctx.fillText(o.yFmt ? o.yFmt(v) : String(+v.toPrecision(6)), box.l - 6, y); }
      const xt = o.xTicks || niceTicks(Math.min(o.x[0], o.x[1]), Math.max(o.x[0], o.x[1]), Math.max(2, Math.round((box.r - box.l) / 80)));
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      let lastX = -1e9;
      for (const v of xt) { const x = Math.round(X(v)) + 0.5; if (x < box.l - 1 || x > box.r + 1) continue; ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(x, box.t); ctx.lineTo(x, box.b); ctx.stroke(); if (Math.abs(x - lastX) < 34) continue; lastX = x; ctx.fillStyle = o.xColor || muted; ctx.fillText(o.xFmt ? o.xFmt(v) : String(+v.toPrecision(6)), x, box.b + 5); }
      if (o.xLabel) { ctx.fillStyle = o.xColor || muted; ctx.textAlign = 'center'; ctx.fillText(o.xLabel, (box.l + box.r) / 2, h - 14); }
      if (o.yLabel) { ctx.save(); ctx.translate(11, (box.t + box.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = o.yColor || muted; ctx.fillText(o.yLabel, 0, 0); ctx.restore(); }
      P.frame = { ctx, octx, X, Y, box, w, h, text, muted, grid };
      return P.frame;
    };
    P.clearOv = () => { if (P.frame) P.frame.octx.clearRect(0, 0, P.frame.w, P.frame.h); };
    return P;
  }
  // redraw a widget when its width changes
  function onResize(node, fn) {
    if (!window.ResizeObserver) return { disconnect() {} };
    let w = 0, t = 0; const ro = new ResizeObserver(() => { const nw = node.clientWidth; if (!nw || nw === w) return; w = nw; clearTimeout(t); t = setTimeout(fn, 60); });
    ro.observe(node); return ro;
  }
  const axisDom = (A, k) => { const d = A.rng[k]; return [d[0], d[1]]; };
  const unitOf = (k) => (M[k].unit ? ' ' + M[k].unit : '');
  const sample = (lo, hi, max) => { const step = Math.max(1, Math.ceil((hi - lo + 1) / max)), out = []; for (let i = lo; i <= hi; i += step) out.push(i); return out; };

  // ---------- Scatter ----------
  F.registerWidget('scatter', {
    title: 'Scatter', multi: true,
    tip: 'One metric against another, one dot per moment. Shows how a metric depends on another: for example ground contact time against pace tells you whether contact time was long because form was poor or simply because you were going slowly. Faint dots = whole activity, strong dots = current selection, line = typical value (median) along the X axis. Hover a dot to see that moment on the map and chart.',
    create(ctx) {
      const o = ctx.opts; if (!o.x) { o.x = 'pace'; o.y = 'gct'; o.c = 'time'; }
      const P = makePlot(ctx.body, 280), note = el('div', 'wnote'); ctx.body.appendChild(note);
      let pts = [];
      const draw = () => {
        const A = F.A; if (!A) return;
        for (const s of [sx, sy, sc]) s.fill();
        if (!A.has[o.x] || !A.has[o.y]) { note.textContent = 'Pick two metrics.'; return; }
        ctx.title(`${M[o.y].label} vs ${M[o.x].label}`);
        const [lo, hi] = F.selRange(), xs = A.smooth[o.x], ys = A.smooth[o.y], cs = o.c !== 'time' && A.has[o.c] ? A.smooth[o.c] : null;
        const f = P.begin({ x: axisDom(A, o.x), y: axisDom(A, o.y), xRev: M[o.x].dir === -1, yRev: M[o.y].dir === -1, xFmt: M[o.x].fmt, yFmt: M[o.y].fmt,
          xLabel: M[o.x].label + unitOf(o.x), yLabel: M[o.y].label + unitOf(o.y) });
        const g = f.ctx; g.save(); g.beginPath(); g.rect(f.box.l, f.box.t, f.box.r - f.box.l, f.box.b - f.box.t); g.clip();
        if (F.activeSel()) { g.fillStyle = f.muted; g.globalAlpha = 0.16; for (const i of sample(0, A.n - 1, 4000)) { if (!finite(xs[i]) || !finite(ys[i])) continue; g.fillRect(f.X(xs[i]) - 1, f.Y(ys[i]) - 1, 2, 2); } }
        pts = []; g.globalAlpha = 0.75;
        const span = Math.max(1, hi - lo);
        for (const i of sample(lo, hi, 6000)) {
          if (!finite(xs[i]) || !finite(ys[i])) continue;
          const px = f.X(xs[i]), py = f.Y(ys[i]);
          g.fillStyle = cs ? F.colorOf(o.c, cs[i]) : `hsl(${Math.round(250 - 250 * ((i - lo) / span))} 85% 60%)`;
          g.beginPath(); g.arc(px, py, 1.9, 0, 6.3); g.fill(); pts.push([px, py, i]);
        }
        // typical value: median of Y in bins along X (bins with enough points only)
        g.globalAlpha = 1;
        const dom = axisDom(A, o.x), nb = 14, bins = Array.from({ length: nb }, () => []);
        for (let i = lo; i <= hi; i++) { if (!finite(xs[i]) || !finite(ys[i])) continue; const b = Math.floor(((xs[i] - dom[0]) / (dom[1] - dom[0])) * nb); if (b >= 0 && b < nb) bins[b].push(ys[i]); }
        const need = Math.max(8, (hi - lo) / 400); g.strokeStyle = f.text; g.lineWidth = 2.2; g.lineJoin = 'round'; g.beginPath(); let started = false;
        bins.forEach((b, bi) => { if (b.length < need) return; b.sort((a, c) => a - c); const x = f.X(dom[0] + ((bi + 0.5) / nb) * (dom[1] - dom[0])), y = f.Y(b[b.length >> 1]); if (started) g.lineTo(x, y); else { g.moveTo(x, y); started = true; } });
        g.stroke(); g.restore();
        // correlation over the selection
        let n = 0, sxv = 0, syv = 0, sxx = 0, syy = 0, sxy = 0;
        for (let i = lo; i <= hi; i++) { const a = xs[i], b = ys[i]; if (!finite(a) || !finite(b)) continue; n++; sxv += a; syv += b; sxx += a * a; syy += b * b; sxy += a * b; }
        const den = Math.sqrt((n * sxx - sxv * sxv) * (n * syy - syv * syv)), r = den > 0 ? (n * sxy - sxv * syv) / den : null;
        note.innerHTML = `${F.activeSel() ? 'Selection' : 'Whole activity'} · ${n} samples${r == null ? '' : ` · correlation r = <b>${r.toFixed(2)}</b> <span title="−1 or +1: the two move together; near 0: no linear relation">(${Math.abs(r) > 0.6 ? 'strong' : Math.abs(r) > 0.3 ? 'moderate' : 'weak'})</span>`} · colour: ${cs ? M[o.c].label : 'time (blue = start, red = end)'}`;
        mark();
      };
      const mark = () => {
        P.clearOv(); const A = F.A, i = F.S.hover, f = P.frame; if (!A || i == null || !f || !A.has[o.x] || !A.has[o.y]) return;
        const a = A.smooth[o.x][i], b = A.smooth[o.y][i]; if (!finite(a) || !finite(b)) return;
        const g = f.octx; g.strokeStyle = f.text; g.lineWidth = 2; g.fillStyle = F.cssVar('--bg'); g.beginPath(); g.arc(f.X(a), f.Y(b), 6, 0, 6.3); g.fill(); g.stroke();
      };
      const set = (key) => (v, silent) => { o[key] = v; ctx.save(); if (!silent) draw(); };
      const sx = metricSelect('X', () => o.x, set('x')), sy = metricSelect('Y', () => o.y, set('y')), sc = metricSelect('Colour', () => o.c, set('c'), null, [['time', 'Time']]);
      for (const s of [sx, sy, sc]) ctx.ctl.appendChild(s.node);
      P.base.addEventListener('mousemove', (e) => {
        const r = P.base.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; let best = -1, bd = 144;
        for (const p of pts) { const d = (p[0] - mx) * (p[0] - mx) + (p[1] - my) * (p[1] - my); if (d < bd) { bd = d; best = p[2]; } }
        F.setHover(best < 0 ? null : best, 'widget');
      });
      P.base.addEventListener('mouseleave', () => F.setHover(null, 'widget'));
      const ro = onResize(ctx.body, draw);
      return { update(reason) { if (reason === 'hover') mark(); else draw(); }, destroy() { ro.disconnect(); } };
    },
  });

  // ---------- Distribution ----------
  F.registerWidget('dist', {
    title: 'Distribution', multi: true,
    tip: 'How much time was spent at each value of a metric. Bars are coloured like the map (zones or colour scale); the outline shows the whole activity for comparison when a selection is active. Dashed lines mark the zone boundaries.',
    create(ctx) {
      const o = ctx.opts; if (!o.k) o.k = 'cadence';
      const P = makePlot(ctx.body, 220), note = el('div', 'wnote'); ctx.body.appendChild(note);
      const draw = () => {
        const A = F.A; if (!A) return; sk.fill(); const k = o.k; if (!A.has[k]) return;
        ctx.title('Distribution · ' + M[k].label);
        const v = A.smooth[k], dom = axisDom(A, k), nb = 32, [lo, hi] = F.selRange();
        const hist = (a, b) => { const h = new Array(nb).fill(0); let n = 0; for (let i = a; i <= b; i++) { if (!finite(v[i])) continue; const bi = Math.floor(((v[i] - dom[0]) / (dom[1] - dom[0])) * nb); if (bi >= 0 && bi < nb) { h[bi]++; n++; } } return h.map((c) => (n ? (c / n) * 100 : 0)); };
        const all = hist(0, A.n - 1), sel = F.activeSel() ? hist(lo, hi) : all, top = Math.max(1, ...all, ...sel) * 1.08;
        const f = P.begin({ x: dom, y: [0, top], xRev: M[k].dir === -1, xFmt: M[k].fmt, yFmt: (x) => x.toFixed(0) + '%', xLabel: M[k].label + unitOf(k), yLabel: 'share of time' });
        const g = f.ctx, bw = (dom[1] - dom[0]) / nb;
        for (let b = 0; b < nb; b++) { const x0 = f.X(dom[0] + b * bw), x1 = f.X(dom[0] + (b + 1) * bw), l = Math.min(x0, x1), w = Math.abs(x1 - x0); g.fillStyle = F.colorOf(k, dom[0] + (b + 0.5) * bw); g.globalAlpha = 0.9; g.fillRect(l + 0.5, f.Y(sel[b]), Math.max(1, w - 1), f.box.b - f.Y(sel[b])); }
        g.globalAlpha = 1;
        if (F.activeSel()) { g.strokeStyle = f.text; g.lineWidth = 1.3; g.beginPath(); for (let b = 0; b < nb; b++) { const x0 = f.X(dom[0] + b * bw), x1 = f.X(dom[0] + (b + 1) * bw), y = f.Y(all[b]); if (b === 0) g.moveTo(x0, y); else g.lineTo(x0, y); g.lineTo(x1, y); } g.stroke(); }
        if (F.isZones(k)) { g.setLineDash([3, 3]); g.strokeStyle = f.muted; for (const e of M[k].bands.edges) { if (e <= dom[0] || e >= dom[1]) continue; const x = Math.round(f.X(e)) + 0.5; g.beginPath(); g.moveTo(x, f.box.t); g.lineTo(x, f.box.b); g.stroke(); } g.setLineDash([]); }
        const st = F.stats(lo, hi).m[k], vals = []; for (let i = lo; i <= hi; i++) if (finite(v[i])) vals.push(v[i]); vals.sort((a, b) => a - b);
        const q = (p) => (vals.length ? vals[Math.min(vals.length - 1, Math.round(p * (vals.length - 1)))] : null);
        note.innerHTML = st ? `${F.activeSel() ? 'Selection' : 'Whole activity'} · average <b>${M[k].fmt(st.avg)}</b> · median ${M[k].fmt(q(0.5))} · middle half ${M[k].fmt(q(0.25))} – ${M[k].fmt(q(0.75))}${unitOf(k)}${F.activeSel() ? ' · outline = whole activity' : ''}` : '';
        mark();
      };
      const mark = () => { P.clearOv(); const A = F.A, i = F.S.hover, f = P.frame; if (!A || i == null || !f || !A.has[o.k] || !finite(A.smooth[o.k][i])) return; const g = f.octx, x = Math.round(f.X(A.smooth[o.k][i])) + 0.5; if (x < f.box.l || x > f.box.r) return; g.strokeStyle = f.text; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, f.box.t); g.lineTo(x, f.box.b); g.stroke(); };
      const sk = metricSelect('', () => o.k, (v, silent) => { o.k = v; ctx.save(); if (!silent) draw(); });
      ctx.ctl.appendChild(sk.node);
      const ro = onResize(ctx.body, draw);
      return { update(reason) { if (reason === 'hover') mark(); else draw(); }, destroy() { ro.disconnect(); } };
    },
  });

  // ---------- Hill profile ----------
  F.registerWidget('hill', {
    title: 'Hill profile', multi: true,
    available: (A) => A.has.grade,
    tip: 'A metric averaged by slope: what your pace, power, cadence or ground contact time looks like on descents, flat and climbs. Grey bars show how much time was spent at each gradient, so thinly covered slopes can be read with caution (hollow points = under 1% of the time).',
    create(ctx) {
      const o = ctx.opts; if (!o.k) o.k = 'pace';
      const P = makePlot(ctx.body, 230), note = el('div', 'wnote'); ctx.body.appendChild(note);
      const EDG = []; for (let g = -15; g <= 15; g += 2.5) EDG.push(g);
      const draw = () => {
        const A = F.A; if (!A) return; sk.fill(); const k = o.k; if (!A.has[k] || !A.has.grade) return;
        ctx.title('Hill profile · ' + M[k].label);
        const [lo, hi] = F.selRange(), gr = A.raw.grade, v = A.smooth[k], nb = EDG.length - 1, sum = new Array(nb).fill(0), cnt = new Array(nb).fill(0); let tot = 0;
        for (let i = lo; i <= hi; i++) { if (!finite(gr[i]) || !finite(v[i])) continue; let b = Math.floor((gr[i] - EDG[0]) / 2.5); b = Math.max(0, Math.min(nb - 1, b)); sum[b] += v[i]; cnt[b]++; tot++; }
        const avg = sum.map((s, b) => (cnt[b] ? s / cnt[b] : null)), have = avg.filter(finite); if (!have.length) { note.textContent = 'No data in this range.'; P.begin({ x: [-15, 15], y: [0, 1] }); return; }
        let y0 = Math.min(...have), y1 = Math.max(...have); const pad = ((y1 - y0) || Math.abs(y1) * 0.1 || 1) * 0.15; y0 -= pad; y1 += pad;
        const f = P.begin({ x: [-15, 15], y: [y0, y1], yRev: M[k].dir === -1, xFmt: (x) => (x > 0 ? '+' : '') + x + '%', yFmt: M[k].fmt, xLabel: 'grade (downhill ← → uphill)', yLabel: M[k].label + unitOf(k), yColor: M[k].color });
        const g = f.ctx, maxShare = Math.max(...cnt) / (tot || 1);
        for (let b = 0; b < nb; b++) { const share = cnt[b] / (tot || 1), x0 = f.X(EDG[b]), x1 = f.X(EDG[b + 1]), hgt = (share / (maxShare || 1)) * (f.box.b - f.box.t) * 0.45; g.fillStyle = f.muted; g.globalAlpha = 0.22; g.fillRect(x0 + 1, f.box.b - hgt, x1 - x0 - 2, hgt); }
        g.globalAlpha = 1; g.strokeStyle = M[k].color; g.lineWidth = 2.2; g.lineJoin = 'round'; g.beginPath(); let st = false;
        for (let b = 0; b < nb; b++) { if (!finite(avg[b])) continue; const x = f.X(EDG[b] + 1.25), y = f.Y(avg[b]); if (st) g.lineTo(x, y); else { g.moveTo(x, y); st = true; } } g.stroke();
        for (let b = 0; b < nb; b++) { if (!finite(avg[b])) continue; const x = f.X(EDG[b] + 1.25), y = f.Y(avg[b]), thin = cnt[b] / (tot || 1) < 0.01; g.beginPath(); g.arc(x, y, 4, 0, 6.3); g.fillStyle = thin ? F.cssVar('--card') : M[k].color; g.fill(); g.strokeStyle = M[k].color; g.lineWidth = 1.5; g.stroke(); }
        const xz = Math.round(f.X(0)) + 0.5; g.setLineDash([3, 3]); g.strokeStyle = f.muted; g.lineWidth = 1; g.beginPath(); g.moveTo(xz, f.box.t); g.lineTo(xz, f.box.b); g.stroke(); g.setLineDash([]);
        const flat = avg[Math.floor(nb / 2) - 1] != null && avg[Math.floor(nb / 2)] != null ? (avg[Math.floor(nb / 2) - 1] + avg[Math.floor(nb / 2)]) / 2 : null;
        note.innerHTML = `${F.activeSel() ? 'Selection' : 'Whole activity'}${finite(flat) ? ` · on the flat (±2.5%): <b>${M[k].fmt(flat)}</b>${unitOf(k)}` : ''} · bars: share of time per gradient · ends include everything steeper than ±15%`;
      };
      const sk = metricSelect('', () => o.k, (v, silent) => { o.k = v; ctx.save(); if (!silent) draw(); }, (k) => k !== 'grade' && k !== 'alt');
      ctx.ctl.appendChild(sk.node);
      const ro = onResize(ctx.body, draw);
      return { update(reason) { if (reason !== 'hover') draw(); }, destroy() { ro.disconnect(); } };
    },
  });

  // ---------- Drift / decoupling ----------
  // efficiency = output per heartbeat: power / HR when power exists, else speed / HR
  const effBasis = (A) => (A.has.power ? 'power' : 'speed');
  F.registerWidget('drift', {
    title: 'Drift', multi: false,
    available: (A) => A.has.hr && (A.has.power || A.has.pace) && !A.noTime,
    tip: 'Fatigue check. <b>Efficiency</b> is output per heartbeat (power ÷ heart rate, or speed ÷ heart rate without power), drawn relative to the first quarter of the range. A line that sinks means the same effort costs more heartbeats. <b>Decoupling</b> compares the second half with the first: under about 5% is usually read as a steady aerobic effort. Hills, heat, pauses and changes of pace all move it, so it is most meaningful on steady efforts. The table shows how each metric moved from quarter to quarter.',
    create(ctx) {
      const P = makePlot(ctx.body, 200), note = el('div', 'wnote'), tbl = el('div', 'tablewrap'); ctx.body.appendChild(note); ctx.body.appendChild(tbl);
      const draw = () => {
        const A = F.A; if (!A) return;
        const [lo, hi] = F.selRange(), basis = effBasis(A), R = A.R;
        const out = (i) => (basis === 'power' ? R[i].power : R[i].speed), ok = (i) => finite(out(i)) && out(i) > (basis === 'power' ? 20 : 0.8) && finite(R[i].hr) && R[i].hr > 40;
        // mean output / mean HR over index ranges
        const ef = (a, b) => { let so = 0, sh = 0, n = 0; for (let i = a; i <= b; i++) if (ok(i)) { so += out(i); sh += R[i].hr; n++; } return n > 20 ? so / sh : null; };
        const tAt = (frac) => { const t = A.mt[lo] + (A.mt[hi] - A.mt[lo]) * frac; let a = lo, b = hi; while (a < b) { const m = (a + b) >> 1; if (A.mt[m] < t) a = m + 1; else b = m; } return a; };
        const q = [0, 0.25, 0.5, 0.75, 1].map(tAt), base = ef(q[0], q[1]);
        // rolling efficiency, window ~ 1/12 of the range but at least 2 minutes
        const win = Math.max(120, (A.mt[hi] - A.mt[lo]) / 12), xs = [], ys = []; let a = lo, so = 0, sh = 0, n = 0;
        for (let i = lo; i <= hi; i++) {
          if (ok(i)) { so += out(i); sh += R[i].hr; n++; }
          while (A.mt[i] - A.mt[a] > win) { if (ok(a)) { so -= out(a); sh -= R[a].hr; n--; } a++; }
          if (n > 30 && A.mt[i] - A.mt[lo] >= win * 0.8 && base) { xs.push(A.mt[i]); ys.push(((so / sh) / base) * 100); }
        }
        if (!base || !ys.length) { P.begin({ x: [0, 1], y: [0, 1] }); note.textContent = 'Not enough steady data in this range (needs heart rate and movement for at least a few minutes).'; tbl.innerHTML = ''; return; }
        const ymin = Math.min(90, ...ys) - 2, ymax = Math.max(105, ...ys) + 2;
        const f = P.begin({ x: [A.mt[lo], A.mt[hi]], y: [ymin, ymax], xFmt: F.fmtDur, yFmt: (v) => v.toFixed(0) + '%', xLabel: 'moving time', yLabel: 'efficiency vs first quarter' });
        const g = f.ctx; g.setLineDash([4, 4]); g.strokeStyle = f.muted; g.beginPath(); g.moveTo(f.box.l, f.Y(100)); g.lineTo(f.box.r, f.Y(100)); g.stroke(); g.setLineDash([]);
        const xm = Math.round(f.X((A.mt[lo] + A.mt[hi]) / 2)) + 0.5; g.strokeStyle = f.grid; g.beginPath(); g.moveTo(xm, f.box.t); g.lineTo(xm, f.box.b); g.stroke();
        g.strokeStyle = F.cssVar('--accent'); g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath(); xs.forEach((x, i) => { if (i) g.lineTo(f.X(x), f.Y(ys[i])); else g.moveTo(f.X(x), f.Y(ys[i])); }); g.stroke();
        const e1 = ef(q[0], q[2]), e2 = ef(q[2] + 1, q[4]), dec = e1 && e2 ? ((e1 - e2) / e1) * 100 : null;
        note.innerHTML = `${F.activeSel() ? 'Selection' : 'Whole activity'} · efficiency = ${basis} ÷ heart rate${dec == null ? '' : ` · decoupling (2nd half vs 1st): <b style="color:${Math.abs(dec) < 5 ? 'var(--good)' : '#f59e0b'}">${dec > 0 ? '−' : '+'}${Math.abs(dec).toFixed(1)}%</b> ${dec > 5 ? 'efficiency dropped' : dec < -5 ? 'efficiency rose' : 'steady'}`}`;
        // quarter table
        const keys = F.KEYS.filter((k) => A.has[k] && !['alt', 'temp'].includes(k) && !M[k].dynamic), qs = [0, 1, 2, 3].map((i) => F.stats(i ? q[i] + 1 : q[i], q[i + 1]));
        let h = '<table><thead><tr><th>Metric</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th title="Change from first to last quarter">Q4 vs Q1</th></tr></thead><tbody>';
        for (const k of keys) {
          const v = qs.map((s) => (s.m[k] ? s.m[k].avg : null)); if (!v.some(finite)) continue;
          const d = finite(v[0]) && finite(v[3]) && v[0] !== 0 ? ((v[3] - v[0]) / Math.abs(v[0])) * 100 : null;
          h += `<tr><td><span class="dot" style="background:${M[k].color}"></span>${M[k].label} <span class="muted small">${M[k].unit}</span></td>${v.map((x) => `<td>${M[k].fmt(x)}</td>`).join('')}<td>${d == null || k === 'grade' ? '–' : (d > 0 ? '+' : '') + d.toFixed(1) + '%'}</td></tr>`;
        }
        tbl.innerHTML = h + '</tbody></table>';
        mark();
      };
      const mark = () => { P.clearOv(); const A = F.A, i = F.S.hover, f = P.frame; if (!A || i == null || !f) return; const x = Math.round(f.X(A.mt[i])) + 0.5; if (x < f.box.l || x > f.box.r) return; const g = f.octx; g.strokeStyle = f.text; g.lineWidth = 1; g.beginPath(); g.moveTo(x, f.box.t); g.lineTo(x, f.box.b); g.stroke(); };
      const ro = onResize(ctx.body, draw);
      return { update(reason) { if (reason === 'hover') mark(); else draw(); }, destroy() { ro.disconnect(); } };
    },
  });

  // ---------- Best efforts ----------
  // best average over every window of a given moving-time length (two pointers; windows across a pause are skipped)
  function bestByTime(A, dur, val) { // val(i,j) -> value for window i..j or null
    let best = null; const n = A.n;
    for (let i = 0, j = 0; i < n; i++) {
      if (j < i) j = i;
      while (j < n - 1 && A.mt[j] - A.mt[i] < dur) j++;
      if (A.mt[j] - A.mt[i] < dur) break;
      if (A.pc[j] !== A.pc[i] || A.mt[j] - A.mt[i] > dur * 1.15 + 2) continue;
      const v = val(i, j); if (v != null && (best == null || v > best.v)) best = { v, lo: i, hi: j };
    }
    return best;
  }
  function bestByDist(A, units) { // fastest window covering `units` of distance (display units)
    let best = null; const n = A.n;
    for (let i = 0, j = 0; i < n; i++) {
      if (j < i) j = i;
      while (j < n - 1 && A.km[j] - A.km[i] < units) j++;
      if (A.km[j] - A.km[i] < units) break;
      if (A.pc[j] !== A.pc[i] || A.km[j] - A.km[i] > units * 1.05 + 0.02 || A.mt[j] <= A.mt[i]) continue;
      const t = (A.mt[j] - A.mt[i]) * (units / (A.km[j] - A.km[i]));
      if (best == null || t < best.t) best = { t, lo: i, hi: j };
    }
    return best;
  }
  F.registerWidget('best', {
    title: 'Best efforts', multi: false,
    available: (A) => !A.noTime && (A.hasDist || A.has.power),
    tip: 'Your best sustained efforts inside this activity. <b>Curve</b>: the fastest pace (or highest power) you held for every duration from a few seconds up to the whole activity. <b>Distances</b>: your fastest time over standard distances. Click a point or a row to select that stretch on the chart and map. Windows that span a pause are ignored.',
    create(ctx) {
      const o = ctx.opts; if (!o.what) o.what = 'pace';
      const tabs = el('div', 'seg wtabs'), P = makePlot(ctx.body, 220), tbl = el('div', 'tablewrap'); ctx.body.insertBefore(tabs, ctx.body.firstChild); ctx.body.appendChild(tbl);
      let curve = [], cacheKey = '';
      const DUR = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 2400, 3600, 5400, 7200, 10800, 14400, 21600, 28800, 43200];
      const compute = () => {
        const A = F.A, key = [A.fileName, A.n, F.U.imp, F.U.speed, o.what].join('|'); if (key === cacheKey) return; cacheKey = key;
        const total = A.mt[A.n - 1]; curve = [];
        const pw = new Float64Array(A.n + 1), pn = new Float64Array(A.n + 1);
        for (let i = 0; i < A.n; i++) { const p = A.R[i].power; pw[i + 1] = pw[i] + (finite(p) ? p : 0); pn[i + 1] = pn[i] + (finite(p) ? 1 : 0); }
        const val = o.what === 'power'
          ? (i, j) => (pn[j + 1] - pn[i] > (j - i) * 0.8 ? (pw[j + 1] - pw[i]) / (pn[j + 1] - pn[i]) : null)
          : (i, j) => (A.km[j] > A.km[i] ? (A.km[j] - A.km[i]) / (A.mt[j] - A.mt[i]) : null); // distance units per second
        for (const d of DUR.filter((x) => x <= total).concat(total > 60 ? [Math.floor(total)] : [])) { const b = bestByTime(A, d, val); if (b) curve.push(Object.assign({ d }, b)); }
      };
      const disp = (b) => (o.what === 'power' ? b.v : F.U.speed ? b.v * 3600 : 1 / b.v); // power W | speed per hour | seconds per unit
      const draw = () => {
        const A = F.A; if (!A) return;
        const opts = [A.hasDist ? ['pace', F.PACE()] : null, A.has.power ? ['power', 'Power'] : null].filter(Boolean);
        if (!opts.some((x) => x[0] === o.what)) o.what = opts[0][0];
        tabs.innerHTML = opts.map(([k, t]) => `<button data-w="${k}" class="${k === o.what ? 'on' : ''}" title="Best ${t.toLowerCase()} held for each duration">${t}</button>`).join(''); tabs.hidden = opts.length < 2;
        compute();
        const mk = o.what === 'power' ? 'power' : 'pace', fmt = M[mk].fmt, ys = curve.map(disp);
        if (!curve.length) { P.begin({ x: [1, 10], y: [0, 1] }); tbl.innerHTML = ''; return; }
        let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = ((y1 - y0) || 1) * 0.1; y0 -= pad; y1 += pad;
        const ticks = [5, 15, 60, 300, 900, 1800, 3600, 7200, 14400, 28800].filter((t) => t >= curve[0].d && t <= curve[curve.length - 1].d);
        const f = P.begin({ x: [curve[0].d, Math.max(curve[curve.length - 1].d, curve[0].d * 2)], y: [y0, y1], logX: true, yRev: mk === 'pace' && !F.U.speed, xTicks: ticks, xFmt: F.fmtDur, yFmt: fmt, xLabel: 'duration', yLabel: 'best ' + M[mk].label.toLowerCase() + unitOf(mk), yColor: M[mk].color });
        const g = f.ctx; g.strokeStyle = M[mk].color; g.lineWidth = 2.2; g.lineJoin = 'round'; g.beginPath(); curve.forEach((b, i) => { const x = f.X(b.d), y = f.Y(ys[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
        g.fillStyle = M[mk].color; curve.forEach((b, i) => { g.beginPath(); g.arc(f.X(b.d), f.Y(ys[i]), 3, 0, 6.3); g.fill(); });
        // standard distances
        let h = '';
        if (A.hasDist) {
          const total = A.km[A.n - 1], KM = [[0.4, '400 m'], [1, '1 km'], [1.609344, '1 mile'], [3, '3 km'], [5, '5 km'], [10, '10 km'], [15, '15 km'], [21.0975, 'Half marathon'], [42.195, 'Marathon'], [50, '50 km'], [100, '100 km']];
          const rows = KM.map(([km, name]) => { const u = (km * 1000) / F.UN.DM; return u <= total ? Object.assign({ name, u }, bestByDist(A, u) || {}) : null; }).filter((r) => r && r.t);
          if (rows.length) h = '<table><thead><tr><th>Distance</th><th>Best time</th><th>' + F.PACE() + '</th><th>From</th></tr></thead><tbody>' + rows.map((r) => `<tr class="click" data-lo="${r.lo}" data-hi="${r.hi}" title="Select this stretch on chart and map"><td>${r.name}</td><td><b>${F.fmtDur(r.t)}</b></td><td>${M.pace.fmt(F.paceOf(r.t, r.u))}${unitOf('pace')}</td><td>${F.posLabel(r.lo)}</td></tr>`).join('') + '</tbody></table>';
        }
        tbl.innerHTML = h;
      };
      tabs.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; o.what = b.dataset.w; ctx.save(); draw(); };
      tbl.onclick = (e) => { const tr = e.target.closest('tr.click'); if (tr) F.setSel(+tr.dataset.lo, +tr.dataset.hi, true); };
      const near = (e) => { const f = P.frame; if (!f || !curve.length) return null; const r = P.base.getBoundingClientRect(), mx = e.clientX - r.left; let best = null, bd = 1e9; for (const b of curve) { const d = Math.abs(f.X(b.d) - mx); if (d < bd) { bd = d; best = b; } } return bd < 30 ? best : null; };
      P.base.style.cursor = 'pointer';
      P.base.addEventListener('click', (e) => { const b = near(e); if (b) F.setSel(b.lo, b.hi, true); });
      P.base.addEventListener('mousemove', (e) => {
        const b = near(e), f = P.frame; P.clearOv(); if (!b || !f) { P.base.removeAttribute('data-tip'); return; }
        const mk = o.what === 'power' ? 'power' : 'pace', g = f.octx, x = f.X(b.d), y = f.Y(disp(b)); g.strokeStyle = f.text; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 6, 0, 6.3); g.stroke();
        g.fillStyle = f.text; g.font = '12px system-ui, sans-serif'; g.textAlign = x > (f.box.l + f.box.r) / 2 ? 'right' : 'left'; g.fillText(`${F.fmtDur(b.d)}: ${M[mk].fmt(disp(b))}${unitOf(mk)} · click to select`, x + (g.textAlign === 'right' ? -10 : 10), Math.max(f.box.t + 12, y - 10));
      });
      P.base.addEventListener('mouseleave', () => P.clearOv());
      const ro = onResize(ctx.body, draw);
      return { update(reason) { if (reason === 'load' || reason === 'data' || reason === 'theme') { if (reason !== 'theme') cacheKey = ''; draw(); } }, destroy() { ro.disconnect(); } };
    },
  });

  // ---------- Climbs ----------
  // Walk the smoothed elevation: a climb runs from a low point to the following high point and ends once the
  // track has dropped by `tol` from that high; descents the same way mirrored. Small bumps below `minGain` are ignored.
  function findClimbs(A, minGain, tol) {
    const alt = A.altS, n = A.n, out = [];
    const scan = (sign) => {
      let start = -1, peak = -1;
      for (let i = 0; i < n; i++) {
        if (!finite(alt[i])) continue; const a = alt[i] * sign;
        if (start < 0) { start = i; peak = i; continue; }
        if (a > alt[peak] * sign) peak = i;
        if (a < alt[start] * sign && peak === start) { start = i; peak = i; continue; }
        if (alt[peak] * sign - a > tol) { // dropped away from the high point: close this segment
          if ((alt[peak] - alt[start]) * sign >= minGain) out.push({ lo: start, hi: peak, up: sign > 0 });
          start = i; peak = i;
        }
      }
      if (start >= 0 && peak > start && (alt[peak] - alt[start]) * sign >= minGain) out.push({ lo: start, hi: peak, up: sign > 0 });
    };
    scan(1); scan(-1);
    return out.sort((a, b) => a.lo - b.lo);
  }
  F.registerWidget('climbs', {
    title: 'Climbs', multi: false,
    available: (A) => A.has.alt && A.hasDist,
    tip: 'Climbs and descents found in the elevation profile, with length, height change, average gradient and climbing speed (vertical metres or feet per hour). Short bumps are ignored. Click a row to select that climb on the chart and map.',
    create(ctx) {
      const o = ctx.opts; if (!o.show) o.show = 'up';
      const tabs = el('div', 'seg wtabs', '<button data-s="up" title="Climbs only">Climbs</button><button data-s="down" title="Descents only">Descents</button><button data-s="all" title="Climbs and descents in order">All</button>'), tbl = el('div', 'tablewrap'), note = el('div', 'wnote');
      ctx.body.appendChild(tabs); ctx.body.appendChild(tbl); ctx.body.appendChild(note);
      const draw = () => {
        const A = F.A; if (!A) return;
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.s === o.show));
        const minGain = 15 * F.UN.EF, list = findClimbs(A, minGain, 8 * F.UN.EF).filter((c) => (A.km[c.hi] - A.km[c.lo]) * F.UN.DM >= 200).filter((c) => o.show === 'all' || (o.show === 'up') === c.up);
        if (!list.length) { tbl.innerHTML = ''; note.textContent = `No ${o.show === 'down' ? 'descents' : 'climbs'} of at least ${Math.round(minGain)} ${F.UN.eu} found.`; return; }
        const hasHr = A.has.hr, vu = F.UN.eu + '/h';
        let h = `<table><thead><tr><th></th><th>From</th><th>Length</th><th>Height</th><th>Avg grade</th><th title="Vertical speed">Vert. speed</th><th>Time</th>${A.noTime ? '' : '<th>' + F.PACE() + '</th>'}${hasHr ? '<th>Avg HR</th>' : ''}</tr></thead><tbody>`;
        for (const c of list) {
          const len = A.km[c.hi] - A.km[c.lo], dh = A.altS[c.hi] - A.altS[c.lo], t = A.mt[c.hi] - A.mt[c.lo], st = F.stats(c.lo, c.hi);
          const grade = len > 0 ? ((dh / F.UN.EF) / (len * F.UN.DM)) * 100 : null;
          h += `<tr class="click" data-lo="${c.lo}" data-hi="${c.hi}" title="Select on chart and map"><td style="color:${c.up ? '#ef4444' : '#22c55e'}">${c.up ? '▲' : '▼'}</td><td>${A.km[c.lo].toFixed(2)} ${F.UN.du}</td><td>${len.toFixed(2)} ${F.UN.du}</td><td><b>${dh > 0 ? '+' : ''}${dh.toFixed(0)} ${F.UN.eu}</b></td><td>${grade == null ? '–' : grade.toFixed(1) + ' %'}</td><td>${A.noTime || t <= 0 ? '–' : Math.round((Math.abs(dh) / t) * 3600) + ' ' + vu}</td><td>${A.noTime ? '–' : F.fmtDur(t)}</td>${A.noTime ? '' : `<td>${M.pace.fmt(F.paceOf(t, len))}</td>`}${hasHr ? `<td>${st.m.hr ? Math.round(st.m.hr.avg) : '–'}</td>` : ''}</tr>`;
        }
        tbl.innerHTML = h + '</tbody></table>';
        const up = list.filter((c) => c.up), tot = up.reduce((s, c) => s + (A.altS[c.hi] - A.altS[c.lo]), 0);
        note.textContent = `${list.length} found${up.length && o.show !== 'down' ? ` · ${up.length} climbs totalling +${tot.toFixed(0)} ${F.UN.eu}` : ''} · minimum ${Math.round(minGain)} ${F.UN.eu} and 200 m`;
      };
      tabs.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; o.show = b.dataset.s; ctx.save(); draw(); };
      tbl.onclick = (e) => { const tr = e.target.closest('tr.click'); if (tr) F.setSel(+tr.dataset.lo, +tr.dataset.hi, true); };
      return { update(reason) { if (reason === 'load' || reason === 'data') draw(); } };
    },
  });

  F.widgetsReady();
})();
