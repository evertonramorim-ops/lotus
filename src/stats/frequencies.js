/**
 * Frequências individuais das dezenas em dados SINTÉTICOS.
 * p = k/N por concurso; Var(X) = D·p·(1−p) para a contagem em D concursos independentes.
 * Nenhuma dezena é classificada como "melhor" ou "mais provável": todas têm p = k/N sob o modelo.
 * @module stats/frequencies
 */
import { getLottery } from '../lotteries/config.js';
import { wilsonInterval } from './util.js';
import { DATA_KIND } from '../sim/sampler.js';

/** Acumulador em fluxo de contagens por dezena. */
export class FrequencyAccumulator {
  /** @param {string} lotteryId */
  constructor(lotteryId) { this.r = getLottery(lotteryId); this.counts = new Float64Array(this.r.universe); this.draws = 0; }
  /** @param {number[]} draw */
  add(draw) { const m = this.r.minNumber; for (const x of draw) this.counts[x - m]++; this.draws++; }
}

/**
 * Relatório de frequências.
 * @param {FrequencyAccumulator} acc @param {{alpha?:number}} [opt]
 */
export function frequencyReport(acc, { alpha = 0.05 } = {}) {
  const { r, draws: D } = acc; if (D < 1) throw new RangeError('sem concursos');
  const p = r.draw / r.universe, expected = D * p, variance = D * p * (1 - p), sd = Math.sqrt(variance);
  const numbers = [];
  for (let i = 0; i < r.universe; i++) {
    const c = acc.counts[i], ci = wilsonInterval(c, D, alpha);
    numbers.push({ number: r.minNumber + i, absolute: c, relative: c / D, expected, deviation: c - expected, standardized_deviation: (c - expected) / sd, ci_inclusion_rate: [ci.lower, ci.upper] });
  }
  const halfWidth = 1.959963984540054 * Math.sqrt(p * (1 - p) / D);
  return {
    data_kind: DATA_KIND, lottery: r.id, draws: D, p_inclusion: p, expected_count: expected, theoretical_variance: variance, theoretical_sd: sd,
    ci_method: 'wilson-1927', ci_confidence: 1 - alpha,
    sample_size: { draws: D, expected_count_per_number: expected, min_draws_for_expected_5: Math.ceil(5 / p), approx_ci95_half_width_at_p: halfWidth, total_numbers_observed: D * r.draw },
    numbers,
    note: 'Dados sintéticos. Desvios são flutuação amostral sob o modelo; não indicam chance futura de nenhuma dezena.',
  };
}
