import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRawEnvelope, rawBytes, rawText, verifyRawEnvelope, normalizeRaw, processBatch, QuarantineStore, createQuarantineEntry, applyCorrection, replayCorrections, PARSER_VERSION, LOTTERY_IDS } from '../../src/data/index.js';
import { hashJson, sha256Hex } from '../../src/integrity/hash.js';
import { SYNTH_PROVENANCE, env, loadValid, loadInvalid, fixtureFiles, readJson, FIXTURES } from './_helpers.js';
import { join } from 'node:path';

test('fixtures: todas rotuladas SYNTHETIC_DATA no nome e no conteúdo, sem alegar origem CAIXA', () => {
  const files = fixtureFiles();
  assert.ok(files.length >= 5);
  for (const f of files) {
    assert.ok(f.startsWith('SYNTHETIC_DATA_'), f);
    const j = readJson(join(FIXTURES, f));
    assert.equal(j.label, 'SYNTHETIC_DATA'); assert.match(j.notice, /NÃO vieram da CAIXA/);
  }
});

test('bruto: bytes originais preservados exatamente (inclui espaços, BOM-free UTF-8 e acentos)', () => {
  const raw = ' { "lottery" : "quina" ,\n "x":"ção" } ';
  const e = createRawEnvelope(raw, { provenance: SYNTH_PROVENANCE });
  assert.equal(rawText(e), raw);
  assert.equal(e.sha256, sha256Hex(raw)); assert.equal(e.byteLength, new TextEncoder().encode(raw).length);
  const bytes = new Uint8Array([0, 255, 128, 10]);
  const eb = createRawEnvelope(bytes, { mediaType: 'application/octet-stream', provenance: SYNTH_PROVENANCE });
  assert.deepEqual(rawBytes(eb), bytes); assert.ok(verifyRawEnvelope(eb)); assert.ok(Object.isFrozen(eb));
  assert.throws(() => createRawEnvelope(raw, { provenance: { sourceType: 'CAIXA' } }));
});

test('bruto: adulteração do envelope é detectada e vai para quarentena', () => {
  const e = env('{"a":1}');
  const t = { ...e, contentBase64: btoa('{"a":2}') };
  assert.equal(verifyRawEnvelope(t), false);
  const r = normalizeRaw(t);
  assert.equal(r.status, 'quarantined'); assert.equal(r.quarantine.reasons[0].code, 'RAW_INTEGRITY');
});

