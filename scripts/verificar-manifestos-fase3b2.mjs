#!/usr/bin/env node
/**
 * Verificação SOMENTE LEITURA de TODAS as execuções persistidas (Fase 3b.2), via verifyPersistedRuns:
 * - ledger persistente revalidado por inteiro, na ordem das linhas (JSON, estrutura, rootHash, sucessão +1, chain:previous);
 * - manifesto de cada modalidade contra o CONTEÚDO real (bytes do XLSX, coleta, relatório, quarentena, duplicatas,
 *   cada registro aceito) e contra a linha correspondente do ledger (conteúdo idêntico, não só existência);
 * - run-report.json recalculado a partir dos artefatos verificados; run-manifest.json (rootHash, as 4 referências
 *   manifest:<modalidade> contra os rootHashes verificados, datasetId, dataSchemaVersion, encadeamento);
 * - sucessão entre execuções (NEW = anterior + 1; UNCHANGED_REPLAY = mesmo manifesto); toda linha do ledger referenciada.
 * - ordem das execuções pela sequência AUTORITATIVA do ledger (nunca nome da pasta/runId/createdAt); createdAt retroativo → aviso.
 * Leitura confinada (store.js): links simbólicos recusados. Não escreve nada, não acessa rede, não reimporta.
 *   node scripts/verificar-manifestos-fase3b2.mjs --private DIR
 * Saída: resumo JSON no stdout (sem caminhos locais). Exit 0 = tudo verificado; 1 = alguma falha.
 */
import { resolve } from 'node:path';
import { verifyPersistedRuns, RUN_LOTTERIES } from '../src/historical/manifests.js';
import { readConfined, existsConfined, listDirConfined, ConfinementError } from '../src/historical/store.js';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if (!arg('--private')) { console.error('uso: --private DIR'); process.exit(2); }
const priv = resolve(arg('--private'));
// leitura confinada (lstat por componente, O_NOFOLLOW, /proc/self/fd): link simbólico → recusa explícita (exit 1), nunca segue
const guard = f => { try { return f(); } catch (e) { if (e instanceof ConfinementError) { console.log(JSON.stringify({ ok: false, errorCount: 1, errors: [{ scope: 'filesystem', code: e.code, rel: e.rel }] }, null, 1)); process.exit(1); } throw e; } };
const has = rel => guard(() => existsConfined(priv, rel));
const T = rel => guard(() => readConfined(priv, rel)).toString('utf8');
const J = rel => (has(rel) ? JSON.parse(T(rel)) : null);
const runs = [];
// a ordem de listagem é irrelevante: verifyPersistedRuns ordena pela sequência autoritativa do ledger
for (const run of guard(() => listDirConfined(priv, 'runs')).filter(d => /^import-[0-9TZ]+$/.test(d)).sort()) {
  const modalities = [];
  for (const l of RUN_LOTTERIES) {
    const dir = `runs/${run}/${l}`; if (!has(`${dir}/manifest.json`)) continue; // ausência → RUN_MODALITY_MISSING
    const manifestFile = J(`${dir}/manifest.json`); const manifest = manifestFile && manifestFile.manifest;
    const fe = manifest && Array.isArray(manifest.entries) ? manifest.entries.filter(e => e.kind === 'file' && new RegExp(`^file:${l}:[0-9a-f]{64}$`).test(e.id)) : [];
    const sha = fe.length === 1 ? fe[0].id.split(':')[2] : null; // o sha é REVERIFICADO contra os bytes e a coleta
    const collection = sha ? J(`raw/${l}/${sha}.collection.json`) : null;
    const rawBytes = sha && has(`raw/${l}/${sha}.xlsx`) ? new Uint8Array(guard(() => readConfined(priv, `raw/${l}/${sha}.xlsx`))) : null;
    const imp = { report: J(`${dir}/import-report.json`), quarantine: J(`${dir}/quarantine.json`), duplicatesIdentical: J(`${dir}/duplicates-identical.json`),
      accepted: T(`${dir}/accepted-records.jsonl`).split('\n').filter(Boolean).map(x => ({ record: JSON.parse(x) })) };
    modalities.push({ lottery: l, manifestFile, imp, collection: collection ?? { sha256: null }, rawBytes });
  }
  runs.push({ runId: run, runManifestFile: J(`runs/${run}/run-manifest.json`), runReport: J(`runs/${run}/run-report.json`), modalities });
}
const r = verifyPersistedRuns({ ledgerText: T('ledger/manifests.jsonl'), runs });
const errs = r.errors.map(e => Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'errors')));
console.log(JSON.stringify({ ok: r.ok, order: r.order, warnings: r.warnings, ledger: r.ledger, modalityManifests: { verified: r.modalityManifestsVerified, total: r.modalityManifestsTotal },
  runManifests: { verified: r.runManifestsVerified, total: r.runManifestsTotal }, entriesChecked: r.entriesChecked, errorCount: r.errors.length, errors: errs,
  modalityResults: r.modalityResults, runResults: r.runResults }, null, 1));
process.exit(r.ok ? 0 : 1);
