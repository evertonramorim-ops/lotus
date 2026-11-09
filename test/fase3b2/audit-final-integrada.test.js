// SYNTHETIC_DATA — auditoria integrada final da Fase 3b.2 (a partir de 2389cd8): fonte ambígua, UTF-8 estrito,
// ordem autoritativa das execuções, timestamps de log, confinamento real de caminhos e lacunas de teste (§1–§4).
// Imports dinâmicos com fallback: o arquivo carrega no código anterior e cada teste falha por ASSERÇÃO (prova "falha antes").
// Offline: scripts executados com fetch global substituído por stub que falha (_no-network.mjs); só diretórios temporários.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, existsSync, statSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imp } from './_h.js';
import { syntheticWorkbook, SYNTH_META } from './_xlsx-writer.js';
import { Q } from '../../src/historical/codes.js';
import { runPipeline } from '../../src/historical/pipeline.js';
import { rawBytes } from '../../src/data/raw.js';
import { hashJson } from '../../src/integrity/hash.js';
const R = await import('../../src/historical/reconcile.js');
const S = await import('../../src/historical/reconcile-sample.js');
const M = await import('../../src/historical/manifests.js');
const ST = await import('../../src/historical/store.js');
const IL = await import('../../src/historical/import-log.js').catch(() => ({}));
const { adaptJsonResult, compareRecords, CLASSES: C } = R;

