/**
 * SHA-256 com abstração compatível com navegador/PWA.
 * - {@link sha256Hex}: síncrono, usa node:crypto (Node ≥ 20).
 * - {@link sha256HexAsync}: assíncrono, usa WebCrypto (globalThis.crypto.subtle) quando disponível —
 *   mesma API existe nos navegadores modernos; os testes verificam que ambos coincidem.
 * Entrada: string (codificada em UTF-8) ou Uint8Array. Saída: hex minúsculo (64 caracteres).
 * @module integrity/hash
 */
import { createHash } from 'node:crypto';
import { canonicalizeToBytes } from './jcs.js';

/** @param {string|Uint8Array} data @returns {Uint8Array} */
export function toBytes(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  throw new TypeError('sha256: esperado string ou Uint8Array');
}

/** @param {Uint8Array} bytes */
function hex(bytes) { let s = ''; for (const b of bytes) s += b.toString(16).padStart(2, '0'); return s; }

/** SHA-256 síncrono (node:crypto). @param {string|Uint8Array} data @returns {string} */
export function sha256Hex(data) { return createHash('sha256').update(toBytes(data)).digest('hex'); }

/** SHA-256 via WebCrypto. @param {string|Uint8Array} data @returns {Promise<string>} */
export async function sha256HexAsync(data) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('WebCrypto indisponível neste ambiente');
  return hex(new Uint8Array(await subtle.digest('SHA-256', toBytes(data))));
}

/** Hash de um valor JSON: SHA-256(UTF-8(JCS(valor))). @param {unknown} value */
export function hashJson(value) { return sha256Hex(canonicalizeToBytes(value)); }

/** Verifica formato de hash hex SHA-256. @param {unknown} h */
export function isSha256Hex(h) { return typeof h === 'string' && /^[0-9a-f]{64}$/.test(h); }
