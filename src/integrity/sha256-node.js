/**
 * SHA-256 — implementação SÍNCRONA específica do Node (node:crypto). NÃO usar no navegador.
 * Produz exatamente os mesmos hashes que ./sha256-web.js (testado).
 * API: sha256Hex(data) · hashJson(value)
 * @module integrity/sha256-node
 */
import { createHash } from 'node:crypto';
import { toBytes } from './sha256-web.js';
import { canonicalizeToBytes } from './jcs.js';

/** @param {string|Uint8Array} data @returns {string} */
export function sha256Hex(data) { return createHash('sha256').update(toBytes(data)).digest('hex'); }

/** SHA-256(UTF-8(JCS(value))) síncrono. */
export function hashJson(value) { return sha256Hex(canonicalizeToBytes(value)); }
