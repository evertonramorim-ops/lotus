// SYNTHETIC_DATA — auditoria complementar: validade monetária por fonte (XLSX e JSON) e classificação independente
// de tier[k].winners e tier[k].prize. Offline e determinístico.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp } from './_h.js';
import { adaptJsonResult, compareRecords, CLASSES as C } from '../../src/historical/reconcile.js';

const ctx = { xlsxLastContest: 99, xlsxObservedAt: '2026-01-01T00:00:00Z', jsonObservedAt: '2026-01-02T00:00:00Z', jsonSha256: 'c'.repeat(64), jsonUrl: 'https://synthetic.invalid/json' };
const toLit = c => { const s = String(c).padStart(3, '0'); return `${s.slice(0, -2)}.${s.slice(-2)}`; };
const clone = o => JSON.parse(JSON.stringify(o));
const absentMoney = m => ({ ...m, cents: null, absent: true, absenceReason: 'DASH_CELL', raw: '-' });
const absentInt = m => ({ ...m, value: null, absent: true, absenceReason: 'DASH_CELL', raw: '-' });
const invalidMoney = (m, raw = 'R$ 1,2,3') => ({ ...m, cents: null, raw, absent: false, absenceReason: null, valid: false, ref: m.ref ?? 'Z9', column: m.column ?? 'Rateio sintético', invalidReason: 'formato monetário não reconhecido' });
function jsonOf(rec, { prize = x => toLit(x.prize.cents ?? 100), tiers = rec.prizeTiers, extra = [], arrec } = {}) {
  const t = [...tiers.map((x, i) => `{"descricaoFaixa":"${x.hits} acertos","faixa":${i + 1},"numeroDeGanhadores":${x.winners.value ?? 0},"valorPremio":${prize(x)}}`), ...extra];
  const d = rec.drawDate.split('-').reverse().join('/');
  return adaptJsonResult(`{"numero":${rec.contest},"dataApuracao":"${d}","listaDezenas":[${rec.numbers.map(n => `"${String(n).padStart(2, '0')}"`).join(',')}],"listaRateioPremio":[${t.join(',')}],"valorArrecadado":${arrec ?? toLit(rec.economic.totalCollected.cents ?? 100)},"valorEstimadoProximoConcurso":${toLit(rec.economic.nextPrizeEstimate.cents ?? 100)}}`);
}
const base = () => clone(imp('megasena', { seed: 21, count: 3 }).accepted[0].record);
const preRealBase = () => clone(imp('quina', { seed: 5, count: 3, startDate: Date.UTC(1994, 2, 13) }).accepted[0].record);
const one = (rows, f) => { const r = rows.filter(q => q.field === f); assert.equal(r.length, 1, `exatamente uma linha para ${f}`); return r[0]; };
const noDiv = rows => assert.ok(!rows.some(q => q.class === C.DIVERGENCIA), 'nenhuma DIVERGENCIA_REAL');

test('1: prêmio XLSX inválido (absent:false, valid:false), JSON válido → VALOR_INVALIDO origem XLSX, nunca DIVERGENCIA_REAL', () => {
  const x = base(); const t = x.prizeTiers.find(p => p.hits === 5); t.prize = invalidMoney(t.prize);
  const rows = compareRecords(x, jsonOf(x, { prize: p => (p.hits === 5 ? '10.00' : toLit(p.prize.cents)) }), ctx);
  const r = one(rows, 'tier[5].prize');
  assert.equal(r.class, C.VALOR_INVALIDO); assert.equal(r.invalidSource, 'XLSX');
  assert.equal(r.xlsxLiteral, 'R$ 1,2,3'); assert.equal(r.xlsxRef, t.prize.ref); assert.equal(r.xlsxColumn, t.prize.column);
  assert.equal(r.xlsxInvalidReason, 'formato monetário não reconhecido'); assert.equal(r.jsonLiteral, '10.00'); assert.equal(r.jsonValid, true);
  assert.equal(one(rows, 'tier[5].winners').class, C.EQUIVALENTE, 'ganhadores seguem comparados');
  noDiv(rows);
});

