/**
 * Manifesto de integridade offline (SEM assinatura digital nesta fase).
 *
 * Formato `lotus.manifest` v1.0.0:
 * {
 *   schema: "lotus.manifest", schemaVersion: "1.0.0",
 *   datasetId: string, dataSchemaVersion: string,
 *   sequence: inteiro ≥ 1 (estritamente crescente por datasetId),
 *   createdAt: string ISO-8601 UTC FORNECIDA PELO CHAMADOR (nenhum relógio oculto → determinismo),
 *   hashAlgorithm: "sha-256", canonicalization: "rfc8785-jcs",
 *   entries: [{ id, kind: "record"|"file", sha256 }] ordenadas por id (UTF-16),
 *   rootHash: SHA-256(JCS(manifesto sem o campo rootHash))
 * }
 * O rootHash cobre todos os campos (inclusive sequence e entries); qualquer alteração é detectada.
 * @module integrity/manifest
 */
import { hashJson, sha256Hex, isSha256Hex } from './hash.js';
import { compareUtf16 } from './jcs.js';

export const MANIFEST_SCHEMA = 'lotus.manifest';
export const MANIFEST_SCHEMA_VERSION = '1.0.0';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ALLOWED_KEYS = ['schema', 'schemaVersion', 'datasetId', 'dataSchemaVersion', 'sequence', 'createdAt', 'hashAlgorithm', 'canonicalization', 'entries', 'rootHash'];

/** Hash de registro JSON (JCS + SHA-256). */
export const hashRecord = hashJson;
/** Hash de arquivo/bytes brutos. */
export const hashFile = sha256Hex;

/** Valida timestamp ISO UTC real (rejeita 2026-02-30 etc.). */
export function isIsoUtc(s) {
  if (typeof s !== 'string' || !ISO_UTC.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 19) === s.slice(0, 19);
}

/**
 * Constrói manifesto.
 * @param {{datasetId:string, dataSchemaVersion:string, sequence:number, createdAt:string,
 *          entries:{id:string, kind?:'record'|'file', sha256:string}[]}} p
 */
export function buildManifest(p) {
  if (typeof p.datasetId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(p.datasetId)) throw new TypeError('datasetId inválido');
  if (typeof p.dataSchemaVersion !== 'string' || !p.dataSchemaVersion) throw new TypeError('dataSchemaVersion inválido');
  if (!Number.isSafeInteger(p.sequence) || p.sequence < 1) throw new TypeError('sequence deve ser inteiro ≥ 1');
  if (!isIsoUtc(p.createdAt)) throw new TypeError('createdAt deve ser ISO-8601 UTC (ex.: 2026-01-01T00:00:00Z)');
  if (!Array.isArray(p.entries) || p.entries.length === 0) throw new TypeError('entries vazio');
  const ids = new Set();
  const entries = p.entries.map(e => {
    if (typeof e.id !== 'string' || !e.id) throw new TypeError('entry.id inválido');
    if (ids.has(e.id)) throw new TypeError(`entry.id duplicado: ${e.id}`);
    ids.add(e.id);
    if (!isSha256Hex(e.sha256)) throw new TypeError(`sha256 inválido em ${e.id}`);
    const kind = e.kind ?? 'record';
    if (kind !== 'record' && kind !== 'file') throw new TypeError(`kind inválido em ${e.id}`);
    return { id: e.id, kind, sha256: e.sha256 };
  }).sort((a, b) => compareUtf16(a.id, b.id));
  const body = {
    schema: MANIFEST_SCHEMA, schemaVersion: MANIFEST_SCHEMA_VERSION,
    datasetId: p.datasetId, dataSchemaVersion: p.dataSchemaVersion, sequence: p.sequence, createdAt: p.createdAt,
    hashAlgorithm: 'sha-256', canonicalization: 'rfc8785-jcs', entries,
  };
  return { ...body, rootHash: hashJson(body) };
}

/** Calcula o rootHash esperado de um manifesto (ignora o campo rootHash presente). */
export function computeRootHash(m) { const { rootHash, ...body } = m; void rootHash; return hashJson(body); }

/**
 * Verifica manifesto e, opcionalmente, o conteúdo.
 * @param {object} manifest
 * @param {Map<string,{kind:'record',value:unknown}|{kind:'file',bytes:Uint8Array|string}>} [contents]
 * @returns {{ok:boolean, errors:{code:string, id?:string, detail?:string}[]}}
 */
