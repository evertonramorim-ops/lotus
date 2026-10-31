// Fase 2 — gerador pseudoaleatório (categorias 1 e 2). DADOS SINTÉTICOS.
import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Xoshiro128ss, createRng, rejectionLimit, deriveSeed, GENERATOR_VERSION, drawStream } from '../../src/lab.js';
import { LOTTERY_IDS } from './_helpers.js';

test('[1] vetor conhecido xoshiro128** (estado {1,2,3,4}) = implementação de referência em C', () => {
  // Saídas obtidas compilando o código de referência de Blackman & Vigna (xoshiro128starstar.c).
  const g = Xoshiro128ss.fromState([1, 2, 3, 4]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(() => g.nextUint32()), [11520, 0, 5927040, 70819200, 2031721883, 1637235492]);
});
test('[1] semeadura SplitMix64 = referência em C (sementes 0, 42, 20261031)', () => {
  const ref = { 0: [3737715805, 2584255861, 2876756834, 3286328325, 1553311962, 1625202774], 42: [1776835114, 4165204688, 17111135, 2317295270, 2792088233, 2554630222], 20261031: [2695429380, 3715314105, 1089746066, 1442482496, 4263507641, 3098821037] };
  for (const [s, v] of Object.entries(ref)) { const g = createRng(Number(s)); assert.deepEqual(v.map(() => g.nextUint32()), v); }
  assert.equal(GENERATOR_VERSION, '1.0.0');
});
for (const id of LOTTERY_IDS) {
  test(`[1] ${id}: mesma semente ⇒ mesma sequência de concursos`, () => {
    const a = [...drawStream({ lottery: id, seed: 123456789, draws: 500 })], b = [...drawStream({ lottery: id, seed: 123456789n, draws: 500 })];
    assert.deepEqual(a, b);
  });
  test(`[2] ${id}: sementes diferentes ⇒ sequências diferentes`, () => {
    const a = [...drawStream({ lottery: id, seed: 1, draws: 50 })], b = [...drawStream({ lottery: id, seed: 2, draws: 50 })];
    assert.notDeepEqual(a, b);
    // praticamente todos os concursos diferem (coincidência exige o mesmo k-subconjunto em C(N,k) possíveis)
    assert.ok(a.filter((d, i) => d.join() === b[i].join()).length <= 1);
  });
}
test('[2] sementes derivadas por rótulo são distintas e determinísticas', () => {
  const s = new Set(); for (let i = 0; i < 1000; i++) s.add(deriveSeed(7, `rep:${i}`));
  assert.equal(s.size, 1000); assert.equal(deriveSeed(7, 'x'), deriveSeed(7n, 'x'));
});
test('rejeição sem viés de módulo: L = 2^32 − (2^32 mod n) é múltiplo de n e valores ≥ L são rejeitados', () => {
  for (const n of [1, 2, 3, 6, 7, 10, 60, 99, 100, 1000003, 2 ** 31 + 1, 2 ** 32]) {
    const L = rejectionLimit(n); assert.equal(L % n, 0); assert.ok(L > 2 ** 32 - n && L <= 2 ** 32);
  }
  // gerador falso: primeiro devolve valor ≥ L (deve ser rejeitado), depois 5
  const n = 2 ** 31 + 1, L = rejectionLimit(n); const g = Xoshiro128ss.fromState([1, 2, 3, 4]); const seq = [L, L + 1, 5]; g.nextUint32 = () => seq.shift();
  assert.equal(g.uniformInt(n), 5);
});
test('uniformInt e nextFloat dentro dos limites', () => {
  const g = createRng(99); for (let i = 0; i < 20000; i++) { const n = 1 + (i % 100); const x = g.uniformInt(n); assert.ok(Number.isInteger(x) && x >= 0 && x < n); const f = g.nextFloat(); assert.ok(f >= 0 && f < 1); }
});
test('Math.random não é usado nos módulos da Fase 2', () => {
  for (const dir of ['src/sim', 'src/stats']) for (const f of readdirSync(dir)) assert.ok(!/Math\.random\s*\(/.test(readFileSync(`${dir}/${f}`, 'utf8')), `${dir}/${f}`);
});
