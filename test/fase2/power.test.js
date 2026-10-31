// Fase 2 — taxa de falsos positivos (15) e poder sob distorções ARTIFICIAIS (16). DADOS SINTÉTICOS.
import test from 'node:test'; import assert from 'node:assert/strict';
import { errorRateExperiment, weightedSampler, createRng, biasWeights, binomialBounds } from '../../src/lab.js';
import { getLottery } from '../../src/lotteries/config.js';
import { LOTTERY_IDS, DELTA, assertCells } from './_helpers.js';

for (const id of LOTTERY_IDS) {
  test(`[15] ${id}: FPR sob H0 — Holm controla FWER na família por dezena; sem correção a taxa familiar é maior`, () => {
    const R = 120; const e = errorRateExperiment({ lottery: id, draws: 100, reps: R, B: 39, alphas: [0.05, 0.2], seed: 15, nullMode: 'per_rep' });
    assert.equal(e.kind, 'false_positive_rate'); assert.equal(e.data_kind, 'SYNTHETIC_DATA');
    for (const a of ['0.05', '0.2']) {
      const al = Number(a); const { hi } = binomialBounds(R, al, 2 * DELTA / 20);
      // Réplicas independentes (nullMode per_rep): #rejeições ≤ Binomial(R, alpha) estocasticamente
      for (const s of Object.keys(e.per_statistic)) assert.ok(e.per_statistic[s][a].count <= hi, `${s} ${a}`);
      assert.ok(e.families.number_holm[a].count <= hi, `holm ${a}`);    // Holm: FWER ≤ alpha sob qualquer dependência
      assert.ok(e.families.global_holm[a].count <= hi, `global holm ${a}`);
      assert.ok(e.families.number_unadjusted[a].count >= e.families.number_holm[a].count);
      assert.ok(e.families.number_holm[a].count <= e.families.number_bh[a].count);
    }
    // Com N testes não corrigidos a FWER é grande (≈ 1−(1−α')^N para α' efetivo); exigimos > Holm de forma estrita a α=0.05
    assert.ok(e.families.number_unadjusted['0.05'].count > e.families.number_holm['0.05'].count);
  });
  test(`[16] ${id}: poder sob viés artificial forte (peso 3 em uma dezena) ≈ 1 e maior que sob viés fraco`, () => {
    const r = getLottery(id), D = 1000, R = 20, n = r.minNumber + 3;
    // Cota inferior: em cada um dos k passos a dezena-alvo tem prob ≥ 3/(N+2) ⇒ P(incluir) ≥ q = 1−(1−3/(N+2))^k > k/N.
    // Contagem ≥ cota inferior exata de Binomial(D,q); nessa contagem o p binomial sob H0 é ≪ 0.05/N ⇒ Holm rejeita sempre.
    const strong = errorRateExperiment({ lottery: id, draws: D, reps: R, B: 19, alphas: [0.05], seed: 16, bias: { type: 'single', number: n, boost: 2 } });
    const weak = errorRateExperiment({ lottery: id, draws: D, reps: R, B: 19, alphas: [0.05], seed: 16, bias: { type: 'single', number: n, boost: 0.01 } });
    assert.equal(strong.kind, 'power'); assert.equal(strong.families.target_detected_holm['0.05'].count, R);
    assert.ok(strong.families.target_detected_holm['0.05'].count > weak.families.target_detected_holm['0.05'].count);
  });
  test(`[16] ${id}: amostrador ponderado — pesos iguais ⇒ uniforme; peso maior ⇒ inclusão maior; sem duplicatas`, () => {
    const r = getLottery(id), M = 20000; const eq = weightedSampler(createRng(1), new Array(r.universe).fill(1), r.draw, r.minNumber);
    const c = new Array(r.universe).fill(0); for (let i = 0; i < M; i++) { const d = eq(); assert.equal(new Set(d).size, r.draw); for (const x of d) c[x - r.minNumber]++; }
    assertCells(c, c.map(() => r.draw / r.universe), M, DELTA, 'ponderado-igual');
    const g = weightedSampler(createRng(2), biasWeights(id, { type: 'group', numbers: [r.minNumber, r.minNumber + 1], factor: 4 }), r.draw, r.minNumber);
    let hit = 0; for (let i = 0; i < M; i++) if (g().includes(r.minNumber)) hit++;
    const q = 1 - (1 - 4 / (r.universe + 6)) ** r.draw; // cota inferior da prob. de inclusão
    assert.ok(hit >= binomialBounds(M, Math.min(q, 0.999999), DELTA).lo || hit === M);
  });
}
