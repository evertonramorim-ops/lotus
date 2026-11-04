/**
 * Utilitários de validação: erros estruturados {code, path, message}. Nunca lança para dados
 * inválidos — sempre devolve a lista completa de problemas (para quarentena com justificativa).
 * Política de campos desconhecidos: REJEITAR (código UNKNOWN_FIELD).
 * @module validation/common
 */
import { SOURCE_TYPES, PROVENANCE_FIELDS } from '../data/schema.js';

/** @typedef {{code:string, path:string, message:string}} ValidationIssue */

export function issue(code, path, message) { return { code, path, message }; }

export function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null;
}

/** Data de calendário ISO AAAA-MM-DD real (gregoriano). */
export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= dim;
}

/** Timestamp ISO-8601 UTC real. */
export function isIsoUtcTimestamp(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(s)) return false;
  if (!isIsoDate(s.slice(0, 10))) return false;
  const [h, mi, se] = s.slice(11, 19).split(':').map(Number);
  return h <= 23 && mi <= 59 && se <= 59;
}

export function checkUnknownFields(obj, allowed, path, out) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) out.push(issue('UNKNOWN_FIELD', `${path}.${k}`, `campo não previsto no esquema: ${k}`));
}

export function checkRequired(obj, required, path, out) {
  let ok = true;
  for (const k of required) if (!Object.prototype.hasOwnProperty.call(obj, k)) { out.push(issue('MISSING_FIELD', `${path}.${k}`, `campo obrigatório ausente: ${k}`)); ok = false; }
  return ok;
}

/** Valida contest: inteiro positivo seguro. */
export function checkContest(v, path, out) {
  if (typeof v !== 'number') out.push(issue('WRONG_TYPE', path, 'contest deve ser number inteiro'));
  else if (!Number.isSafeInteger(v) || v < 1) out.push(issue('CONTEST_INVALID', path, 'contest deve ser inteiro positivo'));
}

/** Valida objeto de proveniência. */
export function validateProvenance(p, path, out) {
  if (!isPlainObject(p)) { out.push(issue('WRONG_TYPE', path, 'provenance deve ser objeto')); return; }
  checkUnknownFields(p, PROVENANCE_FIELDS, path, out);
  checkRequired(p, ['sourceType', 'sourceId', 'obtainedAt'], path, out);
  if ('sourceType' in p && !SOURCE_TYPES.includes(p.sourceType)) out.push(issue('PROVENANCE_SOURCE_TYPE', `${path}.sourceType`, `sourceType deve ser um de ${SOURCE_TYPES.join(', ')}`));
  if ('sourceId' in p && (typeof p.sourceId !== 'string' || !p.sourceId)) out.push(issue('WRONG_TYPE', `${path}.sourceId`, 'sourceId deve ser string não vazia'));
  if ('obtainedAt' in p && !isIsoUtcTimestamp(p.obtainedAt)) out.push(issue('PROVENANCE_DATE', `${path}.obtainedAt`, 'obtainedAt deve ser ISO-8601 UTC válido'));
  if ('note' in p && typeof p.note !== 'string') out.push(issue('WRONG_TYPE', `${path}.note`, 'note deve ser string'));
}
