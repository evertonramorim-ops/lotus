// SYNTHETIC_DATA — auditoria consolidada da reconciliação XLSX × JSON: matriz completa de presença/validade por
// fonte, validação estrutural JSON, faixas independentes, regime monetário e propriedade global. Offline e determinístico.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp } from './_h.js';
import { adaptJsonResult, compareRecords, monetaryRegime, MONETARY_REGIME as R, CLASSES as C } from '../../src/historical/reconcile.js';
import { LOTTERIES } from '../../src/lotteries/config.js';

const ctx = { xlsxLastContest: 99, xlsxObservedAt: '2026-01-01T00:00:00Z', jsonObservedAt: '2026-01-02T00:00:00Z', jsonSha256: 'c'.repeat(64), jsonUrl: 'https://synthetic.invalid/json' };
const toLit = c => { const s = String(c).padStart(3, '0'); return `${s.slice(0, -2)}.${s.slice(-2)}`; };
const clone = o => JSON.parse(JSON.stringify(o));
const ABS = m => ({ ...m, cents: null, value: null, iso: null, absent: true, absenceReason: 'DASH_CELL', raw: '-', valid: m.valid });
const BADM = (m, raw = 'R$ 1,2,3') => ({ ...m, cents: null, raw, absent: false, valid: false, ref: m.ref ?? 'Z9', column: m.column ?? 'col sintética', invalidReason: 'formato monetário não reconhecido' });
const BADI = (m, raw = '-3') => ({ ...m, value: null, raw, absent: false, valid: false, ref: m.ref ?? 'Z8', column: m.column ?? 'col sintética', invalidReason: 'esperado inteiro ≥ 0' });
const KEYS = { totalCollected: 'valorArrecadado', nextPrizeEstimate: 'valorEstimadoProximoConcurso', specialAccumulated: 'valorAcumuladoConcursoEspecial', accumulatedTopTier: 'valorAcumuladoProximoConcurso' };
const ECON = Object.keys(KEYS);
/** JSON SYNTHETIC_DATA: cada chave recebe um fragmento JSON literal; `undefined` remove a chave. */
function J(rec, over = {}, tierOver = {}) {
  const tiers = rec.prizeTiers.map((x, i) => {
    const o = { descricaoFaixa: JSON.stringify(`${x.hits} acertos`), faixa: String(i + 1), numeroDeGanhadores: String(x.winners.value ?? 0), valorPremio: toLit(x.prize.cents ?? 100), ...(tierOver[x.hits] || {}) };
    return `{${Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `"${k}":${v}`).join(',')}}`;
  });
  const o = { numero: String(rec.contest), dataApuracao: JSON.stringify(rec.drawDate.split('-').reverse().join('/')), listaDezenas: `[${rec.numbers.map(n => `"${String(n).padStart(2, '0')}"`).join(',')}]`, listaRateioPremio: `[${tiers.join(',')}]` };
  for (const k of ECON) o[KEYS[k]] = rec.economic[k] && rec.economic[k].cents !== null ? toLit(rec.economic[k].cents) : '1.00';
  Object.assign(o, over);
  return adaptJsonResult(`{${Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `"${k}":${v}`).join(',')}}`);
}
/** Registro pós-Real com os quatro campos econômicos presentes e válidos. */
function base() {
  const x = clone(imp('megasena', { seed: 21, count: 3 }).accepted[0].record); assert.ok(x.drawDate >= '1994-07-01');
  for (const k of ECON) if (!x.economic[k] || x.economic[k].absent || !x.economic[k].valid) x.economic[k] = { cents: '12345', raw: 'R$123,45', absent: false, absenceReason: null, valid: true, ref: 'Y1', column: k };
  return x;
}
const preReal = () => clone(imp('quina', { seed: 5, count: 3, startDate: Date.UTC(1994, 2, 13) }).accepted[0].record);
const one = (rows, f) => { const r = rows.filter(q => q.field === f); assert.equal(r.length, 1, `exatamente uma linha ${f}: ${r.length}`); return r[0]; };
const noDiv = rows => assert.deepEqual(rows.filter(q => q.class === C.DIVERGENCIA).map(q => q.field), []);
const tierOf = (x, h) => x.prizeTiers.find(p => p.hits === h);

