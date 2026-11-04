/**
 * Fachada de hash para uso no NODE (mantém a API original da Fase 3a).
 * Reexporta a camada portável (./sha256-web.js) e a síncrona do Node (./sha256-node.js).
 * Código destinado ao navegador deve importar diretamente './sha256-web.js'.
 * @module integrity/hash
 */
export { toBytes, bytesToHex, isSha256Hex, sha256HexAsync, hashJsonAsync } from './sha256-web.js';
export { sha256Hex, hashJson } from './sha256-node.js';
