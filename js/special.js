/*
 * special.js — Funciones matemáticas especiales de alta precisión.
 *
 * Incluye:
 *   - lgamma (Lanczos), gamma
 *   - stirlerr / bd0 (algoritmo de Loader, igual que R) para densidades
 *     binomial y de Poisson sin pérdida de precisión.
 *   - Φ(x) normal estándar (algoritmo de Cody, precisión ~1e-16 incluso en colas)
 *   - Φ⁻¹(p) (Acklam + refinamiento de Halley)
 *   - Gamma incompleta regularizada P(a,x) y Q(a,x)
 *   - Beta incompleta regularizada I_x(a,b) y su complemento
 *   - Búsqueda de raíces de Brent
 *
 * Todo se expone en el espacio de nombres global PD.special.
 */
(function (root) {
  'use strict';
  const PD = (root.PD = root.PD || {});

  const LN_SQRT_2PI = 0.918938533204672741780329736406; // log(sqrt(2π))
  const LN_2PI = 1.83787706640934548356065947281;
  const SQRT_2PI = 2.50662827463100050241576528481;
  const INV_SQRT_2PI = 0.398942280401432677939946059934;
  const DBL_EPS = 2.220446049250313e-16;
  const FPMIN = 1e-300;

  /* ------------------------------------------------------------------ */
  /* Gamma                                                               */
  /* ------------------------------------------------------------------ */
  const LANCZOS = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  // log(n!) exacto para n pequeño (mejor precisión que Lanczos).
  const LOG_FACT = [0];
  for (let i = 1; i <= 256; i++) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);

  function lgamma(x) {
    if (Number.isInteger(x) && x >= 1 && x <= 257) return LOG_FACT[x - 1];
    if (x < 0.5) {
      // Reflexión: Γ(x)Γ(1−x) = π / sin(πx)
      return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    }
    x -= 1;
    let a = LANCZOS[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
    return LN_SQRT_2PI + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  function gamma(x) {
    if (Number.isInteger(x) && x <= 0) return NaN;
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
    if (x > 171.6) return Infinity;
    return Math.exp(lgamma(x));
  }

  function lbeta(a, b) {
    return lgamma(a) + lgamma(b) - lgamma(a + b);
  }

  function logChoose(n, k) {
    return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
  }

  /* ------------------------------------------------------------------ */
  /* Loader (2000): densidades binomial/Poisson saddle-point             */
  /* ------------------------------------------------------------------ */
  // stirlerr(n) = log(n!) − log( sqrt(2πn) (n/e)^n )
  function stirlerr(n) {
    const S0 = 1 / 12, S1 = 1 / 360, S2 = 1 / 1260, S3 = 1 / 1680, S4 = 1 / 1188;
    if (n <= 15) {
      return lgamma(n + 1) - (n + 0.5) * Math.log(n) + n - LN_SQRT_2PI;
    }
    const nn = n * n;
    if (n > 500) return (S0 - S1 / nn) / n;
    if (n > 80) return (S0 - (S1 - S2 / nn) / nn) / n;
    if (n > 35) return (S0 - (S1 - (S2 - S3 / nn) / nn) / nn) / n;
    return (S0 - (S1 - (S2 - (S3 - S4 / nn) / nn) / nn) / nn) / n;
  }

  // bd0(x, np) = x log(x/np) + np − x, evaluada sin cancelación.
  function bd0(x, np) {
    if (Math.abs(x - np) < 0.1 * (x + np)) {
      let v = (x - np) / (x + np);
      let s = (x - np) * v;
      let ej = 2 * x * v;
      v *= v;
      for (let j = 1; j < 1000; j++) {
        ej *= v;
        const s1 = s + ej / (2 * j + 1);
        if (s1 === s) return s1;
        s = s1;
      }
      return s;
    }
    return x * Math.log(x / np) + np - x;
  }

  // P(X = x) para X ~ Bin(n, p), q = 1 − p. x y n pueden ser reales.
  function dbinomRaw(x, n, p, q) {
    if (p === 0) return x === 0 ? 1 : 0;
    if (q === 0) return x === n ? 1 : 0;
    if (x === 0) {
      if (n === 0) return 1;
      const lc = p < 0.1 ? -bd0(n, n * q) - n * p : n * Math.log(q);
      return Math.exp(lc);
    }
    if (x === n) {
      const lc = q < 0.1 ? -bd0(n, n * p) - n * q : n * Math.log(p);
      return Math.exp(lc);
    }
    if (x < 0 || x > n) return 0;
    const lc = stirlerr(n) - stirlerr(x) - stirlerr(n - x) - bd0(x, n * p) - bd0(n - x, n * q);
    const lf = LN_2PI + Math.log(x) + Math.log1p(-x / n);
    return Math.exp(lc - 0.5 * lf);
  }

  // λ^x e^{−λ} / Γ(x+1), x real ≥ 0.
  function dpoisRaw(x, lambda) {
    if (lambda === 0) return x === 0 ? 1 : 0;
    if (!isFinite(lambda)) return 0;
    if (x < 0) return 0;
    if (x <= lambda * Number.MIN_VALUE) return Math.exp(-lambda);
    if (lambda < x * Number.MIN_VALUE) {
      return Math.exp(-lambda + x * Math.log(lambda) - lgamma(x + 1));
    }
    return Math.exp(-stirlerr(x) - bd0(x, lambda)) / Math.sqrt(2 * Math.PI * x);
  }

  /* ------------------------------------------------------------------ */
  /* Normal estándar — W. J. Cody (1969), como en R::pnorm               */
  /* ------------------------------------------------------------------ */
  const NA = [2.2352520354606839287, 161.02823106855587881, 1067.6894854603709582,
    18154.981253343561249, 0.065682337918207449113];
  const NB = [47.20258190468824187, 976.09855173777669322, 10260.932208618978205,
    45507.789335026729956];
  const NC = [0.39894151208813466764, 8.8831497943883759412, 93.506656132177855979,
    597.27027639480026226, 2494.5375852903726711, 6848.1904505362823326,
    11602.651437647350124, 9842.7148383839780218, 1.0765576773720192317e-8];
  const ND = [22.266688044328115691, 235.38790178262499861, 1519.377599407554805,
    6485.558298266760755, 18615.571640885098091, 34900.952721145977266,
    38912.003286093271411, 19685.429676859990727];
  const NP = [0.21589853405795699, 0.1274011611602473639, 0.022235277870649807,
    0.001421619193227893466, 2.9112874951168792e-5, 0.02307344176494017303];
  const NQ = [1.28426009614491121, 0.468238212480865118, 0.0659881378689285515,
    0.00378239633202758244, 7.29751555083966205e-5];

  /** Devuelve [Φ(x), 1 − Φ(x)] con precisión relativa completa en ambas colas. */
  function pnormBoth(x) {
    if (Number.isNaN(x)) return [NaN, NaN];
    if (x === Infinity) return [1, 0];
    if (x === -Infinity) return [0, 1];
    const y = Math.abs(x);
    let cum, ccum, xnum, xden, temp, xsq, del;
    if (y <= 0.67448975) {
      if (y > DBL_EPS * 0.5) {
        xsq = x * x;
        xnum = NA[4] * xsq;
        xden = xsq;
        for (let i = 0; i < 3; i++) {
          xnum = (xnum + NA[i]) * xsq;
          xden = (xden + NB[i]) * xsq;
        }
      } else {
        xnum = xden = 0;
      }
      temp = (x * (xnum + NA[3])) / (xden + NB[3]);
      return [0.5 + temp, 0.5 - temp];
    }
    if (y <= 5.656854249492380195206754896838) {
      xnum = NC[8] * y;
      xden = y;
      for (let i = 0; i < 7; i++) {
        xnum = (xnum + NC[i]) * y;
        xden = (xden + ND[i]) * y;
      }
      temp = (xnum + NC[7]) / (xden + ND[7]);
    } else {
      if (y > 40) return x > 0 ? [1, 0] : [0, 1];
      xsq = 1 / (x * x);
      xnum = NP[5] * xsq;
      xden = xsq;
      for (let i = 0; i < 4; i++) {
        xnum = (xnum + NP[i]) * xsq;
        xden = (xden + NQ[i]) * xsq;
      }
      temp = (xsq * (xnum + NP[4])) / (xden + NQ[4]);
      temp = (INV_SQRT_2PI - temp) / y;
    }
    xsq = Math.trunc(y * 16) / 16;
    del = (y - xsq) * (y + xsq);
    cum = Math.exp(-xsq * xsq * 0.5) * Math.exp(-del * 0.5) * temp;
    ccum = 1 - cum;
    if (x > 0) return [ccum, cum];
    return [cum, ccum];
  }

  const pnorm = (x) => pnormBoth(x)[0];
  const pnormUpper = (x) => pnormBoth(x)[1];
  const dnorm = (x) => INV_SQRT_2PI * Math.exp(-0.5 * x * x);

  // Acklam: aproximación inicial de Φ⁻¹ (error relativo < 1.15e−9)
  const QA = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const QB = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const QC = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const QD = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];

  function acklam(p) {
    const plow = 0.02425;
    let q, r;
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((QC[0] * q + QC[1]) * q + QC[2]) * q + QC[3]) * q + QC[4]) * q + QC[5]) /
        ((((QD[0] * q + QD[1]) * q + QD[2]) * q + QD[3]) * q + 1);
    }
    if (p <= 1 - plow) {
      q = p - 0.5;
      r = q * q;
      return ((((((QA[0] * r + QA[1]) * r + QA[2]) * r + QA[3]) * r + QA[4]) * r + QA[5]) * q) /
        (((((QB[0] * r + QB[1]) * r + QB[2]) * r + QB[3]) * r + QB[4]) * r + 1);
    }
    q = Math.sqrt(-2 * Math.log1p(-p));
    return -(((((QC[0] * q + QC[1]) * q + QC[2]) * q + QC[3]) * q + QC[4]) * q + QC[5]) /
      ((((QD[0] * q + QD[1]) * q + QD[2]) * q + QD[3]) * q + 1);
  }

  /** Φ⁻¹(p) con precisión completa (dos pasos de Halley). */
  function qnorm(p) {
    if (Number.isNaN(p) || p < 0 || p > 1) return NaN;
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    if (p > 0.5) return qnormUpper(1 - p);
    return refineLower(acklam(p), p);
  }

  /** x tal que 1 − Φ(x) = q, preciso para q muy pequeño. */
  function qnormUpper(q) {
    if (Number.isNaN(q) || q < 0 || q > 1) return NaN;
    if (q === 0) return Infinity;
    if (q === 1) return -Infinity;
    if (q > 0.5) return qnorm(1 - q);
    // Por simetría: 1 − Φ(x) = q  ⇔  Φ(−x) = q
    return -refineLower(acklam(q), q);
  }

  function refineLower(x, p) {
    for (let i = 0; i < 2; i++) {
      if (!isFinite(x)) break;
      const e = pnorm(x) - p;
      const u = e * SQRT_2PI * Math.exp(0.5 * x * x);
      x = x - u / (1 + 0.5 * x * u);
    }
    return x;
  }

  /* ------------------------------------------------------------------ */
  /* Gamma incompleta regularizada                                       */
  /* ------------------------------------------------------------------ */
  // x^a e^{−x} / Γ(a), calculado con Loader cuando a es grande.
  function gammaPrefactor(a, x) {
    if (a > 10) return a * dpoisRaw(a, x);
    return Math.exp(a * Math.log(x) - x - lgamma(a));
  }

  /** Devuelve [P(a,x), Q(a,x)]. */
  function gammaIncBoth(a, x) {
    if (Number.isNaN(a) || Number.isNaN(x) || a <= 0) return [NaN, NaN];
    if (x <= 0) return [0, 1];
    if (x === Infinity) return [1, 0];
    const maxIter = 200000;
    if (x < a + 1) {
      // Serie: P = x^a e^{-x}/Γ(a) · Σ x^n / (a(a+1)…(a+n))
      let ap = a, sum = 1 / a, del = sum;
      for (let n = 0; n < maxIter; n++) {
        ap += 1;
        del *= x / ap;
        sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-17) break;
      }
      const P = Math.min(1, sum * gammaPrefactor(a, x));
      return [P, 1 - P];
    }
    // Fracción continua (Lentz modificado) para Q
    let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (let i = 1; i < maxIter; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    const Q = Math.min(1, gammaPrefactor(a, x) * h);
    return [1 - Q, Q];
  }

  const gammaP = (a, x) => gammaIncBoth(a, x)[0];
  const gammaQ = (a, x) => gammaIncBoth(a, x)[1];

  /* ------------------------------------------------------------------ */
  /* Beta incompleta regularizada                                        */
  /* ------------------------------------------------------------------ */
  function betacf(a, b, x) {
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - (qab * x) / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 100000; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    return h;
  }

  // x^a y^b / B(a,b)  con y = 1 − x
  function betaPrefactor(a, b, x, y) {
    if (a >= 1 && b >= 1 && a + b > 20) {
      // Loader: dbinom(a; a+b, x) · a·b/(a+b)
      return (dbinomRaw(a, a + b, x, y) * a * b) / (a + b);
    }
    return Math.exp(a * Math.log(x) + b * Math.log(y) - lbeta(a, b));
  }

  /**
   * Devuelve [I_x(a,b), 1 − I_x(a,b)].
   * y = 1 − x puede proporcionarse explícitamente para evitar cancelación.
   */
  function betaIncBoth(x, a, b, y) {
    if (y === undefined) y = 1 - x;
    if (Number.isNaN(x) || a <= 0 || b <= 0) return [NaN, NaN];
    if (x <= 0) return [0, 1];
    if (y <= 0) return [1, 0];
    if (x < (a + 1) / (a + b + 2)) {
      const I = Math.min(1, (betaPrefactor(a, b, x, y) * betacf(a, b, x)) / a);
      return [I, 1 - I];
    }
    const Ic = Math.min(1, (betaPrefactor(b, a, y, x) * betacf(b, a, y)) / b);
    return [1 - Ic, Ic];
  }

  const betaInc = (x, a, b) => betaIncBoth(x, a, b)[0];

  /* ------------------------------------------------------------------ */
  /* Raíces: método de Brent                                             */
  /* ------------------------------------------------------------------ */
  function brent(f, a, b, tol = 1e-15, maxIter = 300) {
    let fa = f(a), fb = f(b);
    if (fa === 0) return a;
    if (fb === 0) return b;
    if (fa * fb > 0) return NaN;
    let c = a, fc = fa, d = b - a, e = d;
    for (let i = 0; i < maxIter; i++) {
      if (fb * fc > 0) { c = a; fc = fa; d = e = b - a; }
      if (Math.abs(fc) < Math.abs(fb)) {
        a = b; b = c; c = a;
        fa = fb; fb = fc; fc = fa;
      }
      const tol1 = 2 * DBL_EPS * Math.abs(b) + 0.5 * tol;
      const xm = 0.5 * (c - b);
      if (Math.abs(xm) <= tol1 || fb === 0) return b;
      if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
        let p, q, r;
        const s = fb / fa;
        if (a === c) {
          p = 2 * xm * s;
          q = 1 - s;
        } else {
          q = fa / fc;
          r = fb / fc;
          p = s * (2 * xm * q * (q - r) - (b - a) * (r - 1));
          q = (q - 1) * (r - 1) * (s - 1);
        }
        if (p > 0) q = -q;
        p = Math.abs(p);
        if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
          e = d;
          d = p / q;
        } else {
          d = xm;
          e = d;
        }
      } else {
        d = xm;
        e = d;
      }
      a = b;
      fa = fb;
      b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1;
      fb = f(b);
    }
    return b;
  }

  PD.special = {
    LN_SQRT_2PI, LN_2PI, SQRT_2PI, INV_SQRT_2PI, DBL_EPS,
    lgamma, gamma, lbeta, logChoose,
    stirlerr, bd0, dbinomRaw, dpoisRaw,
    pnormBoth, pnorm, pnormUpper, dnorm, qnorm, qnormUpper,
    gammaIncBoth, gammaP, gammaQ,
    betaIncBoth, betaInc,
    brent,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
