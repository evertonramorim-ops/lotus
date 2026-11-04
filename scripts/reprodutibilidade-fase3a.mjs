// Fase 3a — registro de reprodutibilidade (SYNTHETIC_DATA, offline, sem relógio oculto).
// Executa o pipeline completo DUAS vezes (fixtures → envelope bruto → normalização → validação →
// manifesto) e compara os hashes. Grava docs/fase3a-evidencias/reprodutibilidade.json.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRawEnvelope, processBatch, QuarantineStore, PARSER_VERSION, RESULT_SCHEMA, RESULT_SCHEMA_VERSION } from '../src/data/index.js';
import { buildManifest, verifyManifest, hashRecord, hashFile } from '../src/integrity/index.js';

const FIX = 'test/fase3a/fixtures/SYNTHETIC_DATA';
const CREATED_AT = '2026-01-01T00:00:00Z'; // fornecido explicitamente (determinismo)
const PROV = { sourceType: 'SYNTHETIC_DATA', sourceId: 'lotus-test-fixtures-fase3a', obtainedAt: '2026-01-01T00:00:00Z', note: 'SYNTHETIC_DATA — não é dado real' };

function run() {
  const files = readdirSync(FIX).filter(f => f.endsWith('.json')).sort();
  const fileHashes = Object.fromEntries(files.map(f => [f, hashFile(new Uint8Array(readFileSync(join(FIX, f))))]));
  const raws = [];
  for (const f of files) { const j = JSON.parse(readFileSync(join(FIX, f), 'utf8')); raws.push(...(j.rawInputs ?? j.cases.map(c => c.raw))); }
  const out = processBatch(raws.map(r => createRawEnvelope(r, { provenance: PROV })), new QuarantineStore());
  const entries = [
    ...files.map(f => ({ id: `file:${f}`, kind: 'file', sha256: fileHashes[f] })),
    ...out.accepted.map(a => ({ id: `record:${a.record.lottery}:${a.record.contest}`, kind: 'record', sha256: hashRecord(a.record) })),
  ];
  const manifest = buildManifest({ datasetId: 'synthetic.fase3a.fixtures', dataSchemaVersion: `${RESULT_SCHEMA}/${RESULT_SCHEMA_VERSION}`, sequence: 1, createdAt: CREATED_AT, entries });
  const contents = new Map([...files.map(f => [`file:${f}`, { kind: 'file', bytes: new Uint8Array(readFileSync(join(FIX, f))) }]),
    ...out.accepted.map(a => [`record:${a.record.lottery}:${a.record.contest}`, { kind: 'record', value: a.record }])]);
  return { fileHashes, accepted: out.accepted.length, quarantined: out.quarantined.length,
    quarantineCodes: out.quarantined.map(q => q.reasons.map(r => r.code).join('+')),
    rootHash: manifest.rootHash, manifest, verification: verifyManifest(manifest, contents) };
}

const a = run(); const b = run();
const same = JSON.stringify(a) === JSON.stringify(b);
const record = {
  label: 'SYNTHETIC_DATA', generatedBy: 'scripts/reprodutibilidade-fase3a.mjs', node: process.version, parserVersion: PARSER_VERSION,
  createdAtInput: CREATED_AT, runs: 2, identicalAcrossRuns: same,
  run1: { rootHash: a.rootHash, accepted: a.accepted, quarantined: a.quarantined, verificationOk: a.verification.ok },
  run2: { rootHash: b.rootHash, accepted: b.accepted, quarantined: b.quarantined, verificationOk: b.verification.ok },
  fixtureSha256: a.fileHashes, quarantineCodes: a.quarantineCodes, manifest: a.manifest,
};
mkdirSync('docs/fase3a-evidencias', { recursive: true });
writeFileSync('docs/fase3a-evidencias/reprodutibilidade.json', JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ identicalAcrossRuns: same, rootHash1: a.rootHash, rootHash2: b.rootHash, accepted: a.accepted, quarantined: a.quarantined, verificationOk: a.verification.ok && b.verification.ok }, null, 2));
if (!same || !a.verification.ok) process.exit(1);
