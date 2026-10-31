// Fase 2 — frequências, acertos, convergência, estruturais, sobreposição (categorias 6–10). DADOS SINTÉTICOS.
import test from 'node:test'; import assert from 'node:assert/strict';
import { drawStream, FrequencyAccumulator, frequencyReport, HitAccumulator, hitReport, exactHitProbs, StructuralAccumulator, structuralReport, exactStructural, exactStructuralGeneric, runExperiment, deriveSeed, binomial } from '../../src/lab.js';
import { getLottery, allowedBetSizes } from '../../src/lotteries/config.js';
import { assertCells, LOTTERY_IDS, DELTA } from './_helpers.js';

const D = 20000;
for (const id of LOTTERY_IDS) {
  const r = getLottery(id);
  test(`[6] ${id}: frequências — soma exata, p=k/N, Var=Dp(1−p), cotas binomiais exatas por dezena, IC Wilson`, () => {
    const acc = new FrequencyAccumulator(id); for (const d of drawStream({ lottery: id, seed: 6, draws: D })) acc.add(d);
    const rep = frequencyReport(acc);
    assert.equal(rep.data_kind, 'SYNTHETIC_DATA'); assert.equal(rep.p_inclusion, r.draw / r.universe);
    assert.ok(Math.abs(rep.theoretical_variance - D * (r.draw / r.universe) * (1 - r.draw / r.universe)) < 1e-9);
    assert.equal(rep.numbers.reduce((s, n) => s + n.absolute, 0), D * r.draw);
    // contagem de cada dezena ~ Binomial(D, k/N) (inclusão independente entre concursos)
    assertCells(rep.numbers.map(n => n.absolute), rep.numbers.map(() => rep.p_inclusion), D, DELTA, id);
    for (const n of rep.numbers) { assert.ok(n.ci_inclusion_rate[0] <= n.relative && n.relative <= n.ci_inclusion_rate[1]); assert.ok(Math.abs(n.deviation - (n.absolute - rep.expected_count)) < 1e-9); }
    assert.equal(rep.sample_size.min_draws_for_expected_5, Math.ceil(5 * r.universe / r.draw));
    assert.ok(!/melhor|mais prov|quente|frio/i.test(JSON.stringify(rep)));
  });
  test(`[7] ${id}: distribuição de acertos empírica vs hipergeométrica exata (Fase 1), tamanhos de aposta ${[...new Set([r.minBet, r.maxBet])].join(',')}`, () => {
    for (const K of new Set([r.minBet, r.maxBet])) {
      const acc = new HitAccumulator(id, K); for (const d of drawStream({ lottery: id, seed: deriveSeed(7, `${id}:${K}`), draws: D })) acc.add(d);
      const rep = hitReport(acc); const theo = exactHitProbs(id, K);
      assert.ok(Math.abs(theo.reduce((a, b) => a + b, 0) - 1) < 1e-12);
      const tvb = assertCells(Array.from(acc.hist), theo, D, DELTA, `${id} K=${K}`);
      assert.ok(rep.total_variation <= tvb, `TVD ${rep.total_variation} > cota ${tvb}`);
      assert.ok(Math.abs(rep.mean_hits_exact - K * r.draw / r.universe) < 1e-12);
    }
  });
  test(`[8] ${id}: convergência — TVD de acertos e desvio máximo de frequência dentro de cotas exatas que encolhem com D`, () => {
    const sizes = [...new Set([r.minBet, r.maxBet])];
    const e = runExperiment({ type: 'convergence', lottery: id, seed: 8, betSizes: sizes, checkpoints: [500, 5000, 40000] });
    let prevBound = Infinity;
    for (const row of e.results.checkpoints) {
      const n = row.draws; const p = r.draw / r.universe;
      // cota para max_i |f_i − p|: célula Binomial(n,p) com δ/N por dezena
      for (const h of row.hits) { const theo = exactHitProbs(id, h.bet_size);
        let b = 0; theo.forEach(q => { if (q > 0) { const m = theo.filter(x => x > 0).length; const { lo, hi } = binomialBoundsLocal(n, q, DELTA / m); b += Math.max(Math.abs(lo / n - q), Math.abs(hi / n - q)); } }); b /= 2;
        assert.ok(h.total_variation <= b, `${id} n=${n} K=${h.bet_size}: TVD ${h.total_variation} > ${b}`); }
      const { lo, hi } = binomialBoundsLocal(n, p, DELTA / r.universe); const fb = Math.max(Math.abs(lo / n - p), Math.abs(hi / n - p));
      assert.ok(row.freq_max_abs_rel_deviation <= fb); assert.ok(fb < prevBound); prevBound = fb;
    }
    assert.ok(e.results.checkpoints[2].hits[0].total_variation < e.results.checkpoints[0].hits[0].total_variation);
    assert.deepEqual(e.allowed_bet_sizes, allowedBetSizes(id));
  });
  test(`[9] ${id}: distribuições estruturais (soma, paridade, faixas, consecutivos, amplitude) vs exatas`, () => {
    const acc = new StructuralAccumulator(id); for (const d of drawStream({ lottery: id, seed: 9, draws: D })) acc.add(d);
    const ex = exactStructural(id); const rep = structuralReport(acc);
    assertCells(Array.from(acc.parity), ex.parity_even, D, DELTA / 4, 'paridade');
    assertCells(Array.from(acc.consecutive), ex.consecutive, D, DELTA / 4, 'consecutivos');
    assertCells(Array.from(acc.amplitude), ex.amplitude, D, DELTA / 4, 'amplitude');
    assertCells(Array.from(acc.band[0]), ex.band, D, DELTA / 4, 'faixa0');
    // média da soma: S ∈ [minSum, maxSum]; Hoeffding: P(|média−E| ≥ t) ≤ 2exp(−2Dt²/(amplitude)²)
    const range = ex.sum.probs.length - 1, t = range * Math.sqrt(Math.log(2 / DELTA) / (2 * D));
    assert.ok(Math.abs(rep.sum.mean_empirical - ex.sum.mean) <= t);
    assert.ok(Math.abs(rep.sum.mean_exact - ex.sum.mean) < 1e-9);
    for (const k of ['sum', 'parity_even_count', 'consecutive_pairs', 'amplitude']) assert.equal(rep[k].outside_support, 0);
    assert.equal(rep.data_kind, 'SYNTHETIC_DATA');
  });
  test(`[10] ${id}: repetição entre concursos consecutivos ~ hipergeométrica(N,k,k) (pares disjuntos ⇒ independência)`, () => {
    const ex = exactStructural(id); const h = new Array(r.draw + 1).fill(0); let prev = null, i = 0, pairs = 0;
    const acc = new StructuralAccumulator(id, { lags: [1, 3] }); const manual = new Array(r.draw + 1).fill(0); let last = null;
    for (const d of drawStream({ lottery: id, seed: 10, draws: 2 * D })) {
      acc.add(d); if (last) manual[d.filter(x => last.includes(x)).length]++; last = d;
      if (i % 2 === 0) prev = d; else { h[d.filter(x => prev.includes(x)).length]++; pairs++; } i++;
    }
    assert.deepEqual(Array.from(acc.overlap[1]), manual); // contagem do acumulador correta
    assertCells(h, ex.repetition, pairs, DELTA, 'repetição');
    const mean = ex.repetition.reduce((s, p, k) => s + p * k, 0); assert.ok(Math.abs(mean - r.draw ** 2 / r.universe) < 1e-12);
    const rep = structuralReport(acc); assert.equal(rep.overlap_by_lag['3'].n, 2 * D - 3); assert.equal(rep.repetition_consecutive.n, 2 * D - 1);
  });
}
function binomialBoundsLocal(n, p, d) { return bb(n, p, d); }
import { binomialBounds as bb } from '../../src/lab.js';

