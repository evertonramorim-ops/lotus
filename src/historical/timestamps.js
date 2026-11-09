/**
 * Validação ESTRITA de timestamps vindos de logs (Fase 3b.1/3b.2) e de `--created-at`. Funções puras.
 * Nunca lançam: devolvem {ok:false, reason} para ausente, nulo, tipo incorreto, formato não ISO-8601 ou data impossível
 * (ex.: 2026-02-31, 25:00). `new Date(x).toISOString()` não é chamado sem validação prévia (evita RangeError).
 * @module historical/timestamps
 */
export const TIMESTAMP_REASONS = Object.freeze({ AUSENTE: 'TIMESTAMP_UTC_AUSENTE', NULO: 'TIMESTAMP_UTC_NULO', TIPO: 'TIMESTAMP_UTC_TIPO_INCORRETO', FORMATO: 'TIMESTAMP_UTC_FORMATO_INVALIDO', DATA: 'TIMESTAMP_UTC_DATA_INVALIDA' });
// data e hora completas com segundos; fração opcional (até 9 dígitos); fuso obrigatório (Z ou ±hh:mm) — nunca hora local implícita
const LOG_TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * @param {any} v valor do campo (ex.: `utc` de uma linha de log)
 * @returns {{ok:true, iso:string, literal:string}|{ok:false, reason:string, literal:any}}
 *   `iso`: instante normalizado por toISOString (mesma saída do código anterior para entradas válidas).
 */
export function parseLogTimestamp(v) {
  if (v === undefined) return { ok: false, reason: TIMESTAMP_REASONS.AUSENTE, literal: null };
  if (v === null) return { ok: false, reason: TIMESTAMP_REASONS.NULO, literal: null };
  if (typeof v !== 'string') return { ok: false, reason: TIMESTAMP_REASONS.TIPO, literal: typeof v === 'number' || typeof v === 'boolean' ? String(v) : Object.prototype.toString.call(v) };
  const m = LOG_TS.exec(v);
  if (!m) return { ok: false, reason: TIMESTAMP_REASONS.FORMATO, literal: v.slice(0, 64) };
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const oh = m[10] !== undefined ? Number(m[10]) : 0; const om = m[11] !== undefined ? Number(m[11]) : 0;
  const cal = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const calendarOk = y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && h <= 23 && mi <= 59 && s <= 59 && oh <= 23 && om <= 59
    && cal.getUTCFullYear() === y && cal.getUTCMonth() === mo - 1 && cal.getUTCDate() === d;
  const t = Date.parse(v);
  if (!calendarOk || !Number.isFinite(t)) return { ok: false, reason: TIMESTAMP_REASONS.DATA, literal: v };
  return { ok: true, iso: new Date(t).toISOString(), literal: v };
}
