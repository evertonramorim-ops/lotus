// SYNTHETIC_DATA — camada A (preservação de bytes), manifestos encadeados, idempotência e ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runPipeline } from '../../src/historical/pipeline.js';
import { captureRaw } from '../../src/historical/importer.js';
import { rawBytes, verifyRawEnvelope } from '../../src/data/raw.js';
import { validateCollectionRecord, XLSX_MEDIA_TYPE } from '../../src/historical/collection.js';
import { ManifestLedger, verifyModalityManifest, modalityDatasetId, RUN_DATASET_ID } from '../../src/historical/manifests.js';
import { FileLedger, writeOnce } from '../../src/historical/store.js';
import { verifyManifest } from '../../src/integrity/manifest.js';
import { syntheticWorkbook, SYNTH_META } from './_xlsx-writer.js';
import { fixtureCatalog } from './_fixtures.js';

const L4 = ['megasena', 'lotofacil', 'quina', 'lotomania'];
const inputs = (seed = 5) => L4.map(l => ({ lottery: l, bytes: syntheticWorkbook(l, { seed }), meta: SYNTH_META(l) }));
const T = '2026-01-01T00:00:00Z';

test('camada A: bytes originais preservados exatamente + sha256 + coleta ligada ao envelope', () => {
  for (const [n, b] of Object.entries(fixtureCatalog())) {
    const { envelope, collection } = captureRaw(b, { ...SYNTH_META('megasena', n), lottery: 'megasena' });
    assert.deepEqual(rawBytes(envelope), b, n);
    assert.equal(envelope.sha256, createHash('sha256').update(b).digest('hex'));
    assert.equal(envelope.mediaType, XLSX_MEDIA_TYPE); assert.ok(verifyRawEnvelope(envelope));
    assert.equal(collection.envelopeSha256, envelope.envelopeSha256); assert.ok(validateCollectionRecord(collection).valid);
    assert.equal(envelope.provenance.sourceType, 'SYNTHETIC_DATA');
  }
});

test('registro de coleta adulterado é detectado', () => {
  const { collection } = captureRaw(fixtureCatalog().valid_quina, { ...SYNTH_META('quina'), lottery: 'quina' });
  const t = { ...collection, httpStatus: 201 };
  assert.ok(validateCollectionRecord(t).errors.includes('COLLECTION_HASH_MISMATCH'));
  assert.ok(validateCollectionRecord({ ...collection, extra: 1 }).errors.some(e => e.startsWith('UNKNOWN_FIELD')));
});

test('manifestos por modalidade e por execução: válidos, contagens, hash raiz', () => {
  const r = runPipeline({ inputs: inputs(), runId: 'r1', createdAt: T });
  assert.equal(r.run.modality.length, 4);
  for (const m of r.run.modality) { assert.equal(m.datasetId, modalityDatasetId(m.lottery)); assert.equal(m.sequence, 1); assert.ok(verifyManifest(m.manifest).ok); }
  assert.equal(r.run.runManifest.datasetId, RUN_DATASET_ID); assert.ok(verifyManifest(r.run.runManifest).ok);
  const m0 = r.run.modality[0].manifest; const res = r.results[0];
  assert.ok(m0.entries.some(e => e.kind === 'file' && e.sha256 === res.collection.sha256));
  assert.equal(m0.entries.filter(e => e.id.startsWith('record:draw:')).length, res.imp.report.counts.accepted);
  // [3b.2-integral 5.2 — teste antigo incorreto] `res.bytes` não existe nos resultados do pipeline (era undefined) e a
  // verificação antiga nem olhava os bytes; agora os bytes reais do envelope são exigidos e conferidos.
  const v0 = verifyModalityManifest(m0, res.imp, res.collection, rawBytes(res.envelope)); assert.ok(v0.ok, JSON.stringify(v0.errors)); assert.equal(v0.checked.fileBytes, true);
  assert.equal(verifyModalityManifest(m0, res.imp, res.collection, null).ok, false, 'sem bytes não passa');
});

