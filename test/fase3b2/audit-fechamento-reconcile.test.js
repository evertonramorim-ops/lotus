// SYNTHETIC_DATA — fechamento consolidado da auditoria de reconciliação (PR #4): união completa XLSX ∪ JSON de faixas
// (inclusive duplicadas e não previstas), precedência por campo na faixa duplicada, rastreabilidade das dezenas XLSX
// por célula e caminho de classificação do script. Offline e determinístico; nenhum dado real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp } from './_h.js';
import { adaptJsonResult, compareRecords, CLASSES as C, MONETARY_REGIME as R } from '../../src/historical/reconcile.js';
import { LOTTERIES } from '../../src/lotteries/config.js';
// import dinâmico: permite medir falha-antes por teste contra o código anterior (módulo inexistente lá)
const S = await import('../../src/historical/reconcile-sample.js').catch(() => null);

const ctx = { xlsxLastContest: 99, xlsxObservedAt: '2026-01-01T00:00:00Z', jsonObservedAt: '2026-01-02T00:00:00Z', jsonSha256: 'c'.repeat(64), jsonUrl: 'https://synthetic.invalid/json' };
const toLit = c => { const s = String(c).padStart(3, '0'); return `${s.slice(0, -2)}.${s.slice(-2)}`; };
const clone = o => JSON.parse(JSON.stringify(o));
const ABS = m => ({ ...m, cents: null, value: null, absent: true, absenceReason: 'DASH_CELL', raw: '-' });
const BADM = (m, raw = 'R$ 1,2,3') => ({ ...m, cents: null, raw, absent: false, valid: false, ref: m.ref ?? 'Z9', column: m.column ?? 'col sintética', invalidReason: 'formato monetário não reconhecido' });
const BADI = (m, raw = '-3') => ({ ...m, value: null, raw, absent: false, valid: false, ref: m.ref ?? 'Z8', column: m.column ?? 'col sintética', invalidReason: 'esperado inteiro ≥ 0' });
const base = () => clone(imp('megasena', { seed: 21, count: 3 }).accepted[0].record);
const preReal = () => clone(imp('quina', { seed: 5, count: 3, startDate: Date.UTC(1994, 2, 13) }).accepted[0].record);
const tierOf = (x, h) => x.prizeTiers.find(p => p.hits === h);
const ent = (h, w, p, faixa = 1) => `{"descricaoFaixa":"${h} acertos","faixa":${faixa},"numeroDeGanhadores":${w},"valorPremio":${p}}`;
const entOf = (t, i) => ent(t.hits, t.winners.value ?? 0, toLit(t.prize.cents ?? 100), i + 1);
/** JSON SYNTHETIC_DATA com listaRateioPremio explícita (lista de fragmentos JSON). */
function J(x, tiers, over = {}) {
  const o = { numero: String(x.contest), dataApuracao: JSON.stringify(x.drawDate.split('-').reverse().join('/')), listaDezenas: `[${x.numbers.map(n => `"${String(n).padStart(2, '0')}"`).join(',')}]`, listaRateioPremio: `[${tiers.join(',')}]`,
    valorArrecadado: toLit(x.economic.totalCollected.cents ?? 100), valorEstimadoProximoConcurso: toLit(x.economic.nextPrizeEstimate.cents ?? 100), ...over };
  return adaptJsonResult(`{${Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `"${k}":${v}`).join(',')}}`);
}
const std = x => x.prizeTiers.map(entOf);
const one = (rows, f) => { const r = rows.filter(q => q.field === f); assert.equal(r.length, 1, `exatamente uma linha ${f}: ${r.length}`); return r[0]; };
const noDiv = rows => assert.deepEqual(rows.filter(q => q.class === C.DIVERGENCIA).map(q => q.field), []);

