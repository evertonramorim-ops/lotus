// Auditoria item 5: trilha de correções com validação completa e hash próprio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCorrection, replayCorrections, validateCorrection, computeCorrectionSha256, normalizeRaw } from '../../src/data/index.js';
import { hashJson } from '../../src/integrity/hash.js';
import { env } from './_helpers.js';

const rec = normalizeRaw(env('{"lottery":"quina","contest":1,"drawDate":"2003-03-03","numbers":[1,2,3,4,5]}')).record;
const mk = () => {
  const a = applyCorrection(rec, { field: 'numbers', newValue: [1, 2, 3, 4, 6], source: 'SYNTHETIC_DATA errata', date: '2026-01-02T00:00:00Z', reason: 'teste', actor: 'teste-automatizado' });
  const b = applyCorrection(a.record, { field: 'drawDate', newValue: '2003-03-04', source: 's', date: '2026-01-03T00:00:00Z', reason: 'r', actor: 'a' });
  return { c1: a.correction, c2: b.correction, final: b.record };
};
const TAMPER = {
  source: c => { c.source = 'outra fonte'; },
  date: c => { c.date = '2026-01-05T00:00:00Z'; },
  reason: c => { c.reason = 'outro motivo'; },
  actor: c => { c.actor = 'outra pessoa'; },
  field: c => { c.field = 'drawDate'; },
  previousValue: c => { c.previousValue = [1, 2, 3, 4, 7]; },
  newValue: c => { c.newValue = [1, 2, 3, 4, 8]; },
  targetSha256: c => { c.targetSha256 = 'a'.repeat(64); },
  resultSha256: c => { c.resultSha256 = 'b'.repeat(64); },
  correctionSha256: c => { c.correctionSha256 = 'c'.repeat(64); },
  lottery: c => { c.lottery = 'megasena'; },
  contest: c => { c.contest = 2; },
  schemaVersion: c => { c.schemaVersion = '2.0.0'; },
};

test('correção válida: hash próprio, validação e replay encadeado', () => {
  const { c1, c2, final } = mk();
  assert.deepEqual(validateCorrection(c1), { valid: true, errors: [] });
  const { correctionSha256, ...body } = c1; assert.equal(correctionSha256, hashJson(body)); assert.equal(computeCorrectionSha256(c1), correctionSha256);
  assert.equal(c2.targetSha256, c1.resultSha256);
  assert.deepEqual(replayCorrections(rec, [c1, c2]), final);
});

for (const [name, mut] of Object.entries(TAMPER)) {
  test(`adulteração de ${name}: validateCorrection falha e replay é recusado`, () => {
    const { c1, c2 } = mk(); const t = structuredClone(c1); mut(t);
    assert.equal(validateCorrection(t).valid, false);
    assert.throws(() => replayCorrections(rec, [t, c2]));
  });
  test(`adulteração de ${name} COM correctionSha256 recalculado: encadeamento/semântica ainda recusam ou hash denuncia`, () => {
    const { c1, c2 } = mk(); const t = structuredClone(c1); mut(t);
    if (name !== 'correctionSha256') t.correctionSha256 = computeCorrectionSha256(t);
    const metadataOnly = ['source', 'date', 'reason', 'actor'].includes(name);
    if (metadataOnly) {
      // Limite documentado: sem assinatura, metadados reescritos com hash recalculado passam. O hash
      // detecta alteração em relação ao registrado (o hash difere do original), não autentica autoria.
      assert.notEqual(t.correctionSha256, c1.correctionSha256);
      assert.doesNotThrow(() => replayCorrections(rec, [t]));
    } else {
      assert.throws(() => replayCorrections(rec, [t, c2]));
    }
  });
}

test('estrutura: campo não corrigível, textos vazios, data inválida, hash malformado, campo extra, tipos', () => {
  const { c1 } = mk();
  const re = m => { const t = structuredClone(c1); m(t); t.correctionSha256 = computeCorrectionSha256(t); return validateCorrection(t).errors.map(e => e.code); };
  assert.ok(re(t => { t.field = 'lottery'; }).includes('FIELD_NOT_CORRECTABLE'));
  assert.ok(re(t => { t.actor = '  '; }).includes('TEXT_INVALID'));
  assert.ok(re(t => { t.source = 5; }).includes('TEXT_INVALID'));
  assert.ok(re(t => { t.date = '2026-13-01T00:00:00Z'; }).includes('DATE_INVALID'));
  assert.ok(re(t => { t.targetSha256 = 'XYZ'; }).includes('HASH_FORMAT'));
  assert.ok(re(t => { t.extra = 1; }).includes('UNKNOWN_FIELD'));
  assert.ok(re(t => { t.schema = 'x'; }).includes('SCHEMA_MISMATCH'));
  assert.ok(re(t => { t.contest = 0; }).includes('CONTEST_INVALID'));
  assert.ok(re(t => { t.newValue = t.previousValue; }).includes('NO_CHANGE'));
  assert.ok(re(t => { delete t.reason; }).includes('MISSING_FIELD'));
  for (const bad of [null, 1, [], 'x']) assert.equal(validateCorrection(bad).valid, false);
  assert.ok(Object.isFrozen(c1));
});
