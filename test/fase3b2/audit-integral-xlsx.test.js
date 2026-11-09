// SYNTHETIC_DATA — auditoria integral, bloco 6: relações/tipos de conteúdo/planilhas do XLSX validados; sempre XlsxError.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXlsx, buildZip } from './_xlsx-writer.js';
import { openZip } from '../../src/xlsx/zip.js';
import { parseXlsx } from '../../src/xlsx/workbook.js';
import { XlsxError } from '../../src/xlsx/errors.js';

const base = () => buildXlsx({ sheetName: 'S', header: ['Concurso', 'X'], rows: [[1, 'a'], [2, 'b']] });
const dec = b => new TextDecoder().decode(b);
/** Reabre um XLSX válido, aplica `edit(files)` (lista {name,data}) e remonta. */
function mutate(edit) {
  const z = openZip(base()); const files = z.names().filter(n => !n.endsWith('/')).map(n => ({ name: n, data: dec(z.read(n)) }));
  return buildZip(edit(files).map(f => ({ ...f, method: 0 })));
}
const setPart = (name, fn) => files => files.map(f => (f.name === name ? { ...f, data: fn(f.data) } : f));
const addPart = (name, data) => files => [...files, { name, data }];
const R = (id, type, target, extra = '') => `<Relationship${id === null ? '' : ` Id="${id}"`}${type === null ? '' : ` Type="${type}"`}${target === null ? '' : ` Target="${target}"`}${extra}/>`;
const T_WS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const T_OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const T_SST = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings';
const RELS = inner => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
function code(bytes) { try { parseXlsx(bytes); return 'OK'; } catch (e) { assert.ok(e instanceof XlsxError, `esperado XlsxError, recebido ${e && e.name}: ${e && e.message}`); return e.code; } }

test('base sintética válida é aceita', () => { assert.equal(code(base()), 'OK'); });

test('6.1: Id/Type/Target ausentes ou inválidos e Id duplicado → XlsxError (nunca TypeError)', () => {
  const wb = inner => setPart('xl/_rels/workbook.xml.rels', () => RELS(inner));
  const cases = [
    [wb(R('rId1', T_WS, null) + R('rIdS', T_SST, 'sharedStrings.xml')), 'XLSX_REL_TARGET_INVALID'],
    [wb(R('rId1', T_WS, '') + R('rIdS', T_SST, 'sharedStrings.xml')), 'XLSX_REL_TARGET_INVALID'],
    [wb(R(null, T_WS, 'worksheets/sheet1.xml') + R('rIdS', T_SST, 'sharedStrings.xml')), 'XLSX_REL_ID_INVALID'],
    [wb(R('1bad', T_WS, 'worksheets/sheet1.xml')), 'XLSX_REL_ID_INVALID'],
    [wb(R('rId1', null, 'worksheets/sheet1.xml')), 'XLSX_REL_TYPE_INVALID'],
    [wb(R('rId1', T_WS, 'worksheets/sheet1.xml') + R('rId1', T_SST, 'sharedStrings.xml')), 'XLSX_REL_DUPLICATE_ID'],
    [setPart('_rels/.rels', () => RELS(R('rId1', T_OD, null))), 'XLSX_REL_TARGET_INVALID'],
    [setPart('_rels/.rels', () => RELS(R(null, T_OD, 'xl/workbook.xml'))), 'XLSX_REL_ID_INVALID'],
  ];
  for (const [edit, want] of cases) assert.equal(code(mutate(edit)), want);
});

