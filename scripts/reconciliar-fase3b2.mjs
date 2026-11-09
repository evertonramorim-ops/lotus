#!/usr/bin/env node
/**
 * Reconciliação XLSX × JSON (Fase 3b.2). Coleta CONTROLADA e reconciliação offline.
 *   --private DIR        armazenamento privado (fora do Git)
 *   --plan FILE          JSON [{lottery, contest|null, justification}] (contest null = endpoint "último")
 *   --fetch              executa os GETs (sem esta flag só reconcilia o que já está salvo)
 *   --max N              teto de requisições: inteiro 1..50 (padrão 50; teto absoluto 50 imposto no código)
 *   --delay-ms MS        espaçamento entre requisições: inteiro ≥ 6000 (padrão 6000)
 *   --extra-json DIR     amostras JSON já coletadas na Fase 3b.1 (reutilizadas sem nova requisição)
 *   --out DIR            grava o relatório offline em DIR (fora do armazenamento privado); padrão: DIR_PRIVADO/reconciliation
 * Para em 403, 429, PRIMEIRO 5xx, 3xx, erro de rede, resposta não-JSON (desafio) ou corpo acima de MAX_BODY_BYTES.
 * Sem repetição automática. Opções e PLANO inválidos são rejeitados antes de qualquer GET (validatePlan).
 * Todo GET é registrado em request_log.jsonl. Caminhos vindos de plano/log são validados (safeRelativePath) e TODA
 * leitura/escrita passa pelo confinamento real (store.js: lstat por componente, O_NOFOLLOW, /proc/self/fd no Linux):
 * nenhuma leitura fora de --private/--extra-json e nenhuma escrita fora de --private/--out; links simbólicos recusados.
 * Execução usada na reconciliação: a NEW idêntica ao último manifesto de execução do ledger revalidado (selectLatestRun),
 * nunca a "última" por nome de pasta ou createdAt.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { summarize, FIELD_CORRESPONDENCE, RECONCILIATION_SCHEMA, RECONCILIATION_VERSION } from '../src/historical/reconcile.js';
import { reconcileSample, collectSamples, buildXlsxRecordIndex, PROVENANCE } from '../src/historical/reconcile-sample.js';
import { writeOnceConfined, writeJsonOnceConfined, appendConfined, readConfined, existsConfined, listDirConfined, ConfinementError } from '../src/historical/store.js';
import { selectLatestRun } from '../src/historical/manifests.js';
import { parseFetchOptions, runControlledFetch, FetchOptionError, validatePlan } from '../src/historical/reconcile-fetch.js';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
let OPTS;
try { OPTS = parseFetchOptions(process.argv.slice(2)); } catch (e) { if (e instanceof FetchOptionError) { console.error(`RECUSADO (${e.code}): ${e.message}`); process.exit(2); } throw e; }
if (!arg('--private')) { console.error('uso: --private DIR [--plan FILE --fetch] [--extra-json DIR]'); process.exit(2); }
const priv = resolve(arg('--private'));
const UA = 'LOTUS-research/0.1 (personal non-commercial research; github.com/evertonramorim-ops/lotus)';
const BASE = 'https://servicebus3.caixa.gov.br/portaldeloterias/api';
const sha = b => createHash('sha256').update(b).digest('hex');
const brt = d => new Date(d.getTime() - 3 * 3600000).toISOString().replace('Z', '-03:00');

if (process.argv.includes('--fetch')) {
  let r; let plan;
  try { if (!arg('--plan')) throw new FetchOptionError('PLANO_INVALIDO', '--plan obrigatório com --fetch'); plan = validatePlan(JSON.parse(readFileSync(arg('--plan'), 'utf8'))); }
  catch (e) { console.error(`RECUSADO (${e instanceof FetchOptionError ? e.code : e instanceof SyntaxError ? 'PLANO_NAO_JSON' : 'PLANO_ILEGIVEL'}): ${e.message}`); process.exit(2); }
  try {
    r = await runControlledFetch({ plan, options: OPTS, fetchImpl: (u, o) => fetch(u, { ...o, signal: AbortSignal.timeout(30000) }), sleep: ms => new Promise(res => setTimeout(res, ms)),
      headers: { 'User-Agent': UA, Accept: 'application/json' }, urlFor: item => `${BASE}/${item.lottery}${item.contest === null ? '' : `/${item.contest}`}`,
      onResponse: ({ n, item, url, status, contentType, body, error, stop }) => {
        const t = new Date(); const buf = Buffer.from(body); const h = sha(buf); const file = status === 200 && !stop ? `json/${item.lottery}/${item.contest ?? 'latest'}-${h}.json` : null;
        if (file) writeOnceConfined(priv, file, buf, { prefix: 'json/' });
        appendConfined(priv, 'request_log.jsonl', JSON.stringify({ n, utc: t.toISOString(), brt: brt(t), method: 'GET', url, status, contentType, bytes: buf.length, sha256: h, file, error, stop, justification: item.justification, ua: UA }) + '\n');
        console.log(`#${n} ${status ?? 'ERRO'} ${url} ${buf.length}B${stop ? ' PARADA:' + stop : ''}`);
      } });
  } catch (e) { if (e instanceof FetchOptionError) { console.error(`RECUSADO (${e.code}): ${e.message}`); process.exit(2); } throw e; }
  console.error(`requisições: ${r.requests}; parada: ${r.stoppedBy ?? 'nenhuma'}`);
}

// ---------- reconciliação offline ----------
const refuse = (code, msg, extra) => { console.error(`RECUSADO (${code}): ${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}`); process.exit(8); };
const guard = (f, what) => { try { return f(); } catch (e) { if (e instanceof ConfinementError) refuse('CAMINHO_RECUSADO', `${what}: ${e.code}`, { rel: e.rel }); throw e; } };
const readText = (root, rel, opt) => readConfined(root, rel, opt).toString('utf8');
const runDirs = guard(() => listDirConfined(priv, 'runs'), 'runs').filter(d => /^import-[0-9TZ]+$/.test(d));
const runFiles = runDirs.map(runId => ({ runId, runManifestFile: guard(() => (existsConfined(priv, `runs/${runId}/run-manifest.json`) ? JSON.parse(readText(priv, `runs/${runId}/run-manifest.json`)) : null), 'run-manifest') }));
const selection = selectLatestRun({ ledgerText: guard(() => readText(priv, 'ledger/manifests.jsonl'), 'ledger'), runs: runFiles });
if (!selection.ok) refuse('EXECUCAO_NAO_SELECIONAVEL', selection.reason, { candidates: selection.candidates ?? null });
const lastRun = selection.runId;
const records = {}; const meta = {};
for (const l of ['megasena', 'lotofacil', 'quina', 'lotomania']) {
  const d = `runs/${lastRun}/${l}`;
  const acc = guard(() => readText(priv, `${d}/accepted-records.jsonl`), 'registros aceitos').split('\n').filter(Boolean).map(x => JSON.parse(x));
  const q = JSON.parse(guard(() => readText(priv, `${d}/quarantine.json`), 'quarentena'));
  // aceito único nunca é substituído por candidato em quarentena; ambiguidade preservada (buildXlsxRecordIndex)
  records[l] = buildXlsxRecordIndex({ acceptedRecords: acc, quarantine: q });
  const rep = JSON.parse(guard(() => readText(priv, `${d}/import-report.json`), 'relatório de importação'));
  meta[l] = { lastContest: rep.coverage.lastContest, xlsxObservedAt: rep.file.collectedAt };
}
const extra = arg('--extra-json') ? resolve(arg('--extra-json')) : null;
const { samples, rejected } = collectSamples({ privateLogText: guard(() => (existsConfined(priv, 'request_log.jsonl') ? readText(priv, 'request_log.jsonl') : ''), 'request_log'), extraLogText: extra ? guard(() => readText(extra, 'request_log.jsonl'), 'log da Fase 3b.1') : null });
if (rejected.length) console.error(`linhas de log recusadas (caminho/URL/timestamp inválidos): ${JSON.stringify(rejected)}`);
const out = []; const quarantine = []; const allRows = []; const rejectedFiles = [];
for (const s0 of samples) {
  const { relFile, root, ...s } = s0;
  let bytes;
  // leitura confinada: link simbólico (intermediário ou final) ou arquivo trocado → amostra recusada com motivo, demais seguem
  try { bytes = new Uint8Array(readConfined(root === 'extra' ? extra : priv, relFile, { prefix: root === 'extra' ? 'raw/' : 'json/' })); }
  catch (e) { if (e instanceof ConfinementError) { rejectedFiles.push({ origin: s.origin, url: s.url, reason: e.code }); continue; } throw e; }
  // proveniência conferida (hash/tamanho/status do log) e UTF-8 estrito ANTES do parse; classificação em função pura
  const r = reconcileSample({ sample: s, bytes, xlsxRecords: records[s.lottery], meta: meta[s.lottery] });
  allRows.push(...r.rows); if (r.quarantine) quarantine.push(r.quarantine); out.push(r.entry);
}
if (rejectedFiles.length) console.error(`amostras recusadas pelo confinamento: ${JSON.stringify(rejectedFiles)}`);
const report = { schema: RECONCILIATION_SCHEMA, schemaVersion: RECONCILIATION_VERSION, importRun: lastRun, importRunSelection: { rule: 'NEW_IDENTICA_AO_ULTIMO_MANIFESTO_DE_EXECUCAO_DO_LEDGER', sequence: selection.sequence, rootHash: selection.rootHash }, rejectedLogLines: rejected, rejectedSampleFiles: rejectedFiles, fieldCorrespondence: FIELD_CORRESPONDENCE, samples: out.length, byLottery: Object.fromEntries(['megasena', 'lotofacil', 'quina', 'lotomania'].map(l => [l, { samples: out.filter(o => o.lottery === l).length, classes: summarize(out.filter(o => o.lottery === l && o.rows).flatMap(o => o.rows)) }])), classes: summarize(allRows), divergences: quarantine.length, provenance: provSummary(out), results: out };
function provSummary(o) { const c = {}; for (const e of o) { const st = e.provenance ? e.provenance.status : 'NAO_CONFERIDA'; c[st] = (c[st] || 0) + 1; }
  return { counts: c, rejected: o.filter(e => e.provenance && e.provenance.status === PROVENANCE.REJEITADA).map(e => ({ lottery: e.lottery, url: e.url, origin: e.origin, reasons: e.provenance.reasons, loggedSha256: e.provenance.loggedSha256, computedSha256: e.provenance.computedSha256, loggedBytes: e.provenance.loggedBytes, observedBytes: e.provenance.observedBytes })) }; }
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const outDir = arg('--out') ? resolve(arg('--out')) : null; const outRoot = outDir ?? priv; const outPrefix = outDir ? '' : 'reconciliation/';
guard(() => writeJsonOnceConfined(outRoot, `${outPrefix}reconciliation-${stamp}.json`, report), 'saída');
guard(() => writeJsonOnceConfined(outRoot, `${outPrefix}quarantine-divergencias-${stamp}.json`, quarantine), 'saída');
console.log(JSON.stringify({ file: `reconciliation-${stamp}.json`, importRun: lastRun, importRunSequence: selection.sequence, samples: out.length, rejectedLogLines: rejected.length, rejectedSampleFiles: rejectedFiles.length, byLottery: report.byLottery, classes: report.classes, divergences: quarantine.map(q => ({ lottery: q.candidate.lottery, contest: q.candidate.contest, fields: q.reasons.map(r => r.message) })), statusCounts: summarize(out.map(o => ({ class: o.status ?? o.xlsxStatus }))), provenance: report.provenance.counts, provenanceRejected: report.provenance.rejected.length }, null, 2));