/* ---------------- matriz monetária (prêmio de faixa) ---------------- */
const moneyCases = [
  ['1 XLSX inválido × JSON válido', t => { t.prize = BADM(t.prize); }, {}, C.VALOR_INVALIDO, 'XLSX'],
  ['2 XLSX válido × JSON inválido', () => {}, { valorPremio: '0.125' }, C.VALOR_INVALIDO, 'JSON'],
  ['3 ambos inválidos', t => { t.prize = BADM(t.prize); }, { valorPremio: '"x"' }, C.VALOR_INVALIDO, 'AMBOS'],
  ['4 XLSX inválido × JSON ausente', t => { t.prize = BADM(t.prize); }, { valorPremio: undefined }, C.VALOR_INVALIDO, 'XLSX'],
  ['5 XLSX ausente × JSON inválido', t => { t.prize = ABS(t.prize); }, { valorPremio: '1e999999999' }, C.VALOR_INVALIDO, 'JSON'],
  ['6 ambos ausentes', t => { t.prize = ABS(t.prize); }, { valorPremio: 'null' }, C.AUSENTE, null],
  ['7 ambos válidos e iguais', () => {}, {}, C.EQUIVALENTE, null],
  ['8 ambos válidos e diferentes', t => {}, { valorPremio: '0.01' }, C.DIVERGENCIA, null],
];
for (const [name, mx, jo, cls, src] of moneyCases) test(`monetário ${name} → ${cls}${src ? ` (${src})` : ''}`, () => {
  const x = base(); const t = tierOf(x, 5); mx(t); if (name.startsWith('8') && t.prize.cents === '1') t.prize.cents = '2';
  const rows = compareRecords(x, J(x, {}, { 5: jo }), ctx); const r = one(rows, 'tier[5].prize');
  assert.equal(r.class, cls); assert.equal(r.invalidSource ?? null, src);
  if (src) {
    const xi = src !== 'JSON', ji = src !== 'XLSX';
    assert.equal(r.xlsxValid, xi ? false : (r.xlsxPresent ? true : null)); assert.equal(r.jsonValid, ji ? false : (r.jsonPresent ? true : null));
    if (xi) { assert.equal(r.xlsxLiteral, 'R$ 1,2,3'); assert.ok(r.xlsxRef && r.xlsxColumn && r.xlsxInvalidReason); }
    if (ji) assert.ok(r.jsonLiteral && r.jsonInvalidReason);
    if (src === 'AMBOS') assert.match(r.invalidReason, /^XLSX: .+; JSON: .+$/);
  }
  assert.equal(one(rows, 'tier[5].winners').class, C.EQUIVALENTE, 'ganhadores independentes do prêmio');
  if (cls !== C.DIVERGENCIA) noDiv(rows);
});

test('monetário 9: faixa só no XLSX com prêmio inválido → VALOR_INVALIDO XLSX em linha própria; ganhadores com linha própria', () => {
  const x = base(); const t = tierOf(x, 4); t.prize = BADM(t.prize);
  const j = J({ ...x, prizeTiers: x.prizeTiers.filter(p => p.hits !== 4) });
  const rows = compareRecords(x, j, ctx);
  const p = one(rows, 'tier[4].prize'); assert.equal(p.class, C.VALOR_INVALIDO); assert.equal(p.invalidSource, 'XLSX');
  assert.equal(p.xlsxPresent, true); assert.equal(p.xlsxValid, false); assert.equal(p.jsonPresent, false); assert.equal(p.jsonValid, null);
  assert.equal(one(rows, 'tier[4].winners').class, C.SEMANTICA);
  assert.equal(one(rows, 'tier[4]').class, C.SEMANTICA, 'linha de listagem preservada (semântica documentada)');
  noDiv(rows);
});

test('monetário 10: faixa só no JSON com prêmio inválido → VALOR_INVALIDO JSON; XLSX present:false valid:null', () => {
  const x = base();
  const rows = compareRecords(x, J(x, { listaRateioPremio: `[${x.prizeTiers.map((t, i) => `{"descricaoFaixa":"${t.hits} acertos","faixa":${i + 1},"numeroDeGanhadores":${t.winners.value},"valorPremio":${toLit(t.prize.cents)}}`).join(',')},{"descricaoFaixa":"3 acertos","faixa":9,"numeroDeGanhadores":-1,"valorPremio":0.125}]` }), ctx);
  const p = one(rows, 'tier[3].prize'); assert.equal(p.class, C.VALOR_INVALIDO); assert.equal(p.invalidSource, 'JSON'); assert.equal(p.xlsxPresent, false); assert.equal(p.xlsxValid, null);
  const w = one(rows, 'tier[3].winners'); assert.equal(w.class, C.DADO_INVALIDO); assert.equal(w.jsonInvalidReason, 'NEGATIVO');
  noDiv(rows);
});

