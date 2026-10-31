#!/usr/bin/env node
/**
 * LOTUS — Fase 2 (revisão complementar): bateria de taxa de falsos positivos e poder com
 * nullMode 'per_rep' (distribuição nula Monte Carlo INDEPENDENTE por réplica ⇒ réplicas independentes,
 * ICs de Wilson válidos sobre R réplicas independentes). DADOS SINTÉTICOS (SYNTHETIC_DATA).
 * Não altera a bateria original (nullMode 'shared') em docs/fase2-evidencias/experimentos/.
 * Uso:
 *   node scripts/experimentos-fase2-per-rep.mjs --out <dir>  # uma execução em <dir>
 *   node scripts/experimentos-fase2-per-rep.mjs              # DUAS execuções em processos separados (em paralelo),
 *       compara sha256 e grava docs/fase2-evidencias/experimentos-per-rep/ + reprodutibilidade-per-rep.json
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, cpSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runExperiment, serializeExperiment } from '../src/lab.js';
import { getLottery } from '../src/lotteries/config.js';

const LOTS = ['megasena', 'lotofacil', 'quina', 'lotomania'];
const SEED = 20261101; // semente-mestre distinta da bateria shared (20261031)
const ALPHAS = [0.01, 0.05, 0.1];
const NULL_MODE = 'per_rep';
export const PLAN = {
  fpr: { draws: 500, reps: 200, B: 199, alphas: ALPHAS, nullMode: NULL_MODE },
  power: { draws: [100, 500, 2000], boosts: [0.1, 0.25, 0.5], reps: 100, B: 99, alphas: ALPHAS, nullMode: NULL_MODE },
  group: { draws: 2000, factor: 1.2, reps: 100, B: 99, alphas: ALPHAS, nullMode: NULL_MODE },
};
const f = x => x.rate.toFixed(3) + ` [${x.ci95[0].toFixed(3)}; ${x.ci95[1].toFixed(3)}]`;

function generate(out) {
  mkdirSync(out, { recursive: true }); const md = [];
  const save = (name, res) => {
    if (res.results.null_mode !== NULL_MODE) throw new Error('null_mode inesperado');
    const { json } = serializeExperiment(res); writeFileSync(join(out, name + '.json'), json); return res;
  };
  md.push('# LOTUS — Fase 2 (complementar): FPR e poder com nullMode: \'per_rep\' (SYNTHETIC_DATA)', '',
    '> **SYNTHETIC_DATA** — sorteios ARTIFICIAIS gerados pelo laboratório. Não são resultados da Caixa e não indicam nada sobre sorteios reais.', '',
    '> **nullMode: \'per_rep\'** — cada réplica usa sua própria distribuição nula Monte Carlo (semente `deriveSeed(seed, "null:i")`), independente das demais ⇒ as R réplicas são independentes e o IC95% de Wilson é calculado sobre R réplicas independentes.', '',
    `Semente-mestre: ${SEED}; dados da réplica i: deriveSeed(seed, "data:i"). α ∈ {${ALPHAS.join(', ')}}. Parâmetros completos em cada JSON. Taxa [IC95% Wilson].`, '');
  md.push('## 1. Taxa de falsos positivos sob H0 (gerador uniforme)', '', `D=${PLAN.fpr.draws}, R=${PLAN.fpr.reps}, B=${PLAN.fpr.B}. Família global = 4 testes MC; família por dezena = N testes binomiais exatos. **BH = EXPLORATÓRIO** (controla FDR, não FWER).`, '');
  md.push('| Modalidade | α | freq_pearson | parity | repetition | sum | global s/ correção | global Holm | global BH (EXPLORATÓRIO) | por dezena s/ correção | por dezena Holm | por dezena BH (EXPLORATÓRIO) |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const id of LOTS) {
    const e = save(`fpr-${id}`, runExperiment({ type: 'error_rates', lottery: id, seed: SEED, ...PLAN.fpr }));
    for (const a of ALPHAS.map(String)) { const ps = e.results.per_statistic, fm = e.results.families; md.push(`| ${id} | ${a} | ${f(ps.freq_pearson[a])} | ${f(ps.parity_pearson[a])} | ${f(ps.repetition_pearson[a])} | ${f(ps.sum_mean_absdev[a])} | ${f(fm.global_unadjusted[a])} | ${f(fm.global_holm[a])} | ${f(fm.global_bh[a])} | ${f(fm.number_unadjusted[a])} | ${f(fm.number_holm[a])} | ${f(fm.number_bh[a])} |`); }
  }
  md.push('', '## 2. Poder sob viés ARTIFICIAL em uma dezena (alvo = minNumber+6, peso 1+boost)', '', `R=${PLAN.power.reps}, B=${PLAN.power.B}, D ∈ {${PLAN.power.draws.join(', ')}}, boost ∈ {${PLAN.power.boosts.join(', ')}} (mesma grade da bateria shared). "freq MC" = Pearson global calibrado por MC (nula por réplica); "alvo Holm/BH" = dezena enviesada rejeitada na família por dezena; "falso Holm" = alguma dezena não enviesada rejeitada (Holm).`, '');
  md.push('| Modalidade | D | boost | α | freq MC | alvo Holm | alvo BH (EXPLORATÓRIO) | falso (não-alvo) Holm |', '|---|---|---|---|---|---|---|---|');
  for (const id of LOTS) { const target = getLottery(id).minNumber + 6;
    for (const D of PLAN.power.draws) for (const boost of PLAN.power.boosts) {
      const e = save(`power-${id}-D${D}-b${boost}`, runExperiment({ type: 'error_rates', lottery: id, seed: SEED, draws: D, reps: PLAN.power.reps, B: PLAN.power.B, alphas: ALPHAS, nullMode: NULL_MODE, bias: { type: 'single', number: target, boost } }));
      for (const a of ['0.01', '0.05']) { const fm = e.results.families; md.push(`| ${id} | ${D} | ${boost} | ${a} | ${f(e.results.per_statistic.freq_pearson[a])} | ${f(fm.target_detected_holm[a])} | ${f(fm.target_detected_bh[a])} | ${f(fm.nontarget_false_holm[a])} |`); }
    } }
  md.push('', `## 3. Poder sob viés ARTIFICIAL de grupo (primeira faixa, peso ${PLAN.group.factor}, D=${PLAN.group.draws}, R=${PLAN.group.reps}, B=${PLAN.group.B})`, '', '| Modalidade | grupo | α | freq MC | algum alvo Holm | algum alvo BH (EXPLORATÓRIO) | falso (não-alvo) Holm |', '|---|---|---|---|---|---|---|');
  for (const id of LOTS) { const r = getLottery(id); const bs = r.universe === 25 ? 5 : 10; const nums = Array.from({ length: bs }, (_, i) => r.minNumber + i);
    const e = save(`group-${id}`, runExperiment({ type: 'error_rates', lottery: id, seed: SEED, draws: PLAN.group.draws, reps: PLAN.group.reps, B: PLAN.group.B, alphas: ALPHAS, nullMode: NULL_MODE, bias: { type: 'group', numbers: nums, factor: PLAN.group.factor } }));
    for (const a of ['0.01', '0.05']) { const fm = e.results.families; md.push(`| ${id} | ${nums[0]}–${nums[nums.length - 1]} | ${a} | ${f(e.results.per_statistic.freq_pearson[a])} | ${f(fm.target_detected_holm[a])} | ${f(fm.target_detected_bh[a])} | ${f(fm.nontarget_false_holm[a])} |`); } }
  md.push('', 'Nota: resolução do valor-p MC = 1/(B+1). Todos os números referem-se a dados SINTÉTICOS.', '');
  writeFileSync(join(out, 'RESULTADOS-per-rep.md'), md.join('\n'));
}

function hashes(dir) { return Object.fromEntries(readdirSync(dir).sort().map(n => [n, createHash('sha256').update(readFileSync(join(dir, n))).digest('hex')])); }
const run = (self, d) => new Promise((res, rej) => { const t0 = Date.now(); const p = spawn(process.execPath, [self, '--out', d], { stdio: 'inherit' }); p.on('exit', c => c === 0 ? res({ dir: d, ms: Date.now() - t0, pid: p.pid }) : rej(new Error('exit ' + c))); });

const args = process.argv.slice(2); const oi = args.indexOf('--out');
if (oi >= 0) generate(args[oi + 1]);
else {
  const self = fileURLToPath(import.meta.url), root = join(dirname(self), '..'); const tmp = mkdtempSync(join(tmpdir(), 'lotus-f2pr-'));
  const started = new Date().toISOString();
  const runs = await Promise.all(['run1', 'run2'].map(k => run(self, join(tmp, k))));
  for (const r of runs) r.files = hashes(r.dir);
  const same = JSON.stringify(runs[0].files) === JSON.stringify(runs[1].files);
  const all = h => createHash('sha256').update(JSON.stringify(h)).digest('hex');
  const ev = join(root, 'docs', 'fase2-evidencias'); const dest = join(ev, 'experimentos-per-rep');
  rmSync(dest, { recursive: true, force: true }); cpSync(runs[0].dir, dest, { recursive: true });
  const rep = { data_kind: 'SYNTHETIC_DATA', null_mode: NULL_MODE, seed: SEED, plan: PLAN, node: process.version, started_at: started, finished_at: new Date().toISOString(),
    method: 'duas execuções em processos Node separados (spawn, em paralelo), diretórios temporários distintos', identical: same,
    run1_ms: runs[0].ms, run2_ms: runs[1].ms, run1_aggregate_sha256: all(runs[0].files), run2_aggregate_sha256: all(runs[1].files),
    aggregate_definition: 'sha256(JSON.stringify({arquivo: sha256}) com arquivos em ordem alfabética)',
    files: Object.fromEntries(Object.keys(runs[0].files).map(n => [n, { run1: runs[0].files[n], run2: runs[1].files[n] }])) };
  writeFileSync(join(ev, 'reprodutibilidade-per-rep.json'), JSON.stringify(rep, null, 2) + '\n');
  rmSync(tmp, { recursive: true, force: true });
  console.log(`run1 ${runs[0].ms} ms; run2 ${runs[1].ms} ms; arquivos ${Object.keys(runs[0].files).length}; idênticos ${same}`);
  console.log(`agg run1=${rep.run1_aggregate_sha256}\nagg run2=${rep.run2_aggregate_sha256}`);
  if (!same) process.exit(1);
}
