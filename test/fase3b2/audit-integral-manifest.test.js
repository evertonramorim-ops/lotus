// SYNTHETIC_DATA — auditoria integral, bloco 5: verifyModalityManifest verifica CONTEÚDO real (11 negativos + positivos).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../../src/historical/pipeline.js';
import { rawBytes } from '../../src/data/raw.js';
import { ManifestLedger, verifyModalityManifest } from '../../src/historical/manifests.js';
import { computeRootHash } from '../../src/integrity/manifest.js';
import { syntheticWorkbook, SYNTH_META } from './_xlsx-writer.js';

const L4 = ['megasena', 'lotofacil', 'quina', 'lotomania'];
const inputs = (seed = 5, over = {}) => L4.map(l => ({ lottery: l, bytes: syntheticWorkbook(l, { seed: over[l] ?? seed }), meta: SYNTH_META(l) }));
const T = '2026-01-01T00:00:00Z';
const run = () => runPipeline({ inputs: inputs(), runId: 'r1', createdAt: T });
const pick = (r, l) => ({ m: r.run.modality.find(x => x.lottery === l).manifest, res: r.results.find(x => x.lottery === l) });
const reroot = m => { const c = structuredClone(m); c.rootHash = computeRootHash(c); return c; };
const V = (m, res, o = {}) => verifyModalityManifest(m, o.imp ?? res.imp, res.collection, o.bytes === undefined ? rawBytes(res.envelope) : o.bytes, o.opt);
const has = (v, code, idRe) => v.errors.some(e => e.code === code && (!idRe || idRe.test(e.id ?? '')));

test('positivo: as 4 modalidades verificam contra o conteúdo real (bytes, coleta, relatório, quarentena, duplicatas, registros)', () => {
  const r = run();
  for (const l of L4) { const { m, res } = pick(r, l); const v = V(m, res); assert.ok(v.ok, `${l} ${JSON.stringify(v.errors)}`); assert.equal(v.checked.fileBytes, true); assert.equal(v.checked.acceptedRecords, res.imp.accepted.length); assert.equal(v.checked.chain, 'PRIMEIRO_MANIFESTO'); }
});

test('negativo 1: bytes do XLSX alterados', () => {
  const { m, res } = pick(run(), 'quina'); const b = new Uint8Array(rawBytes(res.envelope)); b[b.length - 1] ^= 0xff;
  const v = V(m, res, { bytes: b }); assert.equal(v.ok, false); assert.ok(has(v, 'ENTRY_HASH_MISMATCH', /^file:/)); assert.ok(has(v, 'FILE_BYTES_MISMATCH_COLLECTION'));
  assert.ok(has(V(m, res, { bytes: null }), 'FILE_BYTES_NOT_PROVIDED'));
});

test('negativo 2: registro aceito alterado (hash recalculado do conteúdo, não o declarado)', () => {
  const { m, res } = pick(run(), 'megasena');
  const imp = { ...res.imp, accepted: res.imp.accepted.map((a, i) => (i === 1 ? { ...a, record: { ...a.record, drawDate: '1999-12-31' } } : a)) };
  const v = V(m, res, { imp }); assert.equal(v.ok, false); assert.ok(has(v, 'ENTRY_HASH_MISMATCH', /^record:draw:megasena:000002$/));
  // mesmo com o recordSha256 "corrigido" pelo adulterador, o conteúdo recalculado não bate com o manifesto
  const imp2 = { ...imp, accepted: imp.accepted.map(({ recordSha256, ...a }) => (void recordSha256, a)) };
  assert.ok(has(V(m, res, { imp: imp2 }), 'ENTRY_HASH_MISMATCH', /^record:draw:/));
});

test('negativo 3: hash declarado no manifesto adulterado (com e sem rootHash recalculado)', () => {
  const { m, res } = pick(run(), 'lotofacil'); const t = structuredClone(m); const e = t.entries.find(x => x.id.startsWith('record:draw:')); e.sha256 = '0'.repeat(64);
  const v = V(t, res); assert.ok(has(v, 'ROOT_HASH_MISMATCH')); assert.ok(has(v, 'ENTRY_HASH_MISMATCH', /^record:draw:/));
  const v2 = V(reroot(t), res); assert.equal(v2.ok, false); assert.ok(!has(v2, 'ROOT_HASH_MISMATCH')); assert.ok(has(v2, 'ENTRY_HASH_MISMATCH', /^record:draw:/));
});

test('negativo 4: kind de entrada trocado com rootHash recalculado', () => {
  const { m, res } = pick(run(), 'lotomania'); const t = structuredClone(m); t.entries.find(x => x.id === 'record:collection').kind = 'file';
  const v = V(reroot(t), res); assert.equal(v.ok, false); assert.ok(has(v, 'ENTRY_KIND_MISMATCH', /^record:collection$/));
});

test('negativo 5: datasetId trocado', () => {
  const { m, res } = pick(run(), 'quina'); const t = reroot({ ...structuredClone(m), datasetId: 'lotus.historical.xlsx.megasena' });
  const v = V(t, res); assert.equal(v.ok, false); assert.ok(has(v, 'DATASET_ID_MISMATCH'));
});

