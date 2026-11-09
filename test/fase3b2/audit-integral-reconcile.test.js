// SYNTHETIC_DATA — auditoria integral da Fase 3b.2, blocos 2 e 3 (reconciliação e validação independente do JSON).
// Cada teste reproduz um defeito apontado na auditoria; imports dinâmicos permitem medir "falha antes" contra f8f970d.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp, shuffle } from './_h.js';
import { prng } from './_xlsx-writer.js';
import { LOTTERIES } from '../../src/lotteries/config.js';
const R = await import('../../src/historical/reconcile.js');
const N = await import('../../src/historical/jsonnum.js');
const S = await import('../../src/historical/reconcile-sample.js').catch(() => ({}));
const { adaptJsonResult, compareRecords, CLASSES: C } = R;

const ctx = { xlsxLastContest: 99, xlsxObservedAt: '2026-01-01T00:00:00Z', jsonObservedAt: '2026-01-02T00:00:00Z', jsonSha256: 'c'.repeat(64), jsonUrl: 'https://synthetic.invalid/json' };
const clone = o => JSON.parse(JSON.stringify(o));
const toLit = c => { const s = String(c).padStart(3, '0'); return `${s.slice(0, -2)}.${s.slice(-2)}`; };
const MODS = ['megasena', 'lotofacil', 'quina', 'lotomania'];
const rec = (l, seed = 3) => clone(imp(l, { seed, count: 3 }).accepted[0].record);
const pad = n => String(n).padStart(2, '0');
const ent = (h, w, p, extra = '') => `{"descricaoFaixa":"${h} acertos"${extra},"numeroDeGanhadores":${w},"valorPremio":${p}}`;
const std = x => x.prizeTiers.map((t, i) => ent(t.hits, t.winners.value ?? 0, toLit(t.prize.cents ?? 100), `,"faixa":${i + 1}`));
function J(x, over = {}, tiers = std(x)) {
  const o = { numero: String(x.contest), dataApuracao: JSON.stringify(x.drawDate.split('-').reverse().join('/')), listaDezenas: `[${x.numbers.map(n => `"${pad(n)}"`).join(',')}]`, listaRateioPremio: `[${tiers.join(',')}]`, ...over };
  return `{${Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `"${k}":${v}`).join(',')}}`;
}
const cmp = (x, text) => compareRecords(x, adaptJsonResult(text), { ...ctx, lottery: x ? x.lottery : undefined });
const one = (rows, f) => { const r = rows.filter(q => q.field === f); assert.equal(r.length, 1, `exatamente uma linha ${f}: ${r.length}`); return r[0]; };
const noDiv = rows => assert.deepEqual(rows.filter(q => q.class === C.DIVERGENCIA).map(q => q.field), []);
// faixas fora da configuração atual (sem regra histórica comprovada) e impossíveis (acertos > dezenas sorteadas)
const OUTSIDE = { megasena: 3, lotofacil: 10, quina: 1, lotomania: 14 };
const IMPOSSIBLE = { megasena: 7, lotofacil: 16, quina: 6, lotomania: 21 };

/* ---------- 2.1 faixas ---------- */
test('2.1: faixa fora da configuração atual sem regra histórica comprovada → SEMANTICA_DESCONHECIDA nas 4 modalidades, regra consultada registrada', () => {
  for (const l of MODS) {
    const x = rec(l); const h = OUTSIDE[l];
    const rows = cmp(x, J(x, {}, [...std(x), ent(h, 2, '3.00', ',"faixa":9')]));
    for (const f of ['winners', 'prize']) {
      const r = one(rows, `tier[${h}].${f}`); assert.equal(r.class, C.SEMANTICA, `${l} ${f}`);
      assert.equal(r.tierRule.status, R.TIER_STATUS.DESCONHECIDA, l); assert.equal(r.tierRule.verificationStatus, 'RULE_NOT_VERIFIED', 'período não verificado não é promovido');
      assert.ok(r.tierRule.ruleSet && r.tierRule.period, 'regra consultada'); assert.deepEqual(r.tierRule.configPrizeTiers, LOTTERIES[l].prizeTiers);
      assert.equal(r.classificationReason, 'FAIXA_FORA_DA_CONFIGURACAO_ATUAL_SEM_REGRA_HISTORICA_COMPROVADA');
      const e = r.jsonEntries[0]; assert.equal(e.origin, 'JSON'); assert.equal(e.index, x.prizeTiers.length); assert.equal(e.description, `${h} acertos`); assert.equal(e.hits, h);
      assert.equal(e.faixa, '9'); assert.equal(e.winners.literal, '2'); assert.equal(e.prize.literal, '3.00'); assert.equal(e.prize.type, 'number'); assert.equal(e.prize.valid, true);
    }
    noDiv(rows);
  }
});

