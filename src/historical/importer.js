/**
 * Pipeline de importação XLSX (camadas A→B→C→D), DETERMINÍSTICO: sem relógio, sem aleatoriedade,
 * sem rede. A mesma entrada produz exatamente o mesmo resultado lógico.
 * Nunca descarta: todo registro termina ACEITO, DUPLICATA IDÊNTICA (registrada, não duplicada) ou
 * em QUARENTENA (reutiliza createQuarantineEntry da Fase 3a). Linha inválida nunca descarta linha válida do mesmo
 * concurso (V11 1.1.0). Lacunas viram entradas CONCURSO_AUSENTE, uma por INTERVALO compacto (V12 1.1.0).
 * @module historical/importer
 */
import { createRawEnvelope, rawBytes, verifyRawEnvelopeDetailed } from '../data/raw.js';
import { createQuarantineEntry } from '../data/quarantine.js';
import { RESULT_SCHEMA, RESULT_SCHEMA_VERSION } from '../data/schema.js';
import { validateResultRecord } from '../validation/result.js';
import { hashJson } from '../integrity/hash.js';
import { parseXlsx, XLSX_PARSER_ID, XLSX_PARSER_VERSION } from '../xlsx/workbook.js';
import { XlsxError } from '../xlsx/errors.js';
import { getXlsxAdapter } from './adapters/index.js';
import { extractWithAdapter } from './extract.js';
import { normalizeRow, HISTORICAL_SCHEMA, HISTORICAL_SCHEMA_VERSION } from './normalize.js';
import { validateRecord, validateDataset, schemaIssues, VALIDATORS_ID, VALIDATORS_VERSION, VALIDATORS, GAP_FORMAT } from './validators.js';
import { TIER_RULES_ID, TIER_RULES_VERSION } from './tier-rules.js';
import { createCollectionRecord, validateCollectionRecord, validateCollectionEnvelopeLink, XLSX_MEDIA_TYPE } from './collection.js';
import { Q, A, REVIEW_PENDING } from './codes.js';

/** Remove `undefined` (não-JSON) antes de entregar à quarentena da Fase 3a. */
const clean = v => JSON.parse(JSON.stringify(v));
const qe = o => createQuarantineEntry(clean(o));

export const IMPORT_REPORT_SCHEMA = 'lotus.import-report';
// 2.0.0 (incompatível): coverage.missing (lista de concursos) → coverage.missingRanges [{from,to,count}] + missingCount
// (formato lotus.gap-ranges/1.0.0); uma entrada de quarentena CONCURSO_AUSENTE por INTERVALO; counts.invalidDuplicates.
export const IMPORT_REPORT_SCHEMA_VERSION = '2.0.0';

/** Cria envelope (camada A) + registro de coleta a partir dos bytes e metadados HTTP. */
export function captureRaw(bytes, meta) {
  const provenance = { sourceType: meta.sourceType, sourceId: meta.url, obtainedAt: meta.collectedAt, note: `${meta.sourceType === 'SYNTHETIC_DATA' ? 'SYNTHETIC_DATA — ' : ''}coleta ${meta.collectionRunId}; Content-Type observado: ${meta.contentType ?? 'n/d'}` };
  const envelope = createRawEnvelope(bytes, { mediaType: XLSX_MEDIA_TYPE, provenance });
  const collection = createCollectionRecord({ ...meta, byteLength: envelope.byteLength, sha256: envelope.sha256, envelopeSha256: envelope.envelopeSha256 });
  return { envelope, collection };
}

const parserTag = spec => `${XLSX_PARSER_ID}/${XLSX_PARSER_VERSION}+${spec.adapterId}/${spec.version}`;

/** Converte registro histórico aceito no registro canônico `lotus.result` da Fase 3a (reuso). */
export function toResultRecord(rec, collection) {
  return { schema: RESULT_SCHEMA, schemaVersion: RESULT_SCHEMA_VERSION, lottery: rec.lottery, contest: rec.contest, drawDate: rec.drawDate, numbers: rec.numbers,
    provenance: { sourceType: collection.sourceType, sourceId: `xlsx:${rec.source.rawSha256}#${rec.source.sheet}!${rec.source.row}`, obtainedAt: collection.collectedAt, note: `${collection.url}` } };
}

/**
 * @param {{envelope:object, collection:object, lottery:string, limits?:object}} p
 */
