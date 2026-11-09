/**
 * Parser JSON que PRESERVA o texto exato dos números ({"$number":"30598.43"}) — evita que valores
 * monetários da API passem por ponto flutuante. Rejeita chaves duplicadas, profundidade > 64 e
 * entradas > 4 MiB (BYTES UTF-8 reais, não unidades UTF-16). Strings decodificadas conforme RFC 8259
 * (surrogates isolados rejeitados).
 * Tokens numéricos são objetos congelados registrados num WeakSet PRIVADO deste módulo: um objeto
 * recebido do JSON externo com a chave "$number" (ex.: {"numero":{"$number":"7"}}) NÃO é token numérico.
 * @module historical/jsonnum
 */
const TOKENS = new WeakSet();
export const JSON_MAX_BYTES = 4 * 1024 * 1024;
/** Token numérico criado por este parser (identidade privada; não reproduzível por JSON externo). */
export const isNum = v => v !== null && typeof v === 'object' && TOKENS.has(v);
const numToken = lit => { const t = Object.freeze({ $number: lit }); TOKENS.add(t); return t; };
/** Bytes UTF-8 de uma string bem formada, sem alocar (surrogate par = 4 bytes). */
export function utf8ByteLength(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}
/** Serializa um valor do parser como texto JSON fiel: tokens numéricos voltam ao literal original (sem aspas). */
export function toJsonText(v) {
  if (isNum(v)) return v.$number;
  if (Array.isArray(v)) return `[${v.map(toJsonText).join(',')}]`;
  if (v !== null && typeof v === 'object') return `{${Object.keys(v).map(k => `${JSON.stringify(k)}:${toJsonText(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
/** Tipo JSON de um valor do parser: undefined (ausente) | null | number | string | boolean | array | object. */
export const jsonType = v => (v === undefined ? 'undefined' : v === null ? 'null' : isNum(v) ? 'number' : Array.isArray(v) ? 'array' : typeof v);

export function parseJsonPreservingNumbers(text, { maxDepth = 64, maxBytes = JSON_MAX_BYTES } = {}) {
  if (typeof text !== 'string') throw new TypeError('JSON deve ser string');
  // limite em BYTES UTF-8: text.length conta unidades UTF-16 e subestima texto não-ASCII
  if (text.length > maxBytes || utf8ByteLength(text) > maxBytes) throw new RangeError('JSON grande demais');
  let i = 0; const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
  const fail = m => { throw new SyntaxError(`JSON inválido na posição ${i}: ${m}`); };
  function value(depth) {
    if (depth > maxDepth) fail('profundidade excessiva');
    ws(); const c = text[i];
    if (c === '{') { i++; const o = {}; ws(); if (text[i] === '}') { i++; return o; }
      for (;;) { ws(); if (text[i] !== '"') fail('chave esperada'); const k = str(); if (Object.prototype.hasOwnProperty.call(o, k)) fail(`chave duplicada: ${k}`);
        ws(); if (text[i++] !== ':') fail("':' esperado"); Object.defineProperty(o, k, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        ws(); if (text[i] === ',') { i++; continue; } if (text[i] === '}') { i++; return o; } fail("',' ou '}' esperado"); } }
    if (c === '[') { i++; const a = []; ws(); if (text[i] === ']') { i++; return a; }
      for (;;) { a.push(value(depth + 1)); ws(); if (text[i] === ',') { i++; continue; } if (text[i] === ']') { i++; return a; } fail("',' ou ']' esperado"); } }
    if (c === '"') return str();
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    const m = /-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y; m.lastIndex = i; const r = m.exec(text);
    if (!r || r[0] === '' || r[0] === '-') fail('valor inesperado');
    i = m.lastIndex; return numToken(r[0]);
  }
  function str() {
    i++; let s = '';
    for (;;) {
      if (i >= text.length) fail('string sem fim');
      const ch = text[i++];
      if (ch === '"') break;
      if (ch < ' ') fail('caractere de controle em string');
      if (ch !== '\\') { s += ch; continue; }
      const e = text[i++];
      if (e === 'u') { const h = text.slice(i, i + 4); if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('\\u inválido'); s += String.fromCharCode(parseInt(h, 16)); i += 4; }
      else if ('"\\/bfnrt'.includes(e)) s += { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[e];
      else fail('escape inválido');
    }
    if (!s.isWellFormed()) fail('surrogate isolado');
    return s;
  }
  const v = value(0); ws(); if (i !== text.length) fail('conteúdo após o valor');
  return v;
}