const MODS = ['megasena', 'lotofacil', 'quina', 'lotomania'];
const clone = o => JSON.parse(JSON.stringify(o));
const sha = b => createHash('sha256').update(b).digest('hex');
const pad = n => String(n).padStart(2, '0');
const toLit = c => { const s = String(c).padStart(3, '0'); return `${s.slice(0, -2)}.${s.slice(-2)}`; };
const ent = (h, w, p, extra = '') => `{"descricaoFaixa":"${h} acertos"${extra},"numeroDeGanhadores":${w},"valorPremio":${p}}`;
function J(x, over = {}, tierOver = {}) {
  const tiers = x.prizeTiers.map((t, i) => { const o = tierOver[t.hits] ?? {}; return ent(t.hits, o.numeroDeGanhadores ?? t.winners.value ?? 0, o.valorPremio ?? toLit(t.prize.cents ?? 100), `,"faixa":${i + 1}`); });
  const o = { numero: String(x.contest), dataApuracao: JSON.stringify(x.drawDate.split('-').reverse().join('/')), listaDezenas: `[${x.numbers.map(n => `"${pad(n)}"`).join(',')}]`, listaRateioPremio: `[${tiers.join(',')}]`, ...over };
  return `{${Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `"${k}":${v}`).join(',')}}`;
}
const meta = { lastContest: 99, xlsxObservedAt: '2026-01-01T00:00:00Z' };
const sampleFor = (l, bytes, over = {}) => ({ lottery: l, origin: 'FASE3B2', url: `https://synthetic.invalid/${l}`, observedAt: '2026-01-02T00:00:00Z', justification: 'SYNTHETIC_DATA', loggedSha256: sha(bytes), loggedBytes: bytes.length, loggedHttpStatus: 200, ...over });
const withFormula = (row, header, h, cached) => { const c = header.indexOf(h); const r = clone(row); const v = r[c]; const orig = typeof v === 'object' && v !== null ? v.v : String(v); r[c] = { f: 'SUM(1,2)', v: cached ?? orig, t: typeof v === 'object' && v && v.t ? v.t : typeof v === 'string' ? 'str' : 'n' }; return r; };
const insertAt = (rows, i, row) => [...rows.slice(0, i), row, ...rows.slice(i)];
const persisted = r => ({ acceptedRecords: r.accepted.map(a => clone(a.record)), quarantine: clone(r.quarantine) });
const perms = a => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])));
const idxJson = idx => JSON.stringify([...idx.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, { ...v, record: v.record ? hashJson(v.record) : null, candidateRecords: undefined }]));
const enc = s => new TextEncoder().encode(s);
const NO_NET = fileURLToPath(new URL('./_no-network.mjs', import.meta.url));
const SCRIPTS = Object.fromEntries(['importar-historico-fase3b2', 'reconciliar-fase3b2', 'verificar-manifestos-fase3b2'].map(n => [n, fileURLToPath(new URL(`../../scripts/${n}.mjs`, import.meta.url))]));
const run = (name, args) => spawnSync(process.execPath, ['--import', NO_NET, SCRIPTS[name], ...args], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' }, timeout: 60000 });
const tmp = p => mkdtempSync(join(tmpdir(), `lotus-synth-${p}-`));

/* ============ §1.1 seleção do registro XLSX: duplicatas físicas e ordem dos arrays ============ */
test('1.1: duplicatas físicas IDÊNTICAS da mesma linha em quarentena contam como UMA candidata (QUARENTENA, não AMBIGUO), em qualquer ordem', () => {
  const r = imp('megasena', { seed: 9, count: 6, mutate: ({ header, rows }) => { const f = withFormula(rows[2], header, 'Bola1'); const rs = [...rows]; rs.splice(2, 1, f, clone(f)); return { header, rows: rs }; } });
  assert.equal(r.quarantine.filter(q => q.candidate && q.candidate.contest === 3).length, 2, 'duas linhas físicas em quarentena');
  const p = persisted(r); const outs = [];
  for (const q of perms(p.quarantine.map((_, i) => i)).slice(0, 6)) {
    const idx = S.buildXlsxRecordIndex({ acceptedRecords: p.acceptedRecords, quarantine: q.map(i => p.quarantine[i]) }); const sel = idx.get(3);
    assert.equal(sel.selection, 'QUARENTENA'); assert.equal(sel.candidates.length, 1); assert.deepEqual(sel.candidates[0].physicalRows.map(x => x.row), [4, 5]);
    assert.equal(sel.record.source.row, 4, 'representante determinístico: menor linha'); outs.push(idxJson(idx));
  }
  assert.ok(outs.every(o => o === outs[0]), 'índice idêntico em todas as ordens');
});
test('1.1: as 5 situações da seleção, com os arrays em TODAS as ordens → resultado idêntico (aceito nunca substituído)', () => {
  const base = imp('quina', { seed: 4, count: 6, mutate: ({ header, rows }) => {
    const rs = [...rows]; const c = header.indexOf('Rateio 5 acertos');
    const f1 = withFormula(rows[1], header, 'Bola1'); // c2: 1 aceito + 1 quarentena
    const a = clone(rows[3]); a[c] = 'R$ abc'; const b = clone(rows[3]); b[c] = 'R$ xyz'; // c4: 0 aceitos, 2 candidatas distintas
    const g = withFormula(rows[4], header, 'Bola2'); // c5: 0 aceitos, 1 em quarentena
    rs.splice(3, 2, a, b, g); return { header, rows: insertAt(rs, 2, f1) };
  } });
  const p = persisted(base); const extraAcc = clone(p.acceptedRecords.find(x => x.contest === 6)); extraAcc.source.row = 99; extraAcc.prizeTiers[0].winners.value = 7; // c6: 2 aceitos
  const acc = [...p.acceptedRecords, extraAcc]; const outs = new Set();
  for (const ao of [acc, [...acc].reverse()]) for (const qo of perms(p.quarantine.map((_, i) => i))) {
    const idx = S.buildXlsxRecordIndex({ acceptedRecords: ao, quarantine: qo.map(i => p.quarantine[i]) });
    assert.equal(idx.get(2).selection, 'ACEITO'); assert.equal(idx.get(2).record.__quarantined, undefined); assert.equal(idx.get(2).quarantineRefs.length, 1);
    assert.equal(idx.get(4).selection, 'AMBIGUO'); assert.equal(idx.get(4).reason, 'MULTIPLOS_CANDIDATOS_EM_QUARENTENA'); assert.equal(idx.get(4).candidates.length, 2);
    assert.equal(idx.get(5).selection, 'QUARENTENA'); assert.equal(idx.get(6).selection, 'AMBIGUO'); assert.equal(idx.get(6).reason, 'MULTIPLOS_REGISTROS_ACEITOS'); assert.equal(idx.get(6).record, null);
    outs.add(idxJson(idx));
  }
  assert.equal(outs.size, 1, 'a ordem dos arrays não muda o resultado (seleção, candidatas e referências)');
});

/* ============ §2.1 fonte XLSX ambígua ≠ dado inválido ============ */
function ambiguousQuina(mut) { // 2 candidatas distintas em quarentena para o concurso 3 (sem aceito)
  const r = imp('quina', { seed: 4, count: 6, mutate: ({ header, rows }) => { const a = clone(rows[2]); const b = clone(rows[2]); mut(header, a, b); const rs = [...rows]; rs.splice(2, 1, a, b); return { header, rows: rs }; } });
  const p = persisted(r); const idx = S.buildXlsxRecordIndex(p); assert.equal(idx.get(3).selection, 'AMBIGUO');
  const x = p.quarantine.find(e => e.candidate && e.candidate.contest === 3).candidate;
  return { idx, x, go: (over = {}, tierOver = {}) => { const bytes = enc(J(x, over, tierOver)); return S.reconcileSample({ sample: sampleFor('quina', bytes), bytes, xlsxRecords: idx, meta }); } };
}
const rateioBoth = (h, a, b) => { const c = h.indexOf('Rateio 5 acertos'); a[c] = 'R$ abc'; b[c] = 'R$ xyz'; };
const noFalse = rows => { for (const q of rows) assert.ok(![C.EQUIVALENTE, C.DIVERGENCIA, C.FORMATACAO, C.REPRESENTACAO].includes(q.class), `${q.field}: ${q.class}`); };
test('2.1 (1): XLSX ambíguo + JSON válido → FONTE_AMBIGUA (nunca DADO_INVALIDO); classe real do JSON preservada; candidatas e motivo preservados', () => {
  assert.equal(C.FONTE_AMBIGUA, 'FONTE_AMBIGUA', 'classe própria');
  const { go, idx, x } = ambiguousQuina(rateioBoth); const out = go();
  assert.equal(out.entry.xlsxStatus, 'AMBIGUO'); assert.equal(out.entry.xlsxAmbiguity.reason, 'MULTIPLOS_CANDIDATOS_EM_QUARENTENA'); assert.deepEqual(out.entry.xlsxAmbiguity.candidates, idx.get(3).candidates);
  assert.deepEqual(out.rows.filter(q => q.class === C.DADO_INVALIDO || q.class === C.VALOR_INVALIDO).map(q => q.field), [], 'JSON válido não vira inválido');
  assert.ok(out.rows.every(q => q.class === C.FONTE_AMBIGUA && q.invalidSource === null && q.xlsxAmbiguous === true && typeof q.jsonFieldClass === 'string'));
  const solo = new Map(compareRecords(null, adaptJsonResult(J(x)), { xlsxLastContest: 99, xlsxObservedAt: meta.xlsxObservedAt, jsonObservedAt: '2026-01-02T00:00:00Z', lottery: 'quina' }).map(q => [q.field, q.class]));
  for (const q of out.rows) assert.equal(q.jsonFieldClass, solo.get(q.field), `${q.field}: classe do JSON isolado`);
  assert.equal(out.entry.classes.FONTE_AMBIGUA, out.rows.length); assert.equal(out.entry.classes.DADO_INVALIDO, undefined); assert.equal(out.quarantine, null); noFalse(out.rows);
});
test('2.1 (2) e (4): XLSX ambíguo + campo JSON inválido → classe de invalidez preservada com origem JSON (nunca AMBOS por causa da ambiguidade)', () => {
  const { go } = ambiguousQuina((h, a, b) => { const c = h.indexOf('Ganhadores 4 acertos'); a[c] = Number(a[c]) + 1; b[c] = Number(b[c]) + 2; a[h.indexOf('Rateio 3 acertos')] = 'R$ abc'; b[h.indexOf('Rateio 3 acertos')] = 'R$ xyz'; });
  const out = go({ dataApuracao: '"31/02/2001"', valorArrecadado: '"x"' }, { 5: { valorPremio: '"abc"' } });
  const by = f => out.rows.find(q => q.field === f);
  for (const [f, cls] of [['drawDate', C.DADO_INVALIDO], ['economic.totalCollected', C.VALOR_INVALIDO], ['tier[5].prize', C.VALOR_INVALIDO]]) {
    const q = by(f); assert.ok(q, f); assert.equal(q.class, cls, f); assert.equal(q.invalidSource, 'JSON', `${f}: origem JSON`); assert.equal(q.jsonValid, false); assert.equal(q.xlsxValid, null, `${f}: invalidez do XLSX NÃO comprovada`); assert.equal(q.xlsxSourceState, 'FONTE_AMBIGUA');
  }
  assert.equal(by('tier[4].winners').class, C.FONTE_AMBIGUA, 'demais campos: ambiguidade, não invalidez'); assert.ok(out.rows.every(q => q.invalidSource !== 'AMBOS')); noFalse(out.rows);
});
test('2.1 (3): XLSX ambíguo + JSON com tipo incorreto → DADO_INVALIDO de origem JSON; campos válidos FONTE_AMBIGUA', () => {
  const { go } = ambiguousQuina(rateioBoth);
  const out = go({ listaDezenas: '"01,02,03,04,05"', listaMunicipioUFGanhadores: '{"a":1}', observacao: '7' });
  for (const f of ['numbers', 'winnerLocations', 'observation']) { const q = out.rows.find(r => r.field === f); assert.equal(q.class, C.DADO_INVALIDO, f); assert.equal(q.invalidSource, 'JSON', f); assert.equal(q.jsonFieldClass, C.DADO_INVALIDO); }
  assert.equal(out.rows.find(r => r.field === 'contest').class, C.FONTE_AMBIGUA); noFalse(out.rows);
});
test('2.1 (5): AMBOS somente com invalidez COMPROVADA em todas as candidatas XLSX e no JSON (evidência por candidata); uma candidata válida → JSON', () => {
  const both = ambiguousQuina(rateioBoth).go({}, { 5: { valorPremio: '"abc"' } });
  const q = both.rows.find(r => r.field === 'tier[5].prize'); assert.equal(q.class, C.VALOR_INVALIDO); assert.equal(q.invalidSource, 'AMBOS'); assert.equal(q.xlsxValid, false);
  assert.equal(q.xlsxCandidatesEvidence.length, 2); assert.ok(q.xlsxCandidatesEvidence.every(e => e.invalid && e.candidate.row));
  const mixed = ambiguousQuina((h, a, b) => { a[h.indexOf('Rateio 5 acertos')] = 'R$ abc'; b[h.indexOf('Rateio 4 acertos')] = 'R$ xyz'; }).go({}, { 5: { valorPremio: '"abc"' } });
  const m = mixed.rows.find(r => r.field === 'tier[5].prize'); assert.equal(m.invalidSource, 'JSON', 'só uma candidata inválida: invalidez do XLSX não comprovada'); assert.equal(m.xlsxValid, null);
  // XLSX único e inválido nas duas fontes (sem ambiguidade): AMBOS continua como antes
  const { x } = ambiguousQuina(rateioBoth); const u = compareRecords(x, adaptJsonResult(J(x, {}, { 5: { valorPremio: '"abc"' } })), { xlsxLastContest: 99, xlsxObservedAt: meta.xlsxObservedAt, jsonObservedAt: meta.xlsxObservedAt, lottery: 'quina' }).find(r => r.field === 'tier[5].prize');
  assert.equal(u.invalidSource, 'AMBOS'); noFalse(both.rows); noFalse(mixed.rows);
});

/* ============ §2.2 / §3.4 UTF-8 estrito ============ */
test('2.2/3.4: bytes UTF-8 inválidos com hash CORRESPONDENTE e JSON aceito após substituição permissiva → CODIFICACAO_INVALIDA, sem parse nem comparação', () => {
  const x = clone(imp('quina', { seed: 3, count: 3 }).accepted[0].record); const okText = J(x, { observacao: '"SYNTHETIC_DATA_X"' });
  const at = enc(okText).indexOf(0x58 /* X */, enc(okText).length - 10);
  for (const [name, seq] of [['0xFF', [0xff]], ['continuação solta', [0x80]], ['overlong', [0xc0, 0xaf]], ['surrogate', [0xed, 0xa0, 0x80]], ['truncada', [0xe2, 0x82]]]) {
    const b0 = enc(okText); const bytes = new Uint8Array([...b0.slice(0, at), ...seq, ...b0.slice(at + 1)]);
    const permissive = JSON.parse(Buffer.from(bytes).toString('utf8')); assert.match(permissive.observacao, /\uFFFD/, `${name}: o decodificador permissivo aceitaria`);
    const s = sampleFor('quina', bytes); const r = S.reconcileSample({ sample: s, bytes, xlsxRecords: new Map([[x.contest, x]]), meta });
    assert.equal(r.status, 'CODIFICACAO_INVALIDA', name); assert.deepEqual(r.rows, [], `${name}: nenhuma comparação`); assert.equal(r.quarantine, null);
    assert.equal(r.entry.provenance.status, S.PROVENANCE.VERIFICADA, `${name}: proveniência ok (o hash bate) — e mesmo assim rejeitada na decodificação`);
    assert.equal(r.entry.provenance.loggedSha256, sha(bytes)); assert.equal(r.entry.provenance.computedSha256, sha(bytes)); assert.equal(r.entry.provenance.observedBytes, bytes.length);
    assert.equal(r.entry.encoding.valid, false); assert.equal(r.entry.encoding.byteLength, bytes.length); assert.equal(r.entry.jsonSha256, sha(bytes)); assert.equal(r.entry.classes, undefined);
    assert.notEqual(r.status, S.SAMPLE_STATUS.JSON_INVALIDO); assert.notEqual(r.status, S.SAMPLE_STATUS.PROVENIENCIA_REJEITADA);
  }
  const good = enc(J(x, { observacao: '"ação ✓ 𝄞"' })); const g = S.reconcileSample({ sample: sampleFor('quina', good), bytes: good, xlsxRecords: new Map([[x.contest, x]]), meta });
  assert.equal(g.status, S.SAMPLE_STATUS.VALIDO, 'UTF-8 multibyte válido continua aceito');
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc(J(x))]); assert.equal(S.reconcileSample({ sample: sampleFor('quina', bom), bytes: bom, xlsxRecords: new Map(), meta }).status, S.SAMPLE_STATUS.JSON_INVALIDO, 'BOM: comportamento anterior preservado');
});