test('faixa só no XLSX: ganhadores inválidos → DADO_INVALIDO; células "-" → linhas AUSENTE + listagem REPRESENTACAO', () => {
  const x = base(); tierOf(x, 4).winners = BADI(tierOf(x, 4).winners); const t6 = tierOf(x, 6); t6.winners = ABS(t6.winners); t6.prize = ABS(t6.prize);
  const rows = compareRecords(x, J({ ...x, prizeTiers: x.prizeTiers.filter(p => p.hits === 5) }), ctx);
  assert.equal(one(rows, 'tier[4].winners').class, C.DADO_INVALIDO); assert.equal(one(rows, 'tier[4].prize').class, C.SEMANTICA);
  assert.equal(one(rows, 'tier[6].winners').class, C.AUSENTE); assert.equal(one(rows, 'tier[6].prize').class, C.AUSENTE); assert.equal(one(rows, 'tier[6]').class, C.REPRESENTACAO);
});

/* ---------------- evidência de presença/validade ---------------- */
test('invalidEvidence: ausente → present:false/valid:null; válido → true/true; inválido → true/false (por fonte)', () => {
  const x = base(); tierOf(x, 5).prize = BADM(tierOf(x, 5).prize);
  const a = one(compareRecords(x, J(x, {}, { 5: { valorPremio: undefined } }), ctx), 'tier[5].prize');
  assert.deepEqual([a.xlsxPresent, a.xlsxValid, a.jsonPresent, a.jsonValid], [true, false, false, null]);
  const b = one(compareRecords(x, J(x), ctx), 'tier[5].prize');
  assert.deepEqual([b.xlsxPresent, b.xlsxValid, b.jsonPresent, b.jsonValid], [true, false, true, true]);
  const y = base(); tierOf(y, 5).prize = ABS(tierOf(y, 5).prize);
  const c = one(compareRecords(y, J(y, {}, { 5: { valorPremio: '"z"' } }), ctx), 'tier[5].prize');
  assert.deepEqual([c.xlsxPresent, c.xlsxValid, c.jsonPresent, c.jsonValid, c.invalidSource], [false, null, true, false, 'JSON']);
});

/* ---------------- matriz econômica: cada um dos 4 campos × estados nas duas fontes ---------------- */
const XS = { valido: m => m, ausente: m => ABS(m), invalido: m => BADM(m, '??'), coluna_inexistente: () => undefined };
const JS = { valido: c => toLit(c), ausente: () => undefined, nulo: () => 'null', invalido: () => '0.125', texto: () => '"12,00"', diferente: c => toLit(BigInt(c) + 1n) };
for (const k of ECON) for (const [xn, xf] of Object.entries(XS)) for (const [jn, jf] of Object.entries(JS)) {
  test(`econômico ${k}: XLSX ${xn} × JSON ${jn}`, () => {
    const x = base(); const cents = x.economic[k].cents; x.economic[k] = xf(x.economic[k]); if (x.economic[k] === undefined) delete x.economic[k];
    const rows = compareRecords(x, J(x, { [KEYS[k]]: jf(cents) }), ctx); const f = `economic.${k}`;
    const xInv = xn === 'invalido'; const jInv = jn === 'invalido' || jn === 'texto'; const jAbs = jn === 'ausente' || jn === 'nulo';
    const hyp = k === 'specialAccumulated' || k === 'accumulatedTopTier';
    if (xn === 'coluna_inexistente' && jAbs) { assert.equal(rows.filter(r => r.field === f).length, 0); return; }
    const r = one(rows, f);
    const xPres = xn === 'valido' || xn === 'invalido'; const jPres = !jAbs;
    if (xInv || jInv) { assert.deepEqual([r.xlsxPresent, r.xlsxValid, r.jsonPresent, r.jsonValid], [xPres, xPres ? !xInv : null, jPres, jPres ? !jInv : null], 'presença/validade por fonte'); assert.equal(r.class, C.VALOR_INVALIDO); assert.equal(r.invalidSource, xInv && jInv ? 'AMBOS' : xInv ? 'XLSX' : 'JSON'); if (xInv) assert.equal(r.xlsxLiteral, '??'); if (jInv) assert.ok(r.jsonLiteral); }
    else if (xn !== 'valido' || jAbs) assert.equal(r.class, C.AUSENTE);
    else if (jn === 'diferente') assert.equal(r.class, hyp ? C.SEMANTICA : C.DIVERGENCIA);
    // [3b.2-integral 3.5 — expectativa antiga demonstradamente incorreta] correspondência HIPOTESE (campo XLSX ↔ chave
    // JSON não documentada) nunca é EQUIVALENTE, mesmo com valores coincidentes: SEMANTICA_DESCONHECIDA, coincidência
    // registrada à parte (numericCoincidence).
    else if (hyp) { assert.equal(r.class, C.SEMANTICA); assert.equal(r.correspondence, 'HIPOTESE'); assert.equal(r.numericCoincidence, true); }
    else assert.equal(r.class, C.EQUIVALENTE);
    if (jn !== 'diferente') noDiv(rows);
  });
}

