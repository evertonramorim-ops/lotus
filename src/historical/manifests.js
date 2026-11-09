/**
 * Manifestos por modalidade e por execução, reutilizando buildManifest/ManifestLedger da Fase 3a
 * (contrato `lotus.manifest` 1.0.0 inalterado). Encadeamento: entrada `chain:previous` cujo sha256 é o
 * rootHash do manifesto anterior do mesmo datasetId. Nunca sobrescreve: nova importação diferente →
 * sequence+1; importação idêntica → UNCHANGED_REPLAY (nenhum manifesto novo).
 * O rootHash prova integridade/consistência interna — NÃO autenticidade da fonte.
 * @module historical/manifests
 */
import { buildManifest, ManifestLedger, verifyManifest, verifyManifestDetailed, hashRecord, hashFile, isIsoUtc } from '../integrity/manifest.js';
import { hashJson } from '../integrity/hash.js';
import { HISTORICAL_SCHEMA, HISTORICAL_SCHEMA_VERSION } from './normalize.js';

export const RUN_DATASET_ID = 'lotus.historical.run';
export const RUN_REPORT_SCHEMA = 'lotus.import-run';
export const RUN_REPORT_SCHEMA_VERSION = '1.0.0';
export const modalityDatasetId = lottery => `lotus.historical.xlsx.${lottery}`;
const clean = v => JSON.parse(JSON.stringify(v));

/** Entradas lógicas (sem encadeamento) do manifesto da modalidade. */
export function modalityEntries(imp, collection) {
  const L = imp.report.lottery;
  const e = [
    { id: `file:${L}:${collection.sha256}`, kind: 'file', sha256: collection.sha256 },
    { id: 'record:collection', sha256: hashJson(collection) },
    { id: 'record:import-report', sha256: hashJson(clean(imp.report)) },
    { id: 'record:quarantine', sha256: hashJson(clean(imp.quarantine)) },
    { id: 'record:duplicates-identical', sha256: hashJson(clean(imp.duplicatesIdentical)) },
  ];
  for (const a of imp.accepted) e.push({ id: `record:draw:${L}:${String(a.record.contest).padStart(6, '0')}`, sha256: a.recordSha256 });
  return e;
}
const contentKey = entries => hashJson([...entries].filter(x => x.id !== 'chain:previous').map(x => ({ id: x.id, kind: x.kind ?? 'record', sha256: x.sha256 })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));

/**
 * Propõe manifesto respeitando o ledger. @returns {{action:'NEW'|'UNCHANGED_REPLAY', manifest:object, submit?:object}}
 */
export function proposeManifest(ledger, datasetId, entries, createdAt, dataSchemaVersion) {
  const prev = ledger.latest(datasetId);
  if (prev && contentKey(prev.entries) === contentKey(entries)) return { action: 'UNCHANGED_REPLAY', manifest: prev };
  const all = prev ? [...entries, { id: 'chain:previous', sha256: prev.rootHash }] : entries;
  const manifest = buildManifest({ datasetId, dataSchemaVersion, sequence: prev ? prev.sequence + 1 : 1, createdAt, entries: all });
  const submit = ledger.submit(manifest);
  if (!submit.accepted) throw new Error(`manifesto recusado pelo ledger: ${submit.code}`);
  return { action: 'NEW', manifest, submit };
}

/**
 * Executa a camada de manifestos para um conjunto de importações (uma execução).
 * @param {ManifestLedger} ledger @param {{imp:object, collection:object}[]} results
 */
export function manifestRun(ledger, results, { runId, createdAt }) {
  const modality = [];
  for (const { imp, collection } of results) {
    const p = proposeManifest(ledger, modalityDatasetId(imp.report.lottery), modalityEntries(imp, collection), createdAt, `${HISTORICAL_SCHEMA}/${HISTORICAL_SCHEMA_VERSION}`);
    modality.push({ lottery: imp.report.lottery, action: p.action, datasetId: p.manifest.datasetId, sequence: p.manifest.sequence, rootHash: p.manifest.rootHash, manifest: p.manifest });
  }
  const runReport = { schema: RUN_REPORT_SCHEMA, schemaVersion: RUN_REPORT_SCHEMA_VERSION,
    modalities: results.map(({ imp, collection }) => ({ lottery: imp.report.lottery, status: imp.status, fileSha256: collection.sha256, counts: imp.report.counts })),
    modalityManifests: modality.map(m => ({ lottery: m.lottery, datasetId: m.datasetId, sequence: m.sequence, rootHash: m.rootHash })) };
  const entries = [{ id: 'record:run-report', sha256: hashJson(runReport) }, ...modality.map(m => ({ id: `manifest:${m.lottery}`, sha256: m.rootHash }))];
  const p = proposeManifest(ledger, RUN_DATASET_ID, entries, createdAt, `${RUN_REPORT_SCHEMA}/${RUN_REPORT_SCHEMA_VERSION}`);
  return { runId, modality, runReport, runManifest: p.manifest, runAction: p.action, runRootHash: p.manifest.rootHash };
}