export function importXlsx({ envelope, collection, lottery, limits }) {
  const spec = getXlsxAdapter(lottery);
  const ev = verifyRawEnvelopeDetailed(envelope);
  const cv = validateCollectionRecord(collection);
  const lv = validateCollectionEnvelopeLink(collection, envelope, lottery);
  const base = { lottery, adapter: { id: spec.adapterId, version: spec.version }, parser: { id: XLSX_PARSER_ID, version: XLSX_PARSER_VERSION }, schema: `${HISTORICAL_SCHEMA}/${HISTORICAL_SCHEMA_VERSION}`, validators: `${VALIDATORS_ID}/${VALIDATORS_VERSION}`, tierRules: `${TIER_RULES_ID}/${TIER_RULES_VERSION}` };
  const reasonBase = { lottery, reviewStatus: REVIEW_PENDING, humanDecision: null };
  if (!ev.ok || !cv.valid || !lv.valid) {
    const q = qe({ rawSha256: envelope && envelope.sha256 || null, stage: 'parse', parserVersion: parserTag(spec), candidate: null,
      reasons: [{ code: Q.INTEGRIDADE_ORIGEM, message: 'envelope bruto/registro de coleta inválido ou não correspondente', ...reasonBase, evidence: { envelopeErrors: ev.errors.map(e => e.code), collectionErrors: cv.errors, linkErrors: lv.errors } }] });
    return finish({ base, collection, status: 'REJECTED', quarantine: [q], accepted: [], items: [], ds: null, extraction: null, parsed: null, spec, emptyRows: 0 });
  }
  const bytes = rawBytes(envelope);
  let parsed;
  try { parsed = parseXlsx(bytes, limits); }
  catch (err) {
    if (!(err instanceof XlsxError)) throw err;
    const q = qe({ rawSha256: envelope.sha256, stage: 'parse', parserVersion: parserTag(spec), candidate: null,
      reasons: [{ code: Q.ARQUIVO_INCOMPATIVEL, message: err.message, ...reasonBase, evidence: { parserErrorCode: err.code, part: err.ctx.part ?? null } }] });
    return finish({ base, collection, status: 'REJECTED', quarantine: [q], accepted: [], items: [], ds: null, extraction: null, parsed: null, spec, emptyRows: 0, parserError: { code: err.code, message: err.message } });
  }
  const extraction = extractWithAdapter(parsed, spec);
  const sIssues = schemaIssues(extraction.schemaAnalysis).map(i => ({ ...i, ...reasonBase }));
  const quarantine = [];
  if (sIssues.length) quarantine.push(qe({ rawSha256: envelope.sha256, stage: 'parse', parserVersion: parserTag(spec), candidate: null, reasons: sIssues }));
  if (!extraction.compatible) return finish({ base, collection, status: 'REJECTED', quarantine, accepted: [], items: [], ds: null, extraction, parsed, spec, emptyRows: 0 });
  const src = { rawSha256: envelope.sha256, fileName: collection.originalFileName, parser: parsed.parser, date1904: parsed.date1904 };
  const items = []; let emptyRows = 0;
  for (const row of extraction.rows) {
    if (row.emptyRow) { emptyRows++; continue; }
    const rec = normalizeRow(row, spec, src);
    const v = validateRecord(rec, { adapter: spec, rawSha256: envelope.sha256 });
    items.push({ rec, v, recordSha256: hashJson(clean(rec)) });
  }
  const ds = validateDataset(items, lottery);
  // agrega motivos por linha
  const reasonsByRow = new Map(); const stageByRow = new Map();
  const addReason = (it, r, stage) => { const k = it.rec.source.row; if (!reasonsByRow.has(k)) reasonsByRow.set(k, []); reasonsByRow.get(k).push(r); if (stage === 'dataset' || !stageByRow.has(k)) stageByRow.set(k, stage); };
  const ev2 = (it, extra) => ({ ...reasonBase, contest: it.rec.contest, evidence: { rawSha256: envelope.sha256, sheet: it.rec.source.sheet, row: it.rec.source.row, ...(extra || {}) } });
  for (const it of items) for (const iss of it.v.issues) if (iss.blocking) addReason(it, { ...iss, ...ev2(it, iss.evidence), anomalyType: iss.code, interpretedValue: iss.interpretedValue ?? null, originalValue: iss.originalValue ?? null }, iss.code === Q.CELULA_TIPO_INVALIDO ? 'normalize' : 'validate');
  const byRow = new Map(items.map(it => [it.rec.source.row, it]));
  for (const c of ds.conflicts) for (const row of c.rows) addReason(byRow.get(row), { code: Q.CONCURSO_DUPLICADO_CONFLITANTE, message: `concurso ${c.contest} em ${c.rows.length} linhas com conteúdo diferente`, anomalyType: Q.CONCURSO_DUPLICADO_CONFLITANTE, validatorId: c.validatorId, validatorVersion: c.validatorVersion, rule: 'V11/V14', ...ev2(byRow.get(row), { rows: c.rows, diffs: c.diffs, canonicalSha256: c.canonicalSha256 }) }, 'dataset');
  for (const d of ds.dateAnomalies) addReason(byRow.get(d.row), { code: Q.DATA_NAO_MONOTONICA, message: `data ${d.raw} (${d.interpreted}) quebra a ordem cronológica (${d.classification})`, anomalyType: Q.DATA_NAO_MONOTONICA, validatorId: d.validatorId, validatorVersion: d.validatorVersion, rule: 'V13', originalValue: d.raw, interpretedValue: d.interpreted, ...ev2(byRow.get(d.row), { ref: d.ref, previous: d.previous ?? null, next: d.next ?? null, pair: d.pair ?? null, classification: d.classification }) }, 'dataset');
  // contexto de duplicata de linha inelegível: anexado à evidência de cada motivo próprio (não cria motivo novo)
  for (const d of ds.invalidDuplicates) for (const r of reasonsByRow.get(d.row) ?? []) r.evidence = { ...r.evidence, duplicateContext: { groupRows: d.groupRows, eligibleRows: d.eligibleRows, keptRow: d.keptRow, referenceRow: d.referenceRow, referenceEligible: d.referenceEligible, sameCanonicalAsReference: d.sameCanonicalAsReference, diffsVsReference: d.diffsVsReference, validatorId: d.validatorId, validatorVersion: d.validatorVersion } };
  const dupRows = new Set(ds.duplicatesIdentical.flatMap(d => d.duplicateRows));
  const accepted = [];
  for (const it of items) {
    const row = it.rec.source.row;
    if (reasonsByRow.has(row)) { quarantine.push(qe({ rawSha256: envelope.sha256, stage: stageByRow.get(row), parserVersion: parserTag(spec), reasons: reasonsByRow.get(row), candidate: it.rec })); continue; }
    if (dupRows.has(row)) continue; // registrada em duplicatesIdentical; não cria segundo concurso
    const result = toResultRecord(it.rec, collection);
    const r3a = validateResultRecord(result);
    if (!r3a.valid) { quarantine.push(qe({ rawSha256: envelope.sha256, stage: 'validate', parserVersion: parserTag(spec), candidate: it.rec, reasons: r3a.errors.map(e => ({ ...e, ...ev2(it), validatorId: 'FASE3A.validateResultRecord' })) })); continue; }
    accepted.push({ record: it.rec, recordSha256: it.recordSha256, result, resultSha256: hashJson(result), annotations: it.v.annotations.map(a => a.code), ruleStatus: it.v.ruleStatus, ...(it.v.annotations.some(a => a.code === A.CURRENCY_PRE_REAL_NOT_VERIFIED) ? { unidadeMonetariaVerificada: false } : {}) });
  }
  for (const g of ds.gapRanges) quarantine.push(qe({ rawSha256: envelope.sha256, stage: 'dataset', parserVersion: parserTag(spec), candidate: null,
    reasons: [{ code: Q.CONCURSO_AUSENTE, message: g.count === 1 ? `concurso ${g.from} ausente no arquivo (lacuna não resolvida; não se presume erro da fonte)` : `concursos ${g.from}–${g.to} (${g.count}) ausentes no arquivo (lacuna não resolvida; não se presume erro da fonte)`, anomalyType: Q.CONCURSO_AUSENTE, validatorId: 'V12', validatorVersion: VALIDATORS.V12.version, rule: 'V12', ...reasonBase, contest: g.from, contestRange: { from: g.from, to: g.to, count: g.count, format: GAP_FORMAT }, resolution: 'LACUNA_NAO_RESOLVIDA', evidence: { rawSha256: envelope.sha256 } }] }));
  return finish({ base, collection, status: 'IMPORTED', quarantine, accepted, items, ds, extraction, parsed, spec, emptyRows });
}

