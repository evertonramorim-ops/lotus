// SYNTHETIC_DATA — auditoria: vínculo cruzado envelope lotus.raw × lotus.collection (re-hash do registro adulterado).
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureRaw, importXlsx } from '../../src/historical/importer.js';
import { validateCollectionEnvelopeLink, validateCollectionRecord, computeCollectionSha256 } from '../../src/historical/collection.js';
import { syntheticWorkbook, SYNTH_META } from './_xlsx-writer.js';
import { Q } from '../../src/historical/codes.js';

const L = 'quina';
const pair = () => captureRaw(syntheticWorkbook(L, { seed: 9, count: 5 }), { ...SYNTH_META(L, 'link'), lottery: L });
/** Adultera um campo e RECALCULA collectionSha256 corretamente (o registro adulterado é internamente válido). */
const tamper = (c, patch) => { const t = { ...c, ...patch }; if (patch.url) t.host = new URL(patch.url).host; t.collectionSha256 = computeCollectionSha256(t); return t; };

test('par válido: vínculo íntegro e importação aceita', () => {
  const { envelope, collection } = pair();
  assert.deepEqual(validateCollectionEnvelopeLink(collection, envelope, L), { valid: true, errors: [] });
  const r = importXlsx({ envelope, collection, lottery: L });
  assert.equal(r.status, 'IMPORTED'); assert.equal(r.accepted.length, 5);
});

const TAMPERS = [
  ['URL', { url: 'https://synthetic.invalid/SYNTHETIC_DATA/outra.xlsx' }, 'LINK_URL'],
  ['horário de coleta', { collectedAt: '2026-01-02T00:00:00Z' }, 'LINK_COLLECTED_AT'],
  ['tipo de origem', { sourceType: 'EXTERNAL_UNVERIFIED' }, 'LINK_SOURCE_TYPE'],
  ['tamanho em bytes', { byteLength: 12345 }, 'LINK_BYTE_LENGTH'],
  ['modalidade', { lottery: 'megasena' }, 'LINK_LOTTERY'],
];
for (const [label, patch, code] of TAMPERS) {
  test(`adulteração de ${label} com collectionSha256 recalculado → INTEGRIDADE_ORIGEM, nenhum aceito`, () => {
    const { envelope, collection } = pair();
    const bad = tamper(collection, patch);
    assert.equal(validateCollectionRecord(bad).valid, true, 'hash interno do registro adulterado é válido');
    const link = validateCollectionEnvelopeLink(bad, envelope, L);
    assert.equal(link.valid, false); assert.ok(link.errors.includes(code), link.errors.join());
    const r = importXlsx({ envelope, collection: bad, lottery: L });
    assert.equal(r.status, 'REJECTED'); assert.equal(r.accepted.length, 0);
    const reason = r.quarantine[0].reasons[0];
    assert.equal(reason.code, Q.INTEGRIDADE_ORIGEM); assert.ok(reason.evidence.linkErrors.includes(code));
  });
}

test('modalidade passada ao importador diferente da coleta → rejeitado', () => {
  const { envelope, collection } = pair();
  assert.ok(validateCollectionEnvelopeLink(collection, envelope, 'megasena').errors.includes('LINK_LOTTERY'));
  assert.equal(importXlsx({ envelope, collection, lottery: 'megasena' }).accepted.length, 0);
});

test('sha256 / envelopeSha256 trocados (re-hash) → detectado', () => {
  const { envelope, collection } = pair(); const other = captureRaw(syntheticWorkbook(L, { seed: 10, count: 5 }), { ...SYNTH_META(L, 'link'), lottery: L });
  const bad = tamper(collection, { sha256: other.envelope.sha256, envelopeSha256: other.envelope.envelopeSha256 });
  const e = validateCollectionEnvelopeLink(bad, envelope, L).errors;
  assert.ok(e.includes('LINK_SHA256') && e.includes('LINK_ENVELOPE_SHA256'));
  assert.equal(importXlsx({ envelope, collection: bad, lottery: L }).accepted.length, 0);
});