export const MODALITY_DATA_SCHEMA_VERSION = `${HISTORICAL_SCHEMA}/${HISTORICAL_SCHEMA_VERSION}`;

/**
 * Conteúdo REAL de cada entrada do manifesto da modalidade (nunca hashes declarados): bytes do XLSX, registro de coleta,
 * relatório, quarentena, duplicatas e cada registro aceito (o hash é recalculado de `a.record`, não lido de `recordSha256`).
 * @returns {Map<string, {kind:'file', bytes:Uint8Array}|{kind:'record', value:any}>}
 */
export function modalityContents(imp, collection, rawBytes) {
  const L = imp.report.lottery; const m = new Map();
  if (rawBytes) m.set(`file:${L}:${collection.sha256}`, { kind: 'file', bytes: rawBytes });
  m.set('record:collection', { kind: 'record', value: collection });
  m.set('record:import-report', { kind: 'record', value: clean(imp.report) });
  m.set('record:quarantine', { kind: 'record', value: clean(imp.quarantine) });
  m.set('record:duplicates-identical', { kind: 'record', value: clean(imp.duplicatesIdentical) });
  for (const a of imp.accepted) m.set(`record:draw:${L}:${String(a.record.contest).padStart(6, '0')}`, { kind: 'record', value: clean(a.record) });
  return m;
}

/**
 * Verifica um manifesto da modalidade contra o CONTEÚDO real recalculado (verifyManifestDetailed): bytes do XLSX,
 * coleta, relatório, quarentena, duplicatas e cada registro aceito; IDs, kinds, hashes, entradas faltantes e extras;
 * datasetId, dataSchemaVersion, sequence e encadeamento (chain:previous) contra o manifesto anterior OU o rootHash
 * esperado. Sem bytes do XLSX, ou sequence > 1 sem anterior/rootHash esperado → falha (nunca "passa sem verificar").
 * @param {object} manifest
 * @param {object} imp resultado de importXlsx (ou artefatos equivalentes lidos do armazenamento)
 * @param {object} collection registro de coleta
 * @param {Uint8Array|null} rawBytes bytes originais do XLSX
 * @param {{previous?:object, expectedPreviousRootHash?:string, expectedDatasetId?:string, expectedDataSchemaVersion?:string, expectedSequence?:number}} [opt]
 * @returns {{ok:boolean, errors:object[], checked:object}}
 */
