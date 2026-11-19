/*
 * app.js — Interfaz de usuario: parámetros, modos de cálculo, resultados,
 * gráfica, fórmulas, tabla, selector de distribución, tema y persistencia.
 */
(function () {
  'use strict';
  const { dist: D, fmt, special: S } = PD;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const OP_SYM = { '<=': '≤', '<': '<', '>=': '≥', '>': '>' };
  const OP_TEX = { '<=': '\\le', '<': '<', '>=': '\\ge', '>': '>' };
  const STORAGE_KEY = 'pd-state-v1';

  /* ================================================================== */
  /* Estado                                                              */
  /* ================================================================== */
  const state = {
    distId: 'normal',
    params: {},      // por distribución
    xs: {},          // por distribución: { x1, x2 }
    mode: 'lower',
    ops: { lower: '<=', upper: '>=', b1: '<=', b2: '<=', t1: '<=', t2: '>=' },
    inv: { type: 'left', p: 0.95 },
    chartView: 'pdf',
    showMean: true,
    decimals: 6,
    tab: 'calc',
    table: {},       // por distribución: { from, to, step }
  };

  let current = null;    // último resultado calculado
  let chart = null;
  let formulasKey = '';
  let tableKey = '';

  const dist = () => D.byId[state.distId];
  const prm = () => state.params[state.distId];
  const xs = () => state.xs[state.distId];

  /* ================================================================== */
  /* Utilidades                                                          */
  /* ================================================================== */

  /** Evalúa expresiones numéricas seguras: 1/6, 2^3, sqrt(2), pi, 5%, 1e-3 … */
  function parseNum(str) {
    if (typeof str === 'number') return str;
    let s = String(str).trim().replace(/,/g, '.').replace(/[−–]/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
    if (!s) return NaN;
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return parseFloat(s);
    let i = 0;
    const peek = () => s[i];
    const skip = () => { while (s[i] === ' ') i++; };
    const fns = { sqrt: Math.sqrt, ln: Math.log, log: Math.log10, exp: Math.exp, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan };
    const consts = { pi: Math.PI, 'π': Math.PI, e: Math.E };
    function expr() {
      let v = term();
      for (skip(); peek() === '+' || peek() === '-'; skip()) {
        const op = s[i++];
        const r = term();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    function term() {
      let v = unary();
      for (skip(); peek() === '*' || peek() === '/'; skip()) {
        const op = s[i++];
        const r = unary();
        v = op === '*' ? v * r : v / r;
      }
      return v;
    }
    function unary() {
      skip();
      if (peek() === '-') { i++; return -unary(); }
      if (peek() === '+') { i++; return unary(); }
      return power();
    }
    function power() {
      const b = postfix();
      skip();
      if (peek() === '^') { i++; return Math.pow(b, unary()); }
      return b;
    }
    function postfix() {
      let v = primary();
      skip();
      while (peek() === '%') { i++; v /= 100; skip(); }
      return v;
    }
    function primary() {
      skip();
      if (peek() === '(') {
        i++;
        const v = expr();
        skip();
        if (peek() !== ')') throw new Error('paren');
        i++;
        return v;
      }
      const num = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(s.slice(i));
      if (num) { i += num[0].length; return parseFloat(num[0]); }
      const id = /^([a-zA-Zπ]+)/.exec(s.slice(i));
      if (id) {
        const name = id[1].toLowerCase();
        i += id[1].length;
        if (fns[name]) {
          skip();
          if (peek() !== '(') throw new Error('fn');
          i++;
          const v = expr();
          skip();
          if (peek() !== ')') throw new Error('paren');
          i++;
          return fns[name](v);
        }
        if (name in consts) return consts[name];
      }
      throw new Error('token');
    }
    try {
      const v = expr();
      skip();
      if (i !== s.length) return NaN;
      return v;
    } catch (e) {
      return NaN;
    }
  }

  function niceRound(v, spread) {
    if (!isFinite(v)) return v;
    if (!(spread > 0)) return parseFloat(v.toPrecision(3));
    const step = Math.pow(10, Math.floor(Math.log10(spread / 4)));
    return parseFloat((Math.round(v / step) * step).toPrecision(12));
  }

  function defaultXs(d, p) {
    if (D.validate(d, p)) return { x1: 0, x2: 1 };
    const q20 = D.quantile(d, p, 0.2), q80 = D.quantile(d, p, 0.8);
    if (d.type === 'discrete') {
      return { x1: q20, x2: Math.max(q80, q20 + 1) };
    }
    const sp = q80 - q20;
    let x1 = niceRound(q20, sp), x2 = niceRound(q80, sp);
    if (!(x2 > x1)) { x1 = q20; x2 = q80; }
    return { x1, x2 };
  }

  function texNum(v, sig = 6) {
    return toTex(fmt.num(v, sig));
  }
  function texProb(v) {
    return toTex(fmt.prob(v, state.decimals));
  }
  const UNSUP = { '⁻': '-', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
  function toTex(s) {
    return s
      .replace(/ × 10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)/, (m, e) => `\\times 10^{${e.replace(/./g, (c) => UNSUP[c])}}`)
      .replace(/−/g, '-')
      .replace('∞', '\\infty')
      .replace('No definido', '\\text{no definido}');
  }

  function katexHTML(tex, display = false) {
    if (window.katex) {
      try {
        return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: false });
      } catch (e) { /* fallback */ }
    }
    const span = document.createElement('span');
    span.textContent = tex;
    return `<code>${span.innerHTML}</code>`;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  async function copyText(text, msg = 'Copiado al portapapeles') {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(msg); } catch (e2) { toast('No se pudo copiar'); }
      ta.remove();
    }
  }

  function download(name, href) {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* ================================================================== */
  /* Persistencia                                                        */
  /* ================================================================== */
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* sin almacenamiento */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        Object.keys(state).forEach((k) => { if (s[k] !== undefined) state[k] = s[k]; });
      }
    } catch (e) { /* ignorar */ }
    // Parámetros desde el enlace (#d=normal&mu=…)
    if (location.hash.length > 1) {
      const h = new URLSearchParams(location.hash.slice(1));
      const id = h.get('d');
      if (id && D.byId[id]) {
        state.distId = id;
        const d = D.byId[id];
        const p = Object.assign(D.defaults(d), state.params[id] || {});
        d.params.forEach((q) => {
          if (h.has(q.key)) p[q.key] = q.type === 'select' ? h.get(q.key) : parseFloat(h.get(q.key));
        });
        state.params[id] = p;
        const x = Object.assign({}, state.xs[id] || {});
        if (h.has('x1')) x.x1 = parseFloat(h.get('x1'));
        if (h.has('x2')) x.x2 = parseFloat(h.get('x2'));
        state.xs[id] = x;
        if (h.has('m')) state.mode = h.get('m');
        if (h.has('o')) {
          const o = h.get('o').split(',');
          ['lower', 'upper', 'b1', 'b2', 't1', 't2'].forEach((k, i) => { if (OP_SYM[o[i]]) state.ops[k] = o[i]; });
        }
        if (h.has('it')) state.inv.type = h.get('it');
        if (h.has('p')) state.inv.p = parseFloat(h.get('p'));
        if (h.has('v')) state.chartView = h.get('v') === 'cdf' ? 'cdf' : 'pdf';
      }
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (!D.byId[state.distId]) state.distId = 'normal';
    if (!['lower', 'upper', 'between', 'tails', 'inverse'].includes(state.mode)) state.mode = 'lower';
    ensureDist(state.distId);
  }

  function ensureDist(id) {
    const d = D.byId[id];
    const def = D.defaults(d);
    const p = Object.assign({}, def, state.params[id] || {});
    // Descarta valores corruptos
    d.params.forEach((q) => {
      if (q.type === 'select') { if (!q.options.some((o) => o.value === p[q.key])) p[q.key] = q.def; }
      else if (typeof p[q.key] !== 'number' || !isFinite(p[q.key])) p[q.key] = q.def;
    });
    state.params[id] = p;
    const x = state.xs[id] || {};
    if (!isFinite(x.x1) || !isFinite(x.x2)) {
      state.xs[id] = defaultXs(d, p);
    }
  }

  function shareURL() {
    const d = dist(), p = prm(), x = xs();
    const h = new URLSearchParams();
    h.set('d', d.id);
    d.params.forEach((q) => h.set(q.key, p[q.key]));
    h.set('m', state.mode);
    h.set('x1', x.x1);
    h.set('x2', x.x2);
    const o = state.ops;
    h.set('o', [o.lower, o.upper, o.b1, o.b2, o.t1, o.t2].join(','));
    if (state.mode === 'inverse') { h.set('it', state.inv.type); h.set('p', state.inv.p); }
    if (state.chartView === 'cdf') h.set('v', 'cdf');
    return location.origin + location.pathname + '#' + h.toString();
  }

  /* ================================================================== */
  /* Campos numéricos                                                    */
  /* ================================================================== */
  /**
   * Crea un campo numérico con botón ± opcional.
   * opts: { value, onChange(v), allowNeg, step, ariaLabel, id }
   */
  function numField(opts) {
    const wrap = document.createElement('div');
    wrap.className = 'num';
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.spellcheck = false;
    if (opts.id) input.id = opts.id;
    if (opts.ariaLabel) input.setAttribute('aria-label', opts.ariaLabel);
    input.value = fmt.input(opts.value);
    wrap.appendChild(input);

    const commit = () => {
      const v = parseNum(input.value);
      const ok = isFinite(v);
      wrap.classList.toggle('invalid', !ok);
      if (ok) opts.onChange(v);
      else opts.onInvalid && opts.onInvalid();
    };
    input.addEventListener('input', commit);
    input.addEventListener('blur', () => {
      const v = parseNum(input.value);
      if (isFinite(v) && String(v) !== input.value.trim()) {
        // Expresión evaluada: mostrar el valor numérico
        if (/[a-zπ()*/^%]/i.test(input.value)) input.value = fmt.input(v);
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const v = parseNum(input.value);
      if (!isFinite(v)) return;
      let step = typeof opts.step === 'function' ? opts.step() : opts.step || 1;
      if (e.shiftKey) step *= 10;
      const nv = parseFloat((v + (e.key === 'ArrowUp' ? step : -step)).toPrecision(12));
      input.value = fmt.input(nv);
      commit();
    });

    if (opts.allowNeg) {
      const pm = document.createElement('button');
      pm.type = 'button';
      pm.className = 'pm';
      pm.textContent = '±';
      pm.title = 'Cambiar signo';
      pm.tabIndex = -1;
      pm.addEventListener('click', () => {
        const v = parseNum(input.value);
        if (isFinite(v)) input.value = fmt.input(-v);
        else if (!input.value.trim().startsWith('-')) input.value = '-' + input.value.trim();
        else input.value = input.value.trim().slice(1);
        commit();
      });
      wrap.appendChild(pm);
    }

    wrap.input = input;
    wrap.set = (v) => {
      if (document.activeElement === input && parseNum(input.value) === v) return;
      input.value = fmt.input(v);
      wrap.classList.remove('invalid');
    };
    return wrap;
  }

  /* ================================================================== */
  /* Render: selector y parámetros                                       */
  /* ================================================================== */
  const paramFields = {};

  function renderPickerButton() {
    const d = dist();
    $('#dp-kind').textContent = d.type === 'discrete' ? 'Discreta' : 'Continua';
    $('#dp-name').textContent = d.name;
    $('#dp-notation').textContent = d.notation;
    drawSpark($('#picker-spark'), d, D.validate(d, prm()) ? D.defaults(d) : prm());
  }

  function renderParams() {
    const d = dist(), p = prm();
    const box = $('#params');
    box.innerHTML = '';
    Object.keys(paramFields).forEach((k) => delete paramFields[k]);

    d.params.forEach((q) => {
      const row = document.createElement('div');
      row.className = 'param';
      if (q.type === 'select') {
        row.innerHTML = `<div class="param-top"><span class="param-label"><b style="font-style:normal;font-family:inherit;font-size:14px">${escapeHTML(q.label)}</b></span></div>`;
        const sel = document.createElement('select');
        sel.className = 'sel';
        q.options.forEach((o) => {
          const op = document.createElement('option');
          op.value = o.value;
          op.textContent = o.label;
          sel.appendChild(op);
        });
        sel.value = p[q.key];
        sel.addEventListener('change', () => {
          p[q.key] = sel.value;
          paramsChanged(true);
        });
        row.appendChild(sel);
        box.appendChild(row);
        return;
      }

      const top = document.createElement('div');
      top.className = 'param-top';
      const parts = q.label.split(' ');
      top.innerHTML = `<label class="param-label" for="param-${q.key}"><b>${escapeHTML(parts[0])}</b><small>${escapeHTML(q.hint || '')}</small></label>`;
      const field = numField({
        id: `param-${q.key}`,
        value: p[q.key],
        allowNeg: q.min < 0,
        step: q.integer ? 1 : q.step,
        ariaLabel: `${q.hint || q.label}`,
        onChange: (v) => {
          p[q.key] = v;
          if (slider) syncSlider(slider, v);
          paramsChanged();
        },
        onInvalid: () => showParamError(`${parts[0]}: expresión no válida`),
      });
      top.appendChild(field);
      row.appendChild(top);

      let slider = null;
      if (q.slider) {
        slider = document.createElement('input');
        slider.type = 'range';
        slider.min = q.slider[0];
        slider.max = q.slider[1];
        slider.step = q.integer ? 1 : q.step;
        slider.setAttribute('aria-label', `${q.hint || q.label} (deslizador)`);
        syncSlider(slider, p[q.key]);
        slider.addEventListener('input', () => {
          const v = parseFloat(slider.value);
          p[q.key] = v;
          field.set(v);
          syncSlider(slider, v);
          paramsChanged();
        });
        row.appendChild(slider);
      }
      paramFields[q.key] = { field, slider };
      box.appendChild(row);
    });
  }

  function syncSlider(slider, v) {
    const min = parseFloat(slider.min), max = parseFloat(slider.max);
    slider.value = Math.min(max, Math.max(min, v));
    const pct = ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;
    slider.style.setProperty('--pct', pct + '%');
  }

  function showParamError(msg) {
    const el = $('#param-error');
    el.textContent = msg;
    el.hidden = !msg;
  }

  function paramsChanged(structural) {
    if (structural) renderExpr();
    recompute();
    renderPickerButton();
    save();
  }

  /* ================================================================== */
  /* Render: expresión de cálculo                                        */
  /* ================================================================== */
  const exprFields = {};

  function opSelect(key, options) {
    const sel = document.createElement('select');
    sel.className = 'op';
    options.forEach((o) => {
      const op = document.createElement('option');
      op.value = o;
      op.textContent = OP_SYM[o];
      sel.appendChild(op);
    });
    sel.value = state.ops[key];
    sel.setAttribute('aria-label', 'Desigualdad');
    sel.addEventListener('change', () => {
      state.ops[key] = sel.value;
      recompute();
      save();
    });
    return sel;
  }

  function tok(html) {
    const s = document.createElement('span');
    s.className = 'tok';
    s.innerHTML = html;
    return s;
  }

  function xField(which, label) {
    const f = numField({
      value: xs()[which],
      allowNeg: true,
      ariaLabel: label,
      step: () => xStep(),
      onChange: (v) => {
        xs()[which] = v;
        recompute();
        save();
      },
    });
    exprFields[which] = f;
    return f;
  }

  function xStep() {
    const d = dist();
    if (d.type === 'discrete') return 1;
    const st = current && current.stats;
    let sd = st && isFinite(st.sd) ? st.sd : NaN;
    if (!(sd > 0)) {
      const [a, b] = D.plotRange(d, prm());
      sd = (b - a) / 6;
    }
    return Math.pow(10, Math.floor(Math.log10(sd / 2)));
  }

  function renderExpr() {
    const box = $('#expr');
    box.innerHTML = '';
    Object.keys(exprFields).forEach((k) => delete exprFields[k]);
    const m = state.mode;
    const row = () => { const r = document.createElement('div'); r.className = 'row'; box.appendChild(r); return r; };

    if (m === 'lower') {
      const r = row();
      r.append(tok('P(<i>X</i>'), opSelect('lower', ['<=', '<']), xField('x1', 'Valor de x'), tok(')'));
    } else if (m === 'upper') {
      const r = row();
      r.append(tok('P(<i>X</i>'), opSelect('upper', ['>=', '>']), xField('x1', 'Valor de x'), tok(')'));
    } else if (m === 'between') {
      const r = row();
      r.append(tok('P('), xField('x1', 'Límite inferior x₁'), opSelect('b1', ['<=', '<']), tok('<i>X</i>'),
        opSelect('b2', ['<=', '<']), xField('x2', 'Límite superior x₂'), tok(')'));
    } else if (m === 'tails') {
      const r1 = row();
      r1.append(tok('P(<i>X</i>'), opSelect('t1', ['<=', '<']), xField('x1', 'Cola izquierda x₁'), tok(')  +'));
      const r2 = row();
      r2.append(tok('P(<i>X</i>'), opSelect('t2', ['>=', '>']), xField('x2', 'Cola derecha x₂'), tok(')'));
    } else {
      const r1 = row();
      const lab = document.createElement('label');
      lab.className = 'field-inline';
      lab.innerHTML = '<span>Buscar</span>';
      const sel = document.createElement('select');
      sel.className = 'sel';
      [
        ['left', 'x tal que P(X ≤ x) = p'],
        ['right', 'x tal que P(X ≥ x) = p'],
        ['central', 'x₁, x₂ con P(x₁ ≤ X ≤ x₂) = p (central)'],
        ['tails', 'x₁, x₂ con colas P(X ≤ x₁) + P(X ≥ x₂) = p'],
      ].forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        sel.appendChild(o);
      });
      sel.value = state.inv.type;
      sel.addEventListener('change', () => { state.inv.type = sel.value; recompute(); save(); });
      lab.appendChild(sel);
      r1.appendChild(lab);
      const r2 = row();
      const pf = numField({
        value: state.inv.p,
        ariaLabel: 'Probabilidad p',
        step: 0.01,
        onChange: (v) => { state.inv.p = v; recompute(); save(); },
      });
      exprFields.p = pf;
      r2.append(tok('<i>p</i> ='), pf);
    }
    $$('.mode').forEach((b) => {
      const on = b.dataset.mode === m;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on);
    });
  }

  /* ================================================================== */
  /* Cálculo principal                                                   */
  /* ================================================================== */
  function compute() {
    const d = dist(), p = prm(), x = xs();
    const err = D.validate(d, p);
    if (err) return { error: err };
    const discrete = d.type === 'discrete';
    const st = D.stats(d, p);
    const o = state.ops;
    const res = { d, p, discrete, stats: st, regions: [], handles: [], sub: [], steps: '' };
    const X1 = texNum(x.x1), X2 = texNum(x.x2);
    const isNormalLike = !!d.standardize;
    const F = (v) => D.cdfAt(d, v, p);

    switch (state.mode) {
      case 'lower': {
        const op = o.lower;
        res.value = D.probOp(d, p, op, x.x1);
        res.label = `P(X ${OP_SYM[op]} ${fmt.num(x.x1)})`;
        res.labelTex = `P(X ${OP_TEX[op]} ${X1})`;
        res.regions.push({ lo: -Infinity, hi: x.x1, loInc: true, hiInc: op === '<=' });
        res.handles.push({ value: x.x1, label: 'x', field: 'x1', draggable: true });
        const cop = op === '<=' ? '>' : '>=';
        res.sub.push(['Complemento', `P(X ${OP_SYM[cop]} ${fmt.num(x.x1)}) = ${fmt.prob(D.probOp(d, p, cop, x.x1), state.decimals)}`]);
        if (discrete) {
          const K = op === '<=' ? Math.floor(x.x1) : Math.ceil(x.x1) - 1;
          const lo = d.support(p)[0];
          const pre = op === '<' || K !== x.x1 ? `P(X ${OP_TEX[op]} ${X1}) = P(X \\le ${K}) = ` : `P(X \\le ${K}) = `;
          res.steps = `${pre}F(${K}) = \\sum_{k=${lo}}^{${K}} P(X = k) = ${texProb(res.value)}`;
        } else if (isNormalLike) {
          const z = d.standardize(x.x1, p);
          res.steps = d.id === 'normal'
            ? `z = \\dfrac{x-\\mu}{\\sigma} = \\dfrac{${X1} - ${texNum(p.mu)}}{${texNum(p.sigma)}} = ${texNum(z)} \\;\\Rightarrow\\; P(X ${OP_TEX[op]} ${X1}) = \\Phi(${texNum(z)}) = ${texProb(res.value)}`
            : `z = \\dfrac{\\ln x-\\mu}{\\sigma} = ${texNum(z)} \\;\\Rightarrow\\; P(X ${OP_TEX[op]} ${X1}) = \\Phi(${texNum(z)}) = ${texProb(res.value)}`;
        } else {
          res.steps = `P(X ${OP_TEX[op]} ${X1}) = F(${X1}) = \\int_{-\\infty}^{${X1}} f(t)\\,dt = ${texProb(res.value)}`;
        }
        break;
      }
      case 'upper': {
        const op = o.upper;
        res.value = D.probOp(d, p, op, x.x1);
        res.label = `P(X ${OP_SYM[op]} ${fmt.num(x.x1)})`;
        res.labelTex = `P(X ${OP_TEX[op]} ${X1})`;
        res.regions.push({ lo: x.x1, hi: Infinity, loInc: op === '>=', hiInc: true });
        res.handles.push({ value: x.x1, label: 'x', field: 'x1', draggable: true });
        const cop = op === '>=' ? '<' : '<=';
        const cval = D.probOp(d, p, cop, x.x1);
        res.sub.push(['Complemento', `P(X ${OP_SYM[cop]} ${fmt.num(x.x1)}) = ${fmt.prob(cval, state.decimals)}`]);
        if (discrete) {
          const K = op === '>=' ? Math.ceil(x.x1) - 1 : Math.floor(x.x1);
          res.steps = `P(X ${OP_TEX[op]} ${X1}) = 1 - P(X \\le ${K}) = 1 - F(${K}) = 1 - ${texProb(cval)} = ${texProb(res.value)}`;
        } else if (isNormalLike) {
          const z = d.standardize(x.x1, p);
          res.steps = `z = ${texNum(z)} \\;\\Rightarrow\\; P(X ${OP_TEX[op]} ${X1}) = 1 - \\Phi(${texNum(z)}) = ${texProb(res.value)}`;
        } else {
          res.steps = `P(X ${OP_TEX[op]} ${X1}) = 1 - F(${X1}) = \\int_{${X1}}^{\\infty} f(t)\\,dt = ${texProb(res.value)}`;
        }
        break;
      }
      case 'between': {
        const [o1, o2] = [o.b1, o.b2];
        res.value = D.probBetween(d, p, x.x1, x.x2, o1, o2);
        res.label = `P(${fmt.num(x.x1)} ${OP_SYM[o1]} X ${OP_SYM[o2]} ${fmt.num(x.x2)})`;
        res.labelTex = `P(${X1} ${OP_TEX[o1]} X ${OP_TEX[o2]} ${X2})`;
        res.regions.push({ lo: x.x1, hi: x.x2, loInc: o1 === '<=', hiInc: o2 === '<=' });
        res.handles.push({ value: x.x1, label: 'x₁', field: 'x1', draggable: true });
        res.handles.push({ value: x.x2, label: 'x₂', field: 'x2', draggable: true });
        res.sub.push(['Fuera del intervalo', fmt.prob(Math.max(0, 1 - res.value), state.decimals)]);
        if (x.x1 > x.x2) res.warn = 'x₁ es mayor que x₂: el intervalo está vacío.';
        if (discrete) {
          const Kb = o2 === '<=' ? Math.floor(x.x2) : Math.ceil(x.x2) - 1;
          const Ka = (o1 === '<=' ? Math.ceil(x.x1) : Math.floor(x.x1) + 1) - 1;
          res.steps = `P(${X1} ${OP_TEX[o1]} X ${OP_TEX[o2]} ${X2}) = F(${Kb}) - F(${Ka}) = ${texProb(d.cdf(Kb, p))} - ${texProb(d.cdf(Ka, p))} = ${texProb(res.value)}`;
        } else if (d.id === 'normal') {
          const z1 = d.standardize(x.x1, p), z2 = d.standardize(x.x2, p);
          res.steps = `z_1 = ${texNum(z1)},\\ z_2 = ${texNum(z2)} \\;\\Rightarrow\\; \\Phi(${texNum(z2)}) - \\Phi(${texNum(z1)}) = ${texProb(F(x.x2))} - ${texProb(F(x.x1))} = ${texProb(res.value)}`;
        } else {
          res.steps = `P(${X1} ${OP_TEX[o1]} X ${OP_TEX[o2]} ${X2}) = \\int_{${X1}}^{${X2}} f(t)\\,dt = F(${X2}) - F(${X1}) = ${texProb(F(x.x2))} - ${texProb(F(x.x1))} = ${texProb(res.value)}`;
        }
        break;
      }
      case 'tails': {
        const [o1, o2] = [o.t1, o.t2];
        const pl = D.probOp(d, p, o1, x.x1), pu = D.probOp(d, p, o2, x.x2);
        res.value = x.x1 < x.x2 ? Math.min(1, pl + pu) : NaN;
        if (!(x.x1 < x.x2)) res.warn = 'Para dos colas se requiere x₁ < x₂.';
        res.label = `P(X ${OP_SYM[o1]} ${fmt.num(x.x1)}) + P(X ${OP_SYM[o2]} ${fmt.num(x.x2)})`;
        res.labelTex = `P(X ${OP_TEX[o1]} ${X1}) + P(X ${OP_TEX[o2]} ${X2})`;
        res.regions.push({ lo: -Infinity, hi: x.x1, loInc: true, hiInc: o1 === '<=' });
        res.regions.push({ lo: x.x2, hi: Infinity, loInc: o2 === '>=', hiInc: true });
        res.handles.push({ value: x.x1, label: 'x₁', field: 'x1', draggable: true });
        res.handles.push({ value: x.x2, label: 'x₂', field: 'x2', draggable: true });
        res.sub.push(['Cola izquierda', fmt.prob(pl, state.decimals)]);
        res.sub.push(['Cola derecha', fmt.prob(pu, state.decimals)]);
        res.sub.push(['Centro', fmt.prob(Math.max(0, 1 - pl - pu), state.decimals)]);
        res.steps = `P(X ${OP_TEX[o1]} ${X1}) + P(X ${OP_TEX[o2]} ${X2}) = ${texProb(pl)} + ${texProb(pu)} = ${texProb(res.value)}`;
        break;
      }
      case 'inverse':
        computeInverse(res);
        break;
    }
    if (isFinite(res.value) && state.mode !== 'inverse') {
      res.sub.push(['Porcentaje', `${(res.value * 100).toFixed(Math.max(2, state.decimals - 2))} %`]);
    }
    return res;
  }

  function computeInverse(res) {
    const { d, p, discrete } = res;
    const pv = state.inv.p;
    const t = state.inv.type;
    if (!(pv >= 0 && pv <= 1)) {
      res.warn = 'La probabilidad p debe estar entre 0 y 1.';
      res.value = NaN;
      res.label = 'x';
      return;
    }
    const P = texProb(pv);
    const near = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(b), 1e-300);
    res.isInverse = true;

    if (t === 'left' || t === 'right') {
      const xv = t === 'left' ? D.quantile(d, p, pv) : D.isf(d, p, pv);
      res.value = xv;
      res.label = t === 'left' ? `x tal que P(X ≤ x) = ${fmt.num(pv)}` : `x tal que P(X ≥ x) = ${fmt.num(pv)}`;
      res.handles.push({ value: xv, label: 'x', draggable: false });
      if (t === 'left') {
        res.regions.push({ lo: -Infinity, hi: xv, loInc: true, hiInc: true });
        const got = D.cdfAt(d, xv, p);
        res.sub.push(['Comprobación', `P(X ≤ ${fmt.num(xv)}) = ${fmt.prob(got, state.decimals)}`]);
        if (discrete) {
          res.sub.push(['Nota', 'menor k con P(X ≤ k) ≥ p']);
          res.steps = `x = \\min\\{k : F(k) \\ge ${P}\\} = ${texNum(xv)}`;
        } else if (d.id === 'normal') {
          const z = S.qnorm(pv);
          res.steps = `z_{${P}} = ${texNum(z)} \\;\\Rightarrow\\; x = \\mu + z\\sigma = ${texNum(p.mu)} + (${texNum(z)})(${texNum(p.sigma)}) = ${texNum(xv, 8)}`;
        } else {
          res.steps = `x = F^{-1}(${P}) = ${texNum(xv, 8)}`;
        }
      } else {
        res.regions.push({ lo: xv, hi: Infinity, loInc: true, hiInc: true });
        const got = D.sfInclusive(d, xv, p);
        res.sub.push(['Comprobación', `P(X ≥ ${fmt.num(xv)}) = ${fmt.prob(got, state.decimals)}`]);
        if (discrete) {
          res.sub.push(['Nota', 'mayor k con P(X ≥ k) ≥ p']);
          res.steps = `x = \\max\\{k : P(X \\ge k) \\ge ${P}\\} = ${texNum(xv)}`;
        } else {
          res.steps = `x = F^{-1}(1 - ${P}) = ${texNum(xv, 8)}`;
        }
      }
      return;
    }

    // Central / dos colas
    const alpha = t === 'central' ? 1 - pv : pv;
    const half = alpha / 2;
    let a, b;
    if (!discrete) {
      a = D.quantile(d, p, half);
      b = D.isf(d, p, half);
    } else if (t === 'central') {
      // P(a ≤ X ≤ b) ≥ p con colas ≤ α/2 cada una
      const k0 = D.quantile(d, p, half);
      a = near(d.cdf(k0, p), half) ? k0 + 1 : k0;
      const j0 = D.isf(d, p, half);
      b = near(d.sf(j0 - 1, p), half) ? j0 - 1 : j0;
    } else {
      // colas P(X ≤ a) ≤ α/2 y P(X ≥ b) ≤ α/2
      const k0 = D.quantile(d, p, half);
      a = near(d.cdf(k0, p), half) ? k0 : k0 - 1;
      const j0 = D.isf(d, p, half);
      b = near(d.sf(j0 - 1, p), half) ? j0 : j0 + 1;
    }
    res.value = a;
    res.value2 = b;
    res.handles.push({ value: a, label: 'x₁', draggable: false });
    res.handles.push({ value: b, label: 'x₂', draggable: false });
    if (t === 'central') {
      res.label = `Intervalo central con P = ${fmt.num(pv)}`;
      res.regions.push({ lo: a, hi: b, loInc: true, hiInc: true });
      const got = D.probBetween(d, p, a, b, '<=', '<=');
      res.sub.push(['Comprobación', `P(${fmt.num(a)} ≤ X ≤ ${fmt.num(b)}) = ${fmt.prob(got, state.decimals)}`]);
      res.steps = `x_1 = F^{-1}\\!\\left(\\tfrac{1-${P}}{2}\\right) = ${texNum(a, 8)},\\quad x_2 = F^{-1}\\!\\left(\\tfrac{1+${P}}{2}\\right) = ${texNum(b, 8)}`;
    } else {
      res.label = `Valores críticos con α = ${fmt.num(pv)}`;
      res.regions.push({ lo: -Infinity, hi: a, loInc: true, hiInc: true });
      res.regions.push({ lo: b, hi: Infinity, loInc: true, hiInc: true });
      const got = D.probOp(d, p, '<=', a) + D.probOp(d, p, '>=', b);
      res.sub.push(['Comprobación', `P(X ≤ ${fmt.num(a)}) + P(X ≥ ${fmt.num(b)}) = ${fmt.prob(got, state.decimals)}`]);
      res.steps = `x_1 = F^{-1}\\!\\left(\\tfrac{${P}}{2}\\right) = ${texNum(a, 8)},\\quad x_2 = F^{-1}\\!\\left(1-\\tfrac{${P}}{2}\\right) = ${texNum(b, 8)}`;
    }
    if (discrete) res.sub.push(['Nota', 'en discretas la probabilidad exacta puede no alcanzarse']);
  }

  /* ================================================================== */
  /* Render: resultado, gráfica, medidas                                 */
  /* ================================================================== */
  function recompute() {
    const r = compute();
    current = r;
    showParamError(r.error || '');
    const valueEl = $('#result-value');
    const subEl = $('#result-sub');

    if (r.error) {
      $('#result-label').textContent = 'Revisa los parámetros';
      valueEl.textContent = '—';
      valueEl.classList.add('bad');
      subEl.innerHTML = '';
      $('#steps').innerHTML = '';
      $('#stats').innerHTML = '';
      $('#chart-error').hidden = false;
      $('#chart-error').textContent = r.error;
      chart.setState({ d: dist(), prm: prm(), error: r.error });
      $('#calc-hint').textContent = '';
      return;
    }
    $('#chart-error').hidden = true;

    // Resultado
    $('#result-label').innerHTML = r.isInverse ? escapeHTML(r.label) : katexHTML(r.labelTex);
    let valText;
    if (r.isInverse) {
      valText = r.value2 !== undefined
        ? `x₁ = ${fmt.num(r.value, 8)}   x₂ = ${fmt.num(r.value2, 8)}`
        : `x = ${fmt.num(r.value, 8)}`;
    } else {
      valText = isFinite(r.value) ? fmt.prob(r.value, state.decimals) : '—';
    }
    valueEl.textContent = valText;
    valueEl.classList.toggle('bad', !isFinite(r.value));
    subEl.innerHTML = r.sub.map(([k, v]) => `<span>${escapeHTML(k)}: <b>${escapeHTML(v)}</b></span>`).join('');
    $('#steps').innerHTML = r.steps ? katexHTML(r.steps) : '';

    // Pista
    let hint = r.warn || '';
    if (!hint && !r.discrete && state.mode !== 'inverse') {
      hint = 'En distribuciones continuas P(X = x) = 0, por lo que < y ≤ dan el mismo resultado.';
    }
    if (!hint && r.discrete && state.mode !== 'inverse') {
      const x1 = xs().x1;
      hint = `P(X = ${fmt.num(Math.round(x1))}) = ${fmt.prob(r.d.pmf(Math.round(x1), r.p), state.decimals)}  ·  En discretas < y ≤ dan resultados distintos.`;
    }
    $('#calc-hint').textContent = hint;

    // Gráfica
    $('#chart-title').textContent = chartTitle();
    chart.setState({
      d: r.d,
      prm: r.p,
      view: state.chartView,
      regions: r.regions,
      handles: r.handles,
      stats: r.stats,
      showMean: state.showMean,
    });

    renderStats(r);
    if (state.tab === 'formulas') renderFormulas();
    if (state.tab === 'table') renderTable();
  }

  function chartTitle() {
    const d = dist(), p = prm();
    const head = d.notation.split(/[({]/)[0];
    const open = d.notation.includes('{') ? '{' : '(';
    const close = open === '{' ? '}' : ')';
    const parts = d.params.filter((q) => q.type !== 'select').map((q) => `${q.label.split(' ')[0]} = ${fmt.num(p[q.key])}`);
    let t = `${head}${open}${parts.join(', ')}${close}`;
    const sel = d.params.find((q) => q.type === 'select');
    if (sel) t += `  ·  ${sel.options.find((o) => o.value === p[sel.key]).label}`;
    return t;
  }

  function modeText(m) {
    if (m === null || m === undefined) return '—';
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return m.map((v) => fmt.num(v)).join(' y ');
    return fmt.num(m);
  }

  function renderStats(r) {
    const st = r.stats;
    const [lo, hi] = r.d.support(r.p);
    const sup = r.discrete
      ? `{${fmt.num(lo)}, …, ${isFinite(hi) ? fmt.num(hi) : '∞'}}`
      : `${isFinite(lo) ? '[' + fmt.num(lo) : '(−∞'}, ${isFinite(hi) ? fmt.num(hi) + ']' : '∞)'}`;
    const tiles = [
      ['Media', 'μ', fmt.num(st.mean, 7)],
      ['Varianza', 'σ²', fmt.num(st.variance, 7)],
      ['Desv. estándar', 'σ', fmt.num(st.sd, 7)],
      ['Mediana', 'Me', fmt.num(st.median, 7)],
      ['Moda', 'Mo', modeText(st.mode)],
      ['Asimetría', 'γ₁', fmt.num(st.skewness, 5)],
      ['Curtosis (exceso)', 'γ₂', fmt.num(st.kurtosis, 5)],
      ['Soporte', 'x ∈', sup],
    ];
    $('#stats').innerHTML = tiles.map(([label, sym, val]) => {
      const isText = /[a-zA-Z]{3,}/.test(val) && !/^No definido$/.test(val) ? ' text' : '';
      return `<div class="stat"><div class="stat-label"><span>${label}</span><i>${sym}</i></div><div class="stat-value${isText}">${escapeHTML(val)}</div></div>`;
    }).join('');
  }

  /* ================================================================== */
  /* Fórmulas                                                            */
  /* ================================================================== */
  function renderFormulas() {
    const d = dist(), p = prm();
    const key = d.id + JSON.stringify(p);
    if (key === formulasKey) return;
    formulasKey = key;
    const st = current && !current.error ? current.stats : null;
    const t = d.tex;
    const discrete = d.type === 'discrete';
    const row = (label, small, tex, val) => tex ? `
      <div class="f-row">
        <div class="f-row-label">${label}${small ? `<small>${small}</small>` : ''}</div>
        <div><div class="f-row-math">${katexHTML(tex, true)}</div>${val ? `<div class="f-row-val">Con tus parámetros: <b>${escapeHTML(val)}</b></div>` : ''}</div>
      </div>` : '';

    let html = `
      <div class="f-hero">
        <div class="f-kind">Distribución ${discrete ? 'discreta' : 'continua'}</div>
        <h2>${escapeHTML(d.name)}</h2>
        <div class="f-notation">${katexHTML(d.notationTex)}</div>
        <p>${escapeHTML(d.description)}</p>
        <div class="f-uses">${d.uses.map((u) => `<span>${escapeHTML(u)}</span>`).join('')}</div>
      </div>
      <div class="f-list">
        ${row('Parámetros', '', t.params)}
        ${row('Soporte', 'valores posibles de X', t.support)}
        ${row(discrete ? 'Función de masa' : 'Función de densidad', discrete ? 'probabilidad puntual' : 'f(x)', discrete ? t.pmf : t.pdf)}
        ${row('Función de distribución', 'acumulada F(x) = P(X ≤ x)', t.cdf)}
        ${row('Media', 'valor esperado', t.mean, st ? fmt.num(st.mean, 8) : '')}
        ${row('Varianza', '', t.variance, st ? fmt.num(st.variance, 8) : '')}
        ${row('Desviación estándar', '', '\\sigma = \\sqrt{\\operatorname{Var}(X)}', st ? fmt.num(st.sd, 8) : '')}
        ${row('Función generadora', 'de momentos', t.mgf)}
        ${row('Relación clave', '', t.extra)}
      </div>
      <div class="f-section-title">Reglas para calcular probabilidades</div>
      <div class="f-list">`;
    if (discrete) {
      html += row('Intervalo', '', 'P(a \\le X \\le b) = \\sum_{k=a}^{b} P(X = k) = F(b) - F(a-1)')
        + row('Menor estricto', '', 'P(X < k) = P(X \\le k-1) = F(k-1)')
        + row('Cola derecha', '', 'P(X \\ge k) = 1 - F(k-1),\\qquad P(X > k) = 1 - F(k)')
        + row('Momentos', '', 'E[X] = \\sum_x x\\,P(X=x),\\qquad \\operatorname{Var}(X) = E[X^2] - (E[X])^2');
    } else {
      html += row('Intervalo', 'área bajo la curva', 'P(a \\le X \\le b) = \\int_a^b f(x)\\,dx = F(b) - F(a)')
        + row('Valor puntual', '', 'P(X = x) = 0 \\;\\Rightarrow\\; P(X < x) = P(X \\le x)')
        + row('Cola derecha', '', 'P(X > x) = 1 - F(x)')
        + row('Momentos', '', 'E[X] = \\int_{-\\infty}^{\\infty} x f(x)\\,dx,\\qquad \\operatorname{Var}(X) = E[X^2] - (E[X])^2');
    }
    html += '</div>';
    $('#formulas').innerHTML = html;
  }

  /* ================================================================== */
  /* Tabla                                                               */
  /* ================================================================== */
  function autoTable() {
    const d = dist(), p = prm();
    if (D.validate(d, p)) return { from: 0, to: 1, step: 0.1 };
    if (d.type === 'discrete') {
      const [a, b] = D.plotRange(d, p);
      return { from: a, to: b, step: 1 };
    }
    const lo = D.quantile(d, p, 0.001), hi = D.isf(d, p, 0.001);
    const step = PD.chartUtils.ticks(lo, hi, 20).step;
    const from = Math.floor(lo / step) * step;
    const to = Math.ceil(hi / step) * step;
    return { from: parseFloat(from.toPrecision(10)), to: parseFloat(to.toPrecision(10)), step };
  }

  function tableSettings() {
    if (!state.table[state.distId]) state.table[state.distId] = autoTable();
    return state.table[state.distId];
  }

  function syncTableInputs() {
    const t = tableSettings();
    $('#t-from').value = fmt.input(t.from);
    $('#t-to').value = fmt.input(t.to);
    $('#t-step').value = fmt.input(t.step);
    $('#t-step-field').hidden = dist().type === 'discrete';
  }

  function tableRows() {
    const d = dist(), p = prm(), t = tableSettings();
    const rows = [];
    if (D.validate(d, p)) return { rows, truncated: false };
    const discrete = d.type === 'discrete';
    const step = discrete ? 1 : t.step;
    if (!(step > 0) || !(t.to >= t.from)) return { rows, truncated: false };
    const n = Math.floor((t.to - t.from) / step + 1e-9);
    const max = 2000;
    for (let i = 0; i <= Math.min(n, max); i++) {
      const x = discrete ? Math.round(t.from) + i : parseFloat((t.from + i * step).toPrecision(12));
      if (discrete) rows.push([x, d.pmf(x, p), d.cdf(x, p), d.sf(x - 1, p)]);
      else rows.push([x, d.pdf(x, p), d.cdf(x, p), d.sf(x, p)]);
    }
    return { rows, truncated: n > max };
  }

  function tableHeaders() {
    return dist().type === 'discrete'
      ? ['x', 'P(X = x)', 'P(X ≤ x)', 'P(X ≥ x)']
      : ['x', 'f(x)', 'F(x) = P(X ≤ x)', 'P(X > x)'];
  }

  function renderTable() {
    const key = state.distId + JSON.stringify(prm()) + JSON.stringify(tableSettings()) + state.decimals +
      JSON.stringify(current && current.regions);
    if (key === tableKey) return;
    tableKey = key;
    syncTableInputs();
    const { rows, truncated } = tableRows();
    const discrete = dist().type === 'discrete';
    const dec = state.decimals;
    const inRegion = (x) => (current && current.regions || []).some((r) =>
      (x > r.lo || (x === r.lo && r.loInc)) && (x < r.hi || (x === r.hi && r.hiInc)));
    const head = `<thead><tr>${tableHeaders().map((h) => `<th>${h}</th>`).join('')}</tr></thead>`;
    const body = rows.map((r) => `<tr class="${discrete && inRegion(r[0]) ? 'hi' : ''}"><td>${fmt.num(r[0], 8)}</td><td>${discrete ? fmt.prob(r[1], dec) : fmt.num(r[1], dec)}</td><td>${fmt.prob(r[2], dec)}</td><td>${fmt.prob(r[3], dec)}</td></tr>`).join('');
    $('#prob-table').innerHTML = head + `<tbody>${body}</tbody>`;
    $('#table-hint').textContent = rows.length
      ? (truncated ? 'Se muestran las primeras 2001 filas. Aumenta el paso o reduce el rango.' : `${rows.length} filas.`) +
        (discrete ? ' Las filas resaltadas corresponden a la región del cálculo actual.' : '')
      : 'Rango no válido.';
  }

  function tableCSV(sep = ',') {
    const { rows } = tableRows();
    const lines = [tableHeaders().join(sep)];
    rows.forEach((r) => lines.push(r.map((v) => String(v)).join(sep)));
    return lines.join('\n');
  }

  /* ================================================================== */
  /* Selector de distribuciones                                          */
  /* ================================================================== */
  function drawSpark(canvas, d, p) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = canvas.clientWidth || parseInt(canvas.getAttribute('width'), 10);
    const h = canvas.clientHeight || parseInt(canvas.getAttribute('height'), 10);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f46e5';
    const pad = 5;
    try {
      const [a, b] = D.plotRange(d, p);
      if (d.type === 'discrete') {
        const ks = [];
        for (let k = a; k <= b; k++) ks.push([k, d.pmf(k, p)]);
        const mx = Math.max(...ks.map((v) => v[1])) || 1;
        const unit = (w - 2 * pad) / ks.length;
        ctx.fillStyle = accent;
        ks.forEach(([, v], i) => {
          const bh = (v / mx) * (h - 2 * pad);
          ctx.globalAlpha = 0.85;
          ctx.fillRect(pad + i * unit + unit * 0.15, h - pad - bh, Math.max(1, unit * 0.7), bh);
        });
        ctx.globalAlpha = 1;
      } else {
        const n = 80;
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const x = a + ((b - a) * i) / n;
          pts.push(d.pdf(x, p));
        }
        const fin = pts.filter(isFinite).sort((u, v) => u - v);
        const mx = Math.min(fin[fin.length - 1], (fin[Math.floor(fin.length * 0.95)] || 1) * 2) || 1;
        const X = (i) => pad + ((w - 2 * pad) * i) / n;
        const Y = (v) => h - pad - (Math.min(isFinite(v) ? v : mx, mx) / mx) * (h - 2 * pad);
        ctx.beginPath();
        ctx.moveTo(X(0), h - pad);
        pts.forEach((v, i) => ctx.lineTo(X(i), Y(v)));
        ctx.lineTo(X(n), h - pad);
        ctx.closePath();
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.22;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        pts.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    } catch (e) { /* ignorar */ }
  }

  function renderPicker(filter = '') {
    const body = $('#picker-body');
    const f = normalize(filter.trim());
    const groups = [['continuous', 'Continuas'], ['discrete', 'Discretas']];
    let html = '';
    let count = 0;
    groups.forEach(([type, title]) => {
      const items = D.list.filter((d) => d.type === type &&
        (!f || normalize(d.name + ' ' + d.id + ' ' + d.notation).includes(f)));
      if (!items.length) return;
      count += items.length;
      html += `<div class="picker-group"><h3>${title} · ${items.length}</h3><div class="picker-grid">` +
        items.map((d) => `<button class="pick${d.id === state.distId ? ' current' : ''}" data-id="${d.id}">
          <canvas width="64" height="40" aria-hidden="true"></canvas>
          <span><b>${escapeHTML(d.name)}</b><small>${escapeHTML(d.notation)}</small></span></button>`).join('') +
        '</div></div>';
    });
    body.innerHTML = count ? html : '<div class="picker-empty">No se encontraron distribuciones.</div>';
    $$('.pick', body).forEach((btn) => {
      const d = D.byId[btn.dataset.id];
      drawSpark($('canvas', btn), d, D.defaults(d));
      btn.addEventListener('click', () => {
        selectDist(d.id);
        $('#dlg-picker').close();
      });
    });
  }

  function openPicker() {
    const dlg = $('#dlg-picker');
    $('#picker-search').value = '';
    dlg.showModal();
    renderPicker();
    setTimeout(() => $('#picker-search').focus(), 30);
  }

  function selectDist(id) {
    state.distId = id;
    ensureDist(id);
    formulasKey = '';
    tableKey = '';
    renderAll();
    save();
  }

  /* ================================================================== */
  /* Pestañas, tema y eventos globales                                   */
  /* ================================================================== */
  function setTab(tab) {
    state.tab = tab;
    document.body.dataset.view = tab;
    $$('.tab').forEach((b) => {
      const on = b.dataset.view === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    if (tab === 'formulas') renderFormulas();
    if (tab === 'table') renderTable();
    if (tab === 'calc' && chart) requestAnimationFrame(() => chart.resize());
    save();
  }

  function isDark() {
    const t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function toggleTheme() {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('pd-theme', next); } catch (e) { /* ignorar */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === 'dark' ? '#111827' : '#4f46e5';
    chart.cache = null;
    chart.invalidate();
    renderPickerButton();
  }

  function renderAll() {
    renderPickerButton();
    renderParams();
    renderExpr();
    $$('[data-chartview]').forEach((b) => b.classList.toggle('active', b.dataset.chartview === state.chartView));
    $('#btn-mean').classList.toggle('active', state.showMean);
    $('#btn-mean').setAttribute('aria-pressed', state.showMean);
    $('#decimals').value = String(state.decimals);
    recompute();
  }

  function onHandleDrag(index, v) {
    if (!current || !current.handles || !current.handles[index]) return;
    const h = current.handles[index];
    if (!h.draggable) return;
    const x = xs();
    const pair = state.mode === 'between' || state.mode === 'tails';
    if (pair) {
      if (h.field === 'x1' && v > x.x2) v = x.x2;
      if (h.field === 'x2' && v < x.x1) v = x.x1;
    }
    if (x[h.field] === v) return;
    x[h.field] = v;
    if (exprFields[h.field]) exprFields[h.field].set(v);
    recompute();
  }

  function bindEvents() {
    $('#btn-picker').addEventListener('click', openPicker);
    $('#picker-search').addEventListener('input', (e) => renderPicker(e.target.value));
    $('#picker-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = $('.pick', $('#picker-body'));
        if (first) first.click();
      }
    });
    $$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    $$('dialog').forEach((dlg) => dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close(); // clic en el fondo
    }));
    $('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());
    $('#btn-theme').addEventListener('click', toggleTheme);
    $('#btn-share').addEventListener('click', () => copyText(shareURL(), 'Enlace copiado'));

    $$('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.view)));
    $$('.mode').forEach((b) => b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      // Al pasar a un modo con dos valores, garantizar x₁ < x₂
      const x = xs();
      if ((state.mode === 'between' || state.mode === 'tails') && !(x.x1 < x.x2)) {
        const d = dist(), p = prm();
        if (!D.validate(d, p)) {
          const def = defaultXs(d, p);
          if (def.x2 > x.x1) x.x2 = def.x2;
          else { x.x1 = def.x1; x.x2 = def.x2; }
        }
      }
      renderExpr();
      recompute();
      save();
    }));

    $('#btn-reset-params').addEventListener('click', () => {
      const d = dist();
      state.params[d.id] = D.defaults(d);
      state.xs[d.id] = defaultXs(d, state.params[d.id]);
      delete state.table[d.id];
      renderAll();
      save();
      toast('Valores restablecidos');
    });

    $$('[data-chartview]').forEach((b) => b.addEventListener('click', () => {
      state.chartView = b.dataset.chartview;
      $$('[data-chartview]').forEach((x) => x.classList.toggle('active', x === b));
      recompute();
      save();
    }));
    $('#btn-mean').addEventListener('click', () => {
      state.showMean = !state.showMean;
      $('#btn-mean').classList.toggle('active', state.showMean);
      $('#btn-mean').setAttribute('aria-pressed', state.showMean);
      recompute();
      save();
    });
    $('#btn-png').addEventListener('click', () => {
      if (!current || current.error) return;
      const sub = current.isInverse ? $('#result-value').textContent : `${current.label} = ${fmt.prob(current.value, state.decimals)}`;
      download(`${dist().id}.png`, chart.toPNG(chartTitle(), sub));
    });
    $('#decimals').addEventListener('change', (e) => {
      state.decimals = parseInt(e.target.value, 10);
      formulasKey = '';
      recompute();
      save();
    });
    $('#btn-copy').addEventListener('click', () => {
      if (!current || current.error) return;
      const text = current.isInverse
        ? $('#result-value').textContent.replace(/\s+/g, ' ')
        : `${current.label} = ${fmt.prob(current.value, state.decimals)}`;
      copyText(text);
    });

    // Tabla
    const tableInput = (id, key) => $(id).addEventListener('input', (e) => {
      const v = parseNum(e.target.value);
      if (!isFinite(v)) return;
      tableSettings()[key] = v;
      tableKey = '';
      renderTableKeepFocus();
      save();
    });
    tableInput('#t-from', 'from');
    tableInput('#t-to', 'to');
    tableInput('#t-step', 'step');
    $('#btn-table-auto').addEventListener('click', () => {
      state.table[state.distId] = autoTable();
      tableKey = '';
      renderTable();
      save();
    });
    $('#btn-table-csv').addEventListener('click', () => {
      const blob = new Blob(['﻿' + tableCSV()], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      download(`tabla-${dist().id}.csv`, url);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
    $('#btn-table-copy').addEventListener('click', () => copyText(tableCSV('\t'), 'Tabla copiada (pégala en Excel)'));

    // Atajo: "/" abre el buscador
    document.addEventListener('keydown', (e) => {
      const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        openPicker();
      }
    });

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
        chart.cache = null;
        chart.invalidate();
        renderPickerButton();
      });
    }
  }

  function renderTableKeepFocus() {
    // No reescribir los campos mientras el usuario escribe
    const active = document.activeElement && document.activeElement.id;
    const keep = {};
    ['t-from', 't-to', 't-step'].forEach((id) => (keep[id] = $('#' + id).value));
    renderTable();
    ['t-from', 't-to', 't-step'].forEach((id) => { if (id === active) $('#' + id).value = keep[id]; });
  }

  /* ================================================================== */
  /* Inicio                                                              */
  /* ================================================================== */
  function init() {
    load();
    chart = new PD.Chart($('#chart'), { onHandleDrag, onDragEnd: save });
    PD.chart = chart; // acceso para depuración desde la consola
    bindEvents();
    renderAll();
    setTab(state.tab || 'calc');

    // Modo sin conexión (no se activa en localhost para no servir archivos viejos al desarrollar)
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if ('serviceWorker' in navigator && location.protocol === 'https:' && !isLocal) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo offline */ });
    }
  }

  init();
})();