test('normalização: fixtures válidas das 4 modalidades aceitas; bruto intacto; ordenação e datas', () => {
  for (const id of LOTTERY_IDS) {
    for (const raw of loadValid(id).rawInputs) {
      const e = env(raw); const before = e.contentBase64;
      const r = normalizeRaw(e);
      assert.equal(r.status, 'accepted', raw);
      assert.equal(r.record.lottery, id); assert.equal(r.parserVersion, PARSER_VERSION);
      assert.equal(r.rawSha256, e.sha256); assert.equal(r.recordSha256, hashJson(r.record));
      assert.deepEqual(r.record.numbers, [...r.record.numbers].sort((a, b) => a - b));
      assert.match(r.record.drawDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(e.contentBase64, before); assert.equal(rawText(e), raw);
    }
  }
  const r = normalizeRaw(env('{"lottery":"megasena","contest":"2","drawDate":"09/01/2001","numbers":["60","05","01","02","03","04"]}'));
  assert.deepEqual(r.record.numbers, [1, 2, 3, 4, 5, 60]); assert.equal(r.record.drawDate, '2001-01-09'); assert.equal(r.record.contest, 2);
});

test('normalização determinística: mesma entrada → mesmo registro e mesmo hash (repetida e com chaves reordenadas)', () => {
  const a = normalizeRaw(env('{"lottery":"quina","contest":1,"drawDate":"2003-03-03","numbers":[80,1,40,41,79]}'));
  const b = normalizeRaw(env('{"numbers":["01","40","41","79","80"],"drawDate":"03/03/2003","contest":"1","lottery":"quina"}'));
  for (let i = 0; i < 5; i++) assert.equal(normalizeRaw(env('{"lottery":"quina","contest":1,"drawDate":"2003-03-03","numbers":[80,1,40,41,79]}')).recordSha256, a.recordSha256);
  assert.equal(a.recordSha256, b.recordSha256);
  assert.notEqual(a.rawSha256, b.rawSha256); // brutos diferentes continuam distinguíveis
});

test('quarentena: cada caso inválido tem motivo explícito com o código esperado', () => {
  for (const { expectedCode, raw } of loadInvalid().cases) {
    const r = normalizeRaw(env(raw));
    assert.equal(r.status, 'quarantined', raw);
    assert.ok(r.quarantine.reasons.some(x => x.code === expectedCode), `${expectedCode} em ${JSON.stringify(r.quarantine.reasons)}`);
    assert.ok(r.quarantine.reasons.every(x => x.message.length > 0));
    assert.equal(r.quarantine.rawSha256, sha256Hex(raw));
  }
});

test('lote: nada é descartado (aceitos + quarentena = entrada), duplicatas vão para quarentena', () => {
  const valid = LOTTERY_IDS.flatMap(id => loadValid(id).rawInputs);
  const invalid = loadInvalid().cases.map(c => c.raw);
  const dupConflict = '{"lottery":"megasena","contest":1,"drawDate":"2001-01-06","numbers":[1,2,3,4,5,6]}';
  const all = [...valid, ...invalid, valid[0], dupConflict].map(env);
  const store = new QuarantineStore();
  const out = processBatch(all, store);
  assert.equal(out.accepted.length + out.quarantined.length, all.length);
  assert.equal(out.accepted.length, valid.length);
  assert.equal(store.size, invalid.length + 2);
  assert.equal(store.byCode('DUPLICATE_CONTEST_IDENTICAL').length, 1);
  assert.equal(store.byCode('DUPLICATE_CONTEST_CONFLICT').length, 1);
  assert.deepEqual(out.gaps, { megasena: [{ from: 3, to: 4 }] });
});

test('quarentena: entradas imutáveis e exigem motivo', () => {
  assert.throws(() => createQuarantineEntry({ rawSha256: 'x', stage: 'validate', reasons: [], parserVersion: '1' }));
  assert.throws(() => createQuarantineEntry({ rawSha256: 'x', stage: 'outro', reasons: [{ code: 'A', message: 'b' }], parserVersion: '1' }));
  const s = new QuarantineStore(); assert.throws(() => s.add({ reasons: [] }));
});

test('correção: registra valor anterior, novo, fonte, data, motivo, autor e hashes encadeados', () => {
  const rec = normalizeRaw(env('{"lottery":"quina","contest":1,"drawDate":"2003-03-03","numbers":[1,2,3,4,5]}')).record;
  const { record: r2, correction: c1 } = applyCorrection(rec, { field: 'numbers', newValue: [1, 2, 3, 4, 6], source: 'SYNTHETIC_DATA errata', date: '2026-01-02T00:00:00Z', reason: 'teste', actor: 'teste-automatizado' });
  assert.deepEqual(c1.previousValue, [1, 2, 3, 4, 5]); assert.deepEqual(r2.numbers, [1, 2, 3, 4, 6]);
  assert.deepEqual(rec.numbers, [1, 2, 3, 4, 5]); // entrada não mutada
  const { record: r3, correction: c2 } = applyCorrection(r2, { field: 'drawDate', newValue: '2003-03-04', source: 's', date: '2026-01-03T00:00:00Z', reason: 'r', actor: 'a' });
  assert.deepEqual(replayCorrections(rec, [c1, c2]), r3);
  assert.throws(() => replayCorrections(rec, [c2]));
  assert.throws(() => applyCorrection(rec, { field: 'numbers', newValue: [1, 2, 3, 4, 99], source: 's', date: '2026-01-02T00:00:00Z', reason: 'r', actor: 'a' }));
  assert.throws(() => applyCorrection(rec, { field: 'numbers', newValue: [1, 2, 3, 4, 5], source: 's', date: '2026-01-02T00:00:00Z', reason: 'r', actor: 'a' }));
  assert.throws(() => applyCorrection(rec, { field: 'lottery', newValue: 'megasena', source: 's', date: '2026-01-02T00:00:00Z', reason: 'r', actor: 'a' }));
  assert.throws(() => applyCorrection(rec, { field: 'numbers', newValue: [1, 2, 3, 4, 6], source: 's', date: '2026-01-02T00:00:00Z', reason: 'r', actor: '' }));
});