export function verifyModalityManifest(manifest, imp, collection, rawBytes, opt = {}) {
  const errors = []; const L = imp && imp.report ? imp.report.lottery : null;
  if (!rawBytes) errors.push({ code: 'FILE_BYTES_NOT_PROVIDED', id: `file:${L}:${collection && collection.sha256}` });
  else if (hashFile(rawBytes) !== collection.sha256) errors.push({ code: 'FILE_BYTES_MISMATCH_COLLECTION', id: `file:${L}:${collection.sha256}` });
  const contents = modalityContents(imp, collection, rawBytes);
  // registros aceitos: hash declarado em recordSha256 conferido contra o recalculado (adulteração do declarado)
  for (const a of imp.accepted) if (a.recordSha256 !== undefined && a.recordSha256 !== hashRecord(clean(a.record))) errors.push({ code: 'DECLARED_RECORD_HASH_MISMATCH', id: `record:draw:${L}:${String(a.record.contest).padStart(6, '0')}` });
  const d = verifyManifestDetailed(manifest, contents);
  const chainEntry = manifest && Array.isArray(manifest.entries) ? manifest.entries.find(e => e.id === 'chain:previous') : undefined;
  for (const e of d.errors) if (!(e.code === 'ENTRY_MISSING' && e.id === 'chain:previous')) errors.push(e);
  if (!rawBytes) for (const i in errors) if (errors[i].code === 'ENTRY_MISSING' && /^file:/.test(errors[i].id)) errors[i] = { ...errors[i], code: 'ENTRY_NOT_VERIFIED_NO_BYTES' };
  const wantDs = opt.expectedDatasetId ?? (L ? modalityDatasetId(L) : null);
  if (manifest && manifest.datasetId !== wantDs) errors.push({ code: 'DATASET_ID_MISMATCH', expected: wantDs, found: manifest && manifest.datasetId });
  const wantSchema = opt.expectedDataSchemaVersion ?? MODALITY_DATA_SCHEMA_VERSION;
  if (manifest && manifest.dataSchemaVersion !== wantSchema) errors.push({ code: 'DATA_SCHEMA_VERSION_MISMATCH', expected: wantSchema, found: manifest.dataSchemaVersion });
  if (opt.expectedSequence !== undefined && manifest && manifest.sequence !== opt.expectedSequence) errors.push({ code: 'SEQUENCE_MISMATCH', expected: opt.expectedSequence, found: manifest.sequence });
  // encadeamento
  let chain = 'NAO_APLICAVEL';
  if (manifest && manifest.sequence === 1) { if (chainEntry) errors.push({ code: 'CHAIN_UNEXPECTED_IN_FIRST_MANIFEST' }); else chain = 'PRIMEIRO_MANIFESTO'; }
  else if (manifest && Number.isSafeInteger(manifest.sequence) && manifest.sequence > 1) {
    if (!chainEntry) errors.push({ code: 'CHAIN_MISSING' });
    else if (chainEntry.kind !== 'record') errors.push({ code: 'CHAIN_KIND_MISMATCH' });
    const prev = opt.previous ?? null; const want = prev ? prev.rootHash : opt.expectedPreviousRootHash ?? null;
    if (!want) errors.push({ code: 'CHAIN_NOT_VERIFIABLE', detail: 'informe o manifesto anterior ou o rootHash esperado' });
    else if (chainEntry && chainEntry.sha256 !== want) errors.push({ code: 'CHAIN_PREVIOUS_MISMATCH', expected: want, found: chainEntry.sha256 });
    if (prev) {
      const pv = verifyManifest(prev); if (!pv.ok) errors.push({ code: 'CHAIN_PREVIOUS_INVALID', errors: pv.errors });
      if (prev.datasetId !== manifest.datasetId) errors.push({ code: 'CHAIN_PREVIOUS_DATASET_MISMATCH' });
      if (prev.sequence !== manifest.sequence - 1) errors.push({ code: 'CHAIN_PREVIOUS_SEQUENCE_MISMATCH', expected: manifest.sequence - 1, found: prev.sequence });
    }
    if (!errors.some(e => /^CHAIN_/.test(e.code))) chain = prev ? 'VERIFICADO_CONTRA_ANTERIOR' : 'VERIFICADO_CONTRA_ROOTHASH_ESPERADO';
  }
  return { ok: errors.length === 0, errors, checked: { entries: contents.size, acceptedRecords: imp.accepted.length, fileBytes: !!rawBytes, rootHashOk: d.hashOk, structuralOk: d.structuralOk, chain } };
}

/* ---------- verificação completa de execuções persistidas (correção integrada 3b.2) ---------- */
export const RUN_DATA_SCHEMA_VERSION = `${RUN_REPORT_SCHEMA}/${RUN_REPORT_SCHEMA_VERSION}`;
export const RUN_LOTTERIES = Object.freeze(['megasena', 'lotofacil', 'quina', 'lotomania']);
const keyOf = (ds, seq) => `${ds}#${seq}`;

/**
 * Revalida o ledger persistente INTEIRO, na ordem das linhas: cada linha é JSON, é aceita por um ManifestLedger novo
 * (estrutura, rootHash recalculado, sem regressão/substituição/reapresentação), avança exatamente +1 por datasetId e
 * tem `chain:previous` igual ao rootHash do anterior do mesmo datasetId (ausente na sequence 1).
 * @param {string} text conteúdo de manifests.jsonl
 * @returns {{ok:boolean, errors:object[], lines:number, accepted:number, byKey:Map<string,object>, latest:Map<string,object>}}
 */
