// SYNTHETIC_DATA — auditoria: literais monetários JSON (válido, inválido, exponencial, extremos) e pré-Real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decimalLiteralToCents, DECIMAL_LIMITS } from '../../src/historical/values.js';
import { adaptJsonResult, compareRecords, CLASSES as C } from '../../src/historical/reconcile.js';
import { imp } from './_h.js';

const ctx = { xlsxLastContest: 99, xlsxObservedAt: '2026-01-01T00:00:00Z', jsonObservedAt: '2026-01-02T00:00:00Z', jsonSha256: 'b'.repeat(64), jsonUrl: 'https://synthetic.invalid/json' };

test('decimalLiteralToCents: válidos exatos', () => {
  for (const [lit, cents] of [['0', '0'], ['0.0', '0'], ['0.1', '10'], ['30598.43', '3059843'], ['1e2', '10000'], ['1E+3', '100000'], ['1.25e1', '1250'], ['12.300', '1230'], ['1000e-3', '100'], ['5E-2', '5']]) {
    const r = decimalLiteralToCents(lit); assert.equal(r.valid, true, lit); assert.equal(r.cents, cents, lit); assert.equal(r.invalidReason, null);
  }
});

test('decimalLiteralToCents: inválidos com motivo (0.125, 1.5e-3, 1e400, 1e999999999, negativos, gigantes)', () => {
  const cases = [['0.125', 'FRACAO_ALEM_DE_CENTAVOS'], ['1.5e-3', 'FRACAO_ALEM_DE_CENTAVOS'], ['1e400', 'EXPOENTE_FORA_DO_LIMITE'], ['1e999999999', 'EXPOENTE_FORA_DO_LIMITE'], ['1e-999999999', 'EXPOENTE_FORA_DO_LIMITE'],
    ['1e31', 'EXPOENTE_FORA_DO_LIMITE'], ['-1.00', 'VALOR_NEGATIVO'], ['abc', 'LITERAL_NAO_DECIMAL'], ['9'.repeat(40), 'RESULTADO_GRANDE_DEMAIS'], ['9'.repeat(65), 'LITERAL_LONGO_DEMAIS'], ['1e30', 'RESULTADO_GRANDE_DEMAIS'], [42, 'LITERAL_NAO_TEXTO']];
  for (const [lit, why] of cases) { const r = decimalLiteralToCents(lit); assert.equal(r.valid, false, String(lit)); assert.equal(r.cents, null); assert.equal(r.invalidReason, why, String(lit)); }
  assert.ok(DECIMAL_LIMITS.maxExponentAbs <= 30 && DECIMAL_LIMITS.maxResultDigits <= 30);
});

test('limite de custo: literais extremos resolvidos rapidamente (sem BigInt gigante)', () => {
  const t0 = process.hrtime.bigint();
  for (const lit of ['1e999999999', '1e2147483647', '9'.repeat(64), '0.' + '0'.repeat(60) + '1']) decimalLiteralToCents(lit);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 200);
});

test('adaptJsonResult preserva literal, conversão, valid e motivo; presente-inválido ≠ ausente', () => {
  const j = adaptJsonResult('{"numero":1,"valorArrecadado":0.125,"valorEstimadoProximoConcurso":1e400,"listaRateioPremio":[{"descricaoFaixa":"6 acertos","faixa":1,"numeroDeGanhadores":0,"valorPremio":1.5e-3}]}');
  assert.deepEqual(j.economicMoney.totalCollected, { present: true, literal: '0.125', cents: null, valid: false, invalidReason: 'FRACAO_ALEM_DE_CENTAVOS' });
  assert.equal(j.economicMoney.nextPrizeEstimate.invalidReason, 'EXPOENTE_FORA_DO_LIMITE');
  assert.equal(j.economicMoney.specialAccumulated.present, false);
  assert.deepEqual(j.tiers[0].prizeMoney, { present: true, literal: '1.5e-3', cents: null, valid: false, invalidReason: 'FRACAO_ALEM_DE_CENTAVOS' });
  assert.equal(adaptJsonResult('{"valorArrecadado":"12,00"}').economicMoney.totalCollected.invalidReason, 'TIPO_NAO_NUMERICO');
});

test('compareRecords: valor JSON inválido → VALOR_INVALIDO (nunca AUSENTE)', () => {
  const rec = imp('megasena', { seed: 4, count: 3 }).accepted[0].record;
  const d = rec.drawDate.split('-').reverse().join('/');
  const t = rec.prizeTiers.filter(x => !x.winners.absent).map((x, i) => `{"descricaoFaixa":"${x.hits} acertos","faixa":${i + 1},"numeroDeGanhadores":${x.winners.value},"valorPremio":${x.hits === 5 ? '0.125' : '1e999999999'}}`);
  const j = adaptJsonResult(`{"numero":${rec.contest},"dataApuracao":"${d}","listaDezenas":[${rec.numbers.map(n => `"${n}"`).join(',')}],"listaRateioPremio":[${t.join(',')}],"valorArrecadado":0.125,"valorEstimadoProximoConcurso":1e400}`);
  const rows = compareRecords(rec, j, ctx);
  for (const f of ['tier[5].prize', 'tier[6].prize', 'economic.totalCollected', 'economic.nextPrizeEstimate']) {
    const row = rows.find(x => x.field === f); assert.equal(row.class, C.VALOR_INVALIDO, f); assert.notEqual(row.json, null); assert.match(row.note, /não interpretável/);
  }
});

test('pré-Real: aceito sinalizado unidadeMonetariaVerificada:false; comparação financeira nunca vira DIVERGENCIA_REAL', () => {
  const r = imp('quina', { seed: 5, count: 3, startDate: Date.UTC(1994, 2, 13) });
  assert.ok(r.accepted.length > 0);
  for (const a of r.accepted) { assert.equal(a.unidadeMonetariaVerificada, false); assert.ok(a.annotations.includes('CURRENCY_PRE_REAL_NOT_VERIFIED')); }
  const rec = r.accepted[0].record; const d = rec.drawDate.split('-').reverse().join('/');
  const t = rec.prizeTiers.filter(x => !x.winners.absent).map((x, i) => `{"descricaoFaixa":"${x.hits} acertos","faixa":${i + 1},"numeroDeGanhadores":${x.winners.value},"valorPremio":999.99}`);
  const rows = compareRecords(rec, adaptJsonResult(`{"numero":${rec.contest},"dataApuracao":"${d}","listaDezenas":[${rec.numbers.map(n => `"${n}"`).join(',')}],"listaRateioPremio":[${t.join(',')}],"valorArrecadado":1.00}`), ctx);
  const money = rows.filter(x => /prize$|^economic\./.test(x.field) && x.class !== C.AUSENTE);
  assert.ok(money.length > 0);
  assert.ok(money.every(x => x.unidadeMonetariaVerificada === false && x.class !== C.DIVERGENCIA));
  const post = imp('quina', { seed: 5, count: 3, startDate: Date.UTC(2001, 0, 6) });
  assert.ok(post.accepted.every(a => !('unidadeMonetariaVerificada' in a)));
});
