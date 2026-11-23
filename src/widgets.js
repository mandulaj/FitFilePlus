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
  // Pick a group of dots in a plot by drawing a box or a free-hand lasso around them. points() -> [[px, py, recordIndex], ...]
  // for every dot of the current range. Picked moments stay in colour on the maps and in the chart; everything else is
  // faded. A plain click clears. opts.pick remembers box / lasso.
  let pickSeq = 0;
  function pickTool(P, host, ctl, opts, save, points) {
    const id = 'pick' + (++pickSeq), info = el('div', 'wnote'); host.appendChild(info);
    const seg = el('span', 'seg', '<button data-p="box" title="Drag a rectangle around dots to pick them">▭ Box</button><button data-p="lasso" title="Draw freely around dots to pick them">◌ Lasso</button>');
    const syncSeg = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.p === (opts.pick || 'box')));
    seg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; opts.pick = b.dataset.p; save(); syncSeg(); };
    syncSeg(); ctl.appendChild(seg);
    let shape = null, live = null; // { box: [x0, y0, x1, y1] } or { path: [[x, y], ...] }, as fractions of the plot area (survives a resize)
    const mine = () => F.S.picksOwner === id;
    const inPoly = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const collect = (sh) => {
      const f = P.frame, w = f.box.r - f.box.l, h = f.box.b - f.box.t, out = [];
      for (const p of points()) { const x = (p[0] - f.box.l) / w, y = (p[1] - f.box.t) / h; if (sh.box ? x >= sh.box[0] && x <= sh.box[2] && y >= sh.box[1] && y <= sh.box[3] : inPoly(sh.path, x, y)) out.push(p[2]); }
      return out;
    };
    const api = {
      paint() {
        const f = P.frame; if (!f) return; const sh = live || (mine() ? shape : null);
        const A = F.A, n = mine() && F.S.picks ? F.S.picks.length : 0;
        if (n && A) { let t = 0; for (const i of F.S.picks) if (i + 1 < A.n && A.pc[i + 1] === A.pc[i]) t += A.mt[i + 1] - A.mt[i]; info.innerHTML = `<b>${n}</b> moments picked${A.noTime ? '' : ' (' + F.fmtDur(t) + ')'} · kept in colour on map and chart, the rest is faded · click the plot to clear`; }
        else info.textContent = '';
        if (!sh) return;
        const g = f.octx, w = f.box.r - f.box.l, h = f.box.b - f.box.t, X = (v) => f.box.l + v * w, Y = (v) => f.box.t + v * h;
        g.save(); g.beginPath();
        if (sh.box) g.rect(X(sh.box[0]), Y(sh.box[1]), (sh.box[2] - sh.box[0]) * w, (sh.box[3] - sh.box[1]) * h);
        else { sh.path.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.closePath(); }
        g.fillStyle = F.cssVar('--hl'); g.globalAlpha = 0.1; g.fill(); g.globalAlpha = 1; g.strokeStyle = F.cssVar('--hl'); g.lineWidth = 1.5; g.setLineDash([5, 3]); g.stroke(); g.restore();
      },
      reset() { shape = null; if (mine()) F.setPicks(null); },
      repick() { if (shape && mine() && P.frame) F.setPicks(collect(shape), id); }, // data or selection changed: apply the same shape again
      owns: mine,
    };
    P.base.style.cursor = 'crosshair';
    P.base.addEventListener('mousedown', (e) => {
      const f = P.frame; if (e.button !== 0 || !f) return; e.preventDefault();
      const bb = P.base.getBoundingClientRect(), w = f.box.r - f.box.l, h = f.box.b - f.box.t, cl = (v) => Math.max(0, Math.min(1, v));
      const fx = (ev) => cl((ev.clientX - bb.left - f.box.l) / w), fy = (ev) => cl((ev.clientY - bb.top - f.box.t) / h), x0 = fx(e), y0 = fy(e), lasso = opts.pick === 'lasso';
      const path = [[x0, y0]];
      const move = (ev) => {
        const x1 = fx(ev), y1 = fy(ev);
        if (lasso) { const l = path[path.length - 1]; if (Math.abs(x1 - l[0]) * w + Math.abs(y1 - l[1]) * h >= 3) path.push([x1, y1]); live = { path }; }
        else live = { box: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] };
        P.clearOv(); api.paint();
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        const sh = live; live = null; let big = false;
        if (sh && sh.box) big = (sh.box[2] - sh.box[0]) * w >= 4 && (sh.box[3] - sh.box[1]) * h >= 4;
        else if (sh && sh.path.length >= 3) { const xs = sh.path.map((p) => p[0]), ys = sh.path.map((p) => p[1]); big = (Math.max(...xs) - Math.min(...xs)) * w >= 6 && (Math.max(...ys) - Math.min(...ys)) * h >= 6; }
        if (!big) { shape = null; if (mine()) F.setPicks(null); else { P.clearOv(); api.paint(); } return; }
        shape = sh; F.setPicks(collect(sh), id);
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    return api;
  }
  // true when record i is faded because other moments were picked
  const faded = (i) => { const c = F.S.pickCum; return !!c && c[i + 1] === c[i]; };
  const axisDom = (A, k) => { const d = A.rng[k]; return [d[0], d[1]]; };
  const unitOf = (k) => (M[k].unit ? ' ' + M[k].unit : '');
  const sample = (lo, hi, max) => { const step = Math.max(1, Math.ceil((hi - lo + 1) / max)), out = []; for (let i = lo; i <= hi; i += step) out.push(i); return out; };

  // ---------- Scatter ----------
  F.registerWidget('scatter', {
    title: 'Scatter', multi: true,
    tip: 'One metric against another, one dot per moment. Shows how a metric depends on another: for example ground contact time against pace tells you whether contact time was long because form was poor or simply because you were going slowly. <b>Box / Lasso</b>: draw around a group of dots to pick those moments; they stay in colour on the map and in the chart while everything else is faded. Click the plot to clear. Faint dots = whole activity, strong dots = current selection, line = typical value (median) along the X axis. Hover a dot to see that moment on the map and chart.',
    create(ctx) {
      const o = ctx.opts; if (!o.x) { o.x = 'pace'; o.y = 'gct'; o.c = 'time'; }
      const P = makePlot(ctx.body, o.h || 280), note = el('div', 'wnote'); ctx.body.appendChild(note);
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
          const fd = faded(i); g.globalAlpha = fd ? 0.22 : 0.75;
          g.fillStyle = fd ? f.muted : cs ? F.colorOf(o.c, cs[i]) : `hsl(${Math.round(250 - 250 * ((i - lo) / span))} 85% 60%)`;
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
      const box = pickTool(P, ctx.body, ctx.ctl, o, ctx.save, () => {
        const A = F.A, f = P.frame, out = [], [lo, hi] = F.selRange(), xs = A.smooth[o.x], ys = A.smooth[o.y];
        for (let i = lo; i <= hi; i++) if (finite(xs[i]) && finite(ys[i])) out.push([f.X(xs[i]), f.Y(ys[i]), i]);
        return out;
      });
      const mark = () => {
        P.clearOv(); box.paint(); const A = F.A, i = F.S.hover, f = P.frame; if (!A || i == null || !f || !A.has[o.x] || !A.has[o.y]) return;
        const a = A.smooth[o.x][i], b = A.smooth[o.y][i]; if (!finite(a) || !finite(b)) return;
        const g = f.octx; g.strokeStyle = f.text; g.lineWidth = 2; g.fillStyle = F.cssVar('--bg'); g.beginPath(); g.arc(f.X(a), f.Y(b), 6, 0, 6.3); g.fill(); g.stroke();
      };
      const set = (key) => (v, silent) => { o[key] = v; ctx.save(); if (key !== 'c') box.reset(); if (!silent) draw(); };
      const sx = metricSelect('X', () => o.x, set('x')), sy = metricSelect('Y', () => o.y, set('y')), sc = metricSelect('Colour', () => o.c, set('c'), null, [['time', 'Time']]);
      for (const s of [sx, sy, sc]) ctx.ctl.appendChild(s.node);
      P.base.addEventListener('mousemove', (e) => {
        const r = P.base.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; let best = -1, bd = 144;
        for (const p of pts) { const d = (p[0] - mx) * (p[0] - mx) + (p[1] - my) * (p[1] - my); if (d < bd) { bd = d; best = p[2]; } }
        F.setHover(best < 0 ? null : best, 'widget');
      });
      P.base.addEventListener('mouseleave', () => F.setHover(null, 'widget'));
      const ro = onResize(ctx.body, draw);
      return { height: [() => P.h, (h) => { P.h = h; draw(); }], update(reason) { if (reason === 'hover') mark(); else { draw(); if (reason === 'load') box.reset(); else if (reason === 'sel' || reason === 'data') box.repick(); } }, destroy() { ro.disconnect(); box.reset(); } };
    },
  });

  // ---------- Distribution ----------
  F.registerWidget('dist', {
    title: 'Distribution', multi: true,
    tip: 'How much time was spent at each value of a metric. Bars are coloured like the map (zones or colour scale); the outline shows the whole activity for comparison when a selection is active. Dashed lines mark the zone boundaries.',
    create(ctx) {
      const o = ctx.opts; if (!o.k) o.k = 'cadence';
      const P = makePlot(ctx.body, o.h || 220), note = el('div', 'wnote'); ctx.body.appendChild(note);
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
      return { height: [() => P.h, (h) => { P.h = h; draw(); }], update(reason) { if (reason === 'hover') mark(); else if (reason !== 'picks') draw(); }, destroy() { ro.disconnect(); } };
    },
  });

  // ---------- Hill profile ----------
  F.registerWidget('hill', {
    title: 'Hill profile', multi: true,
    available: (A) => A.has.grade,
    tip: 'A metric averaged by slope: what your pace, power, cadence or ground contact time looks like on descents, flat and climbs. Grey bars show how much time was spent at each gradient, so thinly covered slopes can be read with caution (hollow points = under 1% of the time).',
    create(ctx) {
      const o = ctx.opts; if (!o.k) o.k = 'pace';
      const P = makePlot(ctx.body, o.h || 230), note = el('div', 'wnote'); ctx.body.appendChild(note);
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
      return { height: [() => P.h, (h) => { P.h = h; draw(); }], update(reason) { if (reason !== 'hover' && reason !== 'picks') draw(); }, destroy() { ro.disconnect(); } };
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
      const P = makePlot(ctx.body, ctx.opts.h || 200), note = el('div', 'wnote'), tbl = el('div', 'tablewrap'); ctx.body.appendChild(note); ctx.body.appendChild(tbl);
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
      return { height: [() => P.h, (h) => { P.h = h; draw(); }], update(reason) { if (reason === 'hover') mark(); else if (reason !== 'picks') draw(); }, destroy() { ro.disconnect(); } };
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
      const tabs = el('div', 'seg wtabs'), P = makePlot(ctx.body, o.h || 220), tbl = el('div', 'tablewrap'); ctx.body.insertBefore(tabs, ctx.body.firstChild); ctx.body.appendChild(tbl);
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
      return { height: [() => P.h, (h) => { P.h = h; draw(); }], update(reason) { if (reason === 'load' || reason === 'data' || reason === 'theme') { if (reason !== 'theme') cacheKey = ''; draw(); } }, destroy() { ro.disconnect(); } };
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
      tbl.classList.add('wscroll'); tbl.style.maxHeight = (o.h || 360) + 'px';
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
      return { height: [() => tbl.clientHeight, (h) => { tbl.style.maxHeight = h + 'px'; }], update(reason) { if (reason === 'load' || reason === 'data') draw(); } };
    },
  });

  // ---------- Interval overlay ----------
  // every lap (or every kilometre / mile) drawn from a common start, so repeats can be compared directly
  F.registerWidget('laps', {
    title: 'Interval overlay', multi: true,
    available: (A) => !A.noTime && (A.laps.length >= 2 || A.hasDist),
    tip: 'Laps laid on top of each other from a common start, so repeats of an interval session can be compared: does pace fade within each repeat, does heart rate climb higher from one to the next, how does form change. Early laps are blue, late laps red. <b>Fast laps</b> keeps only the hard efforts of an interval session. Without laps, every kilometre (or mile) is used. Hover a line for that lap, click to select it on chart and map.',
    create(ctx) {
      const o = ctx.opts; if (!o.k) { o.k = 'pace'; o.src = 'laps'; o.x = 'time'; o.which = 'all'; }
      const P = makePlot(ctx.body, o.h || 250), note = el('div', 'wnote'); ctx.body.appendChild(note);
      let segs = [], near = null;
      const pick = (id, opts, tip) => { const s = el('select'); s.title = tip; for (const [v, t] of opts) s.add(new Option(t, v)); s.value = o[id]; s.onchange = () => { o[id] = s.value; ctx.save(); draw(); }; return s; };
      const sk = metricSelect('', () => o.k, (v, silent) => { o.k = v; ctx.save(); if (!silent) draw(); });
      const sSrc = pick('src', [['laps', 'Laps'], ['split', 'Splits']], 'Laps as recorded, or one piece per kilometre / mile');
      const sWhich = pick('which', [['all', 'All'], ['fast', 'Fast laps'], ['slow', 'Slow laps']], 'All laps, or only the faster / slower half (work and recovery of an interval session)');
      const sX = pick('x', [['time', 'by time'], ['dist', 'by distance']], 'Horizontal axis: time or distance since the start of each lap');
      for (const n of [sk.node, sSrc, sWhich, sX]) ctx.ctl.appendChild(n);
      const build = (A) => {
        let list = [];
        const useLaps = o.src === 'laps' && A.laps.length >= 2;
        if (useLaps) list = A.laps.map((l, i) => ({ lo: l.lo, hi: l.hi, name: 'Lap ' + (l.index || i + 1) }));
        else if (A.hasDist) { let a = 0, kmN = 1; for (let i = 0; i < A.n; i++) if (A.km[i] >= kmN || i === A.n - 1) { if (i > a) list.push({ lo: a, hi: i, name: `${F.UN.du} ${kmN}` }); a = i; kmN++; } }
        list = list.filter((s) => s.hi - s.lo >= 5);
        for (const s of list) { const t = A.mt[s.hi] - A.mt[s.lo], d = A.km[s.hi] - A.km[s.lo]; s.t = t; s.d = d; s.v = t > 0 ? d / t : 0; }
        if (o.which !== 'all' && list.length > 2 && A.hasDist) { const vs = list.map((s) => s.v), mid = (Math.min(...vs) + Math.max(...vs)) / 2; list = list.filter((s) => (o.which === 'fast') === (s.v >= mid)); }
        sSrc.hidden = !(A.laps.length >= 2 && A.hasDist); sWhich.hidden = !A.hasDist; sX.hidden = !A.hasDist;
        return list;
      };
      const xOf = (A, s, i) => (o.x === 'dist' && A.hasDist ? A.km[i] - A.km[s.lo] : A.mt[i] - A.mt[s.lo]);
      const colour = (j) => `hsl(${Math.round(240 - 240 * (segs.length > 1 ? j / (segs.length - 1) : 0))} 80% 58%)`;
      const draw = () => {
        const A = F.A; if (!A) return; sk.fill(); const k = o.k; if (!A.has[k]) return;
        segs = build(A); ctx.title('Interval overlay · ' + M[k].label);
        if (!segs.length) { P.begin({ x: [0, 1], y: [0, 1] }); note.textContent = 'No laps to overlay.'; return; }
        const byDist = o.x === 'dist' && A.hasDist, xmax = Math.max(...segs.map((s) => (byDist ? s.d : s.t))), v = A.chart[k];
        const f = P.begin({ x: [0, xmax || 1], y: A.rng[k], yRev: M[k].dir === -1, xFmt: byDist ? (x) => String(+x.toFixed(2)) : F.fmtDur, yFmt: M[k].fmt, xLabel: byDist ? 'distance from lap start (' + F.UN.du + ')' : 'time from lap start', yLabel: M[k].label + unitOf(k) });
        const g = f.ctx; g.save(); g.beginPath(); g.rect(f.box.l, f.box.t, f.box.r - f.box.l, f.box.b - f.box.t); g.clip(); g.lineJoin = 'round';
        segs.forEach((s, j) => {
          const step = Math.max(1, Math.floor((s.hi - s.lo) / 600)); g.strokeStyle = colour(j); g.lineWidth = 1.6; g.globalAlpha = 0.85; g.beginPath(); let on = false;
          for (let i = s.lo; i <= s.hi; i += step) { if (!finite(v[i])) { on = false; continue; } const x = f.X(xOf(A, s, i)), y = f.Y(v[i]); if (on) g.lineTo(x, y); else { g.moveTo(x, y); on = true; } }
          g.stroke();
        });
        g.restore();
        note.innerHTML = `${segs.length} ${o.src === 'laps' && A.laps.length >= 2 ? 'laps' : 'splits'} · <span style="color:${colour(0)}">■</span> first → <span style="color:${colour(segs.length - 1)}">■</span> last · hover a line, click to select`;
        mark();
      };
      // highlight: the lap under the mouse, or the lap containing the hovered moment
      const mark = () => {
        P.clearOv(); const A = F.A, f = P.frame, k = o.k; if (!A || !f || !segs.length || !A.has[k]) return;
        const i = F.S.hover, j = near != null ? near : i == null ? -1 : segs.findIndex((s) => i >= s.lo && i <= s.hi); if (j < 0 || !segs[j]) return;
        const s = segs[j], v = A.chart[k], g = f.octx, step = Math.max(1, Math.floor((s.hi - s.lo) / 600));
        g.save(); g.beginPath(); g.rect(f.box.l, f.box.t, f.box.r - f.box.l, f.box.b - f.box.t); g.clip();
        for (const [w, c] of [[5.5, F.cssVar('--card')], [3, colour(j)]]) { g.strokeStyle = c; g.lineWidth = w; g.lineJoin = 'round'; g.beginPath(); let on = false; for (let q = s.lo; q <= s.hi; q += step) { if (!finite(v[q])) { on = false; continue; } const x = f.X(xOf(A, s, q)), y = f.Y(v[q]); if (on) g.lineTo(x, y); else { g.moveTo(x, y); on = true; } } g.stroke(); }
        if (i != null && i >= s.lo && i <= s.hi && finite(v[i])) { g.fillStyle = F.cssVar('--bg'); g.strokeStyle = f.text; g.lineWidth = 2; g.beginPath(); g.arc(f.X(xOf(A, s, i)), f.Y(v[i]), 5, 0, 6.3); g.fill(); g.stroke(); }
        g.restore();
        const st = F.stats(s.lo, s.hi).m[k];
        g.fillStyle = f.text; g.font = '12px system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'top';
        g.fillText(`${s.name} · ${F.fmtDur(s.t)}${A.hasDist ? ' · ' + s.d.toFixed(2) + ' ' + F.UN.du : ''}${st ? ' · avg ' + M[k].fmt(st.avg) + unitOf(k) : ''}`, f.box.r - 4, f.box.t + 3);
      };
      P.base.style.cursor = 'pointer';
      P.base.addEventListener('mousemove', (e) => {
        const A = F.A, f = P.frame; if (!A || !f || !segs.length) return;
        const r = P.base.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, v = A.chart[o.k]; let bj = -1, bi = -1, bd = 30 * 30;
        segs.forEach((s, j) => { const step = Math.max(1, Math.floor((s.hi - s.lo) / 300)); for (let i = s.lo; i <= s.hi; i += step) { if (!finite(v[i])) continue; const dx = f.X(xOf(A, s, i)) - mx, dy = f.Y(v[i]) - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; bj = j; bi = i; } } });
        near = bj < 0 ? null : bj;
        if (bi >= 0) F.setHover(bi, 'widget'); else F.setHover(null, 'widget');
        mark();
      });
      P.base.addEventListener('mouseleave', () => { near = null; F.setHover(null, 'widget'); mark(); });
      P.base.addEventListener('click', () => { if (near != null && segs[near]) F.setSel(segs[near].lo, segs[near].hi, true); });
      const ro = onResize(ctx.body, draw);
      return { height: [() => P.h, (h) => { P.h = h; draw(); }], update(reason) { if (reason === 'hover') mark(); else if (reason !== 'sel' && reason !== 'picks') draw(); }, destroy() { ro.disconnect(); } };
    },
  });

  // ---------- Speed decomposition ----------
  // speed = cadence x step length. Shows which of the two you use to go faster.
  F.registerWidget('decomp', {
    title: 'Speed = cadence × step', multi: false,
    available: (A) => A.has.cadence && A.has.pace && !A.noTime,
    tip: 'Speed is cadence multiplied by the distance covered per step (per pedal turn when cycling). Each dot is one moment: cadence across, step length up, so dots further up and to the right are faster; the dashed curves are lines of equal pace. <b>Box / Lasso</b>: draw around a group of dots to pick those moments; they stay in colour on the map and in the chart while everything else is faded. Click the plot to clear. The summary says how much of your change in speed comes from quicker steps and how much from longer ones. Many runners speed up almost only by lengthening the step; a share for cadence of around a third or more is common in trained runners. Standing and walking breaks are left out.',
    create(ctx) {
      const o = ctx.opts, P = makePlot(ctx.body, o.h || 280), note = el('div', 'wnote'); ctx.body.appendChild(note);
      let pts = [], cadA = null, stepA = null, key = '';
      const prep = (A) => { // per-moment cadence (per minute) and step length (m), lightly smoothed
        const k = A.fileName + '|' + A.n + '|' + F.S.smoothSec; if (k === key) return; key = k;
        const sp = F.roll(A.R.map((r) => (finite(r.speed) ? r.speed : null)), 3, false), cd = F.roll(A.R.map((r) => (finite(r.cadence) && r.cadence > 0 ? r.cadence : null)), 3, false);
        cadA = cd; stepA = sp.map((v, i) => (finite(v) && finite(cd[i]) && cd[i] > (A.foot ? 100 : 30) && v > (A.foot ? 1.2 : 1.5) ? (v * 60) / cd[i] : null));
      };
      const draw = () => {
        const A = F.A; if (!A) return; prep(A);
        const [lo, hi] = F.selRange(), all = []; for (let i = 0; i < A.n; i++) if (finite(stepA[i])) all.push(i);
        if (all.length < 30) { P.begin({ x: [0, 1], y: [0, 1] }); note.textContent = 'Not enough moving data with cadence.'; return; }
        const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
        const cs = all.map((i) => cadA[i]), ss = all.map((i) => stepA[i]), pad = (a, b) => { const d = (b - a || 1) * 0.12; return [a - d, b + d]; };
        const xd = pad(q(cs, 0.01), q(cs, 0.99)), yd = pad(q(ss, 0.01), q(ss, 0.99)), stepName = A.foot ? 'step length' : 'distance per pedal turn';
        const f = P.begin({ x: xd, y: yd, xFmt: (v) => v.toFixed(0), yFmt: (v) => v.toFixed(2), xLabel: 'cadence (' + M.cadence.unit + ')', yLabel: stepName + ' (m)' });
        const g = f.ctx; g.save(); g.beginPath(); g.rect(f.box.l, f.box.t, f.box.r - f.box.l, f.box.b - f.box.t); g.clip();
        // lines of equal speed: step = v * 60 / cadence
        const vLo = (xd[0] * yd[0]) / 60, vHi = (xd[1] * yd[1]) / 60; g.font = '11px system-ui, sans-serif'; g.textBaseline = 'bottom';
        for (const v of niceTicks(vLo, vHi, 7)) {
          if (v <= 0) continue; g.setLineDash([4, 4]); g.strokeStyle = f.muted; g.globalAlpha = 0.6; g.lineWidth = 1; g.beginPath();
          for (let s = 0; s <= 40; s++) { const c = xd[0] + ((xd[1] - xd[0]) * s) / 40, x = f.X(c), y = f.Y((v * 60) / c); if (s) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); g.setLineDash([]);
          const cx = xd[1] - (xd[1] - xd[0]) * 0.02, ly = f.Y((v * 60) / cx); if (ly > f.box.t + 14 && ly < f.box.b) { g.globalAlpha = 0.9; g.fillStyle = f.muted; g.textAlign = 'right'; g.fillText(M.pace.fmt(F.spd(v)) + unitOf('pace'), f.X(cx), ly - 2); }
        }
        g.globalAlpha = 0.16; g.fillStyle = f.muted;
        if (F.activeSel()) for (const i of sample(0, A.n - 1, 4000)) if (finite(stepA[i])) g.fillRect(f.X(cadA[i]) - 1, f.Y(stepA[i]) - 1, 2, 2);
        pts = []; g.globalAlpha = 0.75; const pv = A.smooth.pace;
        for (const i of sample(lo, hi, 6000)) { if (!finite(stepA[i])) continue; const px = f.X(cadA[i]), py = f.Y(stepA[i]), fd = faded(i); g.globalAlpha = fd ? 0.22 : 0.75; g.fillStyle = fd ? f.muted : F.colorOf('pace', pv[i]); g.beginPath(); g.arc(px, py, 1.9, 0, 6.3); g.fill(); pts.push([px, py, i]); }
        g.restore();
        // ln(speed) = ln(cadence) + ln(step): the share of each in the variation of speed is its covariance with ln(speed)
        let n = 0, sc = 0, sl = 0, sv = 0, scv = 0, slv = 0, svv = 0, mc = 0, ms = 0;
        for (let i = lo; i <= hi; i++) { if (!finite(stepA[i])) continue; const a = Math.log(cadA[i]), b = Math.log(stepA[i]), v = a + b; n++; sc += a; sl += b; sv += v; scv += a * v; slv += b * v; svv += v * v; mc += cadA[i]; ms += stepA[i]; }
        const varV = svv / n - (sv / n) * (sv / n), shareC = varV > 1e-6 ? (scv / n - (sc / n) * (sv / n)) / varV : null;
        let txt = `${F.activeSel() ? 'Selection' : 'Whole activity'} · average ${(mc / n).toFixed(0)} ${M.cadence.unit} × ${(ms / n).toFixed(2)} m`;
        if (shareC != null && Math.sqrt(varV) > 0.03) { const c = Math.round(Math.max(0, Math.min(1, shareC)) * 100); txt += ` · changes in speed come <b>${c}%</b> from cadence and <b>${100 - c}%</b> from ${stepName}`; }
        else txt += ' · speed too steady to tell what drives it';
        note.innerHTML = txt + ' · colour: ' + F.PACE().toLowerCase();
        mark();
      };
      const box = pickTool(P, ctx.body, ctx.ctl, o, ctx.save, () => {
        const f = P.frame, out = [], [lo, hi] = F.selRange();
        for (let i = lo; i <= hi; i++) if (finite(stepA[i])) out.push([f.X(cadA[i]), f.Y(stepA[i]), i]);
        return out;
      });
      const mark = () => { P.clearOv(); box.paint(); const i = F.S.hover, f = P.frame; if (i == null || !f || !stepA || !finite(stepA[i])) return; const g = f.octx; g.strokeStyle = f.text; g.lineWidth = 2; g.fillStyle = F.cssVar('--bg'); g.beginPath(); g.arc(f.X(cadA[i]), f.Y(stepA[i]), 6, 0, 6.3); g.fill(); g.stroke(); };
      P.base.addEventListener('mousemove', (e) => { const r = P.base.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; let best = -1, bd = 144; for (const p of pts) { const d = (p[0] - mx) * (p[0] - mx) + (p[1] - my) * (p[1] - my); if (d < bd) { bd = d; best = p[2]; } } F.setHover(best < 0 ? null : best, 'widget'); });
      P.base.addEventListener('mouseleave', () => F.setHover(null, 'widget'));
      const ro = onResize(ctx.body, draw);
      return { height: [() => P.h, (h) => { P.h = h; draw(); }], update(reason) { if (reason === 'hover') mark(); else { if (reason === 'load' || reason === 'data') key = ''; draw(); if (reason === 'load') box.reset(); else if (reason === 'sel' || reason === 'data') box.repick(); } }, destroy() { ro.disconnect(); box.reset(); } };
    },
  });

  // ---------- 3D terrain map ----------
  // MapLibre GL JS is bundled in the page as inert text (see index.html) and only compiled when this widget is first
  // opened, so it costs nothing otherwise. Terrain and map tiles still come from the network.
  // Terrain: Mapterhorn (open data, no key). Detail depends on the region: about 30 m worldwide, down to a few metres
  // where national surveys are included (Switzerland, most of Europe, USA, …). Detailed tiles only exist for those
  // regions, so a missing tile is rebuilt from the nearest coarser one instead of leaving a hole.
  const ML = { dem: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp', demMax: 15, demBase: 12 };
  let mlPromise = null;
  function demProtocol() {
    const get = (z, x, y, signal) => fetch(ML.dem.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal });
    maplibregl.addProtocol('ffpdem', async (params, abort) => {
      const m = /(\d+)\/(\d+)\/(\d+)\.webp$/.exec(params.url); let z = +m[1], x = +m[2], y = +m[3];
      let res = await get(z, x, y, abort.signal);
      if (res.ok) return { data: await res.arrayBuffer() };
      // walk up to a tile that exists, then cut out and enlarge our part of it (no smoothing: pixels are encoded heights)
      let k = 0, px = x, py = y;
      while (!res.ok && z - k > ML.demBase) { k++; px = x >> k; py = y >> k; res = await get(z - k, px, py, abort.signal); }
      if (!res.ok) throw new Error('no terrain tile');
      const bmp = await createImageBitmap(await res.blob()), n = bmp.width, c = document.createElement('canvas'); c.width = c.height = n;
      const g = c.getContext('2d'), part = n / (1 << k); g.imageSmoothingEnabled = false;
      g.drawImage(bmp, (x - (px << k)) * part, (y - (py << k)) * part, part, part, 0, 0, n, n);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      return { data: await blob.arrayBuffer() };
    });
  }
  function loadMapLibre() {
    if (!mlPromise) mlPromise = new Promise((res, rej) => {
      if (!window.maplibregl) {
        const src = document.getElementById('maplibreSrc');
        if (!src) { rej(new Error('the 3D engine is missing from this build')); return; }
        const sc = el('script'); sc.textContent = src.textContent; document.head.appendChild(sc);
      }
      if (!window.maplibregl) { rej(new Error('the 3D engine did not start')); return; }
      demProtocol(); res();
    });
    return mlPromise;
  }
  F.registerWidget('map3d', {
    title: '3D map', multi: false, col: 'R',
    available: (A) => A.hasGps,
    tip: 'The track on 3D terrain, coloured like the 2D map. <b>Drag</b> to move; <b>middle-button drag, right-drag or Ctrl+drag</b> to tilt and rotate; <b>scroll</b> to zoom. Hovering the track shows that moment in the chart; the selection is emphasised. <b>Follow</b> keeps the view centred on the position dot while hovering the chart and during replay; when a mountain would get in the way, the view tilts further down to look over it and returns to your angle afterwards. Terrain and map images are downloaded while you look around, so this widget needs an internet connection. Terrain detail depends on the region: a few metres where national survey data is available (Switzerland, much of Europe, USA), about 30 m elsewhere.',
    create(ctx) {
      const o = ctx.opts; if (!o.layer) o.layer = F.S.layer && F.LAYERS[F.S.layer] ? F.S.layer : 'topo'; if (o.layer !== 'none' && !F.layerUrl(o.layer)) o.layer = 'topo'; if (!o.relief) o.relief = 1.5;
      const box = el('div', 'map3d'), msg = el('div', 'wnote', 'Loading 3D engine…'); ctx.body.appendChild(box); ctx.body.appendChild(msg);
      box.style.height = (o.h || 420) + 'px';
      const lay = el('select'); lay.title = 'Map draped over the terrain';
      // maps that need an API key are offered once the key has been entered (choose that map once in the 2D map)
      for (const id in F.LAYERS) if (id === 'none' || F.layerUrl(id)) lay.add(new Option(id === 'none' ? 'Terrain shading only' : F.LAYERS[id].name.replace(' (API key)', ''), id)); lay.value = o.layer;
      const logo = el('a', 'maplogo map3d-logo'); logo.target = '_blank'; logo.rel = 'noopener'; logo.hidden = true;
      const rel = el('select'); rel.title = 'Vertical exaggeration of the terrain'; [[1, 'Relief ×1'], [1.5, 'Relief ×1.5'], [2, 'Relief ×2'], [3, 'Relief ×3']].forEach(([v, t]) => rel.add(new Option(t, v))); rel.value = String(o.relief);
      const reset = el('button', 'btn small', 'Reset view'); reset.title = 'Fit the track (or the selection) again, tilted';
      const fol = el('label', null, '<input type="checkbox"> Follow'); fol.title = 'Keep the view centred on the position dot while hovering the chart (the previous view returns afterwards) and during replay';
      const folChk = fol.firstChild; folChk.checked = o.follow !== false; folChk.onchange = () => { o.follow = folChk.checked; ctx.save(); if (!o.follow) back(); };
      ctx.ctl.appendChild(lay); ctx.ctl.appendChild(rel); ctx.ctl.appendChild(fol); ctx.ctl.appendChild(reset);
      let saved = null; // view (centre, tilt) to return to after following the chart cursor
      let following = false, wantPitch = 60; // wantPitch: the tilt the user chose; Follow only departs from it to see over terrain
      const back = () => { following = false; if (saved && map) map.jumpTo({ center: saved.c, pitch: saved.p }); saved = null; };
      // Largest tilt, not above `want`, at which nothing stands between the camera and the point: walk along the ground
      // from the point towards the camera and compare the terrain there with the height of the sight line.
      const clearPitch = (lon, lat, want) => {
        const tr = map.transform, rad = Math.PI / 180, fov = ((tr && tr.fov) || 36.87) * rad;
        const mpp = (40075016.686 * Math.cos(lat * rad)) / (512 * Math.pow(2, map.getZoom())), D = (box.clientHeight / 2 / Math.tan(fov / 2)) * mpp;
        const base = map.queryTerrainElevation([lon, lat]); if (base == null) return want;
        const dir = (map.getBearing() + 180) * rad, mLat = 111320, mLon = 111320 * Math.cos(lat * rad), margin = Math.max(15, D * 0.06), N = 8;
        const sinB = Math.sin(dir), cosB = Math.cos(dir);
        for (let p = want; p > 15; p -= 5) {
          const h = D * Math.sin(p * rad), v = D * Math.cos(p * rad); let ok = true;
          for (let k = 1; k <= N && ok; k++) {
            const d = (h * k) / N, e = map.queryTerrainElevation([lon + (sinB * d) / mLon, lat + (cosB * d) / mLat]);
            if (e != null && e - base + margin > (v * k) / N) ok = false;
          }
          if (ok) return p;
        }
        return 15;
      };
      let map = null, ready = false, dead = false, marker = null, line = null, pending = null;

      // decimated track split into runs of equal colour (one feature per run, colour as a property).
      // Per-feature colours are used instead of a line gradient: gradient lines are not drawn on terrain.
      const buildLine = (lo, hi, cum) => { // cum: only the picked moments (prefix counts), everything else left out
        const A = F.A, step = Math.max(1, Math.ceil((hi - lo + 1) / 3000)), idx = []; for (let i = lo; i <= hi; i += step) idx.push(i); if (idx[idx.length - 1] !== hi) idx.push(hi);
        const coords = idx.map((i) => [A.lon[i], A.lat[i]]), key = F.S.colorBy, vals = A.smooth[key], runs = [];
        let cur = null, start = 0;
        const flush = (end) => { if (cur != null && end > start) runs.push({ type: 'Feature', properties: { c: cur }, geometry: { type: 'LineString', coordinates: coords.slice(start, end + 1) } }); };
        for (let p = 0; p < idx.length - 1; p++) {
          const c = A.pc[idx[p + 1]] !== A.pc[idx[p]] || (cum && cum[idx[p + 1]] === cum[idx[p]]) ? null : F.colorOf(key, vals[idx[p]] != null ? vals[idx[p]] : vals[idx[p + 1]]); // null = pause: leave a gap
          if (c !== cur) { flush(p); cur = c; start = p; }
        }
        flush(idx.length - 1);
        // outline: one continuous line per stretch between pauses, so the edge is smooth rather than beaded per colour run
        const parts = []; let seg = [coords[0]];
        for (let p = 0; p < idx.length - 1; p++) { if (A.pc[idx[p + 1]] !== A.pc[idx[p]] || (cum && cum[idx[p + 1]] === cum[idx[p]])) { if (seg.length > 1) parts.push(seg); seg = []; } seg.push(coords[p + 1]); }
        if (seg.length > 1) parts.push(seg);
        return { geo: { type: 'FeatureCollection', features: runs }, edge: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: parts } }, coords };
      };
      const setBase = () => {
        if (map.getLayer('base')) map.removeLayer('base'); if (map.getSource('base')) map.removeSource('base');
        const L = F.LAYERS[o.layer], before = map.getLayer('shade') ? 'shade' : undefined, url = F.layerUrl(o.layer);
        logo.hidden = !(L && L.logo && url); if (!logo.hidden) { logo.href = L.logo.href; logo.innerHTML = `<img src="${L.logo.img}" alt="${L.logo.alt}" height="22">`; if (!logo.parentNode) box.appendChild(logo); }
        if (L && url) {
          const subs = (L.o.subdomains || 'abc').split(''), urls = (url.indexOf('{s}') >= 0 ? subs : ['']).map((sd) => url.replace('{s}', sd).replace('{r}', ''));
          map.addSource('base', { type: 'raster', tiles: urls, tileSize: 256, maxzoom: L.o.maxNativeZoom || 18, attribution: L.o.attribution || '' });
          map.addLayer({ id: 'base', type: 'raster', source: 'base' }, before);
        }
        map.setPaintProperty('shade', 'hillshade-exaggeration', L && url ? 0.25 : 0.7);
        map.setPaintProperty('bg', 'background-color', L && url ? '#8a9199' : '#3b4252');
      };
      const drawTrack = (fit) => {
        const A = F.A; if (!ready || !A || !A.hasGps) return;
        const cum = F.S.pickCum, sel0 = F.activeSel(), all = buildLine(0, A.n - 1), selPart = sel0 ? buildLine(sel0[0], sel0[1]) : null; line = selPart || all;
        // emphasised part: the picked moments when some are picked, otherwise the selection
        const [rl, rh] = F.selRange(), part = cum ? buildLine(rl, rh, cum) : selPart, sel = !!part;
        map.getSource('track').setData(all.geo); map.getSource('track-edge').setData(all.edge);
        map.setPaintProperty('track', 'line-opacity', sel ? 0.5 : 1); map.setPaintProperty('track-case', 'line-opacity', sel ? 0.4 : 1); map.setPaintProperty('track-halo', 'line-opacity', sel ? 0.4 : 0.95);
        map.getSource('sel').setData(part ? part.geo : { type: 'FeatureCollection', features: [] }); map.getSource('sel-edge').setData(part ? part.edge : { type: 'FeatureCollection', features: [] });
        if (fit) fitView(false);
      };
      const fitView = (anim) => {
        if (!line) return; const b = new maplibregl.LngLatBounds(line.coords[0], line.coords[0]); for (const c of line.coords) b.extend(c);
        saved = null; wantPitch = 60; map.fitBounds(b, { padding: 50, pitch: 60, bearing: -20, animate: !!anim, maxZoom: 15 });
      };
      const mark = () => {
        const A = F.A, i = F.S.hover; if (!ready || !marker) return;
        if (!A || i == null || !A.hasGps) { marker.remove(); back(); return; }
        marker.setLngLat([A.lon[i], A.lat[i]]).addTo(map);
        const src = F.S.hoverSrc;
        if (o.follow !== false && (src === 'chart' || src === 'replay')) {
          if (!following) { following = true; wantPitch = map.getPitch(); }
          if (src === 'chart' && !saved) saved = { c: map.getCenter(), p: map.getPitch() };
          if (src === 'replay') saved = null; // after a replay the view stays where it ended
          // tilt: up over terrain quickly, back to the user's angle slowly, so the view does not pump on ridgelines
          const cur = map.getPitch(), goal = clearPitch(A.lon[i], A.lat[i], wantPitch), d = goal - cur;
          const pitch = Math.abs(d) < 0.2 ? goal : cur + d * (d < 0 ? 0.4 : 0.06);
          map.jumpTo({ center: [A.lon[i], A.lat[i]], pitch });
        } else following = false;
      };
      const start = () => {
        if (dead) return;
        try {
          map = new maplibregl.Map({ container: box, style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#3b4252' } }] }, center: [8.54, 47.37], zoom: 11, pitch: 60, bearing: -20, maxPitch: 80, attributionControl: { compact: true } });
        } catch (e) { msg.textContent = '3D view is not available: this browser could not start WebGL.'; return; }
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
        map.on('error', (e) => { console.warn('3D map', e && e.error); });
        map.on('load', () => {
          if (dead) return;
          const demSrc = { type: 'raster-dem', tiles: ['ffpdem://' + ML.dem.replace('https://', '')], tileSize: 512, maxzoom: ML.demMax, encoding: 'terrarium' };
          map.addSource('dem', Object.assign({ attribution: 'Terrain: <a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">© Mapterhorn</a>' }, demSrc));
          map.addSource('dem2', demSrc);
          map.setTerrain({ source: 'dem', exaggeration: +o.relief });
          map.addLayer({ id: 'shade', type: 'hillshade', source: 'dem2', paint: { 'hillshade-exaggeration': 0.7, 'hillshade-shadow-color': '#0b1020' } });
          const empty = { type: 'FeatureCollection', features: [] }, round = { 'line-cap': 'round', 'line-join': 'round' };
          map.addSource('track', { type: 'geojson', data: empty });
          map.addSource('sel', { type: 'geojson', data: empty }); map.addSource('track-edge', { type: 'geojson', data: empty }); map.addSource('sel-edge', { type: 'geojson', data: empty });
          // white outer + dark inner edge so the line separates from any map colour (as on the 2D map)
          map.addLayer({ id: 'track-halo', type: 'line', source: 'track-edge', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 10 } });
          map.addLayer({ id: 'track-case', type: 'line', source: 'track-edge', layout: round, paint: { 'line-color': '#0b0f1a', 'line-width': 7.5 } });
          map.addLayer({ id: 'track', type: 'line', source: 'track', layout: round, paint: { 'line-width': 5, 'line-color': ['get', 'c'] } });
          map.addLayer({ id: 'sel-case', type: 'line', source: 'sel-edge', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 12 } });
          map.addLayer({ id: 'sel-case2', type: 'line', source: 'sel-edge', layout: round, paint: { 'line-color': '#0b0f1a', 'line-width': 9.5 } });
          map.addLayer({ id: 'sel', type: 'line', source: 'sel', layout: round, paint: { 'line-width': 6.5, 'line-color': ['get', 'c'] } });
          const dot = el('div', 'map3d-dot'); marker = new maplibregl.Marker({ element: dot });
          ready = true; msg.textContent = '';
          setBase(); drawTrack(true); mark();
        });
        // hover: nearest track point to the mouse (in screen space, selection first)
        map.on('mousemove', (e) => {
          const A = F.A; if (!ready || !A || !A.hasGps || F.isReplay()) return;
          const [lo, hi] = F.selRange(), step = Math.max(1, Math.ceil((hi - lo + 1) / 1500)); let best = -1, bd = 18 * 18;
          for (let i = lo; i <= hi; i += step) { const p = map.project([A.lon[i], A.lat[i]]), d = (p.x - e.point.x) * (p.x - e.point.x) + (p.y - e.point.y) * (p.y - e.point.y); if (d < bd) { bd = d; best = i; } }
          map.getCanvas().style.cursor = best < 0 ? '' : 'crosshair';
          F.setHover(best < 0 ? null : best, 'widget');
        });
        map.on('mouseout', () => { if (!F.isReplay()) F.setHover(null, 'widget'); });
        map.on('pitchend', (e) => { if (e.originalEvent) wantPitch = map.getPitch(); }); // tilt changed by hand
        // middle-button drag: rotate (left / right) and tilt (up / down), like right-drag
        const cv = map.getCanvasContainer();
        cv.addEventListener('mousedown', (e) => {
          if (e.button !== 1) return;
          e.preventDefault(); e.stopPropagation();
          let lx = e.clientX, ly = e.clientY;
          const move = (ev) => { map.jumpTo({ bearing: map.getBearing() + (ev.clientX - lx) * 0.5, pitch: Math.max(0, Math.min(map.getMaxPitch(), map.getPitch() - (ev.clientY - ly) * 0.4)) }); lx = ev.clientX; ly = ev.clientY; wantPitch = map.getPitch(); };
          const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
          document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
        }, true);
        cv.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
      };
      loadMapLibre().then(start, (e) => { msg.textContent = '3D view is not available: ' + e.message; });
      lay.onchange = () => { o.layer = lay.value; ctx.save(); if (ready) setBase(); };
      rel.onchange = () => { o.relief = +rel.value; ctx.save(); if (ready) map.setTerrain({ source: 'dem', exaggeration: o.relief }); };
      reset.onclick = () => { if (ready) fitView(true); };
      const ro = onResize(ctx.body, () => { if (map) map.resize(); });
      return {
        height: [() => box.clientHeight, (h) => { box.style.height = h + 'px'; if (map) map.resize(); }],
        update(reason) {
          if (!ready) return;
          if (reason === 'hover') { mark(); return; }
          if (reason === 'picks') { drawTrack(false); return; }
          if (reason === 'sel') { clearTimeout(pending); pending = setTimeout(() => drawTrack(false), 60); return; }
          drawTrack(reason === 'load');
        },
        destroy() { dead = true; ro.disconnect(); clearTimeout(pending); try { if (map) map.remove(); } catch (e) { /* ignore */ } },
      };
    },
  });

  F.widgetsReady();
})();
