/**
 * Validadores independentes de RESULTADO por modalidade.
 * Regras (derivadas de src/lotteries/config.js da Fase 1, conferidas nos testes contra os valores literais):
 *  Mega-Sena 6 distintos em 1..60 · Lotofácil 15 distintos em 1..25 · Quina 5 distintos em 1..80 ·
 *  Lotomania 20 distintos em 0..99.
 * O registro canônico exige números inteiros (number) em ordem estritamente crescente.
 * @module validation/result
 */
import { RESULT_SCHEMA, RESULT_SCHEMA_VERSION, RESULT_FIELDS, LOTTERY_IDS, resultRules } from '../data/schema.js';
import { issue, isPlainObject, isIsoDate, checkUnknownFields, checkRequired, checkContest, validateProvenance } from './common.js';

/**
 * Valida apenas a lista de dezenas para uma modalidade.
 * @param {string} lottery @param {unknown} numbers @param {string} [path]
 * @returns {import('./common.js').ValidationIssue[]}
 */
export function validateNumbers(lottery, numbers, path = '$.numbers') {
  const out = [];
  const r = resultRules(lottery);
  if (!Array.isArray(numbers)) { out.push(issue('WRONG_TYPE', path, 'numbers deve ser array')); return out; }
  if (numbers.length !== r.draw) out.push(issue('COUNT_MISMATCH', path, `${r.name}: esperado ${r.draw} números, recebido ${numbers.length}`));
  const seen = new Set();
  numbers.forEach((n, i) => {
    const p = `${path}[${i}]`;
    if (typeof n !== 'number') { out.push(issue('WRONG_TYPE', p, 'número deve ser number inteiro')); return; }
    if (!Number.isInteger(n)) { out.push(issue('NOT_INTEGER', p, `valor não inteiro: ${n}`)); return; }
    if (n < r.minNumber || n > r.maxNumber) out.push(issue('OUT_OF_RANGE', p, `${n} fora de ${r.minNumber}..${r.maxNumber}`));
    if (seen.has(n)) out.push(issue('DUPLICATE_NUMBER', p, `número repetido: ${n}`));
    seen.add(n);
  });
  for (let i = 1; i < numbers.length; i++) {
    if (typeof numbers[i] === 'number' && typeof numbers[i - 1] === 'number' && numbers[i] <= numbers[i - 1]) { out.push(issue('NOT_SORTED', path, 'registro canônico exige ordem estritamente crescente')); break; }
  }
  return out;
}

/**
 * Valida registro canônico de resultado.
 * @param {unknown} rec
 * @param {{expectedLottery?:string}} [opts] se informado, a modalidade deve coincidir (validador por modalidade)
 * @returns {{valid:boolean, errors:import('./common.js').ValidationIssue[]}}
 */
export function validateResultRecord(rec, opts = {}) {
  const errors = [];
  if (!isPlainObject(rec)) return { valid: false, errors: [issue('WRONG_TYPE', '$', 'registro deve ser objeto')] };
  checkUnknownFields(rec, RESULT_FIELDS, '$', errors);
  checkRequired(rec, RESULT_FIELDS, '$', errors);
  if ('schema' in rec && rec.schema !== RESULT_SCHEMA) errors.push(issue('SCHEMA_MISMATCH', '$.schema', `esperado ${RESULT_SCHEMA}`));
  if ('schemaVersion' in rec && rec.schemaVersion !== RESULT_SCHEMA_VERSION) errors.push(issue('SCHEMA_VERSION_UNSUPPORTED', '$.schemaVersion', `versão suportada: ${RESULT_SCHEMA_VERSION}`));
  let lotteryOk = false;
  if ('lottery' in rec) {
    if (typeof rec.lottery !== 'string') errors.push(issue('WRONG_TYPE', '$.lottery', 'lottery deve ser string'));
    else if (!LOTTERY_IDS.includes(rec.lottery)) errors.push(issue('UNKNOWN_LOTTERY', '$.lottery', `modalidade desconhecida: ${rec.lottery}`));
    else lotteryOk = true;
    if (opts.expectedLottery && rec.lottery !== opts.expectedLottery) errors.push(issue('LOTTERY_MISMATCH', '$.lottery', `esperado ${opts.expectedLottery}`));
  }
  if ('contest' in rec) checkContest(rec.contest, '$.contest', errors);
  if ('drawDate' in rec && !isIsoDate(rec.drawDate)) errors.push(issue('DATE_INVALID', '$.drawDate', 'drawDate deve ser data ISO AAAA-MM-DD válida'));
  if ('numbers' in rec && lotteryOk) errors.push(...validateNumbers(rec.lottery, rec.numbers));
  if ('provenance' in rec) validateProvenance(rec.provenance, '$.provenance', errors);
  return { valid: errors.length === 0, errors };
}

/** Validadores independentes por modalidade (fixam a modalidade esperada). */
export const validateMegasena = rec => validateResultRecord(rec, { expectedLottery: 'megasena' });
export const validateLotofacil = rec => validateResultRecord(rec, { expectedLottery: 'lotofacil' });
export const validateQuina = rec => validateResultRecord(rec, { expectedLottery: 'quina' });
export const validateLotomania = rec => validateResultRecord(rec, { expectedLottery: 'lotomania' });
export const RESULT_VALIDATORS = Object.freeze({ megasena: validateMegasena, lotofacil: validateLotofacil, quina: validateQuina, lotomania: validateLotomania });
