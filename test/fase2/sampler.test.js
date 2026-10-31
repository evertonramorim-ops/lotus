// Fase 2 — amostragem (categorias 3, 4, 5). DADOS SINTÉTICOS.
import test from 'node:test'; import assert from 'node:assert/strict';
import { partialFisherYates, uniformSampler, createRng, drawStream, simulationMetadata, binomial } from '../../src/lab.js';
import { getLottery } from '../../src/lotteries/config.js';
import { getLottery as gl } from '../../src/lotteries/config.js';
import { assertCells, LOTTERY_IDS } from './_helpers.js';

/** Enumera TODAS as sequências de escolhas j_i ∈ [0, N−i) do Fisher-Yates parcial. */
function enumerateFY(N, k, initial) {
  const counts = new Map(); const choices = new Array(k).fill(0);
  const rec = i => {
    if (i === k) { const seq = choices.slice(); let c = 0; const pool = Int32Array.from(initial); const out = partialFisherYates(pool, k, () => seq[c++]); const key = out.sort((a, b) => a - b).join(','); counts.set(key, (counts.get(key) ?? 0) + 1); return; }
    for (let j = 0; j < N - i; j++) { choices[i] = j; rec(i + 1); }
  };
  rec(0); return counts;
}
for (const [N, k] of [[6, 2], [7, 3], [8, 4], [5, 5], [6, 1]]) {
  test(`[3] uniformidade EXATA do Fisher-Yates parcial N=${N},k=${k} (enumeração de todas as N!/(N−k)! escolhas)`, () => {
    // Prova exaustiva: cada k-subconjunto deve aparecer exatamente k! vezes, para pool inicial ordenado e embaralhado.
    for (const init of [Array.from({ length: N }, (_, i) => i), Array.from({ length: N }, (_, i) => N - 1 - i)]) {
      const c = enumerateFY(N, k, init);
      assert.equal(BigInt(c.size), binomial(N, k));
      let fk = 1; for (let i = 2; i <= k; i++) fk *= i;
      for (const v of c.values()) assert.equal(v, fk);
    }
  });
}
test('[3] uniformidade estatística N=6,k=2 com PRNG real: 15 subconjuntos, cotas binomiais exatas', () => {
  // Cada contagem ~ Binomial(M, 1/15) (concursos independentes). Cotas exatas com δ=1e-6/15 por célula.
  const M = 30000, s = uniformSampler(createRng(2026), 6, 2); const keys = []; for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) keys.push(`${a},${b}`);
  const cnt = Object.fromEntries(keys.map(k => [k, 0])); for (let i = 0; i < M; i++) cnt[s().join(',')]++;
  assert.equal(Object.keys(cnt).length, 15);
  assertCells(keys.map(k => cnt[k]), keys.map(() => 1 / 15), M, 1e-6, 'N6k2');
});
for (const id of LOTTERY_IDS) {
  test(`[4][5] ${id}: sem duplicatas, ordenado, dentro do universo, tamanho exato (20000 concursos)`, () => {
    const r = gl(id); let n = 0; const seenMin = new Set();
    for (const d of drawStream({ lottery: id, seed: 77, draws: 20000 })) {
      assert.equal(d.length, r.draw); assert.equal(new Set(d).size, r.draw);
      for (let i = 0; i < d.length; i++) { assert.ok(Number.isInteger(d[i]) && d[i] >= r.minNumber && d[i] <= r.maxNumber); if (i) assert.ok(d[i] > d[i - 1]); }
      seenMin.add(d[0]); n++;
    }
    assert.equal(n, 20000); assert.ok(seenMin.has(r.minNumber)); // a menor dezena (ex.: 00 na Lotomania) aparece
    const md = simulationMetadata({ lottery: id, seed: 77, draws: 20000 });
    assert.equal(md.data_kind, 'SYNTHETIC_DATA'); assert.equal(md.seed, '77'); assert.equal(md.universe, r.universe); assert.equal(md.numbers_per_draw, r.draw);
  });
}
test('[5] limites oficiais das 4 modalidades', () => {
  assert.deepEqual(LOTTERY_IDS.map(id => { const r = getLottery(id); return [r.universe, r.draw, r.minNumber, r.maxNumber]; }), [[60, 6, 1, 60], [25, 15, 1, 25], [80, 5, 1, 80], [100, 20, 0, 99]]);
});
