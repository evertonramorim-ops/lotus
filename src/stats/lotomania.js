/**
 * Análises específicas da Lotomania (N=100, sorteia 20, aposta de 50) — dados SINTÉTICOS.
 * Simetria exata: P(k) = C(50,k)C(50,20−k)/C(100,20) = P(20−k) (troca aposta ↔ complemento),
 * logo P(0) = P(20) e E[X] = 20·50/100 = 10.
 * @module stats/lotomania
 */
import { hitDistribution } from '../math/bets.js';
import { expectation } from '../math/hypergeometric.js';
import { Fraction } from '../math/bigint.js';
import { HitAccumulator, hitReport } from './hits.js';
import { drawStream, DATA_KIND } from '../sim/sampler.js';

/** Verificações EXATAS (Fraction) da simetria e da esperança. */
export function lotomaniaExactChecks() {
  const d = hitDistribution('lotomania', 50);
  const pairs = []; for (let k = 0; k <= 10; k++) pairs.push({ k, mirror: 20 - k, equal: d[k].p.equals(d[20 - k].p), p: d[k].p.toNumber() });
  const E = expectation(100, 50, 20);
  return { support: [0, 20], symmetric: pairs.every(x => x.equal), pairs, p0_equals_p20: d[0].p.equals(d[20].p), p0: d[0].p.toString(), p20: d[20].p.toString(), expectation: E.toString(), expectation_is_10: E.equals(new Fraction(10n)) };
}

/** Comparação teoria × simulação. @param {{seed:number|bigint, draws:number}} o */
export function lotomaniaSimulation({ seed, draws }) {
  const acc = new HitAccumulator('lotomania', 50); for (const d of drawStream({ lottery: 'lotomania', seed, draws })) acc.add(d);
  const rep = hitReport(acc); const f = rep.tiers.map(t => t.empirical);
  let maxAsym = 0; for (let k = 0; k <= 10; k++) maxAsym = Math.max(maxAsym, Math.abs(f[k] - f[20 - k]));
  let var_ = 0; for (let k = 0; k <= 20; k++) var_ += f[k] * (k - rep.mean_hits_empirical) ** 2;
  return { data_kind: DATA_KIND, ...rep, empirical_max_asymmetry: maxAsym, empirical_variance: var_, exact_variance: 20 * 0.5 * 0.5 * 80 / 99, exact: lotomaniaExactChecks() };
}