/* ---------- 1. faixa não reconhecida, presente somente no JSON ---------- */
test('1: faixa não prevista (Mega-Sena 2 acertos) só no JSON → linhas próprias com evidência estrutural JSON (índice, descrição, motivo)', () => {
  const x = base(); const L = std(x);
  const rows = compareRecords(x, J(x, [...L, ent(2, 1, '1.00', 9)]), ctx);
  for (const f of ['winners', 'prize']) {
    const r = one(rows, `tier[2].${f}`);
    assert.deepEqual(r.jsonTierIssue, { source: 'JSON', reasons: ['FAIXA_NAO_PREVISTA_NA_MODALIDADE'], indexes: [L.length] });
    assert.equal(r.jsonEntries.length, 1); assert.equal(r.jsonEntries[0].index, L.length); assert.equal(r.jsonEntries[0].description, '2 acertos'); assert.equal(r.jsonEntries[0].faixa, '9');
    assert.deepEqual(r.jsonEntries[0].winners, { present: true, literal: '1', valid: true, invalidReason: null });
    assert.deepEqual(r.jsonEntries[0].prize, { present: true, literal: '1.00', valid: true, invalidReason: null });
  }
  assert.deepEqual(one(rows, 'json:listaRateioPremio').unrecognized, [{ index: L.length, hits: 2, reason: 'FAIXA_NAO_PREVISTA_NA_MODALIDADE' }]);
  noDiv(rows);
  // valores inválidos na faixa não prevista: precedência do valor (VALOR_INVALIDO / DADO_INVALIDO), origem JSON
  const bad = compareRecords(x, J(x, [...L, ent(2, -1, '0.125', 9)]), ctx);
  const p = one(bad, 'tier[2].prize'); assert.equal(p.class, C.VALOR_INVALIDO); assert.equal(p.invalidSource, 'JSON'); assert.equal(p.jsonInvalidReason, 'FRACAO_ALEM_DE_CENTAVOS'); assert.equal(p.xlsxPresent, false); assert.equal(p.xlsxValid, null);
  const w = one(bad, 'tier[2].winners'); assert.equal(w.class, C.DADO_INVALIDO); assert.equal(w.invalidSource, 'JSON'); assert.equal(w.jsonInvalidReason, 'NEGATIVO');
  noDiv(bad);
});

/* ---------- 2. faixa duplicada, presente somente no JSON ---------- */
test('2: faixa duplicada só no JSON (prevista e não prevista) não desaparece da união; todas as entradas preservadas', () => {
  const x = base(); x.prizeTiers = x.prizeTiers.filter(p => p.hits !== 4); const L = std(x);
  const rows = compareRecords(x, J(x, [...L, ent(4, 3, '10.00', 3), ent(4, 5, '20.00', 4)]), ctx);
  for (const f of ['winners', 'prize']) {
    const r = one(rows, `tier[4].${f}`);
    assert.equal(r.class, C.DADO_INVALIDO); assert.equal(r.invalidSource, 'JSON'); assert.equal(r.invalidReason, 'FAIXA_DUPLICADA_ASSOCIACAO_AMBIGUA');
    assert.equal(r.xlsxPresent, false); assert.equal(r.xlsxValid, null); assert.equal(r.xlsx, '<faixa inexistente no XLSX>');
    assert.deepEqual(r.jsonEntries.map(e => e.index), [L.length, L.length + 1]);
    assert.deepEqual(r.jsonEntries.map(e => e[f].literal), f === 'winners' ? ['3', '5'] : ['10.00', '20.00']);
    assert.deepEqual(r.jsonEntries.map(e => e.faixa), ['3', '4']); assert.deepEqual(r.jsonTierIssue.reasons, ['FAIXA_DUPLICADA']);
  }
  const s = one(rows, 'json:listaRateioPremio'); assert.equal(s.duplicates.length, 1);
  assert.deepEqual(s.duplicates[0].indexes, [L.length, L.length + 1]); assert.equal(s.duplicates[0].entries.length, 2); assert.match(s.duplicates[0].entries[1].element, /"valorPremio":"20.00"/);
  noDiv(rows);
  const un = compareRecords(x, J(x, [...L, ent(3, 1, '1.00', 7), ent(3, 2, '2.00', 8)]), ctx);
  for (const f of ['winners', 'prize']) { const r = one(un, `tier[3].${f}`); assert.equal(r.class, C.DADO_INVALIDO); assert.deepEqual(r.jsonTierIssue.reasons, ['FAIXA_DUPLICADA', 'FAIXA_NAO_PREVISTA_NA_MODALIDADE']); assert.equal(r.jsonEntries.length, 2); }
  noDiv(un);
});