/* ---------------- estruturais ---------------- */
test('concurso JSON: ausente / negativo / zero / decimal / texto / fora do inteiro seguro → nunca válido', () => {
  const x = base();
  for (const [lit, reason] of [['-5', 'NEGATIVO'], ['0', 'MENOR_QUE_1'], ['1.5', 'NAO_INTEIRO'], ['1e3', 'NAO_INTEIRO'], ['"12"', 'TIPO_NAO_NUMERICO'], ['9007199254740993', 'FORA_DO_INTEIRO_SEGURO'], ['true', 'TIPO_NAO_NUMERICO']]) {
    const j = J(x, { numero: lit }); assert.equal(j.contest, null, lit); assert.equal(j.contestField.valid, false); assert.equal(j.contestField.invalidReason, reason, lit);
    const a = one(compareRecords(null, j, ctx), 'contest'); assert.equal(a.class, C.DADO_INVALIDO, `sem XLSX: ${lit}`); assert.equal(a.jsonInvalidReason, reason);
    const b = one(compareRecords(x, j, ctx), 'contest'); assert.equal(b.class, C.DADO_INVALIDO); assert.equal(b.invalidSource, 'JSON');
  }
  const ab = J(x, { numero: undefined }); assert.equal(ab.contestField.present, false); assert.equal(ab.contestField.valid, null);
  assert.equal(one(compareRecords(x, ab, ctx), 'contest').class, C.AUSENTE);
});

test('data JSON: ausente / nula / válida / malformada / inexistente / tipo incorreto', () => {
  const x = base();
  assert.equal(one(compareRecords(x, J(x), ctx), 'drawDate').class, C.EQUIVALENTE);
  for (const lit of [undefined, 'null']) { const r = one(compareRecords(x, J(x, { dataApuracao: lit }), ctx), 'drawDate'); assert.equal(r.class, C.AUSENTE); }
  for (const [lit, reason] of [['"31/02/2001"', 'DATA_MALFORMADA_OU_INEXISTENTE'], ['"2001-02-03"', 'DATA_MALFORMADA_OU_INEXISTENTE'], ['""', 'DATA_MALFORMADA_OU_INEXISTENTE'], ['20010203', 'TIPO_NAO_TEXTO'], ['["01/01/2001"]', 'TIPO_NAO_TEXTO']]) {
    const r = one(compareRecords(x, J(x, { dataApuracao: lit }), ctx), 'drawDate'); assert.equal(r.class, C.DADO_INVALIDO, lit); assert.equal(r.jsonInvalidReason, reason); assert.equal(r.jsonPresent, true); assert.equal(r.jsonValid, false);
  }
});

