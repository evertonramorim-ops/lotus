// SYNTHETIC_DATA — adaptadores, normalização, validadores V01–V15 e quarentena (nada é descartado).
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp, setCell, chain, reasons } from './_h.js';
import { XLSX_ADAPTERS } from '../../src/historical/adapters/index.js';
import { Q } from '../../src/historical/codes.js';
import { parseBrlText, decimalLiteralToCents, excelSerialToIso, parseBrDate } from '../../src/historical/values.js';
import { periodFor } from '../../src/historical/tier-rules.js';
import { fixtureCatalog } from './_fixtures.js';

const L4 = ['megasena', 'lotofacil', 'quina', 'lotomania'];
const conserved = r => { const c = r.report.counts; assert.equal(c.accepted + c.quarantinedRecords + c.duplicatesIdentical, c.normalized, 'conservação: nenhum registro descartado'); };

test('8 códigos de quarentena exigidos existem', () => {
  for (const k of ['DATA_NAO_MONOTONICA', 'CELULA_TIPO_INVALIDO', 'DIVERGENCIA_JSON_XLSX', 'SCHEMA_INESPERADO', 'CONCURSO_DUPLICADO_CONFLITANTE', 'CONCURSO_AUSENTE', 'VALOR_MONETARIO_INVALIDO', 'REGRA_HISTORICA_NAO_VERIFICADA']) assert.equal(Q[k], k);
});

test('4 adaptadores versionados: importação sintética limpa', () => {
  for (const l of L4) {
    assert.ok(XLSX_ADAPTERS[l].version);
    const r = imp(l, { count: 15, seed: 11 });
    assert.equal(r.status, 'IMPORTED', l); assert.equal(r.report.counts.accepted, 15); assert.equal(r.quarantine.length, 0); conserved(r);
    const rec = r.accepted[0].record;
    assert.equal(rec.orderAvailable, false); assert.equal(rec.drawOrder, null);
    assert.equal(rec.source.rawSha256, r.collection.sha256); assert.ok(rec.source.row >= 2);
    assert.ok(r.accepted[0].annotations.includes('RULE_NOT_VERIFIED'));
  }
});

test('valores: dinheiro BRL estrito → centavos; literal decimal; datas texto e serial', () => {
  assert.equal(parseBrlText('R$1.234,56').cents, '123456');
  assert.equal(parseBrlText('R$0,00').cents, '0');
  for (const bad of ['1.234,56', 'R$1,2', 'R$ 12,00x', 'R$1.23,00']) assert.equal(parseBrlText(bad).valid, false, bad);
  assert.equal(decimalLiteralToCents('30598.43').cents, '3059843');
  assert.equal(decimalLiteralToCents('0.125').valid, false);
  assert.equal(parseBrDate('29/02/2023'), null); assert.equal(parseBrDate('29/02/2024'), '2024-02-29');
  assert.equal(excelSerialToIso('45292', false), '2024-01-01'); assert.equal(excelSerialToIso('60', false), null);
});

test('data como serial Excel numérico é aceita e marcada; data inválida → quarentena', () => {
  const r = imp('megasena', { mutate: setCell(0, 'Data do Sorteio', 36897) });
  assert.equal(r.accepted[0].record.drawDate, '2001-01-06');
  assert.equal(r.accepted[0].record.drawDateField.representation, 'EXCEL_SERIAL_1900');
  const r2 = imp('megasena', { mutate: setCell(2, 'Data do Sorteio', '31/02/2001') });
  assert.ok(reasons(r2).includes(Q.DATA_INVALIDA)); conserved(r2);
});

test('célula vazia obrigatória, "-" fora do período e texto em número → quarentena tipada', () => {
  const r = imp('quina', { mutate: chain(setCell(0, 'Bola1', null), setCell(1, 'Ganhadores 4 acertos', { t: 'n', v: 'abc' }), setCell(2, 'Rateio 3 acertos', { t: 'n', v: '-' }), setCell(3, 'Ganhadores 3 acertos', { t: 'n', v: '-' })) });
  const rs = reasons(r);
  assert.ok(rs.includes(Q.QUANTIDADE_DEZENAS_INCORRETA));
  assert.ok(rs.includes(Q.CELULA_TIPO_INVALIDO));
  assert.ok(rs.includes(Q.REGRA_HISTORICA_NAO_VERIFICADA));
  conserved(r); assert.equal(r.report.counts.quarantinedRecords, 4);
});