export function verifyLedgerChain(text) {
  const errors = []; const L = new ManifestLedger(); const byKey = new Map(); const latest = new Map(); let n = 0; let accepted = 0;
  const lines = String(text).split('\n'); if (lines[lines.length - 1] === '') lines.pop();
  for (const [i, line] of lines.entries()) {
    n++; const lineNo = i + 1;
    if (!line.trim()) { errors.push({ code: 'LEDGER_LINE_EMPTY', line: lineNo }); continue; }
    let m; try { m = JSON.parse(line); } catch { errors.push({ code: 'LEDGER_LINE_NOT_JSON', line: lineNo }); continue; }
    const r = L.submit(m);
    if (!r.accepted) { errors.push({ code: 'LEDGER_LINE_REJECTED', line: lineNo, reason: r.code, ...(r.errors ? { errors: r.errors.map(e => e.code) } : {}) }); continue; }
    const prev = latest.get(m.datasetId) ?? null; const ch = m.entries.find(e => e.id === 'chain:previous');
    if (!prev) { if (m.sequence !== 1) errors.push({ code: 'LEDGER_FIRST_SEQUENCE_NOT_1', line: lineNo, datasetId: m.datasetId, sequence: m.sequence }); if (ch) errors.push({ code: 'LEDGER_CHAIN_UNEXPECTED', line: lineNo, datasetId: m.datasetId }); }
    else {
      if (m.sequence !== prev.sequence + 1) errors.push({ code: 'LEDGER_SEQUENCE_GAP', line: lineNo, datasetId: m.datasetId, expected: prev.sequence + 1, found: m.sequence });
      if (!ch) errors.push({ code: 'LEDGER_CHAIN_MISSING', line: lineNo, datasetId: m.datasetId });
      else if (ch.sha256 !== prev.rootHash) errors.push({ code: 'LEDGER_CHAIN_BROKEN', line: lineNo, datasetId: m.datasetId, expected: prev.rootHash, found: ch.sha256 });
    }
    accepted++; byKey.set(keyOf(m.datasetId, m.sequence), { manifest: m, line: lineNo }); latest.set(m.datasetId, m);
  }
  return { ok: errors.length === 0, errors, lines: n, accepted, byKey, latest };
}

function chainCheck(manifest, previous, errors) {
  const ch = manifest.entries.find(e => e.id === 'chain:previous');
  if (manifest.sequence === 1) { if (ch) errors.push({ code: 'CHAIN_UNEXPECTED_IN_FIRST_MANIFEST' }); return ch ? null : 'PRIMEIRO_MANIFESTO'; }
  if (!ch) { errors.push({ code: 'CHAIN_MISSING' }); return null; }
  if (!previous) { errors.push({ code: 'CHAIN_NOT_VERIFIABLE' }); return null; }
  if (ch.sha256 !== previous.rootHash) { errors.push({ code: 'CHAIN_PREVIOUS_MISMATCH', expected: previous.rootHash, found: ch.sha256 }); return null; }
  return 'VERIFICADO_CONTRA_ANTERIOR';
}

/**
 * Verifica o manifesto de UMA execução: conteúdo REAL do run-report (recalculado a partir dos artefatos verificados das
 * modalidades), as 4 referências `manifest:<modalidade>` contra os rootHashes efetivamente verificados, datasetId,
 * dataSchemaVersion, rootHash e encadeamento contra o anterior do ledger revalidado.
 * @param {object} runManifest @param {object} runReport
 * @param {{lottery:string, ok:boolean, manifest:object, report:object, collection:object}[]} modalities verificadas
 * @param {object|null} previous manifesto de execução anterior (do ledger revalidado)
 */