test('[9] fórmulas estruturais exatas = enumeração por força bruta (N=10,k=4 e N=12,k=5, início 1 e 0)', () => {
  for (const [N, k, min, band] of [[10, 4, 1, 5], [12, 5, 0, 4], [9, 2, 1, 3]]) {
    const ex = exactStructuralGeneric({ N, k, min, band }); const tot = Number(binomial(N, k));
    const c = { sum: new Map(), par: new Array(k + 1).fill(0), cons: new Array(k).fill(0), amp: new Array(N).fill(0), band: new Array(k + 1).fill(0) };
    const rec = (s, a) => { if (a.length === k) { const v = a.map(x => x + min); const sm = v.reduce((x, y) => x + y, 0); c.sum.set(sm, (c.sum.get(sm) ?? 0) + 1); c.par[v.filter(x => x % 2 === 0).length]++; c.cons[v.filter((x, i) => i && v[i - 1] === x - 1).length]++; c.amp[v[k - 1] - v[0]]++; c.band[v.filter(x => x - min < band).length]++; return; } for (let i = s; i < N; i++) { a.push(i); rec(i + 1, a); a.pop(); } };
    rec(0, []);
    const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);
    ex.sum.probs.forEach((p, j) => close(p, (c.sum.get(j + ex.sum.offset) ?? 0) / tot));
    ex.parity_even.forEach((p, j) => close(p, c.par[j] / tot)); ex.consecutive.forEach((p, j) => close(p, c.cons[j] / tot));
    ex.amplitude.forEach((p, j) => close(p, c.amp[j] / tot)); ex.band.forEach((p, j) => close(p, c.band[j] / tot));
  }
});
