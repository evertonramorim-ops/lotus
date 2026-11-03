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

const REQUIRED_KEYS = ALLOWED_KEYS;
const ENTRY_KEYS = ['id', 'kind', 'sha256'];
const DATASET_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function isPlainObj(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null;
}

/**
 * Validação ESTRUTURAL completa do manifesto (independente de hash). Nunca lança.
 * @returns {{code:string, path:string, detail?:string}[]}
 */
export function validateManifestStructure(m) {
  const errors = []; const e = (code, path, detail) => errors.push(detail === undefined ? { code, path } : { code, path, detail });
  if (!isPlainObj(m)) { e('MANIFEST_NOT_OBJECT', '$'); return errors; }
  for (const k of Object.keys(m)) if (!ALLOWED_KEYS.includes(k)) e('MANIFEST_UNKNOWN_FIELD', `$.${k}`, k);
  for (const k of REQUIRED_KEYS) if (!Object.prototype.hasOwnProperty.call(m, k)) e('MANIFEST_MISSING_FIELD', `$.${k}`, k);
  if ('schema' in m && m.schema !== MANIFEST_SCHEMA) e('MANIFEST_SCHEMA', '$.schema');
  if ('schemaVersion' in m && m.schemaVersion !== MANIFEST_SCHEMA_VERSION) e('MANIFEST_SCHEMA_VERSION', '$.schemaVersion');
  if (('hashAlgorithm' in m && m.hashAlgorithm !== 'sha-256') || ('canonicalization' in m && m.canonicalization !== 'rfc8785-jcs')) e('MANIFEST_ALGORITHM', '$');
  if ('datasetId' in m && !(typeof m.datasetId === 'string' && DATASET_ID.test(m.datasetId))) e('MANIFEST_DATASET_ID_INVALID', '$.datasetId');
  if ('dataSchemaVersion' in m && !(typeof m.dataSchemaVersion === 'string' && m.dataSchemaVersion.trim().length > 0 && m.dataSchemaVersion.length <= 128)) e('MANIFEST_DATA_SCHEMA_VERSION_INVALID', '$.dataSchemaVersion');
  if ('sequence' in m && !(Number.isSafeInteger(m.sequence) && m.sequence >= 1)) e('MANIFEST_SEQUENCE_INVALID', '$.sequence');
  if ('createdAt' in m && !isIsoUtc(m.createdAt)) e('MANIFEST_CREATED_AT_INVALID', '$.createdAt');
  if ('rootHash' in m && !isSha256Hex(m.rootHash)) e('MANIFEST_ROOT_HASH_FORMAT', '$.rootHash');
  if ('entries' in m) {
    if (!Array.isArray(m.entries)) e('MANIFEST_ENTRIES_INVALID', '$.entries', 'não é array');
    else if (m.entries.length === 0) e('MANIFEST_ENTRIES_INVALID', '$.entries', 'vazio');
    else {
      const ids = new Set(); let prev = null;
      m.entries.forEach((en, i) => {
        const p = `$.entries[${i}]`;
        if (!isPlainObj(en)) { e('ENTRY_NOT_OBJECT', p); prev = null; return; }
        for (const k of Object.keys(en)) if (!ENTRY_KEYS.includes(k)) e('ENTRY_UNKNOWN_FIELD', `${p}.${k}`, k);
        for (const k of ENTRY_KEYS) if (!Object.prototype.hasOwnProperty.call(en, k)) e('ENTRY_MISSING_FIELD', `${p}.${k}`, k);
        if ('kind' in en && en.kind !== 'record' && en.kind !== 'file') e('ENTRY_KIND_INVALID', `${p}.kind`);
        if ('sha256' in en && !isSha256Hex(en.sha256)) e('ENTRY_SHA256_INVALID', `${p}.sha256`);
        if ('id' in en) {
          if (typeof en.id !== 'string' || en.id.length === 0) { e('ENTRY_ID_INVALID', `${p}.id`); prev = null; return; }
          if (ids.has(en.id)) e('ENTRY_ID_DUPLICATE', `${p}.id`, en.id);
          else if (prev !== null && compareUtf16(prev, en.id) > 0) e('MANIFEST_ENTRIES_NOT_SORTED_OR_DUPLICATE', `${p}.id`);
          ids.add(en.id); prev = en.id;
        }
      });
      if (errors.some(x => x.code === 'ENTRY_ID_DUPLICATE') && !errors.some(x => x.code === 'MANIFEST_ENTRIES_NOT_SORTED_OR_DUPLICATE')) e('MANIFEST_ENTRIES_NOT_SORTED_OR_DUPLICATE', '$.entries');
    }
  }
  return errors;
}

/**
 * Verifica manifesto: (1) validade ESTRUTURAL completa, (2) integridade do rootHash e,
 * opcionalmente, (3) o conteúdo. Nunca lança em entrada malformada; devolve erros estruturados.
 * Um rootHash correto NÃO torna válido um manifesto estruturalmente inválido.
 * @param {object} manifest
 * @param {Map<string,{kind:'record',value:unknown}|{kind:'file',bytes:Uint8Array|string}>} [contents]
 * @returns {{ok:boolean, structuralOk:boolean, hashOk:boolean|null, errors:{code:string, path?:string, id?:string, detail?:string}[]}}
 */
export function verifyManifestDetailed(manifest, contents) {
  const errors = validateManifestStructure(manifest);
  const structuralOk = errors.length === 0;
  if (!isPlainObj(manifest)) return { ok: false, structuralOk: false, hashOk: null, errors };
  let hashOk = null;
  try { hashOk = computeRootHash(manifest) === manifest.rootHash; if (!hashOk) errors.push({ code: 'ROOT_HASH_MISMATCH' }); }
  catch (err) { errors.push({ code: 'MANIFEST_NOT_CANONICALIZABLE', detail: String(err && err.message) }); }
  if (contents && structuralOk) {
    const listed = new Set();
    for (const en of manifest.entries) {
      listed.add(en.id);
      const c = contents.get(en.id);
      if (!c) { errors.push({ code: 'ENTRY_MISSING', id: en.id }); continue; }
      if (c.kind !== en.kind) { errors.push({ code: 'ENTRY_KIND_MISMATCH', id: en.id }); continue; }
      let h;
      try { h = c.kind === 'file' ? hashFile(c.bytes) : hashRecord(c.value); } catch (err) { errors.push({ code: 'ENTRY_NOT_HASHABLE', id: en.id, detail: String(err && err.message) }); continue; }
      if (h !== en.sha256) errors.push({ code: 'ENTRY_HASH_MISMATCH', id: en.id });
    }
    for (const id of contents.keys()) if (!listed.has(id)) errors.push({ code: 'ENTRY_UNLISTED', id });
  }
  return { ok: errors.length === 0, structuralOk, hashOk, errors };
}

/**
 * Igual a {@link verifyManifestDetailed}, mantendo o formato de retorno original { ok, errors }.
 * @returns {{ok:boolean, errors:object[]}}
 */
export function verifyManifest(manifest, contents) { const r = verifyManifestDetailed(manifest, contents); return { ok: r.ok, errors: r.errors }; }

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
    // a partir daqui o manifesto é estruturalmente válido e íntegro
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
