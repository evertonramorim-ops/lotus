/**
 * Reconciliação XLSX × JSON (`lotus.reconciliation`, versão em RECONCILIATION_VERSION). Nunca sobrescreve uma fonte com a outra:
 * apenas classifica diferenças e envia divergências reais à quarentena (DIVERGENCIA_JSON_XLSX).
 * Números JSON são lidos preservando o literal (jsonnum.js) e convertidos para centavos sem float.
 * @module historical/reconcile
 */
import { parseJsonPreservingNumbers, isNum } from './jsonnum.js';
import { decimalLiteralToCents, parseBrDate } from './values.js';
import { createQuarantineEntry } from '../data/quarantine.js';
import { hashJson } from '../integrity/hash.js';
import { Q, REVIEW_PENDING } from './codes.js';
import { LOTTERIES } from '../lotteries/config.js';

export const RECONCILIATION_SCHEMA = 'lotus.reconciliation';
export const RECONCILIATION_VERSION = '1.2.0';
export const JSON_ADAPTER_ID = 'caixa-json-resultado';
export const JSON_ADAPTER_VERSION = '1.0.0';

export const CLASSES = Object.freeze({
  EQUIVALENTE: 'EQUIVALENTE', FORMATACAO: 'DIFERENCA_FORMATACAO', REPRESENTACAO: 'DIFERENCA_REPRESENTACAO', AUSENTE: 'AUSENTE_EM_UMA_FONTE',
  DIVERGENCIA: 'DIVERGENCIA_REAL', TEMPORAL: 'DIFERENCA_TEMPORAL', SEMANTICA: 'SEMANTICA_DESCONHECIDA', VALOR_INVALIDO: 'VALOR_INVALIDO', DADO_INVALIDO: 'DADO_INVALIDO',
});
const C = CLASSES;

/** Tabela de correspondência de campos (ADR-3b2-06). status: CONFIRMADO_ESTRUTURAL | HIPOTESE | SEM_CORRESPONDENTE. */
export const FIELD_CORRESPONDENCE = Object.freeze([
  { lotus: 'contest', xlsx: 'Concurso', json: 'numero', status: 'CONFIRMADO_ESTRUTURAL', compare: 'inteiro' },
  { lotus: 'drawDate', xlsx: 'Data Sorteio / Data do Sorteio', json: 'dataApuracao', status: 'CONFIRMADO_ESTRUTURAL', compare: 'data dd/mm/aaaa' },
  { lotus: 'numbers', xlsx: 'Bola1..BolaN', json: 'listaDezenas', status: 'CONFIRMADO_ESTRUTURAL', compare: 'conjunto ordenado de inteiros' },
  { lotus: 'drawOrder', xlsx: null, json: 'dezenasSorteadasOrdemSorteio', status: 'SEM_CORRESPONDENTE', compare: 'somente JSON' },
  { lotus: 'tier[k].winners', xlsx: 'Ganhadores k acertos (Lotomania 0: "Ganhadores Nenhum Número")', json: 'listaRateioPremio[descricaoFaixa="k acertos"].numeroDeGanhadores', status: 'CONFIRMADO_ESTRUTURAL', compare: 'inteiro' },
  { lotus: 'tier[k].prize', xlsx: 'Rateio k acertos', json: 'listaRateioPremio[descricaoFaixa="k acertos"].valorPremio', status: 'CONFIRMADO_ESTRUTURAL', compare: 'centavos (texto R$ × literal decimal)' },
  { lotus: 'economic.totalCollected', xlsx: 'Arrecadação Total / Arrecadacao Total', json: 'valorArrecadado', status: 'CONFIRMADO_ESTRUTURAL', compare: 'centavos' },
  { lotus: 'economic.nextPrizeEstimate', xlsx: 'Estimativa prêmio', json: 'valorEstimadoProximoConcurso', status: 'CONFIRMADO_ESTRUTURAL', compare: 'centavos' },
  { lotus: 'economic.specialAccumulated', xlsx: 'Acumulado Sorteio Especial …', json: 'valorAcumuladoConcursoEspecial', status: 'HIPOTESE', compare: 'centavos' },
  { lotus: 'economic.accumulatedTopTier', xlsx: 'Acumulado N acertos', json: 'valorAcumuladoProximoConcurso', status: 'HIPOTESE', compare: 'centavos (semântica não confirmada)' },
  { lotus: 'winnerLocations', xlsx: 'Cidade / UF', json: 'listaMunicipioUFGanhadores', status: 'HIPOTESE', compare: 'representação diferente (texto × lista)' },
  { lotus: 'observation', xlsx: 'Observação', json: 'observacao', status: 'CONFIRMADO_ESTRUTURAL', compare: 'texto' },
]);
const STRUCT = new Set(['contest', 'drawDate', 'numbers', 'winners', 'prize', 'totalCollected', 'nextPrizeEstimate']);

