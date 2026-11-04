/**
 * Leitor ZIP mínimo e defensivo (somente leitura) para pacotes OOXML.
 * Usa APENAS o diretório central (fonte de verdade) e confere cada cabeçalho local.
 * Suporta método 0 (stored) e 8 (deflate, via node:zlib inflateRawSync com maxOutputLength).
 * Rejeita: ZIP64, multi-disco, criptografia, métodos desconhecidos, nomes absolutos/com "..",
 * barra invertida, NUL, letras de unidade, nomes duplicados (inclusive por caixa), entradas
 * sobrepostas, CRC divergente, tamanho declarado divergente, razão de compressão abusiva,
 * total descompactado acima do limite e excesso de entradas. NUNCA altera os bytes de entrada.
 * @module xlsx/zip
 */
import { inflateRawSync } from 'node:zlib';
import { XlsxError } from './errors.js';

export const ZIP_DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 32 * 1024 * 1024,        // arquivo compactado
  maxEntries: 256,
  maxEntryUncompressed: 64 * 1024 * 1024,
  maxTotalUncompressed: 128 * 1024 * 1024,
  maxCompressionRatio: 200,              // por entrada (descompactado / compactado)
  maxNameLength: 512,
});

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
/** CRC-32 (IEEE 802.3) de bytes. */
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Regra de nome interno seguro. @returns {string|null} motivo da rejeição ou null */
export function unsafeEntryName(name) {
  if (name.length === 0) return 'nome vazio';
  if (name.includes('\0')) return 'NUL no nome';
  if (name.includes('\\')) return 'barra invertida';
  if (name.startsWith('/')) return 'caminho absoluto';
  if (/^[A-Za-z]:/.test(name)) return 'letra de unidade';
  if (name.split('/').some(s => s === '..' || s === '.')) return 'segmento . ou ..';
  if (/[\x00-\x1f]/.test(name)) return 'caractere de controle';
  return null;
}

/**
 * Lê a estrutura do ZIP. Não descompacta nada ainda (ver {@link ZipArchive#read}).
 * @param {Uint8Array} bytes @param {Partial<typeof ZIP_DEFAULT_LIMITS>} [limits]
 */
