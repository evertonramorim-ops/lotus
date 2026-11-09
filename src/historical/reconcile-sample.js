/**
 * Classificação de UMA amostra JSON na reconciliação offline (extraída de scripts/reconciliar-fase3b2.mjs) e
 * montagem SEGURA da lista de amostras a partir dos logs. Funções puras: não leem disco nem rede.
 * Estados: JSON_INVALIDO (sintaxe ou tamanho) · JSON_SCHEMA_INVALIDO (JSON válido com raiz que não é objeto:
 * null, array, string, número, booleano) · JSON_DADO_INVALIDO (concurso presente mas inválido) · JSON_SEM_RESULTADO
 * (objeto sem concurso ou com concurso nulo) · VALIDO (fluxo normal). Em TODOS os estados com objeto JSON, os campos
 * são validados de forma independente (compareRecords com x = null); a ausência do XLSX nunca torna o JSON "válido".
 * @module historical/reconcile-sample
 */
import { adaptJsonResult, compareRecords, divergenceQuarantine, summarize, JsonSchemaError } from './reconcile.js';
import { safeRelativePath } from './store.js';

export const SAMPLE_STATUS = Object.freeze({ JSON_INVALIDO: 'JSON_INVALIDO', JSON_SCHEMA_INVALIDO: 'JSON_SCHEMA_INVALIDO', JSON_DADO_INVALIDO: 'JSON_DADO_INVALIDO', JSON_SEM_RESULTADO: 'JSON_SEM_RESULTADO', VALIDO: 'VALIDO' });
export const LOTTERY_IDS = Object.freeze(['megasena', 'lotofacil', 'quina', 'lotomania']);

/** Decisão sobre o concurso do JSON adaptado (sem efeitos colaterais). */
export function classifyJsonContest(j) {
  if (j.contestField && j.contestField.present && !j.contestField.valid) return SAMPLE_STATUS.JSON_DADO_INVALIDO;
  if (j.contest === null || j.contest === undefined) return SAMPLE_STATUS.JSON_SEM_RESULTADO;
  return SAMPLE_STATUS.VALIDO;
}

/**
 * @param {{sample:object, text:string, jsonSha256:string, xlsxRecords:Map<number,object>, meta:{lastContest:number, xlsxObservedAt:string}}} p
 * @returns {{status:string, entry:object, rows:object[], quarantine:object|null}}
 */
export function reconcileSample({ sample: s, text, jsonSha256, xlsxRecords, meta }) {
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
    if (status === SAMPLE_STATUS.JSON_DADO_INVALIDO) return { status, rows, quarantine: null, entry: { lottery: s.lottery, ...contestInfo, origin: s.origin, url: s.url, observedAt: s.observedAt, jsonSha256, status, classes: summarize(rows), rows } };
    return { status, rows, quarantine: null, entry: { ...s, file: undefined, ...contestInfo, jsonSha256, status, classes: summarize(rows), rows } };
  }
  const x = xlsxRecords.get(j.contest) ?? null;
  const rows = compareRecords(x, j, ctx);
  const quarantine = x ? divergenceQuarantine(x, j, rows, ctx) : null;
  return { status, rows, quarantine, entry: { lottery: s.lottery, contest: j.contest, origin: s.origin, url: s.url, observedAt: s.observedAt, xlsxObservedAt: ctx.xlsxObservedAt, jsonSha256, xlsxStatus: x ? (x.__quarantined ? 'QUARENTENA' : 'ACEITO') : 'AUSENTE', justification: s.justification, classes: summarize(rows), rows } };
}

const API = /^https:\/\/servicebus3\.caixa\.gov\.br\/portaldeloterias\/api\/(megasena|lotofacil|quina|lotomania)(?:\/([1-9][0-9]{0,8}))?$/;
/**
 * Amostras a partir dos logs de requisição (Fase 3b.2 e, opcionalmente, 3b.1), SEM confiar em caminhos dos logs:
 * modalidade só pela URL validada; caminho relativo validado (sem "..", absoluto, "\\", NUL ou segmento vazio) e
 * restrito ao subdiretório previsto. Linha adulterada → rejeitada com motivo (nunca lida).
 * @returns {{samples:{lottery:string, origin:string, url:string, observedAt:string, relFile:string, root:'private'|'extra', justification:string}[], rejected:{origin:string, line:number, reason:string}[]}}
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
    samples.push({ lottery: m[1], origin: 'FASE3B2', url: e.url, observedAt: e.utc, relFile: rel.path, root: 'private', justification: e.justification });
  }
  if (extraLogText !== null) for (const [line, n] of lines(extraLogText)) {
    let e; try { e = JSON.parse(line); } catch { rejected.push({ origin: 'FASE3B1', line: n, reason: 'LINHA_NAO_JSON' }); continue; }
    const m = e && typeof e.url === 'string' ? API.exec(e.url) : null;
    if (!m || !m[2] || e.status !== 200 || !e.file) continue;
    const rel = safeRelativePath(e.file, { prefix: 'raw/' }); // estrito: sem "basename" de caminhos estranhos
    if (!rel.ok) { rejected.push({ origin: 'FASE3B1', line: n, reason: rel.reason }); continue; }
    samples.push({ lottery: m[1], origin: 'FASE3B1', url: e.url, observedAt: new Date(e.utc).toISOString(), relFile: rel.path, root: 'extra', justification: 'amostra da Fase 3b.1 (reutilizada, sem nova requisição)' });
  }
  return { samples, rejected };
}
