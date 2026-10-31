/**
 * Distribuições estruturais de sorteios SINTÉTICOS e suas referências EXATAS sob o modelo uniforme
 * (contagem combinatória com BigInt; nenhuma suposição de normalidade):
 *  - soma: programação dinâmica sobre k-subconjuntos;
 *  - paridade: hipergeométrica(N, #pares, k);
 *  - faixas: nº de dezenas na faixa b ~ hipergeométrica(N, |b|, k);
 *  - consecutivos (pares adjacentes j): C(k−1, j)·C(N−k+1, k−j)   [sucessões em k-subconjuntos];
 *  - amplitude a = max−min: (N−a)·C(a−1, k−2)  (k ≥ 2);
 *  - repetição entre concursos consecutivos / sobreposição com defasagem L: hipergeométrica(N, k, k).
 * Também há referência por SIMULAÇÃO do próprio modelo uniforme (semente independente).
 * @module stats/structural
 */
import { getLottery } from '../lotteries/config.js';
import { binomial } from '../math/bigint.js';
import { countsToProbs, hyperProbs, totalVariation } from './util.js';
import { DATA_KIND, drawStream } from '../sim/sampler.js';

/** Tamanho da faixa: 5 na Lotofácil (5 faixas), 10 nas demais. @param {string} id */
export function bandSize(id) { return getLottery(id).universe === 25 ? 5 : 10; }

const memo = new Map();
/** Distribuições exatas (probabilidades Number) para a modalidade. @param {string} id */
export function exactStructural(id) {
  if (memo.has(id)) return memo.get(id);
  const r = getLottery(id); const out = exactStructuralGeneric({ N: r.universe, k: r.draw, min: r.minNumber, band: bandSize(id) });
  memo.set(id, out); return out;
}

/**
 * Versão genérica (universo {min..min+N−1}, k sorteadas) — usada também nos testes de força bruta.
 * @param {{N:number,k:number,min:number,band:number}} o
 */
export function exactStructuralGeneric({ N, k, min, band }) {
  const r = { maxNumber: min + N - 1 }; const total = binomial(N, k), m = min;
  // soma: dp[j][s] = nº de j-subconjuntos dos valores vistos com soma s
  const maxSum = k * r.maxNumber; let dp = Array.from({ length: k + 1 }, () => new Array(maxSum + 1).fill(0n)); dp[0][0] = 1n;
  for (let v = m; v <= r.maxNumber; v++) for (let j = Math.min(k, v - m + 1); j >= 1; j--) { const a = dp[j], b = dp[j - 1]; for (let s = maxSum; s >= v; s--) if (b[s - v]) a[s] += b[s - v]; }
  const minSum = k * m + (k * (k - 1)) / 2; const sumCounts = dp[k].slice(minSum); // índice = soma − minSum
  const evens = Array.from({ length: N }, (_, i) => i + m).filter(x => x % 2 === 0).length;
  const consecutive = []; for (let j = 0; j <= k - 1; j++) consecutive.push(binomial(k - 1, j) * binomial(N - k + 1, k - j));
  const amplitude = new Array(N).fill(0n); for (let a = k - 1; a <= N - 1; a++) amplitude[a] = k >= 2 ? BigInt(N - a) * binomial(a - 1, k - 2) : (a === 0 ? BigInt(N) : 0n);
  const out = {
    sum: { offset: minSum, probs: countsToProbs(sumCounts, total), mean: k * (m + r.maxNumber) / 2 },
    parity_even: hyperProbs(N, evens, k), evens_in_universe: evens,
    band: hyperProbs(N, band, k), band_size: band,
    consecutive: countsToProbs(consecutive, total),
    amplitude: countsToProbs(amplitude, total),
    repetition: hyperProbs(N, k, k),
  };
  return out;
}

