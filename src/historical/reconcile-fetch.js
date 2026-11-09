import { JSON_MAX_BYTES } from './jsonnum.js';
/**
 * Coleta JSON CONTROLADA para a reconciliação (Fase 3b.2 — correção de auditoria).
 * Limites impostos PELO CÓDIGO (não pela disciplina do operador):
 *  - teto absoluto HARD_MAX_REQUESTS = 50 requisições por execução (inclusive se o chamador pedir mais);
 *  - --max: inteiro decimal 1..50; --delay-ms: inteiro decimal ≥ 6000; qualquer outro valor
 *    (negativo, zero, decimal, vazio, NaN, Infinity, notação exponencial, hex) é REJEITADO antes de qualquer GET;
 *  - parada imediata em 403, 429, primeira resposta 5xx, qualquer 3xx, erro de rede/timeout e 200 não-JSON;
 *  - sem repetição automática: cada item do plano gera no máximo uma requisição;
 *  - plano validado POR INTEIRO antes do primeiro GET (validatePlan): só {lottery, contest, justification},
 *    modalidade permitida, contest null ou inteiro seguro > 0, justificativa textual limitada; item repetido recusado;
 *    a URL é montada somente a partir do item validado (cópia congelada);
 *  - corpo HTTP limitado a MAX_BODY_BYTES (= limite do parser JSON) ANTES de carregar tudo na memória: Content-Length
 *    acima do limite ou leitura em fluxo que o ultrapassa → parada RESPOSTA_GRANDE_DEMAIS, corpo descartado (nunca
 *    processado como se fosse completo).
 * `fetchImpl` e `sleep` são injetáveis para testes offline.
 * @module historical/reconcile-fetch
 */
export const HARD_MAX_REQUESTS = 50;
export const MIN_DELAY_MS = 6000;
export const DEFAULTS = Object.freeze({ max: HARD_MAX_REQUESTS, delayMs: MIN_DELAY_MS });
export const MAX_BODY_BYTES = JSON_MAX_BYTES;
export const PLAN_LOTTERIES = Object.freeze(['megasena', 'lotofacil', 'quina', 'lotomania']);
export const PLAN_JUSTIFICATION_MAX = 500;
const PLAN_KEYS = ['lottery', 'contest', 'justification'];

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

/**
 * Valida o plano inteiro (sem rede). Lança FetchOptionError('PLANO_INVALIDO', …) com o índice e o motivo.
 * @returns {ReadonlyArray<{lottery:string, contest:number|null, justification:string}>} cópias congeladas
 */
export function validatePlan(plan) {
  if (!Array.isArray(plan)) throw new FetchOptionError('PLANO_INVALIDO', 'plano deve ser lista');
  const seen = new Set();
  return Object.freeze(plan.map((it, i) => {
    const bad = m => { throw new FetchOptionError('PLANO_INVALIDO', `item ${i}: ${m}`); };
    if (it === null || typeof it !== 'object' || Array.isArray(it) || Object.getPrototypeOf(it) !== Object.prototype) bad('item deve ser objeto simples');
    for (const k of Object.keys(it)) if (!PLAN_KEYS.includes(k)) bad(`propriedade inesperada ${JSON.stringify(k)}`);
    for (const k of PLAN_KEYS) if (!Object.prototype.hasOwnProperty.call(it, k)) bad(`propriedade obrigatória ausente ${k}`);
    if (typeof it.lottery !== 'string' || !PLAN_LOTTERIES.includes(it.lottery)) bad(`modalidade não permitida ${JSON.stringify(it.lottery)}`);
    if (!(it.contest === null || (typeof it.contest === 'number' && Number.isSafeInteger(it.contest) && it.contest > 0))) bad(`contest deve ser null ou inteiro seguro > 0 (recebido ${JSON.stringify(it.contest)})`);
    if (typeof it.justification !== 'string' || !it.justification.trim() || it.justification.length > PLAN_JUSTIFICATION_MAX || /[\u0000-\u001f\u007f]/.test(it.justification)) bad(`justificativa deve ser texto de 1..${PLAN_JUSTIFICATION_MAX} caracteres, sem caracteres de controle`);
    const key = `${it.lottery}/${it.contest ?? 'latest'}`; if (seen.has(key)) bad(`item repetido ${key} (sem repetição de requisição)`); seen.add(key);
    return Object.freeze({ lottery: it.lottery, contest: it.contest, justification: it.justification });
  }));
}

