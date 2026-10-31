// Fase 2 — calibração de valores-p por Monte Carlo (12), Holm (13), BH (14). DADOS SINTÉTICOS.
import test from 'node:test'; import assert from 'node:assert/strict';
import { mcPValue, nullDistribution, computeStatistics, uniformityTest, drawStream, deriveSeed, holm, benjaminiHochberg, adjustFamily, binomialBounds, STATISTICS, runExperiment } from '../../src/lab.js';
import { getLottery } from '../../src/lotteries/config.js';
import { LOTTERY_IDS, DELTA } from './_helpers.js';

test('[12] fórmula p=(b+1)/(B+1), resolução 1/(B+1), nunca zero', () => {
  assert.deepEqual(mcPValue(5, Float64Array.from([1, 2, 3, 4])), { b: 0, B: 4, p: 0.2, resolution: 0.2 });
  assert.equal(mcPValue(2.5, Float64Array.from([1, 2, 3, 4])).p, 3 / 5);
  assert.equal(mcPValue(0, Float64Array.from([1, 2, 3, 4])).p, 1);
  assert.equal(mcPValue(3, Float64Array.from([1, 2, 3, 4])).b, 2); // empate conta como "tão extremo"
});
for (const id of LOTTERY_IDS) {
  test(`[12] ${id}: sob H0 os valores-p MC são (super)uniformes — R=200 conjuntos, B=99, nulas independentes`, () => {
    // Para estatística contínua, p=(b+1)/(B+1) é uniforme discreto em {1/100,...,1}; com empates P(p≤a) ≤ a.
    // Com réplicas independentes, #{p ≤ a} é estocasticamente ≤ Binomial(200, a); exigimos ≤ cota superior exata (δ=1e-6).
    const r = getLottery(id), D = 30, R = 200, B = 99; const ps = Object.fromEntries(STATISTICS.map(s => [s, []]));
    for (let i = 0; i < R; i++) {
      const { stats } = computeStatistics(id, drawStream({ lottery: id, seed: deriveSeed(12, `d${i}`), draws: D }));
      const nd = nullDistribution({ lottery: id, draws: D, B, seed: deriveSeed(12, `n${i}`) });
      for (const s of STATISTICS) ps[s].push(mcPValue(stats[s], nd[s]).p);
    }
    for (const s of STATISTICS) for (const a of [0.05, 0.1, 0.5]) {
      const c = ps[s].filter(p => p <= a + 1e-12).length; const { hi } = binomialBounds(R, a, 2 * DELTA / 12); // unilateral: δ/12 por (estat., alpha)
      assert.ok(c <= hi, `${id} ${s} a=${a}: ${c} > ${hi}`);
    }
    // estatística de frequência (quase contínua): também não deve ficar concentrada em p grandes
    const cf = ps.freq_pearson.filter(p => p <= 0.5).length; const { lo } = binomialBounds(R, 0.5 - 3 / 100, 2 * DELTA);
    assert.ok(cf >= lo, `freq: ${cf} < ${lo}`); void r;
  });
}
test('[12] E_H0[X_Pearson] = N − k (não N − 1): média MC próxima', () => {
  // X/(N−k) tem média 1; com B=400 réplicas verificamos |média−(N−k)| ≤ 15% (desvio-padrão de X≈√(2(N−k)) ⇒ erro-padrão da média < 2%).
  for (const id of LOTTERY_IDS) { const r = getLottery(id); const nd = nullDistribution({ lottery: id, draws: 200, B: 400, seed: 3 }); const m = nd.freq_pearson.reduce((a, b) => a + b, 0) / 400; assert.ok(Math.abs(m / (r.universe - r.draw) - 1) < 0.15, `${id} ${m}`); }
});
test('[12] uniformityTest: estrutura, tamanho de efeito, alpha configurável, sem tabela qui-quadrado', () => {
  const { stats } = computeStatistics('quina', drawStream({ lottery: 'quina', seed: 1, draws: 300 }));
  const t = uniformityTest({ lottery: 'quina', observed: stats, draws: 300, B: 49, seed: 2, alpha: 0.1 });
  assert.equal(t.data_kind, 'SYNTHETIC_DATA'); assert.equal(t.p_value_resolution, 1 / 50); assert.equal(t.alpha, 0.1); assert.equal(t.tests.length, 4);
  for (const x of t.tests) { assert.ok(x.p >= 1 / 50 && x.p <= 1); assert.equal(x.reject, x.p <= 0.1); }
  assert.ok(t.effect_size.cramers_v_like >= 0);
});

