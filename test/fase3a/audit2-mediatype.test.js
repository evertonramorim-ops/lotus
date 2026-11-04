// Revisão complementar item 2: mesma regra de mediaType na criação e na verificação.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRawEnvelope, verifyRawEnvelopeDetailed, computeEnvelopeSha256, isValidMediaType, normalizeRaw } from '../../src/data/index.js';
import { SYNTH_PROVENANCE, env } from './_helpers.js';

const RAW = '{"lottery":"quina","contest":1,"drawDate":"2003-03-03","numbers":[1,2,3,4,5]}';
const VALID = ['application/json', 'text/plain', 'application/octet-stream', 'application/vnd.lotus+json', 'text/csv'];
const INVALID = ['', ' ', 'json', 'application/', '/json', 'Application/JSON', 'text/plain; charset=utf-8', 'a/b/c', 'text /plain', 'text/pl ain', 'x'.repeat(64) + '/json', 5, null, ['text/plain'], 'texto/ç'];

test('mediaType válidos: aceitos na criação e na verificação', () => {
  for (const m of VALID) {
    assert.ok(isValidMediaType(m));
    const e = createRawEnvelope(RAW, { mediaType: m, provenance: SYNTH_PROVENANCE });
    assert.deepEqual(verifyRawEnvelopeDetailed(e), { ok: true, errors: [] });
  }
});

for (const m of INVALID) {
  test(`mediaType inválido ${JSON.stringify(m)}: criação falha; adulteração com envelopeSha256 recalculado é rejeitada estruturalmente`, () => {
    assert.equal(isValidMediaType(m), false);
    assert.throws(() => createRawEnvelope(RAW, { mediaType: m, provenance: SYNTH_PROVENANCE }), TypeError);
    const t = structuredClone(env(RAW)); t.mediaType = m; t.envelopeSha256 = computeEnvelopeSha256(t);
    const r = verifyRawEnvelopeDetailed(t);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors.map(e => e.code), ['RAW_MEDIA_TYPE'], 'hash correto, estrutura inválida');
    const n = normalizeRaw(t);
    assert.equal(n.status, 'quarantined'); assert.ok(n.quarantine.reasons.some(x => x.code === 'RAW_MEDIA_TYPE'));
  });
}
