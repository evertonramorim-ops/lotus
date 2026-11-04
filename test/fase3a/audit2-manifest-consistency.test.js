// Revisão complementar item 1: buildManifest e validateManifestStructure aplicam a MESMA regra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, verifyManifestDetailed, validateManifestStructure, computeRootHash, isValidDataSchemaVersion, DATA_SCHEMA_VERSION_MAX, hashFile } from '../../src/integrity/manifest.js';

const H = hashFile('SYNTHETIC_DATA');
const params = v => ({ datasetId: 'synthetic.c', dataSchemaVersion: v, sequence: 1, createdAt: '2026-01-01T00:00:00Z', entries: [{ id: 'a', sha256: H }] });
const forgedWith = v => { const m = buildManifest(params('x')); m.dataSchemaVersion = v; m.rootHash = computeRootHash(m); return m; };

test('dataSchemaVersion: limites idênticos no construtor e no verificador', () => {
  assert.equal(DATA_SCHEMA_VERSION_MAX, 128);
  const ok = ['a', 'x'.repeat(128), ' v1 ', 'lotus.result/1.0.0'];
  const bad = ['', ' ', '   ', '\t\n', 'x'.repeat(129), 'x'.repeat(1000), 5, null, undefined, ['v1']];
  for (const v of ok) {
    assert.ok(isValidDataSchemaVersion(v));
    const m = buildManifest(params(v));
    assert.deepEqual(validateManifestStructure(m), []);
  }
  for (const v of bad) {
    assert.equal(isValidDataSchemaVersion(v), false, JSON.stringify(v));
    assert.throws(() => buildManifest(params(v)), TypeError, JSON.stringify(v));
    if (v !== undefined) {
      const r = verifyManifestDetailed(forgedWith(v));
      assert.equal(r.structuralOk, false);
      assert.ok(r.errors.some(e => e.code === 'MANIFEST_DATA_SCHEMA_VERSION_INVALID'));
    }
  }
});

test('consistência (propriedade): todo manifesto construído com sucesso passa estruturalmente em verifyManifest', () => {
  // Gerador determinístico simples (LCG) — sem Math.random, resultado reprodutível.
  let s = 12345; const rnd = n => { s = (s * 1103515245 + 12345) % 2147483648; return Math.floor(s / 65536) % n; };
  const chars = ['a', 'b', 'X', '0', '9', '.', '_', '-', '/', ' ', 'ç', 'ã', '😀', '\t'];
  const str = (min, max) => { let o = ''; const len = min + rnd(max - min + 1); for (let i = 0; i < len; i++) o += chars[rnd(chars.length)]; return o; };
  let built = 0; let rejected = 0;
  for (let i = 0; i < 2000; i++) {
    const p = {
      datasetId: rnd(10) === 0 ? str(0, 5) : 'ds' + rnd(1000) + (rnd(2) ? '.x-y_z' : ''),
      dataSchemaVersion: rnd(6) === 0 ? ' '.repeat(rnd(4)) : str(0, 140),
      sequence: [1, 2, 7, 2 ** 53 - 1, 3, 0][rnd(6)],
      createdAt: ["2026-01-01T00:00:00Z", "2024-02-29T23:59:59.999Z", "2026-01-01T00:00:00Z", "2026-02-30T00:00:00Z"][rnd(4)],
      entries: Array.from({ length: rnd(4) + (rnd(8) ? 1 : 0) }, (_, k) => ({ id: rnd(40) === 0 ? "" : str(1, 6) + k, kind: ["record", "file", undefined, "record", "file", "evil"][rnd(6)], sha256: rnd(40) === 0 ? "zz" : H })),
    };
    let m;
    try { m = buildManifest(p); } catch { rejected++; continue; }
    built++;
    const r = verifyManifestDetailed(m);
    assert.equal(r.structuralOk, true, JSON.stringify(r.errors));
    assert.equal(r.ok, true);
  }
  assert.ok(built > 100 && rejected > 100, `construídos=${built} rejeitados=${rejected}`);
});