const close = (a, b) => a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-12, `${a} vs ${b}`));
test('[13] Holm: exemplos calculados à mão (= p.adjust(method="holm") do R)', () => {
  // p=(.01,.02,.03,.04,.05): 5·.01=.05; 4·.02=.08; 3·.03=.09; max(.09,2·.04=.08)=.09; max(.09,.05)=.09
  close(holm([0.01, 0.02, 0.03, 0.04, 0.05]), [0.05, 0.08, 0.09, 0.09, 0.09]);
  // p=(.01,.04,.03,.005): ordenado .005,.01,.03,.04 → .02,.03,.06,max(.06,.04)=.06 → na ordem original (.03,.06,.06,.02)
  close(holm([0.01, 0.04, 0.03, 0.005]), [0.03, 0.06, 0.06, 0.02]);
  close(holm([0.5, 0.6, 0.9]), [1, 1, 1]); // truncamento em 1
  close(holm([0.2]), [0.2]);
  // monotonicidade: ordem dos ajustados acompanha a dos originais
  const p = [0.001, 0.3, 0.02, 0.04, 0.0001, 0.7], h = holm(p); for (let i = 0; i < p.length; i++) for (let j = 0; j < p.length; j++) if (p[i] < p[j]) assert.ok(h[i] <= h[j]);
});
test('[14] Benjamini–Hochberg: exemplos calculados à mão (= p.adjust(method="BH") do R)', () => {
  // (.01,...,.05): de cima: .05·5/5=.05; .04·5/4=.05; .03·5/3=.05; .02·5/2=.05; .01·5/1=.05
  close(benjaminiHochberg([0.01, 0.02, 0.03, 0.04, 0.05]), [0.05, 0.05, 0.05, 0.05, 0.05]);
  // (.01,.04,.03,.005): ordenado .005,.01,.03,.04 → .04·4/4=.04; min(.04,.03·4/3=.04)=.04; min(.04,.01·4/2=.02)=.02; min(.02,.005·4=.02)=.02
  close(benjaminiHochberg([0.01, 0.04, 0.03, 0.005]), [0.02, 0.04, 0.04, 0.02]);
  close(benjaminiHochberg([0.5, 0.6, 0.9]), [0.9, 0.9, 0.9]);
  // (.001,.008,.039,.041,.042,.06,.074,.205): m=8; de cima: .205; .074·8/7=.084571…; .06·8/6=.08; .042·8/5=.0672; .041·8/4=.082→.0672; .039·8/3=.104→.0672; .008·8/2=.032; .001·8=.008
  close(benjaminiHochberg([0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205]), [0.008, 0.032, 0.0672, 0.0672, 0.0672, 0.08, 0.074 * 8 / 7, 0.205]);
  const p = [0.001, 0.3, 0.02, 0.04, 0.0001, 0.7], b = benjaminiHochberg(p), h = holm(p); for (let i = 0; i < p.length; i++) { assert.ok(b[i] <= h[i] + 1e-15); assert.ok(b[i] >= p[i] - 1e-15); }
});
test('[13][14] família documentada: m, p originais e ajustados, rótulo exploratório/confirmatório, sem seleção', () => {
  const f = adjustFamily({ name: 'teste', kind: 'confirmatory', alpha: 0.05, hypotheses: [{ id: 'a', p: 0.01 }, { id: 'b', p: 0.04 }, { id: 'c', p: 0.03 }, { id: 'd', p: 0.005 }] });
  assert.equal(f.m, 4); assert.equal(f.kind, 'confirmatory'); assert.equal(f.results.length, 4);
  assert.deepEqual(f.rejections, { unadjusted: 4, holm: 2, bh: 4 });
  const e = runExperiment({ type: 'uniformity', lottery: 'megasena', seed: 1, draws: 200, B: 19 });
  assert.equal(e.results.multiple_comparisons.kind, 'exploratory'); assert.equal(e.results.multiple_comparisons.m, 4);
});
