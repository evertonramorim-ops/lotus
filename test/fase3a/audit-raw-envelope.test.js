// Auditoria item 2: integridade do envelope bruto COMPLETO (metadados + proveniência + conteúdo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRawEnvelope, verifyRawEnvelopeDetailed, computeEnvelopeSha256, normalizeRaw, processBatch, QuarantineStore } from '../../src/data/index.js';
import { hashJson } from '../../src/integrity/hash.js';
import { env } from './_helpers.js';

const RAW = '{"lottery":"quina","contest":1,"drawDate":"2003-03-03","numbers":[1,2,3,4,5]}';
const TAMPER = {
  sourceType: e => { e.provenance.sourceType = 'MANUAL_ENTRY'; },
  sourceId: e => { e.provenance.sourceId = 'fonte-falsa'; },
  obtainedAt: e => { e.provenance.obtainedAt = '2026-06-01T00:00:00Z'; },
  note: e => { e.provenance.note = 'alterado'; },
  mediaType: e => { e.mediaType = 'text/plain'; },
  schemaVersion: e => { e.schemaVersion = '1.0.1'; },
  contentBase64: e => { e.contentBase64 = btoa(RAW.replace('"contest":1', '"contest":2')); },
  byteLength: e => { e.byteLength += 1; },
  sha256: e => { e.sha256 = 'f'.repeat(64); },
  envelopeSha256: e => { e.envelopeSha256 = 'f'.repeat(64); },
  schema: e => { e.schema = 'outro'; },
  campoExtra: e => { e.extra = 1; },
};

test('envelope íntegro: verificação completa OK e envelopeSha256 = SHA-256(JCS(envelope sem o campo))', () => {
  const e = env(RAW);
  assert.deepEqual(verifyRawEnvelopeDetailed(e), { ok: true, errors: [] });
  const { envelopeSha256, ...body } = e;
  assert.equal(envelopeSha256, hashJson(body)); assert.equal(computeEnvelopeSha256(e), envelopeSha256);
  assert.ok(Object.isFrozen(e.provenance));
  assert.equal(normalizeRaw(e).status, 'accepted');
});

for (const [name, mut] of Object.entries(TAMPER)) {
  test(`adulteração isolada de ${name} → falha de verificação e quarentena`, () => {
    const e = structuredClone(env(RAW)); mut(e);
    assert.equal(verifyRawEnvelope(e), false);
    const r = normalizeRaw(e);
    assert.equal(r.status, 'quarantined');
    assert.equal(r.quarantine.reasons[0].code, 'RAW_INTEGRITY');
    assert.ok(r.quarantine.reasons.length >= 2, 'motivos detalhados presentes');
  });
}

test('adulteração de metadados com hash de BYTES intacto ainda é detectada (envelopeSha256)', () => {
  const e = structuredClone(env(RAW)); e.provenance.sourceId = 'outra';
  const codes = verifyRawEnvelopeDetailed(e).errors.map(x => x.code);
  assert.deepEqual(codes, ['RAW_ENVELOPE_HASH_MISMATCH']);
});

test('limite documentado: quem recalcula TODOS os hashes passa na verificação local (sem assinatura não há autenticação de origem)', () => {
  const e = structuredClone(env(RAW)); e.provenance.sourceId = 'reescrito';
  e.envelopeSha256 = computeEnvelopeSha256(e);
  assert.equal(verifyRawEnvelope(e), true);
});

test('envelopes malformados não lançam e vão para quarentena; lote nunca perde registros', () => {
  const bads = [null, 1, 'x', {}, { ...env(RAW), contentBase64: '%%%' }, { ...env(RAW), provenance: null }];
  for (const b of bads) { assert.doesNotThrow(() => verifyRawEnvelopeDetailed(b)); assert.equal(normalizeRaw(b).status, 'quarantined'); }
  const s = new QuarantineStore(); const out = processBatch([env(RAW), ...bads], s);
  assert.equal(out.accepted.length, 1); assert.equal(s.size, bads.length);
});
