/**
 * Canonicalização JSON conforme RFC 8785 (JSON Canonicalization Scheme — JCS).
 * Implementação própria, sem dependências. Regras aplicadas:
 *  - Sem espaços em branco entre tokens (RFC 8785 §3.2.1).
 *  - Literais null/true/false (§3.2.2.1).
 *  - Strings: escapes conforme ECMAScript JSON.stringify — \b \t \n \f \r \" \\ e \u00XX minúsculo
 *    para os demais controles < 0x20; todos os outros caracteres literais (§3.2.2.2).
 *    Surrogates UTF-16 isolados são REJEITADOS (I-JSON, RFC 7493, exigido por §3.1).
 *  - Números: serialização ECMAScript Number::toString (§3.2.2.3); -0 → "0"; NaN/±Infinity rejeitados.
 *  - Propriedades ordenadas recursivamente pela sequência de unidades de código UTF-16 do nome
 *    (comparação de strings nativa do JavaScript), arrays mantêm a ordem (§3.2.3).
 *  - Saída final codificada em UTF-8 (§3.2.4) — ver {@link canonicalizeToBytes}.
 * Entradas aceitas: valores JSON puros (objetos simples, arrays, strings, numbers finitos,
 * booleanos, null). undefined, funções, símbolos, BigInt, Date, Map etc. são REJEITADOS
 * (falha explícita em vez de omissão silenciosa como no JSON.stringify).
 * @module integrity/jcs
 */

/** Erro de canonicalização. */
export class JcsError extends TypeError {
  /** @param {string} message @param {string} path */
  constructor(message, path) { super(`${message} (em ${path})`); this.name = 'JcsError'; this.path = path; }
}

/**
 * Serializa um Number conforme ECMAScript Number::toString (RFC 8785 §3.2.2.3).
 * @param {number} n
 * @returns {string}
 */
export function serializeNumber(n, path = '$') {
  if (typeof n !== 'number') throw new JcsError('não é number', path);
  if (!Number.isFinite(n)) throw new JcsError('NaN/Infinity não são permitidos em JSON', path);
  if (Object.is(n, -0)) return '0';
  // String(Number) implementa exatamente Number::toString (ECMA-262 §6.1.6.1.20) — o algoritmo
  // de menor dígito de ida-e-volta exigido pela RFC 8785. Verificado pelos vetores do Apêndice B.
  return String(n);
}

/**
 * Serializa uma string conforme RFC 8785 §3.2.2.2.
 * @param {string} s
 * @returns {string}
 */
export function serializeString(s, path = '$') {
  if (typeof s !== 'string') throw new JcsError('não é string', path);
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (d < 0xdc00 || d > 0xdfff) throw new JcsError('surrogate UTF-16 alto isolado', path);
      out += s[i] + s[i + 1]; i++; continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) throw new JcsError('surrogate UTF-16 baixo isolado', path);
    switch (c) {
      case 0x08: out += '\\b'; break;
      case 0x09: out += '\\t'; break;
      case 0x0a: out += '\\n'; break;
      case 0x0c: out += '\\f'; break;
      case 0x0d: out += '\\r'; break;
      case 0x22: out += '\\"'; break;
      case 0x5c: out += '\\\\'; break;
      default:
        out += c < 0x20 ? '\\u' + c.toString(16).padStart(4, '0') : s[i];
    }
  }
  return out + '"';
}

/** Comparação por unidades de código UTF-16 (explícita, independente de locale). */
export function compareUtf16(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const d = a.charCodeAt(i) - b.charCodeAt(i); if (d !== 0) return d; }
  return a.length - b.length;
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function ser(v, path, seen) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean': return v ? 'true' : 'false';
    case 'number': return serializeNumber(v, path);
    case 'string': return serializeString(v, path);
    case 'object': break;
    default: throw new JcsError(`tipo não JSON: ${typeof v}`, path);
  }
  if (seen.has(v)) throw new JcsError('referência circular', path);
  seen.add(v);
  let out;
  if (Array.isArray(v)) {
    const parts = [];
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) throw new JcsError('array esparso', `${path}[${i}]`);
      parts.push(ser(v[i], `${path}[${i}]`, seen));
    }
    out = '[' + parts.join(',') + ']';
  } else if (isPlainObject(v)) {
    if (Object.getOwnPropertySymbols(v).length) throw new JcsError('chave Symbol', path);
    const keys = Object.keys(v).sort(compareUtf16);
    out = '{' + keys.map(k => serializeString(k, path) + ':' + ser(v[k], `${path}.${k}`, seen)).join(',') + '}';
  } else {
    throw new JcsError('objeto não simples (Date/Map/classe) não é JSON puro', path);
  }
  seen.delete(v);
  return out;
}

/**
 * Canonicaliza um valor JSON (já parseado) em string JCS.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) { return ser(value, '$', new Set()); }

/**
 * Canonicaliza e codifica em UTF-8 (RFC 8785 §3.2.4).
 * @param {unknown} value
 * @returns {Uint8Array}
 */
export function canonicalizeToBytes(value) { return new TextEncoder().encode(canonicalize(value)); }

/**
 * Parseia texto JSON e canonicaliza. Atenção: JSON.parse aceita chaves duplicadas (a última vence);
 * RFC 8785 exige I-JSON (sem duplicadas). Use {@link assertNoDuplicateKeys} quando a entrada for externa.
 * @param {string} text
 */
export function canonicalizeText(text) { assertNoDuplicateKeys(text); return canonicalize(JSON.parse(text)); }

/**
 * Detecta chaves duplicadas em texto JSON (varredura léxica mínima). Lança JcsError se houver.
 * @param {string} text
 */
export function assertNoDuplicateKeys(text) {
  const stack = []; let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1; let raw = '';
      while (j < text.length && text[j] !== '"') { if (text[j] === '\\') { raw += text[j]; j++; } raw += text[j]; j++; }
      const top = stack[stack.length - 1];
      if (top && top.type === 'obj' && top.expectKey) {
        const key = JSON.parse('"' + raw + '"');
        if (top.keys.has(key)) throw new JcsError(`chave duplicada: ${JSON.stringify(key)}`, '$');
        top.keys.add(key); top.expectKey = false;
      }
      i = j + 1; continue;
    }
    if (ch === '{') stack.push({ type: 'obj', keys: new Set(), expectKey: true });
    else if (ch === '[') stack.push({ type: 'arr' });
    else if (ch === '}' || ch === ']') stack.pop();
    else if (ch === ',') { const top = stack[stack.length - 1]; if (top && top.type === 'obj') top.expectKey = true; }
    i++;
  }
}
