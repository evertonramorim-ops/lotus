/**
 * Armazenamento local append-only (fora do Git) para a importação real.
 * - grava com flag 'wx' (nunca sobrescreve); arquivo já existente só é aceito se byte-idêntico;
 * - ledger de manifestos persistente em JSONL, revalidado por ManifestLedger a cada carga.
 * @module historical/store
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
