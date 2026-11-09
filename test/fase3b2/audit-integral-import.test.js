// SYNTHETIC_DATA — auditoria integral, bloco 4: duplicatas com fórmula, cabeçalho mapeado duplicado, lacunas em intervalos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp, shuffle } from './_h.js';
import { prng } from './_xlsx-writer.js';
import { Q } from '../../src/historical/codes.js';
import { getXlsxAdapter } from '../../src/historical/adapters/index.js';
const V = await import('../../src/historical/validators.js');

const MODS = ['megasena', 'lotofacil', 'quina', 'lotomania'];
const clone = o => JSON.parse(JSON.stringify(o));
const codes = r => r.quarantine.flatMap(q => q.reasons.map(x => x.code)).sort();
const acceptedContests = r => r.accepted.map(a => a.record.contest).sort((a, b) => a - b);
/** Cópia da linha i com fórmula na coluna h (valor em cache = original ou `cached`). */
const withFormula = (row, header, h, cached) => { const c = header.indexOf(h); assert.ok(c >= 0, `cabeçalho ${h}`); const r = clone(row); const v = r[c]; const orig = typeof v === 'object' && v !== null ? v.v : String(v); r[c] = { f: 'SUM(1,2)', v: cached ?? orig, t: typeof v === 'object' && v && v.t ? v.t : typeof v === 'string' ? 'str' : 'n' }; return r; };
const insertAt = (rows, i, row) => [...rows.slice(0, i), row, ...rows.slice(i)];
const HEADERS = {
  numbers: 'Bola3', winners: l => ({ megasena: 'Ganhadores 4 acertos', lotofacil: 'Ganhadores 11 acertos', quina: 'Ganhadores 2 acertos', lotomania: 'Ganhadores 20 acertos' })[l],
  prize: l => ({ megasena: 'Rateio 4 acertos', lotofacil: 'Rateio 11 acertos', quina: 'Rateio 2 acertos', lotomania: 'Rateio 20 acertos' })[l], economic: l => getXlsxAdapter(l).columns.find(c => c.kind === 'economic').header, text: 'obs',
};
const hdr = (l, k, header) => { const v = HEADERS[k]; const h = typeof v === 'function' ? v(l) : v; return h === 'obs' ? header.find(x => /^observa/i.test(x)) : h; };

/* ---------- 4.1 ---------- */
test('4.1: linha com fórmula duplicando concurso válido — antes OU depois — nunca descarta a válida (dezenas, ganhadores, prêmio, econômico, texto; 4 modalidades)', () => {
  for (const l of MODS) for (const k of Object.keys(HEADERS)) {
    const results = [];
    for (const pos of ['antes', 'depois']) {
      const r = imp(l, { seed: 9, count: 6, name: `SYNTHETIC_DATA_dupf_${k}_${pos}`, mutate: ({ header, rows }) => { const h = hdr(l, k, header); assert.ok(h && header.includes(h), `${l} ${k} cabeçalho`); const f = withFormula(rows[2], header, h); return { header, rows: insertAt(rows, pos === 'antes' ? 2 : 3, f) }; } });
      assert.deepEqual(acceptedContests(r), [1, 2, 3, 4, 5, 6], `${l} ${k} ${pos}: concurso 3 válido aceito`);
      assert.ok(!codes(r).includes(Q.CONCURSO_DUPLICADO_CONFLITANTE), `${l} ${k} ${pos}: sem conflito artificial`);
      const q = r.quarantine.find(x => x.candidate && x.candidate.contest === 3); assert.ok(q, 'linha com fórmula em quarentena');
      const fr = q.reasons.find(x => x.code === Q.FORMULA_EM_CAMPO_HISTORICO); assert.ok(fr); assert.equal(fr.evidence.duplicateContext.sameCanonicalAsReference, true); assert.equal(fr.evidence.duplicateContext.referenceEligible, true);
      assert.equal(r.duplicatesIdentical.length, 0, 'inelegível não conta como duplicata idêntica');
      results.push({ accepted: acceptedContests(r), codes: codes(r), q: r.quarantine.filter(x => x.candidate).map(x => x.candidate.contest).sort() });
    }
    assert.deepEqual(results[0], results[1], `${l} ${k}: resultado independe da ordem física`);
  }
});

