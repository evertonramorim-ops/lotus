/**
 * Validador do MODELO ECONÔMICO INTERNO (NÃO confirmado contra nenhum contrato oficial).
 * Valida apenas estrutura/tipos/coerência interna; faixas (hits) devem pertencer a prizeTiers da
 * config da Fase 1. Valores em centavos como string de dígitos. Mapeamento de fonte real: Fase 3b.
 * @module validation/economic
 */
import { ECONOMIC_SCHEMA, ECONOMIC_SCHEMA_VERSION, ECONOMIC_MODEL_STATUS, ECONOMIC_FIELDS, TIER_FIELDS, LOTTERY_IDS, resultRules } from '../data/schema.js';
import { issue, isPlainObject, checkUnknownFields, checkRequired, checkContest, validateProvenance } from './common.js';

const CENTS = /^(0|[1-9][0-9]*)$/;

/** @returns {{valid:boolean, errors:import('./common.js').ValidationIssue[]}} */
export function validateEconomicRecord(rec) {
  const errors = [];
  if (!isPlainObject(rec)) return { valid: false, errors: [issue('WRONG_TYPE', '$', 'registro deve ser objeto')] };
  checkUnknownFields(rec, ECONOMIC_FIELDS, '$', errors);
  checkRequired(rec, ECONOMIC_FIELDS, '$', errors);
  if ('schema' in rec && rec.schema !== ECONOMIC_SCHEMA) errors.push(issue('SCHEMA_MISMATCH', '$.schema', `esperado ${ECONOMIC_SCHEMA}`));
  if ('schemaVersion' in rec && rec.schemaVersion !== ECONOMIC_SCHEMA_VERSION) errors.push(issue('SCHEMA_VERSION_UNSUPPORTED', '$.schemaVersion', `versão suportada: ${ECONOMIC_SCHEMA_VERSION}`));
  if ('modelStatus' in rec && rec.modelStatus !== ECONOMIC_MODEL_STATUS) errors.push(issue('MODEL_STATUS', '$.modelStatus', `modelo econômico deve declarar ${ECONOMIC_MODEL_STATUS}`));
  let rules = null;
  if ('lottery' in rec) {
    if (typeof rec.lottery !== 'string' || !LOTTERY_IDS.includes(rec.lottery)) errors.push(issue('UNKNOWN_LOTTERY', '$.lottery', 'modalidade desconhecida'));
    else rules = resultRules(rec.lottery);
  }
  if ('contest' in rec) checkContest(rec.contest, '$.contest', errors);
  if ('tiers' in rec) {
    if (!Array.isArray(rec.tiers)) errors.push(issue('WRONG_TYPE', '$.tiers', 'tiers deve ser array'));
    else {
      const seen = new Set();
      rec.tiers.forEach((t, i) => {
        const p = `$.tiers[${i}]`;
        if (!isPlainObject(t)) { errors.push(issue('WRONG_TYPE', p, 'faixa deve ser objeto')); return; }
        checkUnknownFields(t, TIER_FIELDS, p, errors);
        checkRequired(t, TIER_FIELDS, p, errors);
        if ('hits' in t) {
          if (!Number.isInteger(t.hits)) errors.push(issue('WRONG_TYPE', `${p}.hits`, 'hits deve ser inteiro'));
          else {
            if (rules && !rules.prizeTiers.includes(t.hits)) errors.push(issue('TIER_NOT_IN_RULES', `${p}.hits`, `faixa ${t.hits} não premia em ${rules.name}`));
            if (seen.has(t.hits)) errors.push(issue('DUPLICATE_TIER', `${p}.hits`, `faixa repetida: ${t.hits}`));
            seen.add(t.hits);
          }
        }
        if ('winners' in t && !(Number.isSafeInteger(t.winners) && t.winners >= 0)) errors.push(issue('WRONG_TYPE', `${p}.winners`, 'winners deve ser inteiro ≥ 0'));
        if ('prizePerWinnerCents' in t && !(typeof t.prizePerWinnerCents === 'string' && CENTS.test(t.prizePerWinnerCents))) errors.push(issue('MONEY_FORMAT', `${p}.prizePerWinnerCents`, 'centavos como string de dígitos'));
      });
    }
  }
  if ('totalCollectedCents' in rec && rec.totalCollectedCents !== null && !(typeof rec.totalCollectedCents === 'string' && CENTS.test(rec.totalCollectedCents))) errors.push(issue('MONEY_FORMAT', '$.totalCollectedCents', 'null (sem fonte confiável) ou centavos como string de dígitos'));
  if ('provenance' in rec) validateProvenance(rec.provenance, '$.provenance', errors);
  return { valid: errors.length === 0, errors };
}
