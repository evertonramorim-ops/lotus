// Modelo econômico INTERNO, NÃO confirmado contra contrato oficial. Valores SYNTHETIC_DATA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEconomicRecord } from '../../src/validation/economic.js';
import { validateResultRecord } from '../../src/validation/result.js';
import { SYNTH_PROVENANCE } from './_helpers.js';

const ok = { schema: 'lotus.economic', schemaVersion: '1.0.0', modelStatus: 'UNCONFIRMED_INTERNAL_MODEL', lottery: 'quina', contest: 1,
  tiers: [{ hits: 5, winners: 0, prizePerWinnerCents: '0' }, { hits: 4, winners: 3, prizePerWinnerCents: '123456' }], totalCollectedCents: null, provenance: { ...SYNTH_PROVENANCE } };
const codes = r => r.errors.map(e => e.code);

test('econômico: válido; separado do resultado (validador de resultado rejeita)', () => {
  assert.deepEqual(validateEconomicRecord(ok), { valid: true, errors: [] });
  assert.equal(validateResultRecord(ok).valid, false);
  assert.ok(validateEconomicRecord({ ...ok, totalCollectedCents: '1000' }).valid);
  assert.ok(validateEconomicRecord({ ...ok, lottery: 'lotomania', tiers: [{ hits: 0, winners: 1, prizePerWinnerCents: '1' }] }).valid);
});

test('econômico: inválidos — status, faixa fora das regras, duplicada, dinheiro, tipos, campos', () => {
  assert.ok(codes(validateEconomicRecord({ ...ok, modelStatus: 'OFFICIAL' })).includes('MODEL_STATUS'));
  assert.ok(codes(validateEconomicRecord({ ...ok, tiers: [{ hits: 1, winners: 0, prizePerWinnerCents: '0' }] })).includes('TIER_NOT_IN_RULES'));
  assert.ok(codes(validateEconomicRecord({ ...ok, tiers: [ok.tiers[0], ok.tiers[0]] })).includes('DUPLICATE_TIER'));
  for (const m of ['1.5', '-1', '01', 100]) assert.ok(codes(validateEconomicRecord({ ...ok, tiers: [{ hits: 5, winners: 0, prizePerWinnerCents: m }] })).includes('MONEY_FORMAT'), String(m));
  assert.ok(codes(validateEconomicRecord({ ...ok, tiers: [{ hits: 5, winners: -1, prizePerWinnerCents: '0' }] })).includes('WRONG_TYPE'));
  assert.ok(codes(validateEconomicRecord({ ...ok, totalCollectedCents: 10 })).includes('MONEY_FORMAT'));
  assert.ok(codes(validateEconomicRecord({ ...ok, numbers: [1] })).includes('UNKNOWN_FIELD'));
  const m = { ...ok }; delete m.provenance; assert.ok(codes(validateEconomicRecord(m)).includes('MISSING_FIELD'));
  assert.ok(codes(validateEconomicRecord({ ...ok, tiers: [{ hits: 5 }] })).includes('MISSING_FIELD'));
});
