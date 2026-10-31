/**
 * Laboratório de testes de hipóteses sobre dados SINTÉTICOS.
 * H0: concursos gerados por mecanismo uniforme, independentes entre si, sem reposição em cada concurso.
 * H1: desvio qualquer do modelo uniforme especificado.
 *
 * Estatísticas (todas calculadas em fluxo):
 *  - freq_pearson  X = Σ_i (O_i − E)²/E, E = D·k/N  (sob H0, E[X] = N − k, NÃO N−1: dependência intra-concurso);
 *  - parity_pearson: Pearson do nº de pares por concurso vs. hipergeométrica exata;
 *  - repetition_pearson: Pearson da repetição entre concursos consecutivos vs. hipergeométrica(N,k,k);
 *  - sum_mean_absdev: |média das somas − E[soma]|.
 * Valor-p por Monte Carlo reproduzindo EXATAMENTE o mecanismo (Fisher-Yates parcial): p = (b+1)/(B+1),
 * b = nº de réplicas com estatística ≥ observada. Resolução mínima 1/(B+1). NÃO se usa a tabela qui-quadrado.
 * @module stats/hypothesis
 */
import { getLottery } from '../lotteries/config.js';
import { exactStructural } from './structural.js';
import { drawStream, deriveSeed, DATA_KIND, checkDraws } from '../sim/sampler.js';
import { wilsonInterval } from './util.js';

export const STATISTICS = Object.freeze(['freq_pearson', 'parity_pearson', 'repetition_pearson', 'sum_mean_absdev']);
export const MAX_REPLICATES = 100_000;

/** Acumulador das estatísticas globais. */
export class GlobalStatsAccumulator {
  /** @param {string} id */
  constructor(id) { const r = this.r = getLottery(id); this.counts = new Float64Array(r.universe); this.par = new Float64Array(r.draw + 1); this.rep = new Float64Array(r.draw + 1); this.prev = null; this.sum = 0; this.draws = 0; this.mark = new Uint8Array(r.universe); }
  /** @param {number[]} d */
  add(d) {
    const m = this.r.minNumber; let ev = 0, o = 0;
    for (const x of d) { this.counts[x - m]++; this.sum += x; if (x % 2 === 0) ev++; if (this.mark[x - m]) o++; }
    this.par[ev]++; if (this.prev) { this.rep[o]++; for (const x of this.prev) this.mark[x - m] = 0; }
    for (const x of d) this.mark[x - m] = 1; this.prev = d; this.draws++;
  }
  /** @returns {Record<string, number>} */
  statistics() {
    const r = this.r, D = this.draws, ex = exactStructural(r.id), E = D * r.draw / r.universe;
    let f = 0; for (const c of this.counts) f += (c - E) ** 2 / E;
    const pear = (h, probs, n) => { let s = 0; for (let i = 0; i < probs.length; i++) { if (probs[i] > 0) s += (h[i] - n * probs[i]) ** 2 / (n * probs[i]); } return s; };
    return { freq_pearson: f, parity_pearson: pear(this.par, ex.parity_even, D), repetition_pearson: D > 1 ? pear(this.rep, ex.repetition, D - 1) : 0, sum_mean_absdev: Math.abs(this.sum / D - ex.sum.mean) };
  }
}

/** Estatísticas de um fluxo de concursos. @param {string} lottery @param {Iterable<number[]>} draws */
export function computeStatistics(lottery, draws) { const a = new GlobalStatsAccumulator(lottery); for (const d of draws) a.add(d); return { stats: a.statistics(), acc: a }; }

/** @param {number} B */
export function checkReplicates(B) { if (!Number.isInteger(B) || B < 1 || B > MAX_REPLICATES) throw new RangeError(`B deve ser inteiro em [1, ${MAX_REPLICATES}]`); }

/**
 * Distribuição nula por Monte Carlo (B réplicas de D concursos uniformes; sementes derivadas).
 * @param {{lottery:string, draws:number, B:number, seed:number|bigint}} o
 * @returns {Record<string, Float64Array>}
 */
export function nullDistribution({ lottery, draws, B, seed }) {
  checkDraws(draws); checkReplicates(B);
  const out = Object.fromEntries(STATISTICS.map(s => [s, new Float64Array(B)]));
  for (let b = 0; b < B; b++) { const { stats } = computeStatistics(lottery, drawStream({ lottery, seed: deriveSeed(seed, `null:${b}`), draws })); for (const s of STATISTICS) out[s][b] = stats[s]; }
  return out;
}

/** p = (b+1)/(B+1), b = #{T_sim ≥ T_obs} (tolerância relativa 1e-12 p/ empates numéricos). */
export function mcPValue(obs, nullVals) { let b = 0; const t = obs - 1e-12 * Math.max(1, Math.abs(obs)); for (const v of nullVals) if (v >= t) b++; return { b, B: nullVals.length, p: (b + 1) / (nullVals.length + 1), resolution: 1 / (nullVals.length + 1) }; }

/**
 * Teste completo de uniformidade com Monte Carlo.
 * @param {{lottery:string, observed:Record<string,number>, draws:number, B:number, seed:number|bigint, alpha?:number, nullDist?:Record<string,Float64Array>}} o
 */
export function uniformityTest({ lottery, observed, draws, B, seed, alpha = 0.05, nullDist }) {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError('alpha deve estar em (0,1)');
  const r = getLottery(lottery); const nd = nullDist ?? nullDistribution({ lottery, draws, B, seed });
  const tests = STATISTICS.map(s => {
    const mc = mcPValue(observed[s], nd[s]);
    const ci = wilsonInterval(mc.b, mc.B, 0.05);
    let mean = 0; for (const v of nd[s]) mean += v; mean /= nd[s].length;
    return { statistic: s, observed: observed[s], null_mean_mc: mean, ...mc, p_value_mc_ci95: [ci.lower, ci.upper], reject: mc.p <= alpha };
  });
  const X = observed.freq_pearson, n = draws * r.draw;
  const effect = { cramers_v_like: Math.sqrt(X / (n * (r.universe - 1))), excess_over_null_mean: (X - (r.universe - r.draw)) / (r.universe - r.draw), definition: 'V=√(X/(D·k·(N−1))); excesso=(X−(N−k))/(N−k), E_H0[X]=N−k' };
  return { data_kind: DATA_KIND, lottery: r.id, draws, alpha, mc_replicates: nd.freq_pearson.length, p_value_formula: '(b+1)/(B+1)', p_value_resolution: 1 / (nd.freq_pearson.length + 1), hypotheses: { H0: 'uniforme, independente entre concursos, sem reposição no concurso', H1: 'desvio do modelo uniforme especificado' }, tests, effect_size: effect };
}
