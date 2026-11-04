#!/usr/bin/env node
/**
 * SYNTHETIC_DATA — gera as fixtures XLSX da Fase 3b.2 de forma determinística (mesma saída sempre).
 * Uso: node scripts/gerar-fixtures-fase3b2.mjs [--check]
 * Com --check apenas compara com os arquivos versionados e falha se diferirem.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fixtureCatalog } from '../test/fase3b2/_fixtures.js';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fase3b2', 'fixtures');
const check = process.argv.includes('--check');
mkdirSync(dir, { recursive: true });
const index = {}; let bad = 0;
for (const [name, bytes] of Object.entries(fixtureCatalog())) {
  const file = `SYNTHETIC_DATA_${name}.xlsx`; const p = join(dir, file);
  const sha = createHash('sha256').update(bytes).digest('hex'); index[file] = { sha256: sha, bytes: bytes.length };
  if (check) { if (!existsSync(p) || createHash('sha256').update(readFileSync(p)).digest('hex') !== sha) { console.error('DIFERE:', file); bad++; } }
  else writeFileSync(p, bytes);
}
const idx = JSON.stringify({ note: 'SYNTHETIC_DATA — fixtures geradas por scripts/gerar-fixtures-fase3b2.mjs; nenhum dado real.', files: index }, null, 2) + '\n';
if (check) { if (readFileSync(join(dir, 'INDEX.json'), 'utf8') !== idx) { console.error('INDEX.json difere'); bad++; } }
else writeFileSync(join(dir, 'INDEX.json'), idx);
console.log(check ? (bad ? `FALHA: ${bad} diferença(s)` : 'OK: fixtures idênticas') : `geradas ${Object.keys(index).length} fixtures em ${dir}`);
process.exit(bad ? 1 : 0);