/* ---------- 3. faixa duplicada nas duas fontes ---------- */
test('3: faixa duplicada no JSON e presente no XLSX (valores válidos) → DADO_INVALIDO por associação ambígua, origem JSON, nunca AMBOS', () => {
  const x = base(); const L = std(x); const t5 = tierOf(x, 5);
  const rows = compareRecords(x, J(x, [...L, ent(5, t5.winners.value + 9, toLit(BigInt(t5.prize.cents) + 1n), 9)]), ctx);
  for (const f of ['winners', 'prize']) {
    const r = one(rows, `tier[5].${f}`); assert.equal(r.class, C.DADO_INVALIDO); assert.equal(r.invalidSource, 'JSON');
    assert.equal(r.xlsxPresent, true); assert.equal(r.xlsxValid, true); assert.equal(r.jsonPresent, true); assert.equal(r.jsonValid, true, 'valores individuais válidos preservados');
    assert.equal(r.xlsxRef, t5[f].ref); assert.equal(r.jsonEntries.length, 2);
  }
  noDiv(rows);
});

/* ---------- 4. duplicada com prêmio JSON inválido numa entrada ---------- */
test('4: faixa duplicada com prêmio JSON inválido em uma entrada → VALOR_INVALIDO (origem JSON), validade por entrada preservada', () => {
  const x = base(); const L = std(x); const i5 = x.prizeTiers.findIndex(p => p.hits === 5);
  const rows = compareRecords(x, J(x, [...L, ent(5, 1, '0.125', 9)]), ctx);
  const p = one(rows, 'tier[5].prize'); assert.equal(p.class, C.VALOR_INVALIDO); assert.equal(p.invalidSource, 'JSON');
  assert.equal(p.xlsxValid, true); assert.equal(p.jsonValid, false); assert.equal(p.jsonInvalidReason, `[${L.length}] FRACAO_ALEM_DE_CENTAVOS`);
  assert.deepEqual(p.jsonEntries.map(e => [e.index, e.prize.valid, e.prize.invalidReason]), [[i5, true, null], [L.length, false, 'FRACAO_ALEM_DE_CENTAVOS']]);
  assert.deepEqual(p.jsonTierIssue.reasons, ['FAIXA_DUPLICADA']); assert.equal(p.monetaryRegime, R.POS_REAL);
  assert.equal(one(rows, 'tier[5].winners').class, C.DADO_INVALIDO, 'ganhadores válidos: associação ambígua');
  noDiv(rows);
});

/* ---------- 5. duplicada com prêmio XLSX inválido ---------- */
test('5: faixa duplicada com prêmio XLSX inválido → VALOR_INVALIDO origem XLSX (não AMBOS); ambiguidade JSON registrada à parte', () => {
  const x = base(); const L = std(x); const ref5 = tierOf(x, 5).prize.ref; tierOf(x, 5).prize = BADM(tierOf(x, 5).prize);
  const rows = compareRecords(x, J(x, [...L, L[x.prizeTiers.findIndex(p => p.hits === 5)].replace('"faixa":', '"faixa":1')]), ctx);
  const p = one(rows, 'tier[5].prize'); assert.equal(p.class, C.VALOR_INVALIDO); assert.equal(p.invalidSource, 'XLSX');
  assert.equal(p.xlsxLiteral, 'R$ 1,2,3'); assert.equal(p.xlsxRef, ref5); assert.ok(ref5); assert.equal(p.xlsxInvalidReason, 'formato monetário não reconhecido'); assert.equal(p.jsonValid, true); assert.equal(p.jsonInvalidReason, null);
  assert.equal(p.jsonTierIssue.source, 'JSON'); noDiv(rows);
});

