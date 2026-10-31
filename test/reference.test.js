// Re-execução dos 9 testes matemáticos de referência (evidencias/teste_cripto_math.mjs) contra a NOVA implementação.
// Os 5 testes criptográficos (JCS/ECDSA) não pertencem à Fase 1; o script original é re-executado separadamente.
import test from 'node:test'; import assert from 'node:assert/strict';
import { binomial, hypergeometricDistribution, expectation, Fraction } from '../index.js';
const Cref = (n, k) => { n = BigInt(n); k = BigInt(k); if (k < 0n || k > n) return 0n; if (k > n - k) k = n - k; let r = 1n; for (let i = 1n; i <= k; i++) r = r * (n - k + i) / i; return r; };
test('REF06 C(60,6)', () => assert.equal(binomial(60, 6), Cref(60, 6)));
test('REF07 C(25,15)', () => assert.equal(binomial(25, 15), Cref(25, 15)));
test('REF08 C(80,5)', () => assert.equal(binomial(80, 5), Cref(80, 5)));
test('REF09 pares/trincas Mega', () => { assert.equal(binomial(60, 2), 1770n); assert.equal(binomial(60, 3), 34220n); });
const d = hypergeometricDistribution(100, 50, 20); const p = k => Cref(50, k) * Cref(50, 20 - k); const den = Cref(100, 20);
test('REF10 P(X=0)=P(X=20)', () => { assert.ok(d[0].p.equals(d[20].p)); assert.ok(d[0].p.equals(new Fraction(p(0), den))); });
test('REF11 simetria k=0..20', () => { for (let k = 0; k <= 20; k++) { assert.ok(d[k].p.equals(d[20 - k].p)); assert.equal(d[k].count, p(k)); } });
test('REF12 soma = 1 (Vandermonde)', () => assert.equal(d.reduce((a, x) => a + x.count, 0n), den));
test('REF13 E(X)=10', () => assert.ok(expectation(100, 50, 20).equals(new Fraction(10n))));
test('REF14 decimal 30 casas de P(20)', () => assert.equal(d[20].p.toDecimalString(30), (() => { let s = '0.'; let r = p(20); for (let i = 0; i < 30; i++) { r *= 10n; s += (r / den).toString(); r %= den; } return s; })()));