/** Inteiro seguro (literal JSON `{$number}` só com dígitos) ≥ min; distingue ausente / tipo incorreto / fora do domínio. */
function jsonIntField(v, min) {
  if (v === undefined || v === null) return { present: false, literal: null, value: null, valid: null, invalidReason: null };
  if (!isNum(v)) return { present: true, literal: typeof v === 'string' ? v : JSON.stringify(v), value: null, valid: false, invalidReason: 'TIPO_NAO_NUMERICO' };
  const t = v.$number;
  if (!/^-?\d+$/.test(t)) return { present: true, literal: t, value: null, valid: false, invalidReason: 'NAO_INTEIRO' };
  if (t.startsWith('-')) return { present: true, literal: t, value: null, valid: false, invalidReason: 'NEGATIVO' };
  const n = Number(t);
  if (!Number.isSafeInteger(n) || String(BigInt(t)) !== String(n)) return { present: true, literal: t, value: null, valid: false, invalidReason: 'FORA_DO_INTEIRO_SEGURO' };
  if (n < min) return { present: true, literal: t, value: null, valid: false, invalidReason: `MENOR_QUE_${min}` };
  return { present: true, literal: t, value: n, valid: true, invalidReason: null };
}
/** Lista de dezenas/ordem: cada item preservado {literal, value|null}; nunca insere NaN. */
function jsonIntList(a) {
  if (a === undefined || a === null) return { present: false, literal: null, items: null, typeValid: null };
  if (!Array.isArray(a)) return { present: true, literal: JSON.stringify(a), items: null, typeValid: false };
  const items = a.map(v => { const lit = typeof v === 'string' ? v : isNum(v) ? v.$number : JSON.stringify(v);
    const ok = (typeof v === 'string' || isNum(v)) && /^\d{1,3}$/.test(lit); return { literal: lit, value: ok ? Number(lit) : null }; });
  return { present: true, literal: a.map(v => (typeof v === 'string' ? v : isNum(v) ? v.$number : JSON.stringify(v))).join(','), items, typeValid: true };
}

/** Adaptador JSON: texto → registro comparável, preservando literais, presença, validade e motivo de cada campo mapeado. */
export function adaptJsonResult(text) {
  const j = parseJsonPreservingNumbers(text);
  // Valor monetário JSON: literal original + conversão + valid + motivo. Presente-mas-inválido ≠ ausente.
  const money = v => { if (v === undefined || v === null) return { present: false, literal: null, cents: null, valid: true, invalidReason: null };
    if (!isNum(v)) return { present: true, literal: typeof v === 'string' ? v : JSON.stringify(v), cents: null, valid: false, invalidReason: 'TIPO_NAO_NUMERICO' };
    const r = decimalLiteralToCents(v.$number); return { present: true, literal: v.$number, cents: r.cents, valid: r.valid, invalidReason: r.valid ? null : r.invalidReason }; };
  const cents = v => money(v).cents;
  // Estrutura de listaRateioPremio validada antes do uso; entradas não mapeadas/duplicadas preservadas.
  const L = j.listaRateioPremio; const tierList = { present: L !== undefined && L !== null, isArray: Array.isArray(L), unmapped: [], duplicates: [], literal: L === undefined ? null : Array.isArray(L) ? null : JSON.stringify(L) };
  const mapped = [];
  if (Array.isArray(L)) L.forEach((t, idx) => {
    const isObj = t !== null && typeof t === 'object' && !Array.isArray(t) && !isNum(t);
    const m = isObj ? /^(\d+) acertos?$/.exec(typeof t.descricaoFaixa === 'string' ? t.descricaoFaixa.trim() : '') : null;
    if (!m) { tierList.unmapped.push({ index: idx, element: isObj ? JSON.stringify(t, (k, v) => (isNum(v) ? v.$number : v)) : JSON.stringify(t), reason: isObj ? 'DESCRICAO_FAIXA_NAO_RECONHECIDA' : 'ELEMENTO_NAO_OBJETO' }); return; }
    const winnersField = jsonIntField(t.numeroDeGanhadores, 0); const faixaField = jsonIntField(t.faixa, 0);
    mapped.push({ index: idx, hits: Number(m[1]), description: t.descricaoFaixa, faixa: faixaField.value, faixaLiteral: faixaField.literal, winners: winnersField.value, winnersField, prizeCents: cents(t.valorPremio), prizeMoney: money(t.valorPremio), prizeLiteral: isNum(t.valorPremio) ? t.valorPremio.$number : null,
      element: JSON.stringify(t, (k, v) => (isNum(v) ? v.$number : v)) });
  });
  const count = new Map(); for (const t of mapped) count.set(t.hits, (count.get(t.hits) || 0) + 1);
  // Duplicatas: TODAS as entradas envolvidas preservadas (índice + elemento original) antes de qualquer exclusão.
  for (const [h, c] of count) if (c > 1) { const es = mapped.filter(t => t.hits === h); tierList.duplicates.push({ hits: h, indexes: es.map(t => t.index), entries: es.map(t => ({ index: t.index, element: t.element })) }); }
  const dup = new Set(tierList.duplicates.map(d => d.hits));
  const tiers = mapped.filter(t => !dup.has(t.hits)); // faixas únicas (uso direto); `tierEntries` mantém todas, inclusive duplicadas
  const contestField = jsonIntField(j.numero, 1);
  const dr = j.dataApuracao; let drawDateField;
  if (dr === undefined || dr === null) drawDateField = { present: false, literal: null, iso: null, valid: null, invalidReason: null };
  else if (typeof dr !== 'string') drawDateField = { present: true, literal: isNum(dr) ? dr.$number : JSON.stringify(dr), iso: null, valid: false, invalidReason: 'TIPO_NAO_TEXTO' };
  else { const iso = parseBrDate(dr) ?? lenientBrDate(dr); drawDateField = { present: true, literal: dr, iso, valid: iso !== null, invalidReason: iso ? null : 'DATA_MALFORMADA_OU_INEXISTENTE' }; }
  const numbersField = jsonIntList(j.listaDezenas); const drawOrderField = jsonIntList(j.dezenasSorteadasOrdemSorteio);
  const okList = f => f.items && f.items.length && f.items.every(i => i.value !== null);
  const known = new Set(['numero', 'dataApuracao', 'listaDezenas', 'dezenasSorteadasOrdemSorteio', 'listaRateioPremio', 'valorArrecadado', 'valorEstimadoProximoConcurso', 'valorAcumuladoConcursoEspecial', 'valorAcumuladoProximoConcurso', 'listaMunicipioUFGanhadores', 'observacao', 'tipoJogo']);
  return {
    adapter: { id: JSON_ADAPTER_ID, version: JSON_ADAPTER_VERSION }, tipoJogo: j.tipoJogo ?? null,
    contest: contestField.valid ? contestField.value : null, contestField,
    drawDateRaw: drawDateField.literal, drawDate: drawDateField.iso, drawDateField,
    numbers: okList(numbersField) ? numbersField.items.map(i => i.value).sort((a, b) => a - b) : null, numbersRaw: j.listaDezenas ?? null, numbersField,
    drawOrder: okList(drawOrderField) ? drawOrderField.items.map(i => i.value) : null, drawOrderField, tiers, tierEntries: mapped, tierList,
    economic: { totalCollected: cents(j.valorArrecadado), nextPrizeEstimate: cents(j.valorEstimadoProximoConcurso), specialAccumulated: cents(j.valorAcumuladoConcursoEspecial), accumulatedTopTier: cents(j.valorAcumuladoProximoConcurso) },
    economicMoney: { totalCollected: money(j.valorArrecadado), nextPrizeEstimate: money(j.valorEstimadoProximoConcurso), specialAccumulated: money(j.valorAcumuladoConcursoEspecial), accumulatedTopTier: money(j.valorAcumuladoProximoConcurso) },
    winnerLocationsCount: Array.isArray(j.listaMunicipioUFGanhadores) ? j.listaMunicipioUFGanhadores.length : null, observation: typeof j.observacao === 'string' ? j.observacao : null,
    jsonOnlyFields: Object.keys(j).filter(k => !known.has(k)).sort(),
  };
}