/* ---------- 6. duplicada com ganhadores inválidos ---------- */
test('6: faixa duplicada com ganhadores inválidos (JSON numa entrada / XLSX) → DADO_INVALIDO com a origem real da invalidez', () => {
  const x = base(); const L = std(x);
  const a = compareRecords(x, J(x, [...L, ent(5, -1, '1.00', 9)]), ctx);
  const w = one(a, 'tier[5].winners'); assert.equal(w.class, C.DADO_INVALIDO); assert.equal(w.invalidSource, 'JSON'); assert.equal(w.jsonInvalidReason, `[${L.length}] NEGATIVO`);
  assert.deepEqual(w.jsonEntries.map(e => e.winners.valid), [true, false]);
  const y = base(); const wref = tierOf(y, 5).winners.ref; tierOf(y, 5).winners = BADI(tierOf(y, 5).winners);
  const b = compareRecords(y, J(y, [...std(y), ent(5, 2, '1.00', 9)]), ctx);
  const wb = one(b, 'tier[5].winners'); assert.equal(wb.class, C.DADO_INVALIDO); assert.equal(wb.invalidSource, 'XLSX'); assert.equal(wb.xlsxLiteral, '-3'); assert.equal(wb.xlsxRef, wref); assert.ok(wref);
  noDiv(a.concat(b));
});

/* ---------- 7. evidência com apenas uma fonte inválida ---------- */
test('7: apenas uma fonte inválida → invalidSource dessa fonte; a outra com present/valid reais', () => {
  const x = base(); const L = std(x);
  const r = one(compareRecords(x, J(x, [...L, ent(5, 1, '"x"', 9)]), ctx), 'tier[5].prize');
  assert.deepEqual([r.invalidSource, r.xlsxPresent, r.xlsxValid, r.jsonPresent, r.jsonValid, r.xlsxInvalidReason], ['JSON', true, true, true, false, null]);
  const y = base(); tierOf(y, 4).prize = BADM(tierOf(y, 4).prize);
  const q = one(compareRecords(y, J(y, std(y)), ctx), 'tier[4].prize');
  assert.deepEqual([q.invalidSource, q.xlsxValid, q.jsonValid, q.jsonInvalidReason], ['XLSX', false, true, null]);
});

/* ---------- 8. evidência com as duas fontes inválidas ---------- */
test('8: ambas as fontes inválidas no mesmo campo → AMBOS com os dois motivos', () => {
  const x = base(); tierOf(x, 5).prize = BADM(tierOf(x, 5).prize);
  const r = one(compareRecords(x, J(x, [...std(x), ent(5, 1, '0.125', 9)]), ctx), 'tier[5].prize');
  assert.equal(r.class, C.VALOR_INVALIDO); assert.equal(r.invalidSource, 'AMBOS'); assert.equal(r.invalidReason, `XLSX: formato monetário não reconhecido; JSON: [${x.prizeTiers.length}] FRACAO_ALEM_DE_CENTAVOS`);
  const y = base(); tierOf(y, 5).winners = BADI(tierOf(y, 5).winners);
  const w = one(compareRecords(y, J(y, [...std(y), ent(5, '"k"', '1.00', 9)]), ctx), 'tier[5].winners'); assert.equal(w.invalidSource, 'AMBOS');
});