test('adulteração de registro aceito invalida o manifesto', () => {
  const r = runPipeline({ inputs: inputs(), runId: 'r1', createdAt: T });
  const res = r.results[1]; const m = r.run.modality[1].manifest;
  // [3b.2-integral 5.1/5.2 — teste antigo incorreto] adulterar só o hash DECLARADO (recordSha256) não altera o conteúdo:
  // a verificação antiga comparava hashes declarados entre si. Agora: declarado adulterado → DECLARED_RECORD_HASH_MISMATCH;
  // conteúdo adulterado (hash recalculado do registro) → ENTRY_HASH_MISMATCH.
  const bytes = rawBytes(res.envelope);
  const tampered = { ...res.imp, accepted: res.imp.accepted.map((a, i) => (i === 0 ? { ...a, recordSha256: 'f'.repeat(64) } : a)) };
  const v = verifyModalityManifest(m, tampered, res.collection, bytes);
  assert.equal(v.ok, false); assert.ok(v.errors.some(e => e.code === 'DECLARED_RECORD_HASH_MISMATCH'));
  const content = { ...res.imp, accepted: res.imp.accepted.map((a, i) => (i === 0 ? { ...a, record: { ...a.record, numbers: [...a.record.numbers].reverse() } } : a)) };
  const vc = verifyModalityManifest(m, content, res.collection, bytes);
  assert.equal(vc.ok, false); assert.ok(vc.errors.some(e => e.code === 'ENTRY_HASH_MISMATCH' && e.id.startsWith('record:draw:')));
  const m2 = structuredClone(m); m2.entries[0].sha256 = '0'.repeat(64);
  assert.equal(verifyManifest(m2).ok, false);
});

test('idempotência: mesma entrada não gera manifesto novo; mudança gera sequence+1 encadeada; nunca sobrescreve', () => {
  const ledger = new ManifestLedger();
  const a = runPipeline({ inputs: inputs(), ledger, runId: 'r1', createdAt: T });
  const b = runPipeline({ inputs: inputs(), ledger, runId: 'r2', createdAt: '2026-02-01T00:00:00Z' });
  assert.ok(b.run.modality.every(m => m.action === 'UNCHANGED_REPLAY')); assert.equal(b.run.runAction, 'UNCHANGED_REPLAY');
  assert.equal(b.run.runRootHash, a.run.runRootHash);
  const changed = inputs(); changed[2] = { ...changed[2], bytes: syntheticWorkbook('quina', { seed: 99 }) };
  const c = runPipeline({ inputs: changed, ledger, runId: 'r3', createdAt: '2026-03-01T00:00:00Z' });
  const q = c.run.modality.find(m => m.lottery === 'quina');
  assert.equal(q.action, 'NEW'); assert.equal(q.sequence, 2);
  assert.equal(q.manifest.entries.find(e => e.id === 'chain:previous').sha256, a.run.modality.find(m => m.lottery === 'quina').rootHash);
  assert.ok(c.run.modality.filter(m => m.lottery !== 'quina').every(m => m.action === 'UNCHANGED_REPLAY'));
  assert.equal(c.run.runManifest.sequence, 2);
  assert.equal(ledger.submit(a.run.modality[2].manifest).accepted, false); // reapresentar antigo é recusado
});

test('reprodutibilidade em processo: duas execuções independentes → mesmo resultado lógico', () => {
  const x = runPipeline({ inputs: inputs(), runId: 'a', createdAt: T });
  const y = runPipeline({ inputs: inputs(), runId: 'b', createdAt: T });
  assert.equal(x.logicalSha256, y.logicalSha256); assert.equal(x.run.runRootHash, y.run.runRootHash);
});

test('ledger persistente (JSONL) revalida cadeia e writeOnce recusa sobrescrita', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lotus3b2-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    const l1 = new FileLedger(p); runPipeline({ inputs: inputs(), ledger: l1, runId: 'r1', createdAt: T });
    const l2 = new FileLedger(p); const r = runPipeline({ inputs: inputs(), ledger: l2, runId: 'r2', createdAt: T });
    assert.ok(r.run.modality.every(m => m.action === 'UNCHANGED_REPLAY'));
    assert.equal(readFileSync(p, 'utf8').trim().split('\n').length, 5);
    const lines = readFileSync(p, 'utf8').split('\n'); const m = JSON.parse(lines[0]); m.sequence = 7; lines[0] = JSON.stringify(m);
    writeFileSync(join(dir, 'bad.jsonl'), lines.join('\n'));
    assert.throws(() => new FileLedger(join(dir, 'bad.jsonl')), /ledger corrompido/);
    const f = join(dir, 'x.bin');
    assert.equal(writeOnce(f, 'abc'), 'WRITTEN'); assert.equal(writeOnce(f, 'abc'), 'EXISTING_IDENTICAL');
    assert.throws(() => writeOnce(f, 'abd'), /recusa de sobrescrita/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
