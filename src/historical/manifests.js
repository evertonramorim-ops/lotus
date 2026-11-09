/**
 * Manifestos por modalidade e por execução, reutilizando buildManifest/ManifestLedger da Fase 3a
 * (contrato `lotus.manifest` 1.0.0 inalterado). Encadeamento: entrada `chain:previous` cujo sha256 é o
 * rootHash do manifesto anterior do mesmo datasetId. Nunca sobrescreve: nova importação diferente →
 * sequence+1; importação idêntica → UNCHANGED_REPLAY (nenhum manifesto novo).
 * O rootHash prova integridade/consistência interna — NÃO autenticidade da fonte.
 * @module historical/manifests
 */
import { buildManifest, ManifestLedger, verifyManifest, verifyManifestDetailed, hashRecord, hashFile } from '../integrity/manifest.js';
import { hashJson } from '../integrity/hash.js';
import { HISTORICAL_SCHEMA, HISTORICAL_SCHEMA_VERSION } from './normalize.js';

export const RUN_DATASET_ID = 'lotus.historical.run';
export const RUN_REPORT_SCHEMA = 'lotus.import-run';
export const RUN_REPORT_SCHEMA_VERSION = '1.0.0';
export const modalityDatasetId = lottery => `lotus.historical.xlsx.${lottery}`;
const clean = v => JSON.parse(JSON.stringify(v));

/** Entradas lógicas (sem encadeamento) do manifesto da modalidade. */
export function modalityEntries(imp, collection) {
  const L = imp.report.lottery;
  const e = [
    { id: `file:${L}:${collection.sha256}`, kind: 'file', sha256: collection.sha256 },
    { id: 'record:collection', sha256: hashJson(collection) },
    { id: 'record:import-report', sha256: hashJson(clean(imp.report)) },
    { id: 'record:quarantine', sha256: hashJson(clean(imp.quarantine)) },
    { id: 'record:duplicates-identical', sha256: hashJson(clean(imp.duplicatesIdentical)) },
  ];
  for (const a of imp.accepted) e.push({ id: `record:draw:${L}:${String(a.record.contest).padStart(6, '0')}`, sha256: a.recordSha256 });
  return e;
}
const contentKey = entries => hashJson([...entries].filter(x => x.id !== 'chain:previous').map(x => ({ id: x.id, kind: x.kind ?? 'record', sha256: x.sha256 })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));

/**
 * Propõe manifesto respeitando o ledger. @returns {{action:'NEW'|'UNCHANGED_REPLAY', manifest:object, submit?:object}}
 */
export function proposeManifest(ledger, datasetId, entries, createdAt, dataSchemaVersion) {
  const prev = ledger.latest(datasetId);
  if (prev && contentKey(prev.entries) === contentKey(entries)) return { action: 'UNCHANGED_REPLAY', manifest: prev };
  const all = prev ? [...entries, { id: 'chain:previous', sha256: prev.rootHash }] : entries;
  const manifest = buildManifest({ datasetId, dataSchemaVersion, sequence: prev ? prev.sequence + 1 : 1, createdAt, entries: all });
  const submit = ledger.submit(manifest);
  if (!submit.accepted) throw new Error(`manifesto recusado pelo ledger: ${submit.code}`);
  return { action: 'NEW', manifest, submit };
}

/**
 * Executa a camada de manifestos para um conjunto de importações (uma execução).
 * @param {ManifestLedger} ledger @param {{imp:object, collection:object}[]} results
 */
