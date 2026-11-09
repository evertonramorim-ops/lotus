/**
 * Camada B — EXTRAÇÃO: aplica a especificação de um adaptador a um XLSX já analisado
 * (xlsx/workbook.parseXlsx) e produz linhas com proveniência de célula, sem apagar nenhum valor.
 * Também produz a análise de esquema (colunas desconhecidas/ausentes/reordenadas, nome da planilha).
 * @module historical/extract
 */
export const EXTRACTION_SCHEMA = 'lotus.xlsx-extraction';
// 1.1.0: cabeçalho MAPEADO duplicado → alerta DUPLICATE_MAPPED_HEADER BLOQUEANTE (antes: a 2ª coluna era ignorada em
// silêncio, pois normalizeRow usa a 1ª ocorrência); cabeçalho desconhecido duplicado segue preservado em `extras`.
export const EXTRACTION_SCHEMA_VERSION = '1.1.0';

const cellOut = (c, header) => ({ ref: c.ref, col: c.col, header, type: c.type, raw: c.raw, text: c.text, sharedIndex: c.sharedIndex, hasFormula: c.hasFormula, ...(c.hasFormula ? { formula: c.formula } : {}), interpreted: c.interpreted });

/**
 * @param {object} parsed resultado de parseXlsx
 * @param {object} spec adaptador
 * @returns {{schemaAnalysis:object, rows:object[], compatible:boolean, sheet:string|null}}
 */
export function extractWithAdapter(parsed, spec) {
  const alerts = [];
  let sheet = parsed.sheets.find(s => s.name === spec.sheetName);
  if (!sheet && parsed.sheets.length === 1) { sheet = parsed.sheets[0]; alerts.push({ code: 'SHEET_NAME_CHANGED', expected: spec.sheetName, found: sheet.name }); }
  if (parsed.sheets.length > 1) alerts.push({ code: 'EXTRA_SHEETS', found: parsed.sheets.map(s => s.name) });
  if (!sheet) return { compatible: false, sheet: null, rows: [], schemaAnalysis: { alerts: [...alerts, { code: 'SHEET_NOT_FOUND', expected: spec.sheetName, found: parsed.sheets.map(s => s.name) }], blocking: true } };
  const headerRow = sheet.rows.find(r => r.row === spec.headerRow);
  if (!headerRow) return { compatible: false, sheet: sheet.name, rows: [], schemaAnalysis: { alerts: [...alerts, { code: 'HEADER_ROW_MISSING' }], blocking: true } };
  const byHeader = new Map(spec.columns.map(c => [c.header, c]));
  const colMap = new Map(); // col index → {header, spec|null}
  const seen = new Map(); const unknown = []; const nonText = []; const dupMapped = new Map();
  for (const c of headerRow.cells) {
    const h = c.interpreted.kind === 'text' ? c.text : null;
    if (h === null) { if (c.interpreted.kind !== 'empty') nonText.push({ ref: c.ref, type: c.type, raw: c.raw }); continue; }
    if (seen.has(h)) {
      if (byHeader.has(h)) { const d = dupMapped.get(h) ?? { code: 'DUPLICATE_MAPPED_HEADER', header: h, refs: [seen.get(h)] }; d.refs.push(c.ref); dupMapped.set(h, d); }
      else alerts.push({ code: 'DUPLICATE_HEADER', header: h, refs: [seen.get(h), c.ref] });
      colMap.set(c.col, { header: h, spec: null, duplicate: true }); continue;
    }
    seen.set(h, c.ref);
    const s = byHeader.get(h) ?? null;
    if (!s) unknown.push({ header: h, ref: c.ref, col: c.col });
    colMap.set(c.col, { header: h, spec: s });
  }
  // Cabeçalho mapeado duplicado: qual coluna é a verdadeira é indecidível → arquivo bloqueado (nenhum valor descartado em silêncio).
  for (const d of dupMapped.values()) alerts.push({ ...d, blocking: true });
  if (nonText.length) alerts.push({ code: 'NON_TEXT_HEADER_CELLS', cells: nonText });
  if (unknown.length) alerts.push({ code: 'UNKNOWN_COLUMNS', columns: unknown });
  const missingRequired = spec.columns.filter(c => c.required && !seen.has(c.header)).map(c => c.header);
  const missingOptional = spec.columns.filter(c => !c.required && !seen.has(c.header)).map(c => c.header);
  if (missingRequired.length) alerts.push({ code: 'MISSING_REQUIRED_COLUMNS', columns: missingRequired });
  if (missingOptional.length) alerts.push({ code: 'MISSING_OPTIONAL_COLUMNS', columns: missingOptional });
  const actualKnownOrder = headerRow.cells.map(c => colMap.get(c.col)).filter(x => x && x.spec).map(x => x.header);
  const expectedOrder = spec.columnOrder.filter(h => seen.has(h));
  if (actualKnownOrder.join('\u0000') !== expectedOrder.join('\u0000')) alerts.push({ code: 'COLUMN_ORDER_CHANGED', expected: spec.columnOrder, found: headerRow.cells.map(c => colMap.get(c.col)?.header ?? null) });
  const headerCount = headerRow.cells.length;
  const rows = [];
  for (const r of sheet.rows) {
    if (r.row <= spec.headerRow) continue;
    const cells = r.cells.map(c => cellOut(c, colMap.get(c.col)?.header ?? null));
    const allEmpty = cells.every(c => c.interpreted.kind === 'empty');
    const beyond = cells.filter(c => !colMap.has(c.col) && c.interpreted.kind !== 'empty').map(c => c.ref);
    const present = new Set(r.cells.map(c => c.col));
    const missingCols = [...colMap.keys()].filter(k => !present.has(k)).length;
    rows.push({ sheet: sheet.name, row: r.row, cellCount: cells.length, emptyRow: allEmpty, incomplete: missingCols > 0, missingCellCount: missingCols, cellsBeyondHeader: beyond, cells });
  }
  const beyondRows = rows.filter(r => r.cellsBeyondHeader.length).length;
  if (beyondRows) alerts.push({ code: 'CELLS_BEYOND_HEADER', rows: beyondRows });
  const blocking = missingRequired.length > 0 || dupMapped.size > 0;
  return {
    compatible: !blocking, sheet: sheet.name, rows, colMap: [...colMap.entries()].map(([col, v]) => ({ col, header: v.header, mapped: !!v.spec })),
    schemaAnalysis: { alerts, blocking, headerCount, unknownColumns: unknown.map(u => u.header), missingRequired, missingOptional, duplicateMappedHeaders: [...dupMapped.keys()], schemaChanged: alerts.some(a => ['UNKNOWN_COLUMNS', 'MISSING_REQUIRED_COLUMNS', 'MISSING_OPTIONAL_COLUMNS', 'COLUMN_ORDER_CHANGED', 'DUPLICATE_HEADER', 'DUPLICATE_MAPPED_HEADER', 'SHEET_NAME_CHANGED', 'EXTRA_SHEETS', 'NON_TEXT_HEADER_CELLS', 'CELLS_BEYOND_HEADER'].includes(a.code)) },
  };
}