/** JSON: aceita d/m/aaaa com 1–2 dígitos (diferença de formatação), validando o calendário via parseBrDate. */
function lenientBrDate(t) { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t.trim()); return m ? parseBrDate(`${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`) : null; }

const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

export const MONETARY_REGIME = Object.freeze({ PRE_REAL: 'PRE_REAL_NAO_VERIFICADA', POS_REAL: 'POS_REAL', DESCONHECIDO: 'REGIME_MONETARIO_DESCONHECIDO' });
export const REAL_START = '1994-07-01';
/** Regime monetário a partir das DUAS datas: só é estabelecido com ambas válidas e iguais. */
export function monetaryRegime(xIso, jIso) {
  if (!xIso || !jIso) return { regime: MONETARY_REGIME.DESCONHECIDO, reason: !xIso && !jIso ? 'DATAS_AUSENTES_OU_INVALIDAS' : !xIso ? 'DATA_XLSX_AUSENTE_OU_INVALIDA' : 'DATA_JSON_AUSENTE_OU_INVALIDA' };
  if (xIso !== jIso) return { regime: MONETARY_REGIME.DESCONHECIDO, reason: (xIso < REAL_START) !== (jIso < REAL_START) ? 'DATAS_EM_LADOS_OPOSTOS_DE_1994_07_01' : 'DATAS_DIVERGENTES' };
  return { regime: xIso < REAL_START ? MONETARY_REGIME.PRE_REAL : MONETARY_REGIME.POS_REAL, reason: null };
}

/* ---- estado normalizado por fonte: {present, valid (null se ausente), literal, ref, column, reason, value} ---- */
const NA = { present: false, valid: null, literal: null, ref: null, column: null, reason: null, value: null, missing: true };
function xState(f, valueKey) { // célula XLSX (intFromCell / moneyFromCell / dateFromCell)
  if (!f) return NA;
  const present = !f.absent; const valid = present ? f.valid !== false && f[valueKey] !== null && f[valueKey] !== undefined : null;
  return { present, valid, literal: f.raw ?? null, ref: f.ref ?? null, column: f.column ?? null, reason: present && !valid ? f.invalidReason ?? 'VALOR_NAO_INTERPRETAVEL' : null, value: valid ? f[valueKey] : null, absenceReason: present ? null : f.absenceReason ?? null };
}
function jState(f, valueKey) { // campo JSON adaptado
  if (!f || !f.present) return { ...NA, missing: false };
  return { present: true, valid: !!f.valid, literal: f.literal ?? null, ref: null, column: null, reason: f.valid ? null : f.invalidReason ?? 'VALOR_NAO_INTERPRETAVEL', value: f.valid ? f[valueKey] : null };
}
/** Evidência de invalidez: presença e validade POR FONTE (ausente → present:false, valid:null).
 * Dezenas: transporta as células XLSX (ref, coluna, literal, motivo, lado) e os itens JSON inválidos (índice, literal, motivo). */
function evidence(xs, js) {
  const xInv = xs.present && xs.valid === false; const jInv = js.present && js.valid === false;
  return { invalidSource: xInv && jInv ? 'AMBOS' : xInv ? 'XLSX' : jInv ? 'JSON' : null,
    xlsxPresent: xs.present, xlsxValid: xs.valid, xlsxLiteral: xs.literal, xlsxRef: xs.ref, xlsxColumn: xs.column, xlsxInvalidReason: xInv ? xs.reason : null,
    ...(xs.cells ? { xlsxRefs: xs.cells.map(c => c.ref), xlsxCells: xs.cells, xlsxInvalidCells: xs.issues } : {}),
    jsonPresent: js.present, jsonValid: js.valid, jsonLiteral: js.literal, jsonInvalidReason: jInv ? js.reason : null,
    ...(js.jsonItems ? { jsonInvalidItems: js.issues } : {}),
    invalidReason: xInv && jInv ? `XLSX: ${xs.reason}; JSON: ${js.reason}` : xInv ? xs.reason : jInv ? js.reason : null };
}
const isInv = s => s.present && s.valid === false;