export function manifestRun(ledger, results, { runId, createdAt }) {
  const modality = [];
  for (const { imp, collection } of results) {
    const p = proposeManifest(ledger, modalityDatasetId(imp.report.lottery), modalityEntries(imp, collection), createdAt, `${HISTORICAL_SCHEMA}/${HISTORICAL_SCHEMA_VERSION}`);
    modality.push({ lottery: imp.report.lottery, action: p.action, datasetId: p.manifest.datasetId, sequence: p.manifest.sequence, rootHash: p.manifest.rootHash, manifest: p.manifest });
  }
  const runReport = { schema: RUN_REPORT_SCHEMA, schemaVersion: RUN_REPORT_SCHEMA_VERSION,
    modalities: results.map(({ imp, collection }) => ({ lottery: imp.report.lottery, status: imp.status, fileSha256: collection.sha256, counts: imp.report.counts })),
    modalityManifests: modality.map(m => ({ lottery: m.lottery, datasetId: m.datasetId, sequence: m.sequence, rootHash: m.rootHash })) };
  const entries = [{ id: 'record:run-report', sha256: hashJson(runReport) }, ...modality.map(m => ({ id: `manifest:${m.lottery}`, sha256: m.rootHash }))];
  const p = proposeManifest(ledger, RUN_DATASET_ID, entries, createdAt, `${RUN_REPORT_SCHEMA}/${RUN_REPORT_SCHEMA_VERSION}`);
  return { runId, modality, runReport, runManifest: p.manifest, runAction: p.action, runRootHash: p.manifest.rootHash };
}

export const MODALITY_DATA_SCHEMA_VERSION = `${HISTORICAL_SCHEMA}/${HISTORICAL_SCHEMA_VERSION}`;

/**
 * Conteúdo REAL de cada entrada do manifesto da modalidade (nunca hashes declarados): bytes do XLSX, registro de coleta,
 * relatório, quarentena, duplicatas e cada registro aceito (o hash é recalculado de `a.record`, não lido de `recordSha256`).
 * @returns {Map<string, {kind:'file', bytes:Uint8Array}|{kind:'record', value:any}>}
 */
export function modalityContents(imp, collection, rawBytes) {
  const L = imp.report.lottery; const m = new Map();
  if (rawBytes) m.set(`file:${L}:${collection.sha256}`, { kind: 'file', bytes: rawBytes });
  m.set('record:collection', { kind: 'record', value: collection });
  m.set('record:import-report', { kind: 'record', value: clean(imp.report) });
  m.set('record:quarantine', { kind: 'record', value: clean(imp.quarantine) });
  m.set('record:duplicates-identical', { kind: 'record', value: clean(imp.duplicatesIdentical) });
  for (const a of imp.accepted) m.set(`record:draw:${L}:${String(a.record.contest).padStart(6, '0')}`, { kind: 'record', value: clean(a.record) });
  return m;
}

/**
 * Verifica um manifesto da modalidade contra o CONTEÚDO real recalculado (verifyManifestDetailed): bytes do XLSX,
 * coleta, relatório, quarentena, duplicatas e cada registro aceito; IDs, kinds, hashes, entradas faltantes e extras;
 * datasetId, dataSchemaVersion, sequence e encadeamento (chain:previous) contra o manifesto anterior OU o rootHash
 * esperado. Sem bytes do XLSX, ou sequence > 1 sem anterior/rootHash esperado → falha (nunca "passa sem verificar").
 * @param {object} manifest
 * @param {object} imp resultado de importXlsx (ou artefatos equivalentes lidos do armazenamento)
 * @param {object} collection registro de coleta
 * @param {Uint8Array|null} rawBytes bytes originais do XLSX
 * @param {{previous?:object, expectedPreviousRootHash?:string, expectedDatasetId?:string, expectedDataSchemaVersion?:string, expectedSequence?:number}} [opt]
 * @returns {{ok:boolean, errors:object[], checked:object}}
 */
