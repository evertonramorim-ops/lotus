/**
 * Reconciliação XLSX × JSON (`lotus.reconciliation` v1.0.0). Nunca sobrescreve uma fonte com a outra:
 * apenas classifica diferenças e envia divergências reais à quarentena (DIVERGENCIA_JSON_XLSX).
 * Números JSON são lidos preservando o literal (jsonnum.js) e convertidos para centavos sem float.
 * @module historical/reconcile
 */
import { parseJsonPreservingNumbers, isNum } from './jsonnum.js';
import { decimalLiteralToCents, parseBrDate } from './values.js';
import { createQuarantineEntry } from '../data/quarantine.js';
import { hashJson } from '../integrity/hash.js';
import { Q, REVIEW_PENDING } from './codes.js';

export const RECONCILIATION_SCHEMA = 'lotus.reconciliation';
export const RECONCILIATION_VERSION = '1.0.0';
export const JSON_ADAPTER_ID = 'caixa-json-resultado';
export const JSON_ADAPTER_VERSION = '1.0.0';

export const CLASSES = Object.freeze({
  EQUIVALENTE: 'EQUIVALENTE', FORMATACAO: 'DIFERENCA_FORMATACAO', REPRESENTACAO: 'DIFERENCA_REPRESENTACAO', AUSENTE: 'AUSENTE_EM_UMA_FONTE',
  DIVERGENCIA: 'DIVERGENCIA_REAL', TEMPORAL: 'DIFERENCA_TEMPORAL', SEMANTICA: 'SEMANTICA_DESCONHECIDA', VALOR_INVALIDO: 'VALOR_INVALIDO',
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

/** Adaptador JSON: texto → registro comparável, preservando literais e campos extras. */
export function adaptJsonResult(text) {
  const j = parseJsonPreservingNumbers(text);
  const int = v => (isNum(v) && /^-?\d+$/.test(v.$number) ? Number(v.$number) : null);
  // Valor monetário JSON: literal original + conversão + valid + motivo. Presente-mas-inválido ≠ ausente.
  const money = v => { if (v === undefined || v === null) return { present: false, literal: null, cents: null, valid: true, invalidReason: null };
    if (!isNum(v)) return { present: true, literal: typeof v === 'string' ? v : JSON.stringify(v), cents: null, valid: false, invalidReason: 'TIPO_NAO_NUMERICO' };
    const r = decimalLiteralToCents(v.$number); return { present: true, literal: v.$number, cents: r.cents, valid: r.valid, invalidReason: r.valid ? null : r.invalidReason }; };
  const cents = v => money(v).cents;
  const tiers = Array.isArray(j.listaRateioPremio) ? j.listaRateioPremio.map(t => { const m = /^(\d+) acertos?$/.exec(String(t.descricaoFaixa ?? '').trim()); return { hits: m ? Number(m[1]) : null, description: t.descricaoFaixa ?? null, faixa: int(t.faixa), winners: int(t.numeroDeGanhadores), prizeCents: cents(t.valorPremio), prizeMoney: money(t.valorPremio), prizeLiteral: isNum(t.valorPremio) ? t.valorPremio.$number : null }; }) : [];
  const ints = a => (Array.isArray(a) ? a.map(x => (typeof x === 'string' && /^\d+$/.test(x) ? Number(x) : NaN)) : null);
  const known = new Set(['numero', 'dataApuracao', 'listaDezenas', 'dezenasSorteadasOrdemSorteio', 'listaRateioPremio', 'valorArrecadado', 'valorEstimadoProximoConcurso', 'valorAcumuladoConcursoEspecial', 'valorAcumuladoProximoConcurso', 'listaMunicipioUFGanhadores', 'observacao', 'tipoJogo']);
  return {
    adapter: { id: JSON_ADAPTER_ID, version: JSON_ADAPTER_VERSION }, tipoJogo: j.tipoJogo ?? null, contest: int(j.numero), drawDateRaw: j.dataApuracao ?? null, drawDate: typeof j.dataApuracao === 'string' ? (parseBrDate(j.dataApuracao) ?? lenientBrDate(j.dataApuracao)) : null,
    numbers: ints(j.listaDezenas) ? [...ints(j.listaDezenas)].sort((a, b) => a - b) : null, numbersRaw: j.listaDezenas ?? null, drawOrder: ints(j.dezenasSorteadasOrdemSorteio), tiers,
    economic: { totalCollected: cents(j.valorArrecadado), nextPrizeEstimate: cents(j.valorEstimadoProximoConcurso), specialAccumulated: cents(j.valorAcumuladoConcursoEspecial), accumulatedTopTier: cents(j.valorAcumuladoProximoConcurso) },
    economicMoney: { totalCollected: money(j.valorArrecadado), nextPrizeEstimate: money(j.valorEstimadoProximoConcurso), specialAccumulated: money(j.valorAcumuladoConcursoEspecial), accumulatedTopTier: money(j.valorAcumuladoProximoConcurso) },
    winnerLocationsCount: Array.isArray(j.listaMunicipioUFGanhadores) ? j.listaMunicipioUFGanhadores.length : null, observation: typeof j.observacao === 'string' ? j.observacao : null,
    jsonOnlyFields: Object.keys(j).filter(k => !known.has(k)).sort(),
  };
}

/** JSON: aceita d/m/aaaa com 1–2 dígitos (diferença de formatação), validando o calendário via parseBrDate. */
function lenientBrDate(t) { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t.trim()); return m ? parseBrDate(`${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`) : null; }
const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Compara um registro histórico (XLSX, aceito ou em quarentena) com o JSON do mesmo concurso.
 * @param {object|null} x registro lotus.historical-draw (null se o concurso não está no XLSX)
 * @param {object} j saída de adaptJsonResult
 * @param {{xlsxLastContest:number, xlsxObservedAt:string, jsonObservedAt:string}} ctx
 */
export function compareRecords(x, j, ctx) {
  const rows = []; const add = (field, cls, xv, jv, note, flags) => rows.push({ field, class: cls, xlsx: xv ?? null, json: jv ?? null, note: note ?? null, structural: STRUCT.has(field.replace(/^tier\[\d+\]\./, '').replace(/^economic\./, '')), ...(flags || {}) });
  const preReal = !!(x && x.drawDate && x.drawDate < '1994-07-01');
  if (!x) {
    if (j.contest > ctx.xlsxLastContest) add('contest', C.TEMPORAL, null, j.contest, `concurso posterior ao último do XLSX (${ctx.xlsxLastContest}); XLSX observado ${ctx.xlsxObservedAt}, JSON ${ctx.jsonObservedAt}`);
    else add('contest', C.AUSENTE, null, j.contest, 'concurso presente no JSON e ausente no XLSX');
    return rows;
  }
  add('contest', x.contest === j.contest ? C.EQUIVALENTE : C.DIVERGENCIA, x.contest, j.contest);
  if (x.drawDate && j.drawDate) add('drawDate', x.drawDate !== j.drawDate ? C.DIVERGENCIA : x.drawDateField.raw === j.drawDateRaw ? C.EQUIVALENTE : C.FORMATACAO, x.drawDateField.raw, j.drawDateRaw);
  else add('drawDate', C.AUSENTE, x.drawDateField.raw, j.drawDateRaw);
  if (x.numbers && j.numbers) add('numbers', eqArr(x.numbers, j.numbers) ? C.EQUIVALENTE : C.DIVERGENCIA, x.numbers.join(','), j.numbers.join(','));
  else add('numbers', C.AUSENTE, x.numbers && x.numbers.join(','), j.numbers && j.numbers.join(','));
  add('drawOrder', j.drawOrder && j.drawOrder.length ? C.AUSENTE : C.EQUIVALENTE, null, j.drawOrder ? j.drawOrder.join(',') : null, 'XLSX não informa ordem de extração');
  const hitsAll = [...new Set([...x.prizeTiers.map(t => t.hits), ...j.tiers.map(t => t.hits)])].sort((a, b) => b - a);
  const pr = preReal ? { unidadeMonetariaVerificada: false } : {};
  for (const h of hitsAll) {
    const xt = x.prizeTiers.find(t => t.hits === h); const jt = j.tiers.find(t => t.hits === h);
    if (xt && !jt) {
      // JSON não lista a faixa: semântica de faixa inteira (inalterada). Invalidade XLSX fica explícita na linha.
      const xInv = moneyInvalid(xt.prize);
      if (xt.winners.absent && xt.prize.absent) add(`tier[${h}]`, C.REPRESENTACAO, `${xt.winners.raw}|${xt.prize.raw}`, '<faixa não listada>', 'ambas as fontes indicam ausência da faixa');
      else add(`tier[${h}]`, C.SEMANTICA, `${xt.winners.raw}|${xt.prize.raw}`, '<faixa não listada>', 'XLSX traz valor (inclusive zero) e JSON não lista a faixa', xInv ? { xlsxPrizeInvalid: true, ...invalidEvidence(xt.prize, null) } : null);
      continue;
    }
    // Faixa no JSON: ganhadores e prêmio classificados de forma INDEPENDENTE (sem `continue` que descarte o outro campo).
    // — ganhadores
    if (!xt) add(`tier[${h}].winners`, C.AUSENTE, '<faixa inexistente no XLSX>', jt.winners, 'faixa só no JSON');
    else if (xt.winners.absent) add(`tier[${h}].winners`, C.SEMANTICA, xt.winners.raw, jt.winners, 'XLSX ausente ("-"/vazio) e faixa listada no JSON');
    else if (!xt.winners.valid) add(`tier[${h}].winners`, C.VALOR_INVALIDO, xt.winners.raw, jt.winners, `ganhadores XLSX presentes mas inválidos: ${xt.winners.invalidReason}`, { invalidSource: 'XLSX', xlsxLiteral: xt.winners.raw, xlsxRef: xt.winners.ref ?? null, xlsxColumn: xt.winners.column ?? null, invalidReason: xt.winners.invalidReason });
    else if (jt.winners === null) add(`tier[${h}].winners`, C.AUSENTE, xt.winners.raw, null, 'numeroDeGanhadores ausente/não inteiro no JSON');
    else add(`tier[${h}].winners`, xt.winners.value === jt.winners ? C.EQUIVALENTE : C.DIVERGENCIA, xt.winners.raw, jt.winners);
    // — prêmio
    addMoney(`tier[${h}].prize`, xt ? xt.prize : null, jt.prizeMoney, { xMissing: !xt ? '<faixa inexistente no XLSX>' : null, xAbsentClass: C.SEMANTICA, xAbsentNote: 'prêmio XLSX ausente ("-"/vazio) e JSON lista a faixa com valor; sem comparação', hyp: false });
  }
  for (const k of ['totalCollected', 'nextPrizeEstimate', 'specialAccumulated', 'accumulatedTopTier']) {
    const xm = x.economic[k]; const jm = j.economicMoney ? j.economicMoney[k] : { present: j.economic[k] !== null, literal: j.economic[k], cents: j.economic[k], valid: true, invalidReason: null };
    if (!xm && !jm.present) continue;
    const hyp = FIELD_CORRESPONDENCE.find(f => f.lotus === `economic.${k}`).status === 'HIPOTESE';
    addMoney(`economic.${k}`, xm || null, jm, { xMissing: !xm ? '<coluna inexistente>' : null, xAbsentClass: C.AUSENTE, xAbsentNote: null, hyp, jsonValue: 'cents' });
  }
  /** Decisão monetária por campo: inválido (XLSX/JSON/AMBOS) → ausência → pré-Real → comparação de dois valores válidos. */
  function addMoney(field, xm, jm, o) {
    const xInv = moneyInvalid(xm); const jInv = !!(jm && jm.present && !jm.valid);
    const xv = xm ? xm.raw : o.xMissing; const jv = o.jsonValue === 'cents' ? jm.cents ?? (jm.present ? jm.literal : null) : jm.literal;
    if (xInv || jInv) {
      const src = xInv && jInv ? 'AMBOS' : xInv ? 'XLSX' : 'JSON';
      return add(field, C.VALOR_INVALIDO, xv, jm.literal, `valor monetário presente mas não interpretável (origem ${src}); sem comparação, nunca DIVERGENCIA_REAL`, { ...invalidEvidence(xm, jm), ...pr });
    }
    if (!xm) return add(field, C.AUSENTE, xv, jv, null, jm.present ? { jsonLiteral: jm.literal, ...pr } : pr);
    if (xm.absent && !jm.present) return add(field, C.AUSENTE, xv, null, 'ausente nas duas fontes', { xlsxRef: xm.ref ?? null, ...pr });
    if (xm.absent) return add(field, o.xAbsentClass, xv, jv, o.xAbsentNote, { xlsxRef: xm.ref ?? null, jsonLiteral: jm.literal, ...pr });
    if (!jm.present) return add(field, C.AUSENTE, xv, null, 'valor ausente no JSON', { xlsxLiteral: xm.raw, ...pr });
    if (preReal) return add(field, C.SEMANTICA, xm.raw, jm.literal, PRE_REAL_NOTE, { unidadeMonetariaVerificada: false, xlsxLiteral: xm.raw, jsonLiteral: jm.literal });
    const eq = xm.cents === jm.cents;
    if (o.hyp) return add(field, eq ? C.EQUIVALENTE : C.SEMANTICA, xm.raw, jv, eq ? 'valores iguais; correspondência semântica é HIPÓTESE' : 'correspondência semântica não confirmada');
    add(field, eq ? C.EQUIVALENTE : C.DIVERGENCIA, xm.raw, jv, eq && field.endsWith('.prize') ? 'mesmo valor em centavos (texto R$ × literal decimal)' : null);
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

/** Célula XLSX presente (absent:false) mas inválida (valid:false). */
function moneyInvalid(m) { return !!(m && !m.absent && m.valid === false); }
/** Evidência completa das duas fontes para VALOR_INVALIDO; `invalidReason` resume a(s) origem(ns) inválida(s). */
function invalidEvidence(xm, jm) {
  const xInv = moneyInvalid(xm); const jInv = !!(jm && jm.present && !jm.valid);
  return { invalidSource: xInv && jInv ? 'AMBOS' : xInv ? 'XLSX' : 'JSON',
    xlsxLiteral: xm ? xm.raw ?? null : null, xlsxRef: xm ? xm.ref ?? null : null, xlsxColumn: xm ? xm.column ?? null : null, xlsxValid: xm ? !xInv : null, xlsxInvalidReason: xInv ? xm.invalidReason ?? null : null,
    jsonLiteral: jm ? jm.literal : null, jsonValid: jm ? !jInv : null, jsonInvalidReason: jInv ? jm.invalidReason : null,
    invalidReason: xInv && jInv ? `XLSX: ${xm.invalidReason}; JSON: ${jm.invalidReason}` : xInv ? xm.invalidReason : jm.invalidReason };
}

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