/** Problemas por item da lista de dezenas (ausência, item inválido, fora do intervalo, duplicata), com o lado de origem. */
function numberIssues(items, rules, side) {
  const out = [];
  const loc = (it, i) => (side === 'XLSX' ? { side, index: i, ref: it.ref ?? null, column: it.column ?? null, raw: it.raw ?? null } : { side, index: i, literal: it.literal ?? null });
  items.forEach((it, i) => {
    if (it.absent) out.push({ ...loc(it, i), reason: 'CELULA_AUSENTE', absenceReason: it.absenceReason ?? null });
    else if (it.value === null || !Number.isSafeInteger(it.value)) out.push({ ...loc(it, i), reason: side === 'XLSX' ? 'CELULA_INVALIDA' : 'ITEM_NAO_INTEIRO', cellInvalidReason: it.cellInvalidReason ?? null });
    else if (rules && (it.value < rules.minNumber || it.value > rules.maxNumber)) out.push({ ...loc(it, i), value: it.value, reason: `FORA_DO_INTERVALO_${rules.minNumber}_${rules.maxNumber}` });
  });
  const pos = new Map(); items.forEach((it, i) => { if (!it.absent && Number.isSafeInteger(it.value)) pos.set(it.value, [...(pos.get(it.value) || []), i]); });
  for (const [v, idx] of pos) if (idx.length > 1) for (const i of idx) out.push({ ...loc(items[i], i), value: v, reason: 'DEZENA_DUPLICADA', duplicateIndexes: idx });
  return out.sort((p, q) => p.index - q.index);
}
/** Dezenas: presença, quantidade, inteiro, faixa e duplicatas segundo src/lotteries/config.js. */
function numbersState(items, rules, literal, present, typeValid) {
  if (!present) return { present: false, valid: null, literal: null, reason: null, value: null };
  const bad = r => ({ present: true, valid: false, literal, reason: r, value: null });
  if (typeValid === false) return bad('TIPO_NAO_LISTA');
  if (!items.length) return bad('LISTA_VAZIA');
  if (items.some(i => i.value === null || !Number.isSafeInteger(i.value))) return bad('ITEM_NAO_INTEIRO');
  if (!rules) return bad('MODALIDADE_DESCONHECIDA');
  if (items.length !== rules.draw) return bad(`QUANTIDADE_${items.length}_ESPERADO_${rules.draw}`);
  if (items.some(i => i.value < rules.minNumber || i.value > rules.maxNumber)) return bad(`FORA_DO_INTERVALO_${rules.minNumber}_${rules.maxNumber}`);
  if (new Set(items.map(i => i.value)).size !== items.length) return bad('DEZENA_DUPLICADA');
  return { present: true, valid: true, literal, reason: null, value: items.map(i => i.value).sort((a, b) => a - b) };
}
function xNumbersState(x, rules) {
  const f = Array.isArray(x.numberFields) ? x.numberFields : null;
  if (!f) return numbersState(Array.isArray(x.numbers) ? x.numbers.map(v => ({ value: v })) : [], rules, Array.isArray(x.numbers) ? x.numbers.join(',') : null, Array.isArray(x.numbers), true);
  const literal = f.map(b => b.raw ?? '').join(',');
  if (f.every(b => b.absent)) return { present: false, valid: null, literal: null, reason: null, value: null };
  const items = f.map(b => ({ value: !b.absent && b.valid ? b.value : null, ref: b.ref ?? null, column: b.column ?? null, raw: b.raw ?? null, absent: !!b.absent, absenceReason: b.absent ? b.absenceReason ?? null : null, cellInvalidReason: !b.absent && b.valid === false ? b.invalidReason ?? null : null }));
  const s = numbersState(items, rules, literal, true, true);
  const cells = items.map((it, i) => ({ side: 'XLSX', index: i, ref: it.ref, column: it.column, raw: it.raw, value: it.value, absent: it.absent, valid: !it.absent && it.value !== null }));
  return { ...s, refs: f.map(b => b.ref ?? null), cells, issues: s.valid === false ? numberIssues(items, rules, 'XLSX') : [] };
}
function jNumbersState(jnf, rules) {
  const items = (jnf.items || []).map(i => ({ value: i.value, literal: i.literal ?? (i.value !== null && i.value !== undefined ? String(i.value) : null) }));
  const s = numbersState(items, rules, jnf.literal, jnf.present, jnf.typeValid);
  return s.valid === false && jnf.typeValid !== false && items.length ? { ...s, jsonItems: true, issues: numberIssues(items, rules, 'JSON') } : s;
}

/**
 * Compara um registro histórico (XLSX, aceito ou em quarentena) com o JSON do mesmo concurso.
 * Prioridade por campo: inválido (VALOR_INVALIDO monetário / DADO_INVALIDO estrutural) > ausência >
 * semântica desconhecida (regime monetário, hipótese, estrutura JSON inutilizável) > comparação de dois valores válidos.
 * @param {object|null} x registro lotus.historical-draw (null se o concurso não está no XLSX)
 * @param {object} j saída de adaptJsonResult
 * @param {{xlsxLastContest:number, xlsxObservedAt:string, jsonObservedAt:string, lottery?:string}} ctx
 */
