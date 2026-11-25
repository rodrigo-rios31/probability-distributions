/* format.js — Formato de números para la interfaz y la gráfica. */
(function (root) {
  'use strict';
  const PD = (root.PD = root.PD || {});
  const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  const MINUS = '−';

  const sup = (s) => String(s).replace(/[-0-9]/g, (c) => SUP[c]);
  const minus = (s) => String(s).replace(/^-/, MINUS).replace(/(\s)-/g, `$1${MINUS}`);

  function stripZeros(s) {
    if (s.indexOf('e') >= 0) {
      const [m, e] = s.split('e');
      return stripZeros(m) + 'e' + e;
    }
    if (s.indexOf('.') < 0) return s;
    return s.replace(/0+$/, '').replace(/\.$/, '');
  }

  function sci(x, sig) {
    const [m, e] = x.toExponential(Math.max(0, sig - 1)).split('e');
    return `${minus(stripZeros(m))} × 10${sup(parseInt(e, 10))}`;
  }

  /** Número general con `sig` cifras significativas. */
  function num(x, sig = 6) {
    if (x === null || x === undefined) return '—';
    if (Number.isNaN(x)) return 'No definido';
    if (x === Infinity) return '∞';
    if (x === -Infinity) return MINUS + '∞';
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e-4 && a < 1e10) {
      if (Number.isInteger(x) && a < 1e15) return minus(String(x));
      return minus(stripZeros(x.toPrecision(sig)));
    }
    return sci(x, sig);
  }

  /** Probabilidad con `dec` decimales; notación científica si es diminuta. */
  function prob(p, dec = 6) {
    if (Number.isNaN(p)) return 'No definido';
    if (p === 0) return (0).toFixed(dec);
    if (p > 0 && p < 0.5 * Math.pow(10, -dec)) return sci(p, Math.min(dec, 10));
    return p.toFixed(dec);
  }

  /** Valor para colocar en un <input> (sin símbolos tipográficos). */
  function input(x) {
    if (!isFinite(x)) return '';
    if (Number.isInteger(x)) return String(x);
    const a = Math.abs(x);
    if (a !== 0 && (a < 1e-6 || a >= 1e12)) return stripZeros(x.toExponential(10));
    return stripZeros(x.toPrecision(12));
  }

  /** Etiqueta de marca de eje según el paso. */
  function tick(x, step) {
    if (Math.abs(x) < step * 1e-9) return '0';
    const a = Math.abs(x);
    if (a >= 1e6 || (a < 1e-4 && a > 0)) return sci(x, 3);
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    return minus(x.toFixed(Math.min(dec, 10)));
  }

  /* ---------------- Versiones para LaTeX (KaTeX) ---------------- */
  const UNSUP = { '⁻': '-', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

  /** Convierte un número ya formateado (con ×10ⁿ, −, ∞) a LaTeX. */
  function tex(s) {
    return String(s)
      .replace(/ × 10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (m, e) => `\\times 10^{${e.replace(/./g, (c) => UNSUP[c])}}`)
      .replace(/−/g, '-')
      .replace(/∞/g, '\\infty')
      .replace('No definido', '\\text{no definido}');
  }
  const texNum = (x, sig = 6) => tex(num(x, sig));
  const texProb = (p, dec = 6) => tex(prob(p, dec));
  /** Número con decimales fijos (p. ej. z = 1.6000). */
  const texFix = (x, dec) => (isFinite(x) ? tex(minus(x.toFixed(dec))) : texNum(x));

  /**
   * Número representado por su log10 (para cantidades que desbordan el
   * punto flotante, como 100! o C(5000, 2000)).
   */
  function texFromLog10(l10, sig = 6) {
    if (!isFinite(l10)) return l10 > 0 ? '\\infty' : '0';
    if (l10 > -4 && l10 < 10) return texNum(Math.pow(10, l10), sig);
    let e = Math.floor(l10);
    let m = Math.pow(10, l10 - e);
    let ms = stripZeros(m.toPrecision(sig));
    if (parseFloat(ms) >= 10) { e += 1; ms = stripZeros((m / 10).toPrecision(sig)); }
    return `${ms} \\times 10^{${e}}`;
  }

  PD.fmt = { num, prob, input, tick, sup, minus, MINUS, tex, texNum, texProb, texFix, texFromLog10 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