test('2: campo econômico XLSX inválido, JSON válido → VALOR_INVALIDO origem XLSX', () => {
  const x = base(); x.economic.totalCollected = invalidMoney(x.economic.totalCollected, 'abc');
  const rows = compareRecords(x, jsonOf(x, { arrec: '123.45' }), ctx);
  const r = one(rows, 'economic.totalCollected');
  assert.equal(r.class, C.VALOR_INVALIDO); assert.equal(r.invalidSource, 'XLSX'); assert.equal(r.xlsxLiteral, 'abc'); assert.equal(r.jsonLiteral, '123.45');
  noDiv(rows);
});

test('3: XLSX válido, JSON inválido → VALOR_INVALIDO origem JSON (correção anterior preservada)', () => {
  const x = base();
  const rows = compareRecords(x, jsonOf(x, { prize: p => (p.hits === 5 ? '0.125' : toLit(p.prize.cents)), arrec: '"x"' }), ctx);
  const r = one(rows, 'tier[5].prize');
  assert.equal(r.class, C.VALOR_INVALIDO); assert.equal(r.invalidSource, 'JSON'); assert.equal(r.jsonLiteral, '0.125'); assert.equal(r.invalidReason, 'FRACAO_ALEM_DE_CENTAVOS'); assert.equal(r.xlsxValid, true);
  const e = one(rows, 'economic.totalCollected'); assert.equal(e.class, C.VALOR_INVALIDO); assert.equal(e.invalidSource, 'JSON'); assert.equal(e.jsonInvalidReason, 'TIPO_NAO_NUMERICO');
  noDiv(rows);
});

test('4: XLSX e JSON inválidos → VALOR_INVALIDO origem AMBOS com as duas evidências', () => {
  const x = base(); const t = x.prizeTiers.find(p => p.hits === 4); t.prize = invalidMoney(t.prize);
  x.economic.totalCollected = invalidMoney(x.economic.totalCollected, '??');
  const rows = compareRecords(x, jsonOf(x, { prize: p => (p.hits === 4 ? '1e999999999' : toLit(p.prize.cents)), arrec: '"y"' }), ctx);
  for (const [f, xl, jl, jr] of [['tier[4].prize', 'R$ 1,2,3', '1e999999999', 'EXPOENTE_FORA_DO_LIMITE'], ['economic.totalCollected', '??', 'y', 'TIPO_NAO_NUMERICO']]) {
    const r = one(rows, f);
    assert.equal(r.class, C.VALOR_INVALIDO); assert.equal(r.invalidSource, 'AMBOS');
    assert.equal(r.xlsxLiteral, xl); assert.equal(r.jsonLiteral, jl); assert.equal(r.xlsxValid, false); assert.equal(r.jsonValid, false);
    assert.equal(r.xlsxInvalidReason, 'formato monetário não reconhecido'); assert.equal(r.jsonInvalidReason, jr);
    assert.match(r.invalidReason, /XLSX: .*; JSON: /);
  }
  noDiv(rows);
});

test('5: ganhadores ausentes no XLSX, prêmio válido → ganhadores classificados e prêmio comparado', () => {
  const x = base(); const t = x.prizeTiers.find(p => p.hits === 4); t.winners = absentInt(t.winners);
  const rows = compareRecords(x, jsonOf(x), ctx);
  assert.equal(one(rows, 'tier[4].winners').class, C.SEMANTICA);
  assert.equal(one(rows, 'tier[4].prize').class, C.EQUIVALENTE);
  const rowsD = compareRecords(x, jsonOf(x, { prize: p => (p.hits === 4 ? toLit(p.prize.cents + 1) : toLit(p.prize.cents)) }), ctx);
  assert.equal(one(rowsD, 'tier[4].prize').class, C.DIVERGENCIA, 'dois valores válidos diferentes ainda divergem');
});

test('6: ganhadores válidos, prêmio ausente no XLSX → ganhadores comparados, ausência do prêmio registrada', () => {
  const x = base(); const t = x.prizeTiers.find(p => p.hits === 5); t.prize = absentMoney(t.prize);
  const rows = compareRecords(x, jsonOf(x), ctx);
  assert.equal(one(rows, 'tier[5].winners').class, C.EQUIVALENTE);
  const p = one(rows, 'tier[5].prize'); assert.equal(p.class, C.SEMANTICA); assert.equal(p.xlsx, '-');
  noDiv(rows);
});