test('2.1: faixa prevista na configuração (ambas as fontes) → comparação normal; real ausência no XLSX → AUSENTE_EM_UMA_FONTE', () => {
  for (const l of MODS) {
    const x = rec(l); const rows = cmp(x, J(x)); const both = x.prizeTiers.filter(t => !t.winners.absent && t.winners.valid !== false); assert.ok(both.length > 0);
    for (const t of both) { const r = one(rows, `tier[${t.hits}].winners`); assert.equal(r.class, C.EQUIVALENTE, `${l} ${t.hits}`); assert.equal(r.tierRule.status, R.TIER_STATUS.PREVISTA); }
    const h = both[0].hits; const x2 = clone(x); x2.prizeTiers = x2.prizeTiers.filter(t => t.hits !== h);
    const r2 = cmp(x2, J(x)); assert.equal(one(r2, `tier[${h}].winners`).class, C.AUSENTE, l); assert.equal(one(r2, `tier[${h}].winners`).tierRule.status, R.TIER_STATUS.PREVISTA);
  }
});

test('2.1/2.2: acertos acima das dezenas sorteadas → impossibilidade matemática (DADO_INVALIDO), separada da incerteza histórica', () => {
  for (const l of MODS) {
    const x = rec(l); const h = IMPOSSIBLE[l]; const rows = cmp(x, J(x, {}, [...std(x), ent(h, 1, '1.00')]));
    const r = one(rows, `tier[${h}].prize`); assert.equal(r.class, C.DADO_INVALIDO, l); assert.equal(r.tierRule.status, R.TIER_STATUS.IMPOSSIVEL);
    assert.notEqual(r.tierRule.status, R.TIER_STATUS.DESCONHECIDA); noDiv(rows);
  }
});

test('2.1: faixa desconhecida com prêmio inválido → VALOR_INVALIDO; ganhadores inválidos → DADO_INVALIDO (valor prevalece)', () => {
  const x = rec('quina'); const rows = cmp(x, J(x, {}, [...std(x), ent(1, '-4', '0.125')]));
  assert.equal(one(rows, 'tier[1].prize').class, C.VALOR_INVALIDO); assert.equal(one(rows, 'tier[1].winners').class, C.DADO_INVALIDO);
  assert.equal(one(rows, 'tier[1].winners').jsonEntries[0].winners.literal, '-4'); noDiv(rows);
});

/* ---------- 2.2 descricaoFaixa / faixa ---------- */
test('2.2: descricaoFaixa com acertos fora do inteiro seguro → entrada não mapeada com literal e motivo (sem conversão imprecisa)', () => {
  const x = rec('megasena'); const big = '99999999999999999999';
  const j = adaptJsonResult(J(x, {}, [...std(x), ent(big, 1, '1.00')]));
  const u = j.tierList.unmapped; assert.equal(u.length, 1); assert.equal(u[0].reason, 'ACERTOS_FORA_DO_INTEIRO_SEGURO'); assert.equal(u[0].descriptionField.hitsLiteral, big); assert.equal(u[0].descriptionField.hits, null);
  assert.match(u[0].element, /99999999999999999999 acertos/); assert.ok(!j.tierEntries.some(e => String(e.hits).startsWith('1000')), 'nenhum hits aproximado');
  const s = one(compareRecords(x, j, ctx), 'json:listaRateioPremio'); assert.equal(s.class, C.DADO_INVALIDO);
  for (const [d, why] of [['"x acertos"', 'DESCRICAO_FAIXA_NAO_RECONHECIDA'], ['5', 'DESCRICAO_FAIXA_TIPO_NAO_TEXTO'], [null, 'DESCRICAO_FAIXA_AUSENTE']]) {
    const e = d === null ? '{"numeroDeGanhadores":1,"valorPremio":1.00}' : `{"descricaoFaixa":${d},"numeroDeGanhadores":1,"valorPremio":1.00}`;
    const jj = adaptJsonResult(J(x, {}, [...std(x), e])); assert.equal(jj.tierList.unmapped[0].reason, why, String(d)); assert.equal(jj.tierList.unmapped[0].element, e, 'elemento preservado fielmente');
  }
});

