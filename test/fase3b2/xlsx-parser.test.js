// SYNTHETIC_DATA — parser XLSX/ZIP/XML com limites de segurança (sem dependências, offline).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseXlsx, colToIndex, indexToCol, XLSX_PARSER_ID } from '../../src/xlsx/workbook.js';
import { openZip, crc32 } from '../../src/xlsx/zip.js';
import { walkXml, decodeEntities } from '../../src/xlsx/xml.js';
import { XlsxError } from '../../src/xlsx/errors.js';
import { fixtureCatalog } from './_fixtures.js';
import { buildXlsx, buildZip } from './_xlsx-writer.js';

const F = fixtureCatalog();
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof XlsxError, `esperava XlsxError, veio ${e && e.name}`); return e.code; } assert.fail('esperava erro'); };

test('fixtures versionadas são idênticas às geradas (determinismo)', () => {
  const idx = JSON.parse(readFileSync(new URL('./fixtures/INDEX.json', import.meta.url), 'utf8'));
  for (const [name, bytes] of Object.entries(F)) {
    const disk = readFileSync(new URL(`./fixtures/SYNTHETIC_DATA_${name}.xlsx`, import.meta.url));
    assert.deepEqual(new Uint8Array(disk), bytes, name);
    assert.equal(idx.files[`SYNTHETIC_DATA_${name}.xlsx`].bytes, bytes.length);
  }
  assert.deepEqual(fixtureCatalog().valid_quina, F.valid_quina);
});

test('XLSX válido: 4 formatos (prefixo x:, refs implícitas, t=str) + shared/inline/deflate', () => {
  for (const n of ['valid_megasena', 'valid_lotofacil', 'valid_quina', 'valid_lotomania', 'valid_megasena_shared_explicit', 'valid_megasena_inline_deflate']) {
    const r = parseXlsx(F[n]);
    assert.equal(r.parser.id, XLSX_PARSER_ID);
    assert.equal(r.sheets.length, 1); assert.equal(r.sheets[0].rowCount, 13, n);
  }
  const a = parseXlsx(F.valid_megasena).sheets[0].rows; const b = parseXlsx(F.valid_megasena_shared_explicit).sheets[0].rows; const c = parseXlsx(F.valid_megasena_inline_deflate).sheets[0].rows;
  const texts = rows => rows.map(r => Object.fromEntries(r.cells.filter(x => (x.text ?? x.raw ?? '') !== '').map(x => [x.col, x.text ?? x.raw])));
  assert.deepEqual(texts(a), texts(b)); assert.deepEqual(texts(a), texts(c));
});

test('células: shared/inline/str/número exato/fórmula/vazio/"-" em t=n', () => {
  const x = buildXlsx({ sheetName: 'S', header: ['A', 'B', 'C', 'D', 'E'], rows: [[{ t: 'n', v: '06' }, 'txt', null, { t: 'n', v: '-' }, { f: 'SUM(1,2)', t: 'n', v: '3' }]], strings: 'inline' });
  const row = parseXlsx(x).sheets[0].rows[1];
  assert.deepEqual(row.cells[0].interpreted, { kind: 'number', text: '06' });
  assert.equal(row.cells[1].interpreted.kind, 'text');
  assert.equal(row.cells.find(c => c.ref === 'D2').interpreted.kind, 'invalid');
  assert.equal(row.cells.find(c => c.ref === 'E2').hasFormula, true);
  assert.equal(row.cells.some(c => c.ref === 'C2'), false);
});

