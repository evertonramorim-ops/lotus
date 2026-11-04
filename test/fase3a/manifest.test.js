import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, verifyManifest, checkSuccession, ManifestLedger, hashRecord, hashFile, computeRootHash } from '../../src/integrity/manifest.js';
import { validRecord } from './_helpers.js';

const r1 = validRecord('megasena', [1, 2, 3, 4, 5, 6]);
const r2 = validRecord('quina', [1, 2, 3, 4, 5], { contest: 2 });
const fileBytes = new TextEncoder().encode('SYNTHETIC_DATA arquivo');
const base = { datasetId: 'synthetic.test', dataSchemaVersion: 'lotus.result/1.0.0', createdAt: '2026-01-01T00:00:00Z' };
const mk = (sequence, recs = [r1, r2]) => buildManifest({ ...base, sequence, entries: [...recs.map((r, i) => ({ id: `rec-${i}`, sha256: hashRecord(r) })), { id: 'file-a', kind: 'file', sha256: hashFile(fileBytes) }] });
const contents = () => new Map([['rec-0', { kind: 'record', value: r1 }], ['rec-1', { kind: 'record', value: r2 }], ['file-a', { kind: 'file', bytes: fileBytes }]]);

test('manifesto: construção determinística, entradas ordenadas, rootHash verificável', () => {
  const a = mk(1); const b = mk(1);
  assert.deepEqual(a, b);
  assert.deepEqual(a.entries.map(e => e.id), ['file-a', 'rec-0', 'rec-1']);
  assert.equal(a.rootHash, computeRootHash(a));
  assert.deepEqual(verifyManifest(a, contents()), { ok: true, errors: [] });
});

test('manifesto: parâmetros inválidos são rejeitados (sem relógio oculto: createdAt obrigatório)', () => {
  assert.throws(() => buildManifest({ ...base, sequence: 0, entries: [{ id: 'x', sha256: hashFile('') }] }));
  assert.throws(() => buildManifest({ ...base, sequence: 1.5, entries: [{ id: 'x', sha256: hashFile('') }] }));
  assert.throws(() => buildManifest({ ...base, createdAt: undefined, sequence: 1, entries: [{ id: 'x', sha256: hashFile('') }] }));
  assert.throws(() => buildManifest({ ...base, createdAt: '2026-02-30T00:00:00Z', sequence: 1, entries: [{ id: 'x', sha256: hashFile('') }] }));
  assert.throws(() => buildManifest({ ...base, sequence: 1, entries: [{ id: 'x', sha256: 'zz' }] }));
  assert.throws(() => buildManifest({ ...base, sequence: 1, entries: [{ id: 'x', sha256: hashFile('') }, { id: 'x', sha256: hashFile('') }] }));
  assert.throws(() => buildManifest({ ...base, sequence: 1, entries: [] }));
});

test('adulteração: registro alterado, arquivo alterado, entrada ausente, extra, e manifesto alterado', () => {
  const m = mk(1);
  let c = contents(); c.set('rec-0', { kind: 'record', value: { ...r1, numbers: [1, 2, 3, 4, 5, 7] } });
  assert.deepEqual(verifyManifest(m, c).errors.map(e => e.code), ['ENTRY_HASH_MISMATCH']);
  c = contents(); c.set('file-a', { kind: 'file', bytes: new TextEncoder().encode('SYNTHETIC_DATA arquivX') });
  assert.deepEqual(verifyManifest(m, c).errors.map(e => e.code), ['ENTRY_HASH_MISMATCH']);
  c = contents(); c.delete('rec-1'); assert.deepEqual(verifyManifest(m, c).errors.map(e => e.code), ['ENTRY_MISSING']);
  c = contents(); c.set('intruso', { kind: 'record', value: {} }); assert.deepEqual(verifyManifest(m, c).errors.map(e => e.code), ['ENTRY_UNLISTED']);
  assert.ok(verifyManifest({ ...m, sequence: 2 }).errors.some(e => e.code === 'ROOT_HASH_MISMATCH'));
  const t = structuredClone(m); t.entries[1].sha256 = hashFile('x');
  assert.ok(verifyManifest(t).errors.some(e => e.code === 'ROOT_HASH_MISMATCH'));
  assert.ok(verifyManifest({ ...m, extra: 1 }).errors.some(e => e.code === 'MANIFEST_UNKNOWN_FIELD'));
  const u = structuredClone(m); u.entries.reverse(); u.rootHash = computeRootHash(u);
  assert.ok(verifyManifest(u).errors.some(e => e.code === 'MANIFEST_ENTRIES_NOT_SORTED_OR_DUPLICATE'));
});

test('sequência: avanço aceito; regressão, substituição e replay rejeitados', () => {
  const m1 = mk(1); const m2 = mk(2); const m2b = mk(2, [r1]);
  assert.equal(checkSuccession(undefined, m1).code, 'FIRST');
  assert.equal(checkSuccession(m1, m2).code, 'ADVANCE');
  assert.equal(checkSuccession(m2, m1).code, 'SEQUENCE_REGRESSION');
  assert.equal(checkSuccession(m2, m2b).code, 'SEQUENCE_SUBSTITUTION');
  assert.equal(checkSuccession(m2, m2).code, 'SEQUENCE_REPLAY_IDENTICAL');
  assert.equal(checkSuccession(m1, buildManifest({ ...base, datasetId: 'outro', sequence: 2, entries: m1.entries })).code, 'DATASET_MISMATCH');
});

test('ManifestLedger: histórico por dataset, rejeita inválido/regressão/substituição de sequência antiga', () => {
  const L = new ManifestLedger();
  assert.equal(L.submit(mk(1)).accepted, true);
  assert.equal(L.submit(mk(3)).code, 'ADVANCE');
  assert.equal(L.submit(mk(2)).code, 'SEQUENCE_REGRESSION');
  assert.equal(L.submit(mk(1, [r2])).code, 'SEQUENCE_SUBSTITUTION');
  assert.equal(L.submit(mk(3)).code, 'SEQUENCE_REPLAY_IDENTICAL');
  assert.equal(L.submit({ ...mk(4), rootHash: '0'.repeat(64) }).code, 'INVALID_MANIFEST');
  assert.equal(L.latest('synthetic.test').sequence, 3);
});
