/*
 * Pruebas de precisión numérica contra valores de referencia de 50 dígitos (mpmath).
 *   node tests/accuracy.test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');

require(path.join(__dirname, '..', 'js', 'special.js'));
require(path.join(__dirname, '..', 'js', 'distributions.js'));
const { dist } = globalThis.PD;

const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference.json'), 'utf8'));

let fails = 0, worst = 0, worstCase = null, checked = 0;
const MIN_POSITIVE = 1e-300;

for (const c of ref) {
  const d = dist.byId[c.dist];
  const fn = d[c.fn];
  if (!fn) { console.log('Sin función', c.dist, c.fn); fails++; continue; }
  const got = fn(c.x, c.params);
  const exp = c.expected;
  checked++;
  let rel;
  if (exp < MIN_POSITIVE) rel = Math.abs(got) < 1e-290 ? 0 : Math.abs(got - exp);
  else rel = Math.abs(got - exp) / Math.abs(exp);
  if (!(rel <= 1e-9)) {
    fails++;
    console.log(`FALLA ${c.dist}.${c.fn}(${c.x}; ${JSON.stringify(c.params)}) = ${got}  esperado ${exp}  err.rel ${rel.toExponential(2)}`);
  }
  if (rel > worst) { worst = rel; worstCase = c; }
}

// Ida y vuelta de cuantiles
const probs = [1e-12, 1e-6, 0.001, 0.025, 0.3, 0.5, 0.77, 0.975, 0.999999];
for (const d of dist.list) {
  const prm = dist.defaults(d);
  for (const p of probs) {
    checked++;
    if (d.type === 'continuous') {
      const x = dist.quantile(d, prm, p);
      const back = d.cdf(x, prm);
      // tolerancia: error relativo en p, o el límite de representación de x (unos ulp · f(x))
      const ulpTol = (x2) => 8 * 2.22e-16 * Math.max(1, Math.abs(x2)) * d.pdf(x2, prm);
      const rel = Math.abs(back - p) / p;
      if (!(rel < 1e-8 || Math.abs(back - p) <= ulpTol(x))) { fails++; console.log(`FALLA cuantil ${d.id} p=${p}: x=${x}, F(x)=${back}`); }
      const xu = dist.isf(d, prm, p);
      const backU = d.sf(xu, prm);
      const relU = Math.abs(backU - p) / p;
      if (!(relU < 1e-8 || Math.abs(backU - p) <= ulpTol(xu))) { fails++; console.log(`FALLA isf ${d.id} q=${p}: x=${xu}, S(x)=${backU}`); }
    } else {
      const k = dist.quantile(d, prm, p);
      const ok = d.cdf(k, prm) >= p * (1 - 1e-12) && (k <= d.support(prm)[0] || d.cdf(k - 1, prm) < p);
      if (!ok) { fails++; console.log(`FALLA cuantil discreto ${d.id} p=${p}: k=${k}`); }
      const j = dist.isf(d, prm, p);
      const okU = d.sf(j - 1, prm) >= p * (1 - 1e-12) && (j >= d.support(prm)[1] || d.sf(j, prm) < p);
      if (!okU) { fails++; console.log(`FALLA isf discreto ${d.id} q=${p}: k=${j}`); }
    }
  }
}

// Las masas discretas deben sumar 1 y coincidir con la CDF
for (const d of dist.list.filter((x) => x.type === 'discrete')) {
  const prm = dist.defaults(d);
  const [lo] = d.support(prm);
  const hi = Math.min(d.support(prm)[1], dist.isf(d, prm, 1e-15));
  let acc = 0;
  for (let k = lo; k <= hi; k++) {
    acc += d.pmf(k, prm);
    checked++;
    if (Math.abs(acc - d.cdf(k, prm)) > 1e-12) { fails++; console.log(`FALLA suma pmf ${d.id} k=${k}`); break; }
  }
}

// Las densidades continuas deben integrar F(b) − F(a) (Simpson)
for (const d of dist.list.filter((x) => x.type === 'continuous')) {
  const prm = dist.defaults(d);
  const a = dist.quantile(d, prm, 0.1), b = dist.quantile(d, prm, 0.9);
  const n = 20000, h = (b - a) / n;
  let s = d.pdf(a, prm) + d.pdf(b, prm);
  for (let i = 1; i < n; i++) s += d.pdf(a + i * h, prm) * (i % 2 ? 4 : 2);
  const integral = (s * h) / 3;
  checked++;
  if (Math.abs(integral - 0.8) > 1e-8) { fails++; console.log(`FALLA integral pdf ${d.id}: ${integral}`); }
}

console.log(`\n${checked} comprobaciones, ${fails} fallas. Peor error relativo vs referencia: ${worst.toExponential(2)}` +
  (worstCase ? ` (${worstCase.dist}.${worstCase.fn} x=${worstCase.x})` : ''));
process.exit(fails ? 1 : 0);
