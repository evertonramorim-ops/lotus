// SYNTHETIC_DATA — auditoria: fórmulas XLSX nunca geram registro aceito; evidência rastreável; nada é avaliado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { imp } from './_h.js';
import { parseXlsx } from '../../src/xlsx/workbook.js';
import { rawBytes } from '../../src/data/raw.js';
import { syntheticWorkbook } from './_xlsx-writer.js';
import { Q } from '../../src/historical/codes.js';

const sha = b => createHash('sha256').update(b).digest('hex');
/** Substitui a célula (linha de dados i, cabeçalho h) por fórmula com valor em cache = valor original. */
const formulaAt = (i, h, expr, t) => ({ header, rows }) => { const c = header.indexOf(h); const v = rows[i][c]; const cached = typeof v === 'object' ? v.v : String(v); rows[i][c] = { f: expr, v: cached, ...(t ? { t } : typeof v === 'object' && v.t ? { t: v.t } : typeof v === 'string' ? { t: 'str' } : {}) }; return { header, rows }; };

const CASES = [
  ['dezena', 'Bola3', 'SUM(1,2)'],
  ['concurso', 'Concurso', 'A2+1'],
  ['data', 'Data do Sorteio', 'TEXT(DATE(2001,1,9),"dd/mm/yyyy")'],
  ['prêmio', 'Rateio 4 acertos', 'D3*2'],
  ['ganhadores', 'Ganhadores 4 acertos', 'COUNT(A:A)'],
  ['econômico', 'Arrecadação Total', 'SUM(X2:X9)&""'],
];

for (const [label, header, expr] of CASES) {
  test(`fórmula em ${label} (${header}) → FORMULA_EM_CAMPO_HISTORICO, não aceito, evidência completa`, () => {
    const opt = { seed: 11, count: 6, name: `SYNTHETIC_DATA_formula_${label}`, mutate: formulaAt(2, header, expr) };
    const r = imp('megasena', opt);
    // o registro afetado (linha de dados 2 → linha 4 da planilha) nunca é aceito
    assert.ok(!r.accepted.some(a => a.record.source.row === 4), 'linha com fórmula não pode ser aceita');
    assert.equal(r.accepted.length, 5);
    const q = r.quarantine.find(e => e.candidate && e.candidate.source.row === 4);
    assert.ok(q, 'linha com fórmula deve estar em quarentena');
    const reason = q.reasons.find(x => x.code === Q.FORMULA_EM_CAMPO_HISTORICO);
    assert.ok(reason, 'código específico');
    assert.equal(reason.blocking, true); assert.equal(reason.validatorId, 'V16');
    assert.equal(reason.evidence.expression, expr);
    assert.equal(reason.evidence.column, header);
    assert.match(reason.evidence.ref, /^[A-Z]+4$/);
    assert.ok(reason.evidence.cachedValue !== null && reason.evidence.cachedValue !== undefined, 'valor em cache preservado');
    assert.equal(reason.evidence.rawSha256, r.envelope.sha256);
    assert.equal(q.candidate.formulaCells[0].expression, expr);
    // bytes originais intactos e rastreáveis
    assert.deepEqual(rawBytes(r.envelope), r.bytes);
    assert.equal(r.envelope.sha256, sha(r.bytes));
    // a célula original no arquivo bruto ainda contém a expressão e o valor em cache
    const cell = parseXlsx(r.bytes).sheets[0].rows.find(x => x.row === 4).cells.find(c => c.ref === reason.evidence.ref);
    assert.equal(cell.hasFormula, true); assert.equal(cell.formula.expression, expr); assert.equal(cell.raw, reason.evidence.cachedValue);
    assert.ok(r.report.quarantineReasonCounts[Q.FORMULA_EM_CAMPO_HISTORICO] >= 1);
  });
}

test('parser preserva hasFormula, expressão e valor em cache; não avalia (cache incoerente mantido como está)', () => {
  const b = syntheticWorkbook('megasena', { seed: 1, count: 2, mutate: formulaAt(0, 'Bola1', '1/0', 'n') });
  const c = parseXlsx(b).sheets[0].rows.find(x => x.row === 2).cells.find(x => x.hasFormula);
  assert.equal(c.formula.expression, '1/0'); assert.equal(c.formula.type, 'normal');
  assert.ok(c.raw !== null, 'cache preservado (não recalculado)');
  const none = parseXlsx(syntheticWorkbook('megasena', { seed: 1, count: 2 })).sheets[0].rows[1].cells;
  assert.ok(none.every(x => x.hasFormula === false && x.formula === null));
});

test('fórmula em coluna desconhecida → mantida em extras com origem (não some); registro não bloqueado por ela', () => {
  const mutate = ({ header, rows }) => ({ header: [...header, 'Coluna SYNTHETIC'], rows: rows.map((r, i) => [...r, { f: `ROW()*${i}`, v: String(i), t: 'n' }]) });
  const r = imp('megasena', { seed: 2, count: 4, mutate });
  const recs = [...r.accepted.map(a => a.record), ...r.quarantine.filter(q => q.candidate).map(q => q.candidate)];
  assert.equal(recs.length, 4);
  for (const rec of recs) {
    const x = rec.extras.find(e => e.header === 'Coluna SYNTHETIC');
    assert.ok(x && x.hasFormula === true && x.origin === 'xlsx' && /^ROW\(\)\*\d$/.test(x.formula.expression) && x.cachedValue !== undefined && x.ref);
    assert.equal(rec.formulaCells, undefined, 'coluna desconhecida não é campo mapeado');
  }
});

test('registros sem fórmula: estrutura inalterada (sem chave formulaCells) — hash estável', () => {
  const r = imp('megasena', { seed: 3, count: 5 });
  assert.equal(r.accepted.length, 5);
  assert.ok(r.accepted.every(a => !('formulaCells' in a.record)));
});
