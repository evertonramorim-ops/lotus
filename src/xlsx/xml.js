/**
 * Tokenizador XML mínimo e SEGURO (estilo SAX) para as partes de um XLSX.
 * - Rejeita qualquer <!DOCTYPE> / <!ENTITY> (sem DTD → sem entidades externas nem expansão).
 * - Só decodifica as 5 entidades predefinidas e referências numéricas válidas (&#NN; &#xHH;).
 * - Limites: profundidade, nº de elementos, nº de atributos por elemento, tamanho da entrada.
 * - Verifica balanceamento de tags, atributos duplicados e um único elemento raiz.
 * - Nomes com prefixo (x:c) são entregues com `local` sem prefixo e `qname` original.
 * Não implementa validação de namespaces nem DTD (fora de escopo, por segurança).
 * @module xlsx/xml
 */
import { XlsxError } from './errors.js';

export const XML_DEFAULT_LIMITS = Object.freeze({ maxDepth: 64, maxElements: 5_000_000, maxAttributes: 64, maxBytes: 128 * 1024 * 1024 });
const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const PREDEF = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Decodifica referências; lança em entidade desconhecida. */
export function decodeEntities(s, part) {
  if (!s.includes('&')) return s;
  return s.replace(/&([^;&\s]{0,16});?/g, (m, body) => {
    if (!m.endsWith(';')) throw new XlsxError('XML_BAD_ENTITY', `referência sem ';': ${m}`, { part });
    if (Object.prototype.hasOwnProperty.call(PREDEF, body)) return PREDEF[body];
    let cp = null;
    if (/^#x[0-9A-Fa-f]{1,6}$/.test(body)) cp = parseInt(body.slice(2), 16);
    else if (/^#[0-9]{1,7}$/.test(body)) cp = parseInt(body.slice(1), 10);
    if (cp === null) throw new XlsxError('XML_UNKNOWN_ENTITY', `entidade não permitida: ${m}`, { part });
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || (cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13)) throw new XlsxError('XML_BAD_CHAR_REF', `referência inválida: ${m}`, { part });
    return String.fromCodePoint(cp);
  });
}

function localName(q) { const i = q.indexOf(':'); return i < 0 ? q : q.slice(i + 1); }

/**
 * Percorre o XML chamando handlers. @param {string} xml @param {{open?:Function, close?:Function, text?:Function}} h
 * open(local, attrs{local→valor}, qname, selfClosing) · close(local, qname) · text(decodedText)
 */
export function walkXml(xml, h = {}, limits = {}, part = '?') {
  const L = { ...XML_DEFAULT_LIMITS, ...limits };
  if (typeof xml !== 'string') throw new XlsxError('XML_INPUT', 'XML deve ser string', { part });
  if (xml.length > L.maxBytes) throw new XlsxError('XML_TOO_LARGE', 'parte XML excede o limite', { part });
  let i = 0; const n = xml.length; const stack = []; let elements = 0; let rootSeen = false; let rootClosed = false;
  if (xml.charCodeAt(0) === 0xfeff) i = 1;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) {
      const raw = xml.slice(i, textEnd);
      if (stack.length === 0) { if (raw.trim()) throw new XlsxError('XML_TEXT_OUTSIDE_ROOT', 'texto fora do elemento raiz', { part }); }
      else if (h.text) h.text(decodeEntities(raw, part));
      else decodeEntities(raw, part);
    }
    if (lt < 0) break;
    if (xml.startsWith('<?', lt)) {
      const e = xml.indexOf('?>', lt + 2); if (e < 0) throw new XlsxError('XML_UNTERMINATED', 'instrução de processamento sem fim', { part });
      i = e + 2; continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4); if (e < 0) throw new XlsxError('XML_UNTERMINATED', 'comentário sem fim', { part });
      i = e + 3; continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9); if (e < 0) throw new XlsxError('XML_UNTERMINATED', 'CDATA sem fim', { part });
      if (stack.length === 0) throw new XlsxError('XML_TEXT_OUTSIDE_ROOT', 'CDATA fora da raiz', { part });
      if (h.text) h.text(xml.slice(lt + 9, e));
      i = e + 3; continue;
    }
    if (xml.startsWith('<!', lt)) {
      const kw = xml.slice(lt, lt + 9).toUpperCase();
      if (kw.startsWith('<!DOCTYPE')) throw new XlsxError('XML_DOCTYPE_FORBIDDEN', 'DOCTYPE/DTD não é permitido', { part });
      if (kw.startsWith('<!ENTITY')) throw new XlsxError('XML_ENTITY_FORBIDDEN', 'declaração ENTITY não é permitida', { part });
      throw new XlsxError('XML_DECLARATION_FORBIDDEN', 'declaração de marcação não permitida', { part });
    }
    const gt = findTagEnd(xml, lt + 1);
    if (gt < 0) throw new XlsxError('XML_UNTERMINATED', 'tag sem fim', { part });
    const inner = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (inner.startsWith('/')) {
      const q = inner.slice(1).trim();
      const top = stack.pop();
      if (top !== q) throw new XlsxError('XML_MISMATCHED_TAG', `fechamento </${q}> não corresponde a <${top ?? '∅'}>`, { part });
      if (h.close) h.close(localName(q), q);
      if (stack.length === 0) rootClosed = true;
      continue;
    }
    const self = inner.endsWith('/');
    const body = self ? inner.slice(0, -1) : inner;
    const m = /^([^\s/>]+)/.exec(body);
    if (!m || !NAME.test(m[1])) throw new XlsxError('XML_BAD_NAME', `nome de elemento inválido: ${body.slice(0, 40)}`, { part });
    const q = m[1];
    if (stack.length === 0) { if (rootSeen && rootClosed) throw new XlsxError('XML_MULTIPLE_ROOTS', 'mais de um elemento raiz', { part }); rootSeen = true; }
    if (++elements > L.maxElements) throw new XlsxError('XML_TOO_MANY_ELEMENTS', 'número de elementos excede o limite', { part });
    const attrs = parseAttrs(body.slice(q.length), L, part);
    if (!self) { stack.push(q); if (stack.length > L.maxDepth) throw new XlsxError('XML_TOO_DEEP', `profundidade > ${L.maxDepth}`, { part }); }
    if (h.open) h.open(localName(q), attrs, q, self);
    if (self) { if (h.close) h.close(localName(q), q); if (stack.length === 0) rootClosed = true; }
  }
  if (stack.length) throw new XlsxError('XML_UNCLOSED', `elementos não fechados: ${stack.join('>')}`, { part });
  if (!rootSeen) throw new XlsxError('XML_EMPTY', 'documento sem elemento raiz', { part });
}

