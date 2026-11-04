/**
 * Quarentena: registros rejeitados NUNCA são descartados silenciosamente. Cada entrada guarda o
 * hash do bruto, o estágio da falha (parse/normalize/validate/dataset), motivos estruturados,
 * versão do parser e (quando houver) o candidato normalizado exatamente como foi rejeitado.
 * Imutabilidade REAL: cópia profunda defensiva (structuredClone) na criação, no armazenamento e na
 * leitura (list/byCode), mais congelamento profundo de todas as estruturas aninhadas. Referências
 * externas ao candidato/motivos originais e objetos devolvidos por list() não alteram o armazenado.
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

/** Cópia profunda + congelamento profundo. */
const snapshot = v => deepFreeze(structuredClone(v));

/** @returns {Readonly<object>} entrada profundamente imutável (cópia independente da entrada) */
export function createQuarantineEntry({ rawSha256, stage, reasons, parserVersion, candidate = null }) {
  if (!QUARANTINE_STAGES.includes(stage)) throw new TypeError(`estágio inválido: ${stage}`);
  if (!Array.isArray(reasons) || reasons.length === 0) throw new TypeError('quarentena exige ao menos um motivo explícito');
  for (const r of reasons) if (!r || typeof r.code !== 'string' || typeof r.message !== 'string') throw new TypeError('motivo deve ter code e message');
  return snapshot({ rawSha256, stage, parserVersion, reasons, candidate });
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