function finish({ base, collection, status, quarantine, accepted, items, ds, extraction, parsed, spec, emptyRows, parserError }) {
  const quarantinedRows = quarantine.filter(q => q.candidate !== null).length;
  const codeCounts = {}; for (const q of quarantine) for (const r of q.reasons) codeCounts[r.code] = (codeCounts[r.code] || 0) + 1;
  const annCounts = {}; for (const a of accepted) for (const c of a.annotations) annCounts[c] = (annCounts[c] || 0) + 1;
  const coverage = computeCoverage(items, accepted, quarantine, ds);
  const report = {
    schema: IMPORT_REPORT_SCHEMA, schemaVersion: IMPORT_REPORT_SCHEMA_VERSION, status, ...base,
    file: { sha256: collection.sha256, envelopeSha256: collection.envelopeSha256, collectionSha256: collection.collectionSha256, originalFileName: collection.originalFileName, byteLength: collection.byteLength, url: collection.url, collectedAt: collection.collectedAt, sourceType: collection.sourceType },
    sheet: extraction ? extraction.sheet : null, parserError: parserError ?? null,
    schemaAlerts: extraction ? extraction.schemaAnalysis.alerts.map(a => a.code) : [],
    ignoredParts: parsed ? parsed.ignoredParts : [],
    counts: {
      rowsExtracted: extraction ? extraction.rows.length : 0, emptyRows, normalized: items.length, accepted: accepted.length,
      quarantinedRecords: quarantinedRows, quarantineEntries: quarantine.length, duplicatesIdentical: ds ? ds.duplicatesIdentical.reduce((s, d) => s + d.duplicateRows.length, 0) : 0,
      conflictingContests: ds ? ds.conflicts.length : 0, invalidDuplicates: ds ? ds.invalidDuplicates.length : 0, missingContests: ds ? ds.missingCount : 0, missingRanges: ds ? ds.gapRanges.length : 0, dateAnomalies: ds ? ds.dateAnomalies.length : 0,
    },
    quarantineReasonCounts: sortObj(codeCounts), annotationCounts: sortObj(annCounts), coverage,
  };
  void spec;
  return { status, report, accepted, quarantine, duplicatesIdentical: ds ? ds.duplicatesIdentical : [], conflicts: ds ? ds.conflicts : [], invalidDuplicates: ds ? ds.invalidDuplicates : [], dateAnomalies: ds ? ds.dateAnomalies : [], gapRanges: ds ? ds.gapRanges : [], missingCount: ds ? ds.missingCount : 0, extraction };
}

