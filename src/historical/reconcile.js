/**
 * Reconciliação XLSX × JSON (`lotus.reconciliation`, versão em RECONCILIATION_VERSION). Nunca sobrescreve uma fonte com a outra:
 * apenas classifica diferenças e envia divergências reais à quarentena (DIVERGENCIA_JSON_XLSX).
 * Números JSON são lidos preservando o literal (jsonnum.js) e convertidos para centavos sem float.
 * @module historical/reconcile
 */
import { parseJsonPreservingNumbers, isNum, toJsonText, jsonType } from './jsonnum.js';
import { decimalLiteralToCents, parseBrDate } from './values.js';
import { createQuarantineEntry } from '../data/quarantine.js';
import { hashJson } from '../integrity/hash.js';
import { Q, REVIEW_PENDING } from './codes.js';
import { LOTTERIES } from '../lotteries/config.js';
import { periodFor, TIER_RULES_ID, TIER_RULES_VERSION } from './tier-rules.js';

export const RECONCILIATION_SCHEMA = 'lotus.reconciliation';
// 2.0.0 (incompatível com 1.2.0): faixa fora da configuração sem regra histórica comprovada → SEMANTICA_DESCONHECIDA
// (antes AUSENTE); correspondências HIPOTESE nunca EQUIVALENTE; JSON sem contraparte XLSX validado por inteiro;
// ordem de sorteio validada contra listaDezenas; evidências com estado/tipo/literal/regra consultada.
// 3.0.0 (incompatível com 2.0.0): winnerLocations com conteúdo em só uma fonte → SEMANTICA_DESCONHECIDA (antes AUSENTE);
// amostra com proveniência rejeitada (estado PROVENIENCIA_REJEITADA, sem parse); fonte XLSX ambígua (xlsxStatus AMBIGUO,
// sem comparação); evidências provenance/xlsxSource/xlsxAmbiguity nas entradas.
export const RECONCILIATION_VERSION = '3.0.0';
export const JSON_ADAPTER_ID = 'caixa-json-resultado';
// 2.0.0 (incompatível): raiz não-objeto → JsonSchemaError; campos com estado AUSENTE/NULO/PRESENTE, tipo e literal;
// marcador numérico privado (WeakSet) sem colisão com objetos do JSON; limite em bytes UTF-8 reais.
export const JSON_ADAPTER_VERSION = '2.0.0';

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

/** Erro estrutural do JSON (sintaxe válida, estrutura superior incorreta): distinto de SyntaxError. */
export class JsonSchemaError extends Error { constructor(code, message, detail = {}) { super(message); this.name = 'JsonSchemaError'; this.code = code; this.detail = detail; } }

/** Estado bruto de um campo JSON: AUSENTE (chave inexistente) ≠ NULO (null) ≠ PRESENTE; tipo e literal fiel. */
const rawState = v => ({ state: v === undefined ? 'AUSENTE' : v === null ? 'NULO' : 'PRESENTE', type: jsonType(v), literal: v === undefined ? null : typeof v === 'string' ? v : toJsonText(v) });

/** Inteiro seguro (token numérico só com dígitos) ≥ min; distingue ausente / nulo / tipo incorreto / fora do domínio. */
function jsonIntField(v, min) {
  const st = rawState(v);
  if (v === undefined || v === null) return { present: false, ...st, literal: null, value: null, valid: null, invalidReason: null };
  if (!isNum(v)) return { present: true, ...st, value: null, valid: false, invalidReason: 'TIPO_NAO_NUMERICO' };
  const t = v.$number;
  if (!/^-?\d+$/.test(t)) return { present: true, ...st, value: null, valid: false, invalidReason: 'NAO_INTEIRO' };
  if (t.startsWith('-')) return { present: true, ...st, value: null, valid: false, invalidReason: 'NEGATIVO' };
  const n = Number(t);
  if (!Number.isSafeInteger(n) || String(BigInt(t)) !== String(n)) return { present: true, ...st, value: null, valid: false, invalidReason: 'FORA_DO_INTEIRO_SEGURO' };
  if (n < min) return { present: true, ...st, value: null, valid: false, invalidReason: `MENOR_QUE_${min}` };
  return { present: true, ...st, value: n, valid: true, invalidReason: null };
}
/** `faixa`: SEM obrigatoriedade nem intervalo inventados — só tipo (inteiro seguro); inválido é preservado, nunca descartado. */
function faixaField(v) {
  const st = rawState(v);
  if (v === undefined || v === null) return { ...st, value: null, valid: null, invalidReason: null };
  if (!isNum(v)) return { ...st, value: null, valid: false, invalidReason: 'TIPO_NAO_NUMERICO' };
  if (!/^-?\d+$/.test(v.$number)) return { ...st, value: null, valid: false, invalidReason: 'NAO_INTEIRO' };
  const n = Number(v.$number);
  if (!Number.isSafeInteger(n) || String(BigInt(v.$number)) !== String(n)) return { ...st, value: null, valid: false, invalidReason: 'FORA_DO_INTEIRO_SEGURO' };
  return { ...st, value: n, valid: true, invalidReason: null };
}
/** `descricaoFaixa`: "<k> acerto(s)" com k inteiro seguro (sem conversão imprecisa); descrição e literal originais preservados. */
function descricaoField(v) {
  const st = rawState(v);
  if (v === undefined || v === null) return { ...st, hitsLiteral: null, hits: null, valid: false, invalidReason: 'DESCRICAO_FAIXA_AUSENTE' };
  if (typeof v !== 'string') return { ...st, hitsLiteral: null, hits: null, valid: false, invalidReason: 'DESCRICAO_FAIXA_TIPO_NAO_TEXTO' };
  const m = /^(\d+) acertos?$/.exec(v.trim());
  if (!m) return { ...st, hitsLiteral: null, hits: null, valid: false, invalidReason: 'DESCRICAO_FAIXA_NAO_RECONHECIDA' };
  if (m[1].length > 15 || !Number.isSafeInteger(Number(m[1])) || String(BigInt(m[1])) !== String(Number(m[1]))) return { ...st, hitsLiteral: m[1], hits: null, valid: false, invalidReason: 'ACERTOS_FORA_DO_INTEIRO_SEGURO' };
  return { ...st, hitsLiteral: m[1], hits: Number(m[1]), valid: true, invalidReason: null };
}
/** Lista de dezenas/ordem: cada item preservado {index, literal, type, value|null} NA ORDEM ORIGINAL; nunca insere NaN. */
function jsonIntList(a) {
  const st = rawState(a);
  if (a === undefined || a === null) return { present: false, ...st, literal: null, items: null, typeValid: null };
  if (!Array.isArray(a)) return { present: true, ...st, items: null, typeValid: false };
  const lit = v => (typeof v === 'string' ? v : toJsonText(v));
  const items = a.map((v, index) => { const l = lit(v); const ok = (typeof v === 'string' || isNum(v)) && /^\d{1,3}$/.test(l); return { index, literal: l, type: jsonType(v), value: ok ? Number(l) : null }; });
  return { present: true, ...st, literal: a.map(lit).join(','), items, typeValid: true };
}
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !isNum(v);

