// SYNTHETIC_DATA — correção integrada final da Fase 3b.2 (5 problemas residuais de integração/verificação).
// Imports dinâmicos com fallback permitem medir "falha antes" contra 88fba95 (funções novas ausentes → teste falha).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { imp } from './_h.js';
import { syntheticWorkbook, SYNTH_META } from './_xlsx-writer.js';
import { Q } from '../../src/historical/codes.js';
import { runPipeline } from '../../src/historical/pipeline.js';
import { rawBytes } from '../../src/data/raw.js';
import { computeRootHash } from '../../src/integrity/manifest.js';
import { hashJson } from '../../src/integrity/hash.js';
const R = await import('../../src/historical/reconcile.js');
const S = await import('../../src/historical/reconcile-sample.js');
const M = await import('../../src/historical/manifests.js');
const { adaptJsonResult, compareRecords, CLASSES: C } = R;

const MODS = ['megasena', 'lotofacil', 'quina', 'lotomania'];
const clone = o => JSON.parse(JSON.stringify(o));
const sha = b => createHash('sha256').update(b).digest('hex');
const pad = n => String(n).padStart(2, '0');
const toLit = c => { const s = String(c).padStart(3, '0'); return `${s.slice(0, -2)}.${s.slice(-2)}`; };
const ent = (h, w, p, extra = '') => `{"descricaoFaixa":"${h} acertos"${extra},"numeroDeGanhadores":${w},"valorPremio":${p}}`;
function J(x, over = {}) {
  const tiers = x.prizeTiers.map((t, i) => ent(t.hits, t.winners.value ?? 0, toLit(t.prize.cents ?? 100), `,"faixa":${i + 1}`));
  const o = { numero: String(x.contest), dataApuracao: JSON.stringify(x.drawDate.split('-').reverse().join('/')), listaDezenas: `[${x.numbers.map(n => `"${pad(n)}"`).join(',')}]`, listaRateioPremio: `[${tiers.join(',')}]`, ...over };
  return `{${Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `"${k}":${v}`).join(',')}}`;
}
const meta = { lastContest: 99, xlsxObservedAt: '2026-01-01T00:00:00Z' };
const sampleFor = (l, bytes, over = {}) => ({ lottery: l, origin: 'FASE3B2', url: `https://synthetic.invalid/${l}`, observedAt: '2026-01-02T00:00:00Z', justification: 'SYNTHETIC_DATA', loggedSha256: sha(bytes), loggedBytes: bytes.length, loggedHttpStatus: 200, ...over });
const withFormula = (row, header, h, cached) => { const c = header.indexOf(h); const r = clone(row); const v = r[c]; const orig = typeof v === 'object' && v !== null ? v.v : String(v); r[c] = { f: 'SUM(1,2)', v: cached ?? orig, t: typeof v === 'object' && v && v.t ? v.t : typeof v === 'string' ? 'str' : 'n' }; return r; };
const insertAt = (rows, i, row) => [...rows.slice(0, i), row, ...rows.slice(i)];
const codes = r => r.quarantine.flatMap(q => q.reasons.map(x => x.code)).sort();
/** Persistência simulada exatamente como scripts/importar-historico-fase3b2.mjs grava (accepted-records.jsonl = records; quarantine.json). */
const persisted = r => ({ acceptedRecords: r.accepted.map(a => clone(a.record)), quarantine: clone(r.quarantine) });
const oldMap = p => new Map([...p.acceptedRecords, ...p.quarantine.filter(e => e.candidate).map(e => ({ ...e.candidate, __quarantined: true }))].map(r => [r.contest, r]));
const reconcileVia = (r, l, contest) => {
  const p = persisted(r); const idx = S.buildXlsxRecordIndex(p);
  const x = (p.acceptedRecords.find(a => a.contest === contest) ?? p.quarantine.find(e => e.candidate && e.candidate.contest === contest).candidate);
  const bytes = new TextEncoder().encode(J(x)); return { idx, out: S.reconcileSample({ sample: sampleFor(l, bytes), bytes, xlsxRecords: idx, meta }), p, x };
};