export function openZip(bytes, limits = {}) {
  const L = { ...ZIP_DEFAULT_LIMITS, ...limits };
  if (!(bytes instanceof Uint8Array)) throw new XlsxError('ZIP_INPUT', 'entrada deve ser Uint8Array');
  if (bytes.length > L.maxFileBytes) throw new XlsxError('ZIP_TOO_LARGE', `arquivo com ${bytes.length} bytes excede ${L.maxFileBytes}`);
  if (bytes.length < 22) throw new XlsxError('ZIP_TRUNCATED', 'arquivo menor que o registro EOCD');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new XlsxError('ZIP_SIGNATURE', 'assinatura inicial PK\\x03\\x04 ausente');
  // EOCD: varre de trás para frente (comentário ≤ 65535)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new XlsxError('ZIP_NO_EOCD', 'registro de fim do diretório central não encontrado');
  const disk = dv.getUint16(eocd + 4, true), cdDisk = dv.getUint16(eocd + 6, true);
  const nDisk = dv.getUint16(eocd + 8, true), nTotal = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
  const commentLen = dv.getUint16(eocd + 20, true);
  if (eocd + 22 + commentLen !== bytes.length) throw new XlsxError('ZIP_TRAILING_DATA', 'bytes extras após o EOCD ou comentário inconsistente');
  if (disk !== 0 || cdDisk !== 0 || nDisk !== nTotal) throw new XlsxError('ZIP_MULTIDISK', 'ZIP multi-disco não suportado');
  if (nTotal === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) throw new XlsxError('ZIP64_UNSUPPORTED', 'ZIP64 não suportado');
  if (nTotal > L.maxEntries) throw new XlsxError('ZIP_TOO_MANY_ENTRIES', `${nTotal} entradas excede ${L.maxEntries}`);
  if (cdOff + cdSize !== eocd) throw new XlsxError('ZIP_CD_BOUNDS', 'diretório central fora dos limites esperados');
  const entries = []; const names = new Set(); const lower = new Set();
  let p = cdOff; let totalUncompressed = 0;
  for (let i = 0; i < nTotal; i++) {
    if (p + 46 > eocd || dv.getUint32(p, true) !== 0x02014b50) throw new XlsxError('ZIP_CD_CORRUPT', `entrada ${i} do diretório central corrompida`);
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    if (p + 46 + nlen + xlen + clen > eocd) throw new XlsxError('ZIP_CD_CORRUPT', `entrada ${i} ultrapassa o diretório central`);
    if (nlen > L.maxNameLength) throw new XlsxError('ZIP_NAME_TOO_LONG', `nome da entrada ${i} muito longo`);
    let name;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(p + 46, p + 46 + nlen)); } catch { throw new XlsxError('ZIP_NAME_ENCODING', `nome da entrada ${i} não é UTF-8 válido`); }
    const bad = unsafeEntryName(name);
    if (bad) throw new XlsxError('ZIP_UNSAFE_PATH', `nome interno inseguro (${bad})`, { part: name });
    if (names.has(name) || lower.has(name.toLowerCase())) throw new XlsxError('ZIP_DUPLICATE_ENTRY', 'entrada duplicada', { part: name });
    names.add(name); lower.add(name.toLowerCase());
    if (flags & 0x1) throw new XlsxError('ZIP_ENCRYPTED', 'entrada criptografada', { part: name });
    if (method !== 0 && method !== 8) throw new XlsxError('ZIP_METHOD', `método de compressão ${method} não suportado`, { part: name });
    if (usize === 0xffffffff || csize === 0xffffffff || lho === 0xffffffff) throw new XlsxError('ZIP64_UNSUPPORTED', 'ZIP64 não suportado', { part: name });
    if (usize > L.maxEntryUncompressed) throw new XlsxError('ZIP_ENTRY_TOO_LARGE', `entrada declara ${usize} bytes`, { part: name });
    if (method === 0 && csize !== usize) throw new XlsxError('ZIP_SIZE_MISMATCH', 'stored com tamanhos diferentes', { part: name });
    if (usize > 0 && usize / Math.max(csize, 1) > L.maxCompressionRatio) throw new XlsxError('ZIP_BOMB_RATIO', `razão ${Math.round(usize / Math.max(csize, 1))} excede ${L.maxCompressionRatio}`, { part: name });
    totalUncompressed += usize;
    if (totalUncompressed > L.maxTotalUncompressed) throw new XlsxError('ZIP_BOMB_TOTAL', `total descompactado declarado excede ${L.maxTotalUncompressed}`, { part: name });
    // cabeçalho local
    if (lho + 30 > cdOff || dv.getUint32(lho, true) !== 0x04034b50) throw new XlsxError('ZIP_LOCAL_HEADER', 'cabeçalho local ausente/corrompido', { part: name });
    const lnlen = dv.getUint16(lho + 26, true), lxlen = dv.getUint16(lho + 28, true);
    const lname = bytes.subarray(lho + 30, lho + 30 + lnlen);
    if (lnlen !== nlen || !lname.every((b, k) => b === bytes[p + 46 + k])) throw new XlsxError('ZIP_NAME_MISMATCH', 'nome do cabeçalho local difere do diretório central', { part: name });
    if (dv.getUint16(lho + 8, true) !== method) throw new XlsxError('ZIP_METHOD_MISMATCH', 'método local difere do central', { part: name });
    const dataStart = lho + 30 + lnlen + lxlen;
    if (dataStart + csize > cdOff) throw new XlsxError('ZIP_DATA_BOUNDS', 'dados da entrada ultrapassam o diretório central', { part: name });
    entries.push({ name, method, crc, compressedSize: csize, uncompressedSize: usize, localHeaderOffset: lho, dataStart, dataEnd: dataStart + csize, isDirectory: name.endsWith('/') });
    p += 46 + nlen + xlen + clen;
  }
  if (p !== eocd) throw new XlsxError('ZIP_CD_CORRUPT', 'tamanho do diretório central inconsistente');
  const sorted = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].localHeaderOffset < sorted[i - 1].dataEnd) throw new XlsxError('ZIP_OVERLAP', 'entradas sobrepostas', { part: sorted[i].name });
  return new ZipArchive(bytes, entries, L, totalUncompressed);
}

export class ZipArchive {
  #bytes; #L; #byName;
  constructor(bytes, entries, L, declaredTotal) {
    this.#bytes = bytes; this.#L = L; this.entries = Object.freeze(entries.map(e => Object.freeze(e)));
    this.#byName = new Map(entries.map(e => [e.name, e])); this.declaredTotalUncompressed = declaredTotal; this.inflatedTotal = 0;
  }
  has(name) { return this.#byName.has(name); }
  names() { return this.entries.map(e => e.name); }
  /** Descompacta UMA entrada (cópia), conferindo tamanho real e CRC. */
  read(name) {
    const e = this.#byName.get(name);
    if (!e) throw new XlsxError('ZIP_ENTRY_MISSING', 'entrada inexistente', { part: name });
    const src = this.#bytes.subarray(e.dataStart, e.dataEnd);
    let out;
    if (e.method === 0) out = new Uint8Array(src);
    else {
      try { out = new Uint8Array(inflateRawSync(src, { maxOutputLength: Math.max(1, e.uncompressedSize) + 1 })); }
      catch (err) { throw new XlsxError(err && err.code === 'ERR_BUFFER_TOO_LARGE' ? 'ZIP_BOMB_ACTUAL' : 'ZIP_INFLATE', `falha ao descompactar: ${err && err.message}`, { part: name }); }
    }
    if (out.length !== e.uncompressedSize) throw new XlsxError(out.length > e.uncompressedSize ? 'ZIP_BOMB_ACTUAL' : 'ZIP_SIZE_MISMATCH', `tamanho real ${out.length} ≠ declarado ${e.uncompressedSize}`, { part: name });
    if (crc32(out) !== e.crc) throw new XlsxError('ZIP_CRC', 'CRC-32 divergente', { part: name });
    this.inflatedTotal += out.length;
    if (this.inflatedTotal > this.#L.maxTotalUncompressed) throw new XlsxError('ZIP_BOMB_TOTAL', 'total descompactado excede o limite', { part: name });
    return out;
  }
}