function findTagEnd(xml, from) {
  let q = null;
  for (let k = from; k < xml.length; k++) {
    const c = xml[k];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c; else if (c === '>') return k; else if (c === '<') return -1;
  }
  return -1;
}

const ATTR = /\s*([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/y;
function parseAttrs(s, L, part) {
  const out = {}; const seen = new Set(); let count = 0;
  ATTR.lastIndex = 0; let pos = 0;
  while (pos < s.length) {
    if (/^\s*$/.test(s.slice(pos))) break;
    ATTR.lastIndex = pos; const m = ATTR.exec(s);
    if (!m) throw new XlsxError('XML_BAD_ATTRIBUTE', `atributo malformado: ${s.slice(pos, pos + 40)}`, { part });
    const q = m[1]; if (!NAME.test(q)) throw new XlsxError('XML_BAD_ATTRIBUTE', `nome de atributo inválido: ${q}`, { part });
    if (seen.has(q)) throw new XlsxError('XML_DUPLICATE_ATTRIBUTE', `atributo duplicado: ${q}`, { part });
    seen.add(q); if (++count > L.maxAttributes) throw new XlsxError('XML_TOO_MANY_ATTRIBUTES', 'atributos demais', { part });
    const v = m[3] !== undefined ? m[3] : m[4];
    if (v.includes('<')) throw new XlsxError('XML_BAD_ATTRIBUTE', `'<' em valor de atributo`, { part });
    const loc = localName(q);
    if (!q.startsWith('xmlns')) out[loc] = decodeEntities(v, part); else out[q] = v;
    pos = ATTR.lastIndex;
  }
  return out;
}

/** Constrói uma árvore pequena (para partes pequenas: workbook, rels, content types). */
export function parseXmlTree(xml, limits = {}, part = '?') {
  const root = { local: '#root', children: [], attrs: {}, text: '' }; const st = [root];
  walkXml(xml, {
    open(local, attrs, qname) { const node = { local, qname, attrs, children: [], text: '' }; st[st.length - 1].children.push(node); st.push(node); },
    close() { st.pop(); },
    text(t) { st[st.length - 1].text += t; },
  }, limits, part);
  return root.children[0];
}
