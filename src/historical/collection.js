/**
 * Camada A — registro de COLETA (`lotus.collection` v1.0.0) que acompanha o envelope bruto da Fase 3a.
 * O envelope `lotus.raw` (inalterado) guarda bytes + sha256 + proveniência; este registro guarda os
 * metadados HTTP exigidos (URL, host, método, status, Content-Type, tamanho, sha256, modalidade,
 * nome original, execução de coleta, horário) e é ligado ao envelope por sha256 e envelopeSha256.
 * collectionSha256 = SHA-256(JCS(registro sem collectionSha256)). Hash ≠ autenticidade da fonte.
 * @module historical/collection
 */
import { hashJson, isSha256Hex } from '../integrity/hash.js';
import { isIsoUtcTimestamp, isPlainObject } from '../validation/common.js';
import { LOTTERY_IDS } from '../data/schema.js';

export const COLLECTION_SCHEMA = 'lotus.collection';
export const COLLECTION_SCHEMA_VERSION = '1.0.0';
/** mediaType canônico OOXML usado no envelope (o Content-Type observado — ex. "application/xlsx" — fica aqui). */
export const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const COLLECTION_FIELDS = Object.freeze(['schema', 'schemaVersion', 'collectionRunId', 'lottery', 'url', 'host', 'method', 'httpStatus', 'contentType', 'contentDisposition', 'originalFileName', 'byteLength', 'sha256', 'envelopeSha256', 'collectedAt', 'sourceType', 'note', 'collectionSha256']);

export function computeCollectionSha256(c) { const { collectionSha256, ...b } = c; void collectionSha256; return hashJson(b); }

export function createCollectionRecord(p) {
  const host = (() => { try { return new URL(p.url).host; } catch { throw new TypeError('url inválida'); } })();
  const body = {
    schema: COLLECTION_SCHEMA, schemaVersion: COLLECTION_SCHEMA_VERSION, collectionRunId: p.collectionRunId, lottery: p.lottery,
    url: p.url, host, method: p.method ?? 'GET', httpStatus: p.httpStatus, contentType: p.contentType ?? null, contentDisposition: p.contentDisposition ?? null,
    originalFileName: p.originalFileName ?? null, byteLength: p.byteLength, sha256: p.sha256, envelopeSha256: p.envelopeSha256,
    collectedAt: p.collectedAt, sourceType: p.sourceType, note: p.note ?? '',
  };
  const rec = { ...body, collectionSha256: hashJson(body) };
  const v = validateCollectionRecord(rec);
  if (!v.valid) throw new TypeError('registro de coleta inválido: ' + v.errors.join(', '));
  return Object.freeze(rec);
}

export function validateCollectionRecord(c) {
  const errors = [];
  if (!isPlainObject(c)) return { valid: false, errors: ['NOT_OBJECT'] };
  for (const k of Object.keys(c)) if (!COLLECTION_FIELDS.includes(k)) errors.push(`UNKNOWN_FIELD:${k}`);
  for (const k of COLLECTION_FIELDS) if (!(k in c)) errors.push(`MISSING_FIELD:${k}`);
  if (c.schema !== COLLECTION_SCHEMA || c.schemaVersion !== COLLECTION_SCHEMA_VERSION) errors.push('SCHEMA');
  if (typeof c.collectionRunId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(c.collectionRunId)) errors.push('RUN_ID');
  if (!LOTTERY_IDS.includes(c.lottery)) errors.push('LOTTERY');
  try { const u = new URL(c.url); if (u.host !== c.host) errors.push('HOST_MISMATCH'); if (!['https:', 'http:'].includes(u.protocol)) errors.push('URL_PROTOCOL'); } catch { errors.push('URL'); }
  if (c.method !== 'GET') errors.push('METHOD');
  if (!Number.isInteger(c.httpStatus) || c.httpStatus < 100 || c.httpStatus > 599) errors.push('HTTP_STATUS');
  if (!Number.isSafeInteger(c.byteLength) || c.byteLength < 0) errors.push('BYTE_LENGTH');
  if (!isSha256Hex(c.sha256) || !isSha256Hex(c.envelopeSha256)) errors.push('SHA256');
  if (!isIsoUtcTimestamp(c.collectedAt)) errors.push('COLLECTED_AT');
  if (!['SYNTHETIC_DATA', 'EXTERNAL_UNVERIFIED', 'MANUAL_ENTRY'].includes(c.sourceType)) errors.push('SOURCE_TYPE');
  if ('collectionSha256' in c && isSha256Hex(c.collectionSha256)) { if (computeCollectionSha256(c) !== c.collectionSha256) errors.push('COLLECTION_HASH_MISMATCH'); } else errors.push('COLLECTION_SHA256');
  return { valid: errors.length === 0, errors };
}

/**
 * Validação CRUZADA envelope `lotus.raw` × registro `lotus.collection`: prova que ambos descrevem a
 * MESMA coleta. Um collectionSha256 internamente válido não basta (o registro pode ter sido
 * adulterado e re-hasheado). @returns {{valid:boolean, errors:string[]}}
 */
export function validateCollectionEnvelopeLink(collection, envelope, lottery) {
  const errors = [];
  if (!isPlainObject(collection) || !isPlainObject(envelope)) return { valid: false, errors: ['NOT_OBJECT'] };
  const p = isPlainObject(envelope.provenance) ? envelope.provenance : {};
  const chk = (ok, code) => { if (!ok) errors.push(code); };
  chk(collection.sha256 === envelope.sha256, 'LINK_SHA256');
  chk(collection.envelopeSha256 === envelope.envelopeSha256, 'LINK_ENVELOPE_SHA256');
  chk(collection.byteLength === envelope.byteLength, 'LINK_BYTE_LENGTH');
  chk(collection.url === p.sourceId, 'LINK_URL');
  chk(collection.collectedAt === p.obtainedAt, 'LINK_COLLECTED_AT');
  chk(collection.sourceType === p.sourceType, 'LINK_SOURCE_TYPE');
  chk(collection.lottery === lottery, 'LINK_LOTTERY');
  return { valid: errors.length === 0, errors };
}