export function verifyRunManifest(runManifest, runReport, modalities, previous) {
  const errors = []; let checked = 0;
  const byL = new Map(modalities.map(m => [m.lottery, m]));
  for (const l of RUN_LOTTERIES) { const m = byL.get(l); if (!m) errors.push({ code: 'RUN_MODALITY_MISSING', lottery: l }); else if (!m.ok) errors.push({ code: 'RUN_MODALITY_NOT_VERIFIED', lottery: l }); }
  const ordered = RUN_LOTTERIES.filter(l => byL.has(l)).map(l => byL.get(l));
  const expected = { schema: RUN_REPORT_SCHEMA, schemaVersion: RUN_REPORT_SCHEMA_VERSION,
    modalities: ordered.map(m => ({ lottery: m.lottery, status: m.report.status, fileSha256: m.collection.sha256, counts: m.report.counts })),
    modalityManifests: ordered.map(m => ({ lottery: m.lottery, datasetId: m.manifest.datasetId, sequence: m.manifest.sequence, rootHash: m.manifest.rootHash })) };
  if (hashJson(clean(runReport)) !== hashJson(expected)) {
    const fields = ['schema', 'schemaVersion', 'modalities', 'modalityManifests'].filter(k => hashJson(clean(runReport ?? {})[k] ?? null) !== hashJson(expected[k]));
    errors.push({ code: 'RUN_REPORT_CONTENT_MISMATCH', fields });
  }
  const d = verifyManifestDetailed(runManifest, new Map([['record:run-report', { kind: 'record', value: clean(runReport) }]]));
  for (const e of d.errors) if (!(e.code === 'ENTRY_MISSING' && (/^manifest:/.test(e.id) || e.id === 'chain:previous'))) errors.push(e);
  if (d.structuralOk) {
    if (runManifest.entries.some(e => e.id === 'record:run-report')) checked++;
    for (const e of runManifest.entries.filter(x => /^manifest:/.test(x.id))) {
      const l = e.id.slice('manifest:'.length); const m = byL.get(l);
      if (!RUN_LOTTERIES.includes(l)) { errors.push({ code: 'RUN_MODALITY_UNEXPECTED', id: e.id }); continue; }
      if (!m) continue; checked++;
      if ((e.kind ?? 'record') !== 'record') errors.push({ code: 'ENTRY_KIND_MISMATCH', id: e.id });
      if (e.sha256 !== m.manifest.rootHash) errors.push({ code: 'RUN_MODALITY_ROOTHASH_MISMATCH', id: e.id, expected: m.manifest.rootHash, found: e.sha256 });
    }
    for (const l of RUN_LOTTERIES) if (!runManifest.entries.some(e => e.id === `manifest:${l}`)) errors.push({ code: 'RUN_MODALITY_REFERENCE_MISSING', lottery: l });
    if (runManifest.datasetId !== RUN_DATASET_ID) errors.push({ code: 'DATASET_ID_MISMATCH', expected: RUN_DATASET_ID, found: runManifest.datasetId });
    if (runManifest.dataSchemaVersion !== RUN_DATA_SCHEMA_VERSION) errors.push({ code: 'DATA_SCHEMA_VERSION_MISMATCH', expected: RUN_DATA_SCHEMA_VERSION, found: runManifest.dataSchemaVersion });
  }
  const chain = d.structuralOk ? chainCheck(runManifest, previous, errors) : null;
  if (chain === 'VERIFICADO_CONTRA_ANTERIOR') checked++;
  return { ok: errors.length === 0, errors, checked: { entries: checked, chain, rootHashOk: d.hashOk } };
}

/**
 * Verificação COMPLETA e somente leitura das execuções persistidas: ledger inteiro revalidado em ordem; cada manifesto de
 * modalidade contra o conteúdo real (verifyModalityManifest) e contra a linha do ledger (conteúdo idêntico, não só
 * existência); cada manifesto de execução (verifyRunManifest) idem; sucessão entre execuções (NEW = anterior + 1;
 * UNCHANGED_REPLAY = mesmo manifesto); toda linha do ledger referenciada por alguma execução.
 * @param {{ledgerText:string, runs:{runId:string, runManifestFile:{action:string, manifest:object}|null, runReport:object|null,
 *   modalities:{lottery:string, manifestFile:{action:string, manifest:object}, imp:object, collection:object, rawBytes:Uint8Array|null}[]}[]}} p
 */
