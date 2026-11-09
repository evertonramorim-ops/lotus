#!/usr/bin/env node
/**
 * Verificação SOMENTE LEITURA dos manifestos por modalidade contra o CONTEÚDO real armazenado (Fase 3b.2):
 * bytes do XLSX, coleta, relatório, quarentena, duplicatas e cada registro aceito (hash recalculado), além de
 * datasetId, dataSchemaVersion, sequence e encadeamento contra o manifesto anterior do ledger.
 * Não escreve nada, não acessa rede, não reimporta.
 *   node scripts/verificar-manifestos-fase3b2.mjs --private DIR
 * Saída: resumo JSON no stdout (sem caminhos locais). Exit 0 = tudo verificado; 1 = alguma falha.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyModalityManifest } from '../src/historical/manifests.js';
import { privatePaths, safeJoin } from '../src/historical/store.js';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if (!arg('--private')) { console.error('uso: --private DIR'); process.exit(2); }
const priv = resolve(arg('--private')); const P = privatePaths(priv);
const J = rel => JSON.parse(readFileSync(safeJoin(priv, rel), 'utf8'));
const ledger = readFileSync(safeJoin(priv, 'ledger/manifests.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const out = []; let fail = 0;
for (const run of readdirSync(P.runs).filter(d => /^import-[0-9TZ]+$/.test(d)).sort()) {
  const rm = J(`runs/${run}/run-manifest.json`);
  for (const l of ['megasena', 'lotofacil', 'quina', 'lotomania']) {
    const dir = `runs/${run}/${l}`; if (!existsSync(safeJoin(priv, dir))) continue;
    const mf = J(`${dir}/manifest.json`); const manifest = mf.manifest; // arquivo: {action, manifest}
    // localiza o XLSX bruto pelo sha declarado na entrada file:; o sha é REVERIFICADO contra os bytes e a coleta
    const fe = manifest.entries.filter(e => e.kind === 'file' && new RegExp(`^file:${l}:[0-9a-f]{64}$`).test(e.id));
    if (fe.length !== 1) { fail++; out.push({ run, lottery: l, ok: false, errors: [`FILE_ENTRY_COUNT_${fe.length}`] }); continue; }
    const sha = fe[0].id.split(':')[2];
    const collection = J(`raw/${l}/${sha}.collection.json`);
    const bytes = new Uint8Array(readFileSync(safeJoin(priv, `raw/${l}/${sha}.xlsx`)));
    const imp = { report: J(`${dir}/import-report.json`), quarantine: J(`${dir}/quarantine.json`), duplicatesIdentical: J(`${dir}/duplicates-identical.json`),
      accepted: readFileSync(safeJoin(priv, `${dir}/accepted-records.jsonl`), 'utf8').split('\n').filter(Boolean).map(x => ({ record: JSON.parse(x) })) };
    const inLedger = ledger.some(m => m.datasetId === manifest.datasetId && m.sequence === manifest.sequence && m.rootHash === manifest.rootHash);
    const previous = manifest.sequence > 1 ? ledger.find(m => m.datasetId === manifest.datasetId && m.sequence === manifest.sequence - 1) ?? null : null;
    const v = verifyModalityManifest(manifest, imp, collection, bytes, { previous });
    if (!v.ok || !inLedger) fail++;
    out.push({ run, runAction: rm.action, modalityAction: mf.action, lottery: l, datasetId: manifest.datasetId, sequence: manifest.sequence, rootHash: manifest.rootHash, inLedger, ok: v.ok, checked: v.checked, errors: v.errors.map(e => e.code + (e.id ? `:${e.id}` : '')) });
  }
}
console.log(JSON.stringify({ verified: out.length, failed: fail, results: out }, null, 1));
process.exit(fail ? 1 : 0);
