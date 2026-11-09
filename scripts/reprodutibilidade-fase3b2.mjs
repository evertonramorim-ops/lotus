#!/usr/bin/env node
/**
 * Reprodutibilidade da Fase 3b.2 em DOIS PROCESSOS NODE SEPARADOS.
 * Cada filho executa o pipeline completo (captura → parser → normalização → validação → quarentena →
 * manifestos) sobre as mesmas entradas e imprime o resultado lógico + metadados variáveis (pid, horário),
 * que ficam SEPARADOS e não entram no hash lógico.
 * Uso: node scripts/reprodutibilidade-fase3b2.mjs            (fixtures SYNTHETIC_DATA)
 *      node scripts/reprodutibilidade-fase3b2.mjs --real DIR (arquivos brutos privados em DIR/raw/<modalidade>/*.xlsx)
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const L4 = ['megasena', 'lotofacil', 'quina', 'lotomania'];

async function child(realDir) {
  const { runPipeline } = await import('../src/historical/pipeline.js');
  let inputs;
  if (realDir) {
    // leitura confinada (store.js): links simbólicos em raw/<modalidade> ou nos arquivos são recusados
    const { listDirConfined, readConfined } = await import('../src/historical/store.js');
    inputs = L4.map(l => { const d = `raw/${l}`; const x = listDirConfined(realDir, d).filter(f => /^[0-9a-f]{64}\.xlsx$/.test(f)).sort()[0];
      const col = JSON.parse(readConfined(realDir, `${d}/${x.replace(/\.xlsx$/, '.collection.json')}`).toString('utf8'));
      return { lottery: l, bytes: new Uint8Array(readConfined(realDir, `${d}/${x}`)), meta: { collectionRunId: col.collectionRunId, url: col.url, method: col.method, httpStatus: col.httpStatus, contentType: col.contentType, contentDisposition: col.contentDisposition, originalFileName: col.originalFileName, collectedAt: col.collectedAt, sourceType: col.sourceType, note: col.note } }; });
  } else {
    const { syntheticWorkbook, SYNTH_META } = await import('../test/fase3b2/_xlsx-writer.js');
    inputs = L4.map(l => ({ lottery: l, bytes: syntheticWorkbook(l, { count: 40, seed: 2026 }), meta: SYNTH_META(l, 'repro') }));
  }
  const t0 = process.hrtime.bigint();
  const r = runPipeline({ inputs, runId: 'reprodutibilidade', createdAt: '2026-01-01T00:00:00Z' });
  process.stdout.write(JSON.stringify({ logical: r.logical, logicalSha256: r.logicalSha256, variable: { pid: process.pid, startedAt: new Date().toISOString(), elapsedMs: Number((process.hrtime.bigint() - t0) / 1000000n) } }));
}

if (process.argv.includes('--child')) {
  const i = process.argv.indexOf('--real'); await child(i > 0 ? process.argv[i + 1] : null);
} else {
  const i = process.argv.indexOf('--real'); const real = i > 0 ? process.argv[i + 1] : null;
  if (real && !existsSync(real)) { console.error('diretório inexistente'); process.exit(2); }
  const run = () => { const p = spawnSync(process.execPath, [self, '--child', ...(real ? ['--real', real] : [])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); if (p.status !== 0) { console.error(p.stderr); process.exit(1); } return JSON.parse(p.stdout); };
  const a = run(); const b = run();
  const same = a.logicalSha256 === b.logicalSha256 && JSON.stringify(a.logical) === JSON.stringify(b.logical);
  console.log(JSON.stringify({ mode: real ? 'REAL_PRIVADO' : 'SYNTHETIC_DATA', identical: same, logicalSha256: [a.logicalSha256, b.logicalSha256], runRootHash: [a.logical.runRootHash, b.logical.runRootHash],
    modalityRootHashes: a.logical.modalityRootHashes, counts: a.logical.modalities.map(m => ({ lottery: m.lottery, ...m.counts })), variableMetadata: [a.variable, b.variable], distinctProcesses: a.variable.pid !== b.variable.pid }, null, 2));
  process.exit(same && a.variable.pid !== b.variable.pid ? 0 : 1);
}
