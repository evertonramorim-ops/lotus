/**
 * Quarentena: registros rejeitados NUNCA são descartados silenciosamente. Cada entrada guarda o
 * hash do bruto, o estágio da falha (parse/normalize/validate/dataset), motivos estruturados,
 * versão do parser e (quando houver) o candidato normalizado. Armazenamento em memória,
 * somente-acréscimo; persistência fica a cargo do chamador (Fase 3b).
 * @module data/quarantine
 */
export const QUARANTINE_STAGES = Object.freeze(['parse', 'normalize', 'validate', 'dataset']);

/** @returns {Readonly<object>} */
export function createQuarantineEntry({ rawSha256, stage, reasons, parserVersion, candidate = null }) {
  if (!QUARANTINE_STAGES.includes(stage)) throw new TypeError(`estágio inválido: ${stage}`);
  if (!Array.isArray(reasons) || reasons.length === 0) throw new TypeError('quarentena exige ao menos um motivo explícito');
  for (const r of reasons) if (!r || typeof r.code !== 'string' || typeof r.message !== 'string') throw new TypeError('motivo deve ter code e message');
  return Object.freeze({ rawSha256, stage, parserVersion, reasons: Object.freeze(reasons.map(r => Object.freeze({ ...r }))), candidate });
}

export class QuarantineStore {
  constructor() { /** @type {object[]} */ this._entries = []; }
  add(entry) { if (!Object.isFrozen(entry)) throw new TypeError('use createQuarantineEntry'); this._entries.push(entry); return this._entries.length; }
  get size() { return this._entries.length; }
  list() { return this._entries.slice(); }
  byCode(code) { return this._entries.filter(e => e.reasons.some(r => r.code === code)); }
}
