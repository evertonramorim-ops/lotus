// SYNTHETIC_DATA — auditoria integral, bloco 8: os 13 invariantes, um teste por invariante (PRNG semeado + Fisher–Yates).
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp, shuffle } from './_h.js';
import { prng, buildXlsx } from './_xlsx-writer.js';
import { runPipeline } from '../../src/historical/pipeline.js';
import { syntheticWorkbook, SYNTH_META } from './_xlsx-writer.js';
import { rawBytes } from '../../src/data/raw.js';
import { Q } from '../../src/historical/codes.js';
const R = await import('../../src/historical/reconcile.js');
const M = await import('../../src/historical/manifests.js');
const X = await import('../../src/xlsx/workbook.js');
const E = await import('../../src/xlsx/errors.js');
const S = await import('../../src/historical/reconcile-sample.js').catch(() => ({}));
const { adaptJsonResult, compareRecords, CLASSES: C } = R;

const MODS = ['megasena', 'lotofacil', 'quina', 'lotomania'];
const ctx = { xlsxLastContest: 99, xlsxObservedAt: '2026-01-01T00:00:00Z', jsonObservedAt: '2026-01-02T00:00:00Z', jsonSha256: 'c'.repeat(64), jsonUrl: 'https://synthetic.invalid/json' };
const clone = o => JSON.parse(JSON.stringify(o));
const pad = n => String(n).padStart(2, '0');
const toLit = c => { const s = String(c).padStart(3, '0'); return `${s.slice(0, -2)}.${s.slice(-2)}`; };
const rec = (l, seed = 3) => clone(imp(l, { seed, count: 3 }).accepted[0].record);
const ent = (h, w, p) => `{"descricaoFaixa":"${h} acertos","numeroDeGanhadores":${w},"valorPremio":${p}}`;
const std = x => x.prizeTiers.map(t => ent(t.hits, t.winners.value ?? 0, toLit(t.prize.cents ?? 100)));
const J = (x, over = {}, tiers = std(x)) => `{${Object.entries({ numero: String(x.contest), dataApuracao: JSON.stringify(x.drawDate.split('-').reverse().join('/')), listaDezenas: `[${x.numbers.map(n => `"${pad(n)}"`).join(',')}]`, listaRateioPremio: `[${tiers.join(',')}]`, ...over }).filter(([, v]) => v !== undefined).map(([k, v]) => `"${k}":${v}`).join(',')}}`;
const rows = (x, t) => compareRecords(x, adaptJsonResult(t), { ...ctx, lottery: x.lottery });
const one = (rs, f) => { const r = rs.filter(q => q.field === f); assert.equal(r.length, 1, f); return r[0]; };
const fwith = (row, header, h) => { const c = header.indexOf(h); const r = clone(row); const v = r[c]; r[c] = { f: 'SUM(1,2)', v: typeof v === 'object' ? v.v : String(v), t: typeof v === 'object' && v.t ? v.t : typeof v === 'string' ? 'str' : 'n' }; return r; };

test('invariante 1: nenhum registro válido é descartado por duplicata inválida (fórmula antes/depois, 4 modalidades)', () => {
  const rnd = prng(1);
  for (const l of MODS) for (let k = 0; k < 3; k++) {
    const r = imp(l, { seed: 7 + k, count: 8, mutate: ({ header, rows: rs }) => { const i = Math.floor(rnd() * rs.length); const extra = fwith(rs[i], header, 'Bola1'); return { header, rows: shuffle([...rs, extra], rnd) }; } });
    assert.equal(r.accepted.length, 8, `${l}: todos os 8 concursos válidos aceitos`);
  }
});

test('invariante 2: cabeçalho mapeado duplicado nunca é aceito silenciosamente', () => {
  for (const l of MODS) { const r = imp(l, { seed: 2, count: 3, mutate: ({ header, rows: rs }) => ({ header: [...header, 'Concurso'], rows: rs.map(x => [...x, x[0]]) }) }); assert.equal(r.status, 'REJECTED', l); assert.equal(r.accepted.length, 0); }
});

test('invariante 3: nenhuma lacuna causa crescimento descontrolado', () => {
  const t = Date.now(); const r = imp('lotofacil', { seed: 1, count: 2, startContest: 5000000000000 });
  assert.ok(Date.now() - t < 5000); assert.equal(r.gapRanges.length, 1); assert.equal(r.quarantine.filter(q => q.reasons[0].code === Q.CONCURSO_AUSENTE).length, 1);
});

