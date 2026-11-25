/*
 * Pruebas del procedimiento paso a paso.
 *   node tests/procedure.test.js
 *
 * Para cada distribución, conjunto de parámetros, tipo de cálculo y
 * desigualdad:
 *   - genera el procedimiento,
 *   - renderiza TODAS sus fórmulas con KaTeX (falla si alguna tiene error de sintaxis),
 *   - comprueba que el resultado final coincide con el cálculo de la aplicación.
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
['special', 'distributions', 'format', 'procedure'].forEach((f) => require(path.join(ROOT, 'js', `${f}.js`)));
const katex = require(path.join(ROOT, 'vendor', 'katex', 'katex.min.js'));
const { dist: D, procedure: P } = globalThis.PD;

let fails = 0, builds = 0, formulas = 0;
const fail = (msg) => { fails++; if (fails <= 40) console.log('FALLA', msg); };

function render(tex, where) {
  formulas++;
  try {
    katex.renderToString(tex, { displayMode: true, throwOnError: true, strict: 'ignore' });
  } catch (e) {
    fail(`${where}: KaTeX → ${e.message}\n      ${tex.slice(0, 300)}`);
  }
}

function expected(d, p, mode, x1, x2, o) {
  switch (mode) {
    case 'lower': return D.probOp(d, p, o.lower, x1);
    case 'upper': return D.probOp(d, p, o.upper, x1);
    case 'between': return D.probBetween(d, p, x1, x2, o.b1, o.b2);
    case 'tails': return x1 < x2 ? Math.min(1, D.probOp(d, p, o.t1, x1) + D.probOp(d, p, o.t2, x2)) : NaN;
  }
  return NaN;
}

const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b || Math.abs(a - b) <= 1e-12 * Math.max(1e-300, Math.abs(b));

const EXTRA = {
  normal: [{ mu: 200, sigma: 15 }, { mu: -3, sigma: 0.25 }],
  t: [{ nu: 1 }, { nu: 2.5 }],
  chisq: [{ k: 4 }, { k: 1 }],
  gamma: [{ k: 3, theta: 2 }, { k: 0.5, theta: 1 }],
  beta: [{ alpha: 2, beta: 3 }, { alpha: 0.5, beta: 0.5 }],
  lognormal: [{ mu: 1, sigma: 1 }],
  weibull: [{ k: 0.7, lambda: 3 }],
  uniform: [{ a: -2, b: 5 }],
  triangular: [{ a: -1, c: 0, b: 4 }],
  binomial: [{ n: 100, p: 0.22 }, { n: 1000, p: 0.03 }, { n: 5, p: 1 }],
  poisson: [{ lambda: 2500 }, { lambda: 0.3 }],
  geometric: [{ p: 0.3, variant: 'failures' }],
  negbinomial: [{ r: 3, p: 0.4, variant: 'failures' }, { r: 25, p: 0.8, variant: 'trials' }],
  hypergeometric: [{ N: 10000, K: 30, n: 2000 }, { N: 20, K: 20, n: 5 }],
  duniform: [{ a: -3, b: 40 }],
  bernoulli: [{ p: 0.5 }],
};

const OPSETS = [
  { lower: '<=', upper: '>=', b1: '<=', b2: '<=', t1: '<=', t2: '>=' },
  { lower: '<', upper: '>', b1: '<', b2: '<', t1: '<', t2: '>' },
  { lower: '<=', upper: '>', b1: '<', b2: '<=', t1: '<', t2: '>=' },
];

function xPairs(d, p) {
  const disc = d.type === 'discrete';
  const q20 = D.quantile(d, p, 0.2), q80 = D.quantile(d, p, 0.8);
  const a = q20, b = disc ? Math.max(q80, q20 + 1) : q80;
  const [sLo, sHi] = d.support(p);
  const pairs = [[a, b], [b, a]];
  if (disc) pairs.push([a + 0.5, b - 0.5], [a, a + 3]);
  if (isFinite(sLo)) pairs.push([sLo - 2, b]);
  if (isFinite(sHi)) pairs.push([a, sHi + 2]);
  // colas extremas
  pairs.push([D.quantile(d, p, 1e-9), D.isf(d, p, 1e-9)]);
  return pairs.filter(([x1, x2]) => isFinite(x1) && isFinite(x2));
}

for (const d of D.list) {
  const sets = [D.defaults(d)].concat((EXTRA[d.id] || []).map((e) => Object.assign(D.defaults(d), e)));
  for (const p of sets) {
    if (D.validate(d, p)) { fail(`${d.id} parámetros inválidos en la prueba ${JSON.stringify(p)}`); continue; }
    for (const [x1, x2] of xPairs(d, p)) {
      for (const mode of ['lower', 'upper', 'between', 'tails']) {
        for (const ops of OPSETS) {
          const where = `${d.id} ${JSON.stringify(p)} ${mode} x1=${x1} x2=${x2} ${JSON.stringify(ops)}`;
          let proc;
          try {
            proc = P.build({ d, p, mode, x1, x2, ops, inv: { type: 'left', p: 0.95 }, decimals: 6 });
          } catch (e) {
            fail(`${where}: excepción ${e.stack}`);
            continue;
          }
          builds++;
          proc.steps.forEach((s) => s.math.forEach((m) => render(m, where)));
          const fin = proc.steps[proc.steps.length - 1];
          if (!fin.final) fail(`${where}: el último paso no es el resultado`);
          const exp = expected(d, p, mode, x1, x2, ops);
          if (!same(fin.value, exp)) fail(`${where}: resultado ${fin.value} ≠ ${exp}`);
        }
      }
    }
    // Cálculo inverso
    for (const type of ['left', 'right', 'central', 'tails']) {
      for (const pv of [0.95, 0.05, 0.5, 0.999]) {
        const where = `${d.id} ${JSON.stringify(p)} inversa ${type} p=${pv}`;
        let proc;
        try {
          proc = P.build({ d, p, mode: 'inverse', x1: 0, x2: 1, ops: OPSETS[0], inv: { type, p: pv }, decimals: 6 });
        } catch (e) {
          fail(`${where}: excepción ${e.stack}`);
          continue;
        }
        builds++;
        proc.steps.forEach((s) => s.math.forEach((m) => render(m, where)));
        const fin = proc.steps[proc.steps.length - 1];
        const iv = D.inverseValues(d, p, type, pv);
        const got = fin.value || {};
        if (type === 'left' || type === 'right') {
          if (!same(got.value, iv.x)) fail(`${where}: ${got.value} ≠ ${iv.x}`);
        } else if (!same(got.value, iv.x1) || !same(got.value2, iv.x2)) {
          fail(`${where}: (${got.value}, ${got.value2}) ≠ (${iv.x1}, ${iv.x2})`);
        }
      }
    }
  }
}

// Caso del ejemplo: N(200, 15), P(X ≥ 224) = 0.0548 con z = 1.60
{
  const d = D.byId.normal, p = { mu: 200, sigma: 15 };
  const ops = OPSETS[0];
  const proc = P.build({ d, p, mode: 'upper', x1: 224, x2: 0, ops, inv: { type: 'left', p: 0.5 }, decimals: 4 });
  const all = proc.steps.map((s) => s.math.join(' ')).join(' ');
  if (!all.includes('\\dfrac{224 - 200}{15}')) fail('ejemplo: falta la sustitución (224 − 200)/15');
  if (!all.includes('\\dfrac{24}{15}')) fail('ejemplo: falta 24/15');
  if (!all.includes('1.6000 = \\boxed{1.60}')) fail('ejemplo: falta z = 1.6000 = 1.60');
  if (!all.includes('\\int_{224}^{\\infty}')) fail('ejemplo: falta la integral de 224 a ∞');
  const fin = proc.steps[proc.steps.length - 1];
  if (Math.abs(fin.value - 0.054799291699557995) > 1e-15) fail(`ejemplo: valor ${fin.value}`);
  if (!fin.math[0].includes('\\boxed{0.0548}')) fail(`ejemplo: resultado ${fin.math[0]}`);
}

console.log(`\n${builds} procedimientos generados, ${formulas} fórmulas renderizadas con KaTeX, ${fails} fallas.`);
process.exit(fails ? 1 : 0);
