/**
 * Classificação de UMA amostra JSON na reconciliação offline (extraída de scripts/reconciliar-fase3b2.mjs) e
 * montagem SEGURA da lista de amostras a partir dos logs. Funções puras: não leem disco nem rede.
 * Estados: PROVENIENCIA_REJEITADA (hash/tamanho/status do log divergentes; sem parse) · CODIFICACAO_INVALIDA (bytes com
 * proveniência conferida, mas UTF-8 inválido na decodificação ESTRITA; sem parse, sem comparação) · JSON_INVALIDO (sintaxe ou tamanho) · JSON_SCHEMA_INVALIDO (JSON válido com raiz que não é objeto:
 * null, array, string, número, booleano) · JSON_DADO_INVALIDO (concurso presente mas inválido) · JSON_SEM_RESULTADO
 * (objeto sem concurso ou com concurso nulo) · VALIDO (fluxo normal). Em TODOS os estados com objeto JSON, os campos
 * são validados de forma independente (compareRecords com x = null); a ausência do XLSX nunca torna o JSON "válido".
 * Fonte XLSX ambígua (várias candidatas) → linhas FONTE_AMBIGUA (reconciliação 4.0.0), nunca DADO_INVALIDO por si só.
 * @module historical/reconcile-sample
 */
import { createHash } from 'node:crypto';
import { adaptJsonResult, compareRecords, divergenceQuarantine, summarize, JsonSchemaError, CLASSES } from './reconcile.js';
import { safeRelativePath } from './store.js';
import { hashJson } from '../integrity/hash.js';
import { fullContent } from './validators.js';
import { parseLogTimestamp } from './timestamps.js';

export const SAMPLE_STATUS = Object.freeze({ PROVENIENCIA_REJEITADA: 'PROVENIENCIA_REJEITADA', CODIFICACAO_INVALIDA: 'CODIFICACAO_INVALIDA', JSON_INVALIDO: 'JSON_INVALIDO', JSON_SCHEMA_INVALIDO: 'JSON_SCHEMA_INVALIDO', JSON_DADO_INVALIDO: 'JSON_DADO_INVALIDO', JSON_SEM_RESULTADO: 'JSON_SEM_RESULTADO', VALIDO: 'VALIDO' });

/* ---------- seleção do registro XLSX (correção integrada 3b.2) ---------- */
export const XLSX_SELECTION = Object.freeze({ ACEITO: 'ACEITO', QUARENTENA_UNICO: 'QUARENTENA', AMBIGUO: 'AMBIGUO' });
const candRef = (rec, origin, extra) => ({ origin, contest: rec.contest, sheet: rec.source ? rec.source.sheet ?? null : null, row: rec.source ? rec.source.row ?? null : null, recordSha256: hashJson(rec), ...(extra || {}) });
/**
 * Índice concurso → seleção do registro XLSX usado na reconciliação, a partir dos artefatos da importação
 * (registros aceitos e entradas de quarentena). Regras:
 * - exatamente 1 aceito → ACEITO (linhas em quarentena do mesmo concurso NUNCA o substituem; ficam em `quarantineRefs`);
 * - 2+ aceitos (qualquer conteúdo) → AMBIGUO, sem escolha arbitrária;
 * - 0 aceitos e exatamente 1 candidata em quarentena → QUARENTENA (registro marcado `__quarantined`);
 * - 0 aceitos e 2+ candidatas DISTINTAS em quarentena → AMBIGUO (nunca "a última do array").
 * Candidata em quarentena = grupo de linhas com o MESMO conteúdo (fullContent do V11/V14: valores, literais, fórmulas por
 * coluna e estados dos campos, sem posição) e os mesmos motivos: duplicatas físicas da mesma linha contam UMA vez
 * (`physicalRows` lista todas). A mesma linha (sheet+row) citada em várias entradas também conta uma vez.
 * Independente da ordem dos arrays: candidatas ordenadas por (origem, planilha, linha); representante = menor linha.
 * @param {{acceptedRecords:object[], quarantine:object[]}} p
 * @returns {Map<number, {selection:string, record:object|null, candidates:object[], quarantineRefs:object[], candidateRecords?:object[]}>}
 */
