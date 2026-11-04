/**
 * Parser JSON que PRESERVA o texto exato dos números ({"$number":"30598.43"}) — evita que valores
 * monetários da API passem por ponto flutuante. Rejeita chaves duplicadas, profundidade > 64 e
 * entradas > 4 MiB. Strings decodificadas conforme RFC 8259 (surrogates isolados rejeitados).
 * @module historical/jsonnum
 */
export const isNum = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.$number === 'string';

export function parseJsonPreservingNumbers(text, { maxDepth = 64, maxBytes = 4 * 1024 * 1024 } = {}) {
  if (typeof text !== 'string') throw new TypeError('JSON deve ser string');
  if (text.length > maxBytes) throw new RangeError('JSON grande demais');
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
    i = m.lastIndex; return { $number: r[0] };
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
