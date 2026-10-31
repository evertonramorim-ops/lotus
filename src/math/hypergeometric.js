/**
 * Distribuição hipergeométrica exata.
 * População N, K "sucessos" (ex.: números apostados), n sorteios sem reposição.
 * X = número de acertos. P(X=k) = C(K,k)·C(N−K,n−k) / C(N,n).
 * @module math/hypergeometric
 */
import { binomial, toNonNegBigInt, Fraction } from './bigint.js';

/** @param {number} N @param {number} K @param {number} n */
function validate(N, K, n) {
  const NN = toNonNegBigInt(N, 'N'), KK = toNonNegBigInt(K, 'K'), nn = toNonNegBigInt(n, 'n');
  if (KK > NN) throw new RangeError('K não pode exceder N');
  if (nn > NN) throw new RangeError('n não pode exceder N');
  return [Number(NN), Number(KK), Number(nn)];
}

/**
 * Suporte [min,max] de X.
 * @param {number} N @param {number} K @param {number} n
 * @returns {{min:number,max:number}}
 */
export function support(N, K, n) { [N, K, n] = validate(N, K, n); return { min: Math.max(0, n - (N - K)), max: Math.min(K, n) }; }

/**
 * Número de combinações (casos favoráveis) com exatamente k acertos: C(K,k)·C(N−K,n−k).
 * @param {number} N @param {number} K @param {number} n @param {number} k
 * @returns {bigint}
 */
export function hypergeometricCount(N, K, n, k) {
  [N, K, n] = validate(N, K, n);
  if (!Number.isInteger(k)) throw new TypeError('k deve ser inteiro');
  if (k < 0 || k > n) return 0n;
  return binomial(K, k) * binomial(N - K, n - k);
}

/**
 * P(X=k) exata.
 * @param {number} N @param {number} K @param {number} n @param {number} k
 * @returns {Fraction}
 */
export function hypergeometricPmf(N, K, n, k) {
  return new Fraction(hypergeometricCount(N, K, n, k), binomial(N, n));
}

/**
 * Distribuição completa para k=0..n.
 * @param {number} N @param {number} K @param {number} n
 * @returns {{k:number,count:bigint,total:bigint,p:Fraction}[]}
 */
export function hypergeometricDistribution(N, K, n) {
  [N, K, n] = validate(N, K, n);
  const total = binomial(N, n); const out = [];
  for (let k = 0; k <= n; k++) { const count = hypergeometricCount(N, K, n, k); out.push({ k, count, total, p: new Fraction(count, total) }); }
  return out;
}

/**
 * E(X) exata calculada pela soma Σ k·P(k) (e igual a K·n/N).
 * @param {number} N @param {number} K @param {number} n
 * @returns {Fraction}
 */
export function expectation(N, K, n) {
  return hypergeometricDistribution(N, K, n).reduce((a, r) => a.add(r.p.mul(new Fraction(BigInt(r.k)))), new Fraction(0n));
}

/**
 * Var(X) exata = E(X²) − E(X)² (calculada pela soma).
 * Fórmula fechada equivalente: n·(K/N)·((N−K)/N)·((N−n)/(N−1)).
 * @param {number} N @param {number} K @param {number} n
 * @returns {Fraction}
 */
export function variance(N, K, n) {
  const d = hypergeometricDistribution(N, K, n);
  const e2 = d.reduce((a, r) => a.add(r.p.mul(new Fraction(BigInt(r.k * r.k)))), new Fraction(0n));
  const e = expectation(N, K, n);
  return e2.sub(e.mul(e));
}