export function verifyModalityManifest(manifest, imp, collection, rawBytes, opt = {}) {
  const errors = []; const L = imp && imp.report ? imp.report.lottery : null;
  if (!rawBytes) errors.push({ code: 'FILE_BYTES_NOT_PROVIDED', id: `file:${L}:${collection && collection.sha256}` });
  else if (hashFile(rawBytes) !== collection.sha256) errors.push({ code: 'FILE_BYTES_MISMATCH_COLLECTION', id: `file:${L}:${collection.sha256}` });
  const contents = modalityContents(imp, collection, rawBytes);
  // registros aceitos: hash declarado em recordSha256 conferido contra o recalculado (adulteração do declarado)
  for (const a of imp.accepted) if (a.recordSha256 !== undefined && a.recordSha256 !== hashRecord(clean(a.record))) errors.push({ code: 'DECLARED_RECORD_HASH_MISMATCH', id: `record:draw:${L}:${String(a.record.contest).padStart(6, '0')}` });
  const d = verifyManifestDetailed(manifest, contents);
  const chainEntry = manifest && Array.isArray(manifest.entries) ? manifest.entries.find(e => e.id === 'chain:previous') : undefined;
  for (const e of d.errors) if (!(e.code === 'ENTRY_MISSING' && e.id === 'chain:previous')) errors.push(e);
  if (!rawBytes) for (const i in errors) if (errors[i].code === 'ENTRY_MISSING' && /^file:/.test(errors[i].id)) errors[i] = { ...errors[i], code: 'ENTRY_NOT_VERIFIED_NO_BYTES' };
  const wantDs = opt.expectedDatasetId ?? (L ? modalityDatasetId(L) : null);
  if (manifest && manifest.datasetId !== wantDs) errors.push({ code: 'DATASET_ID_MISMATCH', expected: wantDs, found: manifest && manifest.datasetId });
  const wantSchema = opt.expectedDataSchemaVersion ?? MODALITY_DATA_SCHEMA_VERSION;
  if (manifest && manifest.dataSchemaVersion !== wantSchema) errors.push({ code: 'DATA_SCHEMA_VERSION_MISMATCH', expected: wantSchema, found: manifest.dataSchemaVersion });
  if (opt.expectedSequence !== undefined && manifest && manifest.sequence !== opt.expectedSequence) errors.push({ code: 'SEQUENCE_MISMATCH', expected: opt.expectedSequence, found: manifest.sequence });
  // encadeamento
  let chain = 'NAO_APLICAVEL';
  if (manifest && manifest.sequence === 1) { if (chainEntry) errors.push({ code: 'CHAIN_UNEXPECTED_IN_FIRST_MANIFEST' }); else chain = 'PRIMEIRO_MANIFESTO'; }
  else if (manifest && Number.isSafeInteger(manifest.sequence) && manifest.sequence > 1) {
    if (!chainEntry) errors.push({ code: 'CHAIN_MISSING' });
    else if (chainEntry.kind !== 'record') errors.push({ code: 'CHAIN_KIND_MISMATCH' });
    const prev = opt.previous ?? null; const want = prev ? prev.rootHash : opt.expectedPreviousRootHash ?? null;
    if (!want) errors.push({ code: 'CHAIN_NOT_VERIFIABLE', detail: 'informe o manifesto anterior ou o rootHash esperado' });
    else if (chainEntry && chainEntry.sha256 !== want) errors.push({ code: 'CHAIN_PREVIOUS_MISMATCH', expected: want, found: chainEntry.sha256 });
    if (prev) {
      const pv = verifyManifest(prev); if (!pv.ok) errors.push({ code: 'CHAIN_PREVIOUS_INVALID', errors: pv.errors });
      if (prev.datasetId !== manifest.datasetId) errors.push({ code: 'CHAIN_PREVIOUS_DATASET_MISMATCH' });
      if (prev.sequence !== manifest.sequence - 1) errors.push({ code: 'CHAIN_PREVIOUS_SEQUENCE_MISMATCH', expected: manifest.sequence - 1, found: prev.sequence });
    }
    if (!errors.some(e => /^CHAIN_/.test(e.code))) chain = prev ? 'VERIFICADO_CONTRA_ANTERIOR' : 'VERIFICADO_CONTRA_ROOTHASH_ESPERADO';
  }
  return { ok: errors.length === 0, errors, checked: { entries: contents.size, acceptedRecords: imp.accepted.length, fileBytes: !!rawBytes, rootHashOk: d.hashOk, structuralOk: d.structuralOk, chain } };
}
export { ManifestLedger };