/* ============ §2.4 / §3.5 timestamps de log ============ */
const API = p => `https://servicebus3.caixa.gov.br/portaldeloterias/api/${p}`;
const H64 = 'a'.repeat(64);
const BAD_UTC = [['ausente', undefined, 'TIMESTAMP_UTC_AUSENTE'], ['nulo', null, 'TIMESTAMP_UTC_NULO'], ['tipo incorreto', 1767225600000, 'TIMESTAMP_UTC_TIPO_INCORRETO'], ['string inválida', 'ontem', 'TIMESTAMP_UTC_FORMATO_INVALIDO'], ['data impossível', '2026-02-31T00:00:00Z', 'TIMESTAMP_UTC_DATA_INVALIDA']];
test('2.4/3.5: collectSamples — utc válido, ausente, nulo, tipo incorreto e string inválida (3b.2 e 3b.1): só a linha ruim é rejeitada, com origem/linha/motivo; as válidas seguem', () => {
  const line = (c, utc, extra) => JSON.stringify({ url: API(`quina/${c}`), ...(utc === undefined ? {} : { utc }), status: 200, sha256: H64, ...extra });
  const priv = [line(1, '2026-01-01T00:00:00.123Z', { bytes: 1, file: `json/quina/1-${H64}.json` }), ...BAD_UTC.map(([, u], i) => line(10 + i, u, { bytes: 1, file: `json/quina/${10 + i}-${H64}.json` })), line(2, '2026-01-02T00:00:00Z', { bytes: 1, file: `json/quina/2-${H64}.json` })].join('\n');
  const ex = [line(3, '2026-11-04T01:10:03.823235+00:00', { size: 1, file: 'raw/GET_q3' }), ...BAD_UTC.map(([, u], i) => line(20 + i, u, { size: 1, file: `raw/GET_q${20 + i}` })), line(4, '2026-11-04T01:10:06Z', { size: 1, file: 'raw/GET_q4' })].join('\n');
  let r; assert.doesNotThrow(() => { r = S.collectSamples({ privateLogText: priv, extraLogText: ex }); }, 'uma linha inválida não interrompe a coleta');
  assert.deepEqual(r.samples.map(s => [s.origin, s.url.split('/').pop(), s.observedAt]), [['FASE3B2', '1', '2026-01-01T00:00:00.123Z'], ['FASE3B2', '2', '2026-01-02T00:00:00Z'], ['FASE3B1', '3', '2026-11-04T01:10:03.823Z'], ['FASE3B1', '4', '2026-11-04T01:10:06.000Z']]);
  assert.deepEqual(r.rejected.map(x => [x.origin, x.line, x.reason]), [...BAD_UTC.map(([, , why], i) => ['FASE3B2', 2 + i, why]), ...BAD_UTC.map(([, , why], i) => ['FASE3B1', 2 + i, why])]);
});
test('2.4/3.5: planImportFromLog (importação 3b.1) — utc inválido rejeita só a linha, com número e motivo; as válidas seguem', () => {
  assert.equal(typeof IL.planImportFromLog, 'function', 'extração testável do log de importação');
  const dl = (m, utc, extra = {}) => JSON.stringify({ url: API(`resultados/download?modalidade=${m}`), method: 'GET', status: 200, ...(utc === undefined ? {} : { utc }), sha256: H64, file: `raw/GET_${m}`, headers: {}, ...extra });
  const text = [dl('Mega-Sena', '2026-11-04T01:12:20.723267+00:00'), ...BAD_UTC.map(([, u]) => dl('Quina', u)), '{quebrada', dl('Lotof%C3%A1cil', '2026-11-04T01:12:23Z'), dl('Quina', '2026-11-04T01:12:28Z'), dl('Lotomania', '2026-11-04T01:12:32Z')].join('\n');
  const r = IL.planImportFromLog(text);
  assert.deepEqual(r.items.map(i => [i.line, i.lottery, i.collectedAt]), [[1, 'megasena', '2026-11-04T01:12:20.723Z'], [8, 'lotofacil', '2026-11-04T01:12:23.000Z'], [9, 'quina', '2026-11-04T01:12:28.000Z'], [10, 'lotomania', '2026-11-04T01:12:32.000Z']]);
  assert.deepEqual(r.rejected.map(x => [x.line, x.reason]), [...BAD_UTC.map(([, , why], i) => [2 + i, why]), [7, 'LINHA_NAO_JSON']]);
});

