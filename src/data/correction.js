/**
 * Registros de CORREÇÃO (`lotus.correction` v1.0.0): nenhuma alteração sobrescreve dado sem trilha.
 * { schema, schemaVersion, lottery, contest, field, previousValue, newValue, source, date (ISO UTC fornecida),
 *   reason, actor, targetSha256 (hash do registro antes), resultSha256 (hash depois),
 *   correctionSha256 = SHA-256(UTF-8(JCS(correção sem o campo correctionSha256))) }
 * Encadeamento: targetSha256 da correção i+1 = resultSha256 da correção i.
 * LIMITE: sem assinatura digital, estes hashes detectam alteração acidental ou parcial, mas NÃO
 * autenticam a autoria (actor/source são declarações) nem impedem que um atacante recalcule
 * todos os hashes de uma cadeia forjada. Assinaturas ficam para depois da revisão da arquitetura.
 * @module data/correction
 */
import { CORRECTION_SCHEMA, CORRECTION_SCHEMA_VERSION, LOTTERY_IDS } from './schema.js';
import { hashJson, isSha256Hex } from '../integrity/hash.js';
import { canonicalize } from '../integrity/jcs.js';
import { validateResultRecord } from '../validation/result.js';
import { isIsoUtcTimestamp, isPlainObject } from '../validation/common.js';

export const CORRECTABLE_FIELDS = Object.freeze(['drawDate', 'numbers']);
export const CORRECTION_FIELDS = Object.freeze(['schema', 'schemaVersion', 'lottery', 'contest', 'field', 'previousValue', 'newValue', 'source', 'date', 'reason', 'actor', 'targetSha256', 'resultSha256', 'correctionSha256']);
const TEXT_MAX = 2000;
const isText = v => typeof v === 'string' && v.trim().length > 0 && v.length <= TEXT_MAX;

/** Hash próprio da correção (exclui somente correctionSha256). */
export function computeCorrectionSha256(c) { const { correctionSha256, ...body } = c; void correctionSha256; return hashJson(body); }

/**
 * Validação estrutural da correção (sem lançar). Não verifica encadeamento (ver replayCorrections).
 * @returns {{valid:boolean, errors:{code:string, path:string}[]}}
 */
export function validateCorrection(c) {
  const errors = []; const e = (code, path) => errors.push({ code, path });
  if (!isPlainObject(c)) return { valid: false, errors: [{ code: 'WRONG_TYPE', path: '$' }] };
  for (const k of Object.keys(c)) if (!CORRECTION_FIELDS.includes(k)) e('UNKNOWN_FIELD', `$.${k}`);
  for (const k of CORRECTION_FIELDS) if (!Object.prototype.hasOwnProperty.call(c, k)) e('MISSING_FIELD', `$.${k}`);
  if (c.schema !== CORRECTION_SCHEMA) e('SCHEMA_MISMATCH', '$.schema');
  if (c.schemaVersion !== CORRECTION_SCHEMA_VERSION) e('SCHEMA_VERSION_UNSUPPORTED', '$.schemaVersion');
  if (typeof c.lottery !== 'string' || !LOTTERY_IDS.includes(c.lottery)) e('UNKNOWN_LOTTERY', '$.lottery');
  if (!Number.isSafeInteger(c.contest) || c.contest < 1) e('CONTEST_INVALID', '$.contest');
  if (!CORRECTABLE_FIELDS.includes(c.field)) e('FIELD_NOT_CORRECTABLE', '$.field');
  for (const k of ['source', 'reason', 'actor']) if (!isText(c[k])) e('TEXT_INVALID', `$.${k}`);
  if (!isIsoUtcTimestamp(c.date)) e('DATE_INVALID', '$.date');
  for (const k of ['targetSha256', 'resultSha256', 'correctionSha256']) if (!isSha256Hex(c[k])) e('HASH_FORMAT', `$.${k}`);
  try { if (canonicalize(c.previousValue) === canonicalize(c.newValue)) e('NO_CHANGE', '$.newValue'); } catch { e('NOT_JSON', '$'); }
  if (!errors.some(x => x.code === 'NOT_JSON' || x.path === '$.correctionSha256')) {
    try { if (computeCorrectionSha256(c) !== c.correctionSha256) e('CORRECTION_HASH_MISMATCH', '$.correctionSha256'); } catch { e('NOT_JSON', '$'); }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Aplica uma correção a um registro de resultado. Exige que previousValue confira com o valor atual
 * e que o registro resultante seja válido. Retorna { record, correction } sem mutar a entrada.
 */
export function applyCorrection(record, { field, newValue, source, date, reason, actor }) {
  if (!CORRECTABLE_FIELDS.includes(field)) throw new TypeError(`campo não corrigível: ${field}`);
  for (const [k, v] of Object.entries({ source, reason, actor })) if (!isText(v)) throw new TypeError(`${k} obrigatório`);
  if (!isIsoUtcTimestamp(date)) throw new TypeError('date deve ser ISO-8601 UTC');
  const before = validateResultRecord(record);
  if (!before.valid) throw new TypeError('registro alvo inválido');
  const previousValue = structuredClone(record[field]);
  if (canonicalize(previousValue) === canonicalize(newValue)) throw new TypeError('correção sem alteração');
  const next = { ...structuredClone(record), [field]: structuredClone(newValue) };
  const after = validateResultRecord(next);
  if (!after.valid) throw new TypeError('correção produziria registro inválido: ' + after.errors.map(e => e.code).join(','));
  const body = {
    schema: CORRECTION_SCHEMA, schemaVersion: CORRECTION_SCHEMA_VERSION,
    lottery: record.lottery, contest: record.contest, field, previousValue, newValue: structuredClone(newValue),
    source, date, reason, actor, targetSha256: hashJson(record), resultSha256: hashJson(next),
  };
  const correction = Object.freeze({ ...body, correctionSha256: hashJson(body) });
  return { record: next, correction };
}

/**
 * Reaplica uma cadeia de correções verificando: estrutura e hash próprio de cada correção,
 * modalidade/concurso iguais aos do registro, previousValue, targetSha256 (encadeamento),
 * validade do registro resultante e resultSha256. Lança Error com motivo na primeira falha.
 */
export function replayCorrections(record, corrections) {
  let cur = record;
  corrections.forEach((c, i) => {
    const v = validateCorrection(c);
    if (!v.valid) throw new Error(`correção ${i} inválida: ${v.errors.map(x => x.code + '@' + x.path).join(', ')}`);
    if (c.lottery !== cur.lottery || c.contest !== cur.contest) throw new Error(`correção ${i}: modalidade/concurso não conferem`);
    if (hashJson(cur) !== c.targetSha256) throw new Error(`correção ${i}: cadeia de correções quebrada (targetSha256)`);
    if (canonicalize(cur[c.field]) !== canonicalize(c.previousValue)) throw new Error(`correção ${i}: previousValue não confere`);
    const next = { ...cur, [c.field]: structuredClone(c.newValue) };
    if (!validateResultRecord(next).valid) throw new Error(`correção ${i}: registro resultante inválido`);
    if (hashJson(next) !== c.resultSha256) throw new Error(`correção ${i}: resultSha256 não confere`);
    cur = next;
  });
  return cur;
}
