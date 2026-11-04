// Utilitários de teste da Fase 3a. Todos os dados são SYNTHETIC_DATA (artificiais).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRawEnvelope } from '../../src/data/raw.js';
export const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, 'fixtures', 'SYNTHETIC_DATA');
export const SYNTH_PROVENANCE = Object.freeze({ sourceType: 'SYNTHETIC_DATA', sourceId: 'lotus-test-fixtures-fase3a', obtainedAt: '2026-01-01T00:00:00Z', note: 'SYNTHETIC_DATA — não é dado real' });
export const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
export const fixtureFiles = () => readdirSync(FIXTURES).filter(f => f.endsWith('.json')).sort();
export const loadValid = id => readJson(join(FIXTURES, `SYNTHETIC_DATA_valid_${id}.json`));
export const loadInvalid = () => readJson(join(FIXTURES, 'SYNTHETIC_DATA_invalid_mixed.json'));
export const env = raw => createRawEnvelope(raw, { provenance: SYNTH_PROVENANCE });
export const validRecord = (lottery, numbers, extra = {}) => ({ schema: 'lotus.result', schemaVersion: '1.0.0', lottery, contest: 1, drawDate: '2020-01-01', numbers, provenance: { ...SYNTH_PROVENANCE }, ...extra });
export const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