test('invariante 4: nenhum manifesto passa sem verificar o conteúdo real', () => {
  const r = runPipeline({ inputs: MODS.map(l => ({ lottery: l, bytes: syntheticWorkbook(l, { seed: 5 }), meta: SYNTH_META(l) })), runId: 'i4', createdAt: '2026-01-01T00:00:00Z' });
  for (const res of r.results) {
    const m = r.run.modality.find(x => x.lottery === res.lottery).manifest;
    assert.ok(M.verifyModalityManifest(m, res.imp, res.collection, rawBytes(res.envelope)).ok);
    assert.equal(M.verifyModalityManifest(m, res.imp, res.collection, null).ok, false, 'sem bytes');
    const alt2 = { ...res.imp, accepted: res.imp.accepted.map((a, i) => (i === 0 ? { record: { ...a.record, numbers: [...a.record.numbers].reverse() } } : a)) };
    assert.equal(M.verifyModalityManifest(m, alt2, res.collection, rawBytes(res.envelope)).ok, false, 'conteúdo alterado');
  }
});

test('invariante 5: nenhuma ordem de sorteio estruturalmente impossível é aceita', () => {
  const rnd = prng(5);
  for (const l of MODS) {
    const x = rec(l); const o = shuffle(x.numbers, rnd).map(pad);
    for (const bad of [[...o.slice(1), o[0], o[0]], o.slice(1), [...o.slice(1), '999'], [...o.slice(1), '-1']]) {
      const r = one(rows(x, J(x, { dezenasSorteadasOrdemSorteio: `[${bad.map(v => `"${v}"`).join(',')}]` })), 'drawOrder'); assert.equal(r.class, C.DADO_INVALIDO, `${l} ${bad}`);
    }
  }
});

test('invariante 6: JSON sem contraparte XLSX continua validado', () => {
  for (const l of MODS) { const x = rec(l); const r = compareRecords(null, adaptJsonResult(J(x, { listaDezenas: '"x"' })), { ...ctx, lottery: l }); assert.equal(one(r, 'numbers').class, C.DADO_INVALIDO, l); }
});

test('invariante 7: objeto JSON externo não é tomado como token numérico', () => {
  const x = rec('quina'); const j = adaptJsonResult(J(x, { numero: '{"$number":"1"}', valorArrecadado: '{"$number":"1.00"}' }));
  assert.equal(j.contest, null); assert.equal(j.contestField.valid, false); assert.equal(j.economicMoney.totalCollected.valid, false);
});

test('invariante 8: hipótese nunca é apresentada como equivalência confirmada', () => {
  const x = rec('megasena'); x.economic.accumulatedTopTier = { ...x.economic.totalCollected };
  const r = one(rows(x, J(x, { valorAcumuladoProximoConcurso: toLit(x.economic.totalCollected.cents) })), 'economic.accumulatedTopTier');
  assert.equal(r.class, C.SEMANTICA); assert.equal(r.correspondence, 'HIPOTESE'); assert.equal(r.numericCoincidence, true);
  const w = rec('megasena'); w.winnerLocations = { ...w.winnerLocations, text: 'CIDADE/UF', absent: false };
  const rw = one(rows(w, J(w, { listaMunicipioUFGanhadores: '[{"municipio":"CIDADE","uf":"UF"}]' })), 'winnerLocations'); assert.notEqual(rw.class, C.EQUIVALENTE);
});

test('invariante 9: valor inválido nunca vira ausência', () => {
  const x = rec('lotofacil');
  for (const [k, v, f] of [['valorArrecadado', '"12,00"', 'economic.totalCollected'], ['valorArrecadado', '{}', 'economic.totalCollected'], ['observacao', '5', 'observation'], ['listaDezenas', '7', 'numbers'], ['listaMunicipioUFGanhadores', '"x"', 'winnerLocations']]) assert.notEqual(one(rows(x, J(x, { [k]: v })), f).class, C.AUSENTE, `${k}=${v}`);
  const t = x.prizeTiers[0]; const rs = rows(x, J(x, {}, [ent(t.hits, '"3"', '"1,00"'), ...std(x).slice(1)]));
  assert.notEqual(one(rs, `tier[${t.hits}].winners`).class, C.AUSENTE); assert.notEqual(one(rs, `tier[${t.hits}].prize`).class, C.AUSENTE);
});