/* ============ §3.1 V13 — elegíveis conflitantes com a MESMA data válida ============ */
test('3.1: dois elegíveis do mesmo concurso, MESMA data válida e conteúdo divergente → conflito V11+V14 registrado, data comum não é conflito, nada declarado idêntico, independente da ordem', () => {
  const res = [];
  for (const pos of [2, 3]) {
    const r = imp('megasena', { seed: 6, count: 7, mutate: ({ header, rows }) => { const d = clone(rows[2]); const c = header.indexOf('Ganhadores 6 acertos'); d[c] = Number(d[c]) + 3; return { header, rows: insertAt(rows, pos, d) }; } });
    const conf = r.conflicts.filter(c => c.contest === 3); assert.equal(conf.length, 1, 'conflito registrado'); assert.deepEqual(conf[0].rows, [4, 5]);
    assert.ok(conf[0].diffs[0].fields.some(f => /winners/.test(f.path)), 'diferença de conteúdo evidenciada'); assert.ok(!conf[0].diffs[0].fields.some(f => /drawDate/.test(f.path)), 'a data comum não é diferença');
    assert.deepEqual(r.duplicatesIdentical.filter(d => d.contest === 3), [], 'nunca "idêntico" só por compartilhar a data');
    assert.deepEqual(r.report.chronologyExclusions.filter(e => e.contest === 3), [], 'mesma data → não é DATAS_CONFLITANTES'); assert.deepEqual(r.dateAnomalies, []);
    assert.ok(r.quarantine.some(q => q.reasons.some(x => x.code === Q.CONCURSO_DUPLICADO_CONFLITANTE)));
    res.push({ conf: conf.map(c => ({ rows: c.rows, fields: c.diffs.map(d => d.fields.map(f => f.path)) })), excl: r.report.chronologyExclusions, an: r.dateAnomalies, acc: r.accepted.map(a => a.record.contest) });
  }
  assert.deepEqual(res[0], res[1], 'independente da ordem física');
});