test('6.1: relações ambíguas, alvos inválidos e fugas do pacote', () => {
  const wb = inner => setPart('xl/_rels/workbook.xml.rels', () => RELS(inner));
  const ws = R('rId1', T_WS, 'worksheets/sheet1.xml');
  const cases = [
    [setPart('_rels/.rels', () => RELS(R('rId1', T_OD, 'xl/workbook.xml') + R('rId2', T_OD, 'xl/workbook.xml'))), 'XLSX_REL_AMBIGUOUS'],
    [wb(ws + R('rIdS', T_SST, 'sharedStrings.xml') + R('rIdT', T_SST, 'sharedStrings.xml')), 'XLSX_REL_AMBIGUOUS'],
    [wb(R('rId1', T_WS, '../../fora.xml')), 'XLSX_REL_ESCAPE'],
    [wb(R('rId1', T_WS, '/../fora.xml')), 'XLSX_REL_ESCAPE'],
    [wb(R('rId1', T_WS, 'http://evil.invalid/x.xml')), 'XLSX_REL_TARGET_INVALID'],
    [wb(R('rId1', T_WS, '//evil.invalid/x.xml')), 'XLSX_REL_TARGET_INVALID'],
    [wb(R('rId1', T_WS, 'worksheets\\sheet1.xml')), 'XLSX_REL_TARGET_INVALID'],
    [wb(R('rId1', T_WS, 'worksheets/sheet1.xml?x=1')), 'XLSX_REL_TARGET_INVALID'],
    [wb(R('rId1', T_WS, '.')), 'XLSX_REL_TARGET_INVALID'], [wb(R('rId1', T_WS, 'worksheets/')), 'XLSX_REL_TARGET_INVALID'], [wb(R('rId1', T_WS, 'worksheets/..')), 'XLSX_REL_TARGET_INVALID'],
    [wb(ws + '<Outro/>'), 'XLSX_RELS_UNEXPECTED_ELEMENT'],
    [setPart('xl/_rels/workbook.xml.rels', () => '<?xml version="1.0"?>'), 'XML_EMPTY'],
  ];
  for (const [edit, want] of cases) assert.equal(code(mutate(edit)), want);
  assert.equal(code(mutate(wb(R('rId1', T_WS, '/xl/worksheets/sheet1.xml') + R('rIdS', T_SST, '/xl/sharedStrings.xml')))), 'OK', 'alvo absoluto dentro do pacote é aceito');
});

test('6.1: referências de planilha inconsistentes', () => {
  const wbx = sheets => setPart('xl/workbook.xml', d => d.replace(/<sheets>.*<\/sheets>/, `<sheets>${sheets}</sheets>`));
  const S = (name, sid, rid) => `<sheet${name === null ? '' : ` name="${name}"`}${sid === null ? '' : ` sheetId="${sid}"`}${rid === null ? '' : ` r:id="${rid}"`}/>`;
  const cases = [
    [wbx(S('S', 1, 'rId1') + S('S', 2, 'rId1')), 'XLSX_SHEET_DUPLICATE_NAME'],
    [wbx(S('S', 1, 'rId1') + S('s', 2, 'rIdX')), 'XLSX_SHEET_DUPLICATE_NAME'],
    [wbx(S('S', 1, 'rId1') + S('T', 2, 'rId1')), 'XLSX_SHEET_DUPLICATE_REL'],
    [wbx(S('S', 1, 'rId1') + S('T', 1, 'rId2')), 'XLSX_SHEET_ID_INVALID'],
    [wbx(S(null, 1, 'rId1')), 'XLSX_SHEET_NAME_INVALID'],
    [wbx(S('S', 1, null)), 'XLSX_SHEET_REL'],
    [wbx(S('S', 1, 'rIdS')), 'XLSX_SHEET_REL'],
    [f => wbx(S('S', 1, 'rId1') + S('T', 2, 'rId2'))(setPart('xl/_rels/workbook.xml.rels', d => d.replace('</Relationships>', R('rId2', T_WS, 'worksheets/sheet1.xml') + '</Relationships>'))(f)), 'XLSX_SHEET_DUPLICATE_PART'],
  ];
  for (const [edit, want] of cases) assert.equal(code(mutate(edit)), want);
});

