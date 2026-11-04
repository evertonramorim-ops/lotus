#!/usr/bin/env node
/**
 * Reconciliação XLSX × JSON (Fase 3b.2). Coleta CONTROLADA e reconciliação offline.
 *   --private DIR        armazenamento privado (fora do Git)
 *   --plan FILE          JSON [{lottery, contest|null, justification}] (contest null = endpoint "último")
 *   --fetch              executa os GETs (sem esta flag só reconcilia o que já está salvo)
 *   --max N              teto de requisições: inteiro 1..50 (padrão 50; teto absoluto 50 imposto no código)
 *   --delay-ms MS        espaçamento entre requisições: inteiro ≥ 6000 (padrão 6000)
 *   --extra-json DIR     amostras JSON já coletadas na Fase 3b.1 (reutilizadas sem nova requisição)
 * Para em 403, 429, PRIMEIRO 5xx, 3xx, erro de rede ou resposta não-JSON (desafio). Sem repetição automática.
 * Opções inválidas são rejeitadas antes de qualquer GET. Todo GET é registrado em request_log.jsonl.
 */
import { readFileSync, readdirSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { adaptJsonResult, compareRecords, divergenceQuarantine, summarize, FIELD_CORRESPONDENCE, RECONCILIATION_SCHEMA, RECONCILIATION_VERSION } from '../src/historical/reconcile.js';
import { writeOnce, writeJsonOnce, privatePaths } from '../src/historical/store.js';
import { parseFetchOptions, runControlledFetch, FetchOptionError } from '../src/historical/reconcile-fetch.js';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
let OPTS;
try { OPTS = parseFetchOptions(process.argv.slice(2)); } catch (e) { if (e instanceof FetchOptionError) { console.error(`RECUSADO (${e.code}): ${e.message}`); process.exit(2); } throw e; }
const priv = resolve(arg('--private')); const P = privatePaths(priv);
const plan = JSON.parse(readFileSync(arg('--plan'), 'utf8'));
const UA = 'LOTUS-research/0.1 (personal non-commercial research; github.com/evertonramorim-ops/lotus)';
const BASE = 'https://servicebus3.caixa.gov.br/portaldeloterias/api';
const sha = b => createHash('sha256').update(b).digest('hex');
const brt = d => new Date(d.getTime() - 3 * 3600000).toISOString().replace('Z', '-03:00');

if (process.argv.includes('--fetch')) {
  let r;
  try {
    r = await runControlledFetch({ plan, options: OPTS, fetchImpl: (u, o) => fetch(u, { ...o, signal: AbortSignal.timeout(30000) }), sleep: ms => new Promise(res => setTimeout(res, ms)),
      headers: { 'User-Agent': UA, Accept: 'application/json' }, urlFor: item => `${BASE}/${item.lottery}${item.contest === null ? '' : `/${item.contest}`}`,
      onResponse: ({ n, item, url, status, contentType, body, error, stop }) => {
        const t = new Date(); const buf = Buffer.from(body); const h = sha(buf); const file = status === 200 && !stop ? join('json', item.lottery, `${item.contest ?? 'latest'}-${h}.json`) : null;
        if (file) writeOnce(join(priv, file), buf);
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
  const q = JSON.parse(readFileSync(join(d, 'quarantine.json'), 'utf8')).filter(e => e.candidate).map(e => ({ ...e.candidate, __quarantined: true }));
  records[l] = new Map([...acc, ...q].map(r => [r.contest, r]));
  const rep = JSON.parse(readFileSync(join(d, 'import-report.json'), 'utf8'));
  meta[l] = { lastContest: rep.coverage.lastContest, xlsxObservedAt: rep.file.collectedAt };
}
const samples = [];
for (const line of existsSync(P.requestLog) ? readFileSync(P.requestLog, 'utf8').split('\n').filter(Boolean) : []) {
  const e = JSON.parse(line); if (!e.file) continue;
  const lottery = new URL(e.url).pathname.split('/')[3];
  samples.push({ lottery, origin: 'FASE3B2', url: e.url, observedAt: e.utc, file: join(priv, e.file), justification: e.justification });
}
const extra = arg('--extra-json');
if (extra) {
  const log = readFileSync(join(extra, 'request_log.jsonl'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));
  for (const e of log) {
    const m = /^https:\/\/servicebus3\.caixa\.gov\.br\/portaldeloterias\/api\/(megasena|lotofacil|quina|lotomania)\/(\d+)$/.exec(e.url);
    if (!m || e.status !== 200 || !e.file) continue;
    samples.push({ lottery: m[1], origin: 'FASE3B1', url: e.url, observedAt: new Date(e.utc).toISOString(), file: join(extra, e.file.startsWith('raw/') ? e.file : join('raw', e.file.split('/').pop())), justification: 'amostra da Fase 3b.1 (reutilizada, sem nova requisição)' });
  }
}
const out = []; const quarantine = []; const allRows = [];
for (const s of samples) {
  const text = readFileSync(s.file, 'utf8'); const jsonSha256 = sha(Buffer.from(text, 'utf8'));
  let j; try { j = adaptJsonResult(text); } catch (e) { out.push({ ...s, file: undefined, jsonSha256, status: 'JSON_INVALIDO', error: e.message }); continue; }
  if (j.contest === null) { out.push({ ...s, file: undefined, jsonSha256, status: 'JSON_SEM_RESULTADO' }); continue; }
  const x = records[s.lottery].get(j.contest) ?? null;
  const ctx = { xlsxLastContest: meta[s.lottery].lastContest, xlsxObservedAt: meta[s.lottery].xlsxObservedAt, jsonObservedAt: s.observedAt, jsonSha256, jsonUrl: s.url };
  const rows = compareRecords(x, j, ctx); allRows.push(...rows);
  if (x) { const q = divergenceQuarantine(x, j, rows, ctx); if (q) quarantine.push(q); }
  out.push({ lottery: s.lottery, contest: j.contest, origin: s.origin, url: s.url, observedAt: s.observedAt, xlsxObservedAt: ctx.xlsxObservedAt, jsonSha256, xlsxStatus: x ? (x.__quarantined ? 'QUARENTENA' : 'ACEITO') : 'AUSENTE', justification: s.justification, classes: summarize(rows), rows });
}
const report = { schema: RECONCILIATION_SCHEMA, schemaVersion: RECONCILIATION_VERSION, importRun: lastRun, fieldCorrespondence: FIELD_CORRESPONDENCE, samples: out.length, byLottery: Object.fromEntries(['megasena', 'lotofacil', 'quina', 'lotomania'].map(l => [l, { samples: out.filter(o => o.lottery === l).length, classes: summarize(out.filter(o => o.lottery === l && o.rows).flatMap(o => o.rows)) }])), classes: summarize(allRows), divergences: quarantine.length, results: out };
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
mkdirSync(P.reconciliation, { recursive: true });
writeJsonOnce(join(P.reconciliation, `reconciliation-${stamp}.json`), report);
writeJsonOnce(join(P.reconciliation, `quarantine-divergencias-${stamp}.json`), quarantine);
console.log(JSON.stringify({ file: `reconciliation-${stamp}.json`, samples: out.length, byLottery: report.byLottery, classes: report.classes, divergences: quarantine.map(q => ({ lottery: q.candidate.lottery, contest: q.candidate.contest, fields: q.reasons.map(r => r.message) })), statusCounts: summarize(out.map(o => ({ class: o.status ?? o.xlsxStatus }))) }, null, 2));