export function compareRecords(x, j, ctx) {
  const rows = []; const add = (field, cls, xv, jv, note, flags) => rows.push({ field, class: cls, xlsx: xv ?? null, json: jv ?? null, note: note ?? null, structural: STRUCT.has(field.replace(/^tier\[\d+\]\./, '').replace(/^economic\./, '')), ...(flags || {}) });
  const jc = j.contestField ? jState(j.contestField, 'value') : { present: j.contest !== null, valid: j.contest !== null ? true : null, literal: j.contest, value: j.contest };
  if (!x) {
    if (isInv(jc)) add('contest', C.DADO_INVALIDO, null, jc.literal, 'número do concurso JSON presente mas inválido (exige inteiro seguro > 0)', evidence(NA, jc));
    else if (!jc.present) add('contest', C.AUSENTE, null, null, 'concurso ausente no JSON');
    else if (j.contest > ctx.xlsxLastContest) add('contest', C.TEMPORAL, null, j.contest, `concurso posterior ao último do XLSX (${ctx.xlsxLastContest}); XLSX observado ${ctx.xlsxObservedAt}, JSON ${ctx.jsonObservedAt}`);
    else add('contest', C.AUSENTE, null, j.contest, 'concurso presente no JSON e ausente no XLSX');
    return rows;
  }
  const lottery = x.lottery ?? ctx.lottery ?? null;
  const rules = lottery && Object.prototype.hasOwnProperty.call(LOTTERIES, lottery) ? LOTTERIES[lottery] : null;
  /** Campo estrutural genérico: inválido > ausência > comparação. */
  const structural = (field, xs, js, eq, { xAbsentWithJ = C.AUSENTE, xAbsentNote = null, fmt } = {}) => {
    if (isInv(xs) || isInv(js)) return add(field, C.DADO_INVALIDO, xs.literal, js.literal, `dado estrutural presente mas inválido (origem ${evidence(xs, js).invalidSource}); sem comparação, nunca DIVERGENCIA_REAL`, evidence(xs, js));
    if (!xs.present && !js.present) return add(field, C.AUSENTE, xs.literal, null, 'ausente nas duas fontes', { xlsxPresent: false, jsonPresent: false });
    if (!xs.present) return add(field, xAbsentWithJ, xs.missing ? '<inexistente no XLSX>' : xs.literal, js.literal, xAbsentNote ?? 'ausente no XLSX', { xlsxPresent: false, jsonPresent: true });
    if (!js.present) return add(field, C.AUSENTE, xs.literal, null, 'ausente no JSON', { xlsxPresent: true, jsonPresent: false });
    if (!eq(xs.value, js.value)) return add(field, C.DIVERGENCIA, xs.literal, js.literal);
    return add(field, fmt ? fmt(xs, js) : C.EQUIVALENTE, xs.literal, js.literal);
  };
  structural('contest', xState(x.contestField ?? { raw: x.contest, absent: x.contest == null, valid: true, value: x.contest }, 'value'), jc, (a, b) => a === b);
  const xd = xState(x.drawDateField, 'iso'); const jd = j.drawDateField ? jState(j.drawDateField, 'iso') : { present: j.drawDate !== null, valid: j.drawDate !== null ? true : null, literal: j.drawDateRaw, value: j.drawDate };
  structural('drawDate', xd, jd, (a, b) => a === b, { fmt: (a, b) => (a.literal === b.literal ? C.EQUIVALENTE : C.FORMATACAO) });
  const xn = xNumbersState(x, rules);
  const jnf = j.numbersField ?? { present: Array.isArray(j.numbers), items: (j.numbers || []).map(v => ({ value: v })), typeValid: true, literal: j.numbers && j.numbers.join(',') };
  const jn = jNumbersState(jnf, rules);
  structural('numbers', { ...xn, ref: null, column: 'Bola1..BolaN' }, { ...jn, ref: null, column: null }, (a, b) => eqArr(a, b));
  const dof = j.drawOrderField;
  if (dof && dof.present && (dof.typeValid === false || !dof.items.length || dof.items.some(i => i.value === null))) add('drawOrder', C.DADO_INVALIDO, null, dof.literal, 'ordem de sorteio JSON presente mas inválida', { invalidSource: 'JSON', jsonPresent: true, jsonValid: false, jsonLiteral: dof.literal, invalidReason: dof.typeValid === false ? 'TIPO_NAO_LISTA' : !dof.items.length ? 'LISTA_VAZIA' : 'ITEM_NAO_INTEIRO' });
  else add('drawOrder', j.drawOrder && j.drawOrder.length ? C.AUSENTE : C.EQUIVALENTE, null, j.drawOrder ? j.drawOrder.join(',') : null, 'XLSX não informa ordem de extração');

  const reg = monetaryRegime(xd.valid ? xd.value : null, jd.valid ? jd.value : null);
  const regFlags = reg.regime === MONETARY_REGIME.POS_REAL ? { monetaryRegime: reg.regime } : { monetaryRegime: reg.regime, unidadeMonetariaVerificada: false, ...(reg.reason ? { monetaryRegimeReason: reg.reason } : {}), xlsxDrawDate: xd.literal, jsonDrawDate: jd.literal };
  /** Campo monetário: inválido (VALOR_INVALIDO, origem explícita) > ausência > regime/hipótese > comparação. */
  const money = (field, xs, js, { xAbsentWithJ = C.AUSENTE, xAbsentNote = null, hyp = false, xMissingLabel = '<inexistente no XLSX>', jMissingClass = C.AUSENTE, jMissingNote = 'valor ausente no JSON' } = {}) => {
    const xv = xs.missing ? xMissingLabel : xs.literal;
    if (isInv(xs) || isInv(js)) return add(field, C.VALOR_INVALIDO, xv, js.literal, `valor monetário presente mas não interpretável (origem ${evidence(xs, js).invalidSource}); sem comparação, nunca DIVERGENCIA_REAL`, { ...evidence(xs, js), ...regFlags });
    if (!xs.present && !js.present) return add(field, C.AUSENTE, xv, null, 'ausente nas duas fontes', { xlsxPresent: false, jsonPresent: false, ...regFlags });
    if (!xs.present) return add(field, xAbsentWithJ, xv, js.literal, xAbsentNote ?? 'ausente no XLSX', { xlsxPresent: false, jsonPresent: true, jsonLiteral: js.literal, ...regFlags });
    if (!js.present) return add(field, jMissingClass, xv, null, jMissingNote, { xlsxPresent: true, jsonPresent: false, xlsxLiteral: xs.literal, ...regFlags });
    if (reg.regime === MONETARY_REGIME.PRE_REAL) return add(field, C.SEMANTICA, xs.literal, js.literal, PRE_REAL_NOTE, { xlsxLiteral: xs.literal, jsonLiteral: js.literal, ...regFlags });
    if (reg.regime === MONETARY_REGIME.DESCONHECIDO) return add(field, C.SEMANTICA, xs.literal, js.literal, `${UNKNOWN_REGIME_NOTE} (${reg.reason})`, { xlsxLiteral: xs.literal, jsonLiteral: js.literal, ...regFlags });
    const eq = xs.value === js.value;
    if (hyp) return add(field, eq ? C.EQUIVALENTE : C.SEMANTICA, xs.literal, js.literal, eq ? 'valores iguais; correspondência semântica é HIPÓTESE' : 'correspondência semântica não confirmada', regFlags);
    add(field, eq ? C.EQUIVALENTE : C.DIVERGENCIA, xs.literal, js.literal, eq && field.endsWith('.prize') ? 'mesmo valor em centavos (texto R$ × literal decimal)' : null, regFlags);
  };

  // ---- faixas: estrutura JSON validada; união XLSX ∪ JSON; ganhadores e prêmio SEMPRE em linhas próprias ----
  const tl = j.tierList ?? { present: true, isArray: true, unmapped: [], duplicates: [] };
  const listUsable = tl.present && tl.isArray;
  if (!tl.present) add('json:listaRateioPremio', C.AUSENTE, null, null, 'listaRateioPremio ausente ou nula no JSON; faixas sem lado JSON');
  else if (!tl.isArray) add('json:listaRateioPremio', C.DADO_INVALIDO, null, tl.literal, 'listaRateioPremio não é lista; faixas não comparáveis', { invalidSource: 'JSON', jsonPresent: true, jsonValid: false, jsonLiteral: tl.literal, invalidReason: 'TIPO_NAO_LISTA' });
  const unrecognized = rules ? (j.tierEntries ?? j.tiers).filter(t => !rules.prizeTiers.includes(t.hits)).map(t => ({ index: t.index, hits: t.hits, reason: 'FAIXA_NAO_PREVISTA_NA_MODALIDADE' })) : [];
  if (tl.unmapped.length || tl.duplicates.length || unrecognized.length) add('json:listaRateioPremio', C.DADO_INVALIDO, null, `${tl.unmapped.length} não mapeada(s), ${tl.duplicates.length} duplicada(s), ${unrecognized.length} não prevista(s)`, 'entradas preservadas e excluídas da comparação automática', { invalidSource: 'JSON', jsonPresent: true, jsonValid: false, invalidReason: 'ESTRUTURA_DE_FAIXAS_INVALIDA', unmapped: tl.unmapped, duplicates: tl.duplicates, unrecognized });
  const ambiguous = tl.unmapped.length > 0;
  // União COMPLETA XLSX ∪ JSON: todas as entradas JSON mapeadas (inclusive duplicadas e não previstas) entram na união.
  const jEntries = j.tierEntries ?? j.tiers;
  const byHits = new Map(); for (const e of jEntries) byHits.set(e.hits, [...(byHits.get(e.hits) || []), e]);
  const hitsAll = [...new Set([...x.prizeTiers.map(t => t.hits), ...byHits.keys()])].sort((a, b) => b - a);
  const isUnrec = h => !!rules && !rules.prizeTiers.includes(h);
  const jwOf = e => jState(e.winnersField ?? { present: e.winners !== null, valid: true, value: e.winners, literal: e.winners }, 'value');
  const jpOf = e => jState({ ...e.prizeMoney, valid: e.prizeMoney.present ? e.prizeMoney.valid : null }, 'cents');
  const fieldEv = st => ({ present: st.present, literal: st.literal, valid: st.valid, invalidReason: isInv(st) ? st.reason : null });
  /** Evidência por entrada JSON da faixa: índice, descrição, faixa, acertos, ganhadores e prêmio (literal, validade, motivo). */
  const entryEv = e => ({ index: e.index, description: e.description ?? null, faixa: e.faixaLiteral ?? (e.faixa ?? null), hits: e.hits, element: e.element ?? null, winners: fieldEv(jwOf(e)), prize: fieldEv(jpOf(e)) });
  /**
   * Faixa duplicada no JSON — precedência POR CAMPO:
   *   valor presente e inválido (XLSX e/ou qualquer entrada JSON) → VALOR_INVALIDO (prêmio) / DADO_INVALIDO (ganhadores),
   *     com invalidSource derivado SOMENTE da invalidez demonstrada dos valores (AMBOS só se os dois lados têm valor inválido);
   *   valores individualmente válidos e ao menos uma entrada com o campo → DADO_INVALIDO (associação ambígua, origem JSON);
   *   nenhuma entrada JSON traz o campo → classe de ausência correspondente.
   * A ambiguidade estrutural é registrada à parte (jsonTierIssue) e nunca apaga a validade individual dos valores.
   */
  const dupField = (h, kind, xt, xs, ents) => {
    const field = `tier[${h}].${kind}`; const isMoney = kind === 'prize';
    const jss = ents.map(e => (isMoney ? jpOf(e) : jwOf(e)));
    const jBad = jss.map((st, i) => ({ st, e: ents[i] })).filter(o => isInv(o.st));
    const jAny = jss.some(st => st.present);
    const jLit = jss.map((st, i) => `[${ents[i].index}] ${st.present ? st.literal : '<ausente>'}`).join('; ');
    const jComb = { present: jAny, valid: jAny ? jBad.length === 0 : null, literal: jAny ? jLit : null, ref: null, column: null, reason: jBad.length ? jBad.map(o => `[${o.e.index}] ${o.st.reason}`).join('; ') : null };
    const issue = { jsonTierIssue: { source: 'JSON', reasons: ['FAIXA_DUPLICADA', ...(isUnrec(h) ? ['FAIXA_NAO_PREVISTA_NA_MODALIDADE'] : [])], indexes: ents.map(e => e.index) }, jsonEntries: ents.map(entryEv) };
    const xv = xt ? xs.literal : '<faixa inexistente no XLSX>'; const extra = isMoney ? regFlags : {};
    if (isInv(xs) || jBad.length) {
      const ev = evidence(xs, jComb);
      return add(field, isMoney ? C.VALOR_INVALIDO : C.DADO_INVALIDO, xv, jLit, `${isMoney ? 'valor monetário' : 'ganhadores'} presente(s) mas inválido(s) (origem ${ev.invalidSource}) em faixa duplicada no JSON; sem comparação, nunca DIVERGENCIA_REAL`, { ...ev, ...issue, ...extra });
    }
    if (jAny) {
      const ev = evidence(xs, jComb);
      return add(field, C.DADO_INVALIDO, xv, jLit, 'faixa duplicada em listaRateioPremio: valores individualmente válidos, associação ambígua; sem comparação', { ...ev, invalidSource: 'JSON', jsonInvalidReason: 'FAIXA_DUPLICADA_ASSOCIACAO_AMBIGUA', invalidReason: 'FAIXA_DUPLICADA_ASSOCIACAO_AMBIGUA', ...issue, ...extra });
    }
    return add(field, C.AUSENTE, xv, null, xs.present ? 'nenhuma das entradas duplicadas no JSON traz o campo' : 'ausente nas duas fontes (entradas duplicadas no JSON sem o campo)', { xlsxPresent: xs.present, xlsxValid: xs.valid, jsonPresent: false, jsonValid: null, ...issue, ...extra });
  };
  for (const h of hitsAll) {
    const xt = x.prizeTiers.find(t => t.hits === h); const ents = byHits.get(h) || []; const jt = ents.length === 1 ? ents[0] : null;
    const xw = xt ? xState(xt.winners, 'value') : NA; const xp = xt ? xState(xt.prize, 'cents') : NA;
    if (ents.length > 1) { dupField(h, 'winners', xt, xw, ents); dupField(h, 'prize', xt, xp, ents); continue; }
    if (xt && !jt) {
      // Linha de faixa (listagem) preservada para semântica documentada; campos têm linhas próprias abaixo.
      if (listUsable) {
        if (xt.winners.absent && xt.prize.absent) add(`tier[${h}]`, C.REPRESENTACAO, `${xt.winners.raw}|${xt.prize.raw}`, '<faixa não listada>', 'ambas as fontes indicam ausência da faixa');
        else add(`tier[${h}]`, C.SEMANTICA, `${xt.winners.raw}|${xt.prize.raw}`, '<faixa não listada>', 'XLSX traz valor (inclusive zero) e JSON não lista a faixa');
      }
      const jAbs = { ...NA, missing: false, literal: null };
      const why = !tl.present ? ['AUSENTE', 'listaRateioPremio ausente no JSON'] : !tl.isArray || ambiguous ? ['SEMANTICA', 'estrutura de faixas JSON inválida/ambígua; ausência não conclusiva'] : ['SEMANTICA', 'JSON não lista a faixa'];
      const jMissingClass = why[0] === 'AUSENTE' ? C.AUSENTE : C.SEMANTICA;
      // ganhadores
      if (isInv(xw)) add(`tier[${h}].winners`, C.DADO_INVALIDO, xw.literal, '<faixa não listada>', 'ganhadores XLSX presentes mas inválidos', evidence(xw, jAbs));
      else if (!xw.present) add(`tier[${h}].winners`, C.AUSENTE, xw.literal, '<faixa não listada>', 'ausente nas duas fontes', { xlsxPresent: false, jsonPresent: false });
      else add(`tier[${h}].winners`, jMissingClass, xw.literal, '<faixa não listada>', why[1], { xlsxPresent: true, jsonPresent: false });
      money(`tier[${h}].prize`, xp, jAbs, { jMissingClass, jMissingNote: why[1] });
      continue;
    }
    const jw = jwOf(jt); const jp = jpOf(jt);
    const n0 = rows.length;
    if (!xt) {
      structural(`tier[${h}].winners`, { ...NA }, jw, () => false, { xAbsentNote: 'faixa só no JSON' });
      money(`tier[${h}].prize`, NA, jp, { xMissingLabel: '<faixa inexistente no XLSX>', xAbsentNote: 'faixa só no JSON' });
    } else {
      structural(`tier[${h}].winners`, xw, jw, (a, b) => a === b, { xAbsentWithJ: C.SEMANTICA, xAbsentNote: 'XLSX ausente ("-"/vazio) e faixa listada no JSON' });
      money(`tier[${h}].prize`, xp, jp, { xAbsentWithJ: C.SEMANTICA, xAbsentNote: 'prêmio XLSX ausente ("-"/vazio) e JSON lista a faixa com valor; sem comparação' });
    }
    // Faixa não prevista para a modalidade: evidência estrutural (entrada JSON, índice, motivo) anexada às duas linhas por campo.
    if (isUnrec(h)) for (const r of rows.slice(n0)) Object.assign(r, { jsonTierIssue: { source: 'JSON', reasons: ['FAIXA_NAO_PREVISTA_NA_MODALIDADE'], indexes: [jt.index] }, jsonEntries: [entryEv(jt)] });
  }
  for (const k of ['totalCollected', 'nextPrizeEstimate', 'specialAccumulated', 'accumulatedTopTier']) {
    const xm = x.economic[k]; const jm = j.economicMoney ? j.economicMoney[k] : { present: j.economic[k] !== null, literal: j.economic[k], cents: j.economic[k], valid: true };
    if (!xm && !jm.present) continue;
    const hyp = FIELD_CORRESPONDENCE.find(f => f.lotus === `economic.${k}`).status === 'HIPOTESE';
    money(`economic.${k}`, xState(xm, 'cents'), jState({ ...jm, valid: jm.present ? jm.valid : null }, 'cents'), { hyp, xMissingLabel: '<coluna inexistente>' });
  }
  const xl = x.winnerLocations.text; const xEmpty = !xl || !xl.trim();
  if (xEmpty && !j.winnerLocationsCount) add('winnerLocations', C.EQUIVALENTE, null, 0);
  else if (xEmpty !== !j.winnerLocationsCount) add('winnerLocations', C.AUSENTE, xEmpty ? null : '<texto>', j.winnerLocationsCount, 'conteúdo não reproduzido no relatório');
  else add('winnerLocations', C.REPRESENTACAO, '<texto>', j.winnerLocationsCount, 'texto livre × lista estruturada');
  const xo = x.observation.text ?? ''; const jo = j.observation ?? '';
  if (xo === jo) add('observation', C.EQUIVALENTE, xo ? '<texto>' : '', jo ? '<texto>' : '');
  else if (xo.replace(/\s+/g, ' ').trim() === jo.replace(/\s+/g, ' ').trim()) add('observation', C.FORMATACAO, '<texto>', '<texto>', 'difere apenas em espaços');
  else add('observation', C.SEMANTICA, xo ? '<texto>' : '', jo ? '<texto>' : '', 'textos diferentes; não comparável automaticamente');
  for (const f of j.jsonOnlyFields) add(`json:${f}`, C.AUSENTE, null, '<somente JSON>');
  return rows;
}

