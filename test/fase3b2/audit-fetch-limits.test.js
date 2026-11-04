// SYNTHETIC_DATA — auditoria: limites rígidos da coleta JSON (offline; fetch e sleep simulados, nenhuma chamada real).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFetchOptions, runControlledFetch, stopReason, HARD_MAX_REQUESTS, MIN_DELAY_MS, DEFAULTS, FetchOptionError } from '../../src/historical/reconcile-fetch.js';

const SCRIPT = fileURLToPath(new URL('../../scripts/reconciliar-fase3b2.mjs', import.meta.url));
const json = body => ({ status: 200, headers: { get: () => 'application/json' }, arrayBuffer: async () => new TextEncoder().encode(body).buffer });
const resp = (status, ctype = 'application/json', body = '{}') => ({ status, headers: { get: () => ctype }, arrayBuffer: async () => new TextEncoder().encode(body).buffer });
function mock(responder) { const calls = []; const sleeps = []; return { calls, sleeps, fetchImpl: async (u, o) => { calls.push(u); return responder(calls.length, u, o); }, sleep: async ms => { sleeps.push(ms); } }; }
const plan = n => Array.from({ length: n }, (_, i) => ({ lottery: 'megasena', contest: i + 1, justification: 'SYNTHETIC_DATA' }));
const urlFor = it => `https://synthetic.invalid/api/${it.lottery}/${it.contest}`;

test('opções: --max 51, 500, NaN, 0, -1, 1.5, vazio, Infinity, 1e1, 0x10 rejeitados', () => {
  for (const v of ['51', '500', 'NaN', '0', '-1', '1.5', '', 'Infinity', '1e1', '0x10', ' 5', '50.0']) assert.throws(() => parseFetchOptions(['--max', v]), FetchOptionError, `--max ${JSON.stringify(v)}`);
  assert.throws(() => parseFetchOptions(['--max']), FetchOptionError);
  assert.throws(() => parseFetchOptions(['--max=51']), FetchOptionError);
  assert.throws(() => parseFetchOptions(['--max', '10', '--max', '60']), FetchOptionError);
});

test('opções: --delay-ms 5999, 0, NaN, -6000, 6000.5, Infinity, vazio rejeitados', () => {
  for (const v of ['5999', '0', 'NaN', '-6000', '6000.5', 'Infinity', '', '6e3']) assert.throws(() => parseFetchOptions(['--delay-ms', v]), FetchOptionError, `--delay-ms ${JSON.stringify(v)}`);
});

test('opções omitidas → padrões seguros (max 50, delay 6000); válidos aceitos', () => {
  assert.deepEqual({ ...parseFetchOptions([]) }, { max: 50, delayMs: 6000 });
  assert.deepEqual({ ...DEFAULTS }, { max: HARD_MAX_REQUESTS, delayMs: MIN_DELAY_MS });
  assert.equal(HARD_MAX_REQUESTS, 50); assert.equal(MIN_DELAY_MS, 6000);
  assert.deepEqual({ ...parseFetchOptions(['--max', '1', '--delay-ms', '6000']) }, { max: 1, delayMs: 6000 });
  assert.deepEqual({ ...parseFetchOptions(['--max=50', '--delay-ms=10000']) }, { max: 50, delayMs: 10000 });
});