/* ---------- 9 e 10. dezenas XLSX: referências exatas de células ---------- */
test('9: dezenas XLSX duplicadas → células exatas (ref, coluna, literal, motivo, lado) em compareRecords()', () => {
  const x = base(); const nf = x.numberFields; nf[1] = { ...nf[1], value: nf[0].value, raw: String(nf[0].value) };
  const r = one(compareRecords(x, J(x, std(x)), ctx), 'numbers');
  assert.equal(r.class, C.DADO_INVALIDO); assert.equal(r.xlsxInvalidReason, 'DEZENA_DUPLICADA');
  assert.deepEqual(r.xlsxRefs, nf.map(b => b.ref)); assert.equal(r.xlsxCells.length, LOTTERIES.megasena.draw);
  assert.deepEqual(r.xlsxInvalidCells, [0, 1].map(i => ({ side: 'XLSX', index: i, ref: nf[i].ref, column: nf[i].column, raw: nf[i].raw, value: nf[0].value, reason: 'DEZENA_DUPLICADA', duplicateIndexes: [0, 1] })));
  assert.ok(nf[0].ref && nf[1].ref && nf[0].ref !== nf[1].ref);
});
test('10: dezenas XLSX fora do intervalo / célula ausente / célula inválida → células exatas; itens JSON inválidos com índice', () => {
  const x = base(); const nf = x.numberFields; nf[2] = { ...nf[2], value: 61, raw: '61' };
  const r = one(compareRecords(x, J(x, std(x)), ctx), 'numbers');
  assert.equal(r.xlsxInvalidReason, 'FORA_DO_INTERVALO_1_60');
  assert.deepEqual(r.xlsxInvalidCells, [{ side: 'XLSX', index: 2, ref: nf[2].ref, column: nf[2].column, raw: '61', value: 61, reason: 'FORA_DO_INTERVALO_1_60' }]);
  const y = base(); const g = y.numberFields; g[3] = { ...g[3], value: null, raw: '-', absent: true, absenceReason: 'DASH_CELL' }; g[4] = { ...g[4], value: null, raw: 'xx', valid: false, invalidReason: 'esperado inteiro ≥ 0' };
  const q = one(compareRecords(y, J(y, std(y)), ctx), 'numbers');
  assert.equal(q.xlsxInvalidReason, 'ITEM_NAO_INTEIRO'); assert.equal(q.invalidSource, 'XLSX');
  assert.deepEqual(q.xlsxInvalidCells.map(c => [c.index, c.ref, c.column, c.raw, c.reason]), [[3, g[3].ref, g[3].column, '-', 'CELULA_AUSENTE'], [4, g[4].ref, g[4].column, 'xx', 'CELULA_INVALIDA']]);
  assert.equal(q.xlsxInvalidCells[1].cellInvalidReason, 'esperado inteiro ≥ 0');
  const z = base(); const jl = `[${z.numbers.slice(1).map(n => `"${n}"`).join(',')},"99"]`;
  const jr = one(compareRecords(z, J(z, std(z), { listaDezenas: jl }), ctx), 'numbers');
  assert.equal(jr.invalidSource, 'JSON'); assert.deepEqual(jr.jsonInvalidItems, [{ side: 'JSON', index: 5, literal: '99', value: 99, reason: 'FORA_DO_INTERVALO_1_60' }]);
  assert.deepEqual(jr.xlsxInvalidCells, [], 'XLSX válido: nenhuma célula inválida'); assert.equal(jr.xlsxValid, true);
});

