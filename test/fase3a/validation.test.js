import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESULT_VALIDATORS, validateResultRecord, validateResultDataset } from '../../src/validation/index.js';
import { validRecord, range } from './_helpers.js';

// Regras escritas LITERALMENTE aqui (independentes da config) — verificação cruzada.
const RULES = { megasena: [6, 1, 60], lotofacil: [15, 1, 25], quina: [5, 1, 80], lotomania: [20, 0, 99] };
const codes = r => r.errors.map(e => e.code);

for (const [id, [k, lo, hi]] of Object.entries(RULES)) {
  const v = RESULT_VALIDATORS[id];
  test(`${id}: válidos nos extremos (${k} distintos em ${lo}..${hi})`, () => {
    assert.deepEqual(v(validRecord(id, range(lo, lo + k - 1))), { valid: true, errors: [] });
    assert.deepEqual(v(validRecord(id, range(hi - k + 1, hi))), { valid: true, errors: [] });
  });
  test(`${id}: inválidos — contagem, intervalo, duplicata, tipo, não-inteiro, ordem, modalidade`, () => {
    assert.ok(codes(v(validRecord(id, range(lo, lo + k - 2)))).includes('COUNT_MISMATCH'));
    assert.ok(codes(v(validRecord(id, range(lo, lo + k)))).includes('COUNT_MISMATCH'));
    assert.ok(codes(v(validRecord(id, [...range(lo, lo + k - 2), hi + 1]))).includes('OUT_OF_RANGE'));
    assert.ok(codes(v(validRecord(id, [lo - 1, ...range(lo + 1, lo + k - 1)]))).includes('OUT_OF_RANGE'));
    assert.ok(codes(v(validRecord(id, [lo, ...range(lo, lo + k - 2)]))).includes('DUPLICATE_NUMBER'));
    assert.ok(codes(v(validRecord(id, [String(lo), ...range(lo + 1, lo + k - 1)]))).includes('WRONG_TYPE'));
    assert.ok(codes(v(validRecord(id, [lo + 0.5, ...range(lo + 1, lo + k - 1)]))).includes('NOT_INTEGER'));
    assert.ok(codes(v(validRecord(id, range(lo, lo + k - 1).reverse()))).includes('NOT_SORTED'));
    const other = id === 'quina' ? 'megasena' : 'quina';
    assert.ok(codes(v(validRecord(other, range(1, RULES[other][0])))).includes('LOTTERY_MISMATCH'));
  });
}

test('estrutura: campos ausentes, desconhecidos, tipos errados, esquema/versão, concurso, data', () => {
  const ok = validRecord('quina', [1, 2, 3, 4, 5]);
  for (const f of ['schema', 'schemaVersion', 'lottery', 'contest', 'drawDate', 'numbers', 'provenance']) {
    const r = { ...ok }; delete r[f];
    assert.ok(codes(validateResultRecord(r)).includes('MISSING_FIELD'), f);
  }
  assert.ok(codes(validateResultRecord({ ...ok, extra: 1 })).includes('UNKNOWN_FIELD'));
  assert.ok(codes(validateResultRecord({ ...ok, schema: 'x' })).includes('SCHEMA_MISMATCH'));
  assert.ok(codes(validateResultRecord({ ...ok, schemaVersion: '2.0.0' })).includes('SCHEMA_VERSION_UNSUPPORTED'));
  assert.ok(codes(validateResultRecord({ ...ok, lottery: 'timemania' })).includes('UNKNOWN_LOTTERY'));
  assert.ok(codes(validateResultRecord({ ...ok, lottery: 7 })).includes('WRONG_TYPE'));
  for (const c of [0, -1, 1.5, 2 ** 53]) assert.ok(codes(validateResultRecord({ ...ok, contest: c })).includes('CONTEST_INVALID'), String(c));
  assert.ok(codes(validateResultRecord({ ...ok, contest: '1' })).includes('WRONG_TYPE'));
  for (const d of ['2021-02-29', '2020-13-01', '01/01/2020', '2020-1-1', '', 20200101]) assert.ok(codes(validateResultRecord({ ...ok, drawDate: d })).includes('DATE_INVALID'), String(d));
  assert.ok(validateResultRecord({ ...ok, drawDate: '2020-02-29' }).valid);
  assert.ok(codes(validateResultRecord({ ...ok, numbers: 'x' })).includes('WRONG_TYPE'));
  assert.ok(codes(validateResultRecord(null)).includes('WRONG_TYPE'));
  assert.ok(codes(validateResultRecord([])).includes('WRONG_TYPE'));
});

test('proveniência: obrigatória, tipo de fonte restrito, data ISO UTC, sem campos extras', () => {
  const ok = validRecord('quina', [1, 2, 3, 4, 5]);
  const p = ok.provenance;
  assert.ok(codes(validateResultRecord({ ...ok, provenance: { ...p, sourceType: 'CAIXA' } })).includes('PROVENANCE_SOURCE_TYPE'));
  assert.ok(codes(validateResultRecord({ ...ok, provenance: { ...p, obtainedAt: '2026-01-01' } })).includes('PROVENANCE_DATE'));
  assert.ok(codes(validateResultRecord({ ...ok, provenance: { ...p, x: 1 } })).includes('UNKNOWN_FIELD'));
  assert.ok(codes(validateResultRecord({ ...ok, provenance: 'x' })).includes('WRONG_TYPE'));
});

test('conjunto: duplicata idêntica e conflitante, lacunas reportadas (não erro), ordem de datas', () => {
  const a = validRecord('megasena', [1, 2, 3, 4, 5, 6], { contest: 1, drawDate: '2020-01-01' });
  const b = validRecord('megasena', [1, 2, 3, 4, 5, 7], { contest: 4, drawDate: '2020-01-10' });
  const c = validRecord('megasena', [1, 2, 3, 4, 5, 8], { contest: 7, drawDate: '2020-01-05' });
  const q = validRecord('quina', [1, 2, 3, 4, 5], { contest: 1 });
  const ok = validateResultDataset([a, b, c, q]);
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.gaps, { megasena: [{ from: 2, to: 3 }, { from: 5, to: 6 }] });
  assert.deepEqual(ok.warnings, [{ code: 'DATE_ORDER', lottery: 'megasena', contest: 7 }]);
  const d = validateResultDataset([a, { ...a }, { ...a, numbers: [1, 2, 3, 4, 5, 9] }, { ...a, numbers: [0] }]);
  assert.deepEqual(d.errors.map(e => e.code), ['DUPLICATE_CONTEST_IDENTICAL', 'DUPLICATE_CONTEST_CONFLICT', 'INVALID_RECORD']);
  assert.throws(() => validateResultDataset('x'));
});
