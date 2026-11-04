// SYNTHETIC_DATA — reconciliação XLSX × JSON com classes e quarentena de divergência real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp } from './_h.js';
import { adaptJsonResult, compareRecords, divergenceQuarantine, summarize, CLASSES as C, FIELD_CORRESPONDENCE } from '../../src/historical/reconcile.js';
import { parseJsonPreservingNumbers } from '../../src/historical/jsonnum.js';
import { Q } from '../../src/historical/codes.js';

const ctx = { xlsxLastContest: 12, xlsxObservedAt: '2026-01-01T00:00:00Z', jsonObservedAt: '2026-01-02T00:00:00Z', jsonSha256: 'a'.repeat(64), jsonUrl: 'https://synthetic.invalid/json' };
const toLit = cents => { const s = String(cents).padStart(3, '0'); return `${s.slice(0, -2)}.${s.slice(-2)}`; };
/** JSON SYNTHETIC_DATA construído a partir do registro XLSX sintético (mesmos valores, outra representação). */
function jsonFrom(rec, over = {}) {
  const t = rec.prizeTiers.filter(x => !x.winners.absent).map((x, i) => `{"descricaoFaixa":"${x.hits} acertos","faixa":${i + 1},"numeroDeGanhadores":${x.winners.value},"valorPremio":${toLit(x.prize.cents)}}`);
  const d = rec.drawDate.split('-').reverse().join('/');
  const e = rec.economic;
  return `{"numero":${over.numero ?? rec.contest},"dataApuracao":"${over.data ?? d}","listaDezenas":[${(over.dezenas ?? rec.numbers).map(n => `"${String(n).padStart(2, '0')}"`).join(',')}],"dezenasSorteadasOrdemSorteio":[${rec.numbers.map(n => `"${String(n).padStart(2, '0')}"`).join(',')}],"listaRateioPremio":[${t.join(',')}],"valorArrecadado":${toLit(e.totalCollected.cents)},"valorEstimadoProximoConcurso":${toLit(e.nextPrizeEstimate.cents)},"listaMunicipioUFGanhadores":[],"observacao":"","tipoJogo":"SYNTHETIC","campoNovo":1}`;
}

test('JSON: literais numéricos preservados; chave duplicada rejeitada', () => {
  const j = parseJsonPreservingNumbers('{"a":30598.43,"b":[1,2]}');
  assert.deepEqual(j.a, { $number: '30598.43' });
  assert.throws(() => parseJsonPreservingNumbers('{"a":1,"a":2}'));
  assert.equal(adaptJsonResult('{"valorArrecadado":0.1,"numero":5}').economic.totalCollected, '10');
});

test('tabela de correspondência cobre os campos principais e marca hipóteses', () => {
  for (const f of ['contest', 'drawDate', 'numbers', 'drawOrder', 'tier[k].prize', 'economic.totalCollected']) assert.ok(FIELD_CORRESPONDENCE.some(x => x.lotus === f), f);
  assert.equal(FIELD_CORRESPONDENCE.find(x => x.lotus === 'economic.accumulatedTopTier').status, 'HIPOTESE');
});

test('equivalente: mesmos valores em representações diferentes; ordem só no JSON; campo só no JSON', () => {
  const r = imp('megasena', { seed: 3 }); const rec = r.accepted[0].record;
  const rows = compareRecords(rec, adaptJsonResult(jsonFrom(rec)), ctx);
  assert.equal(rows.filter(x => x.class === C.DIVERGENCIA).length, 0);
  assert.equal(rows.find(x => x.field === 'numbers').class, C.EQUIVALENTE);
  assert.equal(rows.find(x => x.field === 'tier[5].prize').class, C.EQUIVALENTE);
  assert.equal(rows.find(x => x.field === 'drawOrder').class, C.AUSENTE);
  assert.equal(rows.find(x => x.field === 'json:campoNovo').class, C.AUSENTE);
  assert.equal(divergenceQuarantine(rec, adaptJsonResult(jsonFrom(rec)), rows, ctx), null);
});

test('divergência real → DIVERGENCIA_JSON_XLSX na quarentena; XLSX não é sobrescrito', () => {
  const r = imp('quina', { seed: 3 }); const rec = r.accepted[2].record; const before = JSON.stringify(rec);
  const other = rec.numbers.map((n, i) => (i === 0 ? (n === 80 ? 79 : 80) : n));
  const j = adaptJsonResult(jsonFrom(rec, { dezenas: other, data: '01/01/1990' }));
  const rows = compareRecords(rec, j, ctx);
  assert.equal(rows.find(x => x.field === 'numbers').class, C.DIVERGENCIA);
  assert.equal(rows.find(x => x.field === 'drawDate').class, C.DIVERGENCIA);
  const q = divergenceQuarantine(rec, j, rows, ctx);
  assert.equal(q.stage, 'dataset'); assert.ok(q.reasons.every(x => x.code === Q.DIVERGENCIA_JSON_XLSX)); assert.equal(q.reasons.length, 2);
  assert.equal(JSON.stringify(rec), before);
  assert.ok(summarize(rows)[C.DIVERGENCIA] === 2);
});

test('formatação de data, diferença temporal, ausência em uma fonte, faixa "-" × não listada', () => {
  const r = imp('lotomania', { seed: 3 }); const rec = r.accepted[0].record;
  const d = rec.drawDate.split('-'); const fmt = `${Number(d[2])}/${d[1]}/${d[0]}`;
  const rows = compareRecords(rec, adaptJsonResult(jsonFrom(rec, { data: fmt })), ctx);
  assert.equal(rows.find(x => x.field === 'drawDate').class, Number(d[2]) < 10 ? C.FORMATACAO : C.EQUIVALENTE);
  assert.equal(rows.find(x => x.field === 'tier[15]').class, C.REPRESENTACAO);
  const later = compareRecords(null, adaptJsonResult(jsonFrom(rec, { numero: 13 })), ctx);
  assert.equal(later[0].class, C.TEMPORAL);
  const missing = compareRecords(null, adaptJsonResult(jsonFrom(rec, { numero: 5 })), ctx);
  assert.equal(missing[0].class, C.AUSENTE);
});
