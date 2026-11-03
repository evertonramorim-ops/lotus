/**
 * Envelope de dado BRUTO (`lotus.raw` v1.0.0). Preserva os bytes originais exatamente
 * (base64) e o SHA-256 desses bytes; a normalização nunca altera o envelope.
 * { schema, schemaVersion, mediaType, byteLength, sha256, contentBase64, provenance, envelopeSha256 }
 * - `sha256`: SHA-256 dos BYTES originais.
 * - `envelopeSha256`: SHA-256(UTF-8(JCS(envelope sem o próprio campo envelopeSha256))) — protege TODOS os
 *   metadados (schema, versão, mediaType, byteLength, sha256, conteúdo e proveniência).
 * LIMITE: esses hashes locais detectam alteração em relação ao envelope originalmente registrado, mas
 * NÃO autenticam a identidade da fonte nem impedem que quem altera o envelope recalcule os hashes.
 * Autenticidade de origem exigiria assinatura ou outro mecanismo confiável (fora do escopo da Fase 3a).
 * @module data/raw
 */
import { RAW_SCHEMA, RAW_SCHEMA_VERSION } from './schema.js';
import { sha256Hex, toBytes, hashJson, isSha256Hex } from '../integrity/hash.js';
import { validateProvenance, isPlainObject } from '../validation/common.js';

export const RAW_ENVELOPE_FIELDS = Object.freeze(['schema', 'schemaVersion', 'mediaType', 'byteLength', 'sha256', 'contentBase64', 'provenance', 'envelopeSha256']);

function b64encode(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function b64decode(str) { const s = atob(str); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

/**
 * Cria envelope bruto. Aceita string (codificada UTF-8) ou bytes.
 * @param {string|Uint8Array} content
 * @param {{mediaType?:string, provenance:object}} meta
 */
export function createRawEnvelope(content, meta) {
  const errs = []; validateProvenance(meta && meta.provenance, '$.provenance', errs);
  if (errs.length) throw new TypeError('proveniência inválida: ' + errs.map(e => e.code + '@' + e.path).join(', '));
  const bytes = toBytes(content);
  const mediaType = meta.mediaType ?? 'application/json';
  if (typeof mediaType !== 'string' || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType)) throw new TypeError('mediaType inválido');
  const body = {
    schema: RAW_SCHEMA, schemaVersion: RAW_SCHEMA_VERSION, mediaType,
    byteLength: bytes.length, sha256: sha256Hex(bytes), contentBase64: b64encode(bytes),
    provenance: { ...meta.provenance },
  };
  const env = { ...body, envelopeSha256: hashJson(body) };
  Object.freeze(env.provenance);
  return Object.freeze(env);
}

/** Recupera os bytes originais. @returns {Uint8Array} */
export function rawBytes(env) { return b64decode(env.contentBase64); }

/** Texto original (UTF-8, fatal em bytes inválidos). */
export function rawText(env) { return new TextDecoder('utf-8', { fatal: true }).decode(rawBytes(env)); }

/** Hash esperado do envelope (exclui somente o campo envelopeSha256). */
export function computeEnvelopeSha256(env) { const { envelopeSha256, ...body } = env; void envelopeSha256; return hashJson(body); }

/**
 * Verificação completa do envelope: estrutura, proveniência, bytes/byteLength/sha256 e envelopeSha256.
 * Nunca lança. @returns {{ok:boolean, errors:{code:string, path:string, message:string}[]}}
 */
export function verifyRawEnvelopeDetailed(env) {
  const errors = []; const e = (code, path, message) => errors.push({ code, path, message });
  if (!isPlainObject(env)) { e('RAW_NOT_OBJECT', '$', 'envelope deve ser objeto'); return { ok: false, errors }; }
  for (const k of Object.keys(env)) if (!RAW_ENVELOPE_FIELDS.includes(k)) e('UNKNOWN_FIELD', `$.${k}`, `campo não previsto: ${k}`);
  for (const k of RAW_ENVELOPE_FIELDS) if (!Object.prototype.hasOwnProperty.call(env, k)) e('MISSING_FIELD', `$.${k}`, `campo obrigatório ausente: ${k}`);
  if (env.schema !== RAW_SCHEMA) e('RAW_SCHEMA', '$.schema', `esperado ${RAW_SCHEMA}`);
  if (env.schemaVersion !== RAW_SCHEMA_VERSION) e('RAW_SCHEMA_VERSION', '$.schemaVersion', `versão suportada: ${RAW_SCHEMA_VERSION}`);
  if (typeof env.mediaType !== 'string' || !env.mediaType) e('RAW_MEDIA_TYPE', '$.mediaType', 'mediaType inválido');
  if (!Number.isSafeInteger(env.byteLength) || env.byteLength < 0) e('RAW_BYTE_LENGTH', '$.byteLength', 'byteLength inválido');
  if (!isSha256Hex(env.sha256)) e('RAW_SHA256_FORMAT', '$.sha256', 'sha256 deve ter 64 hex minúsculos');
  if (!isSha256Hex(env.envelopeSha256)) e('RAW_ENVELOPE_SHA256_FORMAT', '$.envelopeSha256', 'envelopeSha256 deve ter 64 hex minúsculos');
  validateProvenance(env.provenance, '$.provenance', errors);
  let bytes = null;
  try { if (typeof env.contentBase64 !== 'string') throw new TypeError('não é string'); bytes = rawBytes(env); if (b64encode(bytes) !== env.contentBase64) throw new TypeError('base64 não canônico'); }
  catch (err) { e('RAW_CONTENT_INVALID', '$.contentBase64', `contentBase64 inválido: ${err && err.message}`); bytes = null; }
  if (bytes) {
    if (bytes.length !== env.byteLength) e('RAW_BYTE_LENGTH_MISMATCH', '$.byteLength', 'byteLength não confere com os bytes');
    if (sha256Hex(bytes) !== env.sha256) e('RAW_SHA256_MISMATCH', '$.sha256', 'SHA-256 dos bytes não confere');
  }
  try { if (computeEnvelopeSha256(env) !== env.envelopeSha256) e('RAW_ENVELOPE_HASH_MISMATCH', '$.envelopeSha256', 'envelope alterado em relação ao registrado'); }
  catch (err) { e('RAW_NOT_CANONICALIZABLE', '$', String(err && err.message)); }
  return { ok: errors.length === 0, errors };
}

/** Verificação completa do envelope (booleano). Ver {@link verifyRawEnvelopeDetailed}. */
export function verifyRawEnvelope(env) { return verifyRawEnvelopeDetailed(env).ok; }