export function verifyManifest(manifest, contents) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return { ok: false, errors: [{ code: 'MANIFEST_NOT_OBJECT' }] };
  for (const k of Object.keys(manifest)) if (!ALLOWED_KEYS.includes(k)) errors.push({ code: 'MANIFEST_UNKNOWN_FIELD', detail: k });
  if (manifest.schema !== MANIFEST_SCHEMA) errors.push({ code: 'MANIFEST_SCHEMA' });
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) errors.push({ code: 'MANIFEST_SCHEMA_VERSION' });
  if (manifest.hashAlgorithm !== 'sha-256' || manifest.canonicalization !== 'rfc8785-jcs') errors.push({ code: 'MANIFEST_ALGORITHM' });
  if (!Number.isSafeInteger(manifest.sequence) || manifest.sequence < 1) errors.push({ code: 'MANIFEST_SEQUENCE_INVALID' });
  if (!isIsoUtc(manifest.createdAt)) errors.push({ code: 'MANIFEST_CREATED_AT_INVALID' });
  if (!Array.isArray(manifest.entries)) errors.push({ code: 'MANIFEST_ENTRIES_INVALID' });
  else {
    for (let i = 1; i < manifest.entries.length; i++) if (compareUtf16(manifest.entries[i - 1].id, manifest.entries[i].id) >= 0) { errors.push({ code: 'MANIFEST_ENTRIES_NOT_SORTED_OR_DUPLICATE' }); break; }
  }
  let rh = null;
  try { rh = computeRootHash(manifest); } catch (e) { errors.push({ code: 'MANIFEST_NOT_CANONICALIZABLE', detail: e.message }); }
  if (rh !== null && rh !== manifest.rootHash) errors.push({ code: 'ROOT_HASH_MISMATCH' });
  if (contents && Array.isArray(manifest.entries)) {
    const listed = new Set();
    for (const e of manifest.entries) {
      listed.add(e.id);
      const c = contents.get(e.id);
      if (!c) { errors.push({ code: 'ENTRY_MISSING', id: e.id }); continue; }
      if (c.kind !== e.kind) { errors.push({ code: 'ENTRY_KIND_MISMATCH', id: e.id }); continue; }
      let h;
      try { h = c.kind === 'file' ? hashFile(c.bytes) : hashRecord(c.value); } catch (err) { errors.push({ code: 'ENTRY_NOT_HASHABLE', id: e.id, detail: err.message }); continue; }
      if (h !== e.sha256) errors.push({ code: 'ENTRY_HASH_MISMATCH', id: e.id });
    }
    for (const id of contents.keys()) if (!listed.has(id)) errors.push({ code: 'ENTRY_UNLISTED', id });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Verifica a sucessão entre o último manifesto aceito e um candidato (anti-regressão / anti-substituição).
 * Regras: mesmo datasetId; sequence estritamente maior; sequence igual com rootHash diferente = substituição;
 * sequence igual com rootHash igual = reapresentação idempotente (REPLAY, não é avanço).
 * @returns {{ok:boolean, code:string}}
 */
export function checkSuccession(previous, candidate) {
  if (!previous) return { ok: true, code: 'FIRST' };
  if (previous.datasetId !== candidate.datasetId) return { ok: false, code: 'DATASET_MISMATCH' };
  if (candidate.sequence === previous.sequence) {
    return candidate.rootHash === previous.rootHash ? { ok: false, code: 'SEQUENCE_REPLAY_IDENTICAL' } : { ok: false, code: 'SEQUENCE_SUBSTITUTION' };
  }
  if (candidate.sequence < previous.sequence) return { ok: false, code: 'SEQUENCE_REGRESSION' };
  return { ok: true, code: 'ADVANCE' };
}

/**
 * Registro local (em memória) de manifestos aceitos por datasetId. Recusa manifestos inválidos,
 * regressões, substituições e sequências já vistas (inclusive anteriores com outro hash).
 */
export class ManifestLedger {
  constructor() { /** @type {Map<string, object[]>} */ this.history = new Map(); }
  /** @returns {{accepted:boolean, code:string, errors?:object[]}} */
  submit(manifest) {
    const v = verifyManifest(manifest);
    if (!v.ok) return { accepted: false, code: 'INVALID_MANIFEST', errors: v.errors };
    const h = this.history.get(manifest.datasetId) ?? [];
    const seen = h.find(m => m.sequence === manifest.sequence);
    if (seen && seen.rootHash !== manifest.rootHash) return { accepted: false, code: 'SEQUENCE_SUBSTITUTION' };
    const s = checkSuccession(h[h.length - 1], manifest);
    if (!s.ok) return { accepted: false, code: s.code };
    h.push(structuredClone(manifest)); this.history.set(manifest.datasetId, h);
    return { accepted: true, code: s.code };
  }
  latest(datasetId) { const h = this.history.get(datasetId); return h ? h[h.length - 1] : undefined; }
}