/* ================= 1. seleção do registro na reconciliação ================= */
test('1.1–1.3/1.6: válida + duplicata com fórmula (antes e depois; cache DIFERENTE): o registro aceito chega ao reconcileSample, nunca a quarentena (4 modalidades)', () => {
  for (const l of MODS) for (const pos of ['antes', 'depois']) {
    const r = imp(l, { seed: 9, count: 6, mutate: ({ header, rows }) => ({ header, rows: insertAt(rows, pos === 'antes' ? 2 : 3, withFormula(rows[2], header, 'Bola1', '0')) }) });
    assert.ok(r.accepted.some(a => a.record.contest === 3), `${l} ${pos}: válida aceita`);
    const { idx, out, p } = reconcileVia(r, l, 3);
    const validRow = p.acceptedRecords.find(a => a.contest === 3).source.row;
    const sel = idx.get(3); assert.equal(sel.selection, 'ACEITO'); assert.equal(sel.record.source.row, validRow); assert.equal(sel.record.__quarantined, undefined);
    assert.equal(sel.quarantineRefs.length, 1, 'linha em quarentena rastreada'); assert.ok(sel.quarantineRefs[0].reasonCodes.includes(Q.FORMULA_EM_CAMPO_HISTORICO)); assert.notEqual(sel.quarantineRefs[0].row, validRow);
    assert.equal(out.entry.xlsxStatus, 'ACEITO', `${l} ${pos}`); assert.equal(out.entry.xlsxSource.candidates[0].row, validRow);
    assert.deepEqual(out.rows.filter(q => q.class === C.DIVERGENCIA), [], 'sem divergência falsa');
    assert.deepEqual(out.rows, compareRecords(sel.record, adaptJsonResult(J(sel.record)), { xlsxLastContest: meta.lastContest, xlsxObservedAt: meta.xlsxObservedAt, jsonObservedAt: '2026-01-02T00:00:00Z', jsonSha256: out.entry.jsonSha256, jsonUrl: `https://synthetic.invalid/${l}`, lottery: l }), 'linhas = comparação com o registro aceito');
    // o mapa antigo (aceitos seguidos da quarentena) entregava a linha inválida: defeito reproduzido
    assert.equal(oldMap(p).get(3).__quarantined, true);
  }
});

test('1.4: duas linhas válidas conflitantes → nenhuma escolha arbitrária: AMBIGUO com as duas referências; sem comparação, sem EQUIVALENTE/DIVERGENCIA', () => {
  for (const pos of [2, 3]) {
    const r = imp('quina', { seed: 4, count: 6, mutate: ({ header, rows }) => { const d = clone(rows[2]); const c = header.indexOf('Ganhadores 2 acertos'); d[c] = Number(d[c]) + 1; return { header, rows: insertAt(rows, pos, d) }; } });
    assert.ok(codes(r).includes(Q.CONCURSO_DUPLICADO_CONFLITANTE));
    const { idx, out } = reconcileVia(r, 'quina', 3);
    const sel = idx.get(3); assert.equal(sel.selection, 'AMBIGUO'); assert.equal(sel.record, null); assert.equal(sel.candidates.length, 2); assert.deepEqual(sel.candidates.map(c => c.row).sort(), [4, 5]);
    assert.equal(out.entry.xlsxStatus, 'AMBIGUO'); assert.equal(out.entry.xlsxAmbiguity.candidates.length, 2); assert.equal(out.quarantine, null, 'sem quarentena de divergência');
    assert.deepEqual(out.rows.filter(q => [C.EQUIVALENTE, C.DIVERGENCIA, C.AUSENTE, C.REPRESENTACAO, C.FORMATACAO].includes(q.class)).map(q => q.field), []);
    assert.ok(out.rows.length > 0 && out.rows.every(q => q.xlsxAmbiguous === true));
  }
  // múltiplos aceitos para o mesmo concurso (artefato corrompido/legado) → AMBIGUO, nunca o último
  const base = imp('megasena', { seed: 9, count: 4 }); const a = clone(base.accepted[2].record); const b = clone(a); b.source.row = 99; b.prizeTiers[0].winners.value = 7;
  const idx = S.buildXlsxRecordIndex({ acceptedRecords: [a, b], quarantine: [] }); assert.equal(idx.get(3).selection, 'AMBIGUO'); assert.equal(idx.get(3).reason, 'MULTIPLOS_REGISTROS_ACEITOS');
});

