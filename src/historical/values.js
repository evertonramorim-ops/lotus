/**
 * Interpretação EXPLÍCITA de valores (independente de locale/fuso; sem ponto flutuante).
 * Dinheiro: centavos como STRING de dígitos (BigInt internamente). Nada vira zero por ausência:
 * célula vazia, "-" ou texto não reconhecido → cents=null + absent=true + absenceReason.
 * Nenhuma transformação tributária (sem fator 0,7, sem desconto, sem isenção presumida).
 * @module historical/values
 */
import { isIsoDate } from '../validation/common.js';

export const ABSENCE = Object.freeze({ EMPTY: 'EMPTY_CELL', DASH: 'DASH_CELL', MISSING_COLUMN: 'COLUMN_NOT_PRESENT', NOT_IN_SOURCE: 'FIELD_NOT_IN_SOURCE', JSON_NULL: 'JSON_NULL' });

/** Representação de célula para entradas: {kind, text?} (ver xlsx/workbook interpretCell). */
function cellText(cell) { if (!cell) return null; const i = cell.interpreted; return i && 'text' in i ? i.text : null; }

/** Ausência padronizada a partir de uma célula. @returns {string|null} */
export function absenceOf(cell) {
  if (!cell) return ABSENCE.MISSING_COLUMN;
  const k = cell.interpreted.kind;
  if (k === 'empty') return ABSENCE.EMPTY;
  const t = cellText(cell);
  if (t !== null && t.trim() === '-') return ABSENCE.DASH;
  return null;
}

const BRL = /^R\$ ?([0-9]{1,3}(?:\.[0-9]{3})*|[0-9]+),([0-9]{2})$/;
/**
 * "R$1.234,56" → { cents:"123456", raw, absent:false, valid:true }.
 * Formato aceito (documentado na 3b.1): prefixo "R$", milhar ".", decimal "," com 2 casas.
 * Negativos, outras moedas, 1 ou 3 casas → valid:false (VALOR_MONETARIO_INVALIDO), cents:null.
 */
export function parseBrlText(text) {
  if (typeof text !== 'string') return { cents: null, valid: false };
  const m = BRL.exec(text.trim());
  if (!m) return { cents: null, valid: false };
  const intPart = m[1].replace(/\./g, '');
  if (m[1].includes('.') && !/^[0-9]{1,3}(\.[0-9]{3})*$/.test(m[1])) return { cents: null, valid: false };
  return { cents: (BigInt(intPart) * 100n + BigInt(m[2])).toString(), valid: true };
}

/**
 * Literal decimal JSON (texto exato do número na resposta, ex. "30598.43", "42334170.0", "0.0", "1E+3")
 * → centavos exatos. Só aceita se a parte fracionária significativa tiver ≤ 2 casas. Sem float.
 */