export function buildXlsxRecordIndex({ acceptedRecords, quarantine }) {
  const acc = new Map(); const qua = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const pos = r => [r.source ? String(r.source.sheet ?? '') : '', r.source && Number.isFinite(r.source.row) ? r.source.row : Number.MAX_SAFE_INTEGER];
  const byPos = (a, b) => { const [sa, ra] = pos(a); const [sb, rb] = pos(b); return sa < sb ? -1 : sa > sb ? 1 : ra - rb || (hashJson(a) < hashJson(b) ? -1 : hashJson(a) > hashJson(b) ? 1 : 0); };
  for (const r of acceptedRecords) push(acc, r.contest, r);
  // 1) linhas físicas em quarentena (sheet+row), motivos unidos; representante determinístico se a mesma linha vier com objetos diferentes
  const rowsByContest = new Map();
  for (const e of quarantine) {
    if (!e || !e.candidate) continue;
    const c = e.candidate; const key = `${c.source ? c.source.sheet : ''}#${c.source ? c.source.row : ''}`;
    const m = rowsByContest.get(c.contest) ?? new Map(); rowsByContest.set(c.contest, m);
    const codes = (e.reasons ?? []).map(r => r.code);
    const seen = m.get(key);
    if (seen) { seen.codes.push(...codes); if (byPos(c, seen.rec) < 0 || (byPos(c, seen.rec) === 0 && hashJson(c) < hashJson(seen.rec))) seen.rec = c; continue; }
    m.set(key, { key, rec: c, codes: [...codes] });
  }
  // 2) candidatas distintas = conteúdo (sem posição) + motivos; duplicatas físicas idênticas viram UMA candidata
  const contentKey = x => { let ck; try { ck = hashJson(fullContent(x.rec, null)); } catch { ck = `linha:${x.key}`; } return hashJson({ ck, codes: [...new Set(x.codes)].sort() }); };
  for (const [contest, m] of rowsByContest) {
    const groups = new Map();
    for (const x of [...m.values()].sort((a, b) => byPos(a.rec, b.rec))) { const k = contentKey(x); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
    qua.set(contest, [...groups.values()].map(g => ({ rec: g[0].rec, codes: [...new Set(g.flatMap(x => x.codes))].sort(), physicalRows: g.map(x => ({ sheet: x.rec.source ? x.rec.source.sheet ?? null : null, row: x.rec.source ? x.rec.source.row ?? null : null })) })));
  }
  const out = new Map();
  for (const contest of [...new Set([...acc.keys(), ...qua.keys()])].sort((a, b) => a - b)) {
    const a = [...(acc.get(contest) ?? [])].sort(byPos); const q = qua.get(contest) ?? [];
    const quarantineRefs = q.map(x => candRef(x.rec, 'QUARENTENA', { reasonCodes: x.codes, ...(x.physicalRows.length > 1 ? { physicalRows: x.physicalRows } : {}) }));
    if (a.length === 1) out.set(contest, { selection: XLSX_SELECTION.ACEITO, record: a[0], candidates: [candRef(a[0], 'ACEITO')], quarantineRefs });
    else if (a.length > 1) out.set(contest, { selection: XLSX_SELECTION.AMBIGUO, reason: 'MULTIPLOS_REGISTROS_ACEITOS', record: null, candidates: [...a.map(r => candRef(r, 'ACEITO')), ...quarantineRefs], quarantineRefs, candidateRecords: a });
    else if (q.length === 1) out.set(contest, { selection: XLSX_SELECTION.QUARENTENA_UNICO, record: { ...q[0].rec, __quarantined: true }, candidates: quarantineRefs, quarantineRefs });
    else out.set(contest, { selection: XLSX_SELECTION.AMBIGUO, reason: 'MULTIPLOS_CANDIDATOS_EM_QUARENTENA', record: null, candidates: quarantineRefs, quarantineRefs, candidateRecords: q.map(x => x.rec) });
  }
  return out;
}
/** Normaliza o valor do mapa (índice novo ou Map<contest, registro> legado dos testes antigos). */
const selectionOf = v => (v === undefined || v === null ? null : v.selection ? v : { selection: v.__quarantined ? XLSX_SELECTION.QUARENTENA_UNICO : XLSX_SELECTION.ACEITO, record: v, candidates: [], quarantineRefs: [] });

/* ---------- proveniência da amostra JSON ---------- */
export const PROVENANCE = Object.freeze({ VERIFICADA: 'VERIFICADA_POR_HASH', SEM_HASH: 'NAO_VERIFICADA_SEM_HASH_NO_LOG', REJEITADA: 'REJEITADA' });
const SHA_RE = /^[0-9a-f]{64}$/;
/**
 * Confere os bytes ARMAZENADOS contra o registrado na coleta ANTES de qualquer parse. Nunca substitui o hash original.
 * - hash registrado bem formado e igual ao calculado (e tamanho, se registrado, igual) → VERIFICADA_POR_HASH;
 * - hash registrado divergente → REJEITADA (ARQUIVO_ALTERADO_OU_PROVENIENCIA_INCONSISTENTE);
 * - hash registrado malformado, tamanho divergente ou status HTTP registrado ≠ 200 → REJEITADA;
 * - hash ausente no log (legado) → NAO_VERIFICADA_SEM_HASH_NO_LOG (limitação de proveniência, nunca "verificada").
 * @param {{loggedSha256?:any, loggedBytes?:any, loggedHttpStatus?:any}} sample @param {Uint8Array} bytes
 */
export function verifySampleProvenance(sample, bytes) {
  const computedSha256 = createHash('sha256').update(bytes).digest('hex'); const observedBytes = bytes.length;
  const ev = { loggedSha256: sample.loggedSha256 ?? null, computedSha256, loggedBytes: sample.loggedBytes ?? null, observedBytes, loggedHttpStatus: sample.loggedHttpStatus ?? null };
  const reasons = [];
  const hasHash = sample.loggedSha256 !== undefined && sample.loggedSha256 !== null;
  if (hasHash && (typeof sample.loggedSha256 !== 'string' || !SHA_RE.test(sample.loggedSha256))) reasons.push('HASH_REGISTRADO_MALFORMADO');
  else if (hasHash && sample.loggedSha256 !== computedSha256) reasons.push('HASH_DIVERGENTE');
  if (sample.loggedBytes !== undefined && sample.loggedBytes !== null && sample.loggedBytes !== observedBytes) reasons.push(Number.isSafeInteger(sample.loggedBytes) && sample.loggedBytes >= 0 ? 'TAMANHO_DIVERGENTE' : 'TAMANHO_REGISTRADO_MALFORMADO');
  if (sample.loggedHttpStatus !== undefined && sample.loggedHttpStatus !== null && sample.loggedHttpStatus !== 200) reasons.push('STATUS_HTTP_REGISTRADO_NAO_200');
  if (reasons.length) return { status: PROVENANCE.REJEITADA, reason: 'ARQUIVO_ALTERADO_OU_PROVENIENCIA_INCONSISTENTE', reasons, ...ev };
  if (!hasHash) return { status: PROVENANCE.SEM_HASH, reason: 'LIMITACAO_DE_PROVENIENCIA_LOG_LEGADO_SEM_HASH', reasons: [], ...ev };
  return { status: PROVENANCE.VERIFICADA, reason: null, reasons: [], ...ev };
}
export const LOTTERY_IDS = Object.freeze(['megasena', 'lotofacil', 'quina', 'lotomania']);

/** Decisão sobre o concurso do JSON adaptado (sem efeitos colaterais). */
export function classifyJsonContest(j) {
  if (j.contestField && j.contestField.present && !j.contestField.valid) return SAMPLE_STATUS.JSON_DADO_INVALIDO;
  if (j.contest === null || j.contest === undefined) return SAMPLE_STATUS.JSON_SEM_RESULTADO;
  return SAMPLE_STATUS.VALIDO;
}

/**
 * @param {{sample:object, bytes?:Uint8Array, text?:string, jsonSha256?:string, xlsxRecords:Map<number,object>, meta:{lastContest:number, xlsxObservedAt:string}}} p
 *   Com `bytes`, a proveniência é conferida ANTES do parse (verifySampleProvenance); amostra rejeitada não é lida como JSON.
 *   `xlsxRecords`: índice de buildXlsxRecordIndex (ou Map<contest, registro> legado).
 * @returns {{status:string, entry:object, rows:object[], quarantine:object|null}}
 */
export function reconcileSample({ sample: s0, bytes, text, jsonSha256, xlsxRecords, meta }) {
  let s = s0; let provenance = null;
  if (bytes !== undefined) {
    provenance = verifySampleProvenance(s0, bytes);
    if (provenance.status === PROVENANCE.REJEITADA) return { status: SAMPLE_STATUS.PROVENIENCIA_REJEITADA, rows: [], quarantine: null, entry: { ...s0, file: undefined, status: SAMPLE_STATUS.PROVENIENCIA_REJEITADA, provenance } };
    jsonSha256 = provenance.computedSha256; s = { ...s0, provenance };
    // UTF-8 ESTRITO: sequência inválida → CODIFICACAO_INVALIDA, sem parse e sem comparação (nunca U+FFFD silencioso).
    // ignoreBOM: o BOM, se houver, é preservado no texto (o parse JSON o rejeita como antes, com Buffer.toString).
    const dec = decodeUtf8Strict(bytes);
    if (!dec.ok) return { status: SAMPLE_STATUS.CODIFICACAO_INVALIDA, rows: [], quarantine: null, entry: { ...s0, file: undefined, jsonSha256, status: SAMPLE_STATUS.CODIFICACAO_INVALIDA, provenance, encoding: { expected: 'UTF-8', valid: false, reason: 'UTF8_INVALIDO', firstInvalidByteOffset: dec.firstInvalidByteOffset, byteLength: bytes.length, decoder: 'TextDecoder(utf-8, fatal)' } } };
    text = dec.text;
  }
  let j;
  try { j = adaptJsonResult(text); }
  catch (e) {
    if (e instanceof JsonSchemaError) return { status: SAMPLE_STATUS.JSON_SCHEMA_INVALIDO, rows: [], quarantine: null, entry: { ...s, file: undefined, jsonSha256, status: SAMPLE_STATUS.JSON_SCHEMA_INVALIDO, schemaErrorCode: e.code, rootType: e.detail.rootType, error: e.message } };
    if (e instanceof SyntaxError || e instanceof RangeError) return { status: SAMPLE_STATUS.JSON_INVALIDO, rows: [], quarantine: null, entry: { ...s, file: undefined, jsonSha256, status: SAMPLE_STATUS.JSON_INVALIDO, errorKind: e instanceof RangeError ? 'TAMANHO' : 'SINTAXE', error: e.message } };
    throw e;
  }
  const status = classifyJsonContest(j);
  const ctx = { xlsxLastContest: meta.lastContest, xlsxObservedAt: meta.xlsxObservedAt, jsonObservedAt: s.observedAt, jsonSha256, jsonUrl: s.url, lottery: s.lottery };
  if (status !== SAMPLE_STATUS.VALIDO) { // concurso inválido/ausente/nulo: JSON validado por inteiro, sem contraparte XLSX
    const rows = compareRecords(null, j, ctx);
    const contestInfo = { contest: null, contestLiteral: j.contestField ? j.contestField.literal : null, contestState: j.contestField ? j.contestField.state : null, contestInvalidReason: j.contestField ? j.contestField.invalidReason : null };
    if (status === SAMPLE_STATUS.JSON_DADO_INVALIDO) return { status, rows, quarantine: null, entry: { lottery: s.lottery, ...contestInfo, origin: s.origin, url: s.url, observedAt: s.observedAt, jsonSha256, status, ...(provenance ? { provenance } : {}), classes: summarize(rows), rows } };
    return { status, rows, quarantine: null, entry: { ...s, file: undefined, ...contestInfo, jsonSha256, status, classes: summarize(rows), rows } };
  }
  const sel = selectionOf(xlsxRecords.get(j.contest));
  const prov = provenance ? { provenance } : {};
  const base = { lottery: s.lottery, contest: j.contest, origin: s.origin, url: s.url, observedAt: s.observedAt, xlsxObservedAt: ctx.xlsxObservedAt, jsonSha256 };
  if (sel && sel.selection === XLSX_SELECTION.AMBIGUO) {
    // sem fonte XLSX única: nenhuma comparação (evita divergência/equivalência falsas); JSON validado por inteiro
    const rows = ambiguousRows(compareRecords(null, j, ctx), sel, j, ctx);
    return { status, rows, quarantine: null, entry: { ...base, xlsxStatus: 'AMBIGUO', xlsxAmbiguity: { reason: sel.reason, candidates: sel.candidates }, justification: s.justification, ...prov, classes: summarize(rows), rows } };
  }
  const x = sel ? sel.record : null;
  const rows = compareRecords(x, j, ctx);
  const quarantine = x ? divergenceQuarantine(x, j, rows, ctx) : null;
  const trace = sel ? { xlsxSource: { selection: sel.selection, candidates: sel.candidates, quarantineRefs: sel.quarantineRefs } } : {};
  return { status, rows, quarantine, entry: { ...base, xlsxStatus: x ? (x.__quarantined ? 'QUARENTENA' : 'ACEITO') : 'AUSENTE', justification: s.justification, ...prov, ...trace, classes: summarize(rows), rows } };
}

/**
 * Linhas para fonte XLSX AMBÍGUA (4.0.0). Nenhuma comparação entre fontes é feita.
 * - campo JSON inválido (DADO_INVALIDO/VALOR_INVALIDO na validação isolada do JSON): classe preservada, origem `JSON`;
 *   `AMBOS` SOMENTE se TODAS as candidatas XLSX, comparadas uma a uma, demonstram o campo inválido no próprio XLSX
 *   (evidência concreta por candidata em `xlsxCandidatesEvidence`); a ambiguidade nunca é, por si, invalidez do XLSX;
 * - demais campos → FONTE_AMBIGUA (nunca DADO_INVALIDO, EQUIVALENTE ou DIVERGENCIA_REAL), com a classificação real da
 *   validação isolada do JSON em `jsonFieldClass` e a validade do JSON em `jsonValid`.
 */
function ambiguousRows(rows0, sel, j, ctx) {
  const recs = Array.isArray(sel.candidateRecords) ? sel.candidateRecords : [];
  const perCand = recs.map(rec => { try { return new Map(compareRecords(rec, j, ctx).map(r => [r.field, r])); } catch { return null; } });
  const xlsxInvalidIn = (field, r) => (r && (r.invalidSource === 'XLSX' || r.invalidSource === 'AMBOS') && r.xlsxValid === false ? { field, xlsxInvalidReason: r.xlsxInvalidReason ?? null, xlsxLiteral: r.xlsxLiteral ?? null, xlsxRef: r.xlsxRef ?? null } : null);
  return rows0.map(r => {
    const jsonInvalid = r.class === CLASSES.DADO_INVALIDO || r.class === CLASSES.VALOR_INVALIDO;
    const common = { xlsx: '<fonte XLSX ambígua>', xlsxAmbiguous: true, xlsxSourceState: 'FONTE_AMBIGUA', xlsxAmbiguityReason: sel.reason, xlsxCandidateCount: sel.candidates.length, jsonFieldClass: r.class };
    if (jsonInvalid) {
      const ev = perCand.map((m, i) => ({ candidate: sel.candidates[i] ? { origin: sel.candidates[i].origin, sheet: sel.candidates[i].sheet, row: sel.candidates[i].row } : null, invalid: m ? xlsxInvalidIn(r.field, m.get(r.field)) : null }));
      const bothProven = perCand.length > 0 && perCand.length === sel.candidates.length && ev.every(e => e.invalid);
      return { ...r, ...common, invalidSource: bothProven ? 'AMBOS' : 'JSON', jsonValid: false,
        ...(bothProven ? { xlsxValid: false, xlsxCandidatesEvidence: ev } : { xlsxValid: null, xlsxInvalidReason: null }),
        note: `valor inválido no JSON (origem ${bothProven ? 'AMBOS: invalidez também comprovada em todas as candidatas XLSX' : 'JSON'}); fonte XLSX ambígua (${sel.reason}): sem comparação; nunca DIVERGENCIA_REAL/EQUIVALENTE` };
    }
    return { ...r, ...common, class: CLASSES.FONTE_AMBIGUA, invalidSource: null, jsonValid: r.jsonValid === false ? false : r.jsonPresent === false ? null : true,
      note: `fonte XLSX ambígua (${sel.reason}): sem registro único, comparação impedida; nunca DIVERGENCIA_REAL/EQUIVALENTE/DADO_INVALIDO; classe do JSON isolado: ${r.class}` };
  });
}

/**
 * Decodificação UTF-8 ESTRITA (TextDecoder fatal). Nunca substitui bytes inválidos por U+FFFD.
 * @param {Uint8Array} bytes @returns {{ok:true, text:string}|{ok:false, firstInvalidByteOffset:number|null}}
 */
export function decodeUtf8Strict(bytes) {
  try { return { ok: true, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }; }
  catch { return { ok: false, firstInvalidByteOffset: firstInvalidUtf8Offset(bytes) }; }
}
function firstInvalidUtf8Offset(b) { // só evidência: índice do byte em que o decodificador estrito falhou (null = sequência truncada no fim)
  const d = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  for (let i = 0; i < b.length; i++) { try { d.decode(b.subarray(i, i + 1), { stream: true }); } catch { return i; } }
  return null;
}

/** Dados de coleta registrados no log, preservados como estão (hash/tamanho/status originais; nunca recalculados aqui). */
const logged = (e, sizeKey) => ({ loggedSha256: Object.prototype.hasOwnProperty.call(e, 'sha256') ? e.sha256 : null, loggedBytes: Object.prototype.hasOwnProperty.call(e, sizeKey) ? e[sizeKey] : null, loggedHttpStatus: Object.prototype.hasOwnProperty.call(e, 'status') ? e.status : null });
const API = /^https:\/\/servicebus3\.caixa\.gov\.br\/portaldeloterias\/api\/(megasena|lotofacil|quina|lotomania)(?:\/([1-9][0-9]{0,8}))?$/;
/**
 * Amostras a partir dos logs de requisição (Fase 3b.2 e, opcionalmente, 3b.1), SEM confiar em caminhos dos logs:
 * modalidade só pela URL validada; caminho relativo validado (sem "..", absoluto, "\\", NUL ou segmento vazio) e
 * restrito ao subdiretório previsto; timestamp `utc` validado (parseLogTimestamp). Linha adulterada → rejeitada com
 * origem, número da linha e motivo (nunca lida); as demais linhas continuam sendo processadas.
 * Cada amostra preserva loggedSha256/loggedBytes/loggedHttpStatus do log (conferidos depois por verifySampleProvenance).
 * @returns {{samples:{lottery:string, origin:string, url:string, observedAt:string, relFile:string, root:'private'|'extra', justification:string, loggedSha256:any, loggedBytes:any, loggedHttpStatus:any}[], rejected:{origin:string, line:number, reason:string}[]}}
 */
export function collectSamples({ privateLogText = '', extraLogText = null }) {
  const samples = []; const rejected = [];
  const lines = t => t.split('\n').map((l, i) => [l, i + 1]).filter(([l]) => l.trim());
  for (const [line, n] of lines(privateLogText)) {
    let e; try { e = JSON.parse(line); } catch { rejected.push({ origin: 'FASE3B2', line: n, reason: 'LINHA_NAO_JSON' }); continue; }
    if (!e || typeof e !== 'object' || !e.file) continue;
    const m = typeof e.url === 'string' ? API.exec(e.url) : null;
    if (!m) { rejected.push({ origin: 'FASE3B2', line: n, reason: 'URL_NAO_RECONHECIDA' }); continue; }
    const rel = safeRelativePath(e.file, { prefix: `json/${m[1]}/` });
    if (!rel.ok) { rejected.push({ origin: 'FASE3B2', line: n, reason: rel.reason }); continue; }
    const ts = parseLogTimestamp(e.utc); // validado ANTES de usar; linha inválida rejeitada, demais seguem
    if (!ts.ok) { rejected.push({ origin: 'FASE3B2', line: n, reason: ts.reason, utcLiteral: ts.literal }); continue; }
    samples.push({ lottery: m[1], origin: 'FASE3B2', url: e.url, observedAt: e.utc, relFile: rel.path, root: 'private', justification: e.justification, ...logged(e, 'bytes') });
  }
  if (extraLogText !== null) for (const [line, n] of lines(extraLogText)) {
    let e; try { e = JSON.parse(line); } catch { rejected.push({ origin: 'FASE3B1', line: n, reason: 'LINHA_NAO_JSON' }); continue; }
    const m = e && typeof e.url === 'string' ? API.exec(e.url) : null;
    if (!m || !m[2] || e.status !== 200 || !e.file) continue;
    const rel = safeRelativePath(e.file, { prefix: 'raw/' }); // estrito: sem "basename" de caminhos estranhos
    if (!rel.ok) { rejected.push({ origin: 'FASE3B1', line: n, reason: rel.reason }); continue; }
    const ts = parseLogTimestamp(e.utc); // antes: new Date(e.utc).toISOString() lançava RangeError e abortava a coleta inteira
    if (!ts.ok) { rejected.push({ origin: 'FASE3B1', line: n, reason: ts.reason, utcLiteral: ts.literal }); continue; }
    samples.push({ lottery: m[1], origin: 'FASE3B1', url: e.url, observedAt: ts.iso, relFile: rel.path, root: 'extra', justification: 'amostra da Fase 3b.1 (reutilizada, sem nova requisição)', ...logged(e, 'size') });
  }
  return { samples, rejected };
}
