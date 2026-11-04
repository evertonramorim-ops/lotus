/**
 * Manifestos por modalidade e por execução, reutilizando buildManifest/ManifestLedger da Fase 3a
 * (contrato `lotus.manifest` 1.0.0 inalterado). Encadeamento: entrada `chain:previous` cujo sha256 é o
 * rootHash do manifesto anterior do mesmo datasetId. Nunca sobrescreve: nova importação diferente →
 * sequence+1; importação idêntica → UNCHANGED_REPLAY (nenhum manifesto novo).
 * O rootHash prova integridade/consistência interna — NÃO autenticidade da fonte.
 * @module historical/manifests
 */
import { buildManifest, ManifestLedger, verifyManifest } from '../integrity/manifest.js';
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

/** Verifica um manifesto da modalidade contra o conteúdo recalculado (detecta adulteração). */
export function verifyModalityManifest(manifest, imp, collection, rawBytesOrNull) {
  const contents = {};
  for (const e of modalityEntries(imp, collection)) contents[e.id] = e.kind === 'file' ? rawBytesOrNull : null;
  const map = Object.fromEntries(modalityEntries(imp, collection).map(e => [e.id, e.sha256]));
  const errors = [];
  for (const e of manifest.entries) if (e.id !== 'chain:previous' && map[e.id] !== e.sha256) errors.push({ code: 'ENTRY_HASH_MISMATCH', id: e.id });
  for (const id of Object.keys(map)) if (!manifest.entries.some(e => e.id === id)) errors.push({ code: 'ENTRY_MISSING', id });
  const s = verifyManifest(manifest);
  if (!s.ok) errors.push(...s.errors);
  void contents;
  return { ok: errors.length === 0, errors };
}
export { ManifestLedger };