test('valor monetário inválido → VALOR_MONETARIO_INVALIDO; R$0,00 vira 0 anotado (não null)', () => {
  const r = imp('lotofacil', { mutate: chain(setCell(0, 'Rateio 15 acertos', 'R$12,3'), setCell(1, 'Arrecadacao Total', 'R$0,00')) });
  assert.ok(reasons(r).includes(Q.VALOR_MONETARIO_INVALIDO));
  const a = r.accepted.find(x => x.record.source.row === 3);
  assert.equal(a.record.economic.totalCollected.cents, '0'); assert.ok(a.annotations.includes('ZERO_LITERAL_SEMANTICS_UNVERIFIED'));
});

test('dezena fora do intervalo, quantidade errada, dezena repetida', () => {
  const r = imp('megasena', { mutate: chain(setCell(0, 'Bola6', { t: 'n', v: '61' }), setCell(1, 'Bola2', { t: 'n', v: '00' }), setCell(2, 'Bola3', null)) });
  const rs = reasons(r);
  assert.ok(rs.includes(Q.DEZENA_FORA_DO_INTERVALO)); assert.ok(rs.includes(Q.QUANTIDADE_DEZENAS_INCORRETA));
  const r2 = imp('lotomania', { mutate: ({ header, rows }) => { rows[0][header.indexOf('Bola2')] = rows[0][header.indexOf('Bola1')]; return { header, rows }; } });
  assert.ok(reasons(r2).includes(Q.DEZENA_REPETIDA)); conserved(r2);
  const q = r.quarantine.find(x => x.reasons.some(y => y.code === Q.DEZENA_FORA_DO_INTERVALO)).reasons.find(y => y.code === Q.DEZENA_FORA_DO_INTERVALO);
  for (const k of ['validatorId', 'validatorVersion', 'rule', 'originalValue', 'reviewStatus', 'lottery', 'contest', 'evidence']) assert.ok(k in q, k);
  assert.equal(q.humanDecision, null); assert.equal(q.originalValue, '61');
});

test('V11/V14 duplicata idêntica (1 concurso) × conflitante (quarentena com diff campo a campo)', () => {
  const dup = imp('quina', { mutate: ({ header, rows }) => ({ header, rows: [...rows.slice(0, 5), [...rows[4]], ...rows.slice(5)] }) });
  assert.equal(dup.report.counts.duplicatesIdentical, 1); assert.equal(dup.report.counts.accepted, 12); assert.equal(dup.quarantine.length, 0);
  assert.equal(dup.duplicatesIdentical[0].contest, 5); conserved(dup);
  const conf = imp('quina', { mutate: ({ header, rows }) => { const c = [...rows[4]]; c[header.indexOf('Ganhadores 4 acertos')] = 9999; return { header, rows: [...rows.slice(0, 5), c, ...rows.slice(5)] }; } });
  const qs = conf.quarantine.filter(q => q.reasons.some(r => r.code === Q.CONCURSO_DUPLICADO_CONFLITANTE));
  assert.equal(qs.length, 2); assert.equal(conf.report.counts.accepted, 11); conserved(conf);
  const diff = qs[0].reasons[0].evidence.diffs[0].fields;
  assert.ok(diff.some(d => d.path.includes('prizeTiers') && d.b === 9999 || d.b === '9999'));
});

test('V12 lacuna → CONCURSO_AUSENTE (não resolvida), sem inventar o concurso', () => {
  const r = imp('megasena', { mutate: ({ header, rows }) => ({ header, rows: rows.filter((_, i) => i !== 6) }) });
  // [3b.2-integral 4.3] formato de lacunas versionado (lotus.gap-ranges/1.0.0): intervalos compactos em vez de lista
  // expandida (a lista crescia com o maior concurso). Mesma informação: o concurso 7, contagem 1.
  assert.deepEqual(r.gapRanges, [{ from: 7, to: 7, count: 1 }]); assert.equal(r.missingCount, 1);
  const q = r.quarantine.find(x => x.reasons[0].code === Q.CONCURSO_AUSENTE);
  assert.equal(q.candidate, null); assert.equal(q.reasons[0].resolution, 'LACUNA_NAO_RESOLVIDA');
  assert.equal(r.report.coverage.contiguous, false); assert.equal(r.report.coverage.completenessClaim, 'NAO_DECLARADA');
});

