// RFC 8785 (JCS): vetores independentes — RFC 8785 (texto do rfc-editor.org) e cyberphone/json-canonicalization (Apache-2.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, canonicalizeText, canonicalizeToBytes, serializeNumber, serializeString, JcsError, compareUtf16 } from '../../src/integrity/jcs.js';
import { HERE } from './_helpers.js';

const VEC = join(HERE, 'vectors');

test('JCS: RFC 8785 §3.2.2/§3.2.3 — exemplo de primitivos e ordenação', () => {
  const input = '{\n "numbers": [333333333.33333329, 1E30, 4.50,\n 2e-3, 0.000000000000000000000000001],\n "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",\n "literals": [null, true, false]\n}';
  const expected = '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}';
  assert.equal(canonicalizeText(input), expected);
});

test('JCS: RFC 8785 Apêndice B — todos os vetores de serialização numérica (bits IEEE 754)', () => {
  const { rows } = JSON.parse(readFileSync(join(VEC, 'rfc8785-appendix-b.json'), 'utf8'));
  assert.equal(rows.length, 26);
  for (const r of rows) {
    const dv = new DataView(new ArrayBuffer(8)); dv.setBigUint64(0, BigInt('0x' + r.ieee754));
    const n = dv.getFloat64(0);
    if (r.json === null) assert.throws(() => serializeNumber(n), JcsError, r.ieee754);
    else assert.equal(serializeNumber(n), r.json, r.ieee754);
  }
});

test('JCS: vetores cyberphone/json-canonicalization (input → output byte a byte)', () => {
  const dir = join(VEC, 'cyberphone-jcs');
  const files = readdirSync(join(dir, 'input')).sort();
  assert.equal(files.length, 6);
  for (const f of files) {
    const out = canonicalizeToBytes(JSON.parse(readFileSync(join(dir, 'input', f), 'utf8')));
    const exp = new Uint8Array(readFileSync(join(dir, 'output', f)));
    assert.deepEqual(out, exp, f);
  }
});

test('JCS: ordenação por unidades UTF-16 (não por code point nem locale)', () => {
  // U+1F600 (surrogates D83D DE00) < U+FB33 em UTF-16, embora seja maior em code point
  const o = { '\uFB33': 1, '\u{1F600}': 2, a: 3, B: 4, '': 5 };
  assert.equal(canonicalize(o), '{"":5,"B":4,"a":3,"\u{1F600}":2,"\uFB33":1}');
  assert.ok(compareUtf16('\u{1F600}', '\uFB33') < 0);
});

test('JCS: escapes de string e controles', () => {
  assert.equal(serializeString('\b\t\n\f\r"\\\u0001\u001f\u007f/'), '"\\b\\t\\n\\f\\r\\"\\\\\\u0001\\u001f\u007f/"');
});

test('JCS: rejeita valores não-JSON e entradas inválidas (falha explícita)', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, () => 1, Symbol('x'), 1n, new Date(0), new Map(), { a: undefined }, '\uD800', 'a\uDC00b']) {
    assert.throws(() => canonicalize(bad), JcsError);
  }
  const c = {}; c.self = c; assert.throws(() => canonicalize(c), JcsError);
  assert.throws(() => canonicalizeText('{"a":1,"a":2}'), JcsError);
  assert.equal(canonicalizeText('{"a":{"b":1},"c":{"b":2}}'), '{"a":{"b":1},"c":{"b":2}}');
});

test('JCS: -0 → 0, arrays mantêm ordem, objetos aninhados ordenados', () => {
  assert.equal(canonicalize({ z: [3, 1, { y: -0, x: 1e21 }], a: null }), '{"a":null,"z":[3,1,{"x":1e+21,"y":0}]}');
});

test('JCS: determinismo — ordem de inserção das chaves não altera a saída', () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }));
});
