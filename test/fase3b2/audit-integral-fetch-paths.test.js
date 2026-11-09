// SYNTHETIC_DATA — auditoria integral, bloco 7: plano validado antes de qualquer GET, caminhos seguros, limite de corpo HTTP.
// Offline: fetch simulado; scripts executados com fetch global substituído por stub que falha (_no-network.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const F = await import('../../src/historical/reconcile-fetch.js');
const ST = await import('../../src/historical/store.js');
const S = await import('../../src/historical/reconcile-sample.js').catch(() => ({}));

const SCRIPT = fileURLToPath(new URL('../../scripts/reconciliar-fase3b2.mjs', import.meta.url));
const NO_NET = fileURLToPath(new URL('./_no-network.mjs', import.meta.url));
const ok = (o = {}) => ({ lottery: 'quina', contest: 10, justification: 'SYNTHETIC_DATA', ...o });
function mock(responder) { const calls = []; return { calls, fetchImpl: async u => { calls.push(u); return responder(calls.length, u); }, sleep: async () => {} }; }
const stream = (chunks, cl = null) => ({ status: 200, headers: { get: k => (k === 'content-type' ? 'application/json' : k === 'content-length' ? cl : null) }, body: new ReadableStream({ pull(c) { const x = chunks.shift(); if (x) c.enqueue(x); else c.close(); } }) });
const urlFor = it => `https://synthetic.invalid/api/${it.lottery}/${it.contest ?? ''}`;

const BAD_PLANS = [
  ['modalidade não permitida', [ok({ lottery: 'timemania' })]], ['modalidade com traversal', [ok({ lottery: '../megasena' })]], ['modalidade não texto', [ok({ lottery: 7 })]],
  ['contest texto', [ok({ contest: '10' })]], ['contest com caminho', [ok({ contest: '../../x' })]], ['contest negativo', [ok({ contest: -1 })]], ['contest zero', [ok({ contest: 0 })]],
  ['contest fracionário', [ok({ contest: 1.5 })]], ['contest acima do inteiro seguro', [ok({ contest: 2 ** 53 })]], ['contest NaN', [ok({ contest: NaN })]],
  ['propriedade inesperada', [ok({ url: 'https://evil.invalid/' })]], ['propriedade ausente', [{ lottery: 'quina', contest: 1 }]], ['justificativa vazia', [ok({ justification: ' ' })]],
  ['justificativa longa', [ok({ justification: 'x'.repeat(501) })]], ['justificativa com controle', [ok({ justification: 'a\nb' })]], ['justificativa não texto', [ok({ justification: 5 })]],
  ['item não objeto', ['quina/10']], ['item array', [['quina', 10]]], ['item nulo', [null]], ['item repetido', [ok(), ok()]], ['plano não lista', { a: 1 }],
  ['inválido só no fim (nenhum GET antes)', [ok({ contest: 1 }), ok({ contest: 2 }), ok({ lottery: 'x' })]],
];

test('7.1: plano inválido recusado por inteiro ANTES de qualquer GET (runControlledFetch)', async () => {
  for (const [name, plan] of BAD_PLANS) {
    const m = mock(() => { throw new Error('não deveria chamar'); });
    await assert.rejects(F.runControlledFetch({ plan, urlFor, ...m, options: F.DEFAULTS }), e => e instanceof F.FetchOptionError && e.code === 'PLANO_INVALIDO', name);
    assert.equal(m.calls.length, 0, name);
  }
  const v = F.validatePlan([ok(), ok({ contest: null, lottery: 'megasena' })]); assert.ok(Object.isFrozen(v) && Object.isFrozen(v[0])); assert.deepEqual(v.map(x => x.contest), [10, null]);
});

