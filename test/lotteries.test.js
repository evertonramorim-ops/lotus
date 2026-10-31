import test from 'node:test'; import assert from 'node:assert/strict';
import { LOTTERIES, PRICING, allowedBetSizes, assertBetSize, getLottery, hitDistribution, hitProbability, tierProbabilities, topPrizeProbability, simpleBetsInMultiple, internalSimpleBetsWithHits, expectation, Fraction, binomial, pairCount, tripleCount, totalCombinations } from '../index.js';
const ONE = new Fraction(1n);
for (const id of Object.keys(LOTTERIES)) {
  const r = LOTTERIES[id];
  for (const K of allowedBetSizes(id)) {
    test(`${id} aposta ${K}: soma=1, E=Kn/N, suporte, fora=0`, () => {
      const d = hitDistribution(id, K); const N = r.universe, n = r.draw;
      assert.ok(d.reduce((a, x) => a.add(x.p), new Fraction(0n)).equals(ONE));
      assert.equal(d.reduce((a, x) => a + x.count, 0n), binomial(N, n));
      assert.ok(expectation(N, K, n).equals(new Fraction(BigInt(K * n), BigInt(N))));
      const lo = Math.max(0, n - (N - K)), hi = Math.min(K, n);
      for (const x of d) assert.equal(x.p.isZero(), x.k < lo || x.k > hi, `k=${x.k}`);
      assert.ok(hitProbability(id, K, n + 1).isZero()); assert.ok(hitProbability(id, K, -1).isZero());
      assert.ok(topPrizeProbability(id, K).equals(hitProbability(id, K, n)));
      assert.equal(simpleBetsInMultiple(id, K), binomial(K, n));
      // decomposição: múltipla com h acertos contém C(K,n) simples no total
      for (let h = lo; h <= hi; h++) { let t = 0n; for (let j = 0; j <= n; j++) t += internalSimpleBetsWithHits(id, K, h, j); assert.equal(t, binomial(K, n)); }
    });
  }
  test(`${id}: rejeita tamanhos inválidos`, () => { for (const s of [r.minBet - 1, r.maxBet + 1, 0, -1, r.minBet + 0.5, NaN]) assert.throws(() => assertBetSize(id, s)); });
}
test('modalidade desconhecida e protótipo', () => { assert.throws(() => getLottery('x')); assert.throws(() => getLottery('toString')); });
test('regras: sem preços (placeholder null) e objetos congelados', () => { assert.equal(PRICING, null); assert.ok(Object.isFrozen(LOTTERIES.megasena)); for (const r of Object.values(LOTTERIES)) assert.equal(r.maxNumber - r.minNumber + 1, r.universe); });
test('Mega simples: 1 em 50063860', () => assert.equal(topPrizeProbability('megasena', 6).toString(), '1/50063860'));
test('Mega 7 números: 7 jogos, 1 em 7151980', () => { assert.equal(simpleBetsInMultiple('megasena', 7), 7n); assert.equal(topPrizeProbability('megasena', 7).toString(), '1/7151980'); });
test('Mega 15 números: C(15,6)=5005 jogos, prob=5005/50063860', () => { assert.equal(simpleBetsInMultiple('megasena', 15), 5005n); assert.ok(topPrizeProbability('megasena', 15).equals(new Fraction(5005n, 50063860n))); });
test('Mega 20: C(20,6)=38760', () => assert.equal(simpleBetsInMultiple('megasena', 20), 38760n));
test('Lotofácil simples 1/3268760; 16 números 16 jogos → 2/408595', () => { assert.equal(topPrizeProbability('lotofacil', 15).toString(), '1/3268760'); assert.equal(topPrizeProbability('lotofacil', 16).toString(), '2/408595'); });
test('Quina simples 1/24040016', () => assert.equal(topPrizeProbability('quina', 5).toString(), '1/24040016'));
test('Lotomania P(20)=P(0)=148/1683150111', () => { assert.equal(hitProbability('lotomania', 50, 20).toString(), '148/1683150111'); assert.equal(hitProbability('lotomania', 50, 0).toString(), '148/1683150111'); });
test('Lotomania simetria P(k)=P(20-k), soma=1, E=10', () => {
  const d = hitDistribution('lotomania', 50); assert.equal(d.length, 21);
  for (let k = 0; k <= 20; k++) assert.ok(d[k].p.equals(d[20 - k].p));
  assert.ok(d.reduce((a, x) => a.add(x.p), new Fraction(0n)).equals(ONE));
  assert.ok(expectation(100, 50, 20).equals(new Fraction(10n)));
  assert.deepEqual(tierProbabilities('lotomania', 50).map(t => t.tier), [0, 15, 16, 17, 18, 19, 20]);
});
test('pares/trincas vs fórmula independente N(N-1)/2, N(N-1)(N-2)/6', () => {
  assert.equal(pairCount('megasena'), 1770n); assert.equal(tripleCount('megasena'), 34220n);
  for (const id of Object.keys(LOTTERIES)) { const N = BigInt(LOTTERIES[id].universe); assert.equal(pairCount(id), N * (N - 1n) / 2n); assert.equal(tripleCount(id), N * (N - 1n) * (N - 2n) / 6n); }
  assert.equal(pairCount('quina'), 3160n); assert.equal(pairCount('lotomania'), 4950n); assert.equal(tripleCount('lotomania'), 161700n); assert.equal(pairCount('lotofacil'), 300n);
  assert.equal(totalCombinations('lotomania'), 535983370403809682970n);
});