/** Lê o corpo com teto de bytes: Content-Length declarado acima do teto ou fluxo que o ultrapassa → {tooLarge:true}, sem corpo. */
export async function readBodyLimited(res, maxBytes = MAX_BODY_BYTES) {
  const cl = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null;
  if (cl !== null && cl !== undefined && /^[0-9]+$/.test(String(cl)) && Number(cl) > maxBytes) { try { if (res.body && res.body.cancel) await res.body.cancel(); } catch { /* descarta */ } return { tooLarge: true, declared: Number(cl), body: new Uint8Array(0) }; }
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader(); const chunks = []; let n = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      n += value.length;
      if (n > maxBytes) { try { await reader.cancel(); } catch { /* descarta */ } return { tooLarge: true, declared: cl === null ? null : Number(cl), body: new Uint8Array(0) }; }
      chunks.push(value);
    }
    const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
    return { tooLarge: false, body: out };
  }
  // Implementação sem fluxo (somente fetch injetado em teste): o teto ainda é aplicado antes de qualquer processamento.
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.length > maxBytes ? { tooLarge: true, declared: null, body: new Uint8Array(0) } : { tooLarge: false, body: buf };
}

/** Decide se a resposta encerra a execução. @returns {string|null} motivo de parada */
export function stopReason({ status, error, isJson, tooLarge = false }) {
  if (error) return 'ERRO_DE_REDE';
  if (tooLarge) return 'RESPOSTA_GRANDE_DEMAIS';
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
export async function runControlledFetch({ plan, urlFor, fetchImpl, sleep, options, headers = {}, onResponse = () => {}, maxBodyBytes = MAX_BODY_BYTES }) {
  if (!options || !Number.isSafeInteger(options.max) || options.max < 1 || options.max > HARD_MAX_REQUESTS) throw new FetchOptionError('MAX_FORA_DO_LIMITE', 'max inválido');
  if (!Number.isSafeInteger(options.delayMs) || options.delayMs < MIN_DELAY_MS) throw new FetchOptionError('DELAY_ABAIXO_DO_MINIMO', 'delayMs inválido');
  const items = validatePlan(plan); // antes de QUALQUER GET
  const ceiling = Math.min(options.max, HARD_MAX_REQUESTS);
  if (items.length > ceiling) throw new FetchOptionError('PLANO_EXCEDE_TETO', `plano (${items.length}) excede o teto ${ceiling}`);
  let requests = 0; let stoppedBy = null;
  for (const item of items) {
    if (requests >= ceiling) { stoppedBy = 'TETO_ATINGIDO'; break; }
    if (requests > 0) await sleep(options.delayMs);
    const url = urlFor(item); requests++;
    let status = null, body = new Uint8Array(0), contentType = null, error = null, tooLarge = false, declaredLength = null;
    try { const res = await fetchImpl(url, { headers, redirect: 'manual' }); status = res.status; contentType = res.headers.get('content-type'); const b = await readBodyLimited(res, maxBodyBytes); body = b.body; tooLarge = b.tooLarge; declaredLength = b.declared ?? null; }
    catch (e) { error = String((e && e.message) || e); }
    const isJson = /json/i.test(contentType ?? '') && body.length > 0 && body[0] === 0x7b;
    const reason = stopReason({ status, error, isJson, tooLarge });
    await onResponse({ n: requests, item, url, status, contentType, body, error, stop: reason, tooLarge, declaredLength });
    if (reason) { stoppedBy = reason; break; }
  }
  return { requests, stoppedBy, planSize: items.length, refused: false };
}