test('7.1/7.2: script recusa plano adulterado com exit 2, sem GET, sem escrever log nem arquivo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lotus-synth-'));
  for (const [name, plan] of BAD_PLANS.slice(0, 8)) {
    const p = join(dir, 'plan.json'); writeFileSync(p, JSON.stringify(plan));
    const r = spawnSync(process.execPath, ['--import', NO_NET, SCRIPT, '--fetch', '--private', dir, '--plan', p], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' }, timeout: 20000 });
    assert.equal(r.status, 2, `${name}: ${r.stderr}`); assert.match(r.stderr, /RECUSADO \(PLANO_INVALIDO\)/, name); assert.doesNotMatch(r.stdout, /#1 /);
    assert.equal(existsSync(join(dir, 'request_log.jsonl')), false, name); assert.equal(existsSync(join(dir, 'json')), false, name);
  }
  const p = join(dir, 'plan.json'); writeFileSync(p, '{não json');
  const r = spawnSync(process.execPath, ['--import', NO_NET, SCRIPT, '--fetch', '--private', dir, '--plan', p], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' }, timeout: 20000 });
  assert.equal(r.status, 2); assert.match(r.stderr, /PLANO_NAO_JSON/);
  const r2 = spawnSync(process.execPath, ['--import', NO_NET, SCRIPT, '--fetch', '--private', dir, '--plan', join(dir, 'inexistente.json')], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' }, timeout: 20000 });
  assert.equal(r2.status, 2); assert.match(r2.stderr, /PLANO_ILEGIVEL/);
});

test('7.2: safeRelativePath/safeJoin recusam "..", absoluto, "\\\\", NUL, ":", segmento vazio e fuga da raiz', () => {
  const root = mkdtempSync(join(tmpdir(), 'lotus-synth-root-'));
  for (const rel of ['../x', 'json/../../x', '/etc/passwd', 'json\\..\\x', 'json/a\0b', 'C:/x', 'json//x', './json/x', 'json/./x', '', 'json/x/..', 5, null]) {
    assert.equal(ST.safeRelativePath(rel).ok, false, JSON.stringify(rel)); assert.throws(() => ST.safeJoin(root, rel), /caminho recusado/, JSON.stringify(rel));
  }
  assert.equal(ST.safeRelativePath('raw/x.json', { prefix: 'json/' }).reason, 'FORA_DO_SUBDIRETORIO_PREVISTO');
  assert.equal(ST.safeJoin(root, 'json/quina/1-ab.json', { prefix: 'json/' }), join(root, 'json/quina/1-ab.json'));
});

test('7.2: log adulterado — linhas com caminho perigoso ou URL estranha são recusadas com motivo e nunca lidas', () => {
  assert.ok(S.collectSamples, 'collectSamples existe');
  const U = l => `https://servicebus3.caixa.gov.br/portaldeloterias/api/${l}`;
  const priv = [
    { n: 1, utc: '2026-01-01T00:00:00Z', url: U('quina/10'), file: 'json/quina/10-aa.json', justification: 'ok' },
    { n: 2, utc: '2026-01-01T00:00:00Z', url: U('quina/11'), file: '../../../etc/passwd' },
    { n: 3, utc: '2026-01-01T00:00:00Z', url: U('quina/12'), file: '/abs/path.json' },
    { n: 4, utc: '2026-01-01T00:00:00Z', url: U('quina/13'), file: 'json/megasena/../../x' },
    { n: 5, utc: '2026-01-01T00:00:00Z', url: U('quina/14'), file: 'raw/fora-do-prefixo.json' },
    { n: 6, utc: '2026-01-01T00:00:00Z', url: 'https://evil.invalid/api/quina/1', file: 'json/quina/1.json' },
    { n: 7, utc: '2026-01-01T00:00:00Z', url: U('timemania/1'), file: 'json/timemania/1.json' },
    { n: 8, utc: '2026-01-01T00:00:00Z', url: U('quina/15'), file: { p: 'x' } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n{quebrada\n';
  const extra = [{ url: U('megasena/1'), status: 200, file: '../../segredo', utc: '2026-01-01T00:00:00Z' }, { url: U('megasena/2'), status: 200, file: 'raw/../x', utc: '2026-01-01T00:00:00Z' }, { url: U('megasena/3'), status: 200, file: 'raw/GET_ok', utc: '2026-01-01T00:00:00Z' }].map(e => JSON.stringify(e)).join('\n');
  const r = S.collectSamples({ privateLogText: priv, extraLogText: extra });
  assert.deepEqual(r.samples.map(s => `${s.root}:${s.relFile}`), ['private:json/quina/10-aa.json', 'extra:raw/GET_ok']);
  for (const s of r.samples) assert.equal(ST.safeRelativePath(s.relFile).ok, true, s.relFile);
  assert.ok(!r.samples.some(s => /\.\.|^\//.test(s.relFile)));
  const reasons = r.rejected.map(x => `${x.origin}:${x.line}:${x.reason}`);
  for (const want of ['FASE3B2:2:SEGMENTO_PROIBIDO_NO_CAMINHO', 'FASE3B2:3:CAMINHO_ABSOLUTO', 'FASE3B2:4:SEGMENTO_PROIBIDO_NO_CAMINHO', 'FASE3B2:5:FORA_DO_SUBDIRETORIO_PREVISTO', 'FASE3B2:6:URL_NAO_RECONHECIDA', 'FASE3B2:7:URL_NAO_RECONHECIDA', 'FASE3B2:8:CAMINHO_INVALIDO', 'FASE3B2:9:LINHA_NAO_JSON', 'FASE3B1:1:SEGMENTO_PROIBIDO_NO_CAMINHO', 'FASE3B1:2:SEGMENTO_PROIBIDO_NO_CAMINHO']) assert.ok(reasons.includes(want), `${want} em ${reasons}`);
  assert.equal(r.samples.filter(s => s.root === 'private').length, 1); assert.equal(r.samples[0].lottery, 'quina', 'modalidade derivada da URL validada');
});

test('7.3: corpo HTTP limitado antes da carga completa — Content-Length e fluxo; parada controlada sem processamento parcial', async () => {
  const big = new Uint8Array(70).fill(0x7b);
  // Content-Length acima do teto: nenhum byte lido
  let pulled = 0; const r1 = { status: 200, headers: { get: k => (k === 'content-length' ? '999' : 'application/json') }, body: new ReadableStream({ pull(c) { pulled++; c.enqueue(big); c.close(); } }) };
  const b1 = await F.readBodyLimited(r1, 64); assert.equal(b1.tooLarge, true); assert.equal(b1.body.length, 0); assert.equal(b1.declared, 999);
  // fluxo sem Content-Length que ultrapassa o teto: para no meio, corpo descartado
  const b2 = await F.readBodyLimited(stream([big.slice(0, 40), big.slice(40), big]), 64); assert.equal(b2.tooLarge, true); assert.equal(b2.body.length, 0);
  const b3 = await F.readBodyLimited(stream([new TextEncoder().encode('{"a":1}')]), 64); assert.equal(b3.tooLarge, false); assert.equal(new TextDecoder().decode(b3.body), '{"a":1}');
  // execução: parada RESPOSTA_GRANDE_DEMAIS, onResponse sem corpo, nenhuma requisição adicional
  const seen = []; const m = mock(() => stream([big, big]));
  const r = await F.runControlledFetch({ plan: [ok({ contest: 1 }), ok({ contest: 2 })], urlFor, ...m, options: F.DEFAULTS, maxBodyBytes: 64, onResponse: o => seen.push(o) });
  assert.equal(r.stoppedBy, 'RESPOSTA_GRANDE_DEMAIS'); assert.equal(m.calls.length, 1); assert.equal(seen[0].body.length, 0); assert.equal(seen[0].tooLarge, true); assert.equal(seen[0].stop, 'RESPOSTA_GRANDE_DEMAIS');
  assert.equal(F.MAX_BODY_BYTES, (await import('../../src/historical/jsonnum.js')).JSON_MAX_BYTES, 'limite coerente com o parser JSON');
});
