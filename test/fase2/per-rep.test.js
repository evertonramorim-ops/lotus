// Fase 2 (complementar) — nullMode 'per_rep': nula MC independente por réplica. DADOS SINTÉTICOS.
import test from 'node:test'; import assert from 'node:assert/strict';
import { errorRateExperiment, nullDistribution, deriveSeed } from '../../src/lab.js';

test('[per_rep] registra null_mode e difere de shared; nullMode inválido é rejeitado', () => {
  const o = { lottery: 'megasena', draws: 60, reps: 8, B: 19, alphas: [0.5], seed: 7 };
  const pr = errorRateExperiment({ ...o, nullMode: 'per_rep' }), sh = errorRateExperiment({ ...o, nullMode: 'shared' });
  assert.equal(pr.null_mode, 'per_rep'); assert.equal(sh.null_mode, 'shared'); assert.equal(pr.data_kind, 'SYNTHETIC_DATA');
  assert.throws(() => errorRateExperiment({ ...o, nullMode: 'xyz' }), RangeError);
});
test('[per_rep] nulas por réplica são distintas entre si (sementes null:i independentes)', () => {
  const a = nullDistribution({ lottery: 'quina', draws: 50, B: 19, seed: deriveSeed(3, 'null:0') });
  const b = nullDistribution({ lottery: 'quina', draws: 50, B: 19, seed: deriveSeed(3, 'null:1') });
  assert.notDeepEqual(Array.from(a.freq_pearson), Array.from(b.freq_pearson));
});
test('[per_rep] determinístico: mesma semente ⇒ mesmo resultado', () => {
  const o = { lottery: 'lotofacil', draws: 40, reps: 5, B: 9, alphas: [0.1], seed: 11, nullMode: 'per_rep' };
  assert.deepEqual(errorRateExperiment(o), errorRateExperiment(o));
});
