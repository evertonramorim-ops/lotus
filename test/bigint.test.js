import test from 'node:test'; import assert from 'node:assert/strict';
import { factorial, binomial, permutations, gcd, Fraction } from '../index.js';
const naiveC = (n, k) => k > n ? 0n : factorial(n) / (factorial(k) * factorial(n - k));
test('C(60,6)=50063860', () => assert.equal(binomial(60, 6), 50063860n));
test('C(25,15)=3268760', () => assert.equal(binomial(25, 15), 3268760n));
test('C(80,5)=24040016', () => assert.equal(binomial(80, 5), 24040016n));
test('C(100,20)=535983370403809682970', () => assert.equal(binomial(100, 20), 535983370403809682970n));
test('C(100,50) = n!/(k!(n-k)!) independente', () => assert.equal(binomial(100, 50), naiveC(100, 50)));
test('C(n,0)=C(n,n)=1 para n=0..100', () => { for (let n = 0; n <= 100; n++) { assert.equal(binomial(n, 0), 1n); assert.equal(binomial(n, n), 1n); } });
test('C(n,k)=0 quando k>n', () => { assert.equal(binomial(5, 6), 0n); assert.equal(binomial(0, 1), 0n); });
test('simetria C(n,k)=C(n,n-k) e Pascal, n<=80', () => { for (let n = 1; n <= 80; n++) for (let k = 1; k < n; k++) { assert.equal(binomial(n, k), binomial(n, n - k)); assert.equal(binomial(n, k), binomial(n - 1, k - 1) + binomial(n - 1, k)); } });
test('binomial vs fórmula fatorial para n<=60 todos k', () => { for (let n = 0; n <= 60; n++) for (let k = 0; k <= n; k++) assert.equal(binomial(n, k), naiveC(n, k)); });
test('binomial aceita bigint', () => assert.equal(binomial(60n, 6n), 50063860n));
test('entradas inválidas lançam erro', () => {
  for (const [n, k] of [[-1, 0], [5, -1], [5.5, 2], [5, 2.1], ['5', 2], [NaN, 1], [Infinity, 1], [2 ** 60, 1], [-1n, 0n]]) assert.throws(() => binomial(n, k));
  assert.throws(() => factorial(-1)); assert.throws(() => factorial(1.5)); assert.throws(() => permutations(-2, 1));
});
test('factorial(0)=factorial(1)=1', () => { assert.equal(factorial(0), 1n); assert.equal(factorial(1), 1n); });
test('25! = 15511210043330985984000000', () => assert.equal(factorial(25), 15511210043330985984000000n));
test('20! = 2432902008176640000', () => assert.equal(factorial(20), 2432902008176640000n));
test('permutations P(10,3)=720, P(n,n)=n!, k>n=0', () => { assert.equal(permutations(10, 3), 720n); assert.equal(permutations(12, 12), factorial(12)); assert.equal(permutations(3, 4), 0n); });
test('gcd', () => { assert.equal(gcd(12n, 18n), 6n); assert.equal(gcd(-12n, 18n), 6n); assert.equal(gcd(0n, 5n), 5n); assert.equal(gcd(17n, 5n), 1n); assert.throws(() => gcd(1, 2)); });
test('Fraction reduz e normaliza sinal', () => { const f = new Fraction(6n, -8n); assert.equal(f.num, -3n); assert.equal(f.den, 4n); assert.equal(new Fraction(0n, 7n).toString(), '0'); assert.throws(() => new Fraction(1n, 0n)); assert.throws(() => new Fraction(1.5)); });
test('Fraction add/sub/mul/div/compare/equals', () => {
  const a = new Fraction(1n, 3n), b = new Fraction(1n, 6n);
  assert.equal(a.add(b).toString(), '1/2'); assert.equal(a.sub(b).toString(), '1/6'); assert.equal(a.mul(b).toString(), '1/18'); assert.equal(a.div(b).toString(), '2');
  assert.equal(a.compare(b), 1); assert.equal(b.compare(a), -1); assert.equal(a.compare(new Fraction(2n, 6n)), 0); assert.ok(a.equals(new Fraction(5n, 15n)));
  assert.throws(() => a.div(new Fraction(0n)));
});
test('toDecimalString truncado e controlado', () => {
  assert.equal(new Fraction(1n, 3n).toDecimalString(5), '0.33333'); assert.equal(new Fraction(2n, 3n).toDecimalString(5), '0.66666');
  assert.equal(new Fraction(-1n, 8n).toDecimalString(4), '-0.1250'); assert.equal(new Fraction(7n, 2n).toDecimalString(0), '3');
  assert.equal(new Fraction(1n, 50063860n).toDecimalString(20), '0.00000001997448858318');
  assert.throws(() => new Fraction(1n).toDecimalString(-1));
});
test('toNumber precisão relativa < 1e-15', () => {
  for (const [n, d] of [[1n, 3n], [1n, 50063860n], [148n, 1683150111n], [10n ** 30n + 7n, 3n * 10n ** 29n], [1n, 10n ** 40n]]) {
    const x = new Fraction(n, d).toNumber(); const ref = Number(n) / Number(d); assert.ok(Math.abs(x - ref) / ref < 1e-15, `${n}/${d}`);
  }
  assert.equal(new Fraction(0n).toNumber(), 0); assert.equal(new Fraction(-1n, 4n).toNumber(), -0.25);
});
