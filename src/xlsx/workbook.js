/**
 * Parser XLSX (OOXML SpreadsheetML) — camada B (extração) do LOTUS, versão `lotus.xlsx-parser` 1.1.0.
 * Lê o pacote SEM alterar os bytes (o chamador guarda os bytes originais na camada A).
 * Valida: estrutura ZIP (./zip.js), [Content_Types].xml, relações do pacote e do workbook,
 * tipos de conteúdo das partes usadas, planilhas, sharedStrings, inline strings.
 * Rejeita conteúdo ativo: vbaProject, tipos macroEnabled, embeddings, activeX, externalLinks,
 * relações externas em QUALQUER parte .rels do pacote (sem exceção permitida). Relações validadas (Id, Type, Target,
 * TargetMode; Id duplicado, relação ambígua, alvo inválido/fora do pacote); tipos de conteúdo duplicados ou
 * conflitantes; referências de planilha inconsistentes. Toda falha estrutural é XlsxError (nunca TypeError nativo).
 * Nada é executado. Partes não usadas (docProps, customXml, theme, styles,
 * "[trash]") são listadas em `ignoredParts`, nunca interpretadas.
 * Cada célula preserva: referência (explícita ou implícita), linha, coluna, tipo declarado,
 * valor bruto (<v> ou texto inline), índice compartilhado, presença de fórmula, estilo e a
 * interpretação (number como TEXTO decimal exato — nunca float —, text, boolean, error, empty, invalid).
 * @module xlsx/workbook
 */
import { openZip, ZIP_DEFAULT_LIMITS } from './zip.js';
import { walkXml, parseXmlTree, XML_DEFAULT_LIMITS } from './xml.js';
import { XlsxError } from './errors.js';

export const XLSX_PARSER_ID = 'lotus.xlsx-parser';
// 1.1.0: validação de relações/tipos de conteúdo/planilhas mais estrita (pacotes antes aceitos podem ser rejeitados;
// os 4 XLSX reais seguem aceitos com o mesmo resultado de células — verificado somente leitura).
export const XLSX_PARSER_VERSION = '1.1.0';
export const XLSX_DEFAULT_LIMITS = Object.freeze({ maxCells: 2_000_000, maxRows: 500_000, maxColumns: 16_384, maxSharedStrings: 1_000_000, maxSheets: 32, maxStringLength: 32_767 });

const CT_WORKBOOK = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const CT_WORKSHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const CT_SST = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml';
const REL_OFFICE_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const REL_WORKSHEET = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const REL_SST = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings';
const FORBIDDEN_PARTS = [/vbaProject\.bin$/i, /^xl\/embeddings\//i, /^xl\/activeX\//i, /^xl\/externalLinks\//i, /vbaData\.xml$/i, /^xl\/macrosheets\//i, /^xl\/dialogsheets\//i];
const NUMERIC = /^-?(0|[0-9]+)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

const utf8 = (bytes, part) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new XlsxError('XML_ENCODING', 'parte não é UTF-8 válido', { part }); } };

