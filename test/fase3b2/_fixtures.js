/** SYNTHETIC_DATA — catálogo determinístico de fixtures (formatos válidos + maliciosos). */
import { deflateRawSync } from 'node:zlib';
import { buildZip, buildXlsx, syntheticWorkbook, syntheticRows, SHEET_NAMES } from './_xlsx-writer.js';

const enc = s => new TextEncoder().encode(s);
const minimal = (extra = {}) => buildXlsx({ sheetName: 'S', header: ['A'], rows: [[1]], ...extra });

export function fixtureCatalog() {
  const F = {};
  for (const l of ['megasena', 'lotofacil', 'quina', 'lotomania']) F[`valid_${l}`] = syntheticWorkbook(l, { count: 12, seed: 7 });
  F.valid_megasena_shared_explicit = syntheticWorkbook('megasena', { prefix: '', implicitRefs: false, strings: 'shared', seed: 7 });
  F.valid_megasena_inline_deflate = syntheticWorkbook('megasena', { prefix: '', implicitRefs: false, strings: 'inline', method: 8, seed: 7 });
  F.lotomania_tier_change = syntheticWorkbook('lotomania', { startContest: 1648, count: 10, seed: 3 });
  // maliciosos / inválidos
  const v = F.valid_megasena;
  F.mal_corrupt = (() => { const b = new Uint8Array(v); for (let i = 40; i < 400; i++) b[i] ^= 0xA5; return b; })();
  F.mal_not_zip = enc('SYNTHETIC_DATA isto não é um ZIP');
  F.mal_truncated = v.slice(0, Math.floor(v.length / 2));
  F.mal_zip_bomb = buildZip([{ name: '[Content_Types].xml', data: new Uint8Array(4 * 1024 * 1024), method: 8 }]);
  F.mal_doctype = buildXlsx({ sheetName: 'S', header: ['A'], rows: [[1]], sheetXmlPrefix: '<!DOCTYPE x [<!ENTITY a "aaaa">]>' });
  F.mal_invalid_xml = buildZip([{ name: '[Content_Types].xml', data: '<Types><Unclosed></Types>' }]);
  F.mal_path_traversal = buildZip([{ name: '../../etc/passwd', data: 'x' }, { name: '[Content_Types].xml', data: '<Types/>' }]);
  F.mal_absolute_path = buildZip([{ name: '/abs/file.xml', data: 'x' }]);
  F.mal_duplicate_entries = buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: '[Content_Types].xml', data: '<Types/>' }]);
  F.mal_vba = minimal({ extraParts: [{ name: 'xl/vbaProject.bin', data: 'SYNTHETIC' }] });
  F.mal_external_rel = minimal({ workbookRelsExtra: '<Relationship Id="rX" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="http://example.invalid/x" TargetMode="External"/>' });
  F.mal_encrypted = buildZip([{ name: '[Content_Types].xml', data: '<Types/>', flags: 1 }]);
  F.mal_crc = buildZip([{ name: '[Content_Types].xml', data: '<Types/>', crcOverride: 12345 }]);
  F.mal_trailing = buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }], { trailing: enc('LIXO') });
  F.mal_cd_local_mismatch = buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }], { cdNameOverride: { 0: 'outro.xml' } });
  void deflateRawSync; void syntheticRows; void SHEET_NAMES;
  return F;
}