test('1.5: múltiplas linhas em quarentena (sem aceita) → AMBIGUO com referências; uma única em quarentena → QUARENTENA (rastreável)', () => {
  for (const order of [0, 1]) {
    const r = imp('lotofacil', { seed: 2, count: 6, mutate: ({ header, rows }) => { const f1 = withFormula(rows[2], header, 'Bola1'); const f2 = withFormula(rows[2], header, 'Bola2', '0'); const rs = [...rows]; rs.splice(2, 1, ...(order ? [f2, f1] : [f1, f2])); return { header, rows: rs }; } });
    assert.ok(!r.accepted.some(a => a.record.contest === 3));
    const { idx, out } = reconcileVia(r, 'lotofacil', 3);
    assert.equal(idx.get(3).selection, 'AMBIGUO'); assert.equal(idx.get(3).reason, 'MULTIPLOS_CANDIDATOS_EM_QUARENTENA'); assert.equal(idx.get(3).candidates.length, 2);
    assert.equal(out.entry.xlsxStatus, 'AMBIGUO');
    assert.deepEqual(oldMap(persisted(r)).get(3).source.row, Math.max(...idx.get(3).candidates.map(c => c.row)), 'mapa antigo: "a última do array"');
  }
  const r1 = imp('megasena', { seed: 9, count: 6, mutate: ({ header, rows }) => { const rs = [...rows]; rs[2] = withFormula(rows[2], header, 'Bola1'); return { header, rows: rs }; } });
  const { idx, out } = reconcileVia(r1, 'megasena', 3); assert.equal(idx.get(3).selection, 'QUARENTENA'); assert.equal(out.entry.xlsxStatus, 'QUARENTENA'); assert.equal(out.entry.xlsxSource.quarantineRefs.length, 1);
});