/* ============ §1.5 / §3.2 winnerLocations — registro XLSX inteiro ausente ============ */
test('1.5/3.2: winnerLocations sem registro XLSX → ausência da FONTE (registro inexistente), nunca EQUIVALENTE nem conclusão semântica (com e sem localidades no JSON)', () => {
  for (const l of MODS) {
    const x = clone(imp(l, { seed: 3, count: 3 }).accepted[0].record);
    for (const W of ['[{"municipio":"CIDADE","uf":"UF","ganhadores":1}]', '[]']) {
      const bytes = enc(J(x, { listaMunicipioUFGanhadores: W }));
      const out = S.reconcileSample({ sample: sampleFor(l, bytes), bytes, xlsxRecords: new Map(), meta });
      assert.equal(out.entry.xlsxStatus, 'AUSENTE'); const w = out.rows.filter(r => r.field === 'winnerLocations'); assert.equal(w.length, 1);
      assert.equal(w[0].class, C.AUSENTE, `${l} ${W}`); assert.equal(w[0].absenceScope, 'REGISTRO_XLSX_INEXISTENTE', `${l} ${W}: ausência do registro, não do campo`); assert.equal(w[0].xlsxRecordPresent, false);
      assert.equal(w[0].correspondence, 'HIPOTESE'); assert.doesNotMatch(w[0].note, /duas fontes/); assert.ok(![C.EQUIVALENTE, C.SEMANTICA, C.REPRESENTACAO].includes(w[0].class));
    }
  }
});

