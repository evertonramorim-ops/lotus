#!/usr/bin/env node
/**
 * Importação LOCAL dos XLSX históricos (Fase 3b.2) para armazenamento PRIVADO fora do Git.
 * Não faz rede: usa os bytes já coletados na Fase 3b.1 (cópia byte a byte com verificação SHA-256).
 * Uso:
 *   node scripts/importar-historico-fase3b2.mjs --private /caminho/dados-privados --from-3b1 /caminho/fase3b1 [--created-at ISO]
 * Recusa: diretório privado dentro de um repositório Git; SHA-256 divergente; sobrescrita de arquivo existente;
 * `--created-at` fora do formato ISO-8601 UTC; pasta da execução já existente (ANTES de tocar o ledger);
 * caminho do log fora de `raw/`, com travessia ou com link simbólico (leitura/escrita confinadas: store.js).
 * Linhas do log inválidas (JSON, URL, caminho, SHA-256, `utc`) são rejeitadas com número da linha e motivo
 * (planImportFromLog); sem os 4 arquivos válidos, nada é importado.
 * `--created-at` retroativo é aceito (com aviso), mas NÃO define a ordem histórica: a ordem é a do ledger (sequence).
 * Nada aqui contém dado real: os dados só existem no diretório privado.
 */
import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { runPipeline } from '../src/historical/pipeline.js';
import { FileLedger, writeJsonOnceConfined, writeOnceConfined, readConfined, existsConfined } from '../src/historical/store.js';
import { planImportFromLog } from '../src/historical/import-log.js';
import { RUN_DATASET_ID } from '../src/historical/manifests.js';
import { isIsoUtc } from '../src/integrity/manifest.js';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if (!arg('--private') || !arg('--from-3b1')) { console.error('uso: --private DIR --from-3b1 DIR'); process.exit(2); }
const createdAtArg = arg('--created-at');
if (process.argv.includes('--created-at') && !isIsoUtc(createdAtArg)) { console.error('RECUSADO (CREATED_AT_INVALIDO): --created-at deve ser ISO-8601 UTC válido (ex.: 2026-01-01T00:00:00Z)'); process.exit(2); }
const priv = resolve(arg('--private')); const src = resolve(arg('--from-3b1'));
const createdAt = createdAtArg ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
mkdirSync(priv, { recursive: true });
const g = spawnSync('git', ['-C', priv, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
if (g.status === 0 && g.stdout.trim() === 'true') { console.error('RECUSADO: diretório privado está dentro de um repositório Git'); process.exit(3); }
const sha256 = b => createHash('sha256').update(b).digest('hex');
const fail = (code, msg, extra) => { console.error(`RECUSADO (${code}): ${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}`); process.exit(code === 'SHA256_DIVERGENTE' ? 4 : code === 'COPIA_NAO_IDENTICA' ? 5 : code === 'ENTRADAS_INCOMPLETAS' ? 6 : code === 'EXECUCAO_JA_EXISTE' ? 7 : 9); };
const confined = (f, what) => { try { return f(); } catch (e) { if (e && e.name === 'ConfinementError') fail('CAMINHO_RECUSADO', `${what}: ${e.code}`, { rel: e.rel }); throw e; } };

const { items, rejected } = planImportFromLog(confined(() => readConfined(src, 'request_log.jsonl'), 'log da Fase 3b.1').toString('utf8'));
if (rejected.length) console.error(`linhas do log rejeitadas (com motivo): ${JSON.stringify(rejected)}`);
const inputs = [];
for (const it of items) {
  const bytes = confined(() => readConfined(src, it.relFile, { prefix: 'raw/' }), `arquivo do log (linha ${it.line})`);
  const sha = sha256(bytes);
  if (sha !== it.sha256) fail('SHA256_DIVERGENTE', `sha256 divergente para ${it.lottery}`);
  const dstRel = `raw/${it.lottery}/${sha}.xlsx`;
  confined(() => writeOnceConfined(priv, dstRel, bytes), 'destino da cópia'); // nunca sobrescreve; existente só se idêntico
  const copied = confined(() => readConfined(priv, dstRel), 'cópia');
  if (sha256(copied) !== sha || Buffer.compare(copied, bytes) !== 0) fail('COPIA_NAO_IDENTICA', 'cópia não idêntica');
  const cd = it.headers['Content-Disposition'] ?? null; const fn = typeof cd === 'string' ? /filename="?([^";]+)"?/.exec(cd) : null;
  inputs.push({ lottery: it.lottery, bytes: new Uint8Array(copied), meta: { collectionRunId: 'fase3b1-coleta', url: it.url, method: it.method, httpStatus: it.httpStatus, contentType: it.headers['Content-Type'] ?? null, contentDisposition: cd, originalFileName: fn ? fn[1] : null, collectedAt: it.collectedAt, sourceType: 'EXTERNAL_UNVERIFIED', note: 'coletado na Fase 3b.1; bytes copiados sem alteração' } });
}
const order = ['megasena', 'lotofacil', 'quina', 'lotomania'];
inputs.sort((a, b) => order.indexOf(a.lottery) - order.indexOf(b.lottery));
if (inputs.length !== 4 || new Set(inputs.map(i => i.lottery)).size !== 4) fail('ENTRADAS_INCOMPLETAS', `esperava 4 arquivos (1 por modalidade), encontrou ${inputs.length}`, { rejected });
const LEDGER_REL = 'ledger/manifests.jsonl';
const ledger = confined(() => new FileLedger(null, { root: priv, rel: LEDGER_REL }), 'ledger');
const runId = `import-${createdAt.replace(/[-:]/g, '').replace(/\.\d+/, '')}`;
const runRel = `runs/${runId}`;
// ANTES do pipeline (que acrescenta ao ledger): pasta da execução já existente → recusa, sem linha órfã no ledger
if (confined(() => existsConfined(priv, runRel), 'pasta da execução')) fail('EXECUCAO_JA_EXISTE', `a execução ${runId} já existe (use outro --created-at)`);
const prevRun = ledger.latest(RUN_DATASET_ID);
if (prevRun && Date.parse(createdAt) < Date.parse(prevRun.createdAt)) console.error(`AVISO (CREATED_AT_RETROATIVO): createdAt ${createdAt} anterior ao da última execução do ledger (sequence ${prevRun.sequence}); a ordem histórica é a do ledger, não a data`);
const t0 = process.hrtime.bigint();
const r = runPipeline({ inputs, ledger, runId, createdAt });
const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
for (const res of r.results) {
  const L = res.lottery; const base = `raw/${L}/${res.collection.sha256}`;
  writeJsonOnceConfined(priv, `${base}.collection.json`, res.collection); writeJsonOnceConfined(priv, `${base}.envelope.json`, res.envelope);
  const d = `${runRel}/${L}`;
  writeJsonOnceConfined(priv, `${d}/import-report.json`, res.imp.report);
  writeJsonOnceConfined(priv, `${d}/quarantine.json`, res.imp.quarantine);
  writeJsonOnceConfined(priv, `${d}/duplicates-identical.json`, res.imp.duplicatesIdentical);
  writeOnceConfined(priv, `${d}/accepted-records.jsonl`, res.imp.accepted.map(a => JSON.stringify(a.record)).join('\n') + '\n');
  writeOnceConfined(priv, `${d}/accepted-results.jsonl`, res.imp.accepted.map(a => JSON.stringify(a.result)).join('\n') + '\n');
  const m = r.run.modality.find(x => x.lottery === L); writeJsonOnceConfined(priv, `${d}/manifest.json`, { action: m.action, manifest: m.manifest });
}
writeJsonOnceConfined(priv, `${runRel}/run-report.json`, r.run.runReport);
writeJsonOnceConfined(priv, `${runRel}/run-manifest.json`, { action: r.run.runAction, manifest: r.run.runManifest });
const summary = { runId, createdAt, elapsedMs: ms, logicalSha256: r.logicalSha256, runRootHash: r.run.runRootHash, runAction: r.run.runAction, runSequence: r.run.runManifest.sequence, rejectedLogLines: rejected,
  modalities: r.results.map(x => ({ lottery: x.lottery, status: x.imp.status, fileSha256: x.collection.sha256, bytes: x.collection.byteLength, collectedAt: x.collection.collectedAt, counts: x.imp.report.counts, quarantineReasonCounts: x.imp.report.quarantineReasonCounts, annotationCounts: x.imp.report.annotationCounts, schemaAlerts: x.imp.report.schemaAlerts, coverage: { ...x.imp.report.coverage, missingRanges: x.imp.report.coverage.missingRanges.length }, manifest: r.run.modality.find(m => m.lottery === x.lottery) && (({ manifest, ...rest }) => rest)(r.run.modality.find(m => m.lottery === x.lottery)) })) };
writeJsonOnceConfined(priv, `${runRel}/summary.json`, summary);
console.log(JSON.stringify(summary, null, 2));