test('7: prêmio ausente no XLSX e JSON válido → linha do prêmio presente (sem equivalência/divergência)', () => {
  const x = base(); const t = x.prizeTiers.find(p => p.hits === 6); t.prize = absentMoney(t.prize);
  const p = one(compareRecords(x, jsonOf(x, { prize: () => '99.99' }), ctx), 'tier[6].prize');
  assert.equal(p.class, C.SEMANTICA); assert.equal(p.jsonLiteral, '99.99');
});

test('8: ganhadores e prêmio ausentes no XLSX → duas linhas, sem divergência', () => {
  const x = base(); const t = x.prizeTiers.find(p => p.hits === 4); t.prize = absentMoney(t.prize); t.winners = absentInt(t.winners);
  const rows = compareRecords(x, jsonOf(x), ctx);
  assert.equal(one(rows, 'tier[4].winners').class, C.SEMANTICA); assert.equal(one(rows, 'tier[4].prize').class, C.SEMANTICA);
  noDiv(rows);
});

test('9: faixa inexistente no XLSX e presente no JSON (válida e inválida) → linhas independentes', () => {
  const x = base();
  const rv = compareRecords(x, jsonOf(x, { extra: ['{"descricaoFaixa":"3 acertos","faixa":4,"numeroDeGanhadores":7,"valorPremio":5.00}'] }), ctx);
  assert.equal(one(rv, 'tier[3].winners').class, C.AUSENTE); assert.equal(one(rv, 'tier[3].prize').class, C.AUSENTE);
  const ri = compareRecords(x, jsonOf(x, { extra: ['{"descricaoFaixa":"3 acertos","faixa":4,"numeroDeGanhadores":7,"valorPremio":1.5e-3}'] }), ctx);
  assert.equal(one(ri, 'tier[3].winners').class, C.AUSENTE);
  const p = one(ri, 'tier[3].prize'); assert.equal(p.class, C.VALOR_INVALIDO); assert.equal(p.invalidSource, 'JSON'); assert.equal(p.xlsx, '<faixa inexistente no XLSX>');
  assert.equal(rv.concat(ri).filter(q => q.field === 'tier[3]').length, 0);
  noDiv(rv.concat(ri));
});

test('10: pré-Real com dinheiro ausente ou inválido → classe preservada + unidadeMonetariaVerificada:false, sem equivalência', () => {
  const x = preRealBase(); assert.ok(x.drawDate < '1994-07-01');
  const tiers = x.prizeTiers.filter(p => !p.winners.absent); const [a, b] = tiers;
  a.prize = absentMoney(a.prize); b.prize = invalidMoney(b.prize);
  const rows = compareRecords(x, jsonOf(x, { tiers }), ctx);
  const pa = one(rows, `tier[${a.hits}].prize`); assert.equal(pa.class, C.SEMANTICA); assert.equal(pa.unidadeMonetariaVerificada, false); assert.doesNotMatch(pa.note, /pré-Real NÃO verificada: SEMANTICA_DESCONHECIDA mesmo/, 'classe por ausência, não por comparação');
  const pb = one(rows, `tier[${b.hits}].prize`); assert.equal(pb.class, C.VALOR_INVALIDO); assert.equal(pb.invalidSource, 'XLSX'); assert.equal(pb.unidadeMonetariaVerificada, false);
  for (const q of rows.filter(r => /\.prize$|^economic\./.test(r.field))) { assert.notEqual(q.class, C.EQUIVALENTE, q.field); assert.equal(q.unidadeMonetariaVerificada, false, q.field); }
  noDiv(rows);
});

test('11: regressões — JSON inválido segue VALOR_INVALIDO; pré-Real válido com centavos iguais segue SEMANTICA_DESCONHECIDA', () => {
  const x = base();
  assert.equal(one(compareRecords(x, jsonOf(x, { prize: p => (p.hits === 6 ? '0.125' : toLit(p.prize.cents)) }), ctx), 'tier[6].prize').class, C.VALOR_INVALIDO);
  const y = preRealBase(); const tiers = y.prizeTiers.filter(p => !p.winners.absent);
  const rows = compareRecords(y, jsonOf(y, { tiers }), ctx);
  for (const t of tiers) { const q = one(rows, `tier[${t.hits}].prize`); assert.equal(q.class, C.SEMANTICA); assert.equal(q.unidadeMonetariaVerificada, false); assert.ok(q.xlsxLiteral && q.jsonLiteral); }
  assert.equal(one(rows, 'economic.totalCollected').class, C.SEMANTICA);
  noDiv(rows);
});