export function verifyPersistedRuns({ ledgerText, runs }) {
  const ledger = verifyLedgerChain(ledgerText);
  const errors = ledger.errors.map(e => ({ scope: 'ledger', ...e }));
  const modalityResults = []; const runResults = []; const referenced = new Set(); const lastSeq = new Map();
  const inLedger = (m, scope) => {
    const k = keyOf(m.datasetId, m.sequence); const le = ledger.byKey.get(k); referenced.add(k);
    if (!le) { errors.push({ ...scope, code: 'MANIFEST_NOT_IN_VALID_LEDGER', datasetId: m.datasetId, sequence: m.sequence }); return false; }
    if (hashJson(le.manifest) !== hashJson(clean(m))) { errors.push({ ...scope, code: 'MANIFEST_DIFFERS_FROM_LEDGER', datasetId: m.datasetId, sequence: m.sequence, ledgerLine: le.line }); return false; }
    return true;
  };
  const prevOf = m => (m.sequence > 1 ? ledger.byKey.get(keyOf(m.datasetId, m.sequence - 1))?.manifest ?? null : null);
  const succession = (action, m, scope) => {
    const last = lastSeq.get(m.datasetId);
    if (action === 'NEW') { if (m.sequence !== (last ? last.sequence + 1 : 1)) errors.push({ ...scope, code: 'RUN_SEQUENCE_INCONSISTENT', action, datasetId: m.datasetId, expected: last ? last.sequence + 1 : 1, found: m.sequence }); }
    else if (action === 'UNCHANGED_REPLAY') { if (!last || last.sequence !== m.sequence || last.rootHash !== m.rootHash) errors.push({ ...scope, code: 'RUN_REPLAY_INCONSISTENT', datasetId: m.datasetId, found: m.sequence }); }
    else errors.push({ ...scope, code: 'RUN_ACTION_INVALID', action });
    if (!last || m.sequence >= last.sequence) lastSeq.set(m.datasetId, { sequence: m.sequence, rootHash: m.rootHash });
  };
  let entriesChecked = 0;
  // ORDEM AUTORITATIVA (correção final 3b.2): posição da linha do manifesto de execução no ledger revalidado (= sequence
  // do datasetId de execução), NEW antes de UNCHANGED_REPLAY da mesma sequence. Nunca runId, nome de pasta ou createdAt.
  const { ordered, warnings } = orderRunsByLedger(runs, ledger);
  for (const run of ordered) {
    const verified = [];
    for (const mod of run.modalities) {
      const scope = { scope: 'modality', run: run.runId, lottery: mod.lottery };
      const m = mod.manifestFile && mod.manifestFile.manifest;
      if (!m || typeof m !== 'object' || !Array.isArray(m.entries)) { errors.push({ ...scope, code: 'MODALITY_MANIFEST_UNREADABLE' }); modalityResults.push({ ...scope, ok: false }); continue; }
      const prev = prevOf(m);
      const v = verifyModalityManifest(m, mod.imp, mod.collection, mod.rawBytes, prev ? { previous: prev } : {});
      const okL = inLedger(m, scope); succession(mod.manifestFile.action, m, scope);
      for (const e of v.errors) errors.push({ ...scope, ...e });
      const nChain = v.checked.chain === 'VERIFICADO_CONTRA_ANTERIOR' ? 1 : 0; entriesChecked += v.checked.entries + nChain;
      const ok = v.ok && okL; modalityResults.push({ ...scope, ok, datasetId: m.datasetId, sequence: m.sequence, entries: v.checked.entries + nChain, chain: v.checked.chain });
      verified.push({ lottery: mod.lottery, ok, manifest: m, report: mod.imp.report, collection: mod.collection });
    }
    const scope = { scope: 'run', run: run.runId };
    const rm = run.runManifestFile && run.runManifestFile.manifest;
    if (!rm || typeof rm !== 'object' || !Array.isArray(rm.entries) || !run.runReport) { errors.push({ ...scope, code: 'RUN_MANIFEST_OR_REPORT_UNREADABLE' }); runResults.push({ ...scope, ok: false }); continue; }
    const v = verifyRunManifest(rm, run.runReport, verified, prevOf(rm));
    const okL = inLedger(rm, scope); succession(run.runManifestFile.action, rm, scope);
    for (const e of v.errors) errors.push({ ...scope, ...e });
    entriesChecked += v.checked.entries;
    runResults.push({ ...scope, ok: v.ok && okL, datasetId: rm.datasetId, sequence: rm.sequence, entries: v.checked.entries, chain: v.checked.chain });
  }
  for (const [k, le] of ledger.byKey) if (!referenced.has(k)) errors.push({ scope: 'ledger', code: 'LEDGER_ENTRY_WITHOUT_RUN', key: k, line: le.line });
  return { ok: errors.length === 0, order: ordered.map(r => r.runId), warnings, ledger: { lines: ledger.lines, accepted: ledger.accepted, chainOk: ledger.ok },
    modalityManifestsVerified: modalityResults.filter(r => r.ok).length, modalityManifestsTotal: modalityResults.length,
    runManifestsVerified: runResults.filter(r => r.ok).length, runManifestsTotal: runResults.length, entriesChecked, errors, modalityResults, runResults };
}

