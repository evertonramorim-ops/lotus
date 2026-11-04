// Auditoria item 3: camada portável sem `node:*` e equivalência com a implementação Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import * as web from '../../src/integrity/sha256-web.js';
import * as nodeImpl from '../../src/integrity/sha256-node.js';
import * as facade from '../../src/integrity/hash.js';
import { HERE } from './_helpers.js';

const SRC = resolve(HERE, '../../src/integrity');
const IMPORT_RE = /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function importGraph(entry) {
  const seen = new Set(); const specs = []; const stack = [entry];
  while (stack.length) {
    const f = stack.pop(); if (seen.has(f)) continue; seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const s = m[1] ?? m[2] ?? m[3] ?? m[4]; specs.push({ file: f, spec: s });
      if (s.startsWith('.')) stack.push(resolve(dirname(f), s));
    }
  }
  return { files: [...seen], specs };
}

test('navegador: sha256-web.js e todo o seu grafo de importações não importam node:* nem módulos nus', () => {
  const g = importGraph(join(SRC, 'sha256-web.js'));
  assert.ok(g.files.some(f => f.endsWith('jcs.js')), 'grafo deve incluir jcs.js');
  for (const { file, spec } of g.specs) assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${file} importa ${spec}`);
  for (const f of g.files) assert.doesNotMatch(readFileSync(f, 'utf8'), /['"]node:/, f);
});

test('detector de importações funciona (controle positivo: sha256-node.js importa node:crypto)', () => {
  const g = importGraph(join(SRC, 'sha256-node.js'));
  assert.ok(g.specs.some(s => s.spec === 'node:crypto'));
});

test('equivalência: WebCrypto (web) = node:crypto (node) para strings, bytes e JSON', async () => {
  const inputs = ['', 'abc', 'ç😀\u0000', new Uint8Array([0, 1, 255]), new Uint8Array(1000).fill(7), 'x'.repeat(100000)];
  for (const i of inputs) assert.equal(await web.sha256HexAsync(i), nodeImpl.sha256Hex(i));
  for (const v of [{ b: 1, a: [1, 'z'] }, [], null, 'ç']) assert.equal(await web.hashJsonAsync(v), nodeImpl.hashJson(v));
  assert.equal(facade.sha256Hex, nodeImpl.sha256Hex); assert.equal(facade.sha256HexAsync, web.sha256HexAsync);
  assert.ok(web.isSha256Hex('a'.repeat(64)) && !web.isSha256Hex('A'.repeat(64)) && !web.isSha256Hex('a'.repeat(63)));
});