test('dezenas JSON: ausente / não lista / vazia / item inválido (sem NaN) / duplicada / fora do intervalo / quantidade errada', () => {
  const x = base(); const L = LOTTERIES.megasena; const ok = x.numbers.map(n => `"${n}"`);
  assert.equal(one(compareRecords(x, J(x, { listaDezenas: undefined }), ctx), 'numbers').class, C.AUSENTE);
  const cases = [['"01,02"', 'TIPO_NAO_LISTA'], ['[]', 'LISTA_VAZIA'], [`[${ok.slice(1).join(',')},"x"]`, 'ITEM_NAO_INTEIRO'], [`[${ok.slice(1).join(',')},{"a":1}]`, 'ITEM_NAO_INTEIRO'],
    [`[${ok.slice(1).join(',')},${ok[1]}]`, 'DEZENA_DUPLICADA'], [`[${ok.slice(1).join(',')},"${L.maxNumber + 1}"]`, `FORA_DO_INTERVALO_${L.minNumber}_${L.maxNumber}`], [`[${ok.slice(1).join(',')}]`, `QUANTIDADE_${L.draw - 1}_ESPERADO_${L.draw}`]];
  for (const [lit, reason] of cases) {
    const j = J(x, { listaDezenas: lit }); assert.ok(!(j.numbers || []).some(Number.isNaN));
    const r = one(compareRecords(x, j, ctx), 'numbers'); assert.equal(r.class, C.DADO_INVALIDO, lit); assert.equal(r.jsonInvalidReason, reason); assert.equal(r.invalidSource, 'JSON');
  }
  const d = x.numbers.map((n, i) => (i === 0 ? (n === 1 ? 2 : 1) : n)); if (new Set(d).size === d.length) assert.equal(one(compareRecords(x, J(x, { listaDezenas: `[${d.map(n => `"${n}"`).join(',')}]` }), ctx), 'numbers').class, C.DIVERGENCIA, 'duas listas válidas diferentes ainda divergem');
});

test('ganhadores: ausente / negativo / decimal / texto / fora do inteiro seguro nos dois lados', () => {
  const x = base();
  for (const [lit, reason] of [['-1', 'NEGATIVO'], ['1.5', 'NAO_INTEIRO'], ['"3"', 'TIPO_NAO_NUMERICO'], ['9007199254740993', 'FORA_DO_INTEIRO_SEGURO']]) {
    const r = one(compareRecords(x, J(x, {}, { 5: { numeroDeGanhadores: lit } }), ctx), 'tier[5].winners'); assert.equal(r.class, C.DADO_INVALIDO, lit); assert.equal(r.jsonInvalidReason, reason);
  }
  assert.equal(one(compareRecords(x, J(x, {}, { 5: { numeroDeGanhadores: undefined } }), ctx), 'tier[5].winners').class, C.AUSENTE);
  for (const raw of ['-2', '1,5', 'abc', '99999999999999999']) {
    const y = base(); tierOf(y, 5).winners = BADI(tierOf(y, 5).winners, raw);
    const r = one(compareRecords(y, J(y), ctx), 'tier[5].winners'); assert.equal(r.class, C.DADO_INVALIDO); assert.equal(r.invalidSource, 'XLSX'); assert.equal(r.xlsxLiteral, raw);
    assert.equal(one(compareRecords(y, J(y), ctx), 'tier[5].prize').class, C.EQUIVALENTE, 'prêmio comparado à parte');
  }
  const z = base(); tierOf(z, 5).winners = BADI(tierOf(z, 5).winners);
  const r = one(compareRecords(z, J(z, {}, { 5: { numeroDeGanhadores: '"q"' } }), ctx), 'tier[5].winners'); assert.equal(r.invalidSource, 'AMBOS');
});