test('malicioso/corrompido é rejeitado com código específico', () => {
  assert.equal(code(() => parseXlsx(F.mal_not_zip)), 'ZIP_SIGNATURE');
  assert.equal(code(() => parseXlsx(F.mal_truncated)), 'ZIP_NO_EOCD');
  assert.ok(['ZIP_NAME_MISMATCH', 'ZIP_CRC', 'ZIP_INFLATE', 'ZIP_LOCAL_HEADER'].includes(code(() => parseXlsx(F.mal_corrupt))));
  assert.equal(code(() => parseXlsx(F.mal_zip_bomb)), 'ZIP_BOMB_RATIO');
  assert.equal(code(() => parseXlsx(F.mal_doctype)), 'XML_DOCTYPE_FORBIDDEN');
  assert.equal(code(() => parseXlsx(F.mal_invalid_xml)), 'XML_MISMATCHED_TAG');
  assert.equal(code(() => parseXlsx(F.mal_path_traversal)), 'ZIP_UNSAFE_PATH');
  assert.equal(code(() => parseXlsx(F.mal_absolute_path)), 'ZIP_UNSAFE_PATH');
  assert.equal(code(() => parseXlsx(F.mal_duplicate_entries)), 'ZIP_DUPLICATE_ENTRY');
  assert.equal(code(() => parseXlsx(F.mal_vba)), 'XLSX_ACTIVE_CONTENT');
  assert.equal(code(() => parseXlsx(F.mal_external_rel)), 'XLSX_EXTERNAL_REL');
  assert.equal(code(() => parseXlsx(F.mal_encrypted)), 'ZIP_ENCRYPTED');
  assert.equal(code(() => parseXlsx(F.mal_crc)), 'ZIP_CRC');
  assert.equal(code(() => parseXlsx(F.mal_trailing)), 'ZIP_TRAILING_DATA');
  assert.equal(code(() => parseXlsx(F.mal_cd_local_mismatch)), 'ZIP_NAME_MISMATCH');
});

test('limites configuráveis: tamanho, entradas, células, linhas, strings', () => {
  assert.equal(code(() => parseXlsx(F.valid_megasena, { zip: { maxFileBytes: 100 } })), 'ZIP_TOO_LARGE');
  assert.equal(code(() => parseXlsx(F.valid_megasena, { zip: { maxEntries: 2 } })), 'ZIP_TOO_MANY_ENTRIES');
  assert.equal(code(() => parseXlsx(F.valid_megasena, { xlsx: { maxCells: 10 } })), 'XLSX_TOO_MANY_CELLS');
  assert.equal(code(() => parseXlsx(F.valid_megasena, { xlsx: { maxRows: 3 } })), 'XLSX_TOO_MANY_ROWS');
  assert.equal(code(() => parseXlsx(F.valid_megasena_shared_explicit, { xlsx: { maxSharedStrings: 2 } })), 'XLSX_SST_TOO_MANY');
  assert.equal(code(() => parseXlsx(F.valid_megasena, { zip: { maxEntryUncompressed: 50 } })).startsWith('ZIP_'), true);
});

test('ZIP: CRC32 de referência e leitura de entradas', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const z = openZip(buildZip([{ name: 'a.txt', data: 'olá', method: 8 }, { name: 'b.txt', data: 'x' }]));
  assert.deepEqual(z.names(), ['a.txt', 'b.txt']);
  assert.equal(new TextDecoder().decode(z.read('a.txt')), 'olá');
});

test('XML: entidades, DOCTYPE/ENTITY proibidos, raiz única, profundidade', () => {
  assert.equal(decodeEntities('&lt;a&gt;&amp;&#65;&#x42;'), '<a>&AB');
  const c = s => code(() => walkXml(s, {}));
  assert.equal(c('<!DOCTYPE a><a/>'), 'XML_DOCTYPE_FORBIDDEN');
  assert.ok(c('<!ENTITY x "y"><a/>').startsWith('XML_'));
  assert.ok(c('<a/><b/>').startsWith('XML_'));
  assert.ok(c('<a><b></a>').startsWith('XML_'));
  assert.ok(c('<a x="1" x="2"/>').startsWith('XML_'));
  assert.equal(code(() => walkXml('<a><a><a><a/></a></a></a>', {}, { maxDepth: 2 })), 'XML_TOO_DEEP');
});

test('colunas: conversão A↔índice', () => {
  for (const [s, i] of [['A', 1], ['Z', 26], ['AA', 27], ['AO', 41], ['XFD', 16384]]) { assert.equal(colToIndex(s), i); assert.equal(indexToCol(i), s); }
});
