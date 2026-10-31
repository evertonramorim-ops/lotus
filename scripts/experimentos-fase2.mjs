#!/usr/bin/env node
/**
 * LOTUS — Fase 2: experimentos documentados com DADOS SINTÉTICOS (SYNTHETIC_DATA).
 * Uso:
 *   node scripts/experimentos-fase2.mjs --out <dir>   # gera JSON + MD em <dir>
 *   node scripts/experimentos-fase2.mjs               # executa DUAS vezes (processos separados), compara sha256
 *                                                     # de todos os arquivos e grava em docs/fase2-evidencias/
 * Nenhum dado real, nenhuma API externa. Saídas não contêm carimbo de tempo (para hashes idênticos);
 * a data da execução fica apenas em reprodutibilidade.json.
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, cpSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runExperiment, serializeExperiment } from '../src/lab.js';
import { getLottery } from '../src/lotteries/config.js';

const LOTS = ['megasena', 'lotofacil', 'quina', 'lotomania'];
const SEED = 20261031; const ALPHAS = [0.01, 0.05, 0.1];
export const PLAN = {
  fpr: { draws: 500, reps: 200, B: 199, alphas: ALPHAS, nullMode: 'shared' },
  power: { draws: [100, 500, 2000], boosts: [0.1, 0.25, 0.5], reps: 100, B: 99, alphas: ALPHAS, nullMode: 'shared' },
  group: { draws: 2000, factor: 1.2, reps: 100, B: 99, alphas: ALPHAS },
  convergence: { checkpoints: [100, 1000, 10000, 100000] },
  lotomania: { draws: 200000 },
  uniformity: { draws: 1000, B: 999, alpha: 0.05 },
};
const pct = x => (100 * x).toFixed(1) + '%';
const f = x => x.rate.toFixed(3) + ` [${x.ci95[0].toFixed(3)}; ${x.ci95[1].toFixed(3)}]`;

function generate(out) {
  mkdirSync(out, { recursive: true }); const md = []; const save = (name, res) => { const { json } = serializeExperiment(res); writeFileSync(join(out, name + '.json'), json); return res; };
  md.push('# LOTUS — Fase 2: resultados dos experimentos (SYNTHETIC_DATA)', '', '> **SYNTHETIC_DATA** — todos os números abaixo vêm de sorteios ARTIFICIAIS gerados pelo laboratório (xoshiro128** + Fisher-Yates parcial). Não são resultados da Caixa, não avaliam sorteios reais e não indicam chance futura de nenhuma dezena.', '', `Semente-mestre: ${SEED}. Parâmetros completos em cada JSON.`, '');
  md.push('## 1. Taxa de falsos positivos sob H0 (gerador uniforme)', '', `D=${PLAN.fpr.draws} concursos, R=${PLAN.fpr.reps} conjuntos, B=${PLAN.fpr.B} réplicas MC (nula compartilhada). Taxa [IC95% Wilson].`, '');
  md.push('| Modalidade | alpha | freq_pearson | parity | repetition | sum | família global s/ correção | global Holm | global BH | família por dezena s/ correção | por dezena Holm | por dezena BH |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const id of LOTS) {
    const e = save(`fpr-${id}`, runExperiment({ type: 'error_rates', lottery: id, seed: SEED, ...PLAN.fpr }));
    for (const a of ALPHAS.map(String)) { const ps = e.results.per_statistic, fm = e.results.families; md.push(`| ${id} | ${a} | ${f(ps.freq_pearson[a])} | ${f(ps.parity_pearson[a])} | ${f(ps.repetition_pearson[a])} | ${f(ps.sum_mean_absdev[a])} | ${f(fm.global_unadjusted[a])} | ${f(fm.global_holm[a])} | ${f(fm.global_bh[a])} | ${f(fm.number_unadjusted[a])} | ${f(fm.number_holm[a])} | ${f(fm.number_bh[a])} |`); }
  }
  md.push('', '## 2. Poder sob viés ARTIFICIAL em uma dezena (peso 1+boost na amostragem ponderada sequencial)', '', `R=${PLAN.power.reps}, B=${PLAN.power.B}. "freq MC" = teste global de Pearson calibrado por Monte Carlo; "alvo Holm/BH" = dezena enviesada rejeitada na família de N testes binomiais exatos; "falso Holm" = alguma dezena NÃO enviesada rejeitada (Holm).`, '');
  md.push('| Modalidade | D | boost | alpha | freq MC | alvo Holm | alvo BH | falso (não-alvo) Holm |', '|---|---|---|---|---|---|---|---|');
  for (const id of LOTS) { const target = getLottery(id).minNumber + 6;
    for (const D of PLAN.power.draws) for (const boost of PLAN.power.boosts) {
      const e = save(`power-${id}-D${D}-b${boost}`, runExperiment({ type: 'error_rates', lottery: id, seed: SEED, draws: D, reps: PLAN.power.reps, B: PLAN.power.B, alphas: ALPHAS, nullMode: 'shared', bias: { type: 'single', number: target, boost } }));
      for (const a of ['0.01', '0.05']) { const fm = e.results.families; md.push(`| ${id} | ${D} | ${boost} | ${a} | ${pct(e.results.per_statistic.freq_pearson[a].rate)} | ${pct(fm.target_detected_holm[a].rate)} | ${pct(fm.target_detected_bh[a].rate)} | ${pct(fm.nontarget_false_holm[a].rate)} |`); }
    } }
  md.push('', `## 3. Poder sob viés ARTIFICIAL de grupo (primeira faixa com peso ${PLAN.group.factor}, D=${PLAN.group.draws})`, '', '| Modalidade | grupo | alpha | freq MC | algum alvo Holm | algum alvo BH | falso (não-alvo) Holm |', '|---|---|---|---|---|---|---|');
  for (const id of LOTS) { const r = getLottery(id); const bs = r.universe === 25 ? 5 : 10; const nums = Array.from({ length: bs }, (_, i) => r.minNumber + i);
    const e = save(`group-${id}`, runExperiment({ type: 'error_rates', lottery: id, seed: SEED, draws: PLAN.group.draws, reps: PLAN.group.reps, B: PLAN.group.B, alphas: ALPHAS, bias: { type: 'group', numbers: nums, factor: PLAN.group.factor } }));
    for (const a of ['0.01', '0.05']) { const fm = e.results.families; md.push(`| ${id} | ${nums[0]}–${nums[nums.length - 1]} | ${a} | ${pct(e.results.per_statistic.freq_pearson[a].rate)} | ${pct(fm.target_detected_holm[a].rate)} | ${pct(fm.target_detected_bh[a].rate)} | ${pct(fm.nontarget_false_holm[a].rate)} |`); } }
  md.push('', '## 4. Convergência (TVD da distribuição de acertos e desvio máximo de frequência relativa)', '', '| Modalidade | D | max\\|f_i−p\\| | ×√D | aposta | TVD acertos | TVD×√D |', '|---|---|---|---|---|---|---|');
  for (const id of LOTS) { const r = getLottery(id); const e = save(`convergence-${id}`, runExperiment({ type: 'convergence', lottery: id, seed: SEED, betSizes: [...new Set([r.minBet, r.maxBet])], ...PLAN.convergence }));
    for (const row of e.results.checkpoints) for (const h of row.hits) md.push(`| ${id} | ${row.draws} | ${row.freq_max_abs_rel_deviation.toExponential(3)} | ${row.freq_max_abs_rel_dev_x_sqrtD.toFixed(3)} | ${h.bet_size} | ${h.total_variation.toExponential(3)} | ${h.tv_x_sqrtD.toFixed(3)} |`); }
  const lm = save('lotomania', runExperiment({ type: 'lotomania', lottery: 'lotomania', seed: SEED, ...PLAN.lotomania }));
  const ex = lm.results.exact, sim = lm.results.simulation;
  md.push('', `## 5. Lotomania (aposta de 50, D=${PLAN.lotomania.draws})`, '', `Exato: simetria P(k)=P(20−k) para todo k: **${ex.symmetric}**; P(0)=P(20): **${ex.p0_equals_p20}** (= ${ex.p0}); E[X]=${ex.expectation} (igual a 10: **${ex.expectation_is_10}**).`, '', `Simulado: média ${sim.mean_hits_empirical.toFixed(4)} (exata 10); variância ${sim.empirical_variance.toFixed(4)} (exata ${sim.exact_variance.toFixed(4)}); TVD ${sim.total_variation.toExponential(3)}; assimetria empírica máx |f(k)−f(20−k)| = ${sim.empirical_max_asymmetry.toExponential(3)}.`, '', '| k | P exata | freq. simulada | \\|dif\\| |', '|---|---|---|---|');
  for (const t of sim.tiers) md.push(`| ${t.hits} | ${t.theoretical.toExponential(6)} | ${t.empirical.toExponential(6)} | ${t.abs_diff.toExponential(2)} |`);
  md.push('', `## 6. Teste de uniformidade completo (D=${PLAN.uniformity.draws}, B=${PLAN.uniformity.B}, resolução do valor-p = 1/${PLAN.uniformity.B + 1})`, '', '| Modalidade | estatística | observado | média nula MC | b | p=(b+1)/(B+1) | p Holm | p BH |', '|---|---|---|---|---|---|---|---|');
  for (const id of LOTS) { const e = save(`uniformity-${id}`, runExperiment({ type: 'uniformity', lottery: id, seed: SEED, ...PLAN.uniformity }));
    const mc = e.results.multiple_comparisons.results; e.results.uniformity_test.tests.forEach((t, i) => md.push(`| ${id} | ${t.statistic} | ${t.observed.toFixed(4)} | ${t.null_mean_mc.toFixed(4)} | ${t.b} | ${t.p.toFixed(4)} | ${mc[i].p_holm.toFixed(4)} | ${mc[i].p_bh.toFixed(4)} |`)); }
  md.push('', 'Lembrete: valores-p acima referem-se a dados SINTÉTICOS gerados pelo modelo uniforme; valores pequenos ocasionais são esperados (≈alpha das vezes) e não significam nada sobre dezenas ou sorteios reais.', '');
  writeFileSync(join(out, 'RESULTADOS.md'), md.join('\n'));
}

function hashes(dir) { return Object.fromEntries(readdirSync(dir).sort().map(n => [n, createHash('sha256').update(readFileSync(join(dir, n))).digest('hex')])); }

const args = process.argv.slice(2); const oi = args.indexOf('--out');
if (oi >= 0) generate(args[oi + 1]);
else {
  const self = fileURLToPath(import.meta.url), root = join(dirname(self), '..'); const tmp = mkdtempSync(join(tmpdir(), 'lotus-f2-'));
  const runs = []; for (const k of ['run1', 'run2']) { const d = join(tmp, k); const t0 = Date.now(); execFileSync(process.execPath, [self, '--out', d], { stdio: 'inherit' }); runs.push({ dir: d, ms: Date.now() - t0, files: hashes(d) }); }
  const same = JSON.stringify(runs[0].files) === JSON.stringify(runs[1].files);
  const all = h => createHash('sha256').update(JSON.stringify(h)).digest('hex');
  const dest = join(root, 'docs', 'fase2-evidencias', 'experimentos'); rmSync(dest, { recursive: true, force: true }); cpSync(runs[0].dir, dest, { recursive: true });
  const rep = { data_kind: 'SYNTHETIC_DATA', node: process.version, executed_at: new Date().toISOString(), identical: same, run1_ms: runs[0].ms, run2_ms: runs[1].ms, run1_aggregate_sha256: all(runs[0].files), run2_aggregate_sha256: all(runs[1].files), files: Object.fromEntries(Object.keys(runs[0].files).map(n => [n, { run1: runs[0].files[n], run2: runs[1].files[n] }])) };
  writeFileSync(join(root, 'docs', 'fase2-evidencias', 'reprodutibilidade.json'), JSON.stringify(rep, null, 2) + '\n');
  rmSync(tmp, { recursive: true, force: true });
  console.log(`execução 1: ${runs[0].ms} ms; execução 2: ${runs[1].ms} ms; arquivos: ${Object.keys(runs[0].files).length}; idênticos: ${same}`);
  console.log(`sha256 agregado run1=${rep.run1_aggregate_sha256}\nsha256 agregado run2=${rep.run2_aggregate_sha256}`);
  if (!same) process.exit(1);
}