const sortObj = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));

function computeCoverage(items, accepted, quarantine, ds) {
  if (!ds || !ds.contestsPresent.length) return { firstContest: null, lastContest: null, distinctContests: 0, expectedRange: null, expectedCount: 0, foundCount: 0, missingFormat: GAP_FORMAT, missingRanges: [], missingCount: 0, firstDate: null, lastDate: null, anomalousDates: 0, acceptedContests: 0, quarantinedContests: 0, contiguous: false, completenessClaim: 'NAO_DECLARADA' };
  const pres = ds.contestsPresent; const first = pres[0], last = pres[pres.length - 1];
  const dates = items.map(i => i.rec.drawDate).filter(Boolean).sort();
  const qContests = new Set(quarantine.filter(q => q.candidate).map(q => q.candidate.contest));
  return {
    firstContest: first, lastContest: last, distinctContests: pres.length, expectedRange: [1, last], expectedCount: last, foundCount: pres.length,
    missingFormat: GAP_FORMAT, missingRanges: ds.gapRanges, missingCount: ds.missingCount, missingBeforeFirst: first > 1 ? first - 1 : 0, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null,
    anomalousDates: ds.dateAnomalies.length, acceptedContests: accepted.length, quarantinedContests: qContests.size,
    contiguous: ds.missingCount === 0, duplicatesIdentical: ds.duplicatesIdentical.length, conflictingContests: ds.conflicts.length,
    completenessClaim: 'NAO_DECLARADA', completenessNote: 'Contiguidade numérica não prova completude: concursos cancelados/não realizados/excepcionais exigem evidência documental.',
  };
}
export { A };