test('4.1: fórmula com valor em cache DIFERENTE: válida aceita; diferença registrada no contexto, sem conflito (cache não é evidência)', () => {
  const r = imp('megasena', { seed: 9, count: 6, mutate: ({ header, rows }) => ({ header, rows: insertAt(rows, 2, withFormula(rows[2], header, 'Bola1', '59')) }) });
  assert.deepEqual(acceptedContests(r), [1, 2, 3, 4, 5, 6]);
  const ctxd = r.quarantine.find(x => x.candidate && x.candidate.contest === 3).reasons[0].evidence.duplicateContext; assert.equal(ctxd.sameCanonicalAsReference, false); assert.ok(ctxd.diffsVsReference.length > 0);
});

test('4.1: conflito real entre linhas válidas segue identificado (ambas as ordens); duplicata idêntica mantém a de menor linha', () => {
  for (const pos of [2, 3]) {
    const r = imp('quina', { seed: 4, count: 6, mutate: ({ header, rows }) => { const d = clone(rows[2]); const c = header.indexOf('Ganhadores 2 acertos'); d[c] = Number(d[c]) + 1; return { header, rows: insertAt(rows, pos, d) }; } });
    assert.ok(!acceptedContests(r).includes(3)); assert.equal(r.conflicts.length, 1); assert.equal(r.quarantine.filter(x => x.candidate && x.candidate.contest === 3).length, 2);
    const id = imp('quina', { seed: 4, count: 6, mutate: ({ header, rows }) => ({ header, rows: insertAt(rows, pos, clone(rows[2])) }) });
    assert.deepEqual(acceptedContests(id), [1, 2, 3, 4, 5, 6]); assert.equal(id.duplicatesIdentical.length, 1); assert.equal(id.duplicatesIdentical[0].keptRow, Math.min(...[pos, 2].map(i => i + 2)), 'mantém a menor linha');
  }
  // válida + fórmula + válida diferente → conflito entre as válidas; fórmula com motivos próprios
  const r3 = imp('megasena', { seed: 9, count: 6, mutate: ({ header, rows }) => { const d = clone(rows[2]); d[header.indexOf('Ganhadores 4 acertos')] = 999; return { header, rows: insertAt(insertAt(rows, 3, withFormula(rows[2], header, 'Bola2')), 4, d) }; } });
  assert.ok(!acceptedContests(r3).includes(3)); assert.equal(r3.conflicts.length, 1); assert.equal(r3.conflicts[0].rows.length, 2);
  assert.equal(r3.quarantine.filter(x => x.candidate && x.candidate.contest === 3).length, 3, 'nenhuma linha some');
});

test('invariantes 1 e 13: embaralhamento físico (PRNG semeado + Fisher–Yates) com duplicatas válidas/inválidas não muda a classificação', () => {
  const rnd = prng(31337);
  for (const l of MODS) {
    const mk = order => imp(l, { seed: 2, count: 10, mutate: ({ header, rows }) => { const extra = [withFormula(rows[4], header, 'Bola1'), clone(rows[6]), withFormula(rows[8], header, hdr(l, 'economic', header))]; const all = [...rows, ...extra]; return { header, rows: order ? order(all) : all }; } });
    const base = mk(null); const sig = r => ({ a: acceptedContests(r), c: codes(r), dup: r.duplicatesIdentical.map(d => d.contest).sort((a, b) => a - b), conf: r.conflicts.length });
    assert.deepEqual(base.accepted.length, 10, `${l}: todos os concursos válidos aceitos`);
    for (let i = 0; i < 4; i++) assert.deepEqual(sig(mk(a => shuffle(a, rnd))), sig(base), `${l} embaralhamento ${i}`);
  }
});

