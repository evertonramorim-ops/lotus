/**
 * Registros de CORREÇÃO (`lotus.correction` v1.0.0): nenhuma alteração sobrescreve dado sem trilha.
 * { schema, schemaVersion, lottery, contest, field, previousValue, newValue, source, date (ISO UTC fornecida),
 *   reason, actor, targetSha256 (hash do registro antes), resultSha256 (hash depois) }
 * @module data/correction
 */
import { CORRECTION_SCHEMA, CORRECTION_SCHEMA_VERSION } from './schema.js';
import { hashJson } from '../integrity/hash.js';
import { canonicalize } from '../integrity/jcs.js';
import { validateResultRecord } from '../validation/result.js';
import { isIsoUtcTimestamp } from '../validation/common.js';

export const CORRECTABLE_FIELDS = Object.freeze(['drawDate', 'numbers']);

/**
 * Aplica uma correção a um registro de resultado. Exige que previousValue confira com o valor atual
 * e que o registro resultante seja válido. Retorna { record, correction } sem mutar a entrada.
 */
export function applyCorrection(record, { field, newValue, source, date, reason, actor }) {
  if (!CORRECTABLE_FIELDS.includes(field)) throw new TypeError(`campo não corrigível: ${field}`);
  for (const [k, v] of Object.entries({ source, reason, actor })) if (typeof v !== 'string' || !v.trim()) throw new TypeError(`${k} obrigatório`);
  if (!isIsoUtcTimestamp(date)) throw new TypeError('date deve ser ISO-8601 UTC');
  const before = validateResultRecord(record);
  if (!before.valid) throw new TypeError('registro alvo inválido');
  const previousValue = structuredClone(record[field]);
  if (canonicalize(previousValue) === canonicalize(newValue)) throw new TypeError('correção sem alteração');
  const next = { ...structuredClone(record), [field]: structuredClone(newValue) };
  const after = validateResultRecord(next);
  if (!after.valid) throw new TypeError('correção produziria registro inválido: ' + after.errors.map(e => e.code).join(','));
  const correction = Object.freeze({
    schema: CORRECTION_SCHEMA, schemaVersion: CORRECTION_SCHEMA_VERSION,
    lottery: record.lottery, contest: record.contest, field, previousValue, newValue: structuredClone(newValue),
    source, date, reason, actor, targetSha256: hashJson(record), resultSha256: hashJson(next),
  });
  return { record: next, correction };
}

/** Reaplica uma cadeia de correções verificando os hashes encadeados. */
export function replayCorrections(record, corrections) {
  let cur = record;
  for (const c of corrections) {
    if (hashJson(cur) !== c.targetSha256) throw new Error('cadeia de correções quebrada (targetSha256)');
    if (canonicalize(cur[c.field]) !== canonicalize(c.previousValue)) throw new Error('previousValue não confere');
    cur = { ...cur, [c.field]: structuredClone(c.newValue) };
    if (hashJson(cur) !== c.resultSha256) throw new Error('resultSha256 não confere');
  }
  return cur;
}
