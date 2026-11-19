/*
 * distributions.js — Catálogo de distribuciones de probabilidad.
 *
 * Cada distribución define:
 *   id, name, type ('continuous' | 'discrete'), params[], validate(p)
 *   support(p) → [lo, hi]
 *   pdf(x,p) (continuas) | pmf(k,p) (discretas)
 *   cdf(x,p) = P(X ≤ x)      sf(x,p) = P(X > x)   (ambas calculadas directamente
 *                                                  para conservar precisión en colas)
 *   quantile(p) / isf(q) opcionales (si no, se invierte numéricamente)
 *   mean, variance, skewness, kurtosis (exceso), median, mode
 *   tex: fórmulas en LaTeX para la pestaña de Fórmulas
 *
 * Además expone utilidades genéricas: probabilidades por modo, cuantiles,
 * estadísticos y rango de graficado.
 */
(function (root) {
  'use strict';
  const PD = (root.PD = root.PD || {});
  const S = PD.special;
  const { lgamma, dbinomRaw, dpoisRaw, pnormBoth, dnorm, qnorm, qnormUpper,
    gammaIncBoth, betaIncBoth, brent, lbeta } = S;

  const INF = Infinity;
  const isInt = Number.isInteger;

  /* ---------------- utilidades compartidas ---------------- */

  // Densidad gamma (forma k, escala θ) — como R::dgamma (vía Loader)
  function dgamma(x, k, theta) {
    if (x < 0) return 0;
    if (x === 0) {
      if (k < 1) return INF;
      if (k > 1) return 0;
      return 1 / theta;
    }
    if (k < 1) return (dpoisRaw(k, x / theta) * k) / x;
    return dpoisRaw(k - 1, x / theta) / theta;
  }

  // Densidad beta — como R::dbeta
  function dbeta(x, a, b) {
    if (x < 0 || x > 1) return 0;
    if (x === 0) {
      if (a < 1) return INF;
      if (a > 1) return 0;
      return b;
    }
    if (x === 1) {
      if (b < 1) return INF;
      if (b > 1) return 0;
      return a;
    }
    if (a <= 2 || b <= 2) {
      return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - lbeta(a, b));
    }
    return (a + b - 1) * dbinomRaw(a - 1, a + b - 2, x, 1 - x);
  }

  // [P(T ≤ t), P(T > t)] para t de Student con ν g.l.
  function tBoth(t, nu) {
    if (nu > 1e7) return pnormBoth(t);
    if (t === INF) return [1, 0];
    if (t === -INF) return [0, 1];
    const t2 = t * t;
    let tail; // P(T > |t|)
    if (t2 < nu) {
      tail = 0.5 * betaIncBoth(t2 / (nu + t2), 0.5, nu / 2, nu / (nu + t2))[1];
    } else {
      tail = 0.5 * betaIncBoth(nu / (nu + t2), nu / 2, 0.5, t2 / (nu + t2))[0];
    }
    return t > 0 ? [1 - tail, tail] : [tail, 1 - tail];
  }

  function fBoth(x, d1, d2) {
    if (x <= 0) return [0, 1];
    if (x === INF) return [1, 0];
    const den = d1 * x + d2;
    return betaIncBoth((d1 * x) / den, d1 / 2, d2 / 2, d2 / den);
  }

  const P = (key, label, tex, def, opts = {}) => Object.assign(
    { key, label, tex, def, min: -INF, max: INF, integer: false, step: 0.1, slider: null },
    opts
  );

  /* ================================================================== */
  /* DISTRIBUCIONES CONTINUAS                                            */
  /* ================================================================== */
  const list = [];

  list.push({
    id: 'normal',
    name: 'Normal',
    type: 'continuous',
    notation: 'X ~ N(μ, σ)',
    notationTex: 'X \\sim N(\\mu,\\ \\sigma)',
    params: [
      P('mu', 'μ', '\\mu', 0, { slider: [-10, 10], hint: 'Media' }),
      P('sigma', 'σ', '\\sigma', 1, { min: 0, minEx: true, slider: [0.1, 10], hint: 'Desviación estándar' }),
    ],
    support: () => [-INF, INF],
    pdf: (x, p) => dnorm((x - p.mu) / p.sigma) / p.sigma,
    cdf: (x, p) => pnormBoth((x - p.mu) / p.sigma)[0],
    sf: (x, p) => pnormBoth((x - p.mu) / p.sigma)[1],
    quantile: (q, p) => p.mu + p.sigma * qnorm(q),
    isf: (q, p) => p.mu + p.sigma * qnormUpper(q),
    mean: (p) => p.mu,
    variance: (p) => p.sigma * p.sigma,
    skewness: () => 0,
    kurtosis: () => 0,
    median: (p) => p.mu,
    mode: (p) => p.mu,
    standardize: (x, p) => (x - p.mu) / p.sigma,
    description: 'La distribución más importante de la estadística. Modela variables que resultan de la suma de muchos efectos pequeños e independientes (Teorema del Límite Central). Su curva es la clásica "campana de Gauss", simétrica respecto a μ.',
    uses: ['Errores de medición', 'Estaturas, pesos y puntajes de pruebas', 'Aproximación de la binomial y Poisson', 'Inferencia: intervalos de confianza y pruebas z'],
    tex: {
      support: 'x \\in (-\\infty,\\ \\infty)',
      params: '\\mu \\in \\mathbb{R},\\quad \\sigma > 0',
      pdf: 'f(x) = \\dfrac{1}{\\sigma\\sqrt{2\\pi}}\\, e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}',
      cdf: 'F(x) = \\Phi\\!\\left(\\dfrac{x-\\mu}{\\sigma}\\right) = \\dfrac{1}{2}\\left[1+\\operatorname{erf}\\!\\left(\\dfrac{x-\\mu}{\\sigma\\sqrt{2}}\\right)\\right]',
      mean: 'E[X] = \\mu',
      variance: '\\operatorname{Var}(X) = \\sigma^2',
      mgf: 'M_X(t) = e^{\\mu t + \\frac{1}{2}\\sigma^2 t^2}',
      extra: 'Z = \\dfrac{X-\\mu}{\\sigma} \\sim N(0,1)',
    },
  });

  list.push({
    id: 't',
    name: 't de Student',
    type: 'continuous',
    notation: 'X ~ t(ν)',
    notationTex: 'X \\sim t(\\nu)',
    params: [
      P('nu', 'ν', '\\nu', 10, { min: 0, minEx: true, slider: [1, 60], step: 1, hint: 'Grados de libertad' }),
    ],
    support: () => [-INF, INF],
    pdf: (x, p) => {
      const nu = p.nu;
      if (nu > 1e7) return dnorm(x);
      return Math.exp(lgamma((nu + 1) / 2) - lgamma(nu / 2) - 0.5 * Math.log(nu * Math.PI) -
        ((nu + 1) / 2) * Math.log1p((x * x) / nu));
    },
    cdf: (x, p) => tBoth(x, p.nu)[0],
    sf: (x, p) => tBoth(x, p.nu)[1],
    mean: (p) => (p.nu > 1 ? 0 : NaN),
    variance: (p) => (p.nu > 2 ? p.nu / (p.nu - 2) : p.nu > 1 ? INF : NaN),
    skewness: (p) => (p.nu > 3 ? 0 : NaN),
    kurtosis: (p) => (p.nu > 4 ? 6 / (p.nu - 4) : p.nu > 2 ? INF : NaN),
    median: () => 0,
    mode: () => 0,
    symmetricAt: 0,
    description: 'Surge al estimar la media de una población normal cuando la desviación estándar es desconocida y la muestra es pequeña. Tiene colas más pesadas que la normal; cuando ν → ∞ converge a N(0, 1).',
    uses: ['Intervalos de confianza para la media con σ desconocida', 'Prueba t para una y dos muestras', 'Coeficientes en regresión lineal'],
    tex: {
      support: 'x \\in (-\\infty,\\ \\infty)',
      params: '\\nu > 0 \\ \\text{(grados de libertad)}',
      pdf: 'f(x) = \\dfrac{\\Gamma\\!\\left(\\frac{\\nu+1}{2}\\right)}{\\sqrt{\\nu\\pi}\\ \\Gamma\\!\\left(\\frac{\\nu}{2}\\right)} \\left(1+\\dfrac{x^2}{\\nu}\\right)^{-\\frac{\\nu+1}{2}}',
      cdf: 'F(x) = 1 - \\tfrac{1}{2} I_{\\frac{\\nu}{\\nu+x^2}}\\!\\left(\\tfrac{\\nu}{2},\\tfrac{1}{2}\\right),\\quad x > 0',
      mean: 'E[X] = 0 \\quad (\\nu > 1)',
      variance: '\\operatorname{Var}(X) = \\dfrac{\\nu}{\\nu-2} \\quad (\\nu > 2)',
      extra: 'T = \\dfrac{\\bar{X}-\\mu}{S/\\sqrt{n}} \\sim t(n-1)',
    },
  });

  list.push({
    id: 'chisq',
    name: 'Chi-cuadrado',
    type: 'continuous',
    notation: 'X ~ χ²(k)',
    notationTex: 'X \\sim \\chi^2(k)',
    params: [
      P('k', 'k', 'k', 5, { min: 0, minEx: true, slider: [1, 50], step: 1, hint: 'Grados de libertad' }),
    ],
    support: () => [0, INF],
    pdf: (x, p) => dgamma(x, p.k / 2, 2),
    cdf: (x, p) => gammaIncBoth(p.k / 2, x / 2)[0],
    sf: (x, p) => gammaIncBoth(p.k / 2, x / 2)[1],
    mean: (p) => p.k,
    variance: (p) => 2 * p.k,
    skewness: (p) => Math.sqrt(8 / p.k),
    kurtosis: (p) => 12 / p.k,
    mode: (p) => Math.max(p.k - 2, 0),
    description: 'Es la distribución de la suma de los cuadrados de k variables normales estándar independientes. Es asimétrica a la derecha y se vuelve más simétrica al aumentar k.',
    uses: ['Prueba de bondad de ajuste', 'Prueba de independencia en tablas de contingencia', 'Intervalos de confianza para la varianza'],
    tex: {
      support: 'x \\in [0,\\ \\infty)',
      params: 'k > 0 \\ \\text{(grados de libertad)}',
      pdf: 'f(x) = \\dfrac{1}{2^{k/2}\\,\\Gamma(k/2)}\\, x^{\\frac{k}{2}-1} e^{-x/2}',
      cdf: 'F(x) = \\dfrac{\\gamma\\!\\left(\\frac{k}{2},\\frac{x}{2}\\right)}{\\Gamma\\!\\left(\\frac{k}{2}\\right)} = P\\!\\left(\\tfrac{k}{2},\\tfrac{x}{2}\\right)',
      mean: 'E[X] = k',
      variance: '\\operatorname{Var}(X) = 2k',
      mgf: 'M_X(t) = (1-2t)^{-k/2},\\quad t < \\tfrac{1}{2}',
      extra: '\\chi^2 = \\dfrac{(n-1)S^2}{\\sigma^2} \\sim \\chi^2(n-1)',
    },
  });

  list.push({
    id: 'f',
    name: 'F de Fisher',
    type: 'continuous',
    notation: 'X ~ F(d₁, d₂)',
    notationTex: 'X \\sim F(d_1,\\ d_2)',
    params: [
      P('d1', 'd₁', 'd_1', 5, { min: 0, minEx: true, slider: [1, 60], step: 1, hint: 'g.l. del numerador' }),
      P('d2', 'd₂', 'd_2', 10, { min: 0, minEx: true, slider: [1, 60], step: 1, hint: 'g.l. del denominador' }),
    ],
    support: () => [0, INF],
    pdf: (x, p) => {
      const m = p.d1, n = p.d2;
      if (x < 0) return 0;
      if (x === 0) return m > 2 ? 0 : m === 2 ? 1 : INF;
      const f0 = 1 / (n + x * m), q = n * f0, pp = x * m * f0;
      if (m >= 2) return ((m * q) / 2) * dbinomRaw((m - 2) / 2, (m + n - 2) / 2, pp, q);
      return ((m * m * q) / (2 * pp * (m + n))) * dbinomRaw(m / 2, (m + n) / 2, pp, q);
    },
    cdf: (x, p) => fBoth(x, p.d1, p.d2)[0],
    sf: (x, p) => fBoth(x, p.d1, p.d2)[1],
    mean: (p) => (p.d2 > 2 ? p.d2 / (p.d2 - 2) : NaN),
    variance: (p) => {
      const { d1, d2 } = p;
      if (d2 > 4) return (2 * d2 * d2 * (d1 + d2 - 2)) / (d1 * (d2 - 2) ** 2 * (d2 - 4));
      return d2 > 2 ? INF : NaN;
    },
    skewness: (p) => {
      const { d1, d2 } = p;
      if (d2 <= 6) return NaN;
      return ((2 * d1 + d2 - 2) * Math.sqrt(8 * (d2 - 4))) / ((d2 - 6) * Math.sqrt(d1 * (d1 + d2 - 2)));
    },
    kurtosis: (p) => {
      const { d1, d2 } = p;
      if (d2 <= 8) return NaN;
      return (12 * (d1 * (5 * d2 - 22) * (d1 + d2 - 2) + (d2 - 4) * (d2 - 2) ** 2)) /
        (d1 * (d2 - 6) * (d2 - 8) * (d1 + d2 - 2));
    },
    mode: (p) => (p.d1 > 2 ? ((p.d1 - 2) / p.d1) * (p.d2 / (p.d2 + 2)) : 0),
    description: 'Es el cociente de dos variables chi-cuadrado independientes divididas entre sus grados de libertad. Se usa para comparar varianzas.',
    uses: ['Análisis de varianza (ANOVA)', 'Comparación de dos varianzas', 'Significancia global en regresión'],
    tex: {
      support: 'x \\in [0,\\ \\infty)',
      params: 'd_1 > 0,\\quad d_2 > 0',
      pdf: 'f(x) = \\dfrac{\\sqrt{\\dfrac{(d_1 x)^{d_1}\\, d_2^{d_2}}{(d_1 x + d_2)^{d_1+d_2}}}}{x\\, B\\!\\left(\\frac{d_1}{2},\\frac{d_2}{2}\\right)}',
      cdf: 'F(x) = I_{\\frac{d_1 x}{d_1 x + d_2}}\\!\\left(\\tfrac{d_1}{2},\\tfrac{d_2}{2}\\right)',
      mean: 'E[X] = \\dfrac{d_2}{d_2-2} \\quad (d_2 > 2)',
      variance: '\\operatorname{Var}(X) = \\dfrac{2\\,d_2^2\\,(d_1+d_2-2)}{d_1 (d_2-2)^2 (d_2-4)} \\quad (d_2 > 4)',
      extra: 'F = \\dfrac{\\chi^2_1/d_1}{\\chi^2_2/d_2}',
    },
  });

  list.push({
    id: 'exponential',
    name: 'Exponencial',
    type: 'continuous',
    notation: 'X ~ Exp(λ)',
    notationTex: 'X \\sim \\operatorname{Exp}(\\lambda)',
    params: [
      P('lambda', 'λ', '\\lambda', 1, { min: 0, minEx: true, slider: [0.05, 5], step: 0.05, hint: 'Tasa' }),
    ],
    support: () => [0, INF],
    pdf: (x, p) => (x < 0 ? 0 : p.lambda * Math.exp(-p.lambda * x)),
    cdf: (x, p) => (x <= 0 ? 0 : -Math.expm1(-p.lambda * x)),
    sf: (x, p) => (x <= 0 ? 1 : Math.exp(-p.lambda * x)),
    quantile: (q, p) => -Math.log1p(-q) / p.lambda,
    isf: (q, p) => -Math.log(q) / p.lambda,
    mean: (p) => 1 / p.lambda,
    variance: (p) => 1 / (p.lambda * p.lambda),
    skewness: () => 2,
    kurtosis: () => 6,
    median: (p) => Math.LN2 / p.lambda,
    mode: () => 0,
    description: 'Modela el tiempo de espera entre eventos que ocurren a una tasa constante λ (proceso de Poisson). Es la única distribución continua "sin memoria".',
    uses: ['Tiempo entre llegadas de clientes', 'Vida útil de componentes electrónicos', 'Tiempo hasta la desintegración radiactiva'],
    tex: {
      support: 'x \\in [0,\\ \\infty)',
      params: '\\lambda > 0 \\ \\text{(tasa)}',
      pdf: 'f(x) = \\lambda e^{-\\lambda x}',
      cdf: 'F(x) = 1 - e^{-\\lambda x}',
      mean: 'E[X] = \\dfrac{1}{\\lambda}',
      variance: '\\operatorname{Var}(X) = \\dfrac{1}{\\lambda^2}',
      mgf: 'M_X(t) = \\dfrac{\\lambda}{\\lambda - t},\\quad t < \\lambda',
      extra: 'P(X > s + t \\mid X > s) = P(X > t)',
    },
  });

  list.push({
    id: 'uniform',
    name: 'Uniforme continua',
    type: 'continuous',
    notation: 'X ~ U(a, b)',
    notationTex: 'X \\sim U(a,\\ b)',
    params: [
      P('a', 'a (mín)', 'a', 0, { slider: [-10, 10], hint: 'Límite inferior' }),
      P('b', 'b (máx)', 'b', 1, { slider: [-10, 20], hint: 'Límite superior' }),
    ],
    validate: (p) => (p.a < p.b ? null : 'Se requiere a < b'),
    support: (p) => [p.a, p.b],
    pdf: (x, p) => (x < p.a || x > p.b ? 0 : 1 / (p.b - p.a)),
    cdf: (x, p) => (x <= p.a ? 0 : x >= p.b ? 1 : (x - p.a) / (p.b - p.a)),
    sf: (x, p) => (x <= p.a ? 1 : x >= p.b ? 0 : (p.b - x) / (p.b - p.a)),
    quantile: (q, p) => p.a + q * (p.b - p.a),
    isf: (q, p) => p.b - q * (p.b - p.a),
    mean: (p) => (p.a + p.b) / 2,
    variance: (p) => (p.b - p.a) ** 2 / 12,
    skewness: () => 0,
    kurtosis: () => -6 / 5,
    median: (p) => (p.a + p.b) / 2,
    mode: () => 'Cualquier valor en [a, b]',
    description: 'Todos los valores del intervalo [a, b] son igualmente probables. La densidad es constante.',
    uses: ['Generación de números aleatorios', 'Errores de redondeo', 'Modelos sin información previa'],
    tex: {
      support: 'x \\in [a,\\ b]',
      params: '-\\infty < a < b < \\infty',
      pdf: 'f(x) = \\dfrac{1}{b-a},\\quad a \\le x \\le b',
      cdf: 'F(x) = \\dfrac{x-a}{b-a},\\quad a \\le x \\le b',
      mean: 'E[X] = \\dfrac{a+b}{2}',
      variance: '\\operatorname{Var}(X) = \\dfrac{(b-a)^2}{12}',
      mgf: 'M_X(t) = \\dfrac{e^{tb}-e^{ta}}{t(b-a)}',
    },
  });

  list.push({
    id: 'gamma',
    name: 'Gamma',
    type: 'continuous',
    notation: 'X ~ Gamma(k, θ)',
    notationTex: 'X \\sim \\Gamma(k,\\ \\theta)',
    params: [
      P('k', 'k', 'k', 2, { min: 0, minEx: true, slider: [0.2, 20], hint: 'Forma' }),
      P('theta', 'θ', '\\theta', 2, { min: 0, minEx: true, slider: [0.1, 10], hint: 'Escala' }),
    ],
    support: () => [0, INF],
    pdf: (x, p) => dgamma(x, p.k, p.theta),
    cdf: (x, p) => gammaIncBoth(p.k, x / p.theta)[0],
    sf: (x, p) => gammaIncBoth(p.k, x / p.theta)[1],
    mean: (p) => p.k * p.theta,
    variance: (p) => p.k * p.theta * p.theta,
    skewness: (p) => 2 / Math.sqrt(p.k),
    kurtosis: (p) => 6 / p.k,
    mode: (p) => (p.k >= 1 ? (p.k - 1) * p.theta : 0),
    description: 'Generaliza a la exponencial: modela el tiempo hasta que ocurren k eventos de un proceso de Poisson (cuando k es entero se llama Erlang). Muy flexible para datos positivos asimétricos.',
    uses: ['Tiempos de espera acumulados', 'Montos de reclamaciones de seguros', 'Precipitación pluvial'],
    tex: {
      support: 'x \\in [0,\\ \\infty)',
      params: 'k > 0 \\ \\text{(forma)},\\quad \\theta > 0 \\ \\text{(escala)}',
      pdf: 'f(x) = \\dfrac{x^{k-1} e^{-x/\\theta}}{\\Gamma(k)\\,\\theta^{k}}',
      cdf: 'F(x) = \\dfrac{\\gamma\\!\\left(k,\\ x/\\theta\\right)}{\\Gamma(k)}',
      mean: 'E[X] = k\\theta',
      variance: '\\operatorname{Var}(X) = k\\theta^2',
      mgf: 'M_X(t) = (1-\\theta t)^{-k},\\quad t < 1/\\theta',
    },
  });

  list.push({
    id: 'beta',
    name: 'Beta',
    type: 'continuous',
    notation: 'X ~ Beta(α, β)',
    notationTex: 'X \\sim \\operatorname{Beta}(\\alpha,\\ \\beta)',
    params: [
      P('alpha', 'α', '\\alpha', 2, { min: 0, minEx: true, slider: [0.1, 20], hint: 'Forma 1' }),
      P('beta', 'β', '\\beta', 5, { min: 0, minEx: true, slider: [0.1, 20], hint: 'Forma 2' }),
    ],
    support: () => [0, 1],
    pdf: (x, p) => dbeta(x, p.alpha, p.beta),
    cdf: (x, p) => betaIncBoth(Math.min(Math.max(x, 0), 1), p.alpha, p.beta)[0],
    sf: (x, p) => betaIncBoth(Math.min(Math.max(x, 0), 1), p.alpha, p.beta)[1],
    mean: (p) => p.alpha / (p.alpha + p.beta),
    variance: (p) => {
      const s = p.alpha + p.beta;
      return (p.alpha * p.beta) / (s * s * (s + 1));
    },
    skewness: (p) => {
      const { alpha: a, beta: b } = p;
      return (2 * (b - a) * Math.sqrt(a + b + 1)) / ((a + b + 2) * Math.sqrt(a * b));
    },
    kurtosis: (p) => {
      const { alpha: a, beta: b } = p;
      return (6 * ((a - b) ** 2 * (a + b + 1) - a * b * (a + b + 2))) / (a * b * (a + b + 2) * (a + b + 3));
    },
    mode: (p) => {
      const { alpha: a, beta: b } = p;
      if (a > 1 && b > 1) return (a - 1) / (a + b - 2);
      if (a === 1 && b === 1) return 'Cualquier valor en [0, 1]';
      if (a <= 1 && b > 1) return 0;
      if (a > 1 && b <= 1) return 1;
      if (a < 1 && b < 1) return [0, 1];
      return a < 1 ? 0 : 1;
    },
    description: 'Definida en [0, 1], modela proporciones y probabilidades. Su forma es muy flexible: uniforme, en U, en campana o sesgada según α y β.',
    uses: ['Proporción de éxitos desconocida (estadística bayesiana)', 'Duración de tareas en PERT', 'Fracciones y porcentajes'],
    tex: {
      support: 'x \\in [0,\\ 1]',
      params: '\\alpha > 0,\\quad \\beta > 0',
      pdf: 'f(x) = \\dfrac{x^{\\alpha-1}(1-x)^{\\beta-1}}{B(\\alpha,\\beta)},\\quad B(\\alpha,\\beta)=\\dfrac{\\Gamma(\\alpha)\\Gamma(\\beta)}{\\Gamma(\\alpha+\\beta)}',
      cdf: 'F(x) = I_x(\\alpha,\\ \\beta)',
      mean: 'E[X] = \\dfrac{\\alpha}{\\alpha+\\beta}',
      variance: '\\operatorname{Var}(X) = \\dfrac{\\alpha\\beta}{(\\alpha+\\beta)^2(\\alpha+\\beta+1)}',
    },
  });

  list.push({
    id: 'lognormal',
    name: 'Lognormal',
    type: 'continuous',
    notation: 'X ~ LogN(μ, σ)',
    notationTex: 'X \\sim \\operatorname{LogN}(\\mu,\\ \\sigma)',
    params: [
      P('mu', 'μ', '\\mu', 0, { slider: [-3, 3], hint: 'Media de ln X' }),
      P('sigma', 'σ', '\\sigma', 0.5, { min: 0, minEx: true, slider: [0.05, 2], step: 0.05, hint: 'Desv. estándar de ln X' }),
    ],
    support: () => [0, INF],
    pdf: (x, p) => (x <= 0 ? 0 : dnorm((Math.log(x) - p.mu) / p.sigma) / (p.sigma * x)),
    cdf: (x, p) => (x <= 0 ? 0 : pnormBoth((Math.log(x) - p.mu) / p.sigma)[0]),
    sf: (x, p) => (x <= 0 ? 1 : pnormBoth((Math.log(x) - p.mu) / p.sigma)[1]),
    quantile: (q, p) => Math.exp(p.mu + p.sigma * qnorm(q)),
    isf: (q, p) => Math.exp(p.mu + p.sigma * qnormUpper(q)),
    mean: (p) => Math.exp(p.mu + (p.sigma * p.sigma) / 2),
    variance: (p) => Math.expm1(p.sigma * p.sigma) * Math.exp(2 * p.mu + p.sigma * p.sigma),
    skewness: (p) => {
      const e = Math.exp(p.sigma * p.sigma);
      return (e + 2) * Math.sqrt(e - 1);
    },
    kurtosis: (p) => {
      const s2 = p.sigma * p.sigma;
      return Math.exp(4 * s2) + 2 * Math.exp(3 * s2) + 3 * Math.exp(2 * s2) - 6;
    },
    median: (p) => Math.exp(p.mu),
    mode: (p) => Math.exp(p.mu - p.sigma * p.sigma),
    standardize: (x, p) => (Math.log(x) - p.mu) / p.sigma,
    description: 'Una variable es lognormal si su logaritmo natural es normal. Modela cantidades positivas que resultan del producto de muchos factores.',
    uses: ['Precios de acciones', 'Ingresos y tamaños de empresas', 'Tiempos de reparación'],
    tex: {
      support: 'x \\in (0,\\ \\infty)',
      params: '\\mu \\in \\mathbb{R},\\quad \\sigma > 0',
      pdf: 'f(x) = \\dfrac{1}{x\\,\\sigma\\sqrt{2\\pi}}\\, e^{-\\frac{(\\ln x-\\mu)^2}{2\\sigma^2}}',
      cdf: 'F(x) = \\Phi\\!\\left(\\dfrac{\\ln x-\\mu}{\\sigma}\\right)',
      mean: 'E[X] = e^{\\mu+\\sigma^2/2}',
      variance: '\\operatorname{Var}(X) = \\left(e^{\\sigma^2}-1\\right) e^{2\\mu+\\sigma^2}',
      extra: '\\ln X \\sim N(\\mu,\\ \\sigma)',
    },
  });

  list.push({
    id: 'weibull',
    name: 'Weibull',
    type: 'continuous',
    notation: 'X ~ Weibull(k, λ)',
    notationTex: 'X \\sim \\operatorname{Weibull}(k,\\ \\lambda)',
    params: [
      P('k', 'k', 'k', 1.5, { min: 0, minEx: true, slider: [0.2, 10], hint: 'Forma' }),
      P('lambda', 'λ', '\\lambda', 1, { min: 0, minEx: true, slider: [0.1, 10], hint: 'Escala' }),
    ],
    support: () => [0, INF],
    pdf: (x, p) => {
      const { k, lambda: l } = p;
      if (x < 0) return 0;
      if (x === 0) return k < 1 ? INF : k === 1 ? 1 / l : 0;
      const z = x / l;
      return (k / l) * Math.pow(z, k - 1) * Math.exp(-Math.pow(z, k));
    },
    cdf: (x, p) => (x <= 0 ? 0 : -Math.expm1(-Math.pow(x / p.lambda, p.k))),
    sf: (x, p) => (x <= 0 ? 1 : Math.exp(-Math.pow(x / p.lambda, p.k))),
    quantile: (q, p) => p.lambda * Math.pow(-Math.log1p(-q), 1 / p.k),
    isf: (q, p) => p.lambda * Math.pow(-Math.log(q), 1 / p.k),
    mean: (p) => p.lambda * S.gamma(1 + 1 / p.k),
    variance: (p) => p.lambda ** 2 * (S.gamma(1 + 2 / p.k) - S.gamma(1 + 1 / p.k) ** 2),
    skewness: (p) => {
      const g1 = S.gamma(1 + 1 / p.k), g2 = S.gamma(1 + 2 / p.k), g3 = S.gamma(1 + 3 / p.k);
      return (g3 - 3 * g1 * g2 + 2 * g1 ** 3) / Math.pow(g2 - g1 * g1, 1.5);
    },
    kurtosis: (p) => {
      const g1 = S.gamma(1 + 1 / p.k), g2 = S.gamma(1 + 2 / p.k), g3 = S.gamma(1 + 3 / p.k), g4 = S.gamma(1 + 4 / p.k);
      return (g4 - 4 * g1 * g3 + 6 * g1 * g1 * g2 - 3 * g1 ** 4) / (g2 - g1 * g1) ** 2 - 3;
    },
    median: (p) => p.lambda * Math.pow(Math.LN2, 1 / p.k),
    mode: (p) => (p.k > 1 ? p.lambda * Math.pow((p.k - 1) / p.k, 1 / p.k) : 0),
    description: 'Muy usada en confiabilidad. Si k < 1 la tasa de falla disminuye con el tiempo, si k = 1 es constante (exponencial) y si k > 1 aumenta (desgaste).',
    uses: ['Tiempo de vida de materiales y equipos', 'Velocidad del viento', 'Análisis de supervivencia'],
    tex: {
      support: 'x \\in [0,\\ \\infty)',
      params: 'k > 0 \\ \\text{(forma)},\\quad \\lambda > 0 \\ \\text{(escala)}',
      pdf: 'f(x) = \\dfrac{k}{\\lambda}\\left(\\dfrac{x}{\\lambda}\\right)^{k-1} e^{-(x/\\lambda)^k}',
      cdf: 'F(x) = 1 - e^{-(x/\\lambda)^k}',
      mean: 'E[X] = \\lambda\\,\\Gamma\\!\\left(1+\\tfrac{1}{k}\\right)',
      variance: '\\operatorname{Var}(X) = \\lambda^2\\left[\\Gamma\\!\\left(1+\\tfrac{2}{k}\\right) - \\Gamma^2\\!\\left(1+\\tfrac{1}{k}\\right)\\right]',
    },
  });

  list.push({
    id: 'cauchy',
    name: 'Cauchy',
    type: 'continuous',
    notation: 'X ~ Cauchy(x₀, γ)',
    notationTex: 'X \\sim \\operatorname{Cauchy}(x_0,\\ \\gamma)',
    params: [
      P('x0', 'x₀', 'x_0', 0, { slider: [-10, 10], hint: 'Localización' }),
      P('gamma', 'γ', '\\gamma', 1, { min: 0, minEx: true, slider: [0.1, 5], hint: 'Escala' }),
    ],
    support: () => [-INF, INF],
    pdf: (x, p) => {
      const z = (x - p.x0) / p.gamma;
      return 1 / (Math.PI * p.gamma * (1 + z * z));
    },
    cdf: (x, p) => {
      const z = (x - p.x0) / p.gamma;
      return z < 0 ? Math.atan(-1 / z) / Math.PI : 0.5 + Math.atan(z) / Math.PI;
    },
    sf: (x, p) => {
      const z = (x - p.x0) / p.gamma;
      return z > 0 ? Math.atan(1 / z) / Math.PI : 0.5 - Math.atan(z) / Math.PI;
    },
    quantile: (q, p) => (q < 0.5 ? p.x0 - p.gamma / Math.tan(Math.PI * q) : p.x0 + p.gamma / Math.tan(Math.PI * (1 - q))),
    isf: (q, p) => (q < 0.5 ? p.x0 + p.gamma / Math.tan(Math.PI * q) : p.x0 - p.gamma / Math.tan(Math.PI * (1 - q))),
    mean: () => NaN,
    variance: () => NaN,
    skewness: () => NaN,
    kurtosis: () => NaN,
    median: (p) => p.x0,
    mode: (p) => p.x0,
    rangeProb: 0.02,
    description: 'Distribución simétrica con colas tan pesadas que no tiene media ni varianza definidas. Es el cociente de dos normales estándar independientes.',
    uses: ['Resonancia en física (distribución de Lorentz)', 'Ejemplo clásico donde falla la ley de los grandes números'],
    tex: {
      support: 'x \\in (-\\infty,\\ \\infty)',
      params: 'x_0 \\in \\mathbb{R},\\quad \\gamma > 0',
      pdf: 'f(x) = \\dfrac{1}{\\pi\\gamma\\left[1+\\left(\\frac{x-x_0}{\\gamma}\\right)^2\\right]}',
      cdf: 'F(x) = \\dfrac{1}{2} + \\dfrac{1}{\\pi}\\arctan\\!\\left(\\dfrac{x-x_0}{\\gamma}\\right)',
      mean: 'E[X]\\ \\text{no está definida}',
      variance: '\\operatorname{Var}(X)\\ \\text{no está definida}',
    },
  });

  list.push({
    id: 'logistic',
    name: 'Logística',
    type: 'continuous',
    notation: 'X ~ Logística(μ, s)',
    notationTex: 'X \\sim \\operatorname{Logistic}(\\mu,\\ s)',
    params: [
      P('mu', 'μ', '\\mu', 0, { slider: [-10, 10], hint: 'Localización' }),
      P('s', 's', 's', 1, { min: 0, minEx: true, slider: [0.1, 5], hint: 'Escala' }),
    ],
    support: () => [-INF, INF],
    pdf: (x, p) => {
      const e = Math.exp(-Math.abs((x - p.mu) / p.s));
      return e / (p.s * (1 + e) * (1 + e));
    },
    cdf: (x, p) => 1 / (1 + Math.exp(-(x - p.mu) / p.s)),
    sf: (x, p) => 1 / (1 + Math.exp((x - p.mu) / p.s)),
    quantile: (q, p) => p.mu + p.s * (Math.log(q) - Math.log1p(-q)),
    isf: (q, p) => p.mu - p.s * (Math.log(q) - Math.log1p(-q)),
    mean: (p) => p.mu,
    variance: (p) => (p.s * p.s * Math.PI * Math.PI) / 3,
    skewness: () => 0,
    kurtosis: () => 1.2,
    median: (p) => p.mu,
    mode: (p) => p.mu,
    description: 'Parecida a la normal pero con colas algo más pesadas. Su función de distribución es la curva logística (sigmoide).',
    uses: ['Regresión logística', 'Modelos de crecimiento', 'Sistema de puntuación Elo'],
    tex: {
      support: 'x \\in (-\\infty,\\ \\infty)',
      params: '\\mu \\in \\mathbb{R},\\quad s > 0',
      pdf: 'f(x) = \\dfrac{e^{-(x-\\mu)/s}}{s\\left(1+e^{-(x-\\mu)/s}\\right)^2}',
      cdf: 'F(x) = \\dfrac{1}{1+e^{-(x-\\mu)/s}}',
      mean: 'E[X] = \\mu',
      variance: '\\operatorname{Var}(X) = \\dfrac{s^2\\pi^2}{3}',
    },
  });

  list.push({
    id: 'laplace',
    name: 'Laplace',
    type: 'continuous',
    notation: 'X ~ Laplace(μ, b)',
    notationTex: 'X \\sim \\operatorname{Laplace}(\\mu,\\ b)',
    params: [
      P('mu', 'μ', '\\mu', 0, { slider: [-10, 10], hint: 'Localización' }),
      P('b', 'b', 'b', 1, { min: 0, minEx: true, slider: [0.1, 5], hint: 'Escala' }),
    ],
    support: () => [-INF, INF],
    pdf: (x, p) => Math.exp(-Math.abs(x - p.mu) / p.b) / (2 * p.b),
    cdf: (x, p) => (x < p.mu ? 0.5 * Math.exp((x - p.mu) / p.b) : 1 - 0.5 * Math.exp(-(x - p.mu) / p.b)),
    sf: (x, p) => (x > p.mu ? 0.5 * Math.exp(-(x - p.mu) / p.b) : 1 - 0.5 * Math.exp((x - p.mu) / p.b)),
    quantile: (q, p) => (q < 0.5 ? p.mu + p.b * Math.log(2 * q) : p.mu - p.b * Math.log(2 * (1 - q))),
    isf: (q, p) => (q < 0.5 ? p.mu - p.b * Math.log(2 * q) : p.mu + p.b * Math.log(2 * (1 - q))),
    mean: (p) => p.mu,
    variance: (p) => 2 * p.b * p.b,
    skewness: () => 0,
    kurtosis: () => 3,
    median: (p) => p.mu,
    mode: (p) => p.mu,
    description: 'También llamada doble exponencial: dos exponenciales espalda con espalda. Tiene un pico agudo en μ.',
    uses: ['Diferencia de dos exponenciales', 'Privacidad diferencial', 'Regresión robusta (LAD)'],
    tex: {
      support: 'x \\in (-\\infty,\\ \\infty)',
      params: '\\mu \\in \\mathbb{R},\\quad b > 0',
      pdf: 'f(x) = \\dfrac{1}{2b}\\, e^{-\\frac{|x-\\mu|}{b}}',
      cdf: 'F(x) = \\begin{cases} \\frac{1}{2} e^{(x-\\mu)/b} & x < \\mu \\\\ 1 - \\frac{1}{2} e^{-(x-\\mu)/b} & x \\ge \\mu \\end{cases}',
      mean: 'E[X] = \\mu',
      variance: '\\operatorname{Var}(X) = 2b^2',
    },
  });

  list.push({
    id: 'pareto',
    name: 'Pareto',
    type: 'continuous',
    notation: 'X ~ Pareto(xₘ, α)',
    notationTex: 'X \\sim \\operatorname{Pareto}(x_m,\\ \\alpha)',
    params: [
      P('xm', 'xₘ', 'x_m', 1, { min: 0, minEx: true, slider: [0.1, 10], hint: 'Escala (mínimo)' }),
      P('alpha', 'α', '\\alpha', 3, { min: 0, minEx: true, slider: [0.2, 10], hint: 'Forma' }),
    ],
    support: (p) => [p.xm, INF],
    pdf: (x, p) => (x < p.xm ? 0 : (p.alpha / x) * Math.pow(p.xm / x, p.alpha)),
    cdf: (x, p) => (x <= p.xm ? 0 : -Math.expm1(p.alpha * Math.log(p.xm / x))),
    sf: (x, p) => (x <= p.xm ? 1 : Math.pow(p.xm / x, p.alpha)),
    quantile: (q, p) => p.xm * Math.exp(-Math.log1p(-q) / p.alpha),
    isf: (q, p) => p.xm * Math.pow(q, -1 / p.alpha),
    mean: (p) => (p.alpha > 1 ? (p.alpha * p.xm) / (p.alpha - 1) : INF),
    variance: (p) => (p.alpha > 2 ? (p.xm * p.xm * p.alpha) / ((p.alpha - 1) ** 2 * (p.alpha - 2)) : INF),
    skewness: (p) => (p.alpha > 3 ? ((2 * (1 + p.alpha)) / (p.alpha - 3)) * Math.sqrt((p.alpha - 2) / p.alpha) : NaN),
    kurtosis: (p) => {
      const a = p.alpha;
      return a > 4 ? (6 * (a ** 3 + a ** 2 - 6 * a - 2)) / (a * (a - 3) * (a - 4)) : NaN;
    },
    median: (p) => p.xm * Math.pow(2, 1 / p.alpha),
    mode: (p) => p.xm,
    rangeProb: 0.01,
    description: 'Distribución de "ley de potencia": unos pocos valores muy grandes concentran gran parte del total (principio 80/20).',
    uses: ['Distribución de la riqueza', 'Tamaño de ciudades y archivos', 'Pérdidas extremas en seguros'],
    tex: {
      support: 'x \\in [x_m,\\ \\infty)',
      params: 'x_m > 0,\\quad \\alpha > 0',
      pdf: 'f(x) = \\dfrac{\\alpha\\, x_m^{\\alpha}}{x^{\\alpha+1}}',
      cdf: 'F(x) = 1 - \\left(\\dfrac{x_m}{x}\\right)^{\\alpha}',
      mean: 'E[X] = \\dfrac{\\alpha x_m}{\\alpha-1} \\quad (\\alpha > 1)',
      variance: '\\operatorname{Var}(X) = \\dfrac{x_m^2\\,\\alpha}{(\\alpha-1)^2(\\alpha-2)} \\quad (\\alpha > 2)',
    },
  });

  list.push({
    id: 'triangular',
    name: 'Triangular',
    type: 'continuous',
    notation: 'X ~ Tri(a, c, b)',
    notationTex: 'X \\sim \\operatorname{Tri}(a,\\ c,\\ b)',
    params: [
      P('a', 'a (mín)', 'a', 0, { slider: [-10, 10], hint: 'Mínimo' }),
      P('c', 'c (moda)', 'c', 3, { slider: [-10, 15], hint: 'Valor más probable' }),
      P('b', 'b (máx)', 'b', 10, { slider: [-10, 20], hint: 'Máximo' }),
    ],
    validate: (p) => (p.a < p.b && p.a <= p.c && p.c <= p.b ? null : 'Se requiere a ≤ c ≤ b y a < b'),
    support: (p) => [p.a, p.b],
    pdf: (x, p) => {
      const { a, b, c } = p;
      if (x < a || x > b) return 0;
      if (x < c) return (2 * (x - a)) / ((b - a) * (c - a));
      if (x === c) return 2 / (b - a);
      return (2 * (b - x)) / ((b - a) * (b - c));
    },
    cdf: (x, p) => {
      const { a, b, c } = p;
      if (x <= a) return 0;
      if (x >= b) return 1;
      if (x <= c) return (x - a) ** 2 / ((b - a) * (c - a));
      return 1 - (b - x) ** 2 / ((b - a) * (b - c));
    },
    sf: (x, p) => {
      const { a, b, c } = p;
      if (x <= a) return 1;
      if (x >= b) return 0;
      if (x <= c) return 1 - (x - a) ** 2 / ((b - a) * (c - a));
      return (b - x) ** 2 / ((b - a) * (b - c));
    },
    quantile: (q, p) => {
      const { a, b, c } = p;
      const fc = (c - a) / (b - a);
      return q < fc ? a + Math.sqrt(q * (b - a) * (c - a)) : b - Math.sqrt((1 - q) * (b - a) * (b - c));
    },
    isf: (q, p) => {
      const { a, b, c } = p;
      const fc = (b - c) / (b - a); // P(X > c)
      return q <= fc ? b - Math.sqrt(q * (b - a) * (b - c)) : a + Math.sqrt((1 - q) * (b - a) * (c - a));
    },
    mean: (p) => (p.a + p.b + p.c) / 3,
    variance: (p) => {
      const { a, b, c } = p;
      return (a * a + b * b + c * c - a * b - a * c - b * c) / 18;
    },
    skewness: (p) => {
      const { a, b, c } = p;
      const den = 5 * Math.pow(a * a + b * b + c * c - a * b - a * c - b * c, 1.5);
      return (Math.SQRT2 * (a + b - 2 * c) * (2 * a - b - c) * (a - 2 * b + c)) / den;
    },
    kurtosis: () => -3 / 5,
    mode: (p) => p.c,
    description: 'Se define con un mínimo, un máximo y un valor más probable. Útil cuando hay pocos datos pero se conocen esos tres valores.',
    uses: ['Estimación de tiempos y costos de proyectos', 'Simulación de Monte Carlo', 'Análisis de riesgos'],
    tex: {
      support: 'x \\in [a,\\ b]',
      params: 'a \\le c \\le b,\\quad a < b',
      pdf: 'f(x) = \\begin{cases} \\dfrac{2(x-a)}{(b-a)(c-a)} & a \\le x < c \\\\[2mm] \\dfrac{2(b-x)}{(b-a)(b-c)} & c \\le x \\le b \\end{cases}',
      cdf: 'F(x) = \\begin{cases} \\dfrac{(x-a)^2}{(b-a)(c-a)} & a \\le x \\le c \\\\[2mm] 1-\\dfrac{(b-x)^2}{(b-a)(b-c)} & c < x \\le b \\end{cases}',
      mean: 'E[X] = \\dfrac{a+b+c}{3}',
      variance: '\\operatorname{Var}(X) = \\dfrac{a^2+b^2+c^2-ab-ac-bc}{18}',
    },
  });

  /* ================================================================== */
  /* DISTRIBUCIONES DISCRETAS                                            */
  /* ================================================================== */

  list.push({
    id: 'binomial',
    name: 'Binomial',
    type: 'discrete',
    notation: 'X ~ Bin(n, p)',
    notationTex: 'X \\sim \\operatorname{Bin}(n,\\ p)',
    params: [
      P('n', 'n', 'n', 20, { min: 0, integer: true, step: 1, slider: [1, 200], hint: 'Número de ensayos' }),
      P('p', 'p', 'p', 0.5, { min: 0, max: 1, step: 0.01, slider: [0, 1], hint: 'Probabilidad de éxito' }),
    ],
    support: (p) => [0, p.n],
    pmf: (k, p) => (k < 0 || k > p.n ? 0 : dbinomRaw(k, p.n, p.p, 1 - p.p)),
    cdf: (k, p) => {
      if (k < 0) return 0;
      if (k >= p.n) return 1;
      return betaIncBoth(1 - p.p, p.n - k, k + 1, p.p)[0];
    },
    sf: (k, p) => {
      if (k < 0) return 1;
      if (k >= p.n) return 0;
      return betaIncBoth(1 - p.p, p.n - k, k + 1, p.p)[1];
    },
    mean: (p) => p.n * p.p,
    variance: (p) => p.n * p.p * (1 - p.p),
    skewness: (p) => (1 - 2 * p.p) / Math.sqrt(p.n * p.p * (1 - p.p)),
    kurtosis: (p) => (1 - 6 * p.p * (1 - p.p)) / (p.n * p.p * (1 - p.p)),
    mode: (p) => {
      const m = (p.n + 1) * p.p;
      if (p.p === 1) return p.n;
      if (isInt(m) && m > 0) return [m - 1, m];
      return Math.floor(m);
    },
    description: 'Cuenta el número de éxitos en n ensayos independientes de Bernoulli, cada uno con la misma probabilidad de éxito p.',
    uses: ['Número de piezas defectuosas en un lote', 'Respuestas correctas al azar en un examen', 'Pacientes que responden a un tratamiento'],
    tex: {
      support: 'x \\in \\{0, 1, \\dots, n\\}',
      params: 'n \\in \\mathbb{N},\\quad 0 \\le p \\le 1',
      pmf: 'P(X = x) = \\binom{n}{x} p^{x} (1-p)^{n-x}',
      cdf: 'F(x) = \\sum_{i=0}^{\\lfloor x \\rfloor} \\binom{n}{i} p^{i} (1-p)^{n-i} = I_{1-p}(n-x,\\ x+1)',
      mean: 'E[X] = np',
      variance: '\\operatorname{Var}(X) = np(1-p)',
      mgf: 'M_X(t) = \\left(1-p+pe^{t}\\right)^{n}',
    },
  });

  list.push({
    id: 'poisson',
    name: 'Poisson',
    type: 'discrete',
    notation: 'X ~ Poisson(λ)',
    notationTex: 'X \\sim \\operatorname{Poisson}(\\lambda)',
    params: [
      P('lambda', 'λ', '\\lambda', 4, { min: 0, minEx: true, slider: [0.1, 50], hint: 'Tasa media de ocurrencias' }),
    ],
    support: () => [0, INF],
    pmf: (k, p) => (k < 0 ? 0 : dpoisRaw(k, p.lambda)),
    cdf: (k, p) => (k < 0 ? 0 : gammaIncBoth(k + 1, p.lambda)[1]),
    sf: (k, p) => (k < 0 ? 1 : gammaIncBoth(k + 1, p.lambda)[0]),
    mean: (p) => p.lambda,
    variance: (p) => p.lambda,
    skewness: (p) => 1 / Math.sqrt(p.lambda),
    kurtosis: (p) => 1 / p.lambda,
    mode: (p) => (isInt(p.lambda) ? [p.lambda - 1, p.lambda] : Math.floor(p.lambda)),
    description: 'Cuenta el número de eventos que ocurren en un intervalo fijo de tiempo o espacio, cuando ocurren de forma independiente a una tasa media constante λ.',
    uses: ['Llamadas que llegan a un centro de atención por hora', 'Defectos por metro de tela', 'Accidentes en una intersección por mes'],
    tex: {
      support: 'x \\in \\{0, 1, 2, \\dots\\}',
      params: '\\lambda > 0',
      pmf: 'P(X = x) = \\dfrac{e^{-\\lambda}\\,\\lambda^{x}}{x!}',
      cdf: 'F(x) = e^{-\\lambda}\\sum_{i=0}^{\\lfloor x\\rfloor} \\dfrac{\\lambda^{i}}{i!} = Q(\\lfloor x\\rfloor+1,\\ \\lambda)',
      mean: 'E[X] = \\lambda',
      variance: '\\operatorname{Var}(X) = \\lambda',
      mgf: 'M_X(t) = e^{\\lambda\\left(e^{t}-1\\right)}',
    },
  });

  const VARIANT_GEOM = P('variant', 'Variable', '', 'trials', {
    type: 'select',
    options: [
      { value: 'trials', label: 'Nº de ensayos hasta el éxito' },
      { value: 'failures', label: 'Nº de fracasos antes del éxito' },
    ],
  });

  list.push({
    id: 'geometric',
    name: 'Geométrica',
    type: 'discrete',
    notation: 'X ~ Geom(p)',
    notationTex: 'X \\sim \\operatorname{Geom}(p)',
    params: [
      P('p', 'p', 'p', 0.3, { min: 0, minEx: true, max: 1, step: 0.01, slider: [0.01, 1], hint: 'Probabilidad de éxito' }),
      VARIANT_GEOM,
    ],
    support: (p) => [p.variant === 'trials' ? 1 : 0, INF],
    pmf: (k, p) => {
      const j = k - (p.variant === 'trials' ? 1 : 0);
      if (j < 0) return 0;
      if (p.p === 1) return j === 0 ? 1 : 0;
      return p.p * Math.exp(j * Math.log1p(-p.p));
    },
    cdf: (k, p) => {
      const j = k - (p.variant === 'trials' ? 1 : 0);
      if (j < 0) return 0;
      if (p.p === 1) return 1;
      return -Math.expm1((j + 1) * Math.log1p(-p.p));
    },
    sf: (k, p) => {
      const j = k - (p.variant === 'trials' ? 1 : 0);
      if (j < 0) return 1;
      if (p.p === 1) return 0;
      return Math.exp((j + 1) * Math.log1p(-p.p));
    },
    mean: (p) => (1 - p.p) / p.p + (p.variant === 'trials' ? 1 : 0),
    variance: (p) => (1 - p.p) / (p.p * p.p),
    skewness: (p) => (2 - p.p) / Math.sqrt(1 - p.p),
    kurtosis: (p) => 6 + (p.p * p.p) / (1 - p.p),
    mode: (p) => (p.variant === 'trials' ? 1 : 0),
    description: 'Modela cuántos ensayos de Bernoulli independientes se necesitan hasta obtener el primer éxito (o cuántos fracasos ocurren antes). Es la versión discreta de la exponencial: no tiene memoria.',
    uses: ['Intentos hasta encestar un tiro', 'Llamadas hasta lograr una venta', 'Lanzamientos hasta obtener un 6'],
    tex: {
      support: 'x \\in \\{1, 2, 3, \\dots\\}\\ \\text{(ensayos)} \\quad\\text{ó}\\quad x \\in \\{0, 1, 2, \\dots\\}\\ \\text{(fracasos)}',
      params: '0 < p \\le 1',
      pmf: 'P(X = x) = (1-p)^{x-1}\\,p \\quad\\text{(ensayos)}\\qquad P(X = x) = (1-p)^{x}\\,p \\quad\\text{(fracasos)}',
      cdf: 'F(x) = 1-(1-p)^{x} \\quad\\text{(ensayos)}\\qquad F(x) = 1-(1-p)^{x+1}\\quad\\text{(fracasos)}',
      mean: 'E[X] = \\dfrac{1}{p}\\ \\text{(ensayos)} \\qquad E[X] = \\dfrac{1-p}{p}\\ \\text{(fracasos)}',
      variance: '\\operatorname{Var}(X) = \\dfrac{1-p}{p^2}',
    },
  });

  list.push({
    id: 'negbinomial',
    name: 'Binomial negativa',
    type: 'discrete',
    notation: 'X ~ BN(r, p)',
    notationTex: 'X \\sim \\operatorname{BN}(r,\\ p)',
    params: [
      P('r', 'r', 'r', 3, { min: 1, integer: true, step: 1, slider: [1, 50], hint: 'Número de éxitos buscados' }),
      P('p', 'p', 'p', 0.4, { min: 0, minEx: true, max: 1, step: 0.01, slider: [0.01, 1], hint: 'Probabilidad de éxito' }),
      P('variant', 'Variable', '', 'trials', {
        type: 'select',
        options: [
          { value: 'trials', label: 'Nº de ensayos hasta el r-ésimo éxito' },
          { value: 'failures', label: 'Nº de fracasos antes del r-ésimo éxito' },
        ],
      }),
    ],
    support: (p) => [p.variant === 'trials' ? p.r : 0, INF],
    pmf: (k, p) => {
      const j = k - (p.variant === 'trials' ? p.r : 0);
      if (j < 0) return 0;
      if (p.p === 1) return j === 0 ? 1 : 0;
      return (p.r / (p.r + j)) * dbinomRaw(p.r, p.r + j, p.p, 1 - p.p);
    },
    cdf: (k, p) => {
      const j = k - (p.variant === 'trials' ? p.r : 0);
      if (j < 0) return 0;
      return betaIncBoth(p.p, p.r, j + 1, 1 - p.p)[0];
    },
    sf: (k, p) => {
      const j = k - (p.variant === 'trials' ? p.r : 0);
      if (j < 0) return 1;
      return betaIncBoth(p.p, p.r, j + 1, 1 - p.p)[1];
    },
    mean: (p) => (p.r * (1 - p.p)) / p.p + (p.variant === 'trials' ? p.r : 0),
    variance: (p) => (p.r * (1 - p.p)) / (p.p * p.p),
    skewness: (p) => (2 - p.p) / Math.sqrt(p.r * (1 - p.p)),
    kurtosis: (p) => 6 / p.r + (p.p * p.p) / (p.r * (1 - p.p)),
    mode: (p) => {
      const shift = p.variant === 'trials' ? p.r : 0;
      if (p.r <= 1) return shift;
      const m = ((p.r - 1) * (1 - p.p)) / p.p;
      if (isInt(m) && m > 0) return [m - 1 + shift, m + shift];
      return Math.floor(m) + shift;
    },
    description: 'Generaliza a la geométrica: cuenta los ensayos necesarios para obtener r éxitos (o los fracasos antes del r-ésimo éxito).',
    uses: ['Número de clientes a visitar para cerrar r ventas', 'Conteos con sobre-dispersión', 'Control de calidad secuencial'],
    tex: {
      support: 'x \\in \\{r, r+1, \\dots\\}\\ \\text{(ensayos)}',
      params: 'r \\in \\{1,2,\\dots\\},\\quad 0 < p \\le 1',
      pmf: 'P(X = x) = \\binom{x-1}{r-1} p^{r} (1-p)^{x-r}\\ \\text{(ensayos)} \\qquad P(X=x)=\\binom{x+r-1}{x}p^r(1-p)^x\\ \\text{(fracasos)}',
      cdf: 'F(x) = I_{p}(r,\\ x-r+1)\\ \\text{(ensayos)}',
      mean: 'E[X] = \\dfrac{r}{p}\\ \\text{(ensayos)} \\qquad E[X] = \\dfrac{r(1-p)}{p}\\ \\text{(fracasos)}',
      variance: '\\operatorname{Var}(X) = \\dfrac{r(1-p)}{p^2}',
    },
  });

  function hyperPmf(k, p) {
    const { N, K, n } = p;
    const lo = Math.max(0, n + K - N), hi = Math.min(n, K);
    if (k < lo || k > hi) return 0;
    const pp = n / N, q = (N - n) / N;
    const p1 = dbinomRaw(k, K, pp, q);
    const p2 = dbinomRaw(n - k, N - K, pp, q);
    const p3 = dbinomRaw(n, N, pp, q);
    return (p1 * p2) / p3;
  }
  // Suma acumulada mediante recurrencia (como R::pdhyper)
  function hyperLowerSum(k, p) {
    // P(X ≤ k) = pmf(k) · Σ_{j≤k} pmf(j)/pmf(k)
    const { N, K, n } = p;
    const lo = Math.max(0, n + K - N);
    let sum = 0, term = 1;
    for (let j = k; j > lo; j--) {
      term *= (j * (N - K - n + j)) / ((K - j + 1) * (n - j + 1));
      sum += term;
      if (term < sum * 1e-17) break;
    }
    return hyperPmf(k, p) * (1 + sum);
  }
  function hyperUpperSum(k, p) {
    // P(X > k) = Σ_{j>k} pmf(j)
    const { N, K, n } = p;
    const hi = Math.min(n, K);
    const start = k + 1;
    if (start > hi) return 0;
    let sum = 0, term = 1;
    for (let j = start; j < hi; j++) {
      term *= ((K - j) * (n - j)) / ((j + 1) * (N - K - n + j + 1));
      sum += term;
      if (term < sum * 1e-17) break;
    }
    return hyperPmf(start, p) * (1 + sum);
  }

  list.push({
    id: 'hypergeometric',
    name: 'Hipergeométrica',
    type: 'discrete',
    notation: 'X ~ H(N, K, n)',
    notationTex: 'X \\sim H(N,\\ K,\\ n)',
    params: [
      P('N', 'N', 'N', 50, { min: 1, integer: true, step: 1, slider: [1, 500], hint: 'Tamaño de la población' }),
      P('K', 'K', 'K', 15, { min: 0, integer: true, step: 1, slider: [0, 500], hint: 'Éxitos en la población' }),
      P('n', 'n', 'n', 10, { min: 0, integer: true, step: 1, slider: [0, 500], hint: 'Tamaño de la muestra' }),
    ],
    validate: (p) => {
      if (p.K > p.N) return 'Se requiere K ≤ N';
      if (p.n > p.N) return 'Se requiere n ≤ N';
      return null;
    },
    support: (p) => [Math.max(0, p.n + p.K - p.N), Math.min(p.n, p.K)],
    pmf: (k, p) => hyperPmf(k, p),
    cdf: (k, p) => {
      const [lo, hi] = [Math.max(0, p.n + p.K - p.N), Math.min(p.n, p.K)];
      if (k < lo) return 0;
      if (k >= hi) return 1;
      const mean = (p.n * p.K) / p.N;
      return k < mean ? hyperLowerSum(k, p) : 1 - hyperUpperSum(k, p);
    },
    sf: (k, p) => {
      const [lo, hi] = [Math.max(0, p.n + p.K - p.N), Math.min(p.n, p.K)];
      if (k < lo) return 1;
      if (k >= hi) return 0;
      const mean = (p.n * p.K) / p.N;
      return k < mean ? 1 - hyperLowerSum(k, p) : hyperUpperSum(k, p);
    },
    mean: (p) => (p.n * p.K) / p.N,
    variance: (p) => {
      const { N, K, n } = p;
      return N > 1 ? (n * K * (N - K) * (N - n)) / (N * N * (N - 1)) : 0;
    },
    skewness: (p) => {
      const { N, K, n } = p;
      if (N <= 2) return NaN;
      return ((N - 2 * K) * Math.sqrt(N - 1) * (N - 2 * n)) / (Math.sqrt(n * K * (N - K) * (N - n)) * (N - 2));
    },
    kurtosis: (p) => {
      const { N, K, n } = p;
      if (N <= 3) return NaN;
      const num = (N - 1) * N * N * (N * (N + 1) - 6 * K * (N - K) - 6 * n * (N - n)) +
        6 * n * K * (N - K) * (N - n) * (5 * N - 6);
      return num / (n * K * (N - K) * (N - n) * (N - 2) * (N - 3));
    },
    mode: (p) => Math.floor(((p.n + 1) * (p.K + 1)) / (p.N + 2)),
    description: 'Cuenta los éxitos al extraer n elementos SIN reemplazo de una población de N elementos que contiene K éxitos.',
    uses: ['Control de calidad por muestreo de lotes', 'Probabilidades en juegos de cartas y loterías', 'Estimación captura-recaptura'],
    tex: {
      support: 'x \\in \\{\\max(0,\\,n+K-N), \\dots, \\min(n,\\,K)\\}',
      params: 'N \\in \\mathbb{N},\\quad 0 \\le K \\le N,\\quad 0 \\le n \\le N',
      pmf: 'P(X = x) = \\dfrac{\\dbinom{K}{x}\\dbinom{N-K}{n-x}}{\\dbinom{N}{n}}',
      cdf: 'F(x) = \\sum_{i \\le x} \\dfrac{\\binom{K}{i}\\binom{N-K}{n-i}}{\\binom{N}{n}}',
      mean: 'E[X] = n\\dfrac{K}{N}',
      variance: '\\operatorname{Var}(X) = n\\dfrac{K}{N}\\cdot\\dfrac{N-K}{N}\\cdot\\dfrac{N-n}{N-1}',
    },
  });

  list.push({
    id: 'duniform',
    name: 'Uniforme discreta',
    type: 'discrete',
    notation: 'X ~ U{a, b}',
    notationTex: 'X \\sim \\mathcal{U}\\{a,\\ b\\}',
    params: [
      P('a', 'a (mín)', 'a', 1, { integer: true, step: 1, slider: [-20, 20], hint: 'Valor mínimo' }),
      P('b', 'b (máx)', 'b', 6, { integer: true, step: 1, slider: [-20, 50], hint: 'Valor máximo' }),
    ],
    validate: (p) => (p.a <= p.b ? null : 'Se requiere a ≤ b'),
    support: (p) => [p.a, p.b],
    pmf: (k, p) => (k < p.a || k > p.b ? 0 : 1 / (p.b - p.a + 1)),
    cdf: (k, p) => (k < p.a ? 0 : k >= p.b ? 1 : (k - p.a + 1) / (p.b - p.a + 1)),
    sf: (k, p) => (k < p.a ? 1 : k >= p.b ? 0 : (p.b - k) / (p.b - p.a + 1)),
    mean: (p) => (p.a + p.b) / 2,
    variance: (p) => ((p.b - p.a + 1) ** 2 - 1) / 12,
    skewness: () => 0,
    kurtosis: (p) => {
      const n = p.b - p.a + 1;
      return n > 1 ? (-6 * (n * n + 1)) / (5 * (n * n - 1)) : NaN;
    },
    mode: () => 'Todos los valores de a a b',
    description: 'Cada uno de los enteros entre a y b tiene la misma probabilidad.',
    uses: ['Lanzamiento de un dado justo', 'Selección aleatoria de un elemento', 'Último dígito de un número al azar'],
    tex: {
      support: 'x \\in \\{a, a+1, \\dots, b\\}',
      params: 'a, b \\in \\mathbb{Z},\\quad a \\le b,\\quad n = b-a+1',
      pmf: 'P(X = x) = \\dfrac{1}{n}',
      cdf: 'F(x) = \\dfrac{\\lfloor x \\rfloor - a + 1}{n}',
      mean: 'E[X] = \\dfrac{a+b}{2}',
      variance: '\\operatorname{Var}(X) = \\dfrac{n^2-1}{12}',
    },
  });

  list.push({
    id: 'bernoulli',
    name: 'Bernoulli',
    type: 'discrete',
    notation: 'X ~ Bernoulli(p)',
    notationTex: 'X \\sim \\operatorname{Bernoulli}(p)',
    params: [
      P('p', 'p', 'p', 0.3, { min: 0, max: 1, step: 0.01, slider: [0, 1], hint: 'Probabilidad de éxito' }),
    ],
    support: () => [0, 1],
    pmf: (k, p) => (k === 0 ? 1 - p.p : k === 1 ? p.p : 0),
    cdf: (k, p) => (k < 0 ? 0 : k < 1 ? 1 - p.p : 1),
    sf: (k, p) => (k < 0 ? 1 : k < 1 ? p.p : 0),
    mean: (p) => p.p,
    variance: (p) => p.p * (1 - p.p),
    skewness: (p) => (1 - 2 * p.p) / Math.sqrt(p.p * (1 - p.p)),
    kurtosis: (p) => (1 - 6 * p.p * (1 - p.p)) / (p.p * (1 - p.p)),
    mode: (p) => (p.p > 0.5 ? 1 : p.p < 0.5 ? 0 : [0, 1]),
    description: 'Un único ensayo con dos resultados posibles: éxito (1) con probabilidad p o fracaso (0) con probabilidad 1 − p.',
    uses: ['Lanzar una moneda', 'Un producto es defectuoso o no', 'Bloque básico de la binomial'],
    tex: {
      support: 'x \\in \\{0, 1\\}',
      params: '0 \\le p \\le 1',
      pmf: 'P(X = x) = p^{x}(1-p)^{1-x}',
      cdf: 'F(x) = \\begin{cases} 0 & x < 0 \\\\ 1-p & 0 \\le x < 1 \\\\ 1 & x \\ge 1 \\end{cases}',
      mean: 'E[X] = p',
      variance: '\\operatorname{Var}(X) = p(1-p)',
      mgf: 'M_X(t) = 1-p+pe^{t}',
    },
  });

  /* ================================================================== */
  /* UTILIDADES GENÉRICAS                                                */
  /* ================================================================== */
  const byId = {};
  list.forEach((d) => (byId[d.id] = d));

  function defaults(d) {
    const o = {};
    d.params.forEach((p) => (o[p.key] = p.def));
    return o;
  }

  function validate(d, prm) {
    for (const p of d.params) {
      if (p.type === 'select') continue;
      const v = prm[p.key];
      if (typeof v !== 'number' || !isFinite(v)) return `${p.label}: ingresa un número válido`;
      if (p.integer && !isInt(v)) return `${p.label} debe ser un número entero`;
      if (p.minEx ? v <= p.min : v < p.min) return `${p.label} debe ser ${p.minEx ? '>' : '≥'} ${p.min}`;
      if (v > p.max) return `${p.label} debe ser ≤ ${p.max}`;
    }
    return d.validate ? d.validate(prm) : null;
  }

  const isDiscrete = (d) => d.type === 'discrete';

  /** Densidad (continuas) o masa de probabilidad (discretas). */
  function density(d, x, prm) {
    if (isDiscrete(d)) return isInt(x) ? d.pmf(x, prm) : 0;
    return d.pdf(x, prm);
  }

  // Para discretas: P(X ≤ x) con x real
  const cdfAt = (d, x, prm) => (isDiscrete(d) ? d.cdf(Math.floor(x), prm) : d.cdf(x, prm));
  const sfAt = (d, x, prm) => (isDiscrete(d) ? d.sf(Math.floor(x), prm) : d.sf(x, prm));

  // P(X < x)  y  P(X ≥ x)
  function cdfStrict(d, x, prm) {
    if (!isDiscrete(d)) return d.cdf(x, prm);
    return d.cdf(Math.ceil(x) - 1, prm);
  }
  function sfInclusive(d, x, prm) {
    if (!isDiscrete(d)) return d.sf(x, prm);
    return d.sf(Math.ceil(x) - 1, prm);
  }

  /** P(X op x), op ∈ {'<','<=','>','>='} */
  function probOp(d, prm, op, x) {
    switch (op) {
      case '<': return cdfStrict(d, x, prm);
      case '<=': return cdfAt(d, x, prm);
      case '>': return sfAt(d, x, prm);
      case '>=': return sfInclusive(d, x, prm);
    }
    return NaN;
  }

  /**
   * P(x1 op1 X op2 x2), op1 ∈ {'<','<='}, op2 ∈ {'<','<='}.
   * Se calcula con F o con S según qué cola sea más pequeña (máxima precisión).
   */
  function probBetween(d, prm, x1, x2, op1 = '<=', op2 = '<=') {
    if (x2 < x1) return 0;
    // Con F: P(X op2 x2) − P(X ¬op1 x1)
    const Fu = op2 === '<=' ? cdfAt(d, x2, prm) : cdfStrict(d, x2, prm);
    const Fl = op1 === '<=' ? cdfStrict(d, x1, prm) : cdfAt(d, x1, prm);
    // Con S: P(X ≥/> x1) − P(X >/≥ x2)
    const Sl = op1 === '<=' ? sfInclusive(d, x1, prm) : sfAt(d, x1, prm);
    const Su = op2 === '<=' ? sfAt(d, x2, prm) : sfInclusive(d, x2, prm);
    const r = Fl > 0.5 ? Sl - Su : Fu - Fl;
    return Math.max(0, Math.min(1, r));
  }

  /* ----------------------------- cuantiles ----------------------------- */
  function moments(d, prm) {
    const m = d.mean(prm), v = d.variance(prm);
    return { mean: m, sd: Math.sqrt(v) };
  }

  function bracketContinuous(d, prm, f) {
    // f creciente con raíz; devuelve [lo, hi] tal que f(lo) ≤ 0 ≤ f(hi)
    const [sLo, sHi] = d.support(prm);
    let { mean: c, sd: s } = moments(d, prm);
    if (!isFinite(c)) c = d.median ? d.median(prm) : isFinite(sLo) ? sLo + 1 : 0;
    if (!isFinite(s) || s <= 0) s = d.params.some((q) => q.key === 'gamma') ? prm.gamma : 1;
    let lo = c - s, hi = c + s;
    if (isFinite(sLo)) lo = Math.max(sLo, lo);
    if (isFinite(sHi)) hi = Math.min(sHi, hi);
    let step = s;
    for (let i = 0; i < 2000 && f(lo) > 0; i++) {
      lo -= step; step *= 2;
      if (isFinite(sLo) && lo <= sLo) { lo = sLo; break; }
    }
    step = s;
    for (let i = 0; i < 2000 && f(hi) < 0; i++) {
      hi += step; step *= 2;
      if (isFinite(sHi) && hi >= sHi) { hi = sHi; break; }
    }
    return [lo, hi];
  }

  /** x tal que P(X ≤ x) = p (discretas: menor k con P(X ≤ k) ≥ p). */
  function quantile(d, prm, p) {
    const [sLo, sHi] = d.support(prm);
    if (!(p >= 0 && p <= 1)) return NaN;
    if (p === 0) return sLo;
    if (p === 1) return sHi;
    if (isDiscrete(d)) return discreteQuantile(d, prm, p);
    if (d.quantile) return d.quantile(p, prm);
    if (d.symmetricAt !== undefined && p > 0.5) return 2 * d.symmetricAt - quantile(d, prm, 1 - p);
    const f = p <= 0.5 ? (x) => d.cdf(x, prm) - p : (x) => (1 - p) - d.sf(x, prm);
    const [lo, hi] = bracketContinuous(d, prm, f);
    return brent(f, lo, hi, 1e-300);
  }

  /** x tal que P(X ≥ x) = q (discretas: mayor k con P(X ≥ k) ≥ q). */
  function isf(d, prm, q) {
    const [sLo, sHi] = d.support(prm);
    if (!(q >= 0 && q <= 1)) return NaN;
    if (q === 0) return sHi;
    if (q === 1) return sLo;
    if (isDiscrete(d)) return discreteIsf(d, prm, q);
    if (d.isf) return d.isf(q, prm);
    if (d.symmetricAt !== undefined) return 2 * d.symmetricAt - quantile(d, prm, q);
    if (q > 0.5) return quantile(d, prm, 1 - q);
    const f = (x) => q - d.sf(x, prm);
    const [lo, hi] = bracketContinuous(d, prm, f);
    return brent(f, lo, hi, 1e-300);
  }

  function discreteGuess(d, prm, p) {
    const [sLo, sHi] = d.support(prm);
    const { mean, sd } = moments(d, prm);
    let g = Math.round(mean + (isFinite(sd) ? sd : 1) * qnorm(Math.min(Math.max(p, 1e-12), 1 - 1e-12)));
    if (!isFinite(g)) g = sLo;
    return Math.min(Math.max(g, sLo), sHi);
  }

  function discreteQuantile(d, prm, p) {
    // menor k con F(k) ≥ p
    const [sLo, sHi] = d.support(prm);
    const target = p * (1 - 64 * S.DBL_EPS);
    const ok = (k) => d.cdf(k, prm) >= target;
    let hi = discreteGuess(d, prm, p);
    let step = 1;
    while (!ok(hi)) {
      hi = Math.min(hi + step, sHi);
      step *= 2;
      if (hi >= sHi) { hi = sHi; break; }
    }
    let lo = hi - 1;
    step = 1;
    while (lo >= sLo && ok(lo)) {
      hi = lo;
      lo -= step;
      step *= 2;
    }
    lo = Math.max(lo, sLo - 1);
    // invariante: !ok(lo) (o lo < sLo), ok(hi)
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (ok(mid)) hi = mid; else lo = mid;
    }
    return hi;
  }

  function discreteIsf(d, prm, q) {
    // mayor k con P(X ≥ k) = S(k−1) ≥ q
    const [sLo, sHi] = d.support(prm);
    const target = q * (1 - 64 * S.DBL_EPS);
    const ok = (k) => d.sf(k - 1, prm) >= target;
    let lo = discreteGuess(d, prm, 1 - q);
    let step = 1;
    while (!ok(lo)) {
      lo = Math.max(lo - step, sLo);
      step *= 2;
      if (lo <= sLo) { lo = sLo; break; }
    }
    let hi = lo + 1;
    step = 1;
    while (hi <= sHi && ok(hi)) {
      lo = hi;
      hi += step;
      step *= 2;
    }
    hi = Math.min(hi, sHi + 1);
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (ok(mid)) lo = mid; else hi = mid;
    }
    return lo;
  }

  /* --------------------------- estadísticos --------------------------- */
  function stats(d, prm) {
    const mean = d.mean(prm);
    const variance = d.variance(prm);
    return {
      mean,
      variance,
      sd: Math.sqrt(variance),
      median: d.median ? d.median(prm) : quantile(d, prm, 0.5),
      mode: d.mode ? d.mode(prm) : null,
      skewness: d.skewness ? d.skewness(prm) : NaN,
      kurtosis: d.kurtosis ? d.kurtosis(prm) : NaN,
    };
  }

  /* ------------------------- rango de graficado ------------------------ */
  function plotRange(d, prm) {
    const [sLo, sHi] = d.support(prm);
    const tail = d.rangeProb || 0.0005;
    if (isDiscrete(d)) {
      let lo = sLo, hi = sHi;
      const count = hi - lo + 1;
      if (!isFinite(count) || count > 61) {
        lo = Math.max(sLo, quantile(d, prm, tail));
        hi = Math.min(sHi, isf(d, prm, tail));
        if (hi - lo < 10) {
          const c = Math.round((lo + hi) / 2);
          lo = Math.max(sLo, c - 5);
          hi = isFinite(sHi) ? Math.min(sHi, lo + 10) : lo + 10;
        }
      }
      return [lo, hi];
    }
    let lo = isFinite(sLo) ? sLo : quantile(d, prm, tail);
    let hi = isFinite(sHi) ? sHi : isf(d, prm, tail);
    // Si el soporte es [0, ∞) o [xm, ∞) pero la masa está lejos del borde, recortar
    if (isFinite(sLo) && !isFinite(sHi)) {
      const q = quantile(d, prm, tail);
      if (q - sLo > 0.25 * (hi - sLo)) lo = q;
    }
    if (isFinite(sLo) && isFinite(sHi)) {
      const pad = (sHi - sLo) * 0.08;
      lo = sLo - pad;
      hi = sHi + pad;
    } else if (!isFinite(sLo) && !isFinite(sHi)) {
      const pad = (hi - lo) * 0.03;
      lo -= pad;
      hi += pad;
    } else {
      hi += (hi - lo) * 0.03;
    }
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    return [lo, hi];
  }

  PD.dist = {
    list, byId, defaults, validate, isDiscrete, density,
    cdfAt, sfAt, cdfStrict, sfInclusive, probOp, probBetween,
    quantile, isf, stats, plotRange,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
