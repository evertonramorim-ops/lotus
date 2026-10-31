/**
 * Gerador pseudoaleatório determinístico para SIMULAÇÃO ESTATÍSTICA (dados sintéticos).
 *
 * Algoritmo: xoshiro128** 1.0 (Blackman & Vigna, 2018/2021), estado de 128 bits (4×uint32),
 * semeado por SplitMix64 (Steele, Lea & Flood, 2014) a partir de uma semente inteira de até 64 bits.
 *
 * AVISO: NÃO é criptográfico. Não use para segurança, chaves, tokens ou sorteios reais.
 * Destina-se exclusivamente à reprodutibilidade de experimentos estatísticos sintéticos.
 * Math.random NÃO é utilizado.
 * @module sim/prng
 */

export const GENERATOR_ID = 'xoshiro128**/splitmix64';
export const GENERATOR_VERSION = '1.0.0';
const M64 = (1n << 64n) - 1n;

/**
 * Normaliza semente para BigInt em [0, 2^64).
 * @param {number|bigint} seed inteiro não negativo (Number seguro ou BigInt < 2^64)
 * @returns {bigint}
 */
export function normalizeSeed(seed) {
  if (typeof seed === 'number') { if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError('semente deve ser inteiro seguro ≥ 0'); return BigInt(seed); }
  if (typeof seed === 'bigint') { if (seed < 0n || seed > M64) throw new RangeError('semente BigInt deve estar em [0, 2^64)'); return seed; }
  throw new TypeError('semente deve ser number inteiro ou bigint');
}

/**
 * Passo SplitMix64. @param {bigint} state @returns {[bigint, bigint]} [novoEstado, saída]
 */
export function splitmix64(state) {
  const s = (state + 0x9e3779b97f4a7c15n) & M64;
  let z = s;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
  return [s, z ^ (z >> 31n)];
}

/** FNV-1a 64 bits de uma string (para derivar sub-sementes rotuladas). @param {string} str @returns {bigint} */
function fnv1a64(str) { let h = 0xcbf29ce484222325n; for (const b of new TextEncoder().encode(str)) { h ^= BigInt(b); h = (h * 0x100000001b3n) & M64; } return h; }

/**
 * Deriva semente filha determinística a partir de semente-mãe e rótulo (ex.: "rep:17").
 * @param {number|bigint} seed @param {string} label @returns {bigint}
 */
export function deriveSeed(seed, label) { const [, out] = splitmix64(normalizeSeed(seed) ^ fnv1a64(String(label))); return out; }

const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** Gerador xoshiro128**. */
export class Xoshiro128ss {
  /** @param {number|bigint} seed */
  constructor(seed) {
    this.seed = normalizeSeed(seed);
    let st = this.seed, a, b;
    [st, a] = splitmix64(st); [st, b] = splitmix64(st);
    this.s = new Uint32Array([Number(a & 0xffffffffn), Number(a >> 32n), Number(b & 0xffffffffn), Number(b >> 32n)]);
    if ((this.s[0] | this.s[1] | this.s[2] | this.s[3]) === 0) this.s[0] = 1; // estado nulo é inválido (praticamente impossível)
  }
  /** Cria a partir de estado bruto (testes de vetor conhecido). @param {number[]} st */
  static fromState(st) { const g = Object.create(Xoshiro128ss.prototype); g.seed = null; g.s = new Uint32Array(st); return g; }
  /** Próximo uint32. @returns {number} */
  nextUint32() {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 11);
    return result;
  }
  /**
   * Inteiro uniforme em [0, n) SEM viés de módulo, por rejeição:
   * aceita x < L = 2^32 − (2^32 mod n); então x mod n é exatamente uniforme.
   * Probabilidade de rejeição < n/2^32.
   * @param {number} n inteiro em [1, 2^32]
   */
  uniformInt(n) {
    if (!Number.isInteger(n) || n < 1 || n > 4294967296) throw new RangeError('n deve ser inteiro em [1, 2^32]');
    const limit = rejectionLimit(n);
    for (;;) { const x = this.nextUint32(); if (x < limit) return x % n; }
  }
  /** Real uniforme em [0,1) com 53 bits. */
  nextFloat() { const a = this.nextUint32() >>> 5, b = this.nextUint32() >>> 6; return (a * 67108864 + b) / 9007199254740992; }
}

/** L = 2^32 − (2^32 mod n): maior múltiplo de n ≤ 2^32. @param {number} n */
export function rejectionLimit(n) { return 4294967296 - (4294967296 % n); }

/** Fábrica. @param {number|bigint} seed */
export function createRng(seed) { return new Xoshiro128ss(seed); }
