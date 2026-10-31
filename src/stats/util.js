/**
 * Utilitários numéricos da Fase 2 (dados SINTÉTICOS). Sem dependências externas.
 * @module stats/util
 */
import { binomial, Fraction } from '../math/bigint.js';
import { hypergeometricDistribution } from '../math/hypergeometric.js';

export const STATS_MODULE_VERSION = '2.0.0';

/** Quantil da normal padrão (Acklam, erro relativo < 1.2e-9). Usado só no IC de Wilson. @param {number} p */
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new RangeError('p deve estar em (0,1)');
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) return -normalQuantile(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Intervalo de Wilson (1927) para proporção binomial x/n, confiança 1−alpha.
 * @param {number} x @param {number} n @param {number} [alpha=0.05]
 */
export function wilsonInterval(x, n, alpha = 0.05) {
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(x) || x < 0 || x > n) throw new RangeError('x,n inválidos');
  if (!(alpha > 0 && alpha < 1)) throw new RangeError('alpha deve estar em (0,1)');
  const z = normalQuantile(1 - alpha / 2), z2 = z * z, ph = x / n;
  const den = 1 + z2 / n, center = (ph + z2 / (2 * n)) / den;
  const half = (z / den) * Math.sqrt(ph * (1 - ph) / n + z2 / (4 * n * n));
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half), confidence: 1 - alpha, method: 'wilson-1927' };
}

/** PMF completa Binomial(n,p) em ponto flutuante (recorrência em log). @param {number} n @param {number} p @returns {Float64Array} */
export function binomialPmfArray(n, p) {
  const out = new Float64Array(n + 1);
  if (p === 0) { out[0] = 1; return out; } if (p === 1) { out[n] = 1; return out; }
  const lr = Math.log(p / (1 - p)); let lf = n * Math.log1p(-p); const logs = new Float64Array(n + 1);
  logs[0] = lf; for (let x = 0; x < n; x++) { lf += Math.log((n - x) / (x + 1)) + lr; logs[x + 1] = lf; }
  for (let x = 0; x <= n; x++) out[x] = Math.exp(logs[x]);
  return out;
}

/**
 * Valor-p bilateral EXATO do teste binomial (método "mínima verossimilhança", como binom.test do R):
 * soma de P(X=x) para todo x com P(X=x) ≤ P(X=obs)·(1+1e-7).
 * @param {number} obs @param {Float64Array} pmf
 */
export function binomialTwoSidedP(obs, pmf) {
  const t = pmf[obs] * (1 + 1e-7); let s = 0;
  for (let x = 0; x < pmf.length; x++) if (pmf[x] <= t) s += pmf[x];
  return Math.min(1, s);
}

/**
 * Cotas EXATAS [lo,hi] para X~Binomial(n,p) tais que P(X<lo) ≤ delta/2 e P(X>hi) ≤ delta/2.
 * Usadas como tolerâncias matematicamente justificadas nos testes (sem aproximação normal).
 * @param {number} n @param {number} p @param {number} delta
 */
export function binomialBounds(n, p, delta) {
  const pmf = binomialPmfArray(n, p); let lo = 0, acc = 0;
  while (lo <= n && acc + pmf[lo] <= delta / 2) { acc += pmf[lo]; lo++; }
  let hi = n; acc = 0;
  while (hi >= 0 && acc + pmf[hi] <= delta / 2) { acc += pmf[hi]; hi--; }
  return { lo, hi };
}

/** Distância de variação total ½Σ|a−b|. @param {number[]} a @param {number[]} b */
export function totalVariation(a, b) { let s = 0; const n = Math.max(a.length, b.length); for (let i = 0; i < n; i++) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0)); return s / 2; }

/** Converte contagens BigInt (total comum) em probabilidades Number exatas até ~1e-16. @param {bigint[]} counts @param {bigint} total */
export function countsToProbs(counts, total) { return counts.map(c => new Fraction(c, total).toNumber()); }

/** Hipergeométrica como array de Number. @param {number} N @param {number} K @param {number} n */
export function hyperProbs(N, K, n) { return hypergeometricDistribution(N, K, n).map(r => r.p.toNumber()); }

export { binomial };

/** Arredonda para 12 algarismos significativos (estabilidade do JSON canônico). @param {number} x */
export function round12(x) { return Number.isFinite(x) && x !== 0 ? Number(x.toPrecision(12)) : x; }

/** Serialização JSON canônica: chaves ordenadas, números arredondados, BigInt como string. */
export function canonicalJSON(v) {
  const norm = x => {
    if (typeof x === 'bigint') return x.toString();
    if (typeof x === 'number') return round12(x);
    if (Array.isArray(x)) return x.map(norm);
    if (ArrayBuffer.isView(x)) return Array.from(x, norm);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) if (x[k] !== undefined) o[k] = norm(x[k]); return o; }
    return x;
  };
  return JSON.stringify(norm(v), null, 2) + '\n';
}
