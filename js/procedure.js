/*
 * procedure.js — Procedimiento paso a paso de cada cálculo.
 *
 * Para cada distribución y tipo de cálculo genera una lista de pasos con:
 *   - la fórmula general,
 *   - la sustitución de los valores del problema,
 *   - las operaciones intermedias (estandarización z, sumas de términos,
 *     regla del complemento, despeje de x en el cálculo inverso…),
 *   - el resultado y su interpretación.
 *
 * Cada paso: { title, text, math: [LaTeX…], note, table, final }
 * Los valores finales se calculan con las mismas funciones de alta
 * precisión que el resto de la aplicación (PD.dist).
 */
(function (root) {
  'use strict';
  const PD = (root.PD = root.PD || {});

  let D, S, F;          // PD.dist, PD.special, PD.fmt (se asignan en build)
  let DEC = 6;          // decimales para probabilidades

  /* ------------------------------------------------------------------ */
  /* Utilidades de formato LaTeX                                         */
  /* ------------------------------------------------------------------ */
  const N = (v, sig = 6) => F.texNum(v, sig);
  const PR = (v) => F.texProb(v, DEC);
  /** Número entre paréntesis si es negativo o está en notación científica (para usarlo como base de potencias). */
  const par = (v, sig = 6) => {
    const t = N(v, sig);
    return v < 0 || t.includes('\\times') ? `(${t})` : t;
  };
  /** " - v" o " + |v|" para escribir (x − μ) sin dobles signos. */
  const sub = (v, sig = 6) => (v < 0 ? `+ ${N(-v, sig)}` : `- ${N(v, sig)}`);
  const txt = (v, sig = 6) => F.num(v, sig);
  const ptxt = (v) => F.prob(v, DEC);
  const pct = (v) => `${(v * 100).toFixed(Math.max(2, DEC - 2))} %`;
  const OPT = { '<=': '\\le', '<': '<', '>=': '\\ge', '>': '>' };
  const OPW = { '<=': 'menor o igual que', '<': 'menor que', '>=': 'mayor o igual que', '>': 'mayor que' };
  const LN10 = Math.LN10;

  /** lhs = e₁ = e₂ = … (alineado en varias líneas si es largo). */
  function chain(lhs, exprs) {
    const ex = exprs.filter((e, i) => e !== '' && e != null && e !== exprs[i - 1]);
    if (ex.length <= 2) return `${lhs} = ${ex.join(' = ')}`;
    return `\\begin{aligned}${lhs} &= ${ex.join(' \\\\ &= ')}\\end{aligned}`;
  }

  /** Potencia base^e mostrada sin desbordar (usa log10 si hace falta). */
  function powTex(base, e) {
    if (e === 0) return '1';
    if (base === 0) return '0';
    const v = Math.pow(base, e);
    if (isFinite(v) && Math.abs(v) > 1e-300) return N(v);
    return F.texFromLog10(e * Math.log10(Math.abs(base)));
  }

  /** C(n, k) exacto si cabe en 2^53; si no, en notación científica. */
  function chooseTex(n, k) {
    if (k < 0 || k > n) return '0';
    const l = S.logChoose(n, k);
    if (l < Math.log(9e15)) {
      const kk = Math.min(k, n - k);
      let c = 1;
      for (let i = 1; i <= kk; i++) c = (c * (n - kk + i)) / i;
      return N(Math.round(c), 16);
    }
    return F.texFromLog10(l / LN10);
  }

  function factTex(k) {
    if (k <= 20) {
      let f = 1;
      for (let i = 2; i <= k; i++) f *= i;
      return N(f, 20);
    }
    return F.texFromLog10(S.lgamma(k + 1) / LN10);
  }

  function step(title, o = {}) {
    return Object.assign({ title, text: '', math: [], note: '', table: null, final: false }, o);
  }

  /* ------------------------------------------------------------------ */
  /* Distribuciones continuas                                            */
  /* ------------------------------------------------------------------ */
  /*
   * kind: 'z'       → se estandariza y se usa Φ (tabla Z)
   *       'closed'  → F(x) tiene fórmula cerrada
   *       'special' → F(x) usa funciones gamma/beta incompletas
   * evalF(x,p)  → [fórmula general, sustitución, …, valor]
   * evalS(x,p)  → igual para P(X > x) (opcional)
   * inv(prob,p,x) → despeje de x (opcional)
   */
  function gammaChain(shape, z, val, upper, gen, subst) {
    // Si la forma es entera (Erlang) se puede escribir como suma finita
    if (Number.isInteger(shape) && shape >= 1 && shape <= 10) {
      const terms = [];
      let sum = 0, t = 1;
      for (let j = 0; j < shape; j++) {
        if (j > 0) t *= z / j;
        sum += t;
        terms.push(j === 0 ? '1' : j === 1 ? N(z) : `\\dfrac{${par(z)}^{${j}}}{${j}!}`);
      }
      const e = Math.exp(-z);
      const sumTex = `\\sum_{j=0}^{${shape - 1}}\\dfrac{${par(z)}^{j}}{j!}`;
      if (upper) {
        return [gen, subst, `e^{-${N(z)}}${sumTex}`, `e^{-${N(z)}}\\left[${terms.join(' + ')}\\right]`,
          `(${N(e)})(${N(sum)})`, PR(val)];
      }
      return [gen, subst, `1 - e^{-${N(z)}}${sumTex}`, `1 - e^{-${N(z)}}\\left[${terms.join(' + ')}\\right]`,
        `1 - (${N(e)})(${N(sum)})`, PR(val)];
    }
    return [gen, subst, PR(val)];
  }

  const NOTE_GAMMA = 'γ(a, x) es la función gamma incompleta: no tiene fórmula elemental general, así que se evalúa numéricamente (serie o fracción continua) con precisión de 15 cifras.';
  const NOTE_BETA = 'Iₓ(a, b) es la función beta incompleta regularizada: no tiene fórmula elemental general, así que se evalúa numéricamente (fracción continua de Lentz) con precisión de 15 cifras.';

  const CONT = {
    normal: {
      kind: 'z',
      pdf: (p) => `\\dfrac{1}{${N(p.sigma)}\\sqrt{2\\pi}}\\,e^{-\\frac{1}{2}\\left(\\frac{x ${sub(p.mu)}}{${N(p.sigma)}}\\right)^{2}}`,
      zGen: 'Z = \\dfrac{X-\\mu}{\\sigma}',
      zOf: (x, p) => (x - p.mu) / p.sigma,
      zChain: (x, p) => [
        '\\dfrac{x-\\mu}{\\sigma}',
        `\\dfrac{${N(x)} ${sub(p.mu)}}{${N(p.sigma)}}`,
        `\\dfrac{${N(x - p.mu)}}{${N(p.sigma)}}`,
      ],
      fromZ: (z, p) => [
        '\\mu + z\\,\\sigma',
        `${N(p.mu)} + (${N(z)})(${N(p.sigma)})`,
      ],
    },
    lognormal: {
      kind: 'z',
      pdf: (p) => `\\dfrac{1}{x\\,${N(p.sigma)}\\sqrt{2\\pi}}\\,e^{-\\frac{1}{2}\\left(\\frac{\\ln x ${sub(p.mu)}}{${N(p.sigma)}}\\right)^{2}}`,
      zGen: 'Z = \\dfrac{\\ln X-\\mu}{\\sigma}',
      zOf: (x, p) => (Math.log(x) - p.mu) / p.sigma,
      zChain: (x, p) => [
        '\\dfrac{\\ln x-\\mu}{\\sigma}',
        `\\dfrac{\\ln(${N(x)}) ${sub(p.mu)}}{${N(p.sigma)}}`,
        `\\dfrac{${N(Math.log(x))} ${sub(p.mu)}}{${N(p.sigma)}}`,
        `\\dfrac{${N(Math.log(x) - p.mu)}}{${N(p.sigma)}}`,
      ],
      fromZ: (z, p) => [
        'e^{\\mu + z\\,\\sigma}',
        `e^{${N(p.mu)} + (${N(z)})(${N(p.sigma)})}`,
        `e^{${N(p.mu + z * p.sigma)}}`,
      ],
    },
    exponential: {
      kind: 'closed',
      pdf: (p) => `${N(p.lambda)}\\,e^{-${N(p.lambda)}x}`,
      Fgen: '1 - e^{-\\lambda x}',
      evalF: (x, p, v) => ['1 - e^{-\\lambda x}', `1 - e^{-${N(p.lambda)}(${N(x)})}`, `1 - e^{-${N(p.lambda * x)}}`,
        `1 - ${N(Math.exp(-p.lambda * x))}`, PR(v)],
      evalS: (x, p, v) => ['e^{-\\lambda x}', `e^{-${N(p.lambda)}(${N(x)})}`, `e^{-${N(p.lambda * x)}}`, PR(v)],
      inv: (q, p, x) => ['-\\dfrac{\\ln(1-p)}{\\lambda}', `-\\dfrac{\\ln(1-${PR(q)})}{${N(p.lambda)}}`,
        `-\\dfrac{\\ln(${N(1 - q)})}{${N(p.lambda)}}`, `-\\dfrac{${N(Math.log1p(-q))}}{${N(p.lambda)}}`, N(x, 8)],
    },
    uniform: {
      kind: 'closed',
      pdf: (p) => `\\dfrac{1}{${N(p.b - p.a)}}`,
      Fgen: '\\dfrac{x-a}{b-a}',
      evalF: (x, p, v) => ['\\dfrac{x-a}{b-a}', `\\dfrac{${N(x)} ${sub(p.a)}}{${N(p.b)} ${sub(p.a)}}`,
        `\\dfrac{${N(x - p.a)}}{${N(p.b - p.a)}}`, PR(v)],
      evalS: (x, p, v) => ['\\dfrac{b-x}{b-a}', `\\dfrac{${N(p.b)} ${sub(x)}}{${N(p.b)} ${sub(p.a)}}`,
        `\\dfrac{${N(p.b - x)}}{${N(p.b - p.a)}}`, PR(v)],
      inv: (q, p, x) => ['a + p\\,(b-a)', `${N(p.a)} + ${PR(q)}(${N(p.b)} ${sub(p.a)})`, N(x, 8)],
    },
    weibull: {
      kind: 'closed',
      pdf: (p) => `\\dfrac{${N(p.k)}}{${N(p.lambda)}}\\left(\\dfrac{x}{${N(p.lambda)}}\\right)^{${N(p.k - 1)}}e^{-(x/${N(p.lambda)})^{${N(p.k)}}}`,
      Fgen: '1 - e^{-(x/\\lambda)^{k}}',
      evalF: (x, p, v) => ['1 - e^{-(x/\\lambda)^{k}}', `1 - e^{-(${N(x)}/${N(p.lambda)})^{${N(p.k)}}}`,
        `1 - e^{-${N(Math.pow(x / p.lambda, p.k))}}`, `1 - ${N(Math.exp(-Math.pow(x / p.lambda, p.k)))}`, PR(v)],
      evalS: (x, p, v) => ['e^{-(x/\\lambda)^{k}}', `e^{-(${N(x)}/${N(p.lambda)})^{${N(p.k)}}}`,
        `e^{-${N(Math.pow(x / p.lambda, p.k))}}`, PR(v)],
      inv: (q, p, x) => ['\\lambda\\left[-\\ln(1-p)\\right]^{1/k}', `${N(p.lambda)}\\left[-\\ln(1-${PR(q)})\\right]^{1/${N(p.k)}}`,
        `${N(p.lambda)}\\,(${N(-Math.log1p(-q))})^{${N(1 / p.k)}}`, N(x, 8)],
    },
    cauchy: {
      kind: 'closed',
      pdf: (p) => `\\dfrac{1}{\\pi(${N(p.gamma)})\\left[1+\\left(\\frac{x ${sub(p.x0)}}{${N(p.gamma)}}\\right)^{2}\\right]}`,
      Fgen: '\\dfrac{1}{2} + \\dfrac{1}{\\pi}\\arctan\\left(\\dfrac{x-x_0}{\\gamma}\\right)',
      evalF: (x, p, v) => {
        const z = (x - p.x0) / p.gamma;
        return ['\\dfrac{1}{2} + \\dfrac{1}{\\pi}\\arctan\\left(\\dfrac{x-x_0}{\\gamma}\\right)',
          `\\dfrac{1}{2} + \\dfrac{1}{\\pi}\\arctan\\left(\\dfrac{${N(x)} ${sub(p.x0)}}{${N(p.gamma)}}\\right)`,
          `\\dfrac{1}{2} + \\dfrac{1}{\\pi}\\arctan(${N(z)})`, `0.5 + \\dfrac{${N(Math.atan(z))}}{\\pi}`, PR(v)];
      },
      inv: (q, p, x) => ['x_0 + \\gamma\\tan\\left[\\pi\\left(p-\\tfrac{1}{2}\\right)\\right]',
        `${N(p.x0)} + ${N(p.gamma)}\\tan\\left[\\pi(${PR(q)} - 0.5)\\right]`,
        `${N(p.x0)} + ${N(p.gamma)}\\tan(${N(Math.PI * (q - 0.5))})`, N(x, 8)],
    },
    logistic: {
      kind: 'closed',
      pdf: (p) => `\\dfrac{e^{-(x ${sub(p.mu)})/${N(p.s)}}}{${N(p.s)}\\left(1+e^{-(x ${sub(p.mu)})/${N(p.s)}}\\right)^{2}}`,
      Fgen: '\\dfrac{1}{1+e^{-(x-\\mu)/s}}',
      evalF: (x, p, v) => {
        const z = (x - p.mu) / p.s;
        return ['\\dfrac{1}{1+e^{-(x-\\mu)/s}}', `\\dfrac{1}{1+e^{-(${N(x)} ${sub(p.mu)})/${N(p.s)}}}`,
          `\\dfrac{1}{1+e^{${N(-z)}}}`, `\\dfrac{1}{1+${N(Math.exp(-z))}}`, PR(v)];
      },
      inv: (q, p, x) => ['\\mu + s\\ln\\left(\\dfrac{p}{1-p}\\right)',
        `${N(p.mu)} + ${N(p.s)}\\ln\\left(\\dfrac{${PR(q)}}{1-${PR(q)}}\\right)`,
        `${N(p.mu)} + ${N(p.s)}(${N(Math.log(q) - Math.log1p(-q))})`, N(x, 8)],
    },
    laplace: {
      kind: 'closed',
      pdf: (p) => `\\dfrac{1}{${N(2 * p.b)}}\\,e^{-\\frac{|x ${sub(p.mu)}|}{${N(p.b)}}}`,
      Fgen: '\\begin{cases} \\frac{1}{2}e^{(x-\\mu)/b} & x < \\mu \\\\ 1-\\frac{1}{2}e^{-(x-\\mu)/b} & x \\ge \\mu \\end{cases}',
      evalF: (x, p, v) => {
        const z = (x - p.mu) / p.b;
        if (x < p.mu) {
          return ['\\dfrac{1}{2}e^{(x-\\mu)/b}', `\\dfrac{1}{2}e^{(${N(x)} ${sub(p.mu)})/${N(p.b)}}`, `\\dfrac{1}{2}e^{${N(z)}}`, PR(v)];
        }
        return ['1-\\dfrac{1}{2}e^{-(x-\\mu)/b}', `1-\\dfrac{1}{2}e^{-(${N(x)} ${sub(p.mu)})/${N(p.b)}}`,
          `1-\\dfrac{1}{2}e^{${N(-z)}}`, PR(v)];
      },
      inv: (q, p, x) => (q < 0.5
        ? ['\\mu + b\\ln(2p)', `${N(p.mu)} + ${N(p.b)}\\ln(2 \\cdot ${PR(q)})`, `${N(p.mu)} + ${N(p.b)}(${N(Math.log(2 * q))})`, N(x, 8)]
        : ['\\mu - b\\ln\\left[2(1-p)\\right]', `${N(p.mu)} - ${N(p.b)}\\ln\\left[2(1-${PR(q)})\\right]`,
          `${N(p.mu)} - ${N(p.b)}(${N(Math.log(2 * (1 - q)))})`, N(x, 8)]),
    },
    pareto: {
      kind: 'closed',
      pdf: (p) => `\\dfrac{${N(p.alpha)}\\,(${N(p.xm)})^{${N(p.alpha)}}}{x^{${N(p.alpha + 1)}}}`,
      Fgen: '1 - \\left(\\dfrac{x_m}{x}\\right)^{\\alpha}',
      evalF: (x, p, v) => ['1 - \\left(\\dfrac{x_m}{x}\\right)^{\\alpha}', `1 - \\left(\\dfrac{${N(p.xm)}}{${N(x)}}\\right)^{${N(p.alpha)}}`,
        `1 - ${N(Math.pow(p.xm / x, p.alpha))}`, PR(v)],
      evalS: (x, p, v) => ['\\left(\\dfrac{x_m}{x}\\right)^{\\alpha}', `\\left(\\dfrac{${N(p.xm)}}{${N(x)}}\\right)^{${N(p.alpha)}}`, PR(v)],
      inv: (q, p, x) => ['x_m\\,(1-p)^{-1/\\alpha}', `${N(p.xm)}\\,(1-${PR(q)})^{-1/${N(p.alpha)}}`, N(x, 8)],
    },
    triangular: {
      kind: 'closed',
      inlinePdf: false,
      pdf: (p) => `\\begin{cases} \\dfrac{2(x ${sub(p.a)})}{${N((p.b - p.a) * (p.c - p.a))}} & ${N(p.a)} \\le x < ${N(p.c)} \\\\[2mm] \\dfrac{2(${N(p.b)} - x)}{${N((p.b - p.a) * (p.b - p.c))}} & ${N(p.c)} \\le x \\le ${N(p.b)} \\end{cases}`,
      Fgen: '\\begin{cases} \\frac{(x-a)^2}{(b-a)(c-a)} & x \\le c \\\\ 1-\\frac{(b-x)^2}{(b-a)(b-c)} & x > c \\end{cases}',
      evalF: (x, p, v) => (x <= p.c
        ? ['\\dfrac{(x-a)^2}{(b-a)(c-a)}', `\\dfrac{(${N(x)} ${sub(p.a)})^2}{(${N(p.b)} ${sub(p.a)})(${N(p.c)} ${sub(p.a)})}`,
          `\\dfrac{${N((x - p.a) ** 2)}}{${N((p.b - p.a) * (p.c - p.a))}}`, PR(v)]
        : ['1 - \\dfrac{(b-x)^2}{(b-a)(b-c)}', `1 - \\dfrac{(${N(p.b)} ${sub(x)})^2}{(${N(p.b)} ${sub(p.a)})(${N(p.b)} ${sub(p.c)})}`,
          `1 - \\dfrac{${N((p.b - x) ** 2)}}{${N((p.b - p.a) * (p.b - p.c))}}`, PR(v)]),
      inv: (q, p, x) => (q < (p.c - p.a) / (p.b - p.a)
        ? ['a + \\sqrt{p\\,(b-a)(c-a)}', `${N(p.a)} + \\sqrt{${PR(q)}\\,(${N(p.b - p.a)})(${N(p.c - p.a)})}`, N(x, 8)]
        : ['b - \\sqrt{(1-p)(b-a)(b-c)}', `${N(p.b)} - \\sqrt{(1-${PR(q)})(${N(p.b - p.a)})(${N(p.b - p.c)})}`, N(x, 8)]),
    },
    t: {
      kind: 'special',
      note: NOTE_BETA + ' En la tabla t de Student se encuentran los valores críticos más usados.',
      pdf: (p) => `\\dfrac{\\Gamma(${N((p.nu + 1) / 2)})}{\\sqrt{${N(p.nu)}\\pi}\\;\\Gamma(${N(p.nu / 2)})}\\left(1+\\dfrac{x^{2}}{${N(p.nu)}}\\right)^{-${N((p.nu + 1) / 2)}}`,
      Fgen: '1 - \\dfrac{1}{2}I_{\\frac{\\nu}{\\nu+x^2}}\\left(\\dfrac{\\nu}{2},\\ \\dfrac{1}{2}\\right) \\quad (x \\ge 0)',
      evalF: (x, p, v, d) => {
        const nu = p.nu, u = nu / (nu + x * x);
        const I = 2 * (x >= 0 ? d.sf(x, p) : d.cdf(x, p));
        const Isub = `I_{\\frac{${N(nu)}}{${N(nu)}+${par(x)}^{2}}}\\left(${N(nu / 2)},\\ 0.5\\right)`;
        if (x >= 0) {
          return ['1 - \\dfrac{1}{2}I_{\\frac{\\nu}{\\nu+x^2}}\\left(\\dfrac{\\nu}{2},\\ \\dfrac{1}{2}\\right)', `1 - \\dfrac{1}{2}${Isub}`,
            `1 - \\dfrac{1}{2}I_{${N(u)}}(${N(nu / 2)},\\ 0.5)`, `1 - \\dfrac{1}{2}(${N(I)})`, PR(v)];
        }
        return ['\\dfrac{1}{2}I_{\\frac{\\nu}{\\nu+x^2}}\\left(\\dfrac{\\nu}{2},\\ \\dfrac{1}{2}\\right)', `\\dfrac{1}{2}${Isub}`,
          `\\dfrac{1}{2}I_{${N(u)}}(${N(nu / 2)},\\ 0.5)`, `\\dfrac{1}{2}(${N(I)})`, PR(v)];
      },
      evalS: (x, p, v, d) => {
        const nu = p.nu, u = nu / (nu + x * x);
        const I = 2 * (x >= 0 ? d.sf(x, p) : d.cdf(x, p));
        const Isub = `I_{\\frac{${N(nu)}}{${N(nu)}+${par(x)}^{2}}}\\left(${N(nu / 2)},\\ 0.5\\right)`;
        if (x >= 0) {
          return ['\\dfrac{1}{2}I_{\\frac{\\nu}{\\nu+x^2}}\\left(\\dfrac{\\nu}{2},\\ \\dfrac{1}{2}\\right)', `\\dfrac{1}{2}${Isub}`,
            `\\dfrac{1}{2}I_{${N(u)}}(${N(nu / 2)},\\ 0.5)`, `\\dfrac{1}{2}(${N(I)})`, PR(v)];
        }
        return ['1 - \\dfrac{1}{2}I_{\\frac{\\nu}{\\nu+x^2}}\\left(\\dfrac{\\nu}{2},\\ \\dfrac{1}{2}\\right)', `1 - \\dfrac{1}{2}${Isub}`,
          `1 - \\dfrac{1}{2}I_{${N(u)}}(${N(nu / 2)},\\ 0.5)`, `1 - \\dfrac{1}{2}(${N(I)})`, PR(v)];
      },
    },
    chisq: {
      kind: 'special',
      note: NOTE_GAMMA + ' En la tabla χ² se encuentran los valores críticos más usados.',
      pdf: (p) => `\\dfrac{1}{2^{${N(p.k / 2)}}\\,\\Gamma(${N(p.k / 2)})}\\,x^{${N(p.k / 2 - 1)}}\\,e^{-x/2}`,
      Fgen: '\\dfrac{\\gamma\\left(\\frac{k}{2},\\ \\frac{x}{2}\\right)}{\\Gamma\\left(\\frac{k}{2}\\right)}',
      evalF: (x, p, v) => gammaChain(p.k / 2, x / 2, v, false,
        '\\dfrac{\\gamma\\left(\\frac{k}{2},\\ \\frac{x}{2}\\right)}{\\Gamma\\left(\\frac{k}{2}\\right)}',
        `\\dfrac{\\gamma(${N(p.k / 2)},\\ ${N(x / 2)})}{\\Gamma(${N(p.k / 2)})}`),
      evalS: (x, p, v) => gammaChain(p.k / 2, x / 2, v, true,
        '1 - \\dfrac{\\gamma\\left(\\frac{k}{2},\\ \\frac{x}{2}\\right)}{\\Gamma\\left(\\frac{k}{2}\\right)}',
        `1 - \\dfrac{\\gamma(${N(p.k / 2)},\\ ${N(x / 2)})}{\\Gamma(${N(p.k / 2)})}`),
    },
    gamma: {
      kind: 'special',
      note: NOTE_GAMMA,
      pdf: (p) => `\\dfrac{x^{${N(p.k - 1)}}\\,e^{-x/${N(p.theta)}}}{\\Gamma(${N(p.k)})\\,(${N(p.theta)})^{${N(p.k)}}}`,
      Fgen: '\\dfrac{\\gamma(k,\\ x/\\theta)}{\\Gamma(k)}',
      evalF: (x, p, v) => gammaChain(p.k, x / p.theta, v, false, '\\dfrac{\\gamma(k,\\ x/\\theta)}{\\Gamma(k)}',
        `\\dfrac{\\gamma(${N(p.k)},\\ ${N(x)}/${N(p.theta)})}{\\Gamma(${N(p.k)})}`),
      evalS: (x, p, v) => gammaChain(p.k, x / p.theta, v, true, '1 - \\dfrac{\\gamma(k,\\ x/\\theta)}{\\Gamma(k)}',
        `1 - \\dfrac{\\gamma(${N(p.k)},\\ ${N(x)}/${N(p.theta)})}{\\Gamma(${N(p.k)})}`),
    },
    f: {
      kind: 'special',
      inlinePdf: false,
      note: NOTE_BETA + ' En la tabla F se encuentran los valores críticos más usados.',
      pdf: (p) => `\\dfrac{1}{x\\,B(${N(p.d1 / 2)},\\ ${N(p.d2 / 2)})}\\sqrt{\\dfrac{(${N(p.d1)}x)^{${N(p.d1)}}\\;${par(p.d2)}^{${N(p.d2)}}}{(${N(p.d1)}x+${N(p.d2)})^{${N(p.d1 + p.d2)}}}}`,
      Fgen: 'I_{\\frac{d_1 x}{d_1 x + d_2}}\\left(\\dfrac{d_1}{2},\\ \\dfrac{d_2}{2}\\right)',
      evalF: (x, p, v) => {
        const u = (p.d1 * x) / (p.d1 * x + p.d2);
        return ['I_{\\frac{d_1 x}{d_1 x + d_2}}\\left(\\dfrac{d_1}{2},\\ \\dfrac{d_2}{2}\\right)',
          `I_{\\frac{${N(p.d1)}(${N(x)})}{${N(p.d1)}(${N(x)}) + ${N(p.d2)}}}\\left(${N(p.d1 / 2)},\\ ${N(p.d2 / 2)}\\right)`,
          `I_{${N(u)}}(${N(p.d1 / 2)},\\ ${N(p.d2 / 2)})`, PR(v)];
      },
      evalS: (x, p, v) => {
        const w = p.d2 / (p.d1 * x + p.d2);
        return ['I_{\\frac{d_2}{d_1 x + d_2}}\\left(\\dfrac{d_2}{2},\\ \\dfrac{d_1}{2}\\right)',
          `I_{\\frac{${N(p.d2)}}{${N(p.d1)}(${N(x)}) + ${N(p.d2)}}}\\left(${N(p.d2 / 2)},\\ ${N(p.d1 / 2)}\\right)`,
          `I_{${N(w)}}(${N(p.d2 / 2)},\\ ${N(p.d1 / 2)})`, PR(v)];
      },
    },
    beta: {
      kind: 'special',
      note: NOTE_BETA,
      pdf: (p) => `\\dfrac{x^{${N(p.alpha - 1)}}\\,(1-x)^{${N(p.beta - 1)}}}{B(${N(p.alpha)},\\ ${N(p.beta)})}`,
      Fgen: 'I_x(\\alpha,\\ \\beta)',
      evalF: (x, p, v) => {
        const a = p.alpha, b = p.beta, m = a + b - 1;
        const out = ['I_x(\\alpha,\\ \\beta)', `I_{${N(x)}}(${N(a)},\\ ${N(b)})`];
        if (Number.isInteger(a) && Number.isInteger(b) && m <= 12) {
          out.push(`\\sum_{j=${a}}^{${m}}\\binom{${m}}{j}(${N(x)})^{j}(${N(1 - x)})^{${m}-j}`);
        }
        out.push(PR(v));
        return out;
      },
      evalS: (x, p, v) => ['I_{1-x}(\\beta,\\ \\alpha)', `I_{${N(1 - x)}}(${N(p.beta)},\\ ${N(p.alpha)})`, PR(v)],
    },
  };

  /* ------------------------------------------------------------------ */
  /* Distribuciones discretas                                            */
  /* ------------------------------------------------------------------ */
  const isTrials = (p) => p.variant === 'trials';

  const DISC = {
    binomial: {
      pmfGen: '\\binom{n}{x}\\,p^{x}(1-p)^{n-x}',
      pmfSub: (p, v) => `\\binom{${p.n}}{${v}}(${N(p.p)})^{${v}}(${N(1 - p.p)})^{${p.n}-${v}}`,
      term: (p, k) => ({
        sub: `\\binom{${p.n}}{${k}}(${N(p.p)})^{${k}}(${N(1 - p.p)})^{${p.n - k}}`,
        mid: `(${chooseTex(p.n, k)})(${powTex(p.p, k)})(${powTex(1 - p.p, p.n - k)})`,
      }),
    },
    poisson: {
      pmfGen: '\\dfrac{e^{-\\lambda}\\,\\lambda^{x}}{x!}',
      pmfSub: (p, v) => `\\dfrac{e^{-${N(p.lambda)}}\\,(${N(p.lambda)})^{${v}}}{${v}!}`,
      term: (p, k) => ({
        sub: `\\dfrac{e^{-${N(p.lambda)}}\\,(${N(p.lambda)})^{${k}}}{${k}!}`,
        mid: `\\dfrac{(${powTex(Math.E, -p.lambda)})(${powTex(p.lambda, k)})}{${factTex(k)}}`,
      }),
    },
    negbinomial: {
      pmfGen: (p) => (isTrials(p) ? '\\binom{x-1}{r-1}\\,p^{r}(1-p)^{x-r}' : '\\binom{x+r-1}{x}\\,p^{r}(1-p)^{x}'),
      pmfSub: (p, v) => (isTrials(p)
        ? `\\binom{${v}-1}{${p.r - 1}}(${N(p.p)})^{${p.r}}(${N(1 - p.p)})^{${v}-${p.r}}`
        : `\\binom{${v}+${p.r - 1}}{${v}}(${N(p.p)})^{${p.r}}(${N(1 - p.p)})^{${v}}`),
      term: (p, k) => (isTrials(p)
        ? {
          sub: `\\binom{${k - 1}}{${p.r - 1}}(${N(p.p)})^{${p.r}}(${N(1 - p.p)})^{${k - p.r}}`,
          mid: `(${chooseTex(k - 1, p.r - 1)})(${powTex(p.p, p.r)})(${powTex(1 - p.p, k - p.r)})`,
        }
        : {
          sub: `\\binom{${k + p.r - 1}}{${k}}(${N(p.p)})^{${p.r}}(${N(1 - p.p)})^{${k}}`,
          mid: `(${chooseTex(k + p.r - 1, k)})(${powTex(p.p, p.r)})(${powTex(1 - p.p, k)})`,
        }),
    },
    hypergeometric: {
      pmfGen: '\\dfrac{\\binom{K}{x}\\binom{N-K}{n-x}}{\\binom{N}{n}}',
      pmfSub: (p, v) => `\\dfrac{\\binom{${p.K}}{${v}}\\binom{${p.N - p.K}}{${p.n}-${v}}}{\\binom{${p.N}}{${p.n}}}`,
      term: (p, k) => ({
        sub: `\\dfrac{\\binom{${p.K}}{${k}}\\binom{${p.N - p.K}}{${p.n - k}}}{\\binom{${p.N}}{${p.n}}}`,
        mid: `\\dfrac{(${chooseTex(p.K, k)})(${chooseTex(p.N - p.K, p.n - k)})}{${chooseTex(p.N, p.n)}}`,
      }),
    },
    bernoulli: {
      pmfGen: 'p^{x}(1-p)^{1-x}',
      pmfSub: (p, v) => `(${N(p.p)})^{${v}}(${N(1 - p.p)})^{1-${v}}`,
      term: (p, k) => ({ sub: `(${N(p.p)})^{${k}}(${N(1 - p.p)})^{${1 - k}}`, mid: '' }),
    },
    geometric: {
      closed: true,
      pmfGen: (p) => (isTrials(p) ? '(1-p)^{x-1}\\,p' : '(1-p)^{x}\\,p'),
      pmfSub: (p, v) => (isTrials(p) ? `(${N(1 - p.p)})^{${v}-1}(${N(p.p)})` : `(${N(1 - p.p)})^{${v}}(${N(p.p)})`),
      Fgen: (p) => (isTrials(p) ? '1-(1-p)^{x}' : '1-(1-p)^{x+1}'),
      evalF: (k, p, v) => {
        const e = isTrials(p) ? k : k + 1;
        return [isTrials(p) ? '1-(1-p)^{x}' : '1-(1-p)^{x+1}', `1-(${N(1 - p.p)})^{${e}}`, `1-${powTex(1 - p.p, e)}`, PR(v)];
      },
      evalS: (k, p, v) => {
        const e = isTrials(p) ? k : k + 1;
        return [isTrials(p) ? '(1-p)^{x}' : '(1-p)^{x+1}', `(${N(1 - p.p)})^{${e}}`, PR(v)];
      },
    },
    duniform: {
      closed: true,
      pmfGen: '\\dfrac{1}{b-a+1}',
      pmfSub: (p, v) => (v === 'x'
        ? `\\dfrac{1}{${N(p.b)} ${sub(p.a)} + 1} = \\dfrac{1}{${p.b - p.a + 1}}`
        : `\\dfrac{1}{${p.b - p.a + 1}}`),
      Fgen: () => '\\dfrac{x-a+1}{b-a+1}',
      evalF: (k, p, v) => ['\\dfrac{x-a+1}{b-a+1}', `\\dfrac{${N(k)} ${sub(p.a)} + 1}{${N(p.b)} ${sub(p.a)} + 1}`,
        `\\dfrac{${k - p.a + 1}}{${p.b - p.a + 1}}`, PR(v)],
      evalS: (k, p, v) => ['\\dfrac{b-x}{b-a+1}', `\\dfrac{${N(p.b)} ${sub(k)}}{${N(p.b)} ${sub(p.a)} + 1}`,
        `\\dfrac{${p.b - k}}{${p.b - p.a + 1}}`, PR(v)],
    },
  };

  /* ------------------------------------------------------------------ */
  /* Paso 1: datos del problema                                          */
  /* ------------------------------------------------------------------ */
  function notation(d, p) {
    const brace = d.notationTex.includes('\\{');
    const head = d.notationTex.split(brace ? '\\{' : '(')[0];
    const parts = d.params.filter((q) => q.type !== 'select').map((q) => `${q.tex} = ${N(p[q.key])}`);
    return brace ? `${head}\\{${parts.join(',\\ ')}\\}` : `${head}(${parts.join(',\\ ')})`;
  }

  function paramWords(d, p) {
    const parts = d.params.filter((q) => q.type !== 'select')
      .map((q) => `${q.label.split(' ')[0]} = ${txt(p[q.key])}${q.hint ? ` (${q.hint.toLowerCase()})` : ''}`);
    let s = parts.join(', ');
    const sel = d.params.find((q) => q.type === 'select');
    if (sel) s += `; X = ${sel.options.find((op) => op.value === p[sel.key]).label.toLowerCase()}`;
    return s;
  }

  function targetInfo(o) {
    const { mode, x1, x2, ops, d } = o;
    const disc = d.type === 'discrete';
    switch (mode) {
      case 'lower':
        return { tex: `P(X ${OPT[ops.lower]} ${N(x1)})`, words: `sea ${OPW[ops.lower]} ${txt(x1)}` };
      case 'upper':
        return { tex: `P(X ${OPT[ops.upper]} ${N(x1)})`, words: `sea ${OPW[ops.upper]} ${txt(x1)}` };
      case 'between': {
        let inc = '';
        if (disc) {
          if (ops.b1 === '<=' && ops.b2 === '<=') inc = ' (incluyendo ambos extremos)';
          else if (ops.b1 === '<' && ops.b2 === '<') inc = ' (sin incluir los extremos)';
          else inc = ops.b1 === '<=' ? ` (incluyendo ${txt(x1)} pero no ${txt(x2)})` : ` (incluyendo ${txt(x2)} pero no ${txt(x1)})`;
        }
        return { tex: `P(${N(x1)} ${OPT[ops.b1]} X ${OPT[ops.b2]} ${N(x2)})`, words: `esté entre ${txt(x1)} y ${txt(x2)}${inc}` };
      }
      case 'tails':
        return {
          tex: `P(X ${OPT[ops.t1]} ${N(x1)}) + P(X ${OPT[ops.t2]} ${N(x2)})`,
          words: `sea ${OPW[ops.t1]} ${txt(x1)} o ${OPW[ops.t2]} ${txt(x2)}`,
        };
    }
    return { tex: 'P', words: '' };
  }

  function datosStep(o, T) {
    const { d, p } = o;
    const math = [notation(d, p)];
    let text = `X sigue una distribución ${d.name} con ${paramWords(d, p)}.`;
    if (T) {
      math.push(`${T.tex} = \\ ?`);
      text += ` Se busca la probabilidad de que X ${T.words}.`;
    }
    return step('Datos del problema', { text, math });
  }

  function resultStep(T, value) {
    if (!isFinite(value)) {
      return step('Resultado', { text: 'No se puede calcular con los valores dados.', final: true, value: NaN });
    }
    return step('Resultado', {
      math: [`${T.tex} = \\boxed{${PR(value)}}`],
      text: `La probabilidad de que X ${T.words} es ${ptxt(value)}, es decir, ${pct(value)}.`,
      final: true,
      value,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Flujo continuo                                                      */
  /* ------------------------------------------------------------------ */
  function continuousValue(o) {
    const { d, p, mode, x1, x2, ops } = o;
    switch (mode) {
      case 'lower': return D.probOp(d, p, ops.lower, x1);
      case 'upper': return D.probOp(d, p, ops.upper, x1);
      case 'between': return D.probBetween(d, p, x1, x2, ops.b1, ops.b2);
      case 'tails': return x1 < x2 ? Math.min(1, D.probOp(d, p, ops.t1, x1) + D.probOp(d, p, ops.t2, x2)) : NaN;
    }
    return NaN;
  }

  function zSym(z) {
    const zr = Math.round(z * 100) / 100;
    return Math.abs(z - zr) < 1e-9 ? F.texFix(zr, 2) : F.texFix(z, 4);
  }

  function continuousSteps(o, steps) {
    const { d, p, mode, x1, x2, ops } = o;
    const H = CONT[d.id];
    const [sLo, sHi] = d.support(p);
    const T = targetInfo(o);
    const value = continuousValue(o);
    steps.push(datosStep(o, T));

    // ---- Planteamiento: integral de la densidad ----
    const lim = (v) => (v === -Infinity ? '-\\infty' : v === Infinity ? '\\infty' : N(v));
    const fx = H.inlinePdf === false ? 'f(x)' : H.pdf(p);
    const integ = (a, b) => {
      const A = Math.max(a, sLo), B = Math.min(b, sHi);
      return `\\int_{${lim(A)}}^{${lim(B)}} ${fx}\\,dx`;
    };
    let planteo;
    const strict = (mode === 'lower' && ops.lower === '<') || (mode === 'upper' && ops.upper === '>') ||
      (mode === 'between' && (ops.b1 === '<' || ops.b2 === '<')) || (mode === 'tails' && (ops.t1 === '<' || ops.t2 === '>'));
    if (mode === 'lower') planteo = `${T.tex} = ${integ(-Infinity, x1)}`;
    else if (mode === 'upper') planteo = `${T.tex} = ${integ(x1, Infinity)}`;
    else if (mode === 'between') planteo = `${T.tex} = ${integ(x1, x2)}`;
    else planteo = `${T.tex} = ${integ(-Infinity, x1)} + ${integ(x2, Infinity)}`;
    let note = strict ? 'En una distribución continua P(X = x) = 0, así que usar < o ≤ da el mismo resultado. ' : '';
    const usesInf = ((mode === 'lower' || mode === 'tails') && sLo === -Infinity) ||
      ((mode === 'upper' || mode === 'tails') && sHi === Infinity);
    const st = D.stats(d, p);
    if (usesInf && isFinite(st.mean) && isFinite(st.sd)) {
      const big = (v) => parseFloat(v.toPrecision(3));
      const hiV = big(st.mean + 10 * st.sd), loV = big(st.mean - 10 * st.sd);
      const parts = [];
      if ((mode === 'lower' || mode === 'tails') && sLo === -Infinity) parts.push(`−∞ por ${txt(loV)} (μ − 10σ)`);
      if ((mode === 'upper' || mode === 'tails') && sHi === Infinity) parts.push(`∞ por ${txt(hiV)} (μ + 10σ)`);
      note += `Para verificarlo en una calculadora científica (función ∫), sustituye ${parts.join(' y ')}: el área que queda fuera es despreciable.`;
    }
    steps.push(step('Planteamiento', {
      text: 'La probabilidad es el área bajo la curva de densidad f(x) entre los límites del intervalo:',
      math: [`f(x) = ${H.pdf(p)}`, planteo],
      note: note.trim(),
    }));

    if (mode === 'tails' && !(x1 < x2)) {
      steps.push(step('Revisa los valores', { text: 'Para dos colas se requiere x₁ < x₂; si no, las colas se encimarían.' }));
      steps.push(resultStep(T, NaN));
      return;
    }
    if (mode === 'between' && x1 > x2) {
      steps.push(step('Intervalo vacío', { text: 'x₁ es mayor que x₂, así que no hay valores en el intervalo y la probabilidad es 0.' }));
      steps.push(resultStep(T, 0));
      return;
    }

    // Puntos donde se necesita F (o S) según el modo
    const pts = [];
    if (mode === 'lower') pts.push({ x: x1, need: 'F', name: '' });
    if (mode === 'upper') pts.push({ x: x1, need: 'S', name: '' });
    if (mode === 'between') { pts.push({ x: x1, need: 'F', name: '_1' }); pts.push({ x: x2, need: 'F', name: '_2' }); }
    if (mode === 'tails') { pts.push({ x: x1, need: 'F', name: '_1' }); pts.push({ x: x2, need: 'S', name: '_2' }); }
    pts.forEach((pt) => {
      pt.F = d.cdf(pt.x, p);
      pt.S = d.sf(pt.x, p);
      pt.out = pt.x <= sLo ? 'below' : pt.x >= sHi ? 'above' : '';
    });

    if (H.kind === 'z') zSteps(o, H, T, pts, value, steps);
    else cdfSteps(o, H, T, pts, value, steps);
    steps.push(resultStep(T, value));
  }

  /* Normal y lognormal: estandarización y tabla Z */
  function zSteps(o, H, T, pts, value, steps) {
    const { d, p, mode, ops } = o;
    const zLines = [H.zGen];
    const tableNotes = [];
    let tableAddsInfo = DEC !== 4;
    pts.forEach((pt) => {
      if (pt.out === 'below') { pt.z = -Infinity; zLines.push(`z${pt.name}:\\ x = ${N(pt.x)} \\le 0 \\Rightarrow \\Phi = 0`); return; }
      pt.z = H.zOf(pt.x, p);
      const zr = Math.round(pt.z * 100) / 100;
      const exact = Math.abs(pt.z - zr) < 1e-9;
      if (!exact) tableAddsInfo = true;
      zLines.push(chain(`z${pt.name}`, [...H.zChain(pt.x, p),
        `${F.texFix(pt.z, 4)} ${exact ? '=' : '\\approx'} \\boxed{${F.texFix(zr, 2)}}`]));
      const phiTable = S.pnorm(zr);
      tableNotes.push(Math.abs(zr) > 3.49
        ? `Φ(${F.num(zr, 3)}) ≈ ${zr > 0 ? '1.0000' : '0.0000'} (fuera de la tabla)`
        : `Φ(${zr.toFixed(2)}) = ${phiTable.toFixed(4)}`);
    });
    steps.push(step('Estandarizamos la variable', {
      text: d.id === 'normal' ? 'Convertimos de “x” a “z” con la fórmula:' : 'Como ln X es normal, convertimos de “x” a “z” con:',
      math: zLines,
    }));

    const phiLines = pts.filter((pt) => isFinite(pt.z)).map((pt) => `\\Phi(${zSym(pt.z)}) = ${PR(pt.F)}`);
    steps.push(step('Buscamos el área en la tabla normal estándar', {
      text: 'Φ(z) es el área bajo la curva normal estándar a la izquierda de z:',
      math: phiLines.length ? phiLines : ['\\Phi(-\\infty) = 0'],
      note: tableNotes.length && tableAddsInfo ? `Con la tabla Z impresa (z redondeado a dos decimales y 4 decimales de área): ${tableNotes.join('; ')}.` : '',
    }));

    // Combinar
    const Z = (pt) => (isFinite(pt.z) ? zSym(pt.z) : '-\\infty');
    const one = (v) => PR(v) === PR(1);
    let lines;
    if (mode === 'lower') {
      const a = pts[0];
      lines = [`P(Z ${OPT[ops.lower]} ${Z(a)})`, `\\Phi(${Z(a)})`, PR(value)];
    } else if (mode === 'upper') {
      const a = pts[0];
      lines = [`P(Z ${OPT[ops.upper]} ${Z(a)})`, `1 - \\Phi(${Z(a)})`, one(a.F) ? '' : `1 - ${PR(a.F)}`, PR(value)];
    } else if (mode === 'between') {
      const [a, b] = pts;
      lines = [`P(${Z(a)} ${OPT[ops.b1]} Z ${OPT[ops.b2]} ${Z(b)})`, `\\Phi(${Z(b)}) - \\Phi(${Z(a)})`,
        `${PR(b.F)} - ${PR(a.F)}`, PR(value)];
    } else {
      const [a, b] = pts;
      lines = [`\\Phi(${Z(a)}) + \\left[1 - \\Phi(${Z(b)})\\right]`, `${PR(a.F)} + (1 - ${PR(b.F)})`,
        `${PR(a.F)} + ${PR(b.S)}`, PR(value)];
    }
    steps.push(step('Calculamos la probabilidad', {
      text: mode === 'upper' ? 'La tabla da el área a la izquierda, así que usamos el complemento:'
        : mode === 'between' ? 'El área entre dos valores es la diferencia de las áreas acumuladas:'
          : mode === 'tails' ? 'Sumamos el área de la cola izquierda y la de la cola derecha:' : '',
      math: [chain(T.tex, lines)],
      note: mode === 'upper' && one(pts[0].F) ? 'El resultado se calcula directamente con la cola derecha (sin restar de 1) para no perder precisión.' : '',
    }));
  }

  /* Resto de continuas: función de distribución acumulada */
  function cdfSteps(o, H, T, pts, value, steps) {
    const { d, p, mode } = o;
    steps.push(step('Función de distribución acumulada', {
      text: H.kind === 'closed'
        ? 'Esta distribución tiene una fórmula cerrada para F(x) = P(X ≤ x):'
        : 'F(x) = P(X ≤ x) se expresa con una función especial:',
      math: [`F(x) = ${H.Fgen}`],
      note: H.kind === 'special' ? H.note : '',
    }));

    const lines = [];
    const outNote = [];
    pts.forEach((pt) => {
      const xs = N(pt.x);
      if (pt.out) {
        outNote.push(`x = ${txt(pt.x)} está ${pt.out === 'below' ? 'por debajo' : 'por encima'} del soporte, así que F(x) = ${pt.out === 'below' ? 0 : 1}.`);
        if (pt.need === 'S' && H.evalS) lines.push(`P(X > ${xs}) = ${pt.out === 'below' ? 1 : 0}`);
        else lines.push(`F(${xs}) = ${pt.out === 'below' ? 0 : 1}`);
        return;
      }
      if (pt.need === 'S' && H.evalS) {
        const lhs = mode === 'upper' ? T.tex : `P(X > ${xs})`;
        lines.push(chain(lhs, ['1 - F(' + xs + ')', ...H.evalS(pt.x, p, pt.S, d)]));
      } else if (mode === 'lower') {
        lines.push(chain(T.tex, [`F(${xs})`, ...H.evalF(pt.x, p, pt.F, d)]));
      } else {
        lines.push(chain(`F(${xs})`, H.evalF(pt.x, p, pt.F, d)));
      }
    });
    steps.push(step('Sustituimos los valores', { math: lines, note: outNote.join(' ') }));

    // Combinar
    let comb = null, text = '';
    const a = pts[0], b = pts[1];
    const Sval = (pt) => (pt.need === 'S' && H.evalS ? PR(pt.S) : `(1 - ${PR(pt.F)})`);
    if (mode === 'upper' && !H.evalS) {
      comb = [`1 - F(${N(a.x)})`, PR(a.F) === PR(1) ? '' : `1 - ${PR(a.F)}`, PR(value)];
      text = 'Usamos la regla del complemento:';
    } else if (mode === 'between') {
      comb = [`F(${N(b.x)}) - F(${N(a.x)})`, `${PR(b.F)} - ${PR(a.F)}`, PR(value)];
      text = 'El área entre dos valores es la diferencia de las probabilidades acumuladas:';
    } else if (mode === 'tails') {
      comb = [`F(${N(a.x)}) + \\left[1 - F(${N(b.x)})\\right]`, `${PR(a.F)} + ${Sval(b)}`, PR(value)];
      text = 'Sumamos la cola izquierda y la cola derecha:';
    }
    if (comb) steps.push(step('Calculamos la probabilidad', { text, math: [chain(T.tex, comb)] }));
  }

  /* ------------------------------------------------------------------ */
  /* Flujo discreto                                                      */
  /* ------------------------------------------------------------------ */
  function discreteIntervals(o) {
    const { d, p, mode, x1, x2, ops } = o;
    const [sLo, sHi] = d.support(p);
    const lowK = (op, x) => (op === '<=' ? Math.floor(x) : Math.ceil(x) - 1);
    const upK = (op, x) => (op === '>=' ? Math.ceil(x) : Math.floor(x) + 1);
    let raw;
    switch (mode) {
      case 'lower': raw = [[-Infinity, lowK(ops.lower, x1)]]; break;
      case 'upper': raw = [[upK(ops.upper, x1), Infinity]]; break;
      case 'between':
        raw = [[ops.b1 === '<=' ? Math.ceil(x1) : Math.floor(x1) + 1, ops.b2 === '<=' ? Math.floor(x2) : Math.ceil(x2) - 1]];
        break;
      default: raw = [[-Infinity, lowK(ops.t1, x1)], [upK(ops.t2, x2), Infinity]];
    }
    return raw.map(([A, B]) => ({ A: Math.max(A, sLo), B: Math.min(B, sHi) }));
  }

  function canon(iv, sLo, sHi) {
    const { A, B } = iv;
    if (A > B) return '0';
    if (A <= sLo && B >= sHi) return '1';
    if (A <= sLo) return `P(X \\le ${B})`;
    if (B >= sHi) return `P(X \\ge ${A})`;
    if (A === B) return `P(X = ${A})`;
    return `P(${A} \\le X \\le ${B})`;
  }

  function intervalProb(d, p, iv, sLo, sHi) {
    const { A, B } = iv;
    if (A > B) return 0;
    if (A <= sLo) return d.cdf(B, p);
    if (B >= sHi) return d.sf(A - 1, p);
    return D.probBetween(d, p, A, B, '<=', '<=');
  }

  function termBlock(H, d, p, ks) {
    const rows = ks.map((k) => {
      const t = H.term(p, k);
      const v = d.pmf(k, p);
      return `P(X = ${k}) &= ${t.sub}${t.mid ? ` = ${t.mid}` : ''} = ${PR(v)}`;
    });
    return `\\begin{aligned}${rows.join(' \\\\ ')}\\end{aligned}`;
  }

  const range = (a, b) => { const r = []; for (let k = a; k <= b; k++) r.push(k); return r; };

  function termsTable(d, p, A, B, max = 500) {
    const rows = [];
    let acc = 0;
    for (let k = A; k <= B && rows.length < max; k++) {
      const v = d.pmf(k, p);
      acc += v;
      rows.push([String(k), F.prob(v, DEC), F.prob(acc, DEC)]);
      if (!isFinite(B) && k > A + 5 && v < 1e-16 * acc) break;
    }
    return { headers: ['k', 'P(X = k)', 'Suma acumulada'], rows, truncated: isFinite(B) && B - A + 1 > rows.length };
  }

  /* Suma de términos de un intervalo [A, B]: directa, por complemento o larga */
  function sumInterval(o, H, iv, label) {
    const { d, p } = o;
    const [sLo, sHi] = d.support(p);
    const { A, B } = iv;
    const value = intervalProb(d, p, iv, sLo, sHi);
    const C = canon(iv, sLo, sHi);
    const MAXT = 8;
    const out = [];
    const pre = label ? `${label}: ` : '';

    if (A > B) {
      out.push(step(`${pre}Sin valores en el intervalo`, { text: 'No hay valores enteros posibles de X en ese intervalo, así que su probabilidad es 0.' }));
      return { steps: out, value: 0 };
    }
    if (A <= sLo && B >= sHi) {
      out.push(step(`${pre}Todo el soporte`, { text: 'El intervalo incluye todos los valores posibles de X, así que su probabilidad es 1.' }));
      return { steps: out, value: 1 };
    }

    const m = B - A + 1;
    const compLeft = A - sLo, compRight = sHi - B;
    const compCount = compLeft + compRight;

    if (m <= MAXT) {
      const ks = range(A, B);
      const vals = ks.map((k) => d.pmf(k, p));
      const math = [termBlock(H, d, p, ks)];
      if (m > 1) {
        math.push(chain(C, [ks.map((k) => `P(X = ${k})`).join(' + '), vals.map(PR).join(' + '), PR(value)]));
      }
      out.push(step(`${pre}Sumamos las probabilidades`, {
        text: m > 1 ? `Calculamos P(X = k) para cada valor de k = ${A} a k = ${B} y los sumamos:` : `Solo hay un valor, k = ${A}:`,
        math,
      }));
      return { steps: out, value };
    }

    if (compCount <= MAXT) {
      const ksL = compLeft > 0 ? range(sLo, A - 1) : [];
      const ksR = compRight > 0 ? range(B + 1, sHi) : [];
      const ks = ksL.concat(ksR);
      const vals = ks.map((k) => d.pmf(k, p));
      const compSum = vals.reduce((s, v) => s + v, 0);
      const compTex = ksL.length && ksR.length
        ? `1 - \\left[P(X \\le ${A - 1}) + P(X \\ge ${B + 1})\\right]`
        : ksL.length ? `1 - P(X \\le ${A - 1})` : `1 - P(X \\ge ${B + 1})`;
      const comp = chain(C, [compTex, `1 - \\left[${ks.map((k) => `P(X = ${k})`).join(' + ')}\\right]`]);
      const fin = chain(C, [`1 - (${vals.map(PR).join(' + ')})`, PR(compSum) === PR(1) ? '' : `1 - ${PR(compSum)}`, PR(value)]);
      out.push(step(`${pre}Usamos el complemento`, {
        text: `Sumar directamente requiere ${isFinite(m) ? m : 'infinitos'} términos; es más corto restar de 1 los ${ks.length} valores que quedan fuera:`,
        math: [comp, termBlock(H, d, p, ks), fin],
      }));
      return { steps: out, value };
    }

    // Suma larga
    const show = [A, A + 1].concat(isFinite(B) ? [B] : []);
    const vA = [A, A + 1, A + 2].map((k) => PR(d.pmf(k, p)));
    const tail = isFinite(B) ? ` + \\cdots + ${PR(d.pmf(B, p))}` : ' + \\cdots';
    const math = [
      termBlock(H, d, p, show),
      chain(C, [`\\sum_{k=${A}}^{${isFinite(B) ? B : '\\infty'}} P(X = k)`, `${vA.join(' + ')}${tail}`, PR(value)]),
    ];
    // Equivalencia con la función acumulada
    if (A <= sLo) math.push(`${C} = F(${B}) = ${PR(value)}`);
    else if (B >= sHi) math.push(chain(C, [`1 - F(${A - 1})`, `1 - ${PR(d.cdf(A - 1, p))}`, PR(value)]));
    else math.push(chain(C, [`F(${B}) - F(${A - 1})`, `${PR(d.cdf(B, p))} - ${PR(d.cdf(A - 1, p))}`, PR(value)]));
    const tbl = termsTable(d, p, A, B);
    tbl.title = `Ver los términos de la suma (${tbl.rows.length}${tbl.truncated ? ' primeros' : ''})`;
    out.push(step(`${pre}Sumamos las probabilidades`, {
      text: `La suma tiene ${isFinite(m) ? m : 'infinitos'} términos, así que se muestran los primeros y el último (todos están en la tabla de abajo). También puede escribirse con la función acumulada F(x) = P(X ≤ x):`,
      math,
      table: tbl,
    }));
    return { steps: out, value };
  }

  /* Geométrica y uniforme discreta: fórmula cerrada de F */
  function closedInterval(o, H, iv, label) {
    const { d, p } = o;
    const [sLo, sHi] = d.support(p);
    const { A, B } = iv;
    const value = intervalProb(d, p, iv, sLo, sHi);
    const C = canon(iv, sLo, sHi);
    const pre = label ? `${label}: ` : '';
    if (A > B) return { steps: [step(`${pre}Sin valores en el intervalo`, { text: 'No hay valores enteros posibles de X en ese intervalo, así que su probabilidad es 0.' })], value: 0 };
    if (A <= sLo && B >= sHi) return { steps: [step(`${pre}Todo el soporte`, { text: 'El intervalo incluye todos los valores posibles de X: su probabilidad es 1.' })], value: 1 };
    const Fv = (k) => (k < sLo ? 0 : d.cdf(k, p));
    const lines = [];
    if (A <= sLo) {
      lines.push(chain(C, [`F(${B})`, ...H.evalF(B, p, Fv(B)).slice(0)]));
    } else if (B >= sHi) {
      lines.push(chain(C, [`P(X > ${A - 1})`, ...H.evalS(A - 1, p, d.sf(A - 1, p))]));
    } else {
      lines.push(chain(`F(${B})`, H.evalF(B, p, Fv(B))));
      if (A - 1 >= sLo) lines.push(chain(`F(${A - 1})`, H.evalF(A - 1, p, Fv(A - 1))));
      lines.push(chain(C, [`F(${B}) - F(${A - 1})`, `${PR(Fv(B))} - ${PR(Fv(A - 1))}`, PR(value)]));
    }
    return {
      steps: [step(`${pre}Sustituimos en la fórmula`, {
        text: B >= sHi && A > sLo ? 'Para la cola derecha usamos P(X > k) = 1 − F(k):' : 'Evaluamos la función acumulada:',
        math: lines,
      })],
      value,
    };
  }

  function discreteSteps(o, steps) {
    const { d, p, mode } = o;
    const H = DISC[d.id];
    const [sLo, sHi] = d.support(p);
    const T = targetInfo(o);
    steps.push(datosStep(o, T));

    const pmfGen = typeof H.pmfGen === 'function' ? H.pmfGen(p) : H.pmfGen;
    steps.push(step('Función de probabilidad', {
      text: 'La probabilidad de cada valor x se calcula con la fórmula (y sustituyendo los parámetros):',
      math: [`P(X = x) = ${pmfGen}`, `P(X = x) = ${H.pmfSub(p, 'x')}`],
      note: H.closed ? '' : `Valores posibles: x = ${sLo}, ${sLo + 1}, …, ${isFinite(sHi) ? sHi : '∞'}.`,
    }));

    if (mode === 'tails' && !(o.x1 < o.x2)) {
      steps.push(step('Revisa los valores', { text: 'Para dos colas se requiere x₁ < x₂.' }));
      steps.push(resultStep(T, NaN));
      return;
    }

    // Planteamiento como suma
    const ivs = discreteIntervals(o);
    const sumTex = (iv) => {
      if (iv.A > iv.B) return '0';
      return `\\sum_{k=${iv.A}}^{${isFinite(iv.B) ? iv.B : '\\infty'}} ${H.pmfSub(p, 'k')}`;
    };
    const canonAll = ivs.map((iv) => canon(iv, sLo, sHi)).join(' + ');
    const plan = [T.tex, canonAll !== T.tex ? canonAll : '', ivs.map(sumTex).join(' + ')];
    steps.push(step('Planteamiento', {
      text: 'X solo toma valores enteros, así que ajustamos la desigualdad a enteros y escribimos la probabilidad como una suma de P(X = k):',
      math: [chain(T.tex, plan.slice(1))],
    }));

    // Cálculo
    const parts = ivs.map((iv, i) => (H.closed
      ? closedInterval(o, H, iv, ivs.length > 1 ? (i === 0 ? 'Cola izquierda' : 'Cola derecha') : '')
      : sumInterval(o, H, iv, ivs.length > 1 ? (i === 0 ? 'Cola izquierda' : 'Cola derecha') : '')));
    parts.forEach((pt) => steps.push(...pt.steps));

    let value;
    if (mode === 'tails') {
      value = Math.min(1, parts[0].value + parts[1].value);
      steps.push(step('Calculamos la probabilidad', {
        text: 'Sumamos las dos colas:',
        math: [chain(T.tex, [`${PR(parts[0].value)} + ${PR(parts[1].value)}`, PR(value)])],
      }));
    } else {
      value = parts[0].value;
    }
    steps.push(resultStep(T, value));
  }

  /* ------------------------------------------------------------------ */
  /* Cálculo inverso                                                     */
  /* ------------------------------------------------------------------ */
  function inverseSteps(o, steps) {
    const { d, p, inv } = o;
    const pv = inv.p;
    const t = inv.type;
    const discrete = d.type === 'discrete';
    const question = {
      left: `P(X \\le x) = ${PR(pv)}`,
      right: `P(X \\ge x) = ${PR(pv)}`,
      central: `P(x_1 \\le X \\le x_2) = ${PR(pv)}`,
      tails: `P(X \\le x_1) + P(X \\ge x_2) = ${PR(pv)}`,
    }[t];
    const qWords = {
      left: `el valor x que deja una probabilidad acumulada de ${ptxt(pv)} a su izquierda`,
      right: `el valor x que deja una probabilidad de ${ptxt(pv)} a su derecha`,
      central: `el intervalo central [x₁, x₂] que contiene una probabilidad de ${ptxt(pv)}`,
      tails: `los valores críticos x₁ y x₂ que dejan en total una probabilidad α = ${ptxt(pv)} en las dos colas`,
    }[t];
    const ds = datosStep(o, null);
    ds.text += ` Se busca ${qWords}.`;
    ds.math.push(`${question} \\;\\Rightarrow\\; ${t === 'left' || t === 'right' ? 'x' : 'x_1,\\ x_2'} = \\ ?`);
    steps.push(ds);

    if (!(pv >= 0 && pv <= 1)) {
      steps.push(step('Dato no válido', { text: 'La probabilidad p debe estar entre 0 y 1.', final: true }));
      return;
    }
    // Mismos valores que muestra la aplicación
    const iv = D.inverseValues(d, p, t, pv);
    const result = t === 'left' || t === 'right' ? { value: iv.x } : { value: iv.x1, value2: iv.x2 };

    // Probabilidades acumuladas objetivo
    let targets;
    if (t === 'left') targets = [{ name: 'x', F: pv, side: 'L', x: result.value }];
    else if (t === 'right') targets = [{ name: 'x', F: 1 - pv, q: pv, side: 'R', x: result.value }];
    else {
      const alpha = t === 'central' ? 1 - pv : pv;
      targets = [
        { name: 'x_1', F: alpha / 2, side: 'L', x: result.value },
        { name: 'x_2', F: 1 - alpha / 2, q: alpha / 2, side: 'R', x: result.value2 },
      ];
      steps.push(step('Planteamiento', {
        text: t === 'central'
          ? 'La probabilidad que queda fuera del intervalo, α = 1 − p, se reparte por igual entre las dos colas:'
          : 'La probabilidad α se reparte por igual entre las dos colas:',
        math: [
          t === 'central' ? `\\alpha = 1 - ${PR(pv)} = ${PR(alpha)}` : `\\alpha = ${PR(pv)}`,
          `\\dfrac{\\alpha}{2} = ${PR(alpha / 2)}`,
          `F(x_1) = \\dfrac{\\alpha}{2} = ${PR(alpha / 2)}, \\qquad F(x_2) = 1 - \\dfrac{\\alpha}{2} = ${PR(1 - alpha / 2)}`,
        ],
      }));
    }
    if (t === 'right') {
      steps.push(step('Planteamiento', {
        text: 'La probabilidad a la derecha es el complemento de la acumulada:',
        math: [`P(X \\ge x) = 1 - F(x) = ${PR(pv)} \\;\\Rightarrow\\; F(x) = 1 - ${PR(pv)} = ${PR(1 - pv)}`],
      }));
    }

    if (discrete) discreteInverse(o, targets, steps);
    else continuousInverse(o, targets, steps);

    // Resultado
    const xs = targets.map((tg) => `${tg.name} = ${N(tg.x, 8)}`);
    let words;
    if (t === 'left') words = `El valor x = ${txt(result.value, 8)} deja una probabilidad acumulada de ${ptxt(pv)} a su izquierda (es el percentil ${txt(pv * 100, 6)}).`;
    else if (t === 'right') words = `El valor x = ${txt(result.value, 8)} deja una probabilidad de ${ptxt(pv)} a su derecha.`;
    else if (t === 'central') words = `El intervalo [${txt(result.value, 8)}, ${txt(result.value2, 8)}] contiene el ${pct(pv)} central de la distribución.`;
    else words = `Los valores críticos son ${txt(result.value, 8)} y ${txt(result.value2, 8)}: fuera de ellos queda una probabilidad α = ${ptxt(pv)}.`;
    steps.push(step('Resultado', { math: [`\\boxed{${xs.join(',\\quad ')}}`], text: words, final: true, value: result }));
  }

  function continuousInverse(o, targets, steps) {
    const { d, p } = o;
    const H = CONT[d.id];
    if (H.kind === 'z') {
      const zl = [], xl = [], notes = [];
      targets.forEach((tg) => {
        const z = tg.side === 'R' ? S.qnormUpper(tg.q) : S.qnorm(tg.F);
        tg.z = z;
        zl.push(`\\Phi(z) = ${PR(tg.F)} \\;\\Rightarrow\\; z = \\Phi^{-1}(${PR(tg.F)}) = \\boxed{${F.texFix(z, 4)}}`);
        if (isFinite(z) && Math.abs(z) < 3.5) notes.push(`Φ(z) = ${tg.F.toFixed(4)} → z ≈ ${z.toFixed(2)}`);
        xl.push(chain(tg.name, [...H.fromZ(z, p), N(tg.x, 8)]));
      });
      steps.push(step('Buscamos z en la tabla normal estándar', {
        text: 'Se usa la tabla al revés: se busca el área dentro de la tabla y se lee el valor de z:',
        math: zl,
        note: notes.length ? `En la tabla Z: ${notes.join('; ')}.` : '',
      }));
      steps.push(step('Despejamos x', {
        text: d.id === 'normal' ? 'De z = (x − μ)/σ se despeja x = μ + zσ:' : 'De z = (ln x − μ)/σ se despeja x = e^(μ + zσ):',
        math: xl,
      }));
      return;
    }
    if (H.inv) {
      steps.push(step('Despejamos x de F(x) = p', {
        text: 'Igualamos la función acumulada a la probabilidad buscada y despejamos x:',
        math: [`F(x) = ${H.Fgen}`, ...targets.map((tg) => chain(tg.name, H.inv(tg.F, p, tg.x)))],
      }));
    } else {
      steps.push(step('Resolvemos F(x) = p numéricamente', {
        text: 'F(x) no tiene una inversa en forma cerrada, así que se resuelve la ecuación con el método de Brent (búsqueda de raíces) hasta 15 cifras:',
        math: [`F(x) = ${H.Fgen}`, ...targets.map((tg) => `F(${tg.name}) = ${PR(tg.F)} \\;\\Rightarrow\\; ${tg.name} = ${N(tg.x, 8)}`)],
        note: H.note,
      }));
    }
    // Comprobación
    steps.push(step('Comprobación', {
      text: 'Sustituimos el resultado en F(x):',
      math: targets.map((tg) => {
        const v = d.cdf(tg.x, p);
        return chain(`F(${N(tg.x, 8)})`, H.evalF(tg.x, p, v, d).slice(-2));
      }),
    }));
  }

  function discreteInverse(o, targets, steps) {
    const { d, p } = o;
    const [sLo, sHi] = d.support(p);
    const Fk = (k) => (k < sLo ? 0 : d.cdf(k, p));
    const Sk = (k) => d.sf(k - 1, p); // P(X ≥ k)
    targets.forEach((tg) => {
      const k = tg.x;
      const lines = [];
      let text;
      if (o.inv.type === 'left' || (tg.side === 'L' && o.inv.type === 'central')) {
        // menor k con F(k) ≥ p  (central: mayor a con F(a−1) ≤ α/2)
        if (o.inv.type === 'left') {
          text = `Acumulamos P(X = 0) + P(X = 1) + … hasta que la suma alcance ${ptxt(tg.F)}: buscamos el menor k con F(k) ≥ ${ptxt(tg.F)}.`;
          if (k - 1 >= sLo) lines.push(`F(${k - 1}) = ${PR(Fk(k - 1))} < ${PR(tg.F)}`);
          lines.push(`F(${k}) = ${PR(Fk(k))} \\ge ${PR(tg.F)} \\;\\Rightarrow\\; x = \\boxed{${k}}`);
        } else {
          text = `Buscamos el mayor x₁ tal que la cola izquierda P(X < x₁) = F(x₁ − 1) no pase de α/2 = ${ptxt(tg.F)}.`;
          lines.push(`F(${k - 1}) = ${PR(Fk(k - 1))} \\le ${PR(tg.F)}`);
          lines.push(`F(${k}) = ${PR(Fk(k))} > ${PR(tg.F)} \\;\\Rightarrow\\; x_1 = \\boxed{${k}}`);
        }
      } else if (o.inv.type === 'tails' && tg.side === 'L') {
        text = `Buscamos el mayor x₁ con P(X ≤ x₁) ≤ α/2 = ${ptxt(tg.F)}.`;
        lines.push(`F(${k}) = ${PR(Fk(k))} \\le ${PR(tg.F)}`);
        lines.push(`F(${k + 1}) = ${PR(Fk(k + 1))} > ${PR(tg.F)} \\;\\Rightarrow\\; x_1 = \\boxed{${k}}`);
      } else if (o.inv.type === 'right') {
        text = `Buscamos el mayor k con P(X ≥ k) ≥ ${ptxt(tg.q)}, acumulando desde la derecha.`;
        if (k + 1 <= sHi) {
          lines.push(`P(X \\ge ${k}) = ${PR(Sk(k))} \\ge ${PR(tg.q)}`);
          lines.push(`P(X \\ge ${k + 1}) = ${PR(Sk(k + 1))} < ${PR(tg.q)} \\;\\Rightarrow\\; x = \\boxed{${k}}`);
        } else {
          lines.push(`P(X \\ge ${k}) = ${PR(Sk(k))} \\ge ${PR(tg.q)} \\;\\Rightarrow\\; x = \\boxed{${k}}`);
        }
      } else if (o.inv.type === 'central') {
        text = `Buscamos el menor x₂ tal que la cola derecha P(X > x₂) no pase de α/2 = ${ptxt(tg.q)}.`;
        lines.push(`P(X > ${k - 1}) = ${PR(d.sf(k - 1, p))} > ${PR(tg.q)}`);
        lines.push(`P(X > ${k}) = ${PR(d.sf(k, p))} \\le ${PR(tg.q)} \\;\\Rightarrow\\; x_2 = \\boxed{${k}}`);
      } else {
        text = `Buscamos el menor x₂ con P(X ≥ x₂) ≤ α/2 = ${ptxt(tg.q)}.`;
        lines.push(`P(X \\ge ${k - 1}) = ${PR(Sk(k - 1))} > ${PR(tg.q)}`);
        lines.push(`P(X \\ge ${k}) = ${PR(Sk(k))} \\le ${PR(tg.q)} \\;\\Rightarrow\\; x_2 = \\boxed{${k}}`);
      }
      const from = Math.max(sLo, k - 6), to = isFinite(sHi) ? Math.min(sHi, k + 3) : k + 3;
      const rows = [];
      for (let j = from; j <= to; j++) rows.push([String(j), F.prob(d.pmf(j, p), DEC), F.prob(Fk(j), DEC), F.prob(Sk(j), DEC)]);
      steps.push(step(targets.length > 1 ? `Buscamos ${tg.name === 'x_1' ? 'x₁' : 'x₂'}` : 'Acumulamos probabilidades', {
        text,
        math: lines,
        table: { title: 'Ver la tabla de probabilidades acumuladas', headers: ['k', 'P(X = k)', 'P(X ≤ k)', 'P(X ≥ k)'], rows, open: true },
      }));
    });
    steps.push(step('Nota', {
      text: 'En una distribución discreta la probabilidad acumulada avanza a saltos, así que normalmente no existe un valor que dé exactamente p: se elige el entero que cumple la condición.',
    }));
  }

  /* ------------------------------------------------------------------ */
  function build(o) {
    D = PD.dist; S = PD.special; F = PD.fmt;
    DEC = o.decimals || 6;
    const steps = [];
    if (o.mode === 'inverse') inverseSteps(o, steps);
    else if (o.d.type === 'discrete') discreteSteps(o, steps);
    else continuousSteps(o, steps);
    return { steps };
  }

  PD.procedure = { build, CONT, DISC };
})(typeof globalThis !== 'undefined' ? globalThis : this);
