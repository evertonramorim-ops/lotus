// Garantias estáticas: módulos da Fase 3b.2 não acessam rede nem relógio; fixtures marcadas SYNTHETIC_DATA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('../../', import.meta.url).pathname;
const files = d => readdirSync(join(root, d), { recursive: true }).filter(f => f.endsWith('.js')).map(f => join(root, d, f));

test('src/xlsx e src/historical: sem rede, sem processos filhos, sem relógio/aleatoriedade', () => {
  for (const f of [...files('src/xlsx'), ...files('src/historical')]) {
    const s = readFileSync(f, 'utf8');
    for (const re of [/node:https?/, /\bfetch\s*\(/, /node:net/, /node:child_process/, /XMLHttpRequest/, /Date\.now\(/, /new Date\(\)/, /Math\.random/]) assert.equal(re.test(s), false, `${f}: ${re}`);
  }
});

test('somente store.js toca o sistema de arquivos', () => {
  for (const f of [...files('src/xlsx'), ...files('src/historical')]) if (!f.endsWith('store.js')) assert.equal(/node:fs/.test(readFileSync(f, 'utf8')), false, f);
});

test('fixtures: todas com prefixo SYNTHETIC_DATA', () => {
  for (const f of readdirSync(join(root, 'test/fase3b2/fixtures'))) assert.ok(f === 'INDEX.json' || f.startsWith('SYNTHETIC_DATA_'), f);
});