/* ============ §2.3 / §3.3 ordem autoritativa das execuções ============ */
function backdatedRuns() {
  const L = new M.ManifestLedger(); const lines = [];
  const ledger = { latest: id => L.latest(id), submit: m => { const r = L.submit(m); if (r.accepted) lines.push(JSON.stringify(m)); return r; } };
  const inputs = seed => MODS.map(l => ({ lottery: l, bytes: syntheticWorkbook(l, { seed }), meta: SYNTH_META(l) }));
  const persist = (createdAt, r) => ({ runId: `import-${createdAt.replace(/[-:]/g, '')}`, runManifestFile: { action: r.run.runAction, manifest: clone(r.run.runManifest) }, runReport: clone(r.run.runReport),
    modalities: r.results.map(res => { const mod = r.run.modality.find(m => m.lottery === res.lottery); return { lottery: res.lottery, manifestFile: { action: mod.action, manifest: clone(mod.manifest) },
      imp: { report: clone(res.imp.report), quarantine: clone(res.imp.quarantine), duplicatesIdentical: clone(res.imp.duplicatesIdentical), accepted: res.imp.accepted.map(a => ({ record: clone(a.record) })) }, collection: clone(res.collection), rawBytes: rawBytes(res.envelope) }; }) });
  // ordem REAL: A (NEW, 05/03) → B (replay, 06/03) → C (NEW, --created-at RETROATIVO 01/01) → D (replay de C, 02/01)
  const steps = [['2026-03-05T00:00:00Z', 5], ['2026-03-06T00:00:00Z', 5], ['2026-01-01T00:00:00Z', 8], ['2026-01-02T00:00:00Z', 8]];
  const runs = steps.map(([t, seed]) => persist(t, runPipeline({ inputs: inputs(seed), ledger, runId: 'x', createdAt: t })));
  return { runs, ledgerText: lines.join('\n') + '\n', lines };
}
test('2.3/3.3: execução posterior com createdAt RETROATIVO → verificação pela sequência do ledger (nunca runId/pasta), sem falsa inconsistência; aviso de createdAt', () => {
  const p = backdatedRuns(); assert.deepEqual(p.runs.map(r => r.runManifestFile.action), ['NEW', 'UNCHANGED_REPLAY', 'NEW', 'UNCHANGED_REPLAY']);
  assert.deepEqual([...p.runs.map(r => r.runId)].sort(), [p.runs[2].runId, p.runs[3].runId, p.runs[0].runId, p.runs[1].runId], 'o nome da pasta inverte a ordem real');
  for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]]) {
    const v = M.verifyPersistedRuns({ ledgerText: p.ledgerText, runs: order.map(i => p.runs[i]) });
    assert.ok(v.ok, JSON.stringify(v.errors.map(e => e.code))); assert.equal(v.runManifestsVerified, 4); assert.equal(v.modalityManifestsVerified, 16);
    assert.deepEqual(v.order, p.runs.map(r => r.runId), 'ordem = ledger'); assert.ok(v.warnings.some(w => w.code === 'RUN_CREATED_AT_NOT_MONOTONIC' && w.run === p.runs[2].runId));
  }
  // as adulterações continuam detectadas com a nova ordenação
  const q = backdatedRuns(); q.runs[3].runManifestFile.action = 'NEW'; assert.ok(M.verifyPersistedRuns(q).errors.some(e => e.code === 'RUN_SEQUENCE_INCONSISTENT'));
  const r2 = backdatedRuns(); r2.runs[1].runManifestFile = clone(r2.runs[2].runManifestFile); r2.runs[1].runManifestFile.action = 'UNCHANGED_REPLAY'; assert.equal(M.verifyPersistedRuns(r2).ok, false);
  const r3 = backdatedRuns(); r3.runs.splice(2, 1); assert.ok(M.verifyPersistedRuns(r3).errors.some(e => e.code === 'LEDGER_ENTRY_WITHOUT_RUN' || e.code === 'RUN_REPLAY_INCONSISTENT'));
});
test('2.3/3.3: seleção da execução da reconciliação offline = NEW da última sequence do ledger (não a última por nome)', () => {
  assert.equal(typeof M.selectLatestRun, 'function');
  const p = backdatedRuns(); const files = p.runs.map(r => ({ runId: r.runId, runManifestFile: r.runManifestFile }));
  const old = [...files].sort((a, b) => (a.runId < b.runId ? -1 : 1)).filter(r => r.runManifestFile.action === 'NEW').pop().runId; assert.equal(old, p.runs[0].runId, 'critério antigo escolheria a execução ANTIGA');
  for (const f of [files, [...files].reverse()]) { const s = M.selectLatestRun({ ledgerText: p.ledgerText, runs: f }); assert.equal(s.ok, true); assert.equal(s.runId, p.runs[2].runId); assert.equal(s.sequence, 2); }
  assert.equal(M.selectLatestRun({ ledgerText: p.ledgerText, runs: files.filter(f => f.runId !== p.runs[2].runId) }).reason, 'EXECUCAO_NEW_DA_ULTIMA_SEQUENCIA_AUSENTE');
  assert.equal(M.selectLatestRun({ ledgerText: p.lines.slice(1).join('\n'), runs: files }).reason, 'LEDGER_INVALIDO');
});