test('invariante 10: correspondência ambígua nunca vira divergência real', () => {
  for (const l of MODS) { const x = rec(l); const t = x.prizeTiers[0]; const rs = rows(x, J(x, {}, [...std(x), ent(t.hits, 999, '12345.67')])); assert.ok(!rs.some(r => r.class === C.DIVERGENCIA), l); }
});

test('invariante 11: evidência preserva literal, índice, origem, tipo e motivo', () => {
  const x = rec('megasena'); const rs = rows(x, J(x, {}, [...std(x), ent(2, '-1', '0.125')]));
  const w = one(rs, 'tier[2].winners'); const e = w.jsonEntries[0];
  assert.equal(e.origin, 'JSON'); assert.equal(e.index, x.prizeTiers.length); assert.equal(e.winners.literal, '-1'); assert.equal(e.winners.type, 'number'); assert.ok(e.winners.invalidReason); assert.ok(w.classificationReason);
  const n = one(rows(x, J(x, { listaDezenas: '["01","01","02","03","04",{"a":1}]' })), 'numbers'); assert.ok(n.jsonInvalidItems.every(i => 'index' in i && 'literal' in i && 'type' in i && i.reason && i.side === 'JSON'));
});

test('invariante 12: nenhum erro estrutural causa exceção nativa fora do tratamento controlado', () => {
  for (const t of ['null', '[]', '"x"', '1', 'true', '{', '', '{"listaRateioPremio":[null,1,"x",[],{"descricaoFaixa":{}}]}', '{"numero":{"$number":"1"},"listaDezenas":[[]],"dezenasSorteadasOrdemSorteio":{}}']) {
    try { const j = adaptJsonResult(t); compareRecords(null, j, { ...ctx, lottery: 'quina' }); compareRecords(rec('quina'), j, { ...ctx, lottery: 'quina' }); }
    catch (e) { assert.ok(e instanceof R.JsonSchemaError || e instanceof SyntaxError || e instanceof RangeError, `${t}: ${e.name}`); }
    if (S.reconcileSample) assert.doesNotThrow(() => S.reconcileSample({ sample: { lottery: 'quina', url: 'https://synthetic.invalid/', observedAt: ctx.jsonObservedAt }, text: t, jsonSha256: 'a'.repeat(64), xlsxRecords: new Map(), meta: { lastContest: 1, xlsxObservedAt: ctx.xlsxObservedAt } }), t);
  }
  const good = buildXlsx({ sheetName: 'S', header: ['A'], rows: [[1]] }); const rnd = prng(12);
  for (let i = 0; i < 200; i++) { const b = good.slice(); for (let k = 0; k < 3; k++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256); try { X.parseXlsx(b); } catch (e) { assert.ok(e instanceof E.XlsxError, `${e.name}: ${e.message}`); } }
});

test('invariante 13: classificações independem da ordem física das linhas e das faixas', () => {
  const rnd = prng(13);
  for (const l of MODS) {
    const mk = ord => imp(l, { seed: 4, count: 9, mutate: ({ header, rows: rs }) => { const all = [...rs, clone(rs[3]), fwith(rs[5], header, 'Bola2')]; return { header, rows: ord ? ord(all) : all }; } });
    const sig = r => JSON.stringify([r.accepted.map(a => a.record.contest).sort((a, b) => a - b), r.quarantine.flatMap(q => q.reasons.map(x => x.code)).sort(), r.duplicatesIdentical.map(d => d.contest).sort()]);
    const b = sig(mk(null)); for (let i = 0; i < 3; i++) assert.equal(sig(mk(a => shuffle(a, rnd))), b, l);
    const x = rec(l); const L = [...std(x), ent(x.prizeTiers[0].hits, 1, '1.00')];
    const s = rs => rs.map(r => `${r.field}=${r.class}`).sort().join(); const a = s(rows(x, J(x, {}, L)));
    for (let i = 0; i < 3; i++) assert.equal(s(rows(x, J(x, {}, shuffle(L, rnd)))), a, l);
  }
});