/* ================= 2. cronologia V13 ================= */
const dcol = header => { const i = header.findIndex(h => /^Data/.test(h)); assert.ok(i >= 0, 'coluna de data'); return i; };
const v13 = r => ({ anomalies: r.dateAnomalies.map(d => [d.contest, d.row, d.classification]), excl: r.report.chronologyExclusions.map(e => [e.contest, e.reason, e.candidates.map(c => c.row)]), accepted: r.accepted.map(a => a.record.contest), codes: codes(r) });
const perms = a => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])));
test('2.1: duplicatas com fórmula com data DIFERENTE e data INVÁLIDA, em todas as ordens físicas: cronologia pelo registro elegível, resultado idêntico', () => {
  for (const l of MODS) {
    const results = [];
    for (const order of perms([0, 1, 2])) {
      const r = imp(l, { seed: 6, count: 7, mutate: ({ header, rows }) => {
        const valid = rows[2]; const far = withFormula(valid, header, 'Bola2'); far[dcol(header)] = '15/06/2005';
        const bad = withFormula(valid, header, 'Bola2'); bad[dcol(header)] = '31/02/2001';
        const trio = [valid, far, bad]; const rs = [...rows]; rs.splice(2, 1, ...order.map(i => trio[i])); return { header, rows: rs };
      } });
      const s = v13(r); assert.deepEqual(s.anomalies, [], `${l} ${order}: data de linha inválida não entra na cronologia`); assert.ok(s.accepted.includes(3), `${l} ${order}`);
      assert.ok(!s.codes.includes(Q.DATA_NAO_MONOTONICA)); results.push({ ...s, anomalies: s.anomalies });
    }
    for (const x of results) assert.deepEqual({ a: x.anomalies, e: x.excl.map(e => e.slice(0, 2)), acc: x.accepted, c: x.codes }, { a: results[0].anomalies, e: results[0].excl.map(e => e.slice(0, 2)), acc: results[0].accepted, c: results[0].codes }, `${l}: independente da ordem`);
  }
});
test('2.2: sem registro elegível → concurso fora da cronologia com evidência (nunca a data da linha inválida); todas as ordens', () => {
  for (const order of perms([0, 1])) {
    const r = imp('quina', { seed: 6, count: 7, mutate: ({ header, rows }) => {
      const f1 = withFormula(rows[2], header, 'Bola1'); f1[dcol(header)] = '15/06/2005'; const f2 = withFormula(rows[2], header, 'Bola2');
      const rs = [...rows]; rs.splice(2, 1, ...order.map(i => [f1, f2][i])); return { header, rows: rs };
    } });
    const s = v13(r); assert.deepEqual(s.anomalies, [], `${order}`);
    assert.deepEqual(s.excl.map(e => e.slice(0, 2)), [[3, 'SEM_REGISTRO_ELEGIVEL']]); assert.deepEqual(s.excl[0][2], [4, 5]);
    assert.ok(r.report.chronologyExclusions[0].candidates.every(c => c.eligible === false));
  }
});
test('2.3: conflito entre elegíveis com datas diferentes → não resolvido pela primeira linha: fora da cronologia com as candidatas; ordens equivalentes', () => {
  const res = [];
  for (const pos of [2, 3]) {
    const r = imp('megasena', { seed: 6, count: 7, mutate: ({ header, rows }) => { const d = clone(rows[2]); d[dcol(header)] = '15/06/2005'; return { header, rows: insertAt(rows, pos, d) }; } });
    const s = v13(r); assert.deepEqual(s.anomalies, [], 'nenhuma das datas conflitantes é usada'); assert.deepEqual(s.excl.map(e => e.slice(0, 2)), [[3, 'DATAS_CONFLITANTES_ENTRE_ELEGIVEIS']]);
    assert.ok(s.codes.includes(Q.CONCURSO_DUPLICADO_CONFLITANTE)); res.push({ a: s.anomalies, e: s.excl, c: s.codes });
  }
  assert.deepEqual(res[0], res[1]);
});
test('2.4: duplicatas elegíveis idênticas com data fora de ordem → uma anomalia determinística (menor linha), em todas as ordens', () => {
  const res = [];
  for (const pos of [2, 3]) {
    const r = imp('lotomania', { seed: 6, count: 7, mutate: ({ header, rows }) => { const rs = clone(rows); rs[2][dcol(header)] = '15/06/2005'; return { header, rows: insertAt(rs, pos, clone(rs[2])) }; } });
    const s = v13(r); assert.deepEqual(s.anomalies, [[3, 4, 'ISOLATED_OUTLIER']]); res.push(s.anomalies);
  }
  assert.deepEqual(res[0], res[1]);
});