test('listaRateioPremio: ausente / nula / não-array / descrição inválida / duplicada → estrutura explícita, sem falsas ausências ou divergências', () => {
  const x = base();
  for (const lit of [undefined, 'null']) {
    const rows = compareRecords(x, J(x, { listaRateioPremio: lit }), ctx);
    assert.equal(one(rows, 'json:listaRateioPremio').class, C.AUSENTE);
    for (const t of x.prizeTiers) { assert.equal(one(rows, `tier[${t.hits}].winners`).class, C.AUSENTE); assert.equal(one(rows, `tier[${t.hits}].prize`).class, C.AUSENTE); assert.equal(rows.filter(r => r.field === `tier[${t.hits}]`).length, 0); }
    noDiv(rows);
  }
  const na = compareRecords(x, J(x, { listaRateioPremio: '{"descricaoFaixa":"6 acertos"}' }), ctx);
  assert.equal(one(na, 'json:listaRateioPremio').class, C.DADO_INVALIDO);
  for (const t of x.prizeTiers) assert.equal(one(na, `tier[${t.hits}].prize`).class, C.SEMANTICA); noDiv(na);
  const tl = x.prizeTiers.map((t, i) => `{"descricaoFaixa":"${t.hits} acertos","faixa":${i + 1},"numeroDeGanhadores":${t.winners.value},"valorPremio":${toLit(t.prize.cents)}}`);
  const bad = compareRecords(x, J(x, { listaRateioPremio: `[${tl.slice(1).join(',')},{"descricaoFaixa":"Sena!","valorPremio":1},7]` }), ctx);
  const s = bad.find(r => r.field === 'json:listaRateioPremio'); assert.equal(s.class, C.DADO_INVALIDO); assert.equal(s.unmapped.length, 2); assert.match(s.unmapped[0].element, /Sena!/);
  const missing = x.prizeTiers[0].hits; assert.equal(one(bad, `tier[${missing}].winners`).class, C.SEMANTICA, 'ausência não conclusiva com entradas não mapeadas'); noDiv(bad);
  const dup = compareRecords(x, J(x, { listaRateioPremio: `[${tl.join(',')},${tl[0].replace(/"numeroDeGanhadores":\d+/, '"numeroDeGanhadores":999')}]` }), ctx);
  const ds = dup.find(r => r.field === 'json:listaRateioPremio'); assert.equal(ds.duplicates.length, 1);
  assert.equal(one(dup, `tier[${missing}].winners`).class, C.DADO_INVALIDO); assert.equal(one(dup, `tier[${missing}].prize`).class, C.DADO_INVALIDO); noDiv(dup);
  const un = compareRecords(x, J(x, { listaRateioPremio: `[${tl.join(',')},{"descricaoFaixa":"2 acertos","faixa":9,"numeroDeGanhadores":1,"valorPremio":1.00}]` }), ctx);
  assert.equal(un.find(r => r.field === 'json:listaRateioPremio').unrecognized[0].hits, 2);
  // [3b.2-integral 2.1 — expectativa antiga demonstradamente incorreta] "2 acertos" fora da configuração atual, período
  // RULE_NOT_VERIFIED → SEMANTICA_DESCONHECIDA (não AUSENTE).
  assert.equal(one(un, 'tier[2].prize').class, C.SEMANTICA); noDiv(un);
});

test('registro XLSX em quarentena com data ou dezenas inválidas → DADO_INVALIDO (origem XLSX), nunca DIVERGENCIA_REAL', () => {
  const r = imp('megasena', { seed: 21, count: 3 }); const x = clone(r.accepted[0].record);
  const q1 = clone(x); q1.drawDate = null; q1.drawDateField = { ...q1.drawDateField, iso: null, raw: '32/13/2001', absent: false, valid: false, invalidReason: 'data inexistente' };
  const rows1 = compareRecords(q1, J(x), ctx); const d = one(rows1, 'drawDate'); assert.equal(d.class, C.DADO_INVALIDO); assert.equal(d.invalidSource, 'XLSX'); assert.equal(d.xlsxLiteral, '32/13/2001');
  for (const t of q1.prizeTiers) assert.notEqual(one(rows1, `tier[${t.hits}].prize`).class, C.EQUIVALENTE, 'regime desconhecido');
  noDiv(rows1);
  const q2 = clone(x); q2.numbers = null; q2.numberFields[0] = { ...q2.numberFields[0], value: null, raw: 'xx', valid: false, absent: false };
  const n = one(compareRecords(q2, J(x), ctx), 'numbers'); assert.equal(n.class, C.DADO_INVALIDO); assert.equal(n.invalidSource, 'XLSX');
  const q3 = clone(x); q3.numberFields[1] = { ...q3.numberFields[1], value: q3.numberFields[0].value, raw: String(q3.numberFields[0].value) };
  assert.equal(one(compareRecords(q3, J(x), ctx), 'numbers').xlsxInvalidReason, 'DEZENA_DUPLICADA');
  const q4 = clone(x); q4.numberFields[2] = { ...q4.numberFields[2], value: LOTTERIES.megasena.maxNumber + 1 };
  assert.match(one(compareRecords(q4, J(x), ctx), 'numbers').xlsxInvalidReason, /^FORA_DO_INTERVALO/);
});

/* ---------------- regime monetário ---------------- */
test('regime: função monetaryRegime cobre as combinações de datas', () => {
  assert.equal(monetaryRegime('2001-01-01', '2001-01-01').regime, R.POS_REAL);
  assert.equal(monetaryRegime('1994-06-30', '1994-06-30').regime, R.PRE_REAL);
  assert.equal(monetaryRegime('1994-07-01', '1994-07-01').regime, R.POS_REAL);
  assert.deepEqual(monetaryRegime(null, '2001-01-01'), { regime: R.DESCONHECIDO, reason: 'DATA_XLSX_AUSENTE_OU_INVALIDA' });
  assert.deepEqual(monetaryRegime('2001-01-01', null), { regime: R.DESCONHECIDO, reason: 'DATA_JSON_AUSENTE_OU_INVALIDA' });
  assert.equal(monetaryRegime('2001-01-01', '2001-01-02').reason, 'DATAS_DIVERGENTES');
  assert.equal(monetaryRegime('1994-06-30', '1994-07-01').reason, 'DATAS_EM_LADOS_OPOSTOS_DE_1994_07_01');
});

