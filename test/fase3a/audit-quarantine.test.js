// Auditoria item 4: imutabilidade real (profunda) da quarentena.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuarantineEntry, QuarantineStore, deepFreeze } from '../../src/data/quarantine.js';

const mkCandidate = () => ({ lottery: 'quina', numbers: [1, 2, 3, 4, 99], provenance: { sourceType: 'SYNTHETIC_DATA', nested: { deep: [{ x: 1 }] } } });
const mkReasons = () => [{ code: 'OUT_OF_RANGE', path: '$.numbers[4]', message: '99 fora de 1..80', extra: { list: [1] } }];
const base = () => ({ rawSha256: 'a'.repeat(64), stage: 'validate', parserVersion: '1.0.0', reasons: mkReasons(), candidate: mkCandidate() });
const tryMutate = fn => { try { fn(); } catch { /* TypeError em modo estrito é aceitável */ } };

test('entrada: candidato, arrays, motivos e objetos aninhados estão profundamente congelados', () => {
  const e = createQuarantineEntry(base());
  for (const o of [e, e.candidate, e.candidate.numbers, e.candidate.provenance, e.candidate.provenance.nested, e.candidate.provenance.nested.deep, e.candidate.provenance.nested.deep[0], e.reasons, e.reasons[0], e.reasons[0].extra, e.reasons[0].extra.list]) assert.ok(Object.isFrozen(o));
  assert.throws(() => { e.candidate.numbers.push(5); }, TypeError);
  assert.throws(() => { e.candidate.lottery = 'x'; }, TypeError);
  assert.throws(() => { e.reasons[0].code = 'X'; }, TypeError);
  assert.throws(() => { e.candidate.provenance.nested.deep[0].x = 2; }, TypeError);
});

test('referências externas: mutar o objeto original após criar/armazenar não altera a quarentena', () => {
  const input = base(); const e = createQuarantineEntry(input); const s = new QuarantineStore(); s.add(e);
  const input2 = base(); s.add(input2);
  for (const src of [input, input2]) {
    src.candidate.numbers[0] = 77; src.candidate.numbers.push(1); src.candidate.provenance.nested.deep[0].x = 9;
    src.reasons[0].message = 'adulterado'; src.reasons.push({ code: 'Z', message: 'z' }); src.candidate.lottery = 'megasena';
  }
  for (const got of [e, ...s.list()]) assert.deepEqual(structuredClone(got), structuredClone(createQuarantineEntry(base())));
});

test('list() e byCode(): saídas não permitem alterar o armazenado e preservam ordem e conteúdo exato', () => {
  const s = new QuarantineStore();
  for (let i = 0; i < 3; i++) s.add({ ...base(), rawSha256: String(i).repeat(64) });
  const l = s.list();
  tryMutate(() => { l[0].candidate.numbers[0] = 0; }); tryMutate(() => { l[0].reasons.length = 0; }); tryMutate(() => { l[0].candidate.provenance.nested.deep.push(1); });
  l.reverse(); l.length = 0;
  const again = s.list();
  assert.deepEqual(again.map(e => e.rawSha256[0]), ['0', '1', '2']);
  assert.deepEqual(again[0].candidate, mkCandidate()); assert.deepEqual(again[0].reasons, mkReasons());
  assert.notEqual(again[0], s.list()[0]); // cópia a cada leitura
  const b = s.byCode('OUT_OF_RANGE'); assert.equal(b.length, 3); assert.ok(Object.isFrozen(b[0].candidate.numbers));
  assert.equal(s._entries, undefined); // armazenamento interno privado (#entries)
});

test('add() revalida a entrada (motivo obrigatório, estágio válido) e deepFreeze trata ciclos de congelados', () => {
  const s = new QuarantineStore();
  assert.throws(() => s.add({ ...base(), reasons: [] }));
  assert.throws(() => s.add({ ...base(), stage: 'x' }));
  assert.throws(() => s.add(null));
  const f = deepFreeze({ a: [{ b: 1 }] }); assert.ok(Object.isFrozen(f.a[0]));
  const c = { x: { y: [] } }; c.x.self = c; deepFreeze(c); assert.ok(Object.isFrozen(c.x.y));
  const inner = Object.freeze({ arr: [1] }); deepFreeze({ inner }); assert.ok(Object.isFrozen(inner.arr));
});