/* ================= 3. manifestos de modalidade e de execução ================= */
const T1 = '2026-01-01T00:00:00Z', T3 = '2026-01-03T00:00:00Z';
function persistedRuns() {
  const L = new M.ManifestLedger(); const lines = [];
  const ledger = { latest: id => L.latest(id), submit: m => { const r = L.submit(m); if (r.accepted) lines.push(JSON.stringify(m)); return r; } };
  const inputs = seed => MODS.map(l => ({ lottery: l, bytes: syntheticWorkbook(l, { seed }), meta: SYNTH_META(l) }));
  const persist = (runId, r) => ({ runId, runManifestFile: { action: r.run.runAction, manifest: clone(r.run.runManifest) }, runReport: clone(r.run.runReport),
    modalities: r.results.map(res => { const mod = r.run.modality.find(m => m.lottery === res.lottery); return { lottery: res.lottery, manifestFile: { action: mod.action, manifest: clone(mod.manifest) },
      imp: { report: clone(res.imp.report), quarantine: clone(res.imp.quarantine), duplicatesIdentical: clone(res.imp.duplicatesIdentical), accepted: res.imp.accepted.map(a => ({ record: clone(a.record) })) }, collection: clone(res.collection), rawBytes: rawBytes(res.envelope) }; }) });
  const runs = [persist('import-20260101T000000Z', runPipeline({ inputs: inputs(5), ledger, runId: 'a', createdAt: T1 })), persist('import-20260102T000000Z', runPipeline({ inputs: inputs(5), ledger, runId: 'b', createdAt: T1 })), persist('import-20260103T000000Z', runPipeline({ inputs: inputs(8), ledger, runId: 'c', createdAt: T3 }))];
  return { runs, ledgerText: lines.join('\n') + '\n', lines };
}
const reroot = m => { const c = clone(m); c.rootHash = computeRootHash(c); return c; };
const codesOf = v => v.errors.map(e => e.code);
test('3 positivo: 3 execuções (NEW, UNCHANGED_REPLAY, NEW encadeada) → 12 manifestos de modalidade, 3 de execução, ledger inteiro válido', () => {
  const p = persistedRuns(); assert.equal(p.runs[1].runManifestFile.action, 'UNCHANGED_REPLAY');
  const v = M.verifyPersistedRuns(p); assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(v.modalityManifestsVerified, 12); assert.equal(v.runManifestsVerified, 3); assert.deepEqual(v.ledger, { lines: 10, accepted: 10, chainOk: true });
  assert.equal(v.runResults[2].chain, 'VERIFICADO_CONTRA_ANTERIOR'); assert.ok(v.entriesChecked > 0);
});
test('3 negativo: run-report adulterado (com e sem recálculo do manifesto) é detectado pelo CONTEÚDO', () => {
  const p = persistedRuns(); p.runs[2].runReport.modalities[0].counts.accepted += 1;
  let v = M.verifyPersistedRuns(p); assert.ok(codesOf(v).includes('RUN_REPORT_CONTENT_MISMATCH')); assert.ok(codesOf(v).includes('ENTRY_HASH_MISMATCH'));
  const rm = p.runs[2].runManifestFile.manifest; rm.entries.find(e => e.id === 'record:run-report').sha256 = hashJson(p.runs[2].runReport); p.runs[2].runManifestFile.manifest = reroot(rm);
  v = M.verifyPersistedRuns(p); assert.equal(v.ok, false); assert.ok(codesOf(v).includes('RUN_REPORT_CONTENT_MISMATCH')); assert.ok(codesOf(v).includes('MANIFEST_DIFFERS_FROM_LEDGER'));
  assert.equal(v.runManifestsVerified, 2);
});
test('3 negativo: run-manifest apontando para outro rootHash; modalidade ausente; rootHash de modalidade divergente', () => {
  let p = persistedRuns(); let rm = p.runs[0].runManifestFile.manifest; rm.entries.find(e => e.id === 'manifest:quina').sha256 = 'f'.repeat(64); p.runs[0].runManifestFile.manifest = reroot(rm);
  let v = M.verifyPersistedRuns(p); assert.ok(codesOf(v).includes('RUN_MODALITY_ROOTHASH_MISMATCH'));
  p = persistedRuns(); p.runs[2].modalities = p.runs[2].modalities.filter(m => m.lottery !== 'quina'); v = M.verifyPersistedRuns(p); assert.ok(codesOf(v).includes('RUN_MODALITY_MISSING'));
  p = persistedRuns(); const mm = p.runs[2].modalities[1].manifestFile.manifest; mm.createdAt = '2026-01-04T00:00:00Z'; p.runs[2].modalities[1].manifestFile.manifest = reroot(mm);
  v = M.verifyPersistedRuns(p); assert.ok(codesOf(v).includes('MANIFEST_DIFFERS_FROM_LEDGER')); assert.ok(codesOf(v).includes('RUN_MODALITY_ROOTHASH_MISMATCH')); assert.ok(codesOf(v).includes('RUN_REPORT_CONTENT_MISMATCH'));
  assert.ok(codesOf(v).includes('RUN_MODALITY_NOT_VERIFIED'));
});
test('3 negativo: manifesto anterior adulterado no ledger (com e sem recálculo do rootHash); linha inválida; cadeia quebrada', () => {
  let p = persistedRuns(); const m0 = JSON.parse(p.lines[0]); m0.createdAt = '2025-01-01T00:00:00Z';
  let v = M.verifyPersistedRuns({ ...p, ledgerText: [JSON.stringify(m0), ...p.lines.slice(1)].join('\n') + '\n' });
  assert.ok(v.errors.some(e => e.code === 'LEDGER_LINE_REJECTED' && e.reason === 'INVALID_MANIFEST' && e.line === 1)); assert.equal(v.ledger.chainOk, false);
  v = M.verifyPersistedRuns({ ...p, ledgerText: [JSON.stringify(reroot(m0)), ...p.lines.slice(1)].join('\n') + '\n' });
  assert.ok(v.errors.some(e => e.code === 'LEDGER_CHAIN_BROKEN')); assert.ok(codesOf(v).includes('MANIFEST_DIFFERS_FROM_LEDGER'));
  v = M.verifyPersistedRuns({ ...p, ledgerText: [...p.lines.slice(0, 7), '{oops', ...p.lines.slice(7)].join('\n') + '\n' }); assert.ok(codesOf(v).includes('LEDGER_LINE_NOT_JSON'));
  v = M.verifyPersistedRuns({ ...p, ledgerText: [...p.lines.slice(0, 3), '', ...p.lines.slice(3)].join('\n') + '\n' }); assert.ok(codesOf(v).includes('LEDGER_LINE_EMPTY'));
  // existência do manifesto (o antigo ledger.some) não basta: a linha seguinte inválida torna a verificação falha
  assert.equal(v.ok, false);
});
test('3 negativo: regressão, substituição, lacuna de sequência e sucessão inconsistente entre execuções', () => {
  const p = persistedRuns();
  let v = M.verifyPersistedRuns({ ...p, ledgerText: [p.lines[5], ...p.lines.slice(0, 5), ...p.lines.slice(6)].join('\n') + '\n' });
  assert.ok(v.errors.some(e => e.code === 'LEDGER_FIRST_SEQUENCE_NOT_1' || (e.code === 'LEDGER_LINE_REJECTED' && /SEQUENCE/.test(e.reason))));
  const sub = reroot({ ...JSON.parse(p.lines[5]), createdAt: '2026-02-02T00:00:00Z' });
  v = M.verifyPersistedRuns({ ...p, ledgerText: [...p.lines, JSON.stringify(sub)].join('\n') + '\n' }); assert.ok(v.errors.some(e => e.code === 'LEDGER_LINE_REJECTED' && e.reason === 'SEQUENCE_SUBSTITUTION'));
  const gap = reroot({ ...JSON.parse(p.lines[5]), sequence: 3 });
  v = M.verifyPersistedRuns({ ...p, ledgerText: [...p.lines.slice(0, 5), JSON.stringify(gap), ...p.lines.slice(6)].join('\n') + '\n' }); assert.ok(codesOf(v).includes('LEDGER_SEQUENCE_GAP'));
  const p2 = persistedRuns(); p2.runs[2].runManifestFile.action = 'UNCHANGED_REPLAY'; v = M.verifyPersistedRuns(p2); assert.ok(codesOf(v).includes('RUN_REPLAY_INCONSISTENT'));
  const p3 = persistedRuns(); p3.runs.pop(); v = M.verifyPersistedRuns(p3); assert.ok(codesOf(v).includes('LEDGER_ENTRY_WITHOUT_RUN'));
});
test('3 negativo (modalidade): conteúdo real adulterado continua detectado dentro da verificação completa', () => {
  const p = persistedRuns(); p.runs[0].modalities[2].imp.accepted[0].record.numbers[0] += 1;
  const v = M.verifyPersistedRuns(p); assert.ok(v.errors.some(e => e.scope === 'modality' && e.code === 'ENTRY_HASH_MISMATCH' && /^record:draw:quina:/.test(e.id))); assert.equal(v.modalityManifestsVerified, 11);
});

