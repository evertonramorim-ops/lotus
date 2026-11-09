// SYNTHETIC_DATA — auditoria final: VALOR_INVALIDO em faixas independe da existência/ausência no XLSX; pré-Real nunca EQUIVALENTE financeiro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp } from './_h.js';
import { adaptJsonResult, compareRecords, CLASSES as C } from '../../src/historical/reconcile.js';

const ctx = { xlsxLastContest: 99, xlsxObservedAt: '2026-01-01T00:00:00Z', jsonObservedAt: '2026-01-02T00:00:00Z', jsonSha256: 'c'.repeat(64), jsonUrl: 'https://synthetic.invalid/json' };
const toLit = c => { const s = String(c).padStart(3, '0'); return `${s.slice(0, -2)}.${s.slice(-2)}`; };
const clone = o => JSON.parse(JSON.stringify(o));
const absentMoney = m => ({ ...m, cents: null, absent: true, absenceReason: 'DASH_CELL', raw: '-' });
const absentInt = m => ({ ...m, value: null, absent: true, absenceReason: 'DASH_CELL', raw: '-' });
/** JSON SYNTHETIC_DATA a partir do registro; `prize(hits)` devolve o literal do valorPremio; `tiers` filtra faixas. */
function jsonOf(rec, { prize = x => toLit(x.prize.cents ?? 100), tiers = rec.prizeTiers, extra = [] } = {}) {
  const t = [...tiers.map((x, i) => `{"descricaoFaixa":"${x.hits} acertos","faixa":${i + 1},"numeroDeGanhadores":${x.winners.value ?? 0},"valorPremio":${prize(x)}}`), ...extra];
  const d = rec.drawDate.split('-').reverse().join('/');
  return adaptJsonResult(`{"numero":${rec.contest},"dataApuracao":"${d}","listaDezenas":[${rec.numbers.map(n => `"${String(n).padStart(2, '0')}"`).join(',')}],"listaRateioPremio":[${t.join(',')}],"valorArrecadado":${toLit(rec.economic.totalCollected.cents)},"valorEstimadoProximoConcurso":${toLit(rec.economic.nextPrizeEstimate.cents)}}`);
}
const base = () => clone(imp('megasena', { seed: 21, count: 3 }).accepted[0].record);
const row = (rows, f) => rows.filter(r => r.field === f);

test('regressão 1: ambas têm a faixa, prêmio XLSX ausente, JSON inválido → VALOR_INVALIDO (literal + motivo)', () => {
  const x = base(); const t = x.prizeTiers.find(p => p.hits === 5); t.prize = absentMoney(t.prize);
  const rows = compareRecords(x, jsonOf(x, { prize: p => (p.hits === 5 ? '0.125' : toLit(p.prize.cents)) }), ctx);
  const r = row(rows, 'tier[5].prize'); assert.equal(r.length, 1);
  assert.equal(r[0].class, C.VALOR_INVALIDO); assert.equal(r[0].json, '0.125'); assert.equal(r[0].jsonLiteral, '0.125'); assert.equal(r[0].invalidReason, 'FRACAO_ALEM_DE_CENTAVOS');
  assert.ok(!rows.some(q => q.class === C.DIVERGENCIA));
});

test('regressão 2: XLSX com ganhadores ausentes (prêmio presente), JSON inválido → VALOR_INVALIDO', () => {
  const x = base(); const t = x.prizeTiers.find(p => p.hits === 4); t.winners = absentInt(t.winners);
  const rows = compareRecords(x, jsonOf(x, { prize: p => (p.hits === 4 ? '1e999999999' : toLit(p.prize.cents)) }), ctx);
  const r = row(rows, 'tier[4].prize'); assert.equal(r.length, 1); assert.equal(r[0].class, C.VALOR_INVALIDO); assert.equal(r[0].invalidReason, 'EXPOENTE_FORA_DO_LIMITE');
  assert.equal(row(rows, 'tier[4].winners')[0].class, C.SEMANTICA, 'classe de ausência no XLSX preservada para ganhadores');
  assert.ok(!rows.some(q => q.class === C.DIVERGENCIA));
});

test('regressão 3: XLSX sem a faixa, JSON com faixa de valor inválido → VALOR_INVALIDO (nunca só AUSENTE)', () => {
  const x = base();
  const rows = compareRecords(x, jsonOf(x, { extra: ['{"descricaoFaixa":"3 acertos","faixa":4,"numeroDeGanhadores":7,"valorPremio":1.5e-3}'] }), ctx);
  const r = row(rows, 'tier[3].prize'); assert.equal(r.length, 1); assert.equal(r[0].class, C.VALOR_INVALIDO); assert.equal(r[0].json, '1.5e-3'); assert.equal(r[0].invalidReason, 'FRACAO_ALEM_DE_CENTAVOS');
  assert.equal(row(rows, 'tier[3]').length, 0, 'sem linha genérica AUSENTE que esconda o valor inválido');
  // [3b.2-integral 2.1 — expectativa antiga demonstradamente incorreta] Mega-Sena "3 acertos" está fora da configuração
  // atual (prizeTiers [4,5,6]) e o período histórico em tier-rules.js é RULE_NOT_VERIFIED: não há regra comprovada que
  // a permita (comparação normal) nem que a proíba (DADO_INVALIDO). Logo é SEMANTICA_DESCONHECIDA — nunca AUSENTE,
  // que afirmaria "faixa legítima ausente numa fonte" sem prova.
  assert.equal(row(rows, 'tier[3].winners')[0].class, C.SEMANTICA); assert.equal(row(rows, 'tier[3].winners')[0].tierRule.status, 'DESCONHECIDA_SEM_REGRA_HISTORICA_COMPROVADA');
});