/** Limites de segurança ANTES de qualquer potência BigInt (evita consumo descontrolado de CPU/memória). */
export const DECIMAL_LIMITS = Object.freeze({ maxLiteralLength: 64, maxExponentAbs: 30, maxResultDigits: 30 });
export function decimalLiteralToCents(lit) {
  const bad = invalidReason => ({ cents: null, valid: false, invalidReason });
  if (typeof lit !== 'string') return bad('LITERAL_NAO_TEXTO');
  if (lit.length > DECIMAL_LIMITS.maxLiteralLength) return bad('LITERAL_LONGO_DEMAIS');
  const m = /^(-)?([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(lit);
  if (!m) return bad('LITERAL_NAO_DECIMAL');
  if (m[1]) return bad('VALOR_NEGATIVO');
  if (m[4] !== undefined && (m[4].replace(/^[+-]/, '').replace(/^0+/, '').length > 3 || Math.abs(Number(m[4])) > DECIMAL_LIMITS.maxExponentAbs)) return bad('EXPOENTE_FORA_DO_LIMITE');
  let digits = (m[2] + (m[3] ?? '')).replace(/^0+(?=[0-9])/, ''); const scale = (m[3] ?? '').length - (m[4] ? Number(m[4]) : 0);
  // valor = digits × 10^-scale ; centavos = digits × 10^(2-scale)
  const shift = 2 - scale;
  if (shift >= 0) {
    if (digits !== '0' && digits.length + shift > DECIMAL_LIMITS.maxResultDigits) return bad('RESULTADO_GRANDE_DEMAIS');
    return { cents: (BigInt(digits) * 10n ** BigInt(shift)).toString(), valid: true, invalidReason: null };
  }
  const cut = -shift; const tail = digits.slice(-cut).padStart(cut, '0');
  if (/[^0]/.test(tail)) return bad('FRACAO_ALEM_DE_CENTAVOS');
  digits = digits.length > cut ? digits.slice(0, -cut) : '0';
  if (digits.length > DECIMAL_LIMITS.maxResultDigits) return bad('RESULTADO_GRANDE_DEMAIS');
  return { cents: BigInt(digits).toString(), valid: true, invalidReason: null };
}

/** Valor monetário de uma célula XLSX (camada C), com referência da célula de origem. */
export function moneyFromCell(cell, column) {
  const ref = cell ? cell.ref : null; const raw = cell ? (cell.raw ?? cell.text ?? null) : null;
  const ab = absenceOf(cell);
  if (ab) return { cents: null, raw, absent: true, absenceReason: ab, valid: true, ref, column };
  const t = cellText(cell);
  if (cell.interpreted.kind !== 'text') return { cents: null, raw, absent: false, absenceReason: null, valid: false, ref, column, invalidReason: `tipo ${cell.type}/${cell.interpreted.kind} em campo monetário` };
  const p = parseBrlText(t);
  return { cents: p.cents, raw, absent: false, absenceReason: null, valid: p.valid, ref, column, ...(p.valid ? {} : { invalidReason: 'formato monetário não reconhecido' }) };
}

/** Inteiro não negativo de célula numérica (ganhadores, concurso). */
export function intFromCell(cell, column, { min = 0 } = {}) {
  const ref = cell ? cell.ref : null; const raw = cell ? (cell.raw ?? cell.text ?? null) : null;
  const ab = absenceOf(cell);
  if (ab) return { value: null, raw, absent: true, absenceReason: ab, valid: true, ref, column, typeMismatch: !!cell && cell.interpreted.kind === 'invalid' };
  const i = cell.interpreted;
  if (i.kind === 'number' && /^[0-9]+$/.test(i.text) && i.text.length <= 15 && Number(i.text) >= min) return { value: Number(i.text), raw, absent: false, absenceReason: null, valid: true, ref, column };
  return { value: null, raw, absent: false, absenceReason: null, valid: false, ref, column, invalidReason: `esperado inteiro ≥ ${min}; tipo ${cell.type}/${i.kind}` };
}

/** "dd/mm/aaaa" → "aaaa-mm-dd" (calendário gregoriano real), sem Date nem locale. */
export function parseBrDate(text) {
  if (typeof text !== 'string') return null;
  const m = /^([0-9]{2})\/([0-9]{2})\/([0-9]{4})$/.exec(text.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isIsoDate(iso) ? iso : null;
}

/**
 * Serial de data do Excel → ISO (somente quando a célula for numérica e o adaptador permitir).
 * Sistema 1900: serial 60 = 29/02/1900 inexistente (bug Lotus 1-2-3) → rejeitado (null).
 * Sistema 1904: dia 0 = 1904-01-01. Frações (hora) rejeitadas para data de sorteio.
 */
export function excelSerialToIso(serialText, date1904 = false) {
  if (typeof serialText !== 'string' || !/^[0-9]{1,6}$/.test(serialText)) return null;
  let n = Number(serialText);
  if (!date1904) { if (n === 60 || n < 1) return null; if (n > 60) n -= 1; n -= 1; } // n dias após 1900-01-01
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1900, 0, 1);
  const d = new Date(base + n * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Data de sorteio a partir de célula: texto dd/mm/aaaa (padrão documentado) ou serial (se permitido). */
export function dateFromCell(cell, column, { allowSerial = false, date1904 = false } = {}) {
  const ref = cell ? cell.ref : null; const raw = cell ? (cell.raw ?? cell.text ?? null) : null;
  const ab = absenceOf(cell);
  if (ab) return { iso: null, raw, absent: true, absenceReason: ab, valid: false, ref, column, representation: null };
  const i = cell.interpreted;
  if (i.kind === 'text') { const iso = parseBrDate(i.text); return { iso, raw, absent: false, valid: iso !== null, ref, column, representation: 'TEXT_DD_MM_YYYY' }; }
  if (i.kind === 'number' && allowSerial) { const iso = excelSerialToIso(i.text, date1904); return { iso, raw, absent: false, valid: iso !== null, ref, column, representation: date1904 ? 'EXCEL_SERIAL_1904' : 'EXCEL_SERIAL_1900' }; }
  return { iso: null, raw, absent: false, valid: false, ref, column, representation: null, invalidReason: `tipo ${cell.type}/${i.kind} em campo de data` };
}