/* ================= 4. proveniência (SHA-256 da coleta) ================= */
const P = S.PROVENANCE;
const xq = () => clone(imp('quina', { seed: 3, count: 3 }).accepted[0].record);
test('4.1–4.6: intacto · 1 byte alterado · truncado · hash ausente (legado) · hash malformado · JSON válido com hash divergente', () => {
  const x = xq(); const good = new TextEncoder().encode(J(x)); const s = sampleFor('quina', good);
  const ok = S.reconcileSample({ sample: s, bytes: good, xlsxRecords: new Map([[x.contest, x]]), meta });
  assert.equal(ok.entry.provenance.status, P.VERIFICADA); assert.equal(ok.entry.provenance.loggedSha256, ok.entry.provenance.computedSha256); assert.equal(ok.entry.jsonSha256, s.loggedSha256);
  const flip = new Uint8Array(good); flip[flip.length - 2] ^= 1; const trunc = good.slice(0, good.length - 5);
  const other = new TextEncoder().encode(J(x, { observacao: '"SYNTHETIC_DATA"' })); assert.doesNotThrow(() => JSON.parse(new TextDecoder().decode(other)));
  for (const [name, b, extraReason] of [['byte', flip, null], ['truncado', trunc, 'TAMANHO_DIVERGENTE'], ['json-valido', other, 'TAMANHO_DIVERGENTE']]) {
    const r = S.reconcileSample({ sample: s, bytes: b, xlsxRecords: new Map([[x.contest, x]]), meta });
    assert.equal(r.status, S.SAMPLE_STATUS.PROVENIENCIA_REJEITADA, name); assert.deepEqual(r.rows, [], `${name}: sem parse/comparação`);
    const pv = r.entry.provenance; assert.equal(pv.status, P.REJEITADA); assert.ok(pv.reasons.includes('HASH_DIVERGENTE')); if (extraReason) assert.ok(pv.reasons.includes(extraReason), name);
    assert.equal(pv.loggedSha256, s.loggedSha256, 'hash original preservado'); assert.equal(pv.computedSha256, sha(b)); assert.equal(pv.loggedBytes, good.length); assert.equal(pv.observedBytes, b.length);
  }
  const legacy = S.reconcileSample({ sample: { ...s, loggedSha256: null }, bytes: good, xlsxRecords: new Map([[x.contest, x]]), meta });
  assert.equal(legacy.entry.provenance.status, P.SEM_HASH); assert.equal(legacy.entry.provenance.reason, 'LIMITACAO_DE_PROVENIENCIA_LOG_LEGADO_SEM_HASH'); assert.ok(legacy.rows.length > 0, 'legado reconciliado, mas NÃO verificado');
  for (const bad of ['xyz', 'A'.repeat(64), 'a'.repeat(63), 5]) { const r = S.reconcileSample({ sample: { ...s, loggedSha256: bad }, bytes: good, xlsxRecords: new Map(), meta }); assert.equal(r.status, S.SAMPLE_STATUS.PROVENIENCIA_REJEITADA, String(bad)); assert.ok(r.entry.provenance.reasons.includes('HASH_REGISTRADO_MALFORMADO')); }
  const st = S.reconcileSample({ sample: { ...s, loggedHttpStatus: 500 }, bytes: good, xlsxRecords: new Map(), meta }); assert.ok(st.entry.provenance.reasons.includes('STATUS_HTTP_REGISTRADO_NAO_200'));
});
test('4: collectSamples preserva hash/tamanho/status originais dos logs 3b.2 e 3b.1 (3b.1 sem hash → limitação, não verificação)', () => {
  const h = 'a'.repeat(64);
  const priv = JSON.stringify({ url: 'https://servicebus3.caixa.gov.br/portaldeloterias/api/quina/5', utc: T1, status: 200, bytes: 10, sha256: h, file: `json/quina/5-${h}.json`, justification: 'j' });
  const ex = [JSON.stringify({ url: 'https://servicebus3.caixa.gov.br/portaldeloterias/api/megasena/7', utc: T1, status: 200, size: 12, sha256: h, file: 'raw/m7.json' }), JSON.stringify({ url: 'https://servicebus3.caixa.gov.br/portaldeloterias/api/megasena/8', utc: T1, status: 200, file: 'raw/m8.json' })].join('\n');
  const { samples } = S.collectSamples({ privateLogText: priv, extraLogText: ex });
  assert.deepEqual(samples.map(s => [s.origin, s.loggedSha256, s.loggedBytes, s.loggedHttpStatus]), [['FASE3B2', h, 10, 200], ['FASE3B1', h, 12, 200], ['FASE3B1', null, null, 200]]);
  const b = new TextEncoder().encode('{}'); assert.equal(S.verifySampleProvenance(samples[2], b).status, P.SEM_HASH); assert.equal(S.verifySampleProvenance(samples[1], b).status, P.REJEITADA);
});