test('script: opção inválida é recusada ANTES de qualquer GET (exit 2, sem ler plano nem rede)', () => {
  for (const args of [['--max', '51'], ['--max', '500'], ['--max', 'NaN'], ['--delay-ms', '5999'], ['--delay-ms', '0'], ['--delay-ms', 'NaN']]) {
    const r = spawnSync(process.execPath, [SCRIPT, '--fetch', ...args, '--private', '/nonexistent-SYNTHETIC', '--plan', '/nonexistent-SYNTHETIC/plan.json'], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' }, timeout: 20000 });
    assert.equal(r.status, 2, args.join(' ') + r.stderr);
    assert.match(r.stderr, /RECUSADO/);
    assert.doesNotMatch(r.stdout, /#1 /);
  }
});

test('runControlledFetch: opções inválidas passadas diretamente também rejeitadas sem GET', async () => {
  for (const options of [{ max: 51, delayMs: 6000 }, { max: NaN, delayMs: 6000 }, { max: 10, delayMs: 5999 }, { max: 10, delayMs: NaN }, { max: Infinity, delayMs: 6000 }, { max: 10, delayMs: Infinity }, { max: 0, delayMs: 6000 }, { max: 2.5, delayMs: 6000 }]) {
    const m = mock(() => json('{}'));
    await assert.rejects(runControlledFetch({ plan: plan(3), urlFor, ...m, options }), FetchOptionError);
    assert.equal(m.calls.length, 0);
  }
});

test('plano maior que o teto é recusado sem GET; nenhuma execução passa de 50', async () => {
  const m = mock(() => json('{}'));
  await assert.rejects(runControlledFetch({ plan: plan(51), urlFor, ...m, options: { max: 50, delayMs: 6000 } }), /excede o teto/);
  await assert.rejects(runControlledFetch({ plan: plan(500), urlFor, ...m, options: { max: 50, delayMs: 6000 } }), /excede o teto/);
  assert.equal(m.calls.length, 0);
  const m2 = mock(() => json('{}'));
  const r = await runControlledFetch({ plan: plan(50), urlFor, ...m2, options: { max: 50, delayMs: 6000 } });
  assert.equal(r.requests, 50); assert.equal(m2.calls.length, 50); assert.ok(m2.calls.length <= HARD_MAX_REQUESTS);
  assert.equal(m2.sleeps.length, 49); assert.ok(m2.sleeps.every(s => s >= 6000));
  const m3 = mock(() => json('{}'));
  await runControlledFetch({ plan: plan(5), urlFor, ...m3, options: { max: 5, delayMs: 7000 } });
  assert.equal(m3.calls.length, 5); assert.deepEqual(m3.sleeps, [7000, 7000, 7000, 7000]);
});

test('parada: 403 e 429 interrompem na primeira ocorrência', async () => {
  for (const st of [403, 429]) {
    const m = mock(n => (n === 2 ? resp(st) : json('{}')));
    const r = await runControlledFetch({ plan: plan(10), urlFor, ...m, options: DEFAULTS });
    assert.equal(r.requests, 2); assert.equal(m.calls.length, 2); assert.equal(r.stoppedBy, `HTTP_${st}`);
  }
});

test('parada: primeiro 5xx interrompe (sem retentativa); erro de rede, 3xx e 200 não-JSON também', async () => {
  for (const st of [500, 502, 503, 599]) {
    const m = mock(n => (n === 1 ? resp(st) : json('{}')));
    const r = await runControlledFetch({ plan: plan(10), urlFor, ...m, options: DEFAULTS });
    assert.equal(m.calls.length, 1); assert.equal(r.stoppedBy, 'HTTP_5XX');
    assert.equal(new Set(m.calls).size, m.calls.length, 'sem repetição da mesma URL');
  }
  const net = mock(() => { throw new Error('ECONNRESET (simulado)'); });
  assert.equal((await runControlledFetch({ plan: plan(10), urlFor, ...net, options: DEFAULTS })).stoppedBy, 'ERRO_DE_REDE'); assert.equal(net.calls.length, 1);
  const red = mock(() => resp(302, 'text/html', '<html>'));
  assert.equal((await runControlledFetch({ plan: plan(10), urlFor, ...red, options: DEFAULTS })).stoppedBy, 'HTTP_3XX_REDIRECIONAMENTO');
  const html = mock(() => resp(200, 'text/html', '<html>desafio</html>'));
  assert.equal((await runControlledFetch({ plan: plan(10), urlFor, ...html, options: DEFAULTS })).stoppedBy, 'RESPOSTA_NAO_JSON'); assert.equal(html.calls.length, 1);
  assert.equal(stopReason({ status: 404, error: null, isJson: true }), null);
});

test('propriedade: para qualquer plano ≤50 e respostas aleatórias, requisições ≤ 50 e ≤ tamanho do plano', async () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (let k = 0; k < 200; k++) {
    const size = 1 + Math.floor(rnd() * 50); const max = size + Math.floor(rnd() * (51 - size));
    const m = mock(() => { const x = rnd(); return x < 0.02 ? resp(503) : x < 0.03 ? resp(429) : json('{}'); });
    const r = await runControlledFetch({ plan: plan(size), urlFor, ...m, options: { max, delayMs: 6000 } });
    assert.ok(m.calls.length <= HARD_MAX_REQUESTS && m.calls.length <= size && r.requests === m.calls.length);
  }
});
