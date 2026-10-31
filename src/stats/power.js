/**
 * Experimentos de taxa de falsos positivos (gerador uniforme, H0 verdadeira) e de poder
 * (gerador ARTIFICIALMENTE enviesado). Cenários sintéticos: não são hipóteses sobre sorteios reais.
 *
 * Duas famílias de hipóteses por conjunto de dados (documentadas e sempre completas):
 *  F1 "global" (4 testes Monte Carlo: STATISTICS de stats/hypothesis.js);
 *  F2 "por dezena" (N testes binomiais bilaterais EXATOS: contagem da dezena i ~ Binomial(D, k/N) sob H0).
 * Para cada alpha mede-se a taxa de rejeição sem correção, com Holm e com Benjamini–Hochberg.
 * nullMode 'shared': uma única distribuição nula MC por (modalidade, D) reutilizada em todas as réplicas
 * (cada valor-p continua marginalmente válido; as réplicas ficam condicionalmente dependentes da referência).
 * nullMode 'per_rep': nova distribuição nula por réplica (réplicas independentes; mais lento).
 * @module stats/power
 */
import { getLottery } from '../lotteries/config.js';
import { drawStream, deriveSeed, DATA_KIND, checkDraws, biasWeights } from '../sim/sampler.js';
import { computeStatistics, nullDistribution, mcPValue, STATISTICS, checkReplicates } from './hypothesis.js';
import { binomialPmfArray, binomialTwoSidedP, wilsonInterval } from './util.js';
import { holm, benjaminiHochberg } from './multiple.js';

/**
 * @param {{lottery:string, draws:number, reps:number, B:number, alphas:number[], seed:number|bigint,
 *          bias?:object, nullMode?:'shared'|'per_rep'}} o
 */
export function errorRateExperiment({ lottery, draws, reps, B, alphas, seed, bias = { type: 'none' }, nullMode = 'shared' }) {
  const r = getLottery(lottery); checkDraws(draws); checkReplicates(B);
  if (!Number.isInteger(reps) || reps < 1 || reps > 100_000) throw new RangeError('reps inválido');
  if (!Array.isArray(alphas) || !alphas.length || alphas.some(a => !(a > 0 && a < 1))) throw new RangeError('alphas inválidos');
  biasWeights(lottery, bias); // valida
  const biased = bias.type !== 'none';
  const targets = bias.type === 'single' ? [bias.number] : bias.type === 'group' ? bias.numbers : [];
  const pmf = binomialPmfArray(draws, r.draw / r.universe);
  const pcache = new Map(); const pBin = c => { if (!pcache.has(c)) pcache.set(c, binomialTwoSidedP(c, pmf)); return pcache.get(c); };
  const shared = nullMode === 'shared' ? nullDistribution({ lottery, draws, B, seed: deriveSeed(seed, 'null-shared') }) : null;
  if (!['shared', 'per_rep'].includes(nullMode)) throw new RangeError('nullMode inválido');
  const z = () => Object.fromEntries(alphas.map(a => [String(a), 0]));
  const per = Object.fromEntries(STATISTICS.map(s => [s, z()]));
  const fam = { global_unadjusted: z(), global_holm: z(), global_bh: z(), number_unadjusted: z(), number_holm: z(), number_bh: z(), target_detected_holm: z(), target_detected_bh: z(), nontarget_false_holm: z() };
  const freqP = [];
  for (let i = 0; i < reps; i++) {
    const { stats, acc } = computeStatistics(lottery, drawStream({ lottery, seed: deriveSeed(seed, `data:${i}`), draws, bias }));
    const nd = shared ?? nullDistribution({ lottery, draws, B, seed: deriveSeed(seed, `null:${i}`) });
    const gp = STATISTICS.map(s => mcPValue(stats[s], nd[s]).p); freqP.push(gp[0]);
    const np = Array.from(acc.counts, c => pBin(c));
    const gh = holm(gp), gb = benjaminiHochberg(gp), nh = holm(np), nb = benjaminiHochberg(np);
    for (const a of alphas) {
      const k = String(a); const any = arr => arr.some(p => p <= a) ? 1 : 0;
      STATISTICS.forEach((s, j) => { if (gp[j] <= a) per[s][k]++; });
      fam.global_unadjusted[k] += any(gp); fam.global_holm[k] += any(gh); fam.global_bh[k] += any(gb);
      fam.number_unadjusted[k] += any(np); fam.number_holm[k] += any(nh); fam.number_bh[k] += any(nb);
      if (targets.length) {
        const ti = targets.map(n => n - r.minNumber);
        if (ti.some(t => nh[t] <= a)) fam.target_detected_holm[k]++;
        if (ti.some(t => nb[t] <= a)) fam.target_detected_bh[k]++;
        if (nh.some((p, t) => p <= a && !ti.includes(t))) fam.nontarget_false_holm[k]++;
      }
    }
  }
  const rate = o => Object.fromEntries(Object.entries(o).map(([a, c]) => { const ci = wilsonInterval(c, reps); return [a, { count: c, rate: c / reps, ci95: [ci.lower, ci.upper] }]; }));
  const families = {}; for (const [n, o] of Object.entries(fam)) if (targets.length || !n.startsWith('target') && !n.startsWith('nontarget')) families[n] = rate(o);
  return {
    data_kind: DATA_KIND, kind: biased ? 'power' : 'false_positive_rate', lottery: r.id, draws, reps, mc_replicates: B, null_mode: nullMode, alphas, bias,
    family_definitions: { global: `${STATISTICS.length} testes MC: ${STATISTICS.join(', ')}`, number: `${r.universe} testes binomiais exatos bilaterais (um por dezena)` },
    per_statistic: Object.fromEntries(Object.entries(per).map(([s, o]) => [s, rate(o)])), families,
    freq_pvalue_deciles: deciles(freqP),
  };
}

function deciles(p) { const h = new Array(10).fill(0); for (const x of p) h[Math.min(9, Math.floor(x * 10 - 1e-12))]++; return h; }
