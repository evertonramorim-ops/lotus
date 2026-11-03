// Auditoria item 1: validação estrutural completa do manifesto, distinta da integridade do hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, verifyManifest, verifyManifestDetailed, validateManifestStructure, computeRootHash, ManifestLedger, hashFile } from '../../src/integrity/manifest.js';

const H = hashFile('SYNTHETIC_DATA');
const good = () => buildManifest({ datasetId: 'synthetic.audit', dataSchemaVersion: 'lotus.result/1.0.0', sequence: 1, createdAt: '2026-01-01T00:00:00Z', entries: [{ id: 'a', sha256: H }, { id: 'b', kind: 'file', sha256: H }] });
/** Aplica mutação e RECALCULA o rootHash (simula atacante/construção manual). */
const forged = mut => { const m = structuredClone(good()); mut(m); try { m.rootHash = computeRootHash(m); } catch { /* não canonicalizável */ } return m; };

const CASES = [
  ['entries: [null]', m => { m.entries = [null]; }, 'ENTRY_NOT_OBJECT'],
  ['entrada sem id', m => { delete m.entries[0].id; }, 'ENTRY_MISSING_FIELD'],
  ['id numérico', m => { m.entries[0].id = 1; }, 'ENTRY_ID_INVALID'],
  ['id vazio', m => { m.entries[0].id = ''; }, 'ENTRY_ID_INVALID'],
  ['kind "evil"', m => { m.entries[0].kind = 'evil'; }, 'ENTRY_KIND_INVALID'],
  ['kind ausente', m => { delete m.entries[0].kind; }, 'ENTRY_MISSING_FIELD'],
  ['sha inválido (curto)', m => { m.entries[0].sha256 = 'abc'; }, 'ENTRY_SHA256_INVALID'],
  ['sha maiúsculo', m => { m.entries[0].sha256 = H.toUpperCase(); }, 'ENTRY_SHA256_INVALID'],
  ['sha numérico', m => { m.entries[0].sha256 = 123; }, 'ENTRY_SHA256_INVALID'],
  ['ids duplicados', m => { m.entries[1].id = 'a'; }, 'ENTRY_ID_DUPLICATE'],
  ['ordem UTF-16 invertida', m => { m.entries.reverse(); }, 'MANIFEST_ENTRIES_NOT_SORTED_OR_DUPLICATE'],
  ['campo extra na entrada', m => { m.entries[0].x = 1; }, 'ENTRY_UNKNOWN_FIELD'],
  ['entrada array', m => { m.entries[0] = ['a']; }, 'ENTRY_NOT_OBJECT'],
  ['datasetId ausente', m => { delete m.datasetId; }, 'MANIFEST_MISSING_FIELD'],
  ['datasetId inválido', m => { m.datasetId = 'Inválido!'; }, 'MANIFEST_DATASET_ID_INVALID'],
  ['datasetId vazio', m => { m.datasetId = ''; }, 'MANIFEST_DATASET_ID_INVALID'],
  ['datasetId numérico', m => { m.datasetId = 5; }, 'MANIFEST_DATASET_ID_INVALID'],
  ['dataSchemaVersion ausente', m => { delete m.dataSchemaVersion; }, 'MANIFEST_MISSING_FIELD'],
  ['dataSchemaVersion vazio', m => { m.dataSchemaVersion = '  '; }, 'MANIFEST_DATA_SCHEMA_VERSION_INVALID'],
  ['entries vazio', m => { m.entries = []; }, 'MANIFEST_ENTRIES_INVALID'],
  ['entries objeto', m => { m.entries = { a: 1 }; }, 'MANIFEST_ENTRIES_INVALID'],
  ['entries ausente', m => { delete m.entries; }, 'MANIFEST_MISSING_FIELD'],
  ['sequence 0', m => { m.sequence = 0; }, 'MANIFEST_SEQUENCE_INVALID'],
  ['sequence texto', m => { m.sequence = '2'; }, 'MANIFEST_SEQUENCE_INVALID'],
  ['sequence não seguro', m => { m.sequence = 2 ** 53; }, 'MANIFEST_SEQUENCE_INVALID'],
  ['createdAt inválido', m => { m.createdAt = '2026-02-30T00:00:00Z'; }, 'MANIFEST_CREATED_AT_INVALID'],
  ['createdAt sem Z', m => { m.createdAt = '2026-01-01T00:00:00'; }, 'MANIFEST_CREATED_AT_INVALID'],
  ['campo desconhecido', m => { m.extra = true; }, 'MANIFEST_UNKNOWN_FIELD'],
  ['schemaVersion errada', m => { m.schemaVersion = '9.9.9'; }, 'MANIFEST_SCHEMA_VERSION'],
  ['hashAlgorithm errado', m => { m.hashAlgorithm = 'md5'; }, 'MANIFEST_ALGORITHM'],
];

test('controle: manifesto bom é estrutural e criptograficamente válido', () => {
  const r = verifyManifestDetailed(good());
  assert.deepEqual(r, { ok: true, structuralOk: true, hashOk: true, errors: [] });
  assert.equal(new ManifestLedger().submit(good()).accepted, true);
});

for (const [name, mut, code] of CASES) {
  test(`manifesto forjado com rootHash recalculado — ${name} → ${code} e Ledger rejeita`, () => {
    const m = forged(mut);
    const r = verifyManifestDetailed(m);
    assert.equal(r.ok, false); assert.equal(r.structuralOk, false);
    assert.ok(r.errors.some(e => e.code === code), JSON.stringify(r.errors));
    if (r.hashOk !== null) assert.equal(r.hashOk, true, 'o hash foi recalculado: integridade OK, estrutura inválida');
    assert.equal(verifyManifest(m).ok, false);
    const s = new ManifestLedger().submit(m);
    assert.equal(s.accepted, false); assert.equal(s.code, 'INVALID_MANIFEST');
  });
}

test('entradas totalmente malformadas não lançam exceção e retornam erros estruturados', () => {
  for (const bad of [null, undefined, 42, 'x', [], [1], new Date(0), { entries: [null] }, { entries: [{ id: {} }] }, { rootHash: 1n }]) {
    let r; assert.doesNotThrow(() => { r = verifyManifestDetailed(bad); });
    assert.equal(r.ok, false); assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
    assert.doesNotThrow(() => validateManifestStructure(bad));
    assert.equal(new ManifestLedger().submit(bad).accepted, false);
  }
  const withContents = verifyManifestDetailed(forged(m => { m.entries = [null]; }), new Map());
  assert.equal(withContents.ok, false);
});
