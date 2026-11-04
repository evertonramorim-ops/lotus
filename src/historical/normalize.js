/**
 * Camada C — NORMALIZAÇÃO: linha extraída (camada B) → registro `lotus.historical-draw` v1.0.0.
 * Todo campo normalizado carrega `ref` (célula de origem) e `raw` (valor bruto). Nada é inventado:
 * - `numbers` = dezenas ordenadas crescentemente; `numbersAsListed` = ordem das colunas Bola1..N;
 * - `drawOrder` = null e `orderAvailable` = false no XLSX (planilha não traz ordem de extração);
 * - ausência (vazio, "-", coluna ausente) → null + absent=true + absenceReason (nunca zero);
 * - dinheiro em centavos (string), texto original preservado, sem transformação tributária;
 * - colunas desconhecidas / células além do cabeçalho → `extras` com referência de origem.
 * O registro NÃO contém estado de validação (que fica na camada D).
 * @module historical/normalize
 */
import { intFromCell, moneyFromCell, dateFromCell } from './values.js';

export const HISTORICAL_SCHEMA = 'lotus.historical-draw';
export const HISTORICAL_SCHEMA_VERSION = '1.0.0';

/**
 * @param {object} row linha da camada B
 * @param {object} spec adaptador
 * @param {{rawSha256:string, fileName:string, parser:{id:string,version:string}, date1904?:boolean}} src
 */
export function normalizeRow(row, spec, src) {
  const byHeader = new Map(); for (const c of row.cells) if (c.header !== null && !byHeader.has(c.header)) byHeader.set(c.header, c);
  const colOf = h => byHeader.get(h) ?? null;
  const specCol = kind => spec.columns.find(c => c.kind === kind);
  const contest = intFromCell(colOf(specCol('contest').header), 'Concurso', { min: 1 });
  const drawDate = dateFromCell(colOf(specCol('drawDate').header), specCol('drawDate').header, { allowSerial: true, date1904: !!src.date1904 });
  const balls = spec.columns.filter(c => c.kind === 'ball').map(c => intFromCell(colOf(c.header), c.header));
  const listed = balls.map(b => b.value);
  const numbers = listed.every(n => Number.isInteger(n)) ? [...listed].sort((a, b) => a - b) : null;
  const prizeTiers = spec.tiers.map(t => ({
    tier: t.tier, hits: t.hits, description: t.description,
    winners: intFromCell(colOf(t.winnersHeader), t.winnersHeader),
    prize: moneyFromCell(colOf(t.prizeHeader), t.prizeHeader),
    valueNature: 'AS_REPORTED_BY_SOURCE_NATURE_UNVERIFIED',
  }));
  const economic = {};
  for (const c of spec.columns.filter(x => x.kind === 'economic')) economic[c.key] = moneyFromCell(colOf(c.header), c.header);
  const text = key => { const sc = spec.columns.find(c => c.kind === 'text' && c.key === key); const cell = colOf(sc.header); return { text: cell ? cell.text : null, raw: cell ? cell.raw : null, absent: !cell || cell.interpreted.kind === 'empty', ref: cell ? cell.ref : null, column: sc.header }; };
  const extras = row.cells.filter(c => c.header === null || !spec.columns.some(s => s.header === c.header)).filter(c => c.interpreted.kind !== 'empty' || c.header !== null)
    .map(c => ({ origin: 'xlsx', header: c.header, ref: c.ref, col: c.col, type: c.type, raw: c.raw, text: c.text, interpreted: c.interpreted }));
  return {
    schema: HISTORICAL_SCHEMA, schemaVersion: HISTORICAL_SCHEMA_VERSION, lottery: spec.lottery,
    contest: contest.value, contestField: contest,
    drawDate: drawDate.iso, drawDateField: drawDate,
    numbers, numbersAsListed: listed, numberFields: balls, drawOrder: null, orderAvailable: false, numbersSource: 'XLSX_BOLA_COLUMNS',
    prizeTiers, economic,
    winnerLocations: text('winnerLocations'), observation: text('observation'),
    extras,
    source: { kind: 'XLSX', rawSha256: src.rawSha256, fileName: src.fileName, sheet: row.sheet, row: row.row, adapterId: spec.adapterId, adapterVersion: spec.version, parserId: src.parser.id, parserVersion: src.parser.version, incompleteRow: row.incomplete, missingCellCount: row.missingCellCount },
  };
}

/** Lista plana {campo → ref} para auditoria de rastreabilidade (todo campo tipado tem célula). */
export function traceMap(rec) {
  const t = { contest: rec.contestField.ref, drawDate: rec.drawDateField.ref };
  rec.numberFields.forEach((b, i) => { t[`numbers[${i}]`] = b.ref; });
  for (const p of rec.prizeTiers) { t[`tier${p.tier}.winners`] = p.winners.ref; t[`tier${p.tier}.prize`] = p.prize.ref; }
  for (const [k, v] of Object.entries(rec.economic)) t[`economic.${k}`] = v.ref;
  return t;
}
