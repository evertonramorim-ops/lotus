/**
 * SHA-256 — camada PORTÁVEL (sem nenhuma importação `node:*`).
 * Usa somente APIs padronizadas também presentes em navegadores modernos: TextEncoder e
 * WebCrypto (`globalThis.crypto.subtle.digest`, assíncrono). Um teste automatizado varre este
 * arquivo e seu grafo de importações (inclui ./jcs.js) e falha se aparecer `node:`.
 * Não se afirma compatibilidade completa com PWA: apenas que este módulo não depende do Node.
 *
 * API: toBytes(data) · bytesToHex(bytes) · isSha256Hex(h) · sha256HexAsync(data) · hashJsonAsync(value)
 * @module integrity/sha256-web
 */
import { canonicalizeToBytes } from './jcs.js';

/** @param {string|Uint8Array} data @returns {Uint8Array} string → UTF-8 */
export function toBytes(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  throw new TypeError('sha256: esperado string ou Uint8Array');
}

/** @param {Uint8Array} bytes @returns {string} hex minúsculo */
export function bytesToHex(bytes) { let s = ''; for (const b of bytes) s += b.toString(16).padStart(2, '0'); return s; }

/** Exatamente 64 caracteres hex minúsculos. @param {unknown} h */
export function isSha256Hex(h) { return typeof h === 'string' && /^[0-9a-f]{64}$/.test(h); }

/** SHA-256 via WebCrypto. @param {string|Uint8Array} data @returns {Promise<string>} */
export async function sha256HexAsync(data) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('WebCrypto (crypto.subtle) indisponível neste ambiente');
  return bytesToHex(new Uint8Array(await subtle.digest('SHA-256', toBytes(data))));
}

/** SHA-256(UTF-8(JCS(value))) assíncrono. @returns {Promise<string>} */
export async function hashJsonAsync(value) { return sha256HexAsync(canonicalizeToBytes(value)); }
