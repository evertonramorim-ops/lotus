import test from 'node:test'; import assert from 'node:assert/strict';
import { Fraction, binomial, hypergeometricDistribution, hypergeometricPmf, hypergeometricCount, expectation, variance, support } from '../index.js';
function combos(N, n) { const out = []; const rec = (s, a) => { if (a.length === n) { out.push(a.slice()); return; } for (let i = s; i < N; i++) { a.push(i); rec(i + 1, a); a.pop(); } }; rec(0, []); return out; }
for (const [N, K, n] of [[10, 3, 3], [10, 4, 3], [10, 7, 3], [12, 5, 4], [9, 9, 4], [8, 0, 3], [11, 6, 6]]) {
  test(`força bruta N=${N},K=${K},n=${n}: contagens = enumeração`, () => {
    const all = combos(N, n); const cnt = Array(n + 1).fill(0n);
    for (const c of all) cnt[c.filter(x => x < K).length]++;
    assert.equal(BigInt(all.length), binomial(N, n));
    for (let k = 0; k <= n; k++) assert.equal(hypergeometricCount(N, K, n, k), cnt[k]);
  });
}
test('suporte e P=0 fora do suporte', () => {
  assert.deepEqual(support(10, 8, 5), { min: 3, max: 5 });
  assert.ok(hypergeometricPmf(10, 8, 5, 2).isZero()); assert.ok(!hypergeometricPmf(10, 8, 5, 3).isZero());
  assert.ok(hypergeometricPmf(10, 8, 5, 6).isZero()); assert.ok(hypergeometricPmf(10, 8, 5, -1).isZero());
});
test('variância = fórmula fechada (vários casos)', () => {
  for (const [N, K, n] of [[60, 6, 6], [25, 15, 15], [80, 5, 5], [100, 50, 20], [60, 20, 6]]) {
    const closed = new Fraction(BigInt(n * K * (N - K) * (N - n)), BigInt(N * N * (N - 1)));
    assert.ok(variance(N, K, n).equals(closed));
    assert.ok(expectation(N, K, n).equals(new Fraction(BigInt(K * n), BigInt(N))));
  }
});
test('parâmetros inválidos lançam', () => { assert.throws(() => hypergeometricDistribution(10, 11, 3)); assert.throws(() => hypergeometricDistribution(10, 3, 11)); assert.throws(() => hypergeometricPmf(10, 3, 3, 1.5)); assert.throws(() => hypergeometricDistribution(-1, 0, 0)); });
test('soma da distribuição=1 para todo K,n com N=20', () => { for (let K = 0; K <= 20; K++) for (let n = 0; n <= 20; n++) { const s = hypergeometricDistribution(20, K, n).reduce((a, r) => a.add(r.p), new Fraction(0n)); assert.ok(s.equals(new Fraction(1n))); } });
