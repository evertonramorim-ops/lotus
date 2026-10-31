// Fase 2 — Lotomania (categoria 11). DADOS SINTÉTICOS.
import test from 'node:test'; import assert from 'node:assert/strict';
import { lotomaniaExactChecks, lotomaniaSimulation, runExperiment, binomialBounds } from '../../src/lab.js';
import { DELTA, assertCells } from './_helpers.js';

test('[11] Lotomania exata: suporte 0..20, P(k)=P(20−k) para todo k, P(0)=P(20), E=10 (frações exatas)', () => {
  const e = lotomaniaExactChecks();
  assert.deepEqual(e.support, [0, 20]); assert.ok(e.symmetric); assert.ok(e.p0_equals_p20); assert.equal(e.p0, e.p20); assert.ok(e.expectation_is_10); assert.equal(e.expectation, '10');
  assert.equal(e.pairs.length, 11);
});
test('[11] Lotomania simulada (60000 concursos): cada faixa 0..20 dentro de cotas exatas; simetria empírica e média', () => {
  const D = 60000; const s = lotomaniaSimulation({ seed: 11, draws: D });
  assert.equal(s.data_kind, 'SYNTHETIC_DATA'); assert.equal(s.tiers.length, 21);
  const theo = s.tiers.map(t => t.theoretical);
  assertCells(s.tiers.map(t => t.count), theo, D, DELTA, 'lotomania');
  // |f_k − f_{20−k}| ≤ |f_k − p_k| + |f_{20−k} − p_k| (pois p_k = p_{20−k}); cada termo limitado pelas cotas exatas
  const m = theo.filter(p => p > 0).length;
  for (let k = 0; k <= 10; k++) { const { lo, hi } = binomialBounds(D, theo[k], DELTA / m); const w = Math.max(theo[k] - lo / D, hi / D - theo[k]); assert.ok(Math.abs(s.tiers[k].empirical - s.tiers[20 - k].empirical) <= 2 * w); }
  // Hoeffding para média de acertos ∈ [0,20]
  assert.ok(Math.abs(s.mean_hits_empirical - 10) <= 20 * Math.sqrt(Math.log(2 / DELTA) / (2 * D)));
  assert.equal(s.mean_hits_exact, 10);
  assert.ok(Math.abs(s.exact_variance - 4.040404040404041) < 1e-12); // 20·½·½·80/99
});
test('[11] experimento lotomania reprodutível e restrito à Lotomania', () => {
  const a = runExperiment({ type: 'lotomania', lottery: 'lotomania', seed: 5, draws: 3000 }), b = runExperiment({ type: 'lotomania', lottery: 'lotomania', seed: 5, draws: 3000 });
  assert.deepEqual(a, b); assert.throws(() => runExperiment({ type: 'lotomania', lottery: 'quina', seed: 5, draws: 10 }), RangeError);
});
