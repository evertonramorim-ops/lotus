/**
 * Distribuição de acertos empírica (SINTÉTICA) vs. hipergeométrica exata da Fase 1.
 * Aposta fixa = as K primeiras dezenas do volante (por simetria do modelo uniforme, qualquer
 * aposta fixa de K dezenas tem a mesma distribuição de acertos).
 * @module stats/hits
 */
import { assertBetSize } from '../lotteries/config.js';
import { hitDistribution } from '../math/bets.js';
import { totalVariation } from './util.js';
import { DATA_KIND } from '../sim/sampler.js';

export class HitAccumulator {
  /** @param {string} lotteryId @param {number} betSize */
  constructor(lotteryId, betSize) {
    this.r = assertBetSize(lotteryId, betSize); this.betSize = betSize;
    this.limit = this.r.minNumber + betSize; // aposta = {min..min+K−1}
    this.hist = new Float64Array(this.r.draw + 1); this.draws = 0;
  }
  /** @param {number[]} draw */
  add(draw) { let h = 0; for (const x of draw) if (x < this.limit) h++; this.hist[h]++; this.draws++; }
}

/** Probabilidades teóricas exatas (Number) via Fase 1. @param {string} id @param {number} K */
export function exactHitProbs(id, K) { return hitDistribution(id, K).map(r => r.p.toNumber()); }

/** @param {HitAccumulator} acc */
export function hitReport(acc) {
  const D = acc.draws; if (D < 1) throw new RangeError('sem concursos');
  const theo = exactHitProbs(acc.r.id, acc.betSize); const emp = Array.from(acc.hist, c => c / D);
  const tiers = theo.map((p, k) => ({ hits: k, theoretical: p, empirical: emp[k], count: acc.hist[k], abs_diff: Math.abs(emp[k] - p) }));
  let cum = 0, maxCum = 0; for (let k = 0; k < theo.length; k++) { cum += emp[k] - theo[k]; maxCum = Math.max(maxCum, Math.abs(cum)); }
  const meanEmp = emp.reduce((s, f, k) => s + f * k, 0);
  return { data_kind: DATA_KIND, lottery: acc.r.id, bet_size: acc.betSize, draws: D, tiers, total_variation: totalVariation(emp, theo), max_cumulative_error: maxCum, sum_abs_diff: tiers.reduce((s, t) => s + t.abs_diff, 0), mean_hits_empirical: meanEmp, mean_hits_exact: acc.betSize * acc.r.draw / acc.r.universe };
}