/** Converte letras de coluna (A..XFD) em índice 1-based. */
export function colToIndex(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
export function indexToCol(n) { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const REL_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,254}$/;
/** Resolve alvo de relação DENTRO do pacote; alvo inválido ou que escapa do pacote → XlsxError. */
function resolveTarget(baseDir, target, part = null) {
  if (typeof target !== 'string' || target.length === 0 || target.length > 1024) throw new XlsxError('XLSX_REL_TARGET_INVALID', 'alvo de relação ausente ou inválido', { part });
  if (/[\\\u0000-\u001f]/.test(target) || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.includes('?') || target.includes('#')) throw new XlsxError('XLSX_REL_TARGET_INVALID', `alvo de relação inválido: ${JSON.stringify(target)}`, { part });
  const last = target.split('/').pop(); if (last === '' || last === '.' || last === '..') throw new XlsxError('XLSX_REL_TARGET_INVALID', `alvo de relação não é parte (diretório): ${JSON.stringify(target)}`, { part });
  const abs = target.startsWith('/');
  const parts = (abs || !baseDir ? [] : baseDir.split('/')).concat((abs ? target.slice(1) : target).split('/'));
  const out = [];
  for (const p of parts) { if (p === '' || p === '.') continue; if (p === '..') { if (!out.length) throw new XlsxError('XLSX_REL_ESCAPE', `relação escapa do pacote: ${target}`, { part }); out.pop(); } else out.push(p); }
  if (!out.length) throw new XlsxError('XLSX_REL_TARGET_INVALID', `alvo de relação vazio: ${JSON.stringify(target)}`, { part });
  return out.join('/');
}
const tree0 = (bytes, XML, part) => { const t = parseXmlTree(utf8(bytes, part), XML, part); if (!t) throw new XlsxError('XML_NO_ROOT', 'parte XML sem elemento raiz', { part }); return t; };

/** Diretório de origem de uma parte .rels (OPC): "a/b/_rels/c.xml.rels" → "a/b"; "_rels/.rels" → "". */
const relsSourceDir = relsPart => { const i = relsPart.lastIndexOf('_rels/'); return i <= 0 ? '' : relsPart.slice(0, i - 1); };

/** Lê e VALIDA uma parte .rels: Id/Type/Target obrigatórios; Id único; TargetMode só Internal; alvo dentro do pacote. */
function readRels(zip, part, xmlLimits) {
  if (!zip.has(part)) return [];
  const tree = tree0(zip.read(part), xmlLimits, part);
  if (tree.local !== 'Relationships') throw new XlsxError('XLSX_RELS_ROOT', 'raiz deve ser Relationships', { part });
  const ids = new Set(); const baseDir = relsSourceDir(part);
  return tree.children.map(c => {
    if (c.local !== 'Relationship') throw new XlsxError('XLSX_RELS_UNEXPECTED_ELEMENT', `elemento inesperado em .rels: ${c.qname}`, { part });
    const id = own(c.attrs, 'Id'); const type = own(c.attrs, 'Type'); const target = own(c.attrs, 'Target'); const mode = own(c.attrs, 'TargetMode');
    if (mode !== undefined && mode !== 'Internal') throw new XlsxError('XLSX_EXTERNAL_REL', `relação externa não permitida (TargetMode=${JSON.stringify(mode)}): ${target}`, { part });
    if (typeof id !== 'string' || !REL_ID.test(id)) throw new XlsxError('XLSX_REL_ID_INVALID', `Id de relação ausente ou inválido: ${JSON.stringify(id)}`, { part });
    if (ids.has(id)) throw new XlsxError('XLSX_REL_DUPLICATE_ID', `Id de relação duplicado: ${id}`, { part });
    ids.add(id);
    if (typeof type !== 'string' || type.length === 0 || type.length > 1024 || /\s/.test(type)) throw new XlsxError('XLSX_REL_TYPE_INVALID', `Type de relação ausente ou inválido em ${id}`, { part });
    return { id, type, target, resolved: resolveTarget(baseDir, target, part) };
  });
}
/** Exatamente zero ou uma relação do tipo; mais de uma → ambígua. */
const single = (rels, type, part, what) => { const r = rels.filter(x => x.type === type); if (r.length > 1) throw new XlsxError('XLSX_REL_AMBIGUOUS', `${r.length} relações ${what}: associação ambígua`, { part }); return r[0] ?? null; };

/** Interpretação de uma célula (sem perda: number permanece texto decimal). */
export function interpretCell(type, raw, text) {
  switch (type) {
    case 'n': if (raw === null || raw === '') return { kind: 'empty' };
              return NUMERIC.test(raw) ? { kind: 'number', text: raw } : { kind: 'invalid', reason: 'NUMERIC_TYPE_NON_NUMERIC_VALUE', text: raw };
    case 's': case 'str': case 'inlineStr': return text === null || text === '' ? { kind: 'empty' } : { kind: 'text', text };
    case 'b': return raw === '0' || raw === '1' ? { kind: 'boolean', value: raw === '1' } : { kind: 'invalid', reason: 'BOOLEAN_INVALID', text: raw };
    case 'e': return { kind: 'error', text: raw };
    case 'd': return raw ? { kind: 'date-iso', text: raw } : { kind: 'empty' };
    default: return { kind: 'invalid', reason: 'UNKNOWN_CELL_TYPE', text: raw };
  }
}

/**
 * @param {Uint8Array} bytes
 * @param {{zip?:object, xml?:object, xlsx?:object}} [limits]
 */
export function parseXlsx(bytes, limits = {}) {
  try { return parseXlsxInner(bytes, limits); }
  catch (e) {
    if (e instanceof XlsxError) throw e;
    // Defesa em profundidade: nenhuma exceção nativa escapa do tratamento controlado.
    if (e instanceof TypeError || e instanceof RangeError || e instanceof SyntaxError) throw new XlsxError('XLSX_ESTRUTURA_INESPERADA', `estrutura inesperada: ${e.message}`, { nativeError: e.name });
    throw e;
  }
}
function parseXlsxInner(bytes, limits) {
  const XL = { ...XLSX_DEFAULT_LIMITS, ...(limits.xlsx || {}) };
  const XML = { ...XML_DEFAULT_LIMITS, ...(limits.xml || {}) };
  const zip = openZip(bytes, { ...ZIP_DEFAULT_LIMITS, ...(limits.zip || {}) });
  const names = zip.names();
  for (const nm of names) for (const re of FORBIDDEN_PARTS) if (re.test(nm)) throw new XlsxError('XLSX_ACTIVE_CONTENT', 'conteúdo ativo/incorporado não permitido', { part: nm });
  if (!zip.has('[Content_Types].xml')) throw new XlsxError('XLSX_NO_CONTENT_TYPES', '[Content_Types].xml ausente');
  const CTP = '[Content_Types].xml';
  const ct = tree0(zip.read(CTP), XML, CTP);
  if (ct.local !== 'Types') throw new XlsxError('XLSX_CONTENT_TYPES_ROOT', 'raiz deve ser Types', { part: CTP });
  const overrides = new Map(); const defaults = new Map();
  const ctOk = v => typeof v === 'string' && v.length > 0 && v.length <= 255 && !/\s/.test(v);
  for (const c of ct.children) {
    if (c.local === 'Override') {
      const pn = own(c.attrs, 'PartName'); const t = own(c.attrs, 'ContentType');
      if (typeof pn !== 'string' || !pn.startsWith('/') || pn.length < 2 || !ctOk(t)) throw new XlsxError('XLSX_CONTENT_TYPE_INVALID', `Override inválido (PartName=${JSON.stringify(pn)})`, { part: CTP });
      const key = pn.slice(1).toLowerCase(); // nomes de parte OPC comparados sem caixa
      if (overrides.has(key)) throw new XlsxError(overrides.get(key) === t ? 'XLSX_CONTENT_TYPE_DUPLICATE' : 'XLSX_CONTENT_TYPE_CONFLICT', `Override repetido para ${pn}`, { part: CTP });
      overrides.set(key, t);
    } else if (c.local === 'Default') {
      const ext = own(c.attrs, 'Extension'); const t = own(c.attrs, 'ContentType');
      if (typeof ext !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(ext) || !ctOk(t)) throw new XlsxError('XLSX_CONTENT_TYPE_INVALID', `Default inválido (Extension=${JSON.stringify(ext)})`, { part: CTP });
      const key = ext.toLowerCase();
      if (defaults.has(key)) throw new XlsxError(defaults.get(key) === t ? 'XLSX_CONTENT_TYPE_DUPLICATE' : 'XLSX_CONTENT_TYPE_CONFLICT', `Default repetido para .${ext}`, { part: CTP });
      defaults.set(key, t);
    } else throw new XlsxError('XLSX_CONTENT_TYPES_UNEXPECTED_ELEMENT', `elemento inesperado: ${c.qname}`, { part: CTP });
  }
  for (const v of [...overrides.values(), ...defaults.values()]) if (/macroEnabled|vbaProject|activeX|oleObject/i.test(String(v))) throw new XlsxError('XLSX_ACTIVE_CONTENT', `tipo de conteúdo não permitido: ${v}`, { part: '[Content_Types].xml' });
  const typeOf = p => overrides.get(p.toLowerCase()) ?? (p.includes('.') ? defaults.get(p.split('.').pop().toLowerCase()) : undefined);
  // TODA parte .rels do pacote é lida e validada (relação externa em qualquer parte → rejeição; sem exceção permitida)
  const relsByPart = new Map();
  for (const nm of names) if (/(^|\/)_rels\/[^/]*\.rels$/i.test(nm)) relsByPart.set(nm, readRels(zip, nm, XML));
  const pkgRels = relsByPart.get('_rels/.rels') ?? [];
  const od = single(pkgRels, REL_OFFICE_DOC, '_rels/.rels', 'officeDocument');
  if (!od) throw new XlsxError('XLSX_NO_WORKBOOK_REL', 'relação officeDocument ausente em _rels/.rels');
  const wbPart = od.resolved;
  if (!zip.has(wbPart)) throw new XlsxError('XLSX_NO_WORKBOOK', 'workbook ausente', { part: wbPart });
  if (typeOf(wbPart) !== CT_WORKBOOK) throw new XlsxError('XLSX_WORKBOOK_CONTENT_TYPE', `tipo do workbook inválido: ${typeOf(wbPart)}`, { part: wbPart });
  const wbDir = wbPart.includes('/') ? wbPart.slice(0, wbPart.lastIndexOf('/')) : '';
  const wbRelsPart = `${wbDir ? wbDir + '/' : ''}_rels/${wbPart.split('/').pop()}.rels`;
  const wbRels = relsByPart.get(wbRelsPart) ?? [];
  const wb = tree0(zip.read(wbPart), XML, wbPart);
  if (wb.local !== 'workbook') throw new XlsxError('XLSX_WORKBOOK_ROOT', 'raiz deve ser workbook', { part: wbPart });
  const sheetsNode = wb.children.find(c => c.local === 'sheets');
  const pr = wb.children.find(c => c.local === 'workbookPr');
  const date1904 = !!(pr && (pr.attrs.date1904 === '1' || pr.attrs.date1904 === 'true'));
  const sheetDecl = sheetsNode ? sheetsNode.children.filter(c => c.local === 'sheet') : [];
  if (sheetDecl.length === 0) throw new XlsxError('XLSX_NO_SHEETS', 'workbook sem planilhas', { part: wbPart });
  if (sheetDecl.length > XL.maxSheets) throw new XlsxError('XLSX_TOO_MANY_SHEETS', 'planilhas demais', { part: wbPart });
  // sharedStrings
  let shared = [];
  const sstRel = single(wbRels, REL_SST, wbRelsPart, 'sharedStrings');
  const used = new Set(['[Content_Types].xml', ...relsByPart.keys(), wbPart, wbRelsPart]);
  if (sstRel) {
    const sstPart = sstRel.resolved;
    if (!zip.has(sstPart)) throw new XlsxError('XLSX_NO_SST', 'sharedStrings referenciado mas ausente', { part: sstPart });
    if (typeOf(sstPart) !== CT_SST) throw new XlsxError('XLSX_SST_CONTENT_TYPE', 'tipo de sharedStrings inválido', { part: sstPart });
    shared = parseSharedStrings(utf8(zip.read(sstPart), sstPart), XML, XL, sstPart); used.add(sstPart);
  }
  let totalCells = 0;
  const seenName = new Set(), seenRid = new Set(), seenSid = new Set(), seenPart = new Set();
  const sheets = sheetDecl.map(s => {
    const name = own(s.attrs, 'name'); const rid = own(s.attrs, 'id'); const sid = own(s.attrs, 'sheetId');
    if (typeof name !== 'string' || name.length === 0 || name.length > 255) throw new XlsxError('XLSX_SHEET_NAME_INVALID', 'planilha sem nome válido', { part: wbPart });
    if (seenName.has(name.toLowerCase())) throw new XlsxError('XLSX_SHEET_DUPLICATE_NAME', `nome de planilha repetido: ${name}`, { part: wbPart });
    if (typeof rid !== 'string' || !rid) throw new XlsxError('XLSX_SHEET_REL', `planilha "${name}" sem r:id`, { part: wbPart });
    if (seenRid.has(rid)) throw new XlsxError('XLSX_SHEET_DUPLICATE_REL', `r:id ${rid} usado por mais de uma planilha`, { part: wbPart });
    if (sid !== undefined && (typeof sid !== 'string' || !/^[1-9][0-9]{0,9}$/.test(sid) || seenSid.has(sid))) throw new XlsxError('XLSX_SHEET_ID_INVALID', `sheetId inválido ou repetido: ${JSON.stringify(sid)}`, { part: wbPart });
    seenName.add(name.toLowerCase()); seenRid.add(rid); if (sid !== undefined) seenSid.add(sid);
    const rel = wbRels.find(r => r.id === rid);
    if (!rel || rel.type !== REL_WORKSHEET) throw new XlsxError('XLSX_SHEET_REL', `planilha "${name}" sem relação de worksheet`, { part: wbPart });
    const part = rel.resolved;
    if (seenPart.has(part)) throw new XlsxError('XLSX_SHEET_DUPLICATE_PART', `duas planilhas apontam para ${part}`, { part: wbPart });
    seenPart.add(part);
    if (!zip.has(part)) throw new XlsxError('XLSX_SHEET_MISSING', `parte da planilha ausente`, { part });
    if (typeOf(part) !== CT_WORKSHEET) throw new XlsxError('XLSX_SHEET_CONTENT_TYPE', `tipo de conteúdo inválido: ${typeOf(part)}`, { part });
    used.add(part);
    const parsed = parseSheet(utf8(zip.read(part), part), shared, XML, { ...XL, maxCells: XL.maxCells - totalCells }, part);
    totalCells += parsed.cellCount;
    return { name, sheetId: sid ?? null, part, ...parsed };
  });
  return {
    parser: { id: XLSX_PARSER_ID, version: XLSX_PARSER_VERSION }, date1904,
    parts: zip.entries.map(e => ({ name: e.name, compressedSize: e.compressedSize, uncompressedSize: e.uncompressedSize, contentType: typeOf(e.name) ?? null })),
    ignoredParts: names.filter(nm => !used.has(nm) && !nm.endsWith('/')),
    sharedStringCount: shared.length, sheets,
  };
}

function parseSharedStrings(xml, XML, XL, part) {
  const out = []; let inSi = false, inT = false, inRph = false, cur = ''; let root = null;
  walkXml(xml, {
    open(l) { if (!root) { root = l; if (l !== 'sst') throw new XlsxError('XLSX_SST_ROOT', 'raiz deve ser sst', { part }); }
      if (l === 'si') { inSi = true; cur = ''; } else if (l === 'rPh') inRph = true; else if (l === 't' && inSi && !inRph) inT = true; },
    close(l) { if (l === 'si') { if (out.length >= XL.maxSharedStrings) throw new XlsxError('XLSX_SST_TOO_MANY', 'sharedStrings demais', { part }); out.push(cur); inSi = false; }
      else if (l === 't') inT = false; else if (l === 'rPh') inRph = false; },
    text(t) { if (inT) { cur += t; if (cur.length > XL.maxStringLength) throw new XlsxError('XLSX_STRING_TOO_LONG', 'string longa demais', { part }); } },
  }, XML, part);
  return out;
}

const REF = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
function parseSheet(xml, shared, XML, XL, part) {
  const rows = []; let row = null; let cell = null; let inV = false, inIsT = false, inIs = false, inF = false, inRph = false;
  let lastRow = 0; let cellCount = 0; let maxCol = 0; let root = null; let inSheetData = false; let dimension = null;
  walkXml(xml, {
    open(l, a) {
      if (!root) { root = l; if (l !== 'worksheet') throw new XlsxError('XLSX_SHEET_ROOT', 'raiz deve ser worksheet', { part }); }
      if (l === 'dimension') dimension = a.ref ?? null;
      else if (l === 'sheetData') inSheetData = true;
      else if (l === 'row' && inSheetData) {
        let r = lastRow + 1;
        if (a.r !== undefined) { if (!/^[1-9][0-9]{0,6}$/.test(a.r)) throw new XlsxError('XLSX_BAD_ROW_REF', `r de linha inválido: ${a.r}`, { part }); r = Number(a.r); }
        if (r <= lastRow) throw new XlsxError('XLSX_ROW_ORDER', `linha ${r} fora de ordem (após ${lastRow})`, { part });
        if (rows.length >= XL.maxRows) throw new XlsxError('XLSX_TOO_MANY_ROWS', 'linhas demais', { part });
        lastRow = r; row = { row: r, refExplicit: a.r !== undefined, cells: [] }; rows.push(row);
      } else if (l === 'c' && row) {
        const prevCol = row.cells.length ? row.cells[row.cells.length - 1].col : 0;
        let col = prevCol + 1; let explicit = false;
        if (a.r !== undefined) {
          const m = REF.exec(a.r); if (!m) throw new XlsxError('XLSX_BAD_CELL_REF', `referência inválida: ${a.r}`, { part });
          if (Number(m[2]) !== row.row) throw new XlsxError('XLSX_CELL_ROW_MISMATCH', `célula ${a.r} na linha ${row.row}`, { part });
          col = colToIndex(m[1]); explicit = true;
          if (col <= prevCol) throw new XlsxError('XLSX_CELL_ORDER', `célula ${a.r} fora de ordem`, { part });
        }
        if (col > XL.maxColumns) throw new XlsxError('XLSX_TOO_MANY_COLUMNS', 'coluna além do limite', { part });
        if (++cellCount > XL.maxCells) throw new XlsxError('XLSX_TOO_MANY_CELLS', `mais de ${XL.maxCells} células`, { part });
        maxCol = Math.max(maxCol, col);
        cell = { ref: indexToCol(col) + row.row, refExplicit: explicit, row: row.row, col, type: a.t ?? 'n', style: a.s ?? null, raw: null, inline: null, hasFormula: false, formula: null };
      } else if (cell) {
        if (l === 'v') inV = true; else if (l === 'f') { inF = true; cell.hasFormula = true; cell.formula = { expression: '', type: a.t ?? 'normal', sharedIndex: a.si ?? null, sharedRef: a.ref ?? null }; } else if (l === 'is') { inIs = true; cell.inline = ''; }
        else if (l === 'rPh') inRph = true; else if (l === 't' && inIs && !inRph) inIsT = true;
      }
    },
    close(l) {
      if (l === 'sheetData') inSheetData = false;
      else if (l === 'row') row = null;
      else if (l === 'c' && cell) { finalizeCell(cell, shared, part); row.cells.push(cell); cell = null; }
      else if (l === 'v') inV = false; else if (l === 'f') inF = false; else if (l === 'is') inIs = false; else if (l === 't') inIsT = false; else if (l === 'rPh') inRph = false;
    },
    text(t) {
      if (!cell) return;
      if (inV) cell.raw = (cell.raw ?? '') + t; else if (inIsT) cell.inline += t; else if (inF && cell.formula) cell.formula.expression += t;
      if ((cell.raw && cell.raw.length > XL.maxStringLength) || (cell.inline && cell.inline.length > XL.maxStringLength) || (cell.formula && cell.formula.expression.length > XL.maxStringLength)) throw new XlsxError('XLSX_STRING_TOO_LONG', `célula ${cell.ref} longa demais`, { part });
    },
  }, XML, part);
  return { dimension, rowCount: rows.length, cellCount, maxColumn: maxCol, rows };
}

function finalizeCell(c, shared, part) {
  let text = null; let sharedIndex = null;
  if (c.type === 's') {
    if (c.raw === null || !/^(0|[1-9][0-9]*)$/.test(c.raw)) throw new XlsxError('XLSX_BAD_SST_INDEX', `índice compartilhado inválido em ${c.ref}`, { part });
    sharedIndex = Number(c.raw); if (sharedIndex >= shared.length) throw new XlsxError('XLSX_SST_INDEX_RANGE', `índice ${sharedIndex} fora de sharedStrings em ${c.ref}`, { part });
    text = shared[sharedIndex];
  } else if (c.type === 'inlineStr') text = c.inline ?? null;
  else if (c.type === 'str') text = c.raw;
  if (c.type === 'inlineStr' && c.inline === null) throw new XlsxError('XLSX_INLINE_MISSING', `inlineStr sem <is> em ${c.ref}`, { part });
  c.sharedIndex = sharedIndex; c.text = text; c.interpreted = interpretCell(c.type, c.raw, text);
  delete c.inline;
}
