/**
 * Quarentena: registros rejeitados NUNCA são descartados silenciosamente. Cada entrada guarda o
 * hash do bruto, o estágio da falha (parse/normalize/validate/dataset), motivos estruturados,
 * versão do parser e (quando houver) o candidato normalizado exatamente como foi rejeitado.
 * Imutabilidade REAL: cópia profunda defensiva (structuredClone) na criação, no armazenamento e na
 * leitura (list/byCode), mais congelamento profundo de todas as estruturas aninhadas. Referências
 * externas ao candidato/motivos originais e objetos devolvidos por list() não alteram o armazenado.
 * Conteúdo restrito a valores JSON (assertJsonValue): rejeita Map/Set/Date/ciclos/classes/etc.
 * Armazenamento em memória, somente-acréscimo, ordem de inserção preservada; persistência: Fase 3b.
 * @module data/quarantine
 */
export const QUARANTINE_STAGES = Object.freeze(['parse', 'normalize', 'validate', 'dataset']);

/** Congela recursivamente objetos e arrays (seguro para ciclos). */
export function deepFreeze(v, seen = new WeakSet()) {
  if (v === null || typeof v !== 'object' || seen.has(v)) return v;
  seen.add(v); Object.freeze(v);
  for (const k of Reflect.ownKeys(v)) deepFreeze(v[k], seen);
  return v;
}

/**
 * Aceita SOMENTE valores JSON: null, boolean, string, número finito, arrays densos (protótipo
 * Array.prototype, sem propriedades extras) e objetos simples (protótipo Object.prototype ou null).
 * Rejeita Map, Set, Date, RegExp, typed arrays/ArrayBuffer, funções, símbolos, BigInt, undefined,
 * NaN/±Infinity, referências circulares, instâncias de classes, chaves símbolo e acessores.
 * Nunca invoca getters (lê descritores). Lança TypeError com o caminho do primeiro valor inválido.
 */
export function assertJsonValue(v, path = '$', stack = new Set()) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new TypeError(`${path}: número não finito`); return; }
  if (typeof v !== 'object') throw new TypeError(`${path}: tipo não-JSON (${typeof v})`);
  if (stack.has(v)) throw new TypeError(`${path}: referência circular`);
  const proto = Object.getPrototypeOf(v);
  const isArr = Array.isArray(v);
  if (isArr ? proto !== Array.prototype : (proto !== Object.prototype && proto !== null)) {
    throw new TypeError(`${path}: objeto não simples (${(proto && proto.constructor && proto.constructor.name) || 'protótipo desconhecido'})`);
  }
  const keys = Reflect.ownKeys(v);
  if (keys.some(k => typeof k === 'symbol')) throw new TypeError(`${path}: chave símbolo`);
  const desc = Object.getOwnPropertyDescriptors(v);
  stack.add(v);
  if (isArr) {
    const len = v.length;
    for (const k of keys) if (k !== 'length' && !(String(Number(k)) === k && Number(k) < len)) throw new TypeError(`${path}: propriedade extra em array (${k})`);
    for (let i = 0; i < len; i++) {
      const d = desc[i];
      if (!d) throw new TypeError(`${path}[${i}]: array esparso`);
      if (!('value' in d)) throw new TypeError(`${path}[${i}]: acessor`);
      assertJsonValue(d.value, `${path}[${i}]`, stack);
    }
  } else {
    for (const k of keys) {
      const d = desc[k];
      if (!('value' in d)) throw new TypeError(`${path}.${k}: acessor`);
      assertJsonValue(d.value, `${path}.${k}`, stack);
    }
  }
  stack.delete(v);
}

/** Cópia profunda + congelamento profundo. */
const snapshot = v => deepFreeze(structuredClone(v));

/** @returns {Readonly<object>} entrada profundamente imutável (cópia independente da entrada) */
export function createQuarantineEntry({ rawSha256, stage, reasons, parserVersion, candidate = null }) {
  if (!QUARANTINE_STAGES.includes(stage)) throw new TypeError(`estágio inválido: ${stage}`);
  if (!Array.isArray(reasons) || reasons.length === 0) throw new TypeError('quarentena exige ao menos um motivo explícito');
  for (const r of reasons) if (!r || typeof r.code !== 'string' || typeof r.message !== 'string') throw new TypeError('motivo deve ter code e message');
  const entry = { rawSha256, stage, parserVersion, reasons, candidate };
  assertJsonValue(entry, '$'); // antes de copiar: só valores JSON entram na quarentena
  return snapshot(entry);
}

export class QuarantineStore {
  #entries = [];
  /** Revalida e armazena uma CÓPIA profunda congelada. @returns {number} novo tamanho */
  add(entry) {
    if (!entry || typeof entry !== 'object') throw new TypeError('use createQuarantineEntry');
    this.#entries.push(createQuarantineEntry(entry));
    return this.#entries.length;
  }
  get size() { return this.#entries.length; }
  /** Cópias profundas congeladas, na ordem de inserção. */
  list() { return this.#entries.map(snapshot); }
  byCode(code) { return this.#entries.filter(e => e.reasons.some(r => r.code === code)).map(snapshot); }
}