test('2.2: faixa presente / ausente / nula / tipo errado distinguidas; valor inválido preservado, sem intervalo inventado', () => {
  const x = rec('megasena');
  const f = extra => adaptJsonResult(J(x, {}, [ent(6, 0, '0.00', extra), ...std(x).slice(1)])).tierEntries[0].faixaField;
  assert.deepEqual([f(',"faixa":1').state, f(',"faixa":1').valid, f(',"faixa":1').value], ['PRESENTE', true, 1]);
  assert.deepEqual([f('').state, f('').valid], ['AUSENTE', null]);
  assert.deepEqual([f(',"faixa":null').state, f(',"faixa":null').valid], ['NULO', null]);
  const s = f(',"faixa":"2"'); assert.deepEqual([s.state, s.type, s.literal, s.valid, s.invalidReason], ['PRESENTE', 'string', '2', false, 'TIPO_NAO_NUMERICO']);
  const g = f(',"faixa":1.5'); assert.equal(g.valid, false); assert.equal(g.literal, '1.5');
  const big = f(',"faixa":999999'); assert.equal(big.valid, true, 'sem intervalo inventado para "faixa"');
});

/* ---------- 2.3 duplicatas ---------- */
test('2.3: faixa duplicada — ganhadores e prêmio avaliados separadamente; nenhuma entrada desaparece; ambiguidade nunca vira DIVERGENCIA_REAL', () => {
  for (const l of MODS) {
    const x = rec(l); const t = x.prizeTiers[x.prizeTiers.length - 1]; const h = t.hits;
    const rows = cmp(x, J(x, {}, [...std(x), ent(h, '-1', '7.00')]));
    const w = one(rows, `tier[${h}].winners`); const p = one(rows, `tier[${h}].prize`);
    assert.equal(w.class, C.DADO_INVALIDO); assert.equal(w.invalidSource, 'JSON'); assert.equal(p.class, C.DADO_INVALIDO); assert.equal(p.invalidReason, 'FAIXA_DUPLICADA_ASSOCIACAO_AMBIGUA');
    assert.equal(w.jsonEntries.length, 2); assert.deepEqual(w.jsonEntries.map(e => e.winners.valid), [true, false]); assert.deepEqual(p.jsonEntries.map(e => e.prize.valid), [true, true]);
    assert.notEqual(p.invalidSource, 'AMBOS'); noDiv(rows);
  }
});

/* ---------- 2.4 ordem de sorteio ---------- */
test('2.4: dezenasSorteadasOrdemSorteio validada (tipo, quantidade, inteiro, intervalo, duplicata) e coerente com listaDezenas, nas 4 modalidades', () => {
  for (const l of MODS) {
    const x = rec(l); const ord = shuffle(x.numbers, prng(7)).map(pad); const lit = a => `[${a.map(v => `"${v}"`).join(',')}]`;
    const ok = one(cmp(x, J(x, { dezenasSorteadasOrdemSorteio: lit(ord) })), 'drawOrder');
    assert.equal(ok.class, C.AUSENTE); assert.deepEqual(ok.jsonSequence, ord, 'ordem original preservada'); assert.equal(ok.setCoherenceChecked, true);
    const rules = LOTTERIES[l]; const other = Array.from({ length: rules.maxNumber - rules.minNumber + 1 }, (_, i) => i + rules.minNumber).find(v => !x.numbers.includes(v));
    const mis = one(cmp(x, J(x, { dezenasSorteadasOrdemSorteio: lit([...ord.slice(1), pad(other)]) })), 'drawOrder');
    assert.equal(mis.class, C.DADO_INVALIDO, l); assert.equal(mis.invalidReason, 'ORDEM_INCONSISTENTE_COM_LISTA_DEZENAS'); assert.deepEqual(mis.onlyInDrawOrder, [other]);
    for (const bad of [lit(ord.slice(1)), lit([ord[0], ...ord.slice(0, -1)]), lit([...ord.slice(1), String(rules.maxNumber + 1)]), lit([...ord.slice(1), '1.5']), '"texto"', '{"a":1}', lit([...ord.slice(1), '99999999999999999999'])]) {
      const r = one(cmp(x, J(x, { dezenasSorteadasOrdemSorteio: bad })), 'drawOrder'); assert.equal(r.class, C.DADO_INVALIDO, `${l} ${bad}`);
    }
    for (const [v, st] of [[undefined, 'AUSENTE'], ['null', 'NULO']]) assert.equal(one(cmp(x, J(x, { dezenasSorteadasOrdemSorteio: v })), 'drawOrder').jsonState, st);
  }
  const lm = rec('lotomania', 11); if (!lm.numbers.includes(0)) { lm.numbers = [0, ...lm.numbers.slice(1)].sort((a, b) => a - b); }
  const r = one(cmp(lm, J(lm, { dezenasSorteadasOrdemSorteio: `[${[...lm.numbers].reverse().map(n => `"${pad(n)}"`).join(',')}]` })), 'drawOrder');
  assert.equal(r.class, C.AUSENTE, 'Lotomania "00" é dezena válida'); assert.ok(r.jsonSequence.includes('00'));
});