const RUN_ACTION_RANK = { NEW: 0, UNCHANGED_REPLAY: 1 };
/**
 * Ordena execuções persistidas pela posição AUTORITATIVA no ledger revalidado: linha do manifesto de execução (sequence
 * crescente do datasetId `lotus.historical.run`); para a mesma linha, NEW antes de UNCHANGED_REPLAY (um replay da sequence k
 * só pode ocorrer depois do NEW k e antes do NEW k+1). Execuções sem manifesto legível ou fora do ledger vão ao fim (e falham
 * na verificação). runId entra SOMENTE como desempate entre replays da mesma sequence — verificados contra o mesmo manifesto,
 * portanto sem efeito no resultado. createdAt é apenas validado (formato) e comparado para AVISO, nunca para ordenar.
 * @returns {{ordered:object[], warnings:object[]}}
 */
export function orderRunsByLedger(runs, ledger) {
  const keyed = runs.map(run => {
    const f = run.runManifestFile; const m = f && f.manifest;
    const le = m && typeof m === 'object' && m.datasetId === RUN_DATASET_ID && Number.isSafeInteger(m.sequence) ? ledger.byKey.get(keyOf(m.datasetId, m.sequence)) : undefined;
    return { run, line: le ? le.line : Number.POSITIVE_INFINITY, rank: f && RUN_ACTION_RANK[f.action] !== undefined ? RUN_ACTION_RANK[f.action] : 2, createdAt: m && typeof m === 'object' ? m.createdAt : undefined };
  });
  keyed.sort((a, b) => a.line - b.line || a.rank - b.rank || (a.run.runId < b.run.runId ? -1 : a.run.runId > b.run.runId ? 1 : 0));
  const warnings = []; let prevNew = null;
  for (const k of keyed) {
    if (k.createdAt !== undefined && !isIsoUtc(k.createdAt)) warnings.push({ code: 'RUN_CREATED_AT_INVALID', run: k.run.runId });
    if (k.rank === 0 && Number.isFinite(k.line) && isIsoUtc(k.createdAt)) {
      if (prevNew && Date.parse(k.createdAt) < Date.parse(prevNew.createdAt)) warnings.push({ code: 'RUN_CREATED_AT_NOT_MONOTONIC', run: k.run.runId, createdAt: k.createdAt, previousRun: prevNew.run.runId, previousCreatedAt: prevNew.createdAt, note: 'createdAt informado pelo operador é retroativo; a ordem verificada é a do ledger' });
      prevNew = k;
    }
  }
  return { ordered: keyed.map(k => k.run), warnings };
}

/**
 * Execução usada pela reconciliação offline: a execução NEW cujo manifesto é IDÊNTICO ao último manifesto de execução do
 * ledger revalidado (maior sequence). Nunca a "última" por nome de pasta/runId/createdAt.
 * @param {{ledgerText:string, runs:{runId:string, runManifestFile:{action:string, manifest:object}|null}[]}} p
 * @returns {{ok:true, runId:string, sequence:number, rootHash:string}|{ok:false, reason:string, candidates?:string[], errors?:object[]}}
 */
export function selectLatestRun({ ledgerText, runs }) {
  const ledger = verifyLedgerChain(ledgerText);
  if (!ledger.ok) return { ok: false, reason: 'LEDGER_INVALIDO', errors: ledger.errors };
  const latest = ledger.latest.get(RUN_DATASET_ID);
  if (!latest) return { ok: false, reason: 'LEDGER_SEM_EXECUCAO' };
  const want = hashJson(latest);
  const hits = runs.filter(r => r.runManifestFile && r.runManifestFile.action === 'NEW' && r.runManifestFile.manifest && typeof r.runManifestFile.manifest === 'object' && hashJson(clean(r.runManifestFile.manifest)) === want).map(r => r.runId).sort();
  if (hits.length === 0) return { ok: false, reason: 'EXECUCAO_NEW_DA_ULTIMA_SEQUENCIA_AUSENTE', sequence: latest.sequence };
  if (hits.length > 1) return { ok: false, reason: 'EXECUCAO_NEW_DUPLICADA_PARA_A_MESMA_SEQUENCIA', candidates: hits };
  return { ok: true, runId: hits[0], sequence: latest.sequence, rootHash: latest.rootHash };
}
export { ManifestLedger };
