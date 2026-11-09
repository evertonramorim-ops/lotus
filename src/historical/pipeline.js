/**
 * Orquestra uma execução: captura (A) → importação (B/C/D) → manifestos (modalidade + execução).
 * Determinístico dado (bytes, metadados de coleta, runId, createdAt, estado do ledger).
 * @module historical/pipeline
 */
import { captureRaw, importXlsx } from './importer.js';
import { manifestRun, ManifestLedger } from './manifests.js';
import { hashJson } from '../integrity/hash.js';
const clean = v => JSON.parse(JSON.stringify(v));

/** @param {{inputs:{lottery:string, bytes:Uint8Array, meta:object}[], ledger?:object, runId:string, createdAt:string, limits?:object}} p */
export function runPipeline({ inputs, ledger = new ManifestLedger(), runId, createdAt, limits }) {
  const results = inputs.map(({ lottery, bytes, meta }) => {
    const { envelope, collection } = captureRaw(bytes, { ...meta, lottery });
    const imp = importXlsx({ envelope, collection, lottery, limits });
    return { lottery, envelope, collection, imp };
  });
  const run = manifestRun(ledger, results, { runId, createdAt });
  const logical = {
    modalities: results.map(r => ({ lottery: r.lottery, rawSha256: r.collection.sha256, envelopeSha256: r.envelope.envelopeSha256, collectionSha256: r.collection.collectionSha256,
      reportSha256: hashJson(clean(r.imp.report)), quarantineSha256: hashJson(clean(r.imp.quarantine)), acceptedSha256: hashJson(r.imp.accepted.map(a => a.recordSha256)), counts: r.imp.report.counts })),
    modalityRootHashes: run.modality.map(m => ({ lottery: m.lottery, sequence: m.sequence, rootHash: m.rootHash })), runRootHash: run.runRootHash,
  };
  return { results, run, logical, logicalSha256: hashJson(logical) };
}