/* ---------- 3.1 JSON sem contraparte XLSX ---------- */
test('3.1: JSON sem registro XLSX (x null) é validado por inteiro: dezenas, data, faixas, dinheiro — inclusive concurso posterior e mapa vazio', () => {
  for (const l of MODS) {
    const x = rec(l); const nums = x.numbers.map(pad); nums[1] = nums[0];
    const text = J(x, { listaDezenas: `[${nums.map(v => `"${v}"`).join(',')}]`, dataApuracao: '"31/02/2001"', valorArrecadado: '0.125' }, [...std(x), ent(x.prizeTiers[0].hits, '-1', '1.00')]);
    for (const c of [{ ...ctx, lottery: l }, { ...ctx, lottery: l, xlsxLastContest: 0 }]) {
      const rows = compareRecords(null, adaptJsonResult(text), c);
      assert.equal(one(rows, 'numbers').class, C.DADO_INVALIDO, l); assert.equal(one(rows, 'drawDate').class, C.DADO_INVALIDO);
      assert.equal(one(rows, 'economic.totalCollected').class, C.VALOR_INVALIDO); assert.equal(one(rows, `tier[${x.prizeTiers[0].hits}].winners`).class, C.DADO_INVALIDO);
      assert.equal(one(rows, 'numbers').xlsx, '<registro inexistente no XLSX>'); noDiv(rows);
    }
    const good = compareRecords(null, adaptJsonResult(J(x)), { ...ctx, lottery: l }); assert.ok(!good.some(q => q.class === C.DADO_INVALIDO || q.class === C.VALOR_INVALIDO), l);
  }
  if (S.reconcileSample) {
    const x = rec('megasena'); const sample = { lottery: 'megasena', origin: 'SINTETICO', url: 'https://synthetic.invalid/j', observedAt: '2026-01-02T00:00:00Z', justification: 't' };
    const r = S.reconcileSample({ sample, text: J(x, { numero: '500', listaDezenas: '["01","01","02","03","04","05"]' }), jsonSha256: 'e'.repeat(64), xlsxRecords: new Map(), meta: { lastContest: 99, xlsxObservedAt: ctx.xlsxObservedAt } });
    assert.equal(one(r.rows, 'contest').class, C.TEMPORAL); assert.equal(one(r.rows, 'numbers').class, C.DADO_INVALIDO, 'concurso posterior + mapa vazio: JSON validado');
  } else assert.fail('reconcileSample indisponível');
});

/* ---------- 3.2 sintaxe × esquema ---------- */
test('3.2: JSON_INVALIDO (sintaxe/tamanho) separado de JSON_SCHEMA_INVALIDO (raiz null/array/texto/número); concurso ausente × nulo', () => {
  assert.ok(S.reconcileSample && S.SAMPLE_STATUS.JSON_SCHEMA_INVALIDO, 'estado JSON_SCHEMA_INVALIDO existe');
  const run = text => S.reconcileSample({ sample: { lottery: 'quina', origin: 'S', url: 'https://synthetic.invalid/j', observedAt: ctx.jsonObservedAt, justification: 't' }, text, jsonSha256: 'f'.repeat(64), xlsxRecords: new Map(), meta: { lastContest: 9, xlsxObservedAt: ctx.xlsxObservedAt } });
  for (const [t, type] of [['null', 'null'], ['[]', 'array'], ['"x"', 'string'], ['5', 'number'], ['true', 'boolean']]) { const r = run(t); assert.equal(r.status, 'JSON_SCHEMA_INVALIDO', t); assert.equal(r.entry.rootType, type); }
  for (const t of ['{', '<html>', '']) { const r = run(t); assert.equal(r.status, 'JSON_INVALIDO', t); assert.equal(r.entry.errorKind, 'SINTAXE'); }
  assert.throws(() => adaptJsonResult('null'), R.JsonSchemaError); assert.throws(() => adaptJsonResult('[1]'), R.JsonSchemaError);
  assert.equal(run('{}').entry.contestState, 'AUSENTE'); assert.equal(run('{"numero":null}').entry.contestState, 'NULO');
});