const UNKNOWN_REGIME_NOTE = 'regime monetário DESCONHECIDO (datas ausentes, inválidas, divergentes ou em lados opostos de 01/07/1994): SEMANTICA_DESCONHECIDA; literais e datas preservados; sem conversão; nunca DIVERGENCIA_REAL';
const PRE_REAL_NOTE = 'unidade monetária pré-Real NÃO verificada: SEMANTICA_DESCONHECIDA mesmo com centavos coincidentes; literais das duas fontes preservados; sem conversão, fator tributário ou 0,7; nunca DIVERGENCIA_REAL';

/** Quarentena para divergências reais (stage 'dataset'); o registro XLSX NÃO é alterado. */
export function divergenceQuarantine(x, j, rows, ctx) {
  const div = rows.filter(r => r.class === C.DIVERGENCIA);
  if (!div.length) return null;
  return createQuarantineEntry(JSON.parse(JSON.stringify({ rawSha256: x.source.rawSha256, stage: 'dataset', parserVersion: `${JSON_ADAPTER_ID}/${JSON_ADAPTER_VERSION}`, candidate: x,
    reasons: div.map(r => ({ code: Q.DIVERGENCIA_JSON_XLSX, message: `divergência em ${r.field}`, lottery: x.lottery, contest: x.contest, anomalyType: Q.DIVERGENCIA_JSON_XLSX, originalValue: r.xlsx, interpretedValue: r.json, validatorId: 'RECONCILIACAO', validatorVersion: RECONCILIATION_VERSION, rule: 'comparação campo a campo XLSX × JSON',
      evidence: { jsonSha256: ctx.jsonSha256, jsonUrl: ctx.jsonUrl, jsonObservedAt: ctx.jsonObservedAt, xlsxObservedAt: ctx.xlsxObservedAt }, reviewStatus: REVIEW_PENDING, humanDecision: null })) })));
}

export function summarize(all) {
  const byClass = {}; for (const r of all) byClass[r.class] = (byClass[r.class] || 0) + 1;
  return Object.fromEntries(Object.keys(byClass).sort().map(k => [k, byClass[k]]));
}
export { hashJson };
