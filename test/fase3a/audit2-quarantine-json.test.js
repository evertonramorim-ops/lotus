// Revisão complementar item 3: a quarentena aceita SOMENTE valores JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuarantineEntry, QuarantineStore, assertJsonValue } from '../../src/data/quarantine.js';

const base = c => ({ rawSha256: 'a'.repeat(64), stage: 'validate', parserVersion: 'p/1', reasons: [{ code: 'X', message: 'm', path: '$' }], candidate: c });
class Foo { constructor() { this.a = 1; } }
const circ = { a: 1 }; circ.self = circ;
const circArr = [1]; circArr.push(circArr);
const symKey = { a: 1, [Symbol('s')]: 2 };
const getter = {}; Object.defineProperty(getter, 'x', { get() { throw new Error('getter NÃO deve ser executado'); }, enumerable: true });
const setterOnly = {}; Object.defineProperty(setterOnly, 'x', { set(_v) {}, enumerable: true });
const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
const arrExtra = [1, 2]; arrExtra.foo = 'bar';

const INVALID = {
  Map: new Map([[1, 2]]), Set: new Set([1]), Date: new Date(0), RegExp: /x/,
  Uint8Array: new Uint8Array([1]), Float64Array: new Float64Array(1), ArrayBuffer: new ArrayBuffer(4), DataView: new DataView(new ArrayBuffer(4)),
  função: () => 1, símbolo: Symbol('s'), BigInt: 10n, undefined_aninhado: { a: undefined }, NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity,
  'circular (objeto)': circ, 'circular (array)': circArr, 'instância de classe': new Foo(), 'Error': new Error('e'),
  'chave símbolo': symKey, 'acessor getter': getter, 'acessor setter': setterOnly, 'array esparso': sparse, 'array com propriedade extra': arrExtra,
  'boxed String': new String('x'), 'Promise': Promise.resolve(1), 'WeakMap': new WeakMap(),
  'aninhado profundo': { a: [{ b: [1, { c: new Map() }] }] },
};

for (const [name, v] of Object.entries(INVALID)) {
  test(`quarentena rejeita ${name} (no candidato, aninhado e via store.add)`, () => {
    assert.throws(() => createQuarantineEntry(base(v)), TypeError);
    assert.throws(() => createQuarantineEntry(base({ wrap: [v] })), TypeError);
    const s = new QuarantineStore();
    assert.throws(() => s.add(base(v)), TypeError);
    assert.equal(s.size, 0, 'nada armazenado após rejeição');
  });
}

test('quarentena rejeita valores não-JSON também nos motivos', () => {
  assert.throws(() => createQuarantineEntry({ ...base(null), reasons: [{ code: 'X', message: 'm', extra: new Date() }] }), TypeError);
  assert.throws(() => createQuarantineEntry({ ...base(null), reasons: [{ code: 'X', message: 'm', n: NaN }] }), TypeError);
});

test('valores JSON válidos são aceitos e permanecem imutáveis e independentes (add/list/byCode)', () => {
  const VALID = [null, true, false, 0, -1.5, 1e300, '', 'texto ç 😀', [], {}, [1, 'a', null, [true, { x: {} }]],
    Object.assign(Object.create(null), { a: 1, b: [Object.assign(Object.create(null), { c: 'd' })] }),
    { shared: [1], again: null }];
  const s = new QuarantineStore();
  for (const v of VALID) {
    assertJsonValue(v);
    const e = createQuarantineEntry(base(v));
    assert.ok(Object.isFrozen(e));
    assert.deepEqual(JSON.parse(JSON.stringify(e.candidate)), JSON.parse(JSON.stringify(v)));
    s.add(base(v));
  }
  // referência compartilhada (DAG, não ciclo) é aceita
  const shared = { k: 1 }; s.add(base({ a: shared, b: shared }));
  assert.equal(s.size, VALID.length + 1);
  const deepFrozen = x => x === null || typeof x !== 'object' || (Object.isFrozen(x) && Reflect.ownKeys(x).every(k => deepFrozen(x[k])));
  for (const list of [s.list(), s.byCode('X')]) {
    assert.equal(list.length, VALID.length + 1);
    for (const e of list) assert.ok(deepFrozen(e));
    if (list[10].candidate) assert.throws(() => { 'use strict'; list[10].candidate[3][1].x.novo = 1; }, TypeError);
  }
  // mutar a origem não altera o armazenado
  shared.k = 999;
  assert.equal(s.list().at(-1).candidate.a.k, 1);
  assert.notEqual(s.list()[10], s.list()[10], 'cada leitura devolve cópia nova');
});