/* ---------- 3.3 marcador numérico e bytes ---------- */
test('3.3: objeto {"$number":…} do JSON externo NÃO é token numérico (concurso, dezenas, dinheiro, faixa, ganhadores, serialização)', () => {
  const x = rec('megasena'); const fake = v => `{"$number":"${v}"}`;
  const j = adaptJsonResult(J(x, { numero: fake(x.contest), valorArrecadado: fake('10.00') }, [ent(6, fake(1), fake('1.00'), `,"faixa":${fake(1)}`), ...std(x).slice(1)]));
  assert.equal(j.contestField.valid, false); assert.equal(j.contestField.type, 'object'); assert.equal(j.contest, null);
  assert.equal(j.economicMoney.totalCollected.valid, false); assert.equal(j.tierEntries[0].winnersField.valid, false); assert.equal(j.tierEntries[0].prizeMoney.valid, false); assert.equal(j.tierEntries[0].faixaField.valid, false);
  assert.match(j.tierEntries[0].element, /"valorPremio":\{"\$number":"1\.00"\}/, 'serialização fiel do objeto externo');
  const n = adaptJsonResult(J(x, { listaDezenas: `[${fake(1)},"02","03","04","05","06"]` })); assert.equal(n.numbersField.items[0].type, 'object'); assert.equal(n.numbersField.items[0].value, null);
  const rows = compareRecords(x, j, ctx); assert.equal(one(rows, 'economic.totalCollected').class, C.VALOR_INVALIDO); noDiv(rows);
  const t = N.parseJsonPreservingNumbers('{"a":1.50,"b":{"$number":"2"}}'); assert.equal(N.isNum(t.a), true); assert.equal(N.isNum(t.b), false); assert.equal(N.toJsonText(t), '{"a":1.50,"b":{"$number":"2"}}');
});

test('3.3: maxBytes conta bytes UTF-8 reais (multibyte), não unidades de código', () => {
  assert.equal(N.utf8ByteLength('é'), 2); assert.equal(N.utf8ByteLength('€'), 3); assert.equal(N.utf8ByteLength('😀'), 4); assert.equal(N.utf8ByteLength('a'.repeat(10)), 10);
  const txt = `"${'é'.repeat(10)}"`; // 12 unidades de código, 22 bytes
  assert.throws(() => N.parseJsonPreservingNumbers(txt, { maxBytes: 15 }), RangeError); assert.doesNotThrow(() => N.parseJsonPreservingNumbers(txt, { maxBytes: 22 }));
  assert.equal(N.utf8ByteLength(txt), Buffer.byteLength(txt, 'utf8'));
});