const allMoney = rows => rows.filter(r => /\.prize$|^economic\./.test(r.field));
const regimeCase = (name, mut, jover, expect) => test(`regime ${name}`, () => {
  const x = expect.pre ? preReal() : base(); const j0 = J(x, jover); mut(x);
  const rows = compareRecords(x, j0, ctx);
  const valid = allMoney(rows).filter(r => ![C.AUSENTE, C.VALOR_INVALIDO].includes(r.class));
  assert.ok(valid.length >= 3);
  for (const r of valid) { assert.equal(r.class, C.SEMANTICA, r.field); assert.equal(r.unidadeMonetariaVerificada, false); assert.equal(r.monetaryRegime, expect.regime); assert.ok(r.xlsxLiteral && r.jsonLiteral); }
  for (const r of allMoney(rows)) { assert.equal(r.unidadeMonetariaVerificada, false); assert.ok('xlsxDrawDate' in r && 'jsonDrawDate' in r); }
  noDiv(allMoney(rows));
});
regimeCase('pré-Real válido nos dois lados → PRE_REAL_NAO_VERIFICADA', () => {}, {}, { pre: true, regime: R.PRE_REAL });
regimeCase('data XLSX inválida → DESCONHECIDO', x => { x.drawDate = null; x.drawDateField = { ...x.drawDateField, iso: null, raw: '99/99/2001', valid: false, absent: false }; }, {}, { regime: R.DESCONHECIDO });
regimeCase('data XLSX ausente → DESCONHECIDO', x => { x.drawDate = null; x.drawDateField = { ...x.drawDateField, iso: null, raw: null, absent: true, valid: false }; }, {}, { regime: R.DESCONHECIDO });
regimeCase('data JSON ausente → DESCONHECIDO', () => {}, { dataApuracao: undefined }, { regime: R.DESCONHECIDO });
regimeCase('data JSON inválida → DESCONHECIDO', () => {}, { dataApuracao: '"30/02/2010"' }, { regime: R.DESCONHECIDO });
regimeCase('datas divergentes no mesmo concurso → DESCONHECIDO', () => {}, { dataApuracao: '"01/01/2011"' }, { regime: R.DESCONHECIDO });
regimeCase('datas em lados opostos de 01/07/1994 → DESCONHECIDO', () => {}, { dataApuracao: '"30/06/1994"' }, { regime: R.DESCONHECIDO });

test('regime: pré-Real com dinheiro ausente ou inválido preserva a classe + unidadeMonetariaVerificada:false; sem 0,7', () => {
  const x = preReal(); const ts = x.prizeTiers.filter(p => !p.winners.absent && !p.prize.absent); const j = J(x);
  ts[0].prize = BADM(ts[0].prize); ts[1].prize = ABS(ts[1].prize);
  const rows = compareRecords(x, j, ctx);
  const a = one(rows, `tier[${ts[0].hits}].prize`); assert.equal(a.class, C.VALOR_INVALIDO); assert.equal(a.unidadeMonetariaVerificada, false); assert.equal(a.monetaryRegime, R.PRE_REAL);
  const b = one(rows, `tier[${ts[1].hits}].prize`); assert.equal(b.class, C.SEMANTICA); assert.equal(b.unidadeMonetariaVerificada, false); assert.match(b.note, /ausente/);
  for (const r of allMoney(rows)) assert.notEqual(r.class, C.EQUIVALENTE);
});

test('regime POS_REAL: linhas monetárias marcam monetaryRegime e não marcam unidade não verificada', () => {
  const x = base(); const r = one(compareRecords(x, J(x), ctx), 'tier[5].prize'); assert.equal(r.monetaryRegime, R.POS_REAL); assert.equal(r.unidadeMonetariaVerificada, undefined);
});