/* ---------- 11. caminho de classificação do script ---------- */
test('11: classificação do script (função pura, sem pasta privada): JSON_DADO_INVALIDO, JSON_SEM_RESULTADO, fluxo normal, JSON_INVALIDO', () => {
  assert.ok(S, 'módulo src/historical/reconcile-sample.js'); const { reconcileSample, classifyJsonContest, SAMPLE_STATUS: ST } = S;
  const x = base(); const recs = new Map([[x.contest, x]]); const meta = { lastContest: 99, xlsxObservedAt: '2026-01-01T00:00:00Z' };
  const sample = { lottery: 'megasena', origin: 'SINTETICO', url: 'https://synthetic.invalid/json', observedAt: '2026-01-02T00:00:00Z', file: '/nao/usado', justification: 'teste' };
  const run = text => reconcileSample({ sample, text, jsonSha256: 'd'.repeat(64), xlsxRecords: recs, meta });
  const body = o => `{${Object.entries({ numero: String(x.contest), dataApuracao: JSON.stringify(x.drawDate.split('-').reverse().join('/')), listaDezenas: `[${x.numbers.map(n => `"${n}"`).join(',')}]`, listaRateioPremio: `[${std(x).join(',')}]`, ...o }).filter(([, v]) => v !== undefined).map(([k, v]) => `"${k}":${v}`).join(',')}}`;
  for (const lit of ['-5', '0', '1.5', '"7"']) {
    const r = run(body({ numero: lit })); assert.equal(r.status, ST.JSON_DADO_INVALIDO, lit); assert.equal(r.entry.status, 'JSON_DADO_INVALIDO');
    assert.equal(r.entry.contest, null); assert.equal(r.entry.contestLiteral, lit.replace(/"/g, ''));
    assert.equal(one(r.rows, 'contest').class, C.DADO_INVALIDO); assert.equal(r.entry.classes.DADO_INVALIDO, 1); assert.equal(r.quarantine, null);
  }
  for (const lit of [undefined, 'null']) { const r = run(body({ numero: lit })); assert.equal(r.status, ST.JSON_SEM_RESULTADO); assert.equal(r.entry.status, 'JSON_SEM_RESULTADO'); assert.deepEqual(r.rows, []); assert.equal(r.entry.file, undefined); }
  const ok = run(body({})); assert.equal(ok.status, ST.VALIDO); assert.equal(ok.entry.xlsxStatus, 'ACEITO'); assert.equal(ok.entry.contest, x.contest); assert.equal(one(ok.rows, 'numbers').class, C.EQUIVALENTE); assert.equal(ok.quarantine, null);
  const div = run(body({ dataApuracao: '"01/01/1990"' })); assert.equal(div.status, ST.VALIDO); assert.ok(div.quarantine, 'divergência real segue para quarentena');
  const miss = run(body({ numero: '50' })); assert.equal(miss.entry.xlsxStatus, 'AUSENTE'); assert.equal(one(miss.rows, 'contest').class, C.AUSENTE);
  assert.equal(run('<html>desafio</html>').status, ST.JSON_INVALIDO);
  assert.equal(classifyJsonContest(adaptJsonResult('{"numero":3}')), ST.VALIDO); assert.equal(classifyJsonContest(adaptJsonResult('{}')), ST.JSON_SEM_RESULTADO); assert.equal(classifyJsonContest(adaptJsonResult('{"numero":-3}')), ST.JSON_DADO_INVALIDO);
});

/* ---------- 12. linha legada tier[k] + duas linhas por campo ---------- */
test('12: linha legada tier[k] coexiste com tier[k].winners e tier[k].prize (sem substituir nem suprimir)', () => {
  const x = base(); const t6 = tierOf(x, 6); t6.winners = ABS(t6.winners); t6.prize = ABS(t6.prize);
  const rows = compareRecords(x, J(x, std(x).filter((_, i) => ![4, 6].includes(x.prizeTiers[i].hits))), ctx);
  assert.equal(one(rows, 'tier[4]').class, C.SEMANTICA); assert.equal(one(rows, 'tier[4].winners').class, C.SEMANTICA); assert.equal(one(rows, 'tier[4].prize').class, C.SEMANTICA);
  assert.equal(one(rows, 'tier[6]').class, C.REPRESENTACAO); assert.equal(one(rows, 'tier[6].winners').class, C.AUSENTE); assert.equal(one(rows, 'tier[6].prize').class, C.AUSENTE);
  assert.equal(rows.filter(r => r.field === 'tier[5]').length, 0, 'faixa listada nas duas fontes: sem linha legada');
  noDiv(rows);
});

/* ---------- invariantes ---------- */
test('invariante: dois valores válidos e diferentes em POS_REAL seguem gerando DIVERGENCIA_REAL; hipóteses econômicas nunca', () => {
  const x = base(); const L = std(x); const i5 = x.prizeTiers.findIndex(p => p.hits === 5);
  L[i5] = ent(5, tierOf(x, 5).winners.value + 1, toLit(BigInt(tierOf(x, 5).prize.cents) + 1n), i5 + 1);
  const rows = compareRecords(x, J(x, L, { valorAcumuladoConcursoEspecial: '1.23' }), ctx);
  assert.equal(one(rows, 'tier[5].winners').class, C.DIVERGENCIA); assert.equal(one(rows, 'tier[5].prize').class, C.DIVERGENCIA);
  const sa = rows.find(r => r.field === 'economic.specialAccumulated'); if (sa) assert.notEqual(sa.class, C.DIVERGENCIA);
});
test('invariante: pré-Real intacto também em faixa duplicada (unidade não verificada; sem EQUIVALENTE nem DIVERGENCIA)', () => {
  const x = preReal(); const ts = x.prizeTiers.filter(p => !p.winners.absent && !p.prize.absent); const L = ts.map(entOf);
  const rows = compareRecords(x, J(x, [...L, entOf(ts[0], 8)]), ctx);
  const d = one(rows, `tier[${ts[0].hits}].prize`); assert.equal(d.class, C.DADO_INVALIDO); assert.equal(d.unidadeMonetariaVerificada, false); assert.equal(d.monetaryRegime, R.PRE_REAL);
  for (const r of rows.filter(q => /\.prize$|^economic\./.test(q.field))) { assert.notEqual(r.class, C.EQUIVALENTE, r.field); assert.equal(r.unidadeMonetariaVerificada, false, r.field); }
  noDiv(rows);
});
function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
test('propriedade: união completa (toda faixa de qualquer fonte tem exatamente uma linha winners e uma prize); inválido/ausente/duplicado nunca diverge; AMBOS só com os dois lados inválidos', () => {
  const rnd = prng(20261109); const pick = a => a[Math.floor(rnd() * a.length)]; const proto = base(); let dups = 0, unrec = 0;
  for (let it = 0; it < 300; it++) {
    const x = clone(proto); const L = []; const jHits = new Set(); const dupHits = new Set();
    for (const t of x.prizeTiers) {
      const st = pick(['ok', 'xinvp', 'xinvw', 'jinv', 'omit', 'dup', 'dupinv', 'xabs']);
      if (st === 'xinvp') t.prize = BADM(t.prize); if (st === 'xinvw') t.winners = BADI(t.winners); if (st === 'xabs') { t.prize = ABS(t.prize); t.winners = ABS(t.winners); }
      if (st === 'omit') continue;
      const w = t.winners.value ?? 0; const p = toLit(t.prize.cents ?? 100);
      L.push(st === 'jinv' ? ent(t.hits, pick(['-1', w]), pick(['0.125', p])) : ent(t.hits, w, p)); jHits.add(t.hits);
      if (st === 'dup' || st === 'dupinv') { L.push(ent(t.hits, st === 'dupinv' ? '-2' : w + 1, st === 'dupinv' ? '"x"' : p)); dupHits.add(t.hits); dups++; }
    }
    for (const h of [0, 1, 2, 3, 7]) if (rnd() < 0.2) { const n = rnd() < 0.3 ? 2 : 1; for (let k = 0; k < n; k++) L.push(ent(h, pick(['1', '-1']), pick(['1.00', '0.125']))); jHits.add(h); if (n > 1) dupHits.add(h); unrec++; }
    if (rnd() < 0.3) x.prizeTiers = x.prizeTiers.filter(t => t.hits !== 4);
    const rows = compareRecords(x, J(x, L.sort(() => rnd() - 0.5)), ctx);
    for (const h of new Set([...x.prizeTiers.map(t => t.hits), ...jHits])) { one(rows, `tier[${h}].winners`); one(rows, `tier[${h}].prize`); }
    for (const h of dupHits) for (const f of ['winners', 'prize']) { const r = one(rows, `tier[${h}].${f}`); assert.ok([C.DADO_INVALIDO, C.VALOR_INVALIDO, C.AUSENTE].includes(r.class)); assert.ok(r.jsonEntries.length >= 2); }
    for (const r of rows) {
      if (/INVALIDO/.test(r.class)) assert.ok(r.invalidSource, `${r.field} sem origem`);
      if (r.invalidSource === 'AMBOS') { assert.equal(r.xlsxValid, false, r.field); assert.equal(r.jsonValid, false, r.field); }
      if (r.class === C.DIVERGENCIA) assert.ok(r.field.startsWith('tier[') && !dupHits.has(Number(/\d+/.exec(r.field)[0])), 'divergência só em faixa única');
    }
    noDiv(rows.filter(r => r.jsonTierIssue || /INVALIDO|AUSENTE/.test(r.class)));
  }
  assert.ok(dups > 50 && unrec > 50);
});