/* ---------- 3.4 campos conhecidos com tipo errado ---------- */
test('3.4: tipoJogo, observacao, listaMunicipioUFGanhadores, listas e dinheiro com tipo errado → DADO_INVALIDO/VALOR_INVALIDO (nunca ausência)', () => {
  const x = rec('megasena');
  const cases = [['tipoJogo', '7', 'tipoJogo', C.DADO_INVALIDO], ['observacao', '5', 'observation', C.DADO_INVALIDO], ['observacao', '{"a":1}', 'observation', C.DADO_INVALIDO], ['listaMunicipioUFGanhadores', '"x"', 'winnerLocations', C.DADO_INVALIDO], ['listaMunicipioUFGanhadores', '5', 'winnerLocations', C.DADO_INVALIDO],
    ['listaDezenas', '"01 02"', 'numbers', C.DADO_INVALIDO], ['listaDezenas', '{}', 'numbers', C.DADO_INVALIDO], ['valorArrecadado', '"12,00"', 'economic.totalCollected', C.VALOR_INVALIDO], ['valorArrecadado', 'true', 'economic.totalCollected', C.VALOR_INVALIDO], ['listaRateioPremio', '{}', 'json:listaRateioPremio', C.DADO_INVALIDO]];
  for (const [k, v, f, cls] of cases) {
    const rows = cmp(x, J(x, { [k]: v })); const r = one(rows, f); assert.equal(r.class, cls, `${k}=${v}`); assert.notEqual(r.class, C.AUSENTE); noDiv(rows);
  }
  const j = adaptJsonResult(J(x, { observacao: '5', listaMunicipioUFGanhadores: '"x"' }));
  assert.deepEqual([j.observationField.state, j.observationField.type, j.observationField.literal, j.observationField.invalidReason], ['PRESENTE', 'number', '5', 'TIPO_NAO_TEXTO']);
  assert.deepEqual([j.winnerLocationsField.type, j.winnerLocationsField.valid, j.winnerLocationsField.invalidReason], ['string', false, 'TIPO_NAO_LISTA']);
  for (const [v, st] of [[undefined, 'AUSENTE'], ['null', 'NULO']]) { const jj = adaptJsonResult(J(x, { observacao: v })); assert.equal(jj.observationField.state, st); assert.equal(one(compareRecords(x, jj, ctx), 'observation').class === C.DADO_INVALIDO, false); }
  const el = adaptJsonResult(J(x, { listaMunicipioUFGanhadores: '[1,{"x":2},"t"]' })).winnerLocationsField; assert.equal(el.valid, true, 'sem esquema de elemento inventado'); assert.equal(el.count, 3);
});

/* ---------- 3.5 hipóteses ---------- */
test('3.5: correspondência HIPOTESE nunca EQUIVALENTE nem DIVERGENCIA_REAL — coincidência registrada à parte', () => {
  const x = rec('megasena'); x.economic.accumulatedTopTier = { ...x.economic.totalCollected }; x.economic.specialAccumulated = { ...x.economic.totalCollected };
  const v = toLit(x.economic.totalCollected.cents);
  for (const [lit, coinc] of [[v, true], [toLit(BigInt(x.economic.totalCollected.cents) + 7n), false]]) {
    const rows = cmp(x, J(x, { valorAcumuladoProximoConcurso: lit, valorAcumuladoConcursoEspecial: lit }));
    for (const f of ['economic.accumulatedTopTier', 'economic.specialAccumulated']) { const r = one(rows, f); assert.equal(r.class, C.SEMANTICA, f); assert.equal(r.correspondence, 'HIPOTESE'); assert.equal(r.numericCoincidence, coinc); }
    noDiv(rows);
  }
});

/* ---------- invariantes 8–11, 13 (propriedade, PRNG semeado + Fisher–Yates) ---------- */
test('invariantes: hipótese ≠ equivalência; inválido ≠ ausência; ambíguo ≠ divergência; evidência com literal/índice/origem/tipo; independe da ordem física das faixas', () => {
  const rnd = prng(424242);
  for (let it = 0; it < 120; it++) {
    const l = MODS[it % 4]; const x = rec(l, 1 + (it % 5)); const L = std(x);
    if (rnd() < 0.4) L.push(ent(OUTSIDE[l], rnd() < 0.5 ? '1' : '-1', rnd() < 0.5 ? '1.00' : '0.125'));
    if (rnd() < 0.4) L.push(ent(x.prizeTiers[0].hits, '2', '9.99'));
    if (rnd() < 0.2) L.push('{"descricaoFaixa":7,"numeroDeGanhadores":1,"valorPremio":1.00}');
    const a = cmp(x, J(x, {}, L)); const b = cmp(x, J(x, {}, shuffle(L, rnd)));
    const sig = rows => rows.filter(r => /^tier\[/.test(r.field)).map(r => `${r.field}=${r.class}`).sort();
    assert.deepEqual(sig(a), sig(b), 'classificação independe da ordem física');
    noDiv(a); noDiv(b);
    for (const r of a) {
      if (r.correspondence === 'HIPOTESE') assert.notEqual(r.class, C.EQUIVALENTE);
      if (r.jsonEntries) for (const e of r.jsonEntries) { assert.equal(e.origin, 'JSON'); assert.ok(Number.isInteger(e.index)); assert.ok('literal' in e.prize && 'type' in e.prize); }
      if ((r.jsonValid === false || r.xlsxValid === false) && /^tier\[|^economic\.|^numbers$/.test(r.field)) assert.notEqual(r.class, C.AUSENTE, `${r.field} inválido nunca vira ausência`);
    }
  }
});