/* ---------------- propriedade global (determinística, PRNG semeado) ---------------- */
function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
test('propriedade: entrada inválida/ausente nunca gera DIVERGENCIA_REAL; dois valores válidos diferentes sempre geram', () => {
  const rnd = prng(20261104); const pick = a => a[Math.floor(rnd() * a.length)];
  const proto = base(); let divSeen = 0;
  for (let it = 0; it < 400; it++) {
    const x = clone(proto); const expectDiv = new Set(); const jover = {}; const tov = {};
    for (const t of x.prizeTiers) {
      const ps = pick(['ok', 'diff', 'xinv', 'xabs', 'jinv', 'jabs', 'both']); const ws = pick(['ok', 'diff', 'xinv', 'jinv', 'jabs', 'xabs']); const o = {};
      if (ps === 'diff') { o.valorPremio = toLit(BigInt(t.prize.cents) + 7n); expectDiv.add(`tier[${t.hits}].prize`); }
      if (ps === 'xinv' || ps === 'both') t.prize = BADM(t.prize); if (ps === 'xabs') t.prize = ABS(t.prize);
      if (ps === 'jinv' || ps === 'both') o.valorPremio = pick(['0.125', '"1,00"', '1e999999999', 'true']); if (ps === 'jabs') o.valorPremio = pick([undefined, 'null']);
      if (ws === 'diff') { o.numeroDeGanhadores = String(t.winners.value + 1); expectDiv.add(`tier[${t.hits}].winners`); }
      if (ws === 'xinv') t.winners = BADI(t.winners); if (ws === 'xabs') t.winners = ABS(t.winners);
      if (ws === 'jinv') o.numeroDeGanhadores = pick(['-1', '1.5', '"2"', '9007199254740993']); if (ws === 'jabs') o.numeroDeGanhadores = undefined;
      tov[t.hits] = o;
    }
    for (const k of ECON) {
      const s = pick(['ok', 'diff', 'xinv', 'jinv', 'jabs', 'xabs']); const c = x.economic[k].cents;
      if (s === 'diff') { jover[KEYS[k]] = toLit(BigInt(c) + 3n); if (k === 'totalCollected' || k === 'nextPrizeEstimate') expectDiv.add(`economic.${k}`); }
      if (s === 'xinv') x.economic[k] = BADM(x.economic[k]); if (s === 'xabs') x.economic[k] = ABS(x.economic[k]);
      if (s === 'jinv') jover[KEYS[k]] = pick(['0.001', '"x"', '[1]']); if (s === 'jabs') jover[KEYS[k]] = undefined;
    }
    const ns = pick(['ok', 'diff', 'jinv', 'jabs']);
    if (ns === 'jinv') jover.listaDezenas = pick(['[]', '"1"', `[${x.numbers.slice(1).map(n => `"${n}"`).join(',')},"x"]`, `[${x.numbers.slice(1).map(n => `"${n}"`).join(',')},"${x.numbers[1]}"]`]);
    if (ns === 'jabs') jover.listaDezenas = undefined;
    if (ns === 'diff') { const free = [...Array(60).keys()].map(i => i + 1).find(n => !x.numbers.includes(n)); jover.listaDezenas = `[${[free, ...x.numbers.slice(1)].map(n => `"${n}"`).join(',')}]`; expectDiv.add('numbers'); }
    const ds = pick(['ok', 'ok', 'jinv', 'jabs', 'diff']);
    if (ds === 'jinv') jover.dataApuracao = pick(['"31/04/2005"', '5', '"x"']); if (ds === 'jabs') jover.dataApuracao = 'null';
    if (ds === 'diff') { jover.dataApuracao = '"01/01/1990"'; expectDiv.add('drawDate'); }
    if (ds !== 'ok') for (const f of [...expectDiv]) if (/prize$|^economic/.test(f)) expectDiv.delete(f); // regime não POS_REAL: sem conclusão financeira
    const cs = pick(['ok', 'ok', 'jinv']); if (cs === 'jinv') jover.numero = pick(['-1', '0', '2.5', '"7"']);
    const rows = compareRecords(x, J(x, jover, tov), ctx);
    const got = new Set(rows.filter(r => r.class === C.DIVERGENCIA).map(r => r.field)); divSeen += got.size;
    assert.deepEqual([...got].sort(), [...expectDiv].sort(), `iteração ${it}`);
    for (const r of rows) if (/INVALIDO/.test(r.class)) assert.ok(r.invalidSource, `${r.field} sem origem`);
  }
  assert.ok(divSeen > 100, 'propriedade exercitou divergências reais');
});