/* ============ scripts de ponta a ponta (dados SINTÉTICOS em diretórios temporários) ============ */
const MOD_Q = { megasena: 'Mega-Sena', lotofacil: 'Lotof%C3%A1cil', quina: 'Quina', lotomania: 'Lotomania' };
function src3b1(seed, { extraLines = [], fileFor = l => `raw/GET_download_${l}` } = {}) {
  const dir = tmp('src3b1'); mkdirSync(join(dir, 'raw'));
  const lines = MODS.map((l, i) => { const b = syntheticWorkbook(l, { seed, count: 8 }); writeFileSync(join(dir, `raw/GET_download_${l}`), b);
    return JSON.stringify({ n: i + 1, utc: `2026-01-01T00:00:0${i}.123456+00:00`, method: 'GET', url: API(`resultados/download?modalidade=${MOD_Q[l]}`), status: 200, sha256: sha(b), size: b.length, file: fileFor(l), headers: { 'Content-Type': 'application/xlsx', 'Content-Disposition': `attachment; filename="SYNTHETIC_DATA_${l}.xlsx"` } }); });
  writeFileSync(join(dir, 'request_log.jsonl'), [...lines, ...extraLines].join('\n') + '\n'); return dir;
}
function snapshot(dir) { const out = {}; const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); const st = lstatSync(p); if (st.isDirectory()) walk(p); else out[p] = `${st.size}:${st.mtimeMs}:${sha(readFileSync(p))}`; } }; walk(dir); return out; }
test('2.3/3.3 + 2.4 (scripts): 3 importações reais do script, a 3ª com --created-at retroativo → verificador ok na ordem do ledger; reconciliação usa a execução retroativa (sequence 2); linha 3b.1 com utc inválido não aborta', () => {
  const priv = join(tmp('priv'), 'p');
  const s1 = src3b1(11); const s2 = src3b1(11); const s3 = src3b1(12);
  // linha extra da Quina com arquivo EXISTENTE e sha256 correto, mas utc inválido: só ela é rejeitada (antes: RangeError abortava)
  const q3 = readFileSync(join(s3, 'raw/GET_download_quina')); writeFileSync(join(s3, 'request_log.jsonl'), readFileSync(join(s3, 'request_log.jsonl'), 'utf8') + JSON.stringify({ url: API('resultados/download?modalidade=Quina'), method: 'GET', status: 200, utc: 'nao-e-data', sha256: sha(q3), file: 'raw/GET_download_quina', headers: {} }) + '\n');
  for (const [src, t, act] of [[s1, '2026-03-05T00:00:00Z', 'NEW'], [s2, '2026-03-06T00:00:00Z', 'UNCHANGED_REPLAY'], [s3, '2026-01-01T00:00:00Z', 'NEW']]) {
    const r = run('importar-historico-fase3b2', ['--private', priv, '--from-3b1', src, '--created-at', t]);
    assert.equal(r.status, 0, `${t}: ${r.stderr}`); const sum = JSON.parse(r.stdout); assert.equal(sum.runAction, act);
    if (src === s3) { assert.deepEqual(sum.rejectedLogLines.map(x => [x.line, x.reason]), [[5, 'TIMESTAMP_UTC_FORMATO_INVALIDO']]); assert.match(r.stderr, /TIMESTAMP_UTC_FORMATO_INVALIDO/); }
  }
  const r3 = run('importar-historico-fase3b2', ['--private', priv, '--from-3b1', s3, '--created-at', '2026-01-01T00:00:00Z']);
  assert.notEqual(r3.status, 0, 'pasta de execução existente recusada'); assert.equal(readFileSync(join(priv, 'ledger/manifests.jsonl'), 'utf8').trim().split('\n').length, 10, 'sem linha órfã no ledger');
  assert.equal(run('importar-historico-fase3b2', ['--private', priv, '--from-3b1', s1, '--created-at', '2026-13-45T99:00:00Z']).status, 2, '--created-at inválido recusado');
  const v = run('verificar-manifestos-fase3b2', ['--private', priv]); const vj = JSON.parse(v.stdout);
  assert.equal(v.status, 0, JSON.stringify(vj.errors)); assert.deepEqual(vj.order, ['import-20260305T000000Z', 'import-20260306T000000Z', 'import-20260101T000000Z']); assert.ok(vj.warnings.some(w => w.code === 'RUN_CREATED_AT_NOT_MONOTONIC'));
  const out = tmp('out'); const rc = run('reconciliar-fase3b2', ['--private', priv, '--out', out]);
  assert.equal(rc.status, 0, rc.stderr); const rj = JSON.parse(rc.stdout); assert.equal(rj.importRun, 'import-20260101T000000Z'); assert.equal(rj.importRunSequence, 2);
  assert.equal(existsSync(join(priv, 'reconciliation')), false, 'saída só em --out');
});