/* ================= 5. winnerLocations (HIPOTESE) ================= */
test('5: winnerLocations — ambas vazias AUSENTE; só uma com conteúdo SEMANTICA; ambas SEMANTICA; tipo JSON errado DADO_INVALIDO; nunca EQUIVALENTE (4 modalidades)', () => {
  const ctx = l => ({ xlsxLastContest: 99, xlsxObservedAt: T1, jsonObservedAt: T1, jsonSha256: 'c'.repeat(64), jsonUrl: 'https://synthetic.invalid/json', lottery: l });
  const row = (x, over) => compareRecords(x, adaptJsonResult(J(x, over)), ctx(x.lottery)).filter(r => r.field === 'winnerLocations');
  for (const l of MODS) {
    const x0 = clone(imp(l, { seed: 3, count: 3 }).accepted[0].record); const xt = clone(x0); xt.winnerLocations = { ...xt.winnerLocations, text: 'CIDADE/UF', raw: 'CIDADE/UF', absent: false };
    const one = '[{"municipio":"CIDADE","uf":"UF","ganhadores":1}]';
    const cases = [[x0, {}, C.AUSENTE], [x0, { listaMunicipioUFGanhadores: '[]' }, C.AUSENTE], [xt, {}, C.SEMANTICA], [xt, { listaMunicipioUFGanhadores: '[]' }, C.SEMANTICA], [x0, { listaMunicipioUFGanhadores: one }, C.SEMANTICA], [xt, { listaMunicipioUFGanhadores: one }, C.SEMANTICA], [x0, { listaMunicipioUFGanhadores: '"CIDADE/UF"' }, C.DADO_INVALIDO], [xt, { listaMunicipioUFGanhadores: '{"a":1}' }, C.DADO_INVALIDO]];
    for (const [x, over, want] of cases) { const r = row(x, over); assert.equal(r.length, 1); assert.equal(r[0].class, want, `${l} ${JSON.stringify(over)} xlsx=${x.winnerLocations.text}`); assert.notEqual(r[0].class, C.EQUIVALENTE); assert.equal(r[0].correspondence, 'HIPOTESE'); }
  }
});