test('V13 data não monotônica: outlier isolado e inversão de par, sem corrigir', () => {
  const r = imp('quina', { mutate: setCell(5, 'Data Sorteio', '01/01/1999') });
  const q = r.quarantine.filter(x => x.reasons.some(y => y.code === Q.DATA_NAO_MONOTONICA));
  assert.equal(q.length, 1); assert.equal(q[0].candidate.contest, 6); assert.equal(q[0].candidate.drawDate, '1999-01-01');
  assert.equal(q[0].reasons.find(y => y.code === Q.DATA_NAO_MONOTONICA).evidence.classification, 'ISOLATED_OUTLIER');
  const r2 = imp('quina', { mutate: ({ header, rows }) => { const d = header.indexOf('Data Sorteio'); const t = rows[11][d]; rows[11][d] = rows[10][d]; rows[10][d] = t; return { header, rows }; } });
  const q2 = r2.quarantine.filter(x => x.reasons.some(y => y.code === Q.DATA_NAO_MONOTONICA));
  assert.ok(q2.length >= 1); conserved(r2);
});

test('V07 mudança de faixa por período (Lotomania 1652/1653 observado) e estrutura inesperada', () => {
  assert.deepEqual(periodFor('lotomania', 1652).presentTiers.includes(15), false);
  assert.deepEqual(periodFor('lotomania', 1653).presentTiers.includes(15), true);
  const r = imp('lotomania', {}, fixtureCatalog().lotomania_tier_change);
  assert.equal(r.report.counts.accepted, 10); assert.equal(r.report.counts.quarantinedRecords, 0);
  assert.equal(r.report.counts.missingContests, 1647); // arquivo começa em 1648: 1..1647 viram CONCURSO_AUSENTE
  assert.ok(r.accepted.filter(a => a.record.contest <= 1652).every(a => a.annotations.includes('ABSENT_BY_PERIOD_RULE')));
  const bad = imp('lotomania', { startContest: 1648, count: 10, seed: 3, mutate: setCell(0, 'Ganhadores 15 acertos', 3) });
  assert.ok(reasons(bad).includes(Q.REGRA_HISTORICA_NAO_VERIFICADA));
});

test('V15 esquema: coluna desconhecida/ordem → SCHEMA_INESPERADO (importa); coluna obrigatória ausente → arquivo rejeitado', () => {
  const r = imp('megasena', { mutate: ({ header, rows }) => ({ header: [...header, 'Coluna Nova'], rows: rows.map(x => [...x, 'v']) }) });
  assert.equal(r.status, 'IMPORTED'); assert.ok(reasons(r).includes(Q.SCHEMA_INESPERADO));
  assert.ok(r.accepted[0].record.extras.some(e => e.header === 'Coluna Nova'));
  const r2 = imp('megasena', { mutate: ({ header, rows }) => { const i = header.indexOf('Bola6'); return { header: header.filter((_, k) => k !== i), rows: rows.map(x => x.filter((_, k) => k !== i)) }; } });
  assert.equal(r2.status, 'REJECTED'); assert.ok(reasons(r2).includes(Q.ARQUIVO_INCOMPATIVEL)); assert.equal(r2.accepted.length, 0);
  const r3 = imp('megasena', { mutate: ({ header, rows }) => { header[header.indexOf('Data do Sorteio')] = 'Data'; return { header, rows }; } });
  assert.equal(r3.status, 'REJECTED');
  const r4 = imp('megasena', { sheetName: 'OUTRA' });
  assert.ok(r4.report.schemaAlerts.includes('SHEET_NAME_CHANGED'));
});

test('arquivo malicioso vira quarentena de arquivo (ARQUIVO_INCOMPATIVEL) — bruto preservado', () => {
  const F = fixtureCatalog();
  for (const n of ['mal_zip_bomb', 'mal_doctype', 'mal_vba', 'mal_path_traversal', 'mal_corrupt']) {
    const r = imp('megasena', {}, F[n]);
    assert.equal(r.status, 'REJECTED', n); assert.equal(r.quarantine[0].reasons[0].code, Q.ARQUIVO_INCOMPATIVEL);
    assert.ok(r.quarantine[0].reasons[0].evidence.parserErrorCode);
    assert.equal(r.envelope.sha256, r.collection.sha256);
  }
});

test('modalidade incompatível com o arquivo é rejeitada (cabeçalho de outra modalidade)', () => {
  const r = imp('quina', {}, fixtureCatalog().valid_megasena);
  assert.equal(r.status, 'REJECTED');
});