test('regressão 4: JSON válido + XLSX ausente → classificação de ausência/semântica anterior preservada', () => {
  const x = base(); const t = x.prizeTiers.find(p => p.hits === 5); t.prize = absentMoney(t.prize);
  const rows = compareRecords(x, jsonOf(x, { prize: () => '10.00' }), ctx);
  // Ajuste da auditoria complementar: antes, a ausência do PRÊMIO rebaixava os GANHADORES (válidos) a SEMANTICA e
  // omitia a linha do prêmio — justamente a omissão corrigida. Agora: ganhadores comparados, prêmio com linha própria.
  assert.equal(row(rows, 'tier[5].winners')[0].class, C.EQUIVALENTE);
  assert.equal(row(rows, 'tier[5].prize').length, 1); assert.equal(row(rows, 'tier[5].prize')[0].class, C.SEMANTICA);
  const rows2 = compareRecords(base(), jsonOf(base(), { extra: ['{"descricaoFaixa":"3 acertos","faixa":4,"numeroDeGanhadores":7,"valorPremio":5.00}'] }), ctx);
  // Ajuste: faixa só no JSON passa de uma linha genérica tier[3] a linhas independentes (mesma classe AUSENTE).
  // [3b.2-integral 2.1 — expectativa antiga demonstradamente incorreta] Mega-Sena "3 acertos" está fora da configuração
  // atual (prizeTiers [4,5,6]) e o período histórico em tier-rules.js é RULE_NOT_VERIFIED: não há regra comprovada que
  // a permita (comparação normal) nem que a proíba (DADO_INVALIDO). Logo é SEMANTICA_DESCONHECIDA — nunca AUSENTE,
  // que afirmaria "faixa legítima ausente numa fonte" sem prova.
  assert.equal(row(rows2, 'tier[3].winners')[0].class, C.SEMANTICA); assert.equal(row(rows2, 'tier[3].prize')[0].class, C.SEMANTICA);
  assert.ok(!rows2.some(q => q.class === C.DIVERGENCIA));
  assert.ok(!rows.concat(rows2).some(q => q.class === C.VALOR_INVALIDO));
});

test('regressão 5: JSON não lista a faixa → comportamento anterior (SEMANTICA / REPRESENTACAO)', () => {
  const x = base();
  const rows = compareRecords(x, jsonOf(x, { tiers: x.prizeTiers.filter(p => p.hits !== 4) }), ctx);
  assert.equal(row(rows, 'tier[4]')[0].class, C.SEMANTICA);
  const y = base(); const t = y.prizeTiers.find(p => p.hits === 4); t.prize = absentMoney(t.prize); t.winners = absentInt(t.winners);
  assert.equal(row(compareRecords(y, jsonOf(y, { tiers: y.prizeTiers.filter(p => p.hits !== 4) }), ctx), 'tier[4]')[0].class, C.REPRESENTACAO);
});

test('pré-Real: centavos coincidentes NÃO geram EQUIVALENTE financeiro (SEMANTICA_DESCONHECIDA, literais preservados)', () => {
  const r = imp('quina', { seed: 5, count: 3, startDate: Date.UTC(1994, 2, 13) });
  const x = r.accepted[0].record; assert.ok(x.drawDate < '1994-07-01');
  const rows = compareRecords(x, jsonOf(x, { tiers: x.prizeTiers.filter(p => !p.winners.absent) }), ctx);
  const money = rows.filter(q => /\.prize$|^economic\./.test(q.field) && q.class !== C.AUSENTE);
  assert.ok(money.length >= 3);
  for (const q of money) {
    assert.equal(q.class, C.SEMANTICA, q.field); assert.equal(q.unidadeMonetariaVerificada, false);
    assert.ok(q.xlsxLiteral && q.jsonLiteral, 'literais das duas fontes'); assert.match(q.note, /0,7/);
  }
  assert.ok(!rows.some(q => q.class === C.DIVERGENCIA));
  assert.equal(row(rows, 'numbers')[0].class, C.EQUIVALENTE, 'campos não monetários comparados normalmente');
  assert.equal(row(rows, 'drawDate')[0].class, C.EQUIVALENTE);
  assert.equal(row(rows, 'contest')[0].class, C.EQUIVALENTE);
});

test('pré-Real com valor JSON inválido → VALOR_INVALIDO (não SEMANTICA nem DIVERGENCIA), flag mantido', () => {
  const x = imp('quina', { seed: 6, count: 2, startDate: Date.UTC(1994, 2, 13) }).accepted[0].record;
  const tiers = x.prizeTiers.filter(p => !p.winners.absent); const h = tiers[0].hits;
  const rows = compareRecords(x, jsonOf(x, { tiers, prize: p => (p.hits === h ? '0.125' : toLit(p.prize.cents)) }), ctx);
  const q = row(rows, `tier[${h}].prize`)[0]; assert.equal(q.class, C.VALOR_INVALIDO); assert.equal(q.unidadeMonetariaVerificada, false);
});
