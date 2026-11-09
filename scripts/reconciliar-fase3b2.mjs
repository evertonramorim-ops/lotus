#!/usr/bin/env node
/**
 * Reconciliação XLSX × JSON (Fase 3b.2). Coleta CONTROLADA e reconciliação offline.
 *   --private DIR        armazenamento privado (fora do Git)
 *   --plan FILE          JSON [{lottery, contest|null, justification}] (contest null = endpoint "último")
 *   --fetch              executa os GETs (sem esta flag só reconcilia o que já está salvo)
 *   --max N              teto de requisições: inteiro 1..50 (padrão 50; teto absoluto 50 imposto no código)
 *   --delay-ms MS        espaçamento entre requisições: inteiro ≥ 6000 (padrão 6000)
 *   --extra-json DIR     amostras JSON já coletadas na Fase 3b.1 (reutilizadas sem nova requisição)
 * Para em 403, 429, PRIMEIRO 5xx, 3xx, erro de rede, resposta não-JSON (desafio) ou corpo acima de MAX_BODY_BYTES.
 * Sem repetição automática. Opções e PLANO inválidos são rejeitados antes de qualquer GET (validatePlan).
 * Todo GET é registrado em request_log.jsonl. Caminhos vindos de plano/log são validados (safeRelativePath/safeJoin):
 * nenhuma leitura fora de --private/--extra-json e nenhuma escrita fora de --private.
 */
import { readFileSync, readdirSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { summarize, FIELD_CORRESPONDENCE, RECONCILIATION_SCHEMA, RECONCILIATION_VERSION } from '../src/historical/reconcile.js';
import { reconcileSample, collectSamples, buildXlsxRecordIndex, PROVENANCE } from '../src/historical/reconcile-sample.js';
import { writeOnce, writeJsonOnce, privatePaths, safeJoin } from '../src/historical/store.js';
import { parseFetchOptions, runControlledFetch, FetchOptionError, validatePlan } from '../src/historical/reconcile-fetch.js';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
let OPTS;
try { OPTS = parseFetchOptions(process.argv.slice(2)); } catch (e) { if (e instanceof FetchOptionError) { console.error(`RECUSADO (${e.code}): ${e.message}`); process.exit(2); } throw e; }
if (!arg('--private')) { console.error('uso: --private DIR [--plan FILE --fetch] [--extra-json DIR]'); process.exit(2); }
const priv = resolve(arg('--private')); const P = privatePaths(priv);
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
        if (file) writeOnce(safeJoin(priv, file, { prefix: 'json/' }), buf);
        appendFileSync(P.requestLog, JSON.stringify({ n, utc: t.toISOString(), brt: brt(t), method: 'GET', url, status, contentType, bytes: buf.length, sha256: h, file, error, stop, justification: item.justification, ua: UA }) + '\n');
        console.log(`#${n} ${status ?? 'ERRO'} ${url} ${buf.length}B${stop ? ' PARADA:' + stop : ''}`);
      } });
  } catch (e) { if (e instanceof FetchOptionError) { console.error(`RECUSADO (${e.code}): ${e.message}`); process.exit(2); } throw e; }
  console.error(`requisições: ${r.requests}; parada: ${r.stoppedBy ?? 'nenhuma'}`);
}

// ---------- reconciliação offline ----------
const runs = readdirSync(P.runs).filter(d => d.startsWith('import-')).sort();
const lastRun = runs.filter(r => JSON.parse(readFileSync(join(P.runs, r, 'run-manifest.json'), 'utf8')).action === 'NEW').pop();
const records = {}; const meta = {};
for (const l of ['megasena', 'lotofacil', 'quina', 'lotomania']) {
  const d = join(P.runs, lastRun, l);
  const acc = readFileSync(join(d, 'accepted-records.jsonl'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));
  const q = JSON.parse(readFileSync(join(d, 'quarantine.json'), 'utf8'));
  // aceito único nunca é substituído por candidato em quarentena; ambiguidade preservada (buildXlsxRecordIndex)
  records[l] = buildXlsxRecordIndex({ acceptedRecords: acc, quarantine: q });
  const rep = JSON.parse(readFileSync(join(d, 'import-report.json'), 'utf8'));
  meta[l] = { lastContest: rep.coverage.lastContest, xlsxObservedAt: rep.file.collectedAt };
}
const extra = arg('--extra-json') ? resolve(arg('--extra-json')) : null;
const { samples, rejected } = collectSamples({ privateLogText: existsSync(P.requestLog) ? readFileSync(P.requestLog, 'utf8') : '', extraLogText: extra ? readFileSync(join(extra, 'request_log.jsonl'), 'utf8') : null });
if (rejected.length) console.error(`linhas de log recusadas (caminho/URL inválidos): ${JSON.stringify(rejected)}`);
for (const s of samples) s.file = safeJoin(s.root === 'extra' ? extra : priv, s.relFile, { prefix: s.root === 'extra' ? 'raw/' : 'json/' });
const out = []; const quarantine = []; const allRows = [];
for (const s0 of samples) {
  const { relFile, root, ...s } = s0; void relFile; void root;
  const bytes = new Uint8Array(readFileSync(s.file));
  // proveniência conferida (hash/tamanho/status do log) ANTES do parse; classificação em função pura (reconcile-sample.js)
  const r = reconcileSample({ sample: s, bytes, xlsxRecords: records[s.lottery], meta: meta[s.lottery] });
  allRows.push(...r.rows); if (r.quarantine) quarantine.push(r.quarantine); out.push(r.entry);
}
const report = { schema: RECONCILIATION_SCHEMA, schemaVersion: RECONCILIATION_VERSION, importRun: lastRun, rejectedLogLines: rejected, fieldCorrespondence: FIELD_CORRESPONDENCE, samples: out.length, byLottery: Object.fromEntries(['megasena', 'lotofacil', 'quina', 'lotomania'].map(l => [l, { samples: out.filter(o => o.lottery === l).length, classes: summarize(out.filter(o => o.lottery === l && o.rows).flatMap(o => o.rows)) }])), classes: summarize(allRows), divergences: quarantine.length, provenance: provSummary(out), results: out };
function provSummary(o) { const c = {}; for (const e of o) { const st = e.provenance ? e.provenance.status : 'NAO_CONFERIDA'; c[st] = (c[st] || 0) + 1; }
  return { counts: c, rejected: o.filter(e => e.provenance && e.provenance.status === PROVENANCE.REJEITADA).map(e => ({ lottery: e.lottery, url: e.url, origin: e.origin, reasons: e.provenance.reasons, loggedSha256: e.provenance.loggedSha256, computedSha256: e.provenance.computedSha256, loggedBytes: e.provenance.loggedBytes, observedBytes: e.provenance.observedBytes })) }; }
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
mkdirSync(P.reconciliation, { recursive: true });
writeJsonOnce(safeJoin(priv, `reconciliation/reconciliation-${stamp}.json`), report);
writeJsonOnce(safeJoin(priv, `reconciliation/quarantine-divergencias-${stamp}.json`), quarantine);
console.log(JSON.stringify({ file: `reconciliation-${stamp}.json`, samples: out.length, byLottery: report.byLottery, classes: report.classes, divergences: quarantine.map(q => ({ lottery: q.candidate.lottery, contest: q.candidate.contest, fields: q.reasons.map(r => r.message) })), statusCounts: summarize(out.map(o => ({ class: o.status ?? o.xlsxStatus }))), provenance: report.provenance.counts, provenanceRejected: report.provenance.rejected.length }, null, 2));