test('6.1: tipos de conteúdo duplicados, conflitantes ou inválidos', () => {
  const ct = fn => setPart('[Content_Types].xml', fn);
  const add = x => ct(d => d.replace('</Types>', `${x}</Types>`));
  const WB = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
  const cases = [
    [add(`<Override PartName="/xl/workbook.xml" ContentType="${WB}"/>`), 'XLSX_CONTENT_TYPE_DUPLICATE'],
    [add('<Override PartName="/XL/Workbook.xml" ContentType="application/xml"/>'), 'XLSX_CONTENT_TYPE_CONFLICT'],
    [add('<Default Extension="xml" ContentType="application/xml"/>'), 'XLSX_CONTENT_TYPE_DUPLICATE'],
    [add('<Default Extension="XML" ContentType="text/xml"/>'), 'XLSX_CONTENT_TYPE_CONFLICT'],
    [add('<Override ContentType="application/xml"/>'), 'XLSX_CONTENT_TYPE_INVALID'],
    [add('<Override PartName="sem-barra.xml" ContentType="application/xml"/>'), 'XLSX_CONTENT_TYPE_INVALID'],
    [add('<Default ContentType="application/xml"/>'), 'XLSX_CONTENT_TYPE_INVALID'],
    [add('<Override PartName="/x.xml"/>'), 'XLSX_CONTENT_TYPE_INVALID'],
    [add('<Estranho/>'), 'XLSX_CONTENT_TYPES_UNEXPECTED_ELEMENT'],
    [ct(() => '<?xml version="1.0"?>'), 'XML_EMPTY'],
  ];
  for (const [edit, want] of cases) assert.equal(code(mutate(edit)), want);
});

test('6.2: relação externa em QUALQUER parte .rels (planilha, customXml, docProps) é rejeitada; sem exceção', () => {
  const ext = RELS(R('rId9', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', 'https://evil.invalid/', ' TargetMode="External"'));
  for (const p of ['xl/worksheets/_rels/sheet1.xml.rels', 'customXml/_rels/item1.xml.rels', 'docProps/_rels/app.xml.rels', 'xl/_rels/qualquer.xml.rels'])
    assert.equal(code(mutate(addPart(p, ext))), 'XLSX_EXTERNAL_REL', p);
  assert.equal(code(mutate(addPart('xl/worksheets/_rels/sheet1.xml.rels', RELS(R('rId9', T_WS, 'x.xml', ' TargetMode="Qualquer"'))))), 'XLSX_EXTERNAL_REL');
  // .rels interna válida em parte não usada: validada e aceita (não fica em ignoredParts)
  const ok = mutate(addPart('xl/worksheets/_rels/sheet1.xml.rels', RELS(R('rId9', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/printerSettings', '../printerSettings/p1.bin'))));
  const p = parseXlsx(ok); assert.ok(!p.ignoredParts.includes('xl/worksheets/_rels/sheet1.xml.rels'));
  // .rels interna malformada em parte não usada também é rejeitada (não é ignorada)
  assert.equal(code(mutate(addPart('customXml/_rels/item1.xml.rels', RELS(R('rId1', T_WS, '../../../fora'))))), 'XLSX_REL_ESCAPE');
});

test('invariante 12: estruturas aleatoriamente corrompidas nunca escapam como exceção nativa', () => {
  let a = 12345; const rnd = () => ((a = (a * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const parts = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml'];
  for (let i = 0; i < 300; i++) {
    const name = parts[Math.floor(rnd() * parts.length)];
    const b = mutate(setPart(name, d => { const k = Math.floor(rnd() * d.length); const op = Math.floor(rnd() * 3); return op === 0 ? d.slice(0, k) : op === 1 ? d.slice(0, k) + d.slice(k + 1 + Math.floor(rnd() * 20)) : d.slice(0, k) + '"<>/=' [Math.floor(rnd() * 5)] + d.slice(k); }));
    try { parseXlsx(b); } catch (e) { assert.ok(e instanceof XlsxError, `${name}: ${e && e.name} ${e && e.message}`); }
  }
});