/* ============ §4 confinamento real no sistema de arquivos ============ */
test('4 (1–4, 6): confinamento — normal ok; "../" recusado; diretório intermediário e arquivo final simbólicos recusados em leitura, escrita e acréscimo; nada externo lido/criado/alterado', () => {
  for (const f of ['readConfined', 'writeOnceConfined', 'appendConfined', 'existsConfined', 'listDirConfined']) assert.equal(typeof ST[f], 'function', f);
  const root = tmp('root'); const outside = tmp('outside'); writeFileSync(join(outside, 'segredo.json'), '{"SYNTHETIC_DATA":"externo"}'); mkdirSync(join(outside, 'd'));
  const before = snapshot(outside);
  // 1. normal
  assert.equal(ST.writeOnceConfined(root, 'json/quina/1.json', '{"a":1}', { prefix: 'json/' }), 'WRITTEN'); assert.equal(ST.readConfined(root, 'json/quina/1.json').toString(), '{"a":1}');
  assert.equal(ST.writeOnceConfined(root, 'json/quina/1.json', '{"a":1}'), 'EXISTING_IDENTICAL'); assert.throws(() => ST.writeOnceConfined(root, 'json/quina/1.json', '{"a":2}'), /recusa de sobrescrita/);
  ST.appendConfined(root, 'ledger/m.jsonl', 'x\n'); ST.appendConfined(root, 'ledger/m.jsonl', 'y\n'); assert.equal(ST.readConfined(root, 'ledger/m.jsonl').toString(), 'x\ny\n'); assert.equal(ST.existsConfined(root, 'json/nada.json'), false);
  // 2. travessia
  for (const rel of ['../x', 'json/../../x', 'raw/../../etc/passwd', '/etc/passwd']) for (const f of [() => ST.readConfined(root, rel), () => ST.writeOnceConfined(root, rel, 'z'), () => ST.appendConfined(root, rel, 'z')]) assert.throws(f, e => e.name === 'ConfinementError', rel);
  // 3. diretório intermediário simbólico → fora
  symlinkSync(outside, join(root, 'json', 'lotomania')); symlinkSync(join(outside, 'd'), join(root, 'runs'));
  for (const f of [() => ST.readConfined(root, 'json/lotomania/segredo.json'), () => ST.existsConfined(root, 'json/lotomania/segredo.json'), () => ST.writeOnceConfined(root, 'json/lotomania/novo.json', 'z'), () => ST.appendConfined(root, 'json/lotomania/segredo.json', 'z'), () => ST.listDirConfined(root, 'runs'), () => ST.writeOnceConfined(root, 'runs/import-1/a.json', 'z')])
    assert.throws(f, e => e.name === 'ConfinementError' && /LINK_SIMBOLICO/.test(e.code));
  // 4. arquivo final simbólico → fora (e link pendente)
  symlinkSync(join(outside, 'segredo.json'), join(root, 'json', 'quina', '2.json')); symlinkSync(join(outside, 'inexistente.json'), join(root, 'json', 'quina', '3.json'));
  for (const f of [() => ST.readConfined(root, 'json/quina/2.json'), () => ST.existsConfined(root, 'json/quina/2.json'), () => ST.writeOnceConfined(root, 'json/quina/2.json', 'z'), () => ST.appendConfined(root, 'json/quina/2.json', 'z'), () => ST.writeOnceConfined(root, 'json/quina/3.json', 'z'), () => ST.appendConfined(root, 'json/quina/3.json', 'z')])
    assert.throws(f, e => e.name === 'ConfinementError' && e.code === 'LINK_SIMBOLICO_NO_ARQUIVO');
  // 6. nada externo criado/alterado (inclusive pelo link pendente)
  assert.deepEqual(snapshot(outside), before); assert.equal(existsSync(join(outside, 'inexistente.json')), false); assert.deepEqual(readdirSync(join(outside, 'd')), []);
  assert.ok(ST.CONFINEMENT_CAPABILITIES.lstatComponents);
});
test('4 (5, 6): scripts — log com "raw/../../…" e links simbólicos: importador recusa sem ler/copiar o externo; reconciliação recusa a amostra; verificador recusa runs simbólico; nada externo alterado', () => {
  const outside = tmp('outside'); const secret = syntheticWorkbook('quina', { seed: 99, count: 8 }); writeFileSync(join(outside, 'segredo.xlsx'), secret); const before = snapshot(outside);
  // importador: a linha da Quina aponta para fora (raw/../../<outside>/segredo.xlsx) com o sha256 do arquivo externo
  const probe = src3b1(21); const depth = probe.split('/').filter(Boolean).length;
  const travel = `raw/${'../'.repeat(depth + 1)}${outside.replace(/^\//, '')}/segredo.xlsx`;
  const s = src3b1(21, { fileFor: l => (l === 'quina' ? travel : `raw/GET_download_${l}`) });
  const lines = readFileSync(join(s, 'request_log.jsonl'), 'utf8').trim().split('\n').map(x => JSON.parse(x)); lines[2].sha256 = sha(secret); writeFileSync(join(s, 'request_log.jsonl'), lines.map(x => JSON.stringify(x)).join('\n') + '\n');
  const priv = join(tmp('priv'), 'p'); const r = run('importar-historico-fase3b2', ['--private', priv, '--from-3b1', s]);
  assert.notEqual(r.status, 0, 'importação recusada'); assert.match(r.stderr, /SEGMENTO_PROIBIDO_NO_CAMINHO/); assert.equal(existsSync(join(priv, 'raw', 'quina', `${sha(secret)}.xlsx`)), false, 'arquivo externo NÃO copiado');
  assert.equal(existsSync(join(priv, 'ledger')), false, 'nada importado');
  // importador: diretório privado com "runs" simbólico para fora → recusa ANTES de escrever fora
  const priv2 = join(tmp('priv'), 'p'); mkdirSync(priv2); symlinkSync(outside, join(priv2, 'runs'));
  const r2 = run('importar-historico-fase3b2', ['--private', priv2, '--from-3b1', src3b1(22)]); assert.notEqual(r2.status, 0); assert.match(r2.stderr, /LINK_SIMBOLICO_NO_CAMINHO/);
  // verificador: runs simbólico → recusa explícita
  const v = run('verificar-manifestos-fase3b2', ['--private', priv2]); assert.equal(v.status, 1); assert.match(v.stdout, /LINK_SIMBOLICO_NO_CAMINHO/);
  // reconciliação: amostra json/quina simbólica → recusada pelo confinamento, sem leitura; demais seguem
  const priv3 = join(tmp('priv'), 'p'); assert.equal(run('importar-historico-fase3b2', ['--private', priv3, '--from-3b1', src3b1(23)]).status, 0);
  const js = enc('{"numero":1}'); writeFileSync(join(outside, 'amostra.json'), js); const before2 = snapshot(outside);
  mkdirSync(join(priv3, 'json')); symlinkSync(outside, join(priv3, 'json', 'quina'));
  writeFileSync(join(priv3, 'request_log.jsonl'), JSON.stringify({ n: 1, utc: '2026-01-01T00:00:00Z', method: 'GET', url: API('quina/1'), status: 200, bytes: js.length, sha256: sha(js), file: 'json/quina/amostra.json', justification: 'SYNTHETIC_DATA' }) + '\n');
  const out = tmp('out'); const rc = run('reconciliar-fase3b2', ['--private', priv3, '--out', out]); assert.equal(rc.status, 0, rc.stderr);
  const rj = JSON.parse(rc.stdout); assert.equal(rj.samples, 0, 'amostra externa não lida'); assert.equal(rj.rejectedSampleFiles, 1); assert.match(rc.stderr, /LINK_SIMBOLICO_NO_CAMINHO/);
  assert.deepEqual(snapshot(outside), before2); assert.deepEqual(Object.keys(before).every(k => before2[k] === before[k]), true, 'nada externo alterado');
  void statSync;
});
