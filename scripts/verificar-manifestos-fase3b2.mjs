#!/usr/bin/env node
/**
 * Verificação SOMENTE LEITURA de TODAS as execuções persistidas (Fase 3b.2), via verifyPersistedRuns:
 * - ledger persistente revalidado por inteiro, na ordem das linhas (JSON, estrutura, rootHash, sucessão +1, chain:previous);
 * - manifesto de cada modalidade contra o CONTEÚDO real (bytes do XLSX, coleta, relatório, quarentena, duplicatas,
 *   cada registro aceito) e contra a linha correspondente do ledger (conteúdo idêntico, não só existência);
 * - run-report.json recalculado a partir dos artefatos verificados; run-manifest.json (rootHash, as 4 referências
 *   manifest:<modalidade> contra os rootHashes verificados, datasetId, dataSchemaVersion, encadeamento);
 * - sucessão entre execuções (NEW = anterior + 1; UNCHANGED_REPLAY = mesmo manifesto); toda linha do ledger referenciada.
 * Não escreve nada, não acessa rede, não reimporta.
 *   node scripts/verificar-manifestos-fase3b2.mjs --private DIR
 * Saída: resumo JSON no stdout (sem caminhos locais). Exit 0 = tudo verificado; 1 = alguma falha.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyPersistedRuns, RUN_LOTTERIES } from '../src/historical/manifests.js';
import { privatePaths, safeJoin } from '../src/historical/store.js';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if (!arg('--private')) { console.error('uso: --private DIR'); process.exit(2); }
const priv = resolve(arg('--private')); const P = privatePaths(priv);
const has = rel => existsSync(safeJoin(priv, rel));
const J = rel => (has(rel) ? JSON.parse(readFileSync(safeJoin(priv, rel), 'utf8')) : null);
const runs = [];
for (const run of readdirSync(P.runs).filter(d => /^import-[0-9TZ]+$/.test(d)).sort()) {
  const modalities = [];
  for (const l of RUN_LOTTERIES) {
    const dir = `runs/${run}/${l}`; if (!has(`${dir}/manifest.json`)) continue; // ausência → RUN_MODALITY_MISSING
    const manifestFile = J(`${dir}/manifest.json`); const manifest = manifestFile && manifestFile.manifest;
    const fe = manifest && Array.isArray(manifest.entries) ? manifest.entries.filter(e => e.kind === 'file' && new RegExp(`^file:${l}:[0-9a-f]{64}$`).test(e.id)) : [];
    const sha = fe.length === 1 ? fe[0].id.split(':')[2] : null; // o sha é REVERIFICADO contra os bytes e a coleta
    const collection = sha ? J(`raw/${l}/${sha}.collection.json`) : null;
    const rawBytes = sha && has(`raw/${l}/${sha}.xlsx`) ? new Uint8Array(readFileSync(safeJoin(priv, `raw/${l}/${sha}.xlsx`))) : null;
    const imp = { report: J(`${dir}/import-report.json`), quarantine: J(`${dir}/quarantine.json`), duplicatesIdentical: J(`${dir}/duplicates-identical.json`),
      accepted: readFileSync(safeJoin(priv, `${dir}/accepted-records.jsonl`), 'utf8').split('\n').filter(Boolean).map(x => ({ record: JSON.parse(x) })) };
    modalities.push({ lottery: l, manifestFile, imp, collection: collection ?? { sha256: null }, rawBytes });
  }
  runs.push({ runId: run, runManifestFile: J(`runs/${run}/run-manifest.json`), runReport: J(`runs/${run}/run-report.json`), modalities });
}
const r = verifyPersistedRuns({ ledgerText: readFileSync(P.ledger, 'utf8'), runs });
const errs = r.errors.map(e => Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'errors')));
console.log(JSON.stringify({ ok: r.ok, ledger: r.ledger, modalityManifests: { verified: r.modalityManifestsVerified, total: r.modalityManifestsTotal },
  runManifests: { verified: r.runManifestsVerified, total: r.runManifestsTotal }, entriesChecked: r.entriesChecked, errorCount: r.errors.length, errors: errs,
  modalityResults: r.modalityResults, runResults: r.runResults }, null, 1));
process.exit(r.ok ? 0 : 1);
