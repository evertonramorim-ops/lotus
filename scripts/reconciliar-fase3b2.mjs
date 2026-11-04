#!/usr/bin/env node
/**
 * Reconciliação XLSX × JSON (Fase 3b.2). Coleta CONTROLADA e reconciliação offline.
 *   --private DIR        armazenamento privado (fora do Git)
 *   --plan FILE          JSON [{lottery, contest|null, justification}] (contest null = endpoint "último")
 *   --fetch              executa os GETs (sem esta flag só reconcilia o que já está salvo)
 *   --max N              teto de requisições (padrão 50; recusa plano maior)
 *   --delay-ms MS        espaçamento entre requisições (padrão 6000)
 *   --extra-json DIR     amostras JSON já coletadas na Fase 3b.1 (reutilizadas sem nova requisição)
 * Para em 403/429/5xx repetido ou resposta não-JSON (desafio). Todo GET é registrado em request_log.jsonl.
 */
import { readFileSync, readdirSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { adaptJsonResult, compareRecords, divergenceQuarantine, summarize, FIELD_CORRESPONDENCE, RECONCILIATION_SCHEMA, RECONCILIATION_VERSION } from '../src/historical/reconcile.js';
import { writeOnce, writeJsonOnce, privatePaths } from '../src/historical/store.js';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const priv = resolve(arg('--private')); const P = privatePaths(priv);
const plan = JSON.parse(readFileSync(arg('--plan'), 'utf8'));
const MAX = Number(arg('--max') ?? 50); const DELAY = Number(arg('--delay-ms') ?? 6000);
const UA = 'LOTUS-research/0.1 (personal non-commercial research; github.com/evertonramorim-ops/lotus)';
const BASE = 'https://servicebus3.caixa.gov.br/portaldeloterias/api';
if (plan.length > MAX) { console.error(`plano (${plan.length}) excede o teto ${MAX}`); process.exit(2); }
const sha = b => createHash('sha256').update(b).digest('hex');
const brt = d => new Date(d.getTime() - 3 * 3600000).toISOString().replace('Z', '-03:00');

if (process.argv.includes('--fetch')) {
  let n = 0;
  for (const item of plan) {
    const url = `${BASE}/${item.lottery}${item.contest === null ? '' : `/${item.contest}`}`;
    if (n > 0) await new Promise(r => setTimeout(r, DELAY));
    n++;
    const t = new Date(); let status = null, body = Buffer.alloc(0), ctype = null, err = null;
    try { const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(30000) }); status = res.status; ctype = res.headers.get('content-type'); body = Buffer.from(await res.arrayBuffer()); }
    catch (e) { err = String(e && e.message || e); }
    const h = sha(body); const file = status === 200 ? join('json', item.lottery, `${item.contest ?? 'latest'}-${h}.json`) : null;
    if (file) writeOnce(join(priv, file), body);
    appendFileSync(P.requestLog, JSON.stringify({ n, utc: t.toISOString(), brt: brt(t), method: 'GET', url, status, contentType: ctype, bytes: body.length, sha256: h, file, error: err, justification: item.justification, ua: UA }) + '\n');
    console.log(`#${n} ${status ?? 'ERRO'} ${url} ${body.length}B`);
    const isJson = /json/i.test(ctype ?? '') && body.length && body[0] === 0x7b;
    if (status === 403 || status === 429 || (status === 200 && !isJson)) { console.error(`PARADA: status ${status} / content-type ${ctype} — possível bloqueio/desafio`); break; }
    if (err) { console.error('PARADA: erro de rede', err); break; }
  }
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