/** Acumulador em fluxo das estatísticas estruturais. */
export class StructuralAccumulator {
  /** @param {string} id @param {{lags?:number[]}} [o] */
  constructor(id, { lags = [1, 2, 5] } = {}) {
    const r = this.r = getLottery(id); this.lags = lags; const N = r.universe, k = r.draw;
    if (!Array.isArray(lags) || lags.some(l => !Number.isInteger(l) || l < 1 || l > 1000)) throw new RangeError('lags inválidos');
    this.bs = bandSize(id); this.nb = N / this.bs;
    this.sum = new Float64Array(k * r.maxNumber + 1); this.parity = new Float64Array(k + 1);
    this.band = Array.from({ length: this.nb }, () => new Float64Array(k + 1));
    this.consecutive = new Float64Array(k); this.amplitude = new Float64Array(N);
    this.overlap = Object.fromEntries(lags.map(l => [l, new Float64Array(k + 1)]));
    this.maxLag = Math.max(...lags); this.ring = []; this.draws = 0; this.sumTotal = 0;
  }
  /** @param {number[]} d dezenas ordenadas */
  add(d) {
    const r = this.r; let s = 0, ev = 0, cons = 0; const bc = new Array(this.nb).fill(0);
    for (let i = 0; i < d.length; i++) { const x = d[i]; s += x; if (x % 2 === 0) ev++; bc[Math.floor((x - r.minNumber) / this.bs)]++; if (i > 0 && d[i - 1] === x - 1) cons++; }
    this.sum[s]++; this.sumTotal += s; this.parity[ev]++; for (let b = 0; b < this.nb; b++) this.band[b][bc[b]]++;
    this.consecutive[cons]++; this.amplitude[d[d.length - 1] - d[0]]++;
    const set = new Set(d);
    for (const l of this.lags) if (this.ring.length >= l) { const prev = this.ring[this.ring.length - l]; let o = 0; for (const x of prev) if (set.has(x)) o++; this.overlap[l][o]++; }
    this.ring.push(d); if (this.ring.length > this.maxLag) this.ring.shift();
    this.draws++;
  }
}

function compare(hist, probs, offset = 0) {
  let n = 0; for (const c of hist) n += c; if (n === 0) return null;
  const emp = new Array(probs.length).fill(0); let outside = 0;
  for (let i = 0; i < hist.length; i++) { if (!hist[i]) continue; const j = i - offset; if (j >= 0 && j < probs.length) emp[j] = hist[i] / n; else outside += hist[i]; }
  let me = 0, mt = 0; for (let j = 0; j < probs.length; j++) { me += (j + offset) * emp[j]; mt += (j + offset) * probs[j]; }
  let maxAbs = 0; for (let j = 0; j < probs.length; j++) maxAbs = Math.max(maxAbs, Math.abs(emp[j] - probs[j]));
  return { n, total_variation: totalVariation(emp, probs), max_abs_diff: maxAbs, mean_empirical: me, mean_exact: mt, outside_support: outside };
}

/**
 * Relatório: empírico vs. exato (e opcionalmente vs. referência simulada).
 * @param {StructuralAccumulator} acc @param {{includeHistograms?:boolean}} [o]
 */
export function structuralReport(acc, { includeHistograms = false } = {}) {
  const ex = exactStructural(acc.r.id);
  const rep = {
    data_kind: DATA_KIND, lottery: acc.r.id, draws: acc.draws,
    sum: compare(acc.sum, ex.sum.probs, ex.sum.offset),
    parity_even_count: compare(acc.parity, ex.parity_even),
    bands: acc.band.map((h, b) => ({ band: b, from: acc.r.minNumber + b * acc.bs, to: acc.r.minNumber + (b + 1) * acc.bs - 1, ...compare(h, ex.band) })),
    consecutive_pairs: compare(acc.consecutive, ex.consecutive),
    amplitude: compare(acc.amplitude, ex.amplitude),
    overlap_by_lag: Object.fromEntries(acc.lags.map(l => [String(l), compare(acc.overlap[l], ex.repetition)])),
  };
  rep.repetition_consecutive = rep.overlap_by_lag['1'] ?? null;
  if (includeHistograms) rep.histograms = { parity: Array.from(acc.parity), consecutive: Array.from(acc.consecutive), repetition: acc.overlap[1] ? Array.from(acc.overlap[1]) : null };
  return rep;
}

/** Referência estrutural por SIMULAÇÃO do modelo uniforme (semente própria). */
export function simulatedStructuralReference({ lottery, seed, draws }) {
  const acc = new StructuralAccumulator(lottery); for (const d of drawStream({ lottery, seed, draws })) acc.add(d); return acc;
}

/** TVD entre dois acumuladores (ex.: observado vs. referência simulada). */
export function compareAccumulators(a, b) {
  const tv = (x, y) => { let nx = 0, ny = 0; for (const c of x) nx += c; for (const c of y) ny += c; let s = 0; for (let i = 0; i < Math.max(x.length, y.length); i++) s += Math.abs((x[i] ?? 0) / nx - (y[i] ?? 0) / ny); return s / 2; };
  return { data_kind: DATA_KIND, sum: tv(a.sum, b.sum), parity: tv(a.parity, b.parity), consecutive: tv(a.consecutive, b.consecutive), amplitude: tv(a.amplitude, b.amplitude), repetition: a.overlap[1] && b.overlap[1] ? tv(a.overlap[1], b.overlap[1]) : null };
}
