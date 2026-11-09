/**
 * Armazenamento local append-only (fora do Git) para a importação real.
 * - grava com flag 'wx' (nunca sobrescreve); arquivo já existente só é aceito se byte-idêntico;
 * - ledger de manifestos persistente em JSONL, revalidado por ManifestLedger a cada carga.
 * @module historical/store
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { ManifestLedger } from '../integrity/manifest.js';

export function writeOnce(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  if (existsSync(path)) {
    if (Buffer.compare(readFileSync(path), buf) === 0) return 'EXISTING_IDENTICAL';
    throw new Error(`recusa de sobrescrita: ${path} já existe com conteúdo diferente`);
  }
  writeFileSync(path, buf, { flag: 'wx' });
  return 'WRITTEN';
}
export const writeJsonOnce = (path, obj) => writeOnce(path, JSON.stringify(obj, null, 2) + '\n');

/** Ledger persistente: cada manifesto aceito vira uma linha; a carga revalida a cadeia inteira. */
export class FileLedger {
  constructor(path) {
    this.path = resolve(path); this.ledger = new ManifestLedger();
    if (existsSync(this.path)) for (const [i, line] of readFileSync(this.path, 'utf8').split('\n').filter(Boolean).entries()) {
      const r = this.ledger.submit(JSON.parse(line));
      if (!r.accepted) throw new Error(`ledger corrompido na linha ${i + 1}: ${r.code}`);
    }
  }
  latest(id) { return this.ledger.latest(id); }
  submit(m) {
    const r = this.ledger.submit(m);
    if (r.accepted) { mkdirSync(dirname(this.path), { recursive: true }); appendFileSync(this.path, JSON.stringify(m) + '\n'); }
    return r;
  }
  history(id) { return this.ledger.history.get(id) ?? []; }
}
export const privatePaths = root => ({
  root, raw: join(root, 'raw'), runs: join(root, 'runs'), ledger: join(root, 'ledger', 'manifests.jsonl'),
  json: join(root, 'json'), requestLog: join(root, 'request_log.jsonl'), reconciliation: join(root, 'reconciliation'),
});

/**
 * Caminho RELATIVO seguro (vindo de plano ou log): sem absoluto, "..", ".", "\\", NUL, ":" ou segmento vazio;
 * opcionalmente obrigado a começar por `prefix`. Função pura (não toca o disco).
 * @returns {{ok:true, path:string}|{ok:false, reason:string}}
 */
export function safeRelativePath(rel, { prefix = '' } = {}) {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 512) return { ok: false, reason: 'CAMINHO_INVALIDO' };
  if (rel.includes('\0') || rel.includes('\\') || rel.includes(':')) return { ok: false, reason: 'CARACTERE_PROIBIDO_NO_CAMINHO' };
  if (rel.startsWith('/') || isAbsolute(rel)) return { ok: false, reason: 'CAMINHO_ABSOLUTO' };
  const segs = rel.split('/');
  if (segs.some(x => x === '' || x === '.' || x === '..')) return { ok: false, reason: 'SEGMENTO_PROIBIDO_NO_CAMINHO' };
  if (prefix && !rel.startsWith(prefix)) return { ok: false, reason: 'FORA_DO_SUBDIRETORIO_PREVISTO' };
  return { ok: true, path: rel };
}
/** Junta `root` + caminho relativo seguro e confirma (após resolve) que o resultado continua DENTRO de `root`. */
export function safeJoin(root, rel, opt) {
  const r = safeRelativePath(rel, opt); if (!r.ok) throw new Error(`caminho recusado (${r.reason}): ${JSON.stringify(rel)}`);
  const base = resolve(root); const full = resolve(base, r.path); const d = relative(base, full);
  if (!d || d.startsWith('..') || isAbsolute(d) || d.split(sep).includes('..')) throw new Error(`caminho recusado (FORA_DA_RAIZ): ${JSON.stringify(rel)}`);
  return full;
}
