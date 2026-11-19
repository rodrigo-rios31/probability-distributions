/*
 * chart.js — Gráfica interactiva en <canvas> para distribuciones de probabilidad.
 *
 * - Curva de densidad (PDF/PMF) o de distribución acumulada (CDF)
 * - Área sombreada exacta según la probabilidad calculada
 * - Marcadores arrastrables (ratón y táctil) que actualizan los valores
 * - Tooltip con x, f(x) y F(x)
 * - Líneas de media y ±σ, nitidez en pantallas de alta densidad
 */
(function (root) {
  'use strict';
  const PD = (root.PD = root.PD || {});
  const fmt = PD.fmt;

  function niceStep(range, count) {
    const raw = range / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const m = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
    return m * mag;
  }

  function ticks(min, max, count, integer) {
    let step = niceStep(max - min, count);
    if (integer) step = Math.max(1, Math.round(step));
    const out = [];
    const start = Math.ceil(min / step - 1e-9) * step;
    for (let v = start; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-10 ? 0 : v);
    return { step, values: out };
  }

  function cssVar(el, name, fallback) {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  }

  class Chart {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts;
      this.state = null;
      this.hover = null;
      this.drag = null;
      this.cache = null;
      this.raf = 0;
      this.size = { w: 0, h: 0, dpr: 1 };

      const ro = new ResizeObserver(() => this.resize());
      ro.observe(canvas.parentElement);
      this.resize();

      canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      canvas.addEventListener('pointermove', (e) => this.onMove(e));
      canvas.addEventListener('pointerup', (e) => this.onUp(e));
      canvas.addEventListener('pointercancel', () => this.cancelDrag());
      canvas.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse' && !this.drag) { this.hover = null; this.invalidate(); }
      });
      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.invalidate());
      }
    }

    resize() {
      const parent = this.canvas.parentElement;
      const w = parent.clientWidth, h = parent.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      if (w === this.size.w && h === this.size.h && dpr === this.size.dpr) return;
      this.size = { w, h, dpr };
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.cache = null;
      this.invalidate(true);
    }

    setState(s) {
      this.state = s;
      this.invalidate();
    }

    invalidate(sync) {
      if (sync) { this.draw(); return; }
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
    }

    /* ------------------------------------------------------------ */
    colors() {
      const el = this.canvas;
      return {
        bg: cssVar(el, '--surface', '#fff'),
        text: cssVar(el, '--text', '#111'),
        muted: cssVar(el, '--text-muted', '#667'),
        grid: cssVar(el, '--chart-grid', 'rgba(0,0,0,.07)'),
        axis: cssVar(el, '--chart-axis', 'rgba(0,0,0,.45)'),
        curve: cssVar(el, '--chart-curve', '#1f2a44'),
        fill: cssVar(el, '--chart-fill', 'rgba(79,70,229,.35)'),
        fillStrong: cssVar(el, '--chart-fill-strong', '#4f46e5'),
        bar: cssVar(el, '--chart-bar', '#cbd5e1'),
        barHi: cssVar(el, '--chart-bar-hi', '#4f46e5'),
        handle: cssVar(el, '--chart-handle', '#ef4444'),
        mean: cssVar(el, '--chart-mean', '#0ea5e9'),
        font: cssVar(el, '--font-sans', 'system-ui, sans-serif'),
        mono: cssVar(el, '--font-mono', 'ui-monospace, monospace'),
      };
    }

    /* ------------------------------------------------------------ */
    /* Geometría y muestreo                                          */
    /* ------------------------------------------------------------ */
    layout() {
      const { w, h } = this.size;
      const compact = w < 480;
      return {
        left: compact ? 46 : 58,
        right: compact ? 12 : 20,
        top: 40,
        bottom: compact ? 38 : 44,
        compact,
        get pw() { return w - this.left - this.right; },
        get ph() { return h - this.top - this.bottom; },
      };
    }

    compute() {
      const s = this.state;
      const L = this.layout();
      const key = [s.d.id, JSON.stringify(s.prm), s.view, this.size.w, this.size.h, s.rangeKey || ''].join('|');
      if (this.cache && this.cache.key === key) return this.cache;

      const D = PD.dist;
      const d = s.d, prm = s.prm;
      const discrete = d.type === 'discrete';
      let [xmin, xmax] = s.range || D.plotRange(d, prm);
      const c = { key, discrete, L };

      if (discrete) {
        c.kmin = xmin; c.kmax = xmax;
        c.pts = [];
        let maxP = 0;
        for (let k = xmin; k <= xmax; k++) {
          const pm = d.pmf(k, prm);
          const F = d.cdf(k, prm);
          c.pts.push({ k, p: pm, F });
          if (pm > maxP) maxP = pm;
        }
        xmin -= 0.6; xmax += 0.6;
        c.ymax = s.view === 'cdf' ? 1.06 : (maxP > 0 ? maxP * 1.12 : 1);
      } else {
        const n = Math.max(300, Math.round(L.pw * 2));
        const xsSet = [];
        for (let i = 0; i <= n; i++) xsSet.push(xmin + ((xmax - xmin) * i) / n);
        // Puntos críticos: soporte, moda, mediana (picos y discontinuidades exactos)
        const [sLo, sHi] = d.support(prm);
        const eps = (xmax - xmin) * 1e-9;
        [sLo, sLo - eps, sLo + eps, sHi, sHi - eps, sHi + eps].forEach((v) => {
          if (isFinite(v) && v > xmin && v < xmax) xsSet.push(v);
        });
        const mode = d.mode ? d.mode(prm) : null;
        if (typeof mode === 'number' && isFinite(mode) && mode > xmin && mode < xmax) xsSet.push(mode);
        xsSet.sort((a, b) => a - b);
        c.xs = xsSet;
        c.ys = xsSet.map((x) => (s.view === 'cdf' ? d.cdf(x, prm) : d.pdf(x, prm)));
        if (s.view === 'cdf') {
          c.ymax = 1.06;
        } else {
          const finite = c.ys.filter((y) => isFinite(y)).sort((a, b) => a - b);
          const max = finite.length ? finite[finite.length - 1] : 1;
          const p97 = finite.length ? finite[Math.floor(finite.length * 0.97)] : 1;
          const unbounded = c.ys.some((y) => !isFinite(y)) || max > 3 * p97;
          c.ymax = (unbounded ? p97 * 2 : max * 1.1) || 1;
        }
      }
      c.xmin = xmin; c.xmax = xmax;
      c.X = (x) => L.left + ((x - xmin) / (xmax - xmin)) * L.pw;
      c.Y = (y) => L.top + L.ph - (Math.min(y, c.ymax * 4) / c.ymax) * L.ph;
      c.invX = (px) => xmin + ((px - L.left) / L.pw) * (xmax - xmin);
      this.cache = c;
      return c;
    }

    valueAt(x) {
      const s = this.state, d = s.d;
      if (d.type === 'discrete') {
        const k = Math.round(x);
        return { x: k, f: d.pmf(k, s.prm), F: d.cdf(k, s.prm) };
      }
      return { x, f: d.pdf(x, s.prm), F: d.cdf(x, s.prm) };
    }

    inRegion(k) {
      for (const r of this.state.regions || []) {
        const okLo = k > r.lo || (k === r.lo && r.loInc);
        const okHi = k < r.hi || (k === r.hi && r.hiInc);
        if (okLo && okHi) return true;
      }
      return false;
    }

    /* ------------------------------------------------------------ */
    /* Dibujo                                                        */
    /* ------------------------------------------------------------ */
    draw(targetCtx, targetSize) {
      const ctx = targetCtx || this.ctx;
      const { w, h, dpr } = targetSize || this.size;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!this.state || !this.state.d || w < 50 || h < 50) return;
      if (this.state.error) return;

      const col = this.colors();
      const c = this.compute();
      const L = c.L;
      const s = this.state;

      // ---- Rejilla y ejes ----
      const yt = ticks(0, c.ymax / (s.view === 'cdf' ? 1.06 : 1.0), Math.max(3, Math.round(L.ph / 55)));
      const xt = ticks(c.xmin, c.xmax, Math.max(3, Math.round(L.pw / (L.compact ? 64 : 84))), c.discrete);
      ctx.lineWidth = 1;
      ctx.font = `${L.compact ? 10.5 : 11.5}px ${col.font}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (const v of yt.values) {
        if (v > c.ymax) continue;
        const y = Math.round(c.Y(v)) + 0.5;
        ctx.strokeStyle = col.grid;
        ctx.beginPath(); ctx.moveTo(L.left, y); ctx.lineTo(L.left + L.pw, y); ctx.stroke();
        ctx.fillStyle = col.muted;
        ctx.fillText(fmt.tick(v, yt.step), L.left - 7, y);
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const v of xt.values) {
        const x = Math.round(c.X(v)) + 0.5;
        ctx.strokeStyle = col.grid;
        ctx.beginPath(); ctx.moveTo(x, L.top); ctx.lineTo(x, L.top + L.ph); ctx.stroke();
        ctx.strokeStyle = col.axis;
        ctx.beginPath(); ctx.moveTo(x, L.top + L.ph); ctx.lineTo(x, L.top + L.ph + 4); ctx.stroke();
        ctx.fillStyle = col.muted;
        ctx.fillText(fmt.tick(v, xt.step), x, L.top + L.ph + 7);
      }
      // Eje X
      ctx.strokeStyle = col.axis;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(L.left, Math.round(L.top + L.ph) + 0.5);
      ctx.lineTo(L.left + L.pw, Math.round(L.top + L.ph) + 0.5);
      ctx.stroke();

      // Títulos de ejes
      ctx.fillStyle = col.muted;
      ctx.font = `italic ${L.compact ? 11 : 12}px ${col.font}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('x', L.left + L.pw, h - 4);
      ctx.save();
      ctx.translate(12, L.top + L.ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const yTitle = s.view === 'cdf' ? 'F(x) = P(X ≤ x)' : c.discrete ? 'P(X = x)' : 'f(x)';
      ctx.fillText(yTitle, 0, 0);
      ctx.restore();

      // ---- Área de trazado (recortada) ----
      ctx.save();
      ctx.beginPath();
      ctx.rect(L.left, L.top - 2, L.pw, L.ph + 2);
      ctx.clip();

      this.drawMarkers(ctx, c, col);
      if (c.discrete) this.drawDiscrete(ctx, c, col);
      else this.drawContinuous(ctx, c, col);
      ctx.restore();

      this.drawHandles(ctx, c, col);
      if (this.hover && !this.drag) this.drawHover(ctx, c, col);
    }

    drawMarkers(ctx, c, col) {
      const s = this.state;
      if (!s.showMean) return;
      const { mean, sd } = s.stats || {};
      if (!isFinite(mean)) return;
      const L = c.L;
      const line = (x, alpha, dash, label) => {
        if (x < c.xmin || x > c.xmax) return;
        const px = Math.round(c.X(x)) + 0.5;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = col.mean;
        ctx.setLineDash(dash);
        ctx.lineWidth = 1.25;
        ctx.beginPath(); ctx.moveTo(px, L.top + 14); ctx.lineTo(px, L.top + L.ph); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = col.mean;
        ctx.globalAlpha = Math.min(1, alpha + 0.25);
        ctx.font = `600 10.5px ${col.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, px, L.top + 2);
        ctx.globalAlpha = 1;
      };
      if (isFinite(sd) && sd > 0) {
        const pxPerSd = (sd / (c.xmax - c.xmin)) * L.pw;
        for (let k = 1; k <= 3; k++) {
          if (pxPerSd * k < 26 && k > 1) continue;
          line(mean - k * sd, 0.55 - k * 0.1, [2, 4], `−${k}σ`);
          line(mean + k * sd, 0.55 - k * 0.1, [2, 4], `+${k}σ`);
        }
      }
      line(mean, 0.95, [5, 4], 'μ');
    }

    drawContinuous(ctx, c, col) {
      const s = this.state, L = c.L;
      const base = L.top + L.ph;
      const cap = (y) => (isFinite(y) ? y : c.ymax * 4);

      if (s.view === 'pdf') {
        // Relleno suave bajo toda la curva
        ctx.beginPath();
        ctx.moveTo(c.X(c.xs[0]), base);
        for (let i = 0; i < c.xs.length; i++) ctx.lineTo(c.X(c.xs[i]), c.Y(cap(c.ys[i])));
        ctx.lineTo(c.X(c.xs[c.xs.length - 1]), base);
        ctx.closePath();
        ctx.fillStyle = col.bar;
        ctx.globalAlpha = 0.28;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Regiones de probabilidad
        for (const r of s.regions || []) {
          const lo = Math.max(r.lo, c.xmin), hi = Math.min(r.hi, c.xmax);
          if (!(hi > lo)) continue;
          const f = (x) => cap(s.d.pdf(x, s.prm));
          ctx.beginPath();
          ctx.moveTo(c.X(lo), base);
          ctx.lineTo(c.X(lo), c.Y(f(lo)));
          for (let i = 0; i < c.xs.length; i++) {
            const x = c.xs[i];
            if (x > lo && x < hi) ctx.lineTo(c.X(x), c.Y(cap(c.ys[i])));
          }
          ctx.lineTo(c.X(hi), c.Y(f(hi)));
          ctx.lineTo(c.X(hi), base);
          ctx.closePath();
          const grad = ctx.createLinearGradient(0, L.top, 0, base);
          grad.addColorStop(0, col.fill);
          grad.addColorStop(1, col.fill);
          ctx.fillStyle = grad;
          ctx.fill();
        }
      } else {
        // CDF: banda en el eje Y para la probabilidad de cada región
        for (const r of s.regions || []) {
          if (!(r.hi >= r.lo)) continue;
          const Flo = isFinite(r.lo) ? s.d.cdf(r.lo, s.prm) : 0;
          const Fhi = isFinite(r.hi) ? s.d.cdf(r.hi, s.prm) : 1;
          ctx.fillStyle = col.fill;
          ctx.fillRect(L.left, c.Y(Fhi), L.pw, c.Y(Flo) - c.Y(Fhi));
        }
      }

      // Curva
      ctx.beginPath();
      for (let i = 0; i < c.xs.length; i++) {
        const px = c.X(c.xs[i]), py = c.Y(cap(c.ys[i]));
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = col.curve;
      ctx.lineWidth = 2.25;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // En CDF resaltar el tramo de la región
      if (s.view === 'cdf') {
        for (const r of s.regions || []) {
          ctx.beginPath();
          let started = false;
          for (let i = 0; i < c.xs.length; i++) {
            const x = c.xs[i];
            if (x < r.lo || x > r.hi) continue;
            const px = c.X(x), py = c.Y(c.ys[i]);
            if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = col.fillStrong;
          ctx.lineWidth = 3.5;
          ctx.stroke();
        }
      }
    }

    drawDiscrete(ctx, c, col) {
      const s = this.state, L = c.L;
      const base = L.top + L.ph;
      const unit = L.pw / (c.xmax - c.xmin);
      const bw = Math.max(1, Math.min(unit * 0.74, 56));
      const hoverK = this.hover ? this.hover.x : null;

      if (s.view === 'pdf') {
        for (const pt of c.pts) {
          const x = c.X(pt.k);
          const y = c.Y(pt.p);
          const hi = this.inRegion(pt.k);
          ctx.fillStyle = hi ? col.barHi : col.bar;
          const top = Math.min(y, base - (pt.p > 0 ? 0.75 : 0));
          const r = Math.min(4, bw / 4);
          roundTop(ctx, x - bw / 2, top, bw, base - top, r);
          ctx.fill();
          if (hoverK === pt.k) {
            ctx.strokeStyle = col.text;
            ctx.lineWidth = 1.5;
            roundTop(ctx, x - bw / 2, top, bw, base - top, r);
            ctx.stroke();
          }
        }
      } else {
        // Función escalonada
        for (const r of s.regions || []) {
          const Flo = isFinite(r.lo) ? PD.dist.probOp(s.d, s.prm, r.loInc ? '<' : '<=', r.lo) : 0;
          const Fhi = isFinite(r.hi) ? PD.dist.probOp(s.d, s.prm, r.hiInc ? '<=' : '<', r.hi) : 1;
          if (!(Fhi > Flo)) continue;
          ctx.fillStyle = col.fill;
          ctx.fillRect(L.left, c.Y(Fhi), L.pw, c.Y(Flo) - c.Y(Fhi));
        }
        const dotR = Math.max(1.5, Math.min(4, unit / 5));
        let prevF = s.d.cdf(c.kmin - 1, s.prm);
        ctx.lineWidth = 2.25;
        // tramo inicial
        ctx.strokeStyle = col.curve;
        ctx.beginPath(); ctx.moveTo(L.left, c.Y(prevF)); ctx.lineTo(c.X(c.kmin), c.Y(prevF)); ctx.stroke();
        for (const pt of c.pts) {
          const hi = this.inRegion(pt.k);
          const x0 = c.X(pt.k), x1 = c.X(pt.k + 1 > c.kmax ? c.xmax : pt.k + 1);
          const y = c.Y(pt.F);
          ctx.strokeStyle = hi ? col.fillStrong : col.curve;
          ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
          // salto (línea punteada)
          ctx.save();
          ctx.setLineDash([2, 3]);
          ctx.lineWidth = 1;
          ctx.strokeStyle = col.axis;
          ctx.beginPath(); ctx.moveTo(x0, c.Y(prevF)); ctx.lineTo(x0, y); ctx.stroke();
          ctx.restore();
          // punto abierto (anterior) y cerrado (actual)
          if (unit > 6) {
            ctx.fillStyle = col.bg;
            ctx.beginPath(); ctx.arc(x0, c.Y(prevF), dotR, 0, Math.PI * 2); ctx.fill();
            ctx.lineWidth = 1.5; ctx.strokeStyle = col.curve; ctx.stroke();
            ctx.fillStyle = hi ? col.fillStrong : col.curve;
            ctx.beginPath(); ctx.arc(x0, y, dotR, 0, Math.PI * 2); ctx.fill();
            ctx.lineWidth = 2.25;
          }
          prevF = pt.F;
        }
      }
    }

    handleY(c, v) {
      const s = this.state;
      if (s.view === 'cdf') return c.Y(c.discrete ? s.d.cdf(Math.floor(v), s.prm) : s.d.cdf(v, s.prm));
      const f = c.discrete ? s.d.pmf(Math.round(v), s.prm) : s.d.pdf(v, s.prm);
      return c.Y(isFinite(f) ? Math.min(f, c.ymax) : c.ymax);
    }

    drawHandles(ctx, c, col) {
      const s = this.state, L = c.L;
      const handles = s.handles || [];
      const base = L.top + L.ph;
      const pills = [];
      handles.forEach((hd, i) => {
        if (!isFinite(hd.value)) return;
        const out = hd.value < c.xmin ? -1 : hd.value > c.xmax ? 1 : 0;
        const px = out < 0 ? L.left : out > 0 ? L.left + L.pw : c.X(hd.value);
        const active = this.drag && this.drag.index === i;
        ctx.save();
        if (!out) {
          const py = this.handleY(c, hd.value);
          ctx.strokeStyle = col.handle;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(px, base); ctx.lineTo(px, Math.max(L.top, py)); ctx.stroke();
          ctx.setLineDash([]);
          if (s.view === 'cdf') {
            ctx.globalAlpha = 0.6;
            ctx.setLineDash([2, 3]);
            ctx.beginPath(); ctx.moveTo(L.left, py); ctx.lineTo(px, py); ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            ctx.fillStyle = col.handle;
            ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();
          }
          // punto en el eje
          ctx.fillStyle = col.handle;
          ctx.shadowColor = 'rgba(0,0,0,.25)';
          ctx.shadowBlur = active ? 10 : 4;
          ctx.beginPath(); ctx.arc(px, base, active ? 9 : 7, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = col.bg;
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          // Indicador fuera de rango
          ctx.fillStyle = col.handle;
          ctx.beginPath();
          const ay = base - 10;
          if (out < 0) { ctx.moveTo(px, ay); ctx.lineTo(px + 10, ay - 6); ctx.lineTo(px + 10, ay + 6); }
          else { ctx.moveTo(px, ay); ctx.lineTo(px - 10, ay - 6); ctx.lineTo(px - 10, ay + 6); }
          ctx.fill();
        }
        ctx.restore();
        pills.push({ px, text: `${hd.label} = ${fmt.num(hd.value, 6)}`, out });
      });

      // Etiquetas (evitar solapamiento)
      ctx.font = `600 11.5px ${col.font}`;
      const placed = [];
      pills.forEach((p) => {
        const tw = ctx.measureText(p.text).width + 16;
        let x = p.px - tw / 2;
        x = Math.max(4, Math.min(this.size.w - tw - 4, x));
        let row = 0;
        while (placed.some((q) => q.row === row && x < q.x + q.w + 4 && x + tw + 4 > q.x)) row++;
        placed.push({ x, w: tw, row });
        const y = 8 + row * 0;
        const yy = row ? L.top + 4 : y;
        ctx.fillStyle = col.handle;
        roundRect(ctx, x, yy, tw, 22, 11);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, x + tw / 2, yy + 11.5);
      });
    }

    drawHover(ctx, c, col) {
      const s = this.state, L = c.L;
      const hv = this.hover;
      if (hv.x < c.xmin || hv.x > c.xmax) return;
      const px = c.X(hv.x);
      const base = L.top + L.ph;
      ctx.save();
      ctx.strokeStyle = col.axis;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, L.top); ctx.lineTo(px, base); ctx.stroke();
      ctx.globalAlpha = 1;
      const yv = s.view === 'cdf' ? hv.F : hv.f;
      if (isFinite(yv) && !c.discrete) {
        ctx.fillStyle = col.curve;
        ctx.beginPath(); ctx.arc(px, c.Y(Math.min(yv, c.ymax)), 4, 0, Math.PI * 2); ctx.fill();
      }
      const lines = c.discrete
        ? [`x = ${hv.x}`, `P(X = ${hv.x}) = ${fmt.num(hv.f, 6)}`, `P(X ≤ ${hv.x}) = ${fmt.num(hv.F, 6)}`]
        : [`x = ${fmt.num(hv.x, 5)}`, `f(x) = ${fmt.num(hv.f, 6)}`, `F(x) = ${fmt.num(hv.F, 6)}`];
      ctx.font = `12px ${col.font}`;
      const tw = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 20;
      const th = lines.length * 18 + 12;
      let tx = px + 14;
      if (tx + tw > this.size.w - 4) tx = px - 14 - tw;
      const ty = Math.max(L.top, Math.min(hv.py - th / 2, base - th));
      ctx.shadowColor = 'rgba(0,0,0,.18)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = col.bg;
      roundRect(ctx, tx, ty, tw, th, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = col.grid;
      ctx.stroke();
      ctx.fillStyle = col.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      lines.forEach((t, i) => {
        ctx.font = i === 0 ? `600 12px ${col.font}` : `12px ${col.font}`;
        ctx.fillText(t, tx + 10, ty + 8 + i * 18);
      });
      ctx.restore();
    }

    /* ------------------------------------------------------------ */
    /* Interacción                                                   */
    /* ------------------------------------------------------------ */
    pointer(e) {
      const r = this.canvas.getBoundingClientRect();
      return { px: e.clientX - r.left, py: e.clientY - r.top };
    }

    nearestHandle(px) {
      const c = this.cache;
      const hs = (this.state && this.state.handles) || [];
      let best = -1, bestD = Infinity;
      hs.forEach((h, i) => {
        if (!h.draggable || !isFinite(h.value)) return;
        const hx = Math.max(c.L.left, Math.min(c.L.left + c.L.pw, c.X(h.value)));
        const dd = Math.abs(hx - px);
        if (dd < bestD) { bestD = dd; best = i; }
      });
      return { index: best, dist: bestD };
    }

    setHandle(index, px) {
      const c = this.cache;
      let v = c.invX(Math.max(c.L.left, Math.min(c.L.left + c.L.pw, px)));
      if (c.discrete) v = Math.round(v);
      else {
        // redondeo "agradable" según la resolución de un píxel
        const res = (c.xmax - c.xmin) / c.L.pw;
        const q = Math.pow(10, Math.floor(Math.log10(res)));
        v = Math.round(v / q) * q;
        v = parseFloat(v.toPrecision(12));
      }
      if (this.opts.onHandleDrag) this.opts.onHandleDrag(index, v);
    }

    onDown(e) {
      if (!this.cache || !this.state) return;
      const { px, py } = this.pointer(e);
      const near = this.nearestHandle(px);
      if (near.index < 0) return;
      const touch = e.pointerType !== 'mouse';
      if (near.dist <= (touch ? 30 : 16)) {
        this.drag = { index: near.index, id: e.pointerId };
        this.canvas.setPointerCapture(e.pointerId);
        this.canvas.classList.add('dragging');
        e.preventDefault();
        this.invalidate();
      } else if (!touch) {
        // Clic: mover el marcador más cercano aquí y empezar a arrastrar
        this.drag = { index: near.index, id: e.pointerId };
        this.canvas.setPointerCapture(e.pointerId);
        this.canvas.classList.add('dragging');
        this.setHandle(near.index, px);
      } else {
        this.tap = { x: px, y: py, index: near.index };
      }
    }

    onMove(e) {
      if (!this.cache || !this.state) return;
      const { px, py } = this.pointer(e);
      if (this.drag && e.pointerId === this.drag.id) {
        this.setHandle(this.drag.index, px);
        return;
      }
      if (this.tap && Math.hypot(px - this.tap.x, py - this.tap.y) > 8) this.tap = null;
      if (e.pointerType === 'mouse') {
        const c = this.cache;
        const inside = px >= c.L.left && px <= c.L.left + c.L.pw && py >= c.L.top && py <= c.L.top + c.L.ph;
        const near = this.nearestHandle(px);
        this.canvas.style.cursor = near.index >= 0 && near.dist <= 16 ? 'ew-resize' : inside ? 'crosshair' : 'default';
        if (inside) {
          const v = this.valueAt(c.invX(px));
          this.hover = Object.assign(v, { py });
        } else this.hover = null;
        this.invalidate();
      }
    }

    onUp(e) {
      if (this.tap) {
        this.setHandle(this.tap.index, this.tap.x);
        this.tap = null;
      }
      this.cancelDrag();
      if (e.pointerType !== 'mouse') this.hover = null;
    }

    cancelDrag() {
      if (this.drag) {
        this.drag = null;
        this.canvas.classList.remove('dragging');
        if (this.opts.onDragEnd) this.opts.onDragEnd();
        this.invalidate();
      }
      this.tap = null;
    }

    /** Exporta la gráfica como PNG con título. */
    toPNG(title, subtitle) {
      const scale = 2;
      const { w, h } = this.size;
      const head = 64;
      const cv = document.createElement('canvas');
      cv.width = w * scale;
      cv.height = (h + head) * scale;
      const ctx = cv.getContext('2d');
      const col = this.colors();
      ctx.fillStyle = col.bg;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = col.text;
      ctx.font = `700 17px ${col.font}`;
      ctx.textBaseline = 'top';
      ctx.fillText(title, 16, 14);
      ctx.fillStyle = col.muted;
      ctx.font = `13px ${col.font}`;
      ctx.fillText(subtitle || '', 16, 38);
      const off = document.createElement('canvas');
      off.width = w * scale; off.height = h * scale;
      const hv = this.hover; this.hover = null;
      this.draw(off.getContext('2d'), { w, h, dpr: scale });
      this.hover = hv;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(off, 0, head * scale);
      return cv.toDataURL('image/png');
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function roundTop(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  PD.Chart = Chart;
  PD.chartUtils = { roundRect, ticks };
})(typeof globalThis !== 'undefined' ? globalThis : this);
