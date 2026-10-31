/**
 * Motor combinatório exato com BigInt (LOTUS — Fase 1).
 * Todas as funções validam entradas e nunca usam ponto flutuante para cálculo.
 * @module math/bigint
 */

/**
 * Converte e valida um inteiro não negativo (number inteiro seguro ou bigint).
 * @param {number|bigint} v
 * @param {string} name nome do parâmetro (mensagens de erro)
 * @returns {bigint}
 * @throws {TypeError|RangeError}
 */
export function toNonNegBigInt(v, name = 'valor') {
  if (typeof v === 'bigint') { if (v < 0n) throw new RangeError(`${name} deve ser >= 0`); return v; }
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new TypeError(`${name} deve ser inteiro`);
  if (!Number.isSafeInteger(v)) throw new RangeError(`${name} fora do intervalo seguro`);
  if (v < 0) throw new RangeError(`${name} deve ser >= 0`);
  return BigInt(v);
}

/**
 * n! exato.
 * @param {number|bigint} n inteiro >= 0
 * @returns {bigint}
 */
export function factorial(n) {
  const N = toNonNegBigInt(n, 'n');
  let r = 1n; for (let i = 2n; i <= N; i++) r *= i; return r;
}

/**
 * Coeficiente binomial C(n,k) exato. Retorna 0n se k > n.
 * @param {number|bigint} n inteiro >= 0
 * @param {number|bigint} k inteiro >= 0
 * @returns {bigint}
 */
export function binomial(n, k) {
  const N = toNonNegBigInt(n, 'n'); let K = toNonNegBigInt(k, 'k');
  if (K > N) return 0n;
  if (K > N - K) K = N - K;
  let r = 1n;
  for (let i = 1n; i <= K; i++) r = (r * (N - K + i)) / i; // divisão sempre exata
  return r;
}

/**
 * Arranjos P(n,k) = n!/(n-k)! exato. Retorna 0n se k > n.
 * @param {number|bigint} n
 * @param {number|bigint} k
 * @returns {bigint}
 */
export function permutations(n, k) {
  const N = toNonNegBigInt(n, 'n'); const K = toNonNegBigInt(k, 'k');
  if (K > N) return 0n;
  let r = 1n; for (let i = 0n; i < K; i++) r *= N - i; return r;
}

/**
 * Máximo divisor comum (sempre >= 0).
 * @param {bigint} a
 * @param {bigint} b
 * @returns {bigint}
 */
export function gcd(a, b) {
  if (typeof a !== 'bigint' || typeof b !== 'bigint') throw new TypeError('gcd exige bigint');
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Fração racional exata, sempre reduzida, denominador > 0. Imutável.
 */
export class Fraction {
  /**
   * @param {bigint|number} num numerador
   * @param {bigint|number} [den=1n] denominador (≠ 0)
   */
  constructor(num, den = 1n) {
    let n = typeof num === 'bigint' ? num : (Number.isSafeInteger(num) ? BigInt(num) : (() => { throw new TypeError('numerador inválido'); })());
    let d = typeof den === 'bigint' ? den : (Number.isSafeInteger(den) ? BigInt(den) : (() => { throw new TypeError('denominador inválido'); })());
    if (d === 0n) throw new RangeError('denominador zero');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    /** @readonly @type {bigint} */ this.num = n / g;
    /** @readonly @type {bigint} */ this.den = d / g;
    Object.freeze(this);
  }
  /** @param {Fraction} o @returns {Fraction} */
  add(o) { return new Fraction(this.num * o.den + o.num * this.den, this.den * o.den); }
  /** @param {Fraction} o @returns {Fraction} */
  sub(o) { return new Fraction(this.num * o.den - o.num * this.den, this.den * o.den); }
  /** @param {Fraction} o @returns {Fraction} */
  mul(o) { return new Fraction(this.num * o.num, this.den * o.den); }
  /** @param {Fraction} o @returns {Fraction} */
  div(o) { if (o.num === 0n) throw new RangeError('divisão por zero'); return new Fraction(this.num * o.den, this.den * o.num); }
  /** Comparação exata. @param {Fraction} o @returns {-1|0|1} */
  compare(o) { const a = this.num * o.den, b = o.num * this.den; return a < b ? -1 : a > b ? 1 : 0; }
  /** @param {Fraction} o @returns {boolean} */
  equals(o) { return this.num === o.num && this.den === o.den; }
  /** @returns {boolean} */
  isZero() { return this.num === 0n; }
  /** "num/den" exato. @returns {string} */
  toString() { return this.den === 1n ? `${this.num}` : `${this.num}/${this.den}`; }
  /**
   * Representação decimal com `digits` casas, TRUNCADA (não arredonda) — controle exato,
   * sem ponto flutuante. Ex.: 1/3 com 5 casas → "0.33333".
   * @param {number} [digits=20] 0..10000
   * @returns {string}
   */
  toDecimalString(digits = 20) {
    if (!Number.isInteger(digits) || digits < 0 || digits > 10000) throw new RangeError('digits inválido');
    const neg = this.num < 0n; let n = neg ? -this.num : this.num;
    let s = (n / this.den).toString(); let r = n % this.den;
    if (digits > 0) { s += '.'; for (let i = 0; i < digits; i++) { r *= 10n; s += (r / this.den).toString(); r %= this.den; } }
    return (neg && /[1-9]/.test(s) ? '-' : '') + s;
  }
  /**
   * Aproximação IEEE-754 double. Precisão: erro relativo ≤ ~2^-52 (≈1e-16), pois
   * o cálculo é feito por escala BigInt de 2^64 bits significativos antes da conversão.
   * Use apenas para exibição/gráficos; nunca para comparações exatas.
   * @returns {number}
   */
  toNumber() {
    if (this.num === 0n) return 0;
    const neg = this.num < 0n; const n = neg ? -this.num : this.num;
    // escala para obter ~64 bits significativos no quociente
    const shift = BigInt(this.den.toString(2).length - n.toString(2).length + 64);
    const q = shift >= 0n ? (n << shift) / this.den : n / (this.den << -shift);
    const v = Number(q) * Math.pow(2, -Number(shift));
    return neg ? -v : v;
  }
  /**
   * Valor X tal que a probabilidade é "1 em X" (= den/num), como Fraction.
   * @returns {Fraction}
   */
  inverse() { if (this.num === 0n) throw new RangeError('inverso de zero'); return new Fraction(this.den, this.num); }
}
