/**
 * Envelope de dado BRUTO (`lotus.raw` v1.0.0). Preserva os bytes originais exatamente
 * (base64) e o SHA-256 desses bytes; a normalização nunca altera o envelope.
 * { schema, schemaVersion, mediaType, byteLength, sha256, contentBase64, provenance }
 * @module data/raw
 */
import { RAW_SCHEMA, RAW_SCHEMA_VERSION } from './schema.js';
import { sha256Hex, toBytes } from '../integrity/hash.js';
import { validateProvenance } from '../validation/common.js';

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
  return Object.freeze({
    schema: RAW_SCHEMA, schemaVersion: RAW_SCHEMA_VERSION,
    mediaType: meta.mediaType ?? 'application/json',
    byteLength: bytes.length, sha256: sha256Hex(bytes), contentBase64: b64encode(bytes),
    provenance: Object.freeze({ ...meta.provenance }),
  });
}

/** Recupera os bytes originais. @returns {Uint8Array} */
export function rawBytes(env) { return b64decode(env.contentBase64); }

/** Texto original (UTF-8, fatal em bytes inválidos). */
export function rawText(env) { return new TextDecoder('utf-8', { fatal: true }).decode(rawBytes(env)); }

/** Verifica que bytes e hash do envelope coincidem (detecção de adulteração do bruto). */
export function verifyRawEnvelope(env) {
  try {
    const b = rawBytes(env);
    return b.length === env.byteLength && sha256Hex(b) === env.sha256;
  } catch { return false; }
}