/* ---------- 4.2 ---------- */
test('4.2: cabeçalho MAPEADO duplicado bloqueia a importação (Concurso, Bola1, prêmio, ganhadores), mesmo com valores diferentes', () => {
  for (const [l, h] of [['megasena', 'Concurso'], ['megasena', 'Bola1'], ['quina', 'Rateio 5 acertos'], ['lotofacil', 'Ganhadores 15 acertos'], ['lotomania', 'Bola20']]) {
    for (const diff of [false, true]) {
      const r = imp(l, { seed: 5, count: 4, mutate: ({ header, rows }) => { const c = header.indexOf(h); return { header: [...header, h], rows: rows.map(row => [...row, diff ? (typeof row[c] === 'object' ? { ...row[c], v: '07' } : row[c] + 1) : row[c]]) }; } });
      assert.equal(r.status, 'REJECTED', `${l} ${h}`); assert.equal(r.accepted.length, 0);
      const alerts = r.quarantine.flatMap(q => q.reasons).flatMap(x => (x.evidence && x.evidence.alerts) || []);
      const a = alerts.find(x => x.code === 'DUPLICATE_MAPPED_HEADER'); assert.ok(a, 'alerta bloqueante'); assert.equal(a.header, h); assert.equal(a.refs.length, 2); assert.equal(a.blocking, true);
      assert.ok(r.quarantine.some(q => q.reasons.some(x => x.code === Q.ARQUIVO_INCOMPATIVEL)));
    }
  }
});

test('4.2: cabeçalho DESCONHECIDO duplicado não bloqueia e não descarta: as duas colunas ficam em extras', () => {
  const r = imp('megasena', { seed: 5, count: 4, mutate: ({ header, rows }) => ({ header: [...header, 'Coluna Extra', 'Coluna Extra'], rows: rows.map((row, i) => [...row, `a${i}`, `b${i}`]) }) });
  assert.equal(r.status, 'IMPORTED'); assert.equal(r.accepted.length, 4);
  for (const a of r.accepted) { const ex = a.record.extras.filter(e => e.header === 'Coluna Extra').map(e => e.text); assert.equal(ex.length, 2); assert.ok(ex[0].startsWith('a') && ex[1].startsWith('b')); }
  assert.ok(r.report.schemaAlerts.includes('DUPLICATE_HEADER'));
});

/* ---------- 4.3 ---------- */
test('4.3: lacunas em intervalos compactos O(registros): contagens exatas, concurso altíssimo sem crescimento, expansão com limite explícito', () => {
  const t0 = Date.now();
  const r = imp('quina', { seed: 3, count: 3, startContest: 900000000000000 });
  assert.ok(Date.now() - t0 < 5000, 'sem laço até o maior concurso');
  assert.deepEqual(r.gapRanges, [{ from: 1, to: 899999999999999, count: 899999999999999 }]); assert.equal(r.missingCount, 899999999999999);
  assert.equal(r.report.counts.missingContests, 899999999999999); assert.equal(r.report.counts.missingRanges, 1);
  const gq = r.quarantine.filter(q => q.reasons[0].code === Q.CONCURSO_AUSENTE); assert.equal(gq.length, 1, 'uma entrada por intervalo');
  assert.deepEqual(gq[0].reasons[0].contestRange, { from: 1, to: 899999999999999, count: 899999999999999, format: V.GAP_FORMAT });
  assert.equal(r.report.coverage.missingFormat, 'lotus.gap-ranges/1.0.0'); assert.equal(r.report.coverage.missingCount, 899999999999999); assert.equal(r.report.coverage.expectedCount, 900000000000002);
  assert.throws(() => V.expandGapRanges(r.gapRanges), RangeError); assert.throws(() => V.expandGapRanges([{ from: 1, to: 11, count: 11 }], { max: 10 }), /limite 10/);
  const m = imp('megasena', { seed: 3, count: 12, mutate: ({ header, rows }) => ({ header, rows: rows.filter((_, i) => ![0, 4, 5, 6, 9].includes(i)) }) });
  assert.deepEqual(m.gapRanges, [{ from: 1, to: 1, count: 1 }, { from: 5, to: 7, count: 3 }, { from: 10, to: 10, count: 1 }]); assert.equal(m.missingCount, 5);
  assert.deepEqual(V.expandGapRanges(m.gapRanges), [1, 5, 6, 7, 10]); assert.equal(m.report.coverage.contiguous, false);
  assert.deepEqual(V.gapRangesOf([]), []); assert.deepEqual(V.gapRangesOf([1, 2, 3]), []);
});