test('negativo 6: dataSchemaVersion trocado', () => {
  const { m, res } = pick(run(), 'quina'); const t = reroot({ ...structuredClone(m), dataSchemaVersion: 'lotus.historical-draw/9.9.9' });
  const v = V(t, res); assert.equal(v.ok, false); assert.ok(has(v, 'DATA_SCHEMA_VERSION_MISMATCH'));
});

test('negativo 7: entrada faltante no manifesto (conteúdo existe, manifesto não lista)', () => {
  const { m, res } = pick(run(), 'megasena'); const t = structuredClone(m); const id = t.entries.find(x => x.id.startsWith('record:draw:')).id; t.entries = t.entries.filter(x => x.id !== id);
  const v = V(reroot(t), res); assert.equal(v.ok, false); assert.ok(has(v, 'ENTRY_UNLISTED', new RegExp(`^${id}$`)));
});

test('negativo 8: entrada extra no manifesto (sem conteúdo correspondente)', () => {
  const { m, res } = pick(run(), 'megasena'); const t = structuredClone(m); t.entries.push({ id: 'record:draw:megasena:999999', kind: 'record', sha256: 'a'.repeat(64) }); t.entries.sort((a, b) => (a.id < b.id ? -1 : 1));
  const v = V(reroot(t), res); assert.equal(v.ok, false); assert.ok(has(v, 'ENTRY_MISSING', /^record:draw:megasena:999999$/));
});

test('negativo 9: encadeamento errado (anterior errado, rootHash esperado errado, sem referência, anterior de outra sequência)', () => {
  const ledger = new ManifestLedger();
  const a = runPipeline({ inputs: inputs(), ledger, runId: 'a', createdAt: T });
  const b = runPipeline({ inputs: inputs(5, { quina: 77 }), ledger, runId: 'b', createdAt: '2026-02-01T00:00:00Z' });
  const prev = pick(a, 'quina').m; const { m, res } = pick(b, 'quina'); assert.equal(m.sequence, 2);
  assert.ok(V(m, res, { opt: { previous: prev } }).ok, 'anterior correto'); assert.equal(V(m, res, { opt: { previous: prev } }).checked.chain, 'VERIFICADO_CONTRA_ANTERIOR');
  assert.ok(V(m, res, { opt: { expectedPreviousRootHash: prev.rootHash } }).ok, 'rootHash esperado correto');
  assert.ok(has(V(m, res, { opt: { previous: pick(a, 'megasena').m } }), 'CHAIN_PREVIOUS_MISMATCH'));
  assert.ok(has(V(m, res, { opt: { previous: pick(a, 'megasena').m } }), 'CHAIN_PREVIOUS_DATASET_MISMATCH'));
  assert.ok(has(V(m, res, { opt: { expectedPreviousRootHash: 'b'.repeat(64) } }), 'CHAIN_PREVIOUS_MISMATCH'));
  assert.ok(has(V(m, res), 'CHAIN_NOT_VERIFIABLE'), 'sem referência não passa');
  const t = structuredClone(m); t.entries.find(x => x.id === 'chain:previous').sha256 = 'c'.repeat(64);
  assert.ok(has(V(reroot(t), res, { opt: { previous: prev } }), 'CHAIN_PREVIOUS_MISMATCH'));
  const t2 = structuredClone(m); t2.entries = t2.entries.filter(x => x.id !== 'chain:previous');
  assert.ok(has(V(reroot(t2), res, { opt: { previous: prev } }), 'CHAIN_MISSING'));
  assert.ok(has(V(m, res, { opt: { previous: prev, expectedSequence: 3 } }), 'SEQUENCE_MISMATCH'));
});

test('negativo 10: quarentena alterada', () => {
  const { m, res } = pick(run(), 'quina'); const imp = { ...res.imp, quarantine: [...res.imp.quarantine, { synthetic: 'entrada inserida' }] };
  const v = V(m, res, { imp }); assert.equal(v.ok, false); assert.ok(has(v, 'ENTRY_HASH_MISMATCH', /^record:quarantine$/));
  const imp2 = { ...res.imp, duplicatesIdentical: [{ contest: 1 }] }; assert.ok(has(V(m, res, { imp: imp2 }), 'ENTRY_HASH_MISMATCH', /^record:duplicates-identical$/));
});

test('negativo 11: relatório de importação alterado', () => {
  const { m, res } = pick(run(), 'lotofacil'); const imp = { ...res.imp, report: { ...res.imp.report, counts: { ...res.imp.report.counts, accepted: res.imp.report.counts.accepted + 1 } } };
  const v = V(m, res, { imp }); assert.equal(v.ok, false); assert.ok(has(v, 'ENTRY_HASH_MISMATCH', /^record:import-report$/));
  const col = { ...res.collection, httpStatus: 201 }; const vc = verifyModalityManifest(m, res.imp, col, rawBytes(res.envelope)); assert.ok(has(vc, 'ENTRY_HASH_MISMATCH', /^record:collection$/));
});
