/**
 * Executor de experimentos SINTÉTICOS com metadados completos e reprodutibilidade exata:
 * mesmos parâmetros + mesma semente ⇒ JSON canônico byte a byte idêntico (sem carimbo de tempo no corpo).
 * @module stats/experiment
 */
import { createHash } from 'node:crypto';
import { getLottery, allowedBetSizes } from '../lotteries/config.js';
import { drawStream, deriveSeed, DATA_KIND, simulationMetadata } from '../sim/sampler.js';
import { GENERATOR_ID, GENERATOR_VERSION, normalizeSeed } from '../sim/prng.js';
import { STATS_MODULE_VERSION, canonicalJSON } from './util.js';
import { FrequencyAccumulator, frequencyReport } from './frequencies.js';
import { HitAccumulator, hitReport } from './hits.js';
import { StructuralAccumulator, structuralReport, simulatedStructuralReference, compareAccumulators } from './structural.js';
import { GlobalStatsAccumulator, uniformityTest } from './hypothesis.js';
import { adjustFamily } from './multiple.js';
import { errorRateExperiment } from './power.js';
import { lotomaniaSimulation, lotomaniaExactChecks } from './lotomania.js';

export const EXPERIMENT_TYPES = Object.freeze(['uniformity', 'error_rates', 'convergence', 'lotomania']);

/** Identificador determinístico = sha256 dos parâmetros canônicos. */
export function experimentId(spec) { return 'exp-' + createHash('sha256').update(canonicalJSON(spec)).digest('hex').slice(0, 16); }

function base(spec, hypotheses) {
  const s = { ...spec, seed: normalizeSeed(spec.seed).toString() };
  return { experiment_id: experimentId(s), data_kind: DATA_KIND, type: spec.type, lottery: spec.lottery, draws: spec.draws ?? null, seed: s.seed, generator: GENERATOR_ID, generator_version: GENERATOR_VERSION, stats_module_version: STATS_MODULE_VERSION, alpha: spec.alpha ?? null, mc_replicates: spec.B ?? null, parameters: s, hypotheses, disclaimer: 'SYNTHETIC_DATA: dados artificiais gerados pelo laboratório; não representam nem avaliam sorteios reais; sem previsão.' };
}
const H = { H0: 'mecanismo uniforme, independente entre concursos, sem reposição no concurso', H1: 'desvio do modelo uniforme especificado' };

/**
 * Executa um experimento.
 * @param {{type:string, lottery:string, seed:number|bigint, draws?:number, B?:number, alpha?:number, alphas?:number[], reps?:number,
 *          bias?:object, nullMode?:string, betSizes?:number[], checkpoints?:number[], family_kind?:'exploratory'|'confirmatory'}} spec
 */
export function runExperiment(spec) {
  if (!spec || !EXPERIMENT_TYPES.includes(spec.type)) throw new RangeError(`tipo de experimento inválido (use ${EXPERIMENT_TYPES.join('|')})`);
  const r = getLottery(spec.lottery);
  if (spec.type === 'uniformity') {
    const { lottery, seed, draws, B, alpha = 0.05, bias } = spec;
    const fa = new FrequencyAccumulator(lottery), ha = new HitAccumulator(lottery, r.minBet), sa = new StructuralAccumulator(lottery), ga = new GlobalStatsAccumulator(lottery);
    for (const d of drawStream({ lottery, seed: deriveSeed(seed, 'data'), draws, bias })) { fa.add(d); ha.add(d); sa.add(d); ga.add(d); }
    const test = uniformityTest({ lottery, observed: ga.statistics(), draws, B, seed: deriveSeed(seed, 'null'), alpha });
    const family = adjustFamily({ name: `global-${lottery}`, kind: spec.family_kind ?? 'exploratory', alpha, hypotheses: test.tests.map(t => ({ id: t.statistic, p: t.p })) });
    const ref = simulatedStructuralReference({ lottery, seed: deriveSeed(seed, 'reference'), draws });
    return { ...base(spec, H), simulation: simulationMetadata({ lottery, seed: deriveSeed(seed, 'data'), draws, bias }), results: { frequencies: frequencyReport(fa, { alpha }), hits: hitReport(ha), structural: structuralReport(sa), structural_vs_simulated_reference: compareAccumulators(sa, ref), uniformity_test: test, multiple_comparisons: family } };
  }
  if (spec.type === 'error_rates') {
    const res = errorRateExperiment({ lottery: spec.lottery, draws: spec.draws, reps: spec.reps, B: spec.B, alphas: spec.alphas, seed: spec.seed, bias: spec.bias, nullMode: spec.nullMode });
    return { ...base(spec, { ...H, family_global: res.family_definitions.global, family_number: res.family_definitions.number }), results: res };
  }
  if (spec.type === 'convergence') {
    const sizes = spec.betSizes ?? [r.minBet, r.maxBet]; const cps = [...(spec.checkpoints ?? [100, 1000, 10000])].sort((a, b) => a - b);
    const D = cps[cps.length - 1]; const has = sizes.map(K => new HitAccumulator(spec.lottery, K)); const fa = new FrequencyAccumulator(spec.lottery);
    const rows = []; let i = 0; let ci = 0;
    for (const d of drawStream({ lottery: spec.lottery, seed: deriveSeed(spec.seed, 'data'), draws: D })) {
      fa.add(d); for (const h of has) h.add(d); i++;
      if (i === cps[ci]) { const fr = frequencyReport(fa); let maxRel = 0; for (const n of fr.numbers) maxRel = Math.max(maxRel, Math.abs(n.relative - fr.p_inclusion));
        rows.push({ draws: i, freq_max_abs_rel_deviation: maxRel, freq_max_abs_rel_dev_x_sqrtD: maxRel * Math.sqrt(i), hits: has.map(h => { const hr = hitReport(h); return { bet_size: h.betSize, total_variation: hr.total_variation, tv_x_sqrtD: hr.total_variation * Math.sqrt(i), max_cumulative_error: hr.max_cumulative_error }; }) }); ci++; }
    }
    return { ...base({ ...spec, draws: D }, H), allowed_bet_sizes: allowedBetSizes(spec.lottery), results: { checkpoints: rows } };
  }
  // lotomania
  if (spec.lottery !== 'lotomania') throw new RangeError('experimento lotomania exige lottery=lotomania');
  return { ...base(spec, H), results: { exact: lotomaniaExactChecks(), simulation: lotomaniaSimulation({ seed: deriveSeed(spec.seed, 'data'), draws: spec.draws }) } };
}

/** JSON canônico e seu sha256. */
export function serializeExperiment(result) { const json = canonicalJSON(result); return { json, sha256: createHash('sha256').update(json).digest('hex') }; }
