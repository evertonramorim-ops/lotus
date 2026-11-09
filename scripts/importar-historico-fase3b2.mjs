#!/usr/bin/env node
/**
 * Importação LOCAL dos XLSX históricos (Fase 3b.2) para armazenamento PRIVADO fora do Git.
 * Não faz rede: usa os bytes já coletados na Fase 3b.1 (cópia byte a byte com verificação SHA-256).
 * Uso:
 *   node scripts/importar-historico-fase3b2.mjs --private /caminho/dados-privados --from-3b1 /caminho/fase3b1 [--created-at ISO]
 * Recusa: diretório privado dentro de um repositório Git; SHA-256 divergente; sobrescrita de arquivo existente.
 * Nada aqui contém dado real: os dados só existem no diretório privado.
 */
import { readFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { runPipeline } from '../src/historical/pipeline.js';
import { FileLedger, writeJsonOnce, writeOnce, privatePaths } from '../src/historical/store.js';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const priv = resolve(arg('--private') ?? ''); const src = resolve(arg('--from-3b1') ?? '');
const createdAt = arg('--created-at') ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
if (!arg('--private') || !arg('--from-3b1')) { console.error('uso: --private DIR --from-3b1 DIR'); process.exit(2); }
mkdirSync(priv, { recursive: true });
const g = spawnSync('git', ['-C', priv, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
if (g.status === 0 && g.stdout.trim() === 'true') { console.error('RECUSADO: diretório privado está dentro de um repositório Git'); process.exit(3); }
const P = privatePaths(priv);
const MAP = { 'Mega-Sena': 'megasena', 'Lotof%C3%A1cil': 'lotofacil', Quina: 'quina', Lotomania: 'lotomania' };
const log = readFileSync(join(src, 'request_log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(d => /\/api\/resultados\/download\?modalidade=/.test(d.url) && d.status === 200);
const inputs = [];
for (const d of log) {
  const lottery = MAP[new URL(d.url).searchParams.get('modalidade') === 'Lotofácil' ? 'Lotof%C3%A1cil' : new URL(d.url).searchParams.get('modalidade')];
  const srcFile = join(src, d.file.startsWith('raw/') ? d.file : join('raw', d.file.split('/').pop()));
  const bytes = readFileSync(srcFile); const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== d.sha256) { console.error(`RECUSADO: sha256 divergente para ${lottery}`); process.exit(4); }
  const dst = join(P.raw, lottery, `${sha}.xlsx`); mkdirSync(join(P.raw, lottery), { recursive: true });
  if (!existsSync(dst)) copyFileSync(srcFile, dst);
  const copied = readFileSync(dst); if (createHash('sha256').update(copied).digest('hex') !== sha || Buffer.compare(copied, bytes) !== 0) { console.error('RECUSADO: cópia não idêntica'); process.exit(5); }
  const cd = d.headers['Content-Disposition'] ?? null; const fn = cd && /filename="?([^";]+)"?/.exec(cd);
  const collectedAt = new Date(d.utc).toISOString();
  inputs.push({ lottery, bytes: new Uint8Array(copied), meta: { collectionRunId: 'fase3b1-coleta', url: d.url, method: d.method, httpStatus: d.status, contentType: d.headers['Content-Type'] ?? null, contentDisposition: cd, originalFileName: fn ? fn[1] : null, collectedAt, sourceType: 'EXTERNAL_UNVERIFIED', note: 'coletado na Fase 3b.1; bytes copiados sem alteração' }, dst });
}
const order = ['megasena', 'lotofacil', 'quina', 'lotomania'];
inputs.sort((a, b) => order.indexOf(a.lottery) - order.indexOf(b.lottery));
if (inputs.length !== 4) { console.error(`esperava 4 arquivos, encontrou ${inputs.length}`); process.exit(6); }
const ledger = new FileLedger(P.ledger);
const runId = `import-${createdAt.replace(/[-:]/g, '').replace(/\.\d+/, '')}`;
const t0 = process.hrtime.bigint();
const r = runPipeline({ inputs, ledger, runId, createdAt });
const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
const runDir = join(P.runs, runId);
for (const res of r.results) {
  const L = res.lottery; const base = join(P.raw, L, res.collection.sha256);
  writeJsonOnce(`${base}.collection.json`, res.collection); writeJsonOnce(`${base}.envelope.json`, res.envelope);
  const d = join(runDir, L);
  writeJsonOnce(join(d, 'import-report.json'), res.imp.report);
  writeJsonOnce(join(d, 'quarantine.json'), res.imp.quarantine);
  writeJsonOnce(join(d, 'duplicates-identical.json'), res.imp.duplicatesIdentical);
  writeOnce(join(d, 'accepted-records.jsonl'), res.imp.accepted.map(a => JSON.stringify(a.record)).join('\n') + '\n');
  writeOnce(join(d, 'accepted-results.jsonl'), res.imp.accepted.map(a => JSON.stringify(a.result)).join('\n') + '\n');
  const m = r.run.modality.find(x => x.lottery === L); writeJsonOnce(join(d, 'manifest.json'), { action: m.action, manifest: m.manifest });
}
writeJsonOnce(join(runDir, 'run-report.json'), r.run.runReport);
writeJsonOnce(join(runDir, 'run-manifest.json'), { action: r.run.runAction, manifest: r.run.runManifest });
const summary = { runId, createdAt, elapsedMs: ms, logicalSha256: r.logicalSha256, runRootHash: r.run.runRootHash, runAction: r.run.runAction,
  modalities: r.results.map(x => ({ lottery: x.lottery, status: x.imp.status, fileSha256: x.collection.sha256, bytes: x.collection.byteLength, collectedAt: x.collection.collectedAt, counts: x.imp.report.counts, quarantineReasonCounts: x.imp.report.quarantineReasonCounts, annotationCounts: x.imp.report.annotationCounts, schemaAlerts: x.imp.report.schemaAlerts, coverage: { ...x.imp.report.coverage, missingRanges: x.imp.report.coverage.missingRanges.length }, manifest: r.run.modality.find(m => m.lottery === x.lottery) && (({ manifest, ...rest }) => rest)(r.run.modality.find(m => m.lottery === x.lottery)) })) };
writeJsonOnce(join(runDir, 'summary.json'), summary);
console.log(JSON.stringify(summary, null, 2));