/** Adaptador JSON: texto → registro comparável, preservando literais, presença (ausente ≠ nulo), tipo, validade e motivo. */
export function adaptJsonResult(text) {
  const j = parseJsonPreservingNumbers(text);
  if (!isPlainObject(j)) throw new JsonSchemaError('JSON_RAIZ_NAO_OBJETO', `raiz JSON deve ser objeto (recebido ${jsonType(j)})`, { rootType: jsonType(j), literal: toJsonText(j).slice(0, 200) });
  // Valor monetário JSON: literal original + conversão + valid + motivo. Presente-mas-inválido ≠ ausente; nulo ≠ ausente (state).
  const money = v => { if (v === undefined || v === null) return { present: false, literal: null, cents: null, valid: true, invalidReason: null };
    if (!isNum(v)) return { present: true, literal: typeof v === 'string' ? v : toJsonText(v), cents: null, valid: false, invalidReason: 'TIPO_NAO_NUMERICO' };
    const r = decimalLiteralToCents(v.$number); return { present: true, literal: v.$number, cents: r.cents, valid: r.valid, invalidReason: r.valid ? null : r.invalidReason }; };
  const moneyState = v => { const st = rawState(v); return { state: st.state, type: st.type }; }; // ausente ≠ nulo (contrato de money() inalterado)
  const cents = v => money(v).cents;
  // Estrutura de listaRateioPremio validada antes do uso; entradas não mapeadas/duplicadas preservadas.
  const L = j.listaRateioPremio; const tierList = { present: L !== undefined && L !== null, isArray: Array.isArray(L), unmapped: [], duplicates: [], literal: L === undefined ? null : Array.isArray(L) ? null : toJsonText(L), state: rawState(L).state, type: jsonType(L) };
  const mapped = [];
  if (Array.isArray(L)) L.forEach((t, idx) => {
    const isObj = isPlainObject(t);
    const element = toJsonText(t);
    const descriptionField = isObj ? descricaoField(t.descricaoFaixa) : null;
    if (!isObj || !descriptionField.valid) { tierList.unmapped.push({ index: idx, element, elementType: jsonType(t), reason: isObj ? descriptionField.invalidReason : 'ELEMENTO_NAO_OBJETO', ...(isObj ? { descriptionField, faixaField: faixaField(t.faixa) } : {}) }); return; }
    const winnersField = jsonIntField(t.numeroDeGanhadores, 0); const ff = faixaField(t.faixa);
    mapped.push({ index: idx, hits: descriptionField.hits, description: t.descricaoFaixa, descriptionField, faixa: ff.value, faixaLiteral: ff.literal, faixaField: ff, winners: winnersField.value, winnersField, prizeCents: cents(t.valorPremio), prizeMoney: money(t.valorPremio), prizeLiteral: isNum(t.valorPremio) ? t.valorPremio.$number : null, prizeState: moneyState(t.valorPremio), element });
  });
  const count = new Map(); for (const t of mapped) count.set(t.hits, (count.get(t.hits) || 0) + 1);
  // Duplicatas: TODAS as entradas envolvidas preservadas (índice + elemento original) antes de qualquer exclusão.
  for (const [h, c] of count) if (c > 1) { const es = mapped.filter(t => t.hits === h); tierList.duplicates.push({ hits: h, indexes: es.map(t => t.index), entries: es.map(t => ({ index: t.index, element: t.element })) }); }
  const dup = new Set(tierList.duplicates.map(d => d.hits));
  const tiers = mapped.filter(t => !dup.has(t.hits)); // faixas únicas (uso direto); `tierEntries` mantém todas, inclusive duplicadas
  const contestField = jsonIntField(j.numero, 1);
  const dr = j.dataApuracao; let drawDateField;
  if (dr === undefined || dr === null) drawDateField = { present: false, ...rawState(dr), literal: null, iso: null, valid: null, invalidReason: null };
  else if (typeof dr !== 'string') drawDateField = { present: true, ...rawState(dr), iso: null, valid: false, invalidReason: 'TIPO_NAO_TEXTO' };
  else { const iso = parseBrDate(dr) ?? lenientBrDate(dr); drawDateField = { present: true, ...rawState(dr), iso, valid: iso !== null, invalidReason: iso ? null : 'DATA_MALFORMADA_OU_INEXISTENTE' }; }
  const numbersField = jsonIntList(j.listaDezenas); const drawOrderField = jsonIntList(j.dezenasSorteadasOrdemSorteio);
  const okList = f => f.items && f.items.length && f.items.every(i => i.value !== null);
  // Campos textuais/lista: tipo incorreto NUNCA vira null silencioso (valid:false + motivo); elementos preservados sem esquema inventado.
  const textField = v => ({ ...rawState(v), present: v !== undefined && v !== null, value: typeof v === 'string' ? v : null, valid: v === undefined || v === null ? null : typeof v === 'string', invalidReason: v === undefined || v === null || typeof v === 'string' ? null : 'TIPO_NAO_TEXTO' });
  const W = j.listaMunicipioUFGanhadores;
  const winnerLocationsField = { ...rawState(W), present: W !== undefined && W !== null, valid: W === undefined || W === null ? null : Array.isArray(W), invalidReason: W === undefined || W === null || Array.isArray(W) ? null : 'TIPO_NAO_LISTA', count: Array.isArray(W) ? W.length : null, elements: Array.isArray(W) ? W.map(toJsonText) : null };
  const known = new Set(['numero', 'dataApuracao', 'listaDezenas', 'dezenasSorteadasOrdemSorteio', 'listaRateioPremio', 'valorArrecadado', 'valorEstimadoProximoConcurso', 'valorAcumuladoConcursoEspecial', 'valorAcumuladoProximoConcurso', 'listaMunicipioUFGanhadores', 'observacao', 'tipoJogo']);
  const observationField = textField(j.observacao); const tipoJogoField = textField(j.tipoJogo);
  return {
    adapter: { id: JSON_ADAPTER_ID, version: JSON_ADAPTER_VERSION }, tipoJogo: tipoJogoField.value, tipoJogoField,
    contest: contestField.valid ? contestField.value : null, contestField,
    drawDateRaw: drawDateField.literal, drawDate: drawDateField.iso, drawDateField,
    numbers: okList(numbersField) ? numbersField.items.map(i => i.value).sort((a, b) => a - b) : null, numbersRaw: j.listaDezenas ?? null, numbersField,
    drawOrder: okList(drawOrderField) ? drawOrderField.items.map(i => i.value) : null, drawOrderField, tiers, tierEntries: mapped, tierList,
    economic: { totalCollected: cents(j.valorArrecadado), nextPrizeEstimate: cents(j.valorEstimadoProximoConcurso), specialAccumulated: cents(j.valorAcumuladoConcursoEspecial), accumulatedTopTier: cents(j.valorAcumuladoProximoConcurso) },
    economicMoneyState: { totalCollected: moneyState(j.valorArrecadado), nextPrizeEstimate: moneyState(j.valorEstimadoProximoConcurso), specialAccumulated: moneyState(j.valorAcumuladoConcursoEspecial), accumulatedTopTier: moneyState(j.valorAcumuladoProximoConcurso) },
    economicMoney: { totalCollected: money(j.valorArrecadado), nextPrizeEstimate: money(j.valorEstimadoProximoConcurso), specialAccumulated: money(j.valorAcumuladoConcursoEspecial), accumulatedTopTier: money(j.valorAcumuladoProximoConcurso) },
    winnerLocationsCount: winnerLocationsField.count, winnerLocationsField, observation: observationField.value, observationField,
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
  const st = f && f.state ? { state: f.state } : {};
  if (!f || !f.present) return { ...NA, missing: false, ...st };
  return { present: true, valid: !!f.valid, literal: f.literal ?? null, ref: null, column: null, reason: f.valid ? null : f.invalidReason ?? 'VALOR_NAO_INTERPRETAVEL', value: f.valid ? f[valueKey] : null, ...st, ...(f.type ? { type: f.type } : {}) };
}
/** Evidência de invalidez: presença e validade POR FONTE (ausente → present:false, valid:null).
 * Dezenas: transporta as células XLSX (ref, coluna, literal, motivo, lado) e os itens JSON inválidos (índice, literal, motivo). */
function evidence(xs, js) {
  const xInv = xs.present && xs.valid === false; const jInv = js.present && js.valid === false;
  return { invalidSource: xInv && jInv ? 'AMBOS' : xInv ? 'XLSX' : jInv ? 'JSON' : null,
    xlsxPresent: xs.present, xlsxValid: xs.valid, xlsxLiteral: xs.literal, xlsxRef: xs.ref, xlsxColumn: xs.column, xlsxInvalidReason: xInv ? xs.reason : null,
    ...(xs.cells ? { xlsxRefs: xs.cells.map(c => c.ref), xlsxCells: xs.cells, xlsxInvalidCells: xs.issues } : {}),
    jsonPresent: js.present, jsonValid: js.valid, jsonLiteral: js.literal, jsonInvalidReason: jInv ? js.reason : null, ...(js.state ? { jsonState: js.state } : {}), ...(js.type ? { jsonType: js.type } : {}),
    ...(js.jsonItems ? { jsonInvalidItems: js.issues } : {}),
    invalidReason: xInv && jInv ? `XLSX: ${xs.reason}; JSON: ${js.reason}` : xInv ? xs.reason : jInv ? js.reason : null };
}
const isInv = s => s.present && s.valid === false;

/** Problemas por item da lista de dezenas (ausência, item inválido, fora do intervalo, duplicata), com o lado de origem. */
function numberIssues(items, rules, side) {
  const out = [];
  const loc = (it, i) => (side === 'XLSX' ? { side, index: i, ref: it.ref ?? null, column: it.column ?? null, raw: it.raw ?? null } : { side, index: i, literal: it.literal ?? null, ...(it.type ? { type: it.type } : {}) });
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
  const items = (jnf.items || []).map(i => ({ value: i.value, literal: i.literal ?? (i.value !== null && i.value !== undefined ? String(i.value) : null), ...(i.type ? { type: i.type } : {}) }));
  const s = numbersState(items, rules, jnf.literal, jnf.present, jnf.typeValid);
  return s.valid === false && jnf.typeValid !== false && items.length ? { ...s, jsonItems: true, issues: numberIssues(items, rules, 'JSON') } : s;
}

/** Registro XLSX vazio: usado quando o concurso não existe no XLSX, para que o JSON seja validado campo a campo mesmo assim. */
const EMPTY_TEXT = Object.freeze({ text: null, raw: null, absent: true, ref: null, column: null });
const emptyXlsx = lottery => ({ lottery, contest: null, contestField: null, drawDateField: null, numberFields: null, numbers: null, prizeTiers: [], economic: {}, winnerLocations: EMPTY_TEXT, observation: EMPTY_TEXT, __missing: true });
export const TIER_STATUS = Object.freeze({ PREVISTA: 'PREVISTA', DESCONHECIDA: 'DESCONHECIDA_SEM_REGRA_HISTORICA_COMPROVADA', PROIBIDA: 'PROIBIDA_POR_REGRA_HISTORICA_COMPROVADA', IMPOSSIVEL: 'MATEMATICAMENTE_IMPOSSIVEL', MODALIDADE_DESCONHECIDA: 'MODALIDADE_DESCONHECIDA' });

/**
 * Compara um registro histórico (XLSX, aceito ou em quarentena) com o JSON do mesmo concurso.
 * Prioridade por campo: inválido (VALOR_INVALIDO monetário / DADO_INVALIDO estrutural) > ausência >
 * semântica desconhecida (regime monetário, hipótese, faixa sem regra histórica comprovada, estrutura JSON inutilizável) >
 * comparação de dois valores válidos. Sem registro XLSX (x === null) o JSON é validado por inteiro (sem retorno antecipado);
 * nenhuma linha pode ser DIVERGENCIA_REAL sem duas fontes válidas e comparáveis.
 * @param {object|null} x registro lotus.historical-draw (null se o concurso não está no XLSX)
 * @param {object} j saída de adaptJsonResult
 * @param {{xlsxLastContest:number, xlsxObservedAt:string, jsonObservedAt:string, lottery?:string}} ctx
 */
export function compareRecords(x, j, ctx) {
  const rows = []; const add = (field, cls, xv, jv, note, flags) => rows.push({ field, class: cls, xlsx: xv ?? null, json: jv ?? null, note: note ?? null, structural: STRUCT.has(field.replace(/^tier\[\d+\]\./, '').replace(/^economic\./, '')), ...(flags || {}) });
  const jc = j.contestField ? jState(j.contestField, 'value') : { present: j.contest !== null, valid: j.contest !== null ? true : null, literal: j.contest, value: j.contest };
  const xMissing = !x;
  const lottery = (x && x.lottery) ?? ctx.lottery ?? null;
  if (xMissing) {
    if (isInv(jc)) add('contest', C.DADO_INVALIDO, null, jc.literal, 'número do concurso JSON presente mas inválido (exige inteiro seguro > 0)', evidence(NA, jc));
    else if (!jc.present) add('contest', C.AUSENTE, null, null, j.contestField && j.contestField.state === 'NULO' ? 'concurso nulo no JSON' : 'concurso ausente no JSON', { xlsxPresent: false, jsonPresent: false, ...(j.contestField ? { jsonState: j.contestField.state } : {}) });
    else if (j.contest > ctx.xlsxLastContest) add('contest', C.TEMPORAL, null, j.contest, `concurso posterior ao último do XLSX (${ctx.xlsxLastContest}); XLSX observado ${ctx.xlsxObservedAt}, JSON ${ctx.jsonObservedAt}`);
    else add('contest', C.AUSENTE, null, j.contest, 'concurso presente no JSON e ausente no XLSX');
    x = emptyXlsx(lottery);
  }
  const rules = lottery && Object.prototype.hasOwnProperty.call(LOTTERIES, lottery) ? LOTTERIES[lottery] : null;
  const xLabel = xMissing ? '<registro inexistente no XLSX>' : '<inexistente no XLSX>';
  /** Campo estrutural genérico: inválido > ausência > comparação. */
  const structural = (field, xs, js, eq, { xAbsentWithJ = C.AUSENTE, xAbsentNote = null, fmt } = {}) => {
    const jst = js.state ? { jsonState: js.state } : {};
    if (isInv(xs) || isInv(js)) return add(field, C.DADO_INVALIDO, xs.missing ? xLabel : xs.literal, js.literal, `dado estrutural presente mas inválido (origem ${evidence(xs, js).invalidSource}); sem comparação, nunca DIVERGENCIA_REAL`, evidence(xs, js));
    if (!xs.present && !js.present) return add(field, C.AUSENTE, xs.literal, null, 'ausente nas duas fontes', { xlsxPresent: false, jsonPresent: false, ...jst });
    if (!xs.present) return add(field, xAbsentWithJ, xs.missing ? xLabel : xs.literal, js.literal, xAbsentNote ?? (xMissing ? 'registro inexistente no XLSX' : 'ausente no XLSX'), { xlsxPresent: false, jsonPresent: true });
    if (!js.present) return add(field, C.AUSENTE, xs.literal, null, 'ausente no JSON', { xlsxPresent: true, jsonPresent: false, ...jst });
    if (!eq(xs.value, js.value)) return add(field, C.DIVERGENCIA, xs.literal, js.literal);
    return add(field, fmt ? fmt(xs, js) : C.EQUIVALENTE, xs.literal, js.literal);
  };
  if (!xMissing) structural('contest', xState(x.contestField ?? { raw: x.contest, absent: x.contest == null, valid: true, value: x.contest }, 'value'), jc, (a, b) => a === b);
  const xd = xState(x.drawDateField, 'iso'); const jd = j.drawDateField ? jState(j.drawDateField, 'iso') : { present: j.drawDate !== null, valid: j.drawDate !== null ? true : null, literal: j.drawDateRaw, value: j.drawDate };
  structural('drawDate', xd, jd, (a, b) => a === b, { fmt: (a, b) => (a.literal === b.literal ? C.EQUIVALENTE : C.FORMATACAO) });
  const xn = xNumbersState(x, rules);
  const jnf = j.numbersField ?? { present: Array.isArray(j.numbers), items: (j.numbers || []).map(v => ({ value: v })), typeValid: true, literal: j.numbers && j.numbers.join(',') };
  const jn = jNumbersState(jnf, rules);
  structural('numbers', { ...xn, ref: null, column: 'Bola1..BolaN', ...(xMissing ? { missing: true } : {}) }, { ...jn, ref: null, column: null }, (a, b) => eqArr(a, b));
  // ---- ordem de sorteio (somente JSON): validação estrutural completa; coerência por CONJUNTO com listaDezenas; sequência original preservada ----
  const dof = j.drawOrderField;
  if (!dof || !dof.present) add('drawOrder', C.AUSENTE, null, null, `ordem de sorteio ${dof && dof.state === 'NULO' ? 'nula' : 'ausente'} no JSON; XLSX não informa ordem de extração`, { xlsxPresent: false, jsonPresent: false, ...(dof ? { jsonState: dof.state } : {}) });
  else {
    const ds = jNumbersState(dof, rules);
    if (isInv(ds)) add('drawOrder', C.DADO_INVALIDO, null, dof.literal, 'ordem de sorteio JSON presente mas estruturalmente inválida; sem comparação', { ...evidence(NA, { ...ds, ref: null, column: null }), jsonSequence: dof.items ? dof.items.map(i => i.literal) : null });
    else if (jn.valid && !eqArr(ds.value, jn.value)) {
      const a = new Set(jn.value), o = new Set(ds.value);
      add('drawOrder', C.DADO_INVALIDO, null, dof.literal, 'conjunto da ordem de sorteio difere de listaDezenas: inconsistência INTERNA do JSON (não é divergência entre fontes)', { invalidSource: 'JSON', xlsxPresent: false, xlsxValid: null, jsonPresent: true, jsonValid: false, jsonLiteral: dof.literal, jsonInvalidReason: 'ORDEM_INCONSISTENTE_COM_LISTA_DEZENAS', invalidReason: 'ORDEM_INCONSISTENTE_COM_LISTA_DEZENAS', jsonSequence: dof.items.map(i => i.literal), listaDezenasLiteral: jnf.literal, onlyInDrawOrder: ds.value.filter(v => !a.has(v)), onlyInListaDezenas: jn.value.filter(v => !o.has(v)) });
    } else add('drawOrder', C.AUSENTE, null, dof.literal, 'XLSX não informa ordem de extração', { xlsxPresent: false, jsonPresent: true, jsonValid: true, jsonSequence: dof.items.map(i => i.literal), setCoherenceChecked: !!jn.valid });
  }

  const reg = monetaryRegime(xd.valid ? xd.value : null, jd.valid ? jd.value : null);
  const regFlags = reg.regime === MONETARY_REGIME.POS_REAL ? { monetaryRegime: reg.regime } : { monetaryRegime: reg.regime, unidadeMonetariaVerificada: false, ...(reg.reason ? { monetaryRegimeReason: reg.reason } : {}), xlsxDrawDate: xd.literal, jsonDrawDate: jd.literal };
  /** Campo monetário: inválido (VALOR_INVALIDO, origem explícita) > ausência > regime/hipótese > comparação. */
  const money = (field, xs, js, { xAbsentWithJ = C.AUSENTE, xAbsentNote = null, hyp = false, xMissingLabel = xLabel, jMissingClass = C.AUSENTE, jMissingNote = 'valor ausente no JSON' } = {}) => {
    const xv = xs.missing ? xMissingLabel : xs.literal; const jst = js.state ? { jsonState: js.state } : {};
    if (isInv(xs) || isInv(js)) return add(field, C.VALOR_INVALIDO, xv, js.literal, `valor monetário presente mas não interpretável (origem ${evidence(xs, js).invalidSource}); sem comparação, nunca DIVERGENCIA_REAL`, { ...evidence(xs, js), ...regFlags });
    if (!xs.present && !js.present) return add(field, C.AUSENTE, xv, null, 'ausente nas duas fontes', { xlsxPresent: false, jsonPresent: false, ...jst, ...regFlags });
    if (!xs.present) return add(field, xAbsentWithJ, xv, js.literal, xAbsentNote ?? (xMissing ? 'registro inexistente no XLSX' : 'ausente no XLSX'), { xlsxPresent: false, jsonPresent: true, jsonLiteral: js.literal, ...regFlags });
    if (!js.present) return add(field, jMissingClass, xv, null, jMissingNote, { xlsxPresent: true, jsonPresent: false, xlsxLiteral: xs.literal, ...jst, ...regFlags });
    const eq = xs.value === js.value;
    // Correspondência HIPOTESE: nunca equivalência nem divergência conclusivas; coincidência registrada à parte.
    if (hyp) return add(field, C.SEMANTICA, xs.literal, js.literal, eq ? 'valores coincidem, mas a correspondência semântica é HIPÓTESE: não se afirma que representem o mesmo conceito' : 'correspondência semântica é HIPÓTESE: diferença não conclusiva', { correspondence: 'HIPOTESE', numericCoincidence: eq, literalCoincidence: xs.literal === js.literal, xlsxLiteral: xs.literal, jsonLiteral: js.literal, ...regFlags });
    if (reg.regime === MONETARY_REGIME.PRE_REAL) return add(field, C.SEMANTICA, xs.literal, js.literal, PRE_REAL_NOTE, { xlsxLiteral: xs.literal, jsonLiteral: js.literal, ...regFlags });
    if (reg.regime === MONETARY_REGIME.DESCONHECIDO) return add(field, C.SEMANTICA, xs.literal, js.literal, `${UNKNOWN_REGIME_NOTE} (${reg.reason})`, { xlsxLiteral: xs.literal, jsonLiteral: js.literal, ...regFlags });
    add(field, eq ? C.EQUIVALENTE : C.DIVERGENCIA, xs.literal, js.literal, eq && field.endsWith('.prize') ? 'mesmo valor em centavos (texto R$ × literal decimal)' : null, regFlags);
  };

  // ---- faixas: estrutura JSON validada; união XLSX ∪ JSON; ganhadores e prêmio SEMPRE em linhas próprias ----
  const contestForRule = !xMissing && Number.isSafeInteger(x.contest) ? x.contest : j.contest;
  const period = rules && Number.isSafeInteger(contestForRule) ? periodFor(lottery, contestForRule) : null;
  /** Situação de uma faixa: regra consultada, status de verificação e justificativa (nada é promovido a regra confirmada). */
  const tierStatus = h => {
    const base = { ruleSet: `${TIER_RULES_ID}/${TIER_RULES_VERSION}`, lottery, contest: Number.isSafeInteger(contestForRule) ? contestForRule : null, configPrizeTiers: rules ? [...rules.prizeTiers] : null,
      period: period ? { from: period.from, to: period.to, presentTiers: [...period.presentTiers], status: period.status } : null, verificationStatus: period ? period.status : 'SEM_PERIODO' };
    if (!rules) return { ...base, status: TIER_STATUS.MODALIDADE_DESCONHECIDA, reason: 'MODALIDADE_DESCONHECIDA' };
    if (h > rules.draw) return { ...base, status: TIER_STATUS.IMPOSSIVEL, reason: `ACERTOS_${h}_MAIOR_QUE_${rules.draw}_DEZENAS_SORTEADAS` };
    if (period && period.status !== 'RULE_NOT_VERIFIED') return period.presentTiers.includes(h) ? { ...base, status: TIER_STATUS.PREVISTA, reason: 'PREVISTA_POR_REGRA_HISTORICA_VERIFICADA' } : { ...base, status: TIER_STATUS.PROIBIDA, reason: 'FAIXA_PROIBIDA_POR_REGRA_HISTORICA_VERIFICADA' };
    if (rules.prizeTiers.includes(h)) return { ...base, status: TIER_STATUS.PREVISTA, reason: 'PREVISTA_NA_CONFIGURACAO_ATUAL' };
    return { ...base, status: TIER_STATUS.DESCONHECIDA, reason: 'FAIXA_FORA_DA_CONFIGURACAO_ATUAL_SEM_REGRA_HISTORICA_COMPROVADA' };
  };
  const tl = j.tierList ?? { present: true, isArray: true, unmapped: [], duplicates: [] };
  const listUsable = tl.present && tl.isArray;
  if (!tl.present) add('json:listaRateioPremio', C.AUSENTE, null, null, `listaRateioPremio ${tl.state === 'NULO' ? 'nula' : 'ausente'} no JSON; faixas sem lado JSON`, tl.state ? { jsonState: tl.state } : {});
  else if (!tl.isArray) add('json:listaRateioPremio', C.DADO_INVALIDO, null, tl.literal, 'listaRateioPremio não é lista; faixas não comparáveis', { invalidSource: 'JSON', jsonPresent: true, jsonValid: false, jsonLiteral: tl.literal, invalidReason: 'TIPO_NAO_LISTA', ...(tl.type ? { jsonType: tl.type } : {}) });
  // União COMPLETA XLSX ∪ JSON: todas as entradas JSON mapeadas (inclusive duplicadas e não previstas) entram na união.
  const jEntries = j.tierEntries ?? j.tiers;
  const byHits = new Map(); for (const e of jEntries) byHits.set(e.hits, [...(byHits.get(e.hits) || []), e]);
  const unrecognized = rules ? [...byHits.keys()].map(h => [h, tierStatus(h)]).filter(([, st]) => st.status !== TIER_STATUS.PREVISTA).flatMap(([h, st]) => byHits.get(h).map(e => ({ index: e.index, hits: h, status: st.status, reason: st.reason }))) : [];
  const hardBad = unrecognized.filter(u => u.status === TIER_STATUS.IMPOSSIVEL || u.status === TIER_STATUS.PROIBIDA);
  if (tl.unmapped.length || tl.duplicates.length || unrecognized.length) {
    const structuralBad = tl.unmapped.length || tl.duplicates.length || hardBad.length;
    add('json:listaRateioPremio', structuralBad ? C.DADO_INVALIDO : C.SEMANTICA, null, `${tl.unmapped.length} não mapeada(s), ${tl.duplicates.length} duplicada(s), ${unrecognized.length} fora da configuração (${hardBad.length} impossível(is)/proibida(s))`,
      structuralBad ? 'entradas malformadas/duplicadas/impossíveis preservadas e excluídas da comparação automática' : 'faixa(s) fora da configuração atual sem regra histórica comprovada: semântica desconhecida (não é ausência nem estrutura inválida)',
      { invalidSource: structuralBad ? 'JSON' : null, jsonPresent: true, jsonValid: structuralBad ? false : true, invalidReason: structuralBad ? 'ESTRUTURA_DE_FAIXAS_INVALIDA' : null, unmapped: tl.unmapped, duplicates: tl.duplicates, unrecognized });
  }
  const ambiguous = tl.unmapped.length > 0;
  const hitsAll = [...new Set([...x.prizeTiers.map(t => t.hits), ...byHits.keys()])].sort((a, b) => b - a);
  const jwOf = e => jState(e.winnersField ?? { present: e.winners !== null, valid: true, value: e.winners, literal: e.winners }, 'value');
  const jpOf = e => jState({ ...e.prizeMoney, valid: e.prizeMoney.present ? e.prizeMoney.valid : null, ...(e.prizeState ? { state: e.prizeState.state } : {}) }, 'cents');
  const fieldEv = (st, raw) => ({ present: st.present, state: raw ? raw.state : null, type: raw ? raw.type : null, literal: st.literal, valid: st.valid, invalidReason: isInv(st) ? st.reason : null });
  /** Evidência por entrada JSON da faixa: origem, índice, descrição, acertos, faixa, elemento, ganhadores e prêmio (estado, tipo, literal, validade, motivo). */
  const entryEv = e => ({ origin: 'JSON', index: e.index, description: e.description ?? null,
    descriptionField: e.descriptionField ? { state: e.descriptionField.state, type: e.descriptionField.type, literal: e.descriptionField.literal, hitsLiteral: e.descriptionField.hitsLiteral, valid: e.descriptionField.valid, invalidReason: e.descriptionField.invalidReason } : null,
    hits: e.hits, faixa: e.faixaLiteral ?? (e.faixa ?? null), faixaField: e.faixaField ?? null, element: e.element ?? null,
    winners: fieldEv(jwOf(e), e.winnersField), prize: fieldEv(jpOf(e), e.prizeState) });
  const tierFlags = st => ({ tierRule: st });
  /**
   * Faixa duplicada no JSON — precedência POR CAMPO:
   *   valor presente e inválido (XLSX e/ou qualquer entrada JSON) → VALOR_INVALIDO (prêmio) / DADO_INVALIDO (ganhadores),
   *     com invalidSource derivado SOMENTE da invalidez demonstrada dos valores (AMBOS só se os dois lados têm valor inválido);
   *   valores individualmente válidos e ao menos uma entrada com o campo → DADO_INVALIDO (associação ambígua, origem JSON);
   *   nenhuma entrada JSON traz o campo → ausência (faixa prevista) / DADO_INVALIDO (impossível/proibida) / SEMANTICA (desconhecida).
   * A ambiguidade estrutural é registrada à parte (jsonTierIssue) e nunca apaga a validade individual dos valores.
   */
  const dupField = (h, kind, xt, xs, ents, st) => {
    const field = `tier[${h}].${kind}`; const isMoney = kind === 'prize';
    const jss = ents.map(e => (isMoney ? jpOf(e) : jwOf(e)));
    const jBad = jss.map((s2, i) => ({ st: s2, e: ents[i] })).filter(o => isInv(o.st));
    const jAny = jss.some(s2 => s2.present);
    const jLit = jss.map((s2, i) => `[${ents[i].index}] ${s2.present ? s2.literal : '<ausente>'}`).join('; ');
    const jComb = { present: jAny, valid: jAny ? jBad.length === 0 : null, literal: jAny ? jLit : null, ref: null, column: null, reason: jBad.length ? jBad.map(o => `[${o.e.index}] ${o.st.reason}`).join('; ') : null };
    const issue = { jsonTierIssue: { source: 'JSON', reasons: ['FAIXA_DUPLICADA', ...(st.status !== TIER_STATUS.PREVISTA ? [st.reason] : [])], indexes: ents.map(e => e.index) }, jsonEntries: ents.map(entryEv), ...tierFlags(st) };
    const xv = xt ? xs.literal : '<faixa inexistente no XLSX>'; const extra = isMoney ? regFlags : {};
    if (isInv(xs) || jBad.length) {
      const ev = evidence(xs, jComb);
      return add(field, isMoney ? C.VALOR_INVALIDO : C.DADO_INVALIDO, xv, jLit, `${isMoney ? 'valor monetário' : 'ganhadores'} presente(s) mas inválido(s) (origem ${ev.invalidSource}) em faixa duplicada no JSON; sem comparação, nunca DIVERGENCIA_REAL`, { ...ev, ...issue, classificationReason: 'VALOR_INVALIDO_PRECEDE_AMBIGUIDADE', ...extra });
    }
    if (jAny) {
      const ev = evidence(xs, jComb);
      return add(field, C.DADO_INVALIDO, xv, jLit, 'faixa duplicada em listaRateioPremio: valores individualmente válidos, associação ambígua; sem comparação', { ...ev, invalidSource: 'JSON', jsonInvalidReason: 'FAIXA_DUPLICADA_ASSOCIACAO_AMBIGUA', invalidReason: 'FAIXA_DUPLICADA_ASSOCIACAO_AMBIGUA', ...issue, classificationReason: 'FAIXA_DUPLICADA_ASSOCIACAO_AMBIGUA', ...extra });
    }
    const flags = { xlsxPresent: xs.present, xlsxValid: xs.valid, jsonPresent: false, jsonValid: null, ...issue, ...extra };
    if (st.status === TIER_STATUS.IMPOSSIVEL || st.status === TIER_STATUS.PROIBIDA) return add(field, C.DADO_INVALIDO, xv, null, 'faixa duplicada e impossível/proibida; campo ausente nas entradas', { ...flags, invalidSource: 'JSON', invalidReason: st.reason, jsonInvalidReason: st.reason, classificationReason: st.reason });
    if (st.status !== TIER_STATUS.PREVISTA) return add(field, C.SEMANTICA, xv, null, 'faixa duplicada sem regra histórica comprovada; campo ausente nas entradas: semântica desconhecida, nunca ausência comum', { ...flags, classificationReason: st.reason });
    return add(field, C.AUSENTE, xv, null, xs.present ? 'nenhuma das entradas duplicadas no JSON traz o campo' : 'ausente nas duas fontes (entradas duplicadas no JSON sem o campo)', { ...flags, classificationReason: 'CAMPO_AUSENTE_EM_TODAS_AS_ENTRADAS' });
  };
  /** Faixa única fora da configuração (desconhecida, proibida ou impossível): valor inválido > invalidez estrutural > semântica desconhecida. */
  const specialTier = (h, xt, xw, xp, jt, st) => {
    const issue = { jsonTierIssue: { source: 'JSON', reasons: [st.reason], indexes: [jt.index] }, jsonEntries: [entryEv(jt)], ...tierFlags(st) };
    const hard = st.status === TIER_STATUS.IMPOSSIVEL || st.status === TIER_STATUS.PROIBIDA;
    for (const [kind, xs, js] of [['winners', xw, jwOf(jt)], ['prize', xp, jpOf(jt)]]) {
      const field = `tier[${h}].${kind}`; const isMoney = kind === 'prize'; const xv = xt ? xs.literal : '<faixa inexistente no XLSX>'; const extra = isMoney ? regFlags : {};
      if (isInv(xs) || isInv(js)) { const ev = evidence(xs, js); add(field, isMoney ? C.VALOR_INVALIDO : C.DADO_INVALIDO, xv, js.literal, `${isMoney ? 'valor monetário' : 'ganhadores'} presente(s) mas inválido(s) (origem ${ev.invalidSource}); sem comparação, nunca DIVERGENCIA_REAL`, { ...ev, ...issue, classificationReason: 'VALOR_INVALIDO_PRECEDE_SITUACAO_DA_FAIXA', ...extra }); continue; }
      const ev = evidence(xs, js);
      if (hard) add(field, C.DADO_INVALIDO, xv, js.literal, `faixa ${st.status === TIER_STATUS.IMPOSSIVEL ? 'matematicamente impossível para a modalidade' : 'proibida por regra histórica verificada'}; sem comparação, nunca ausência nem DIVERGENCIA_REAL`, { ...ev, invalidSource: 'JSON', jsonInvalidReason: st.reason, invalidReason: st.reason, ...issue, classificationReason: st.reason, ...extra });
      else add(field, C.SEMANTICA, xv, js.literal, 'faixa presente no JSON e fora da configuração atual, sem regra histórica comprovada (períodos RULE_NOT_VERIFIED não são regra oficial): semântica desconhecida, nunca ausência nem DIVERGENCIA_REAL', { ...ev, ...(js.state ? { jsonState: js.state } : {}), ...issue, classificationReason: st.reason, ...extra });
    }
  };
  for (const h of hitsAll) {
    const mark = rows.length; tierRows(h, mark);
    // regra consultada registrada em TODA linha de faixa (inclusive comparação normal e ausência real)
    for (const r of rows.slice(mark)) if (!r.tierRule && rules) r.tierRule = tierStatus(h);
  }
  function tierRows(h) {
    const xt = x.prizeTiers.find(t => t.hits === h); const ents = byHits.get(h) || []; const jt = ents.length === 1 ? ents[0] : null;
    const xw = xt ? xState(xt.winners, 'value') : NA; const xp = xt ? xState(xt.prize, 'cents') : NA;
    const st = ents.length ? tierStatus(h) : null;
    if (ents.length > 1) { dupField(h, 'winners', xt, xw, ents, st); dupField(h, 'prize', xt, xp, ents, st); return; }
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
      return;
    }
    if (st && st.status !== TIER_STATUS.PREVISTA) { specialTier(h, xt, xw, xp, jt, st); return; }
    const jw = jwOf(jt); const jp = jpOf(jt);
    if (!xt) {
      structural(`tier[${h}].winners`, { ...NA }, jw, () => false, { xAbsentNote: xMissing ? 'registro inexistente no XLSX' : 'faixa só no JSON' });
      money(`tier[${h}].prize`, NA, jp, { xMissingLabel: xMissing ? xLabel : '<faixa inexistente no XLSX>', xAbsentNote: xMissing ? 'registro inexistente no XLSX' : 'faixa só no JSON' });
    } else {
      structural(`tier[${h}].winners`, xw, jw, (a, b) => a === b, { xAbsentWithJ: C.SEMANTICA, xAbsentNote: 'XLSX ausente ("-"/vazio) e faixa listada no JSON' });
      money(`tier[${h}].prize`, xp, jp, { xAbsentWithJ: C.SEMANTICA, xAbsentNote: 'prêmio XLSX ausente ("-"/vazio) e JSON lista a faixa com valor; sem comparação' });
    }
  }
  for (const k of ['totalCollected', 'nextPrizeEstimate', 'specialAccumulated', 'accumulatedTopTier']) {
    const xm = x.economic[k]; const jm = j.economicMoney ? j.economicMoney[k] : { present: j.economic[k] !== null, literal: j.economic[k], cents: j.economic[k], valid: true };
    if (!xm && !jm.present) continue;
    const hyp = FIELD_CORRESPONDENCE.find(f => f.lotus === `economic.${k}`).status === 'HIPOTESE';
    const jms = j.economicMoneyState ? j.economicMoneyState[k] : null;
    money(`economic.${k}`, xMissing ? NA : xState(xm, 'cents'), jState({ ...jm, valid: jm.present ? jm.valid : null, ...(jms ? { state: jms.state } : {}) }, 'cents'), { hyp, xMissingLabel: xMissing ? xLabel : '<coluna inexistente>' });
  }
  // winnerLocations: correspondência HIPOTESE → nunca EQUIVALENTE/REPRESENTACAO confirmadas; tipo JSON incorreto ≠ ausência.
  const wf = j.winnerLocationsField; const hypW = { correspondence: 'HIPOTESE' };
  const xl = x.winnerLocations.text; const xEmpty = !xl || !xl.trim(); const jCount = j.winnerLocationsCount;
  if (wf && isInv(jState(wf, 'count'))) add('winnerLocations', C.DADO_INVALIDO, xEmpty ? null : '<texto>', wf.literal, 'listaMunicipioUFGanhadores presente com tipo incorreto (esperado lista); nunca tratado como ausência', { invalidSource: 'JSON', xlsxPresent: !xEmpty, jsonPresent: true, jsonValid: false, jsonType: wf.type, jsonLiteral: wf.literal, jsonInvalidReason: wf.invalidReason, invalidReason: wf.invalidReason, ...hypW });
  else if (xEmpty && !jCount) add('winnerLocations', C.AUSENTE, null, wf && !wf.present ? null : 0, 'sem localização de ganhadores nas duas fontes', { xlsxPresent: false, jsonPresent: !!(wf ? wf.present : jCount !== null), ...(wf ? { jsonState: wf.state } : {}), ...hypW });
  else if (x.__missing) add('winnerLocations', C.AUSENTE, xLabel, jCount, 'registro inexistente no XLSX (ausência do registro inteiro, não do campo)', { xlsxPresent: false, jsonPresent: true, ...hypW });
  // uma fonte com conteúdo e a outra vazia: correspondência HIPOTESE não confirmada → semântica desconhecida (nunca ausência)
  else if (xEmpty !== !jCount) add('winnerLocations', C.SEMANTICA, xEmpty ? null : '<texto>', jCount, `conteúdo só no ${xEmpty ? 'JSON' : 'XLSX'}; correspondência HIPOTESE: o vazio da outra fonte não prova ausência da mesma informação`, { xlsxPresent: !xEmpty, jsonPresent: !!jCount, ...hypW });
  else add('winnerLocations', C.SEMANTICA, '<texto>', jCount, 'texto livre × lista estruturada; correspondência HIPOTESE: não se afirma que representem a mesma informação', hypW);
  // observação: tipo incorreto → DADO_INVALIDO; ausente/nulo no JSON ≠ texto vazio
  const of = j.observationField; const xo = x.observation.text ?? '';
  if (of && isInv(jState(of, 'value'))) add('observation', C.DADO_INVALIDO, xo ? '<texto>' : '', of.literal, 'observacao JSON com tipo incorreto (esperado texto)', { invalidSource: 'JSON', jsonPresent: true, jsonValid: false, jsonType: of.type, jsonLiteral: of.literal, jsonInvalidReason: of.invalidReason, invalidReason: of.invalidReason });
  else if (of && !of.present) add('observation', C.AUSENTE, xo ? '<texto>' : null, null, `observacao ${of.state === 'NULO' ? 'nula' : 'ausente'} no JSON`, { xlsxPresent: !!xo, jsonPresent: false, jsonState: of.state });
  else {
    const jo = j.observation ?? '';
    if (xo === jo) add('observation', C.EQUIVALENTE, xo ? '<texto>' : '', jo ? '<texto>' : '');
    else if (xo.replace(/\s+/g, ' ').trim() === jo.replace(/\s+/g, ' ').trim()) add('observation', C.FORMATACAO, '<texto>', '<texto>', 'difere apenas em espaços');
    else add('observation', C.SEMANTICA, xo ? '<texto>' : '', jo ? '<texto>' : '', 'textos diferentes; não comparável automaticamente');
  }
  // tipoJogo: sem mapeamento documentado → nenhuma classificação de incompatibilidade; só o tipo incorreto é sinalizado.
  const tf = j.tipoJogoField;
  if (tf && isInv(jState(tf, 'value'))) add('tipoJogo', C.DADO_INVALIDO, null, tf.literal, 'tipoJogo presente com tipo incorreto (esperado texto); sem mapeamento documentado, nenhuma compatibilidade é avaliada', { invalidSource: 'JSON', jsonPresent: true, jsonValid: false, jsonType: tf.type, jsonLiteral: tf.literal, jsonInvalidReason: tf.invalidReason, invalidReason: tf.invalidReason });
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
