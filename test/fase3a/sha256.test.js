// SHA-256 — vetores de resposta conhecida (NIST FIPS 180-4 / CSRC example values).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex, sha256HexAsync, hashJson, isSha256Hex } from '../../src/integrity/hash.js';

const KAT = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
];

test('SHA-256: vetores NIST (vazio, "abc", mensagem de 448 bits)', () => {
  assert.equal(KAT[2][0].length * 8, 448);
  for (const [m, h] of KAT) { assert.equal(sha256Hex(m), h); assert.equal(sha256Hex(new TextEncoder().encode(m)), h); }
});

test('SHA-256: WebCrypto (abstração para navegador/PWA) coincide com node:crypto', async () => {
  for (const [m, h] of KAT) assert.equal(await sha256HexAsync(m), h);
});

test('SHA-256: hashJson = SHA-256(UTF-8(JCS)) e independe da ordem das chaves', () => {
  assert.equal(hashJson({ b: 1, a: 'ç' }), sha256Hex('{"a":"ç","b":1}'));
  assert.equal(hashJson({ a: 'ç', b: 1 }), hashJson({ b: 1, a: 'ç' }));
  assert.ok(isSha256Hex(hashJson([])));
  assert.ok(!isSha256Hex('ABC')); assert.throws(() => sha256Hex(123));
});
