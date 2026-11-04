/**
 * Coleta JSON CONTROLADA para a reconciliação (Fase 3b.2 — correção de auditoria).
 * Limites impostos PELO CÓDIGO (não pela disciplina do operador):
 *  - teto absoluto HARD_MAX_REQUESTS = 50 requisições por execução (inclusive se o chamador pedir mais);
 *  - --max: inteiro decimal 1..50; --delay-ms: inteiro decimal ≥ 6000; qualquer outro valor
 *    (negativo, zero, decimal, vazio, NaN, Infinity, notação exponencial, hex) é REJEITADO antes de qualquer GET;
 *  - parada imediata em 403, 429, primeira resposta 5xx, qualquer 3xx, erro de rede/timeout e 200 não-JSON;
 *  - sem repetição automática: cada item do plano gera no máximo uma requisição.
 * `fetchImpl` e `sleep` são injetáveis para testes offline.
 * @module historical/reconcile-fetch
 */
export const HARD_MAX_REQUESTS = 50;
export const MIN_DELAY_MS = 6000;
export const DEFAULTS = Object.freeze({ max: HARD_MAX_REQUESTS, delayMs: MIN_DELAY_MS });

export class FetchOptionError extends Error { constructor(code, message) { super(message); this.code = code; } }

const strictInt = (raw, name) => {
  if (typeof raw !== 'string' || !/^[0-9]{1,9}$/.test(raw)) throw new FetchOptionError('OPCAO_INVALIDA', `${name} inválido: ${JSON.stringify(raw)} (exige inteiro decimal)`);
  return Number(raw);
};

/** Interpreta --max / --delay-ms de argv. Lança FetchOptionError para qualquer valor fora da política. */
export function parseFetchOptions(argv) {
  const out = { ...DEFAULTS };
  const get = flag => {
    const idx = argv.findIndex(a => a === flag || a.startsWith(flag + '='));
    if (idx < 0) return undefined;
    if (argv.slice(idx + 1).some(a => a === flag || a.startsWith(flag + '='))) throw new FetchOptionError('OPCAO_REPETIDA', `${flag} repetido`);
    const a = argv[idx];
    if (a.includes('=')) return a.slice(flag.length + 1);
    const v = argv[idx + 1];
    return v === undefined || v.startsWith('--') ? '' : v;
  };
  const m = get('--max'); const d = get('--delay-ms');
  if (m !== undefined) { const n = strictInt(m, '--max'); if (n < 1 || n > HARD_MAX_REQUESTS) throw new FetchOptionError('MAX_FORA_DO_LIMITE', `--max deve estar entre 1 e ${HARD_MAX_REQUESTS} (recebido ${m})`); out.max = n; }
  if (d !== undefined) { const n = strictInt(d, '--delay-ms'); if (n < MIN_DELAY_MS) throw new FetchOptionError('DELAY_ABAIXO_DO_MINIMO', `--delay-ms deve ser ≥ ${MIN_DELAY_MS} (recebido ${d})`); out.delayMs = n; }
  return Object.freeze(out);
}

/** Decide se a resposta encerra a execução. @returns {string|null} motivo de parada */
export function stopReason({ status, error, isJson }) {
  if (error) return 'ERRO_DE_REDE';
  if (status === 403) return 'HTTP_403';
  if (status === 429) return 'HTTP_429';
  if (status >= 500 && status <= 599) return 'HTTP_5XX';
  if (status >= 300 && status <= 399) return 'HTTP_3XX_REDIRECIONAMENTO';
  if (status === 200 && !isJson) return 'RESPOSTA_NAO_JSON';
  return null;
}

/**
 * Executa o plano sob os limites. Nunca executa mais que min(max, HARD_MAX_REQUESTS) requisições.
 * @param {{plan:object[], urlFor:(item)=>string, fetchImpl:Function, sleep:(ms)=>Promise, options:{max:number,delayMs:number}, headers?:object, onResponse?:Function}} p
 * @returns {Promise<{requests:number, stoppedBy:string|null, planSize:number, refused:boolean}>}
 */
export async function runControlledFetch({ plan, urlFor, fetchImpl, sleep, options, headers = {}, onResponse = () => {} }) {
  if (!options || !Number.isSafeInteger(options.max) || options.max < 1 || options.max > HARD_MAX_REQUESTS) throw new FetchOptionError('MAX_FORA_DO_LIMITE', 'max inválido');
  if (!Number.isSafeInteger(options.delayMs) || options.delayMs < MIN_DELAY_MS) throw new FetchOptionError('DELAY_ABAIXO_DO_MINIMO', 'delayMs inválido');
  if (!Array.isArray(plan)) throw new FetchOptionError('PLANO_INVALIDO', 'plano deve ser lista');
  const ceiling = Math.min(options.max, HARD_MAX_REQUESTS);
  if (plan.length > ceiling) throw new FetchOptionError('PLANO_EXCEDE_TETO', `plano (${plan.length}) excede o teto ${ceiling}`);
  let requests = 0; let stoppedBy = null;
  for (const item of plan) {
    if (requests >= ceiling) { stoppedBy = 'TETO_ATINGIDO'; break; }
    if (requests > 0) await sleep(options.delayMs);
    const url = urlFor(item); requests++;
    let status = null, body = new Uint8Array(0), contentType = null, error = null;
    try { const res = await fetchImpl(url, { headers, redirect: 'manual' }); status = res.status; contentType = res.headers.get('content-type'); body = new Uint8Array(await res.arrayBuffer()); }
    catch (e) { error = String((e && e.message) || e); }
    const isJson = /json/i.test(contentType ?? '') && body.length > 0 && body[0] === 0x7b;
    const reason = stopReason({ status, error, isJson });
    await onResponse({ n: requests, item, url, status, contentType, body, error, stop: reason });
    if (reason) { stoppedBy = reason; break; }
  }
  return { requests, stoppedBy, planSize: plan.length, refused: false };
}
