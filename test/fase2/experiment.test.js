// Fase 2 — reprodução integral (17) e entradas inválidas / limites de desempenho (18). DADOS SINTÉTICOS.
import test from 'node:test'; import assert from 'node:assert/strict';
import { runExperiment, serializeExperiment, drawStream, createRng, uniformSampler, weightedSampler, biasWeights, nullDistribution, errorRateExperiment, wilsonInterval, holm, benjaminiHochberg, adjustFamily, StructuralAccumulator, MAX_DRAWS, MAX_REPLICATES, normalizeSeed } from '../../src/lab.js';
import { LOTTERY_IDS } from './_helpers.js';

for (const id of LOTTERY_IDS) {
  test(`[17] ${id}: mesmo spec+semente ⇒ JSON byte a byte idêntico (uniformity, error_rates, convergence); semente diferente ⇒ diferente`, () => {
    const specs = [{ type: 'uniformity', lottery: id, seed: 17, draws: 300, B: 19, alpha: 0.05 }, { type: 'error_rates', lottery: id, seed: 17, draws: 100, reps: 5, B: 9, alphas: [0.05], bias: { type: 'single', number: 5, boost: 1 } }, { type: 'convergence', lottery: id, seed: 17, checkpoints: [100, 400] }];
    for (const s of specs) {
      const a = serializeExperiment(runExperiment(s)), b = serializeExperiment(runExperiment({ ...s }));
      assert.equal(a.json, b.json); assert.equal(a.sha256, b.sha256);
      const c = serializeExperiment(runExperiment({ ...s, seed: 18 })); assert.notEqual(a.sha256, c.sha256);
      const o = JSON.parse(a.json);
      for (const k of ['experiment_id', 'lottery', 'seed', 'generator', 'generator_version', 'stats_module_version', 'parameters', 'hypotheses', 'results']) assert.ok(k in o, k);
      assert.equal(o.data_kind, 'SYNTHETIC_DATA'); assert.match(o.disclaimer, /SYNTHETIC_DATA/); assert.equal(o.seed, '17');
    }
    assert.equal(runExperiment({ type: 'uniformity', lottery: id, seed: 17n, draws: 50, B: 9 }).experiment_id, runExperiment({ type: 'uniformity', lottery: id, seed: 17, draws: 50, B: 9 }).experiment_id);
  });
}
test('[18] entradas inválidas lançam erro', () => {
  const T = (f) => assert.throws(f, e => e instanceof RangeError || e instanceof TypeError);
  T(() => [...drawStream({ lottery: 'xpto', seed: 1, draws: 1 })]);
  for (const d of [0, -1, 1.5, MAX_DRAWS + 1, NaN]) T(() => drawStream({ lottery: 'megasena', seed: 1, draws: d }).next());
  for (const s of [-1, 1.5, 2 ** 64 + 1, 2n ** 64n, '1', null]) T(() => normalizeSeed(s));
  T(() => createRng(1).uniformInt(0)); T(() => createRng(1).uniformInt(2 ** 32 + 1)); T(() => createRng(1).uniformInt(2.5));
  T(() => uniformSampler(createRng(1), 5, 6)); T(() => weightedSampler(createRng(1), [1, -1, 1], 2)); T(() => weightedSampler(createRng(1), [1, NaN], 1));
  T(() => biasWeights('megasena', { type: 'single', number: 61, boost: 1 })); T(() => biasWeights('lotomania', { type: 'single', number: 100, boost: 1 })); T(() => biasWeights('quina', { type: 'single', number: 3, boost: -2 })); T(() => biasWeights('quina', { type: 'x' }));
  T(() => nullDistribution({ lottery: 'quina', draws: 10, B: 0, seed: 1 })); T(() => nullDistribution({ lottery: 'quina', draws: 10, B: MAX_REPLICATES + 1, seed: 1 }));
  T(() => errorRateExperiment({ lottery: 'quina', draws: 10, reps: 0, B: 5, alphas: [0.05], seed: 1 })); T(() => errorRateExperiment({ lottery: 'quina', draws: 10, reps: 2, B: 5, alphas: [1.5], seed: 1 }));
  T(() => wilsonInterval(5, 3)); T(() => wilsonInterval(1, 3, 0));
  T(() => holm([])); T(() => holm([1.2])); T(() => benjaminiHochberg([-0.1])); T(() => adjustFamily({ name: 'x', kind: 'outro', alpha: 0.05, hypotheses: [{ id: 'a', p: 0.1 }] }));
  T(() => runExperiment({ type: 'previsao', lottery: 'megasena', seed: 1 })); T(() => runExperiment({ type: 'convergence', lottery: 'megasena', seed: 1, betSizes: [5], checkpoints: [10] }));
  T(() => runExperiment({ type: 'convergence', lottery: 'lotomania', seed: 1, betSizes: [20], checkpoints: [10] }));
  T(() => new StructuralAccumulator('quina', { lags: [0] }));
});
test('[18] desempenho: fluxo preguiçoso (10 milhões declarados, 5 consumidos) e 200 mil concursos em < 15 s', () => {
  const it = drawStream({ lottery: 'lotomania', seed: 1, draws: MAX_DRAWS }); for (let i = 0; i < 5; i++) assert.equal(it.next().value.length, 20);
  const t0 = process.hrtime.bigint(); let n = 0; for (const d of drawStream({ lottery: 'megasena', seed: 2, draws: 200000 })) n += d.length; const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(n, 1200000); assert.ok(ms < 15000, `${ms} ms`); // limite folgado (máquinas lentas); típico < 1 s
});
