/**
 * Classificação de UMA amostra JSON na reconciliação offline (extraída de scripts/reconciliar-fase3b2.mjs).
 * Função pura: não lê disco nem rede; recebe o texto JSON, o mapa concurso → registro XLSX e os metadados.
 * Estados: JSON_INVALIDO (texto não é JSON) · JSON_DADO_INVALIDO (número do concurso presente mas inválido;
 * linha DADO_INVALIDO explícita, nunca ausência) · JSON_SEM_RESULTADO (concurso ausente/nulo) · VALIDO (fluxo normal).
 * @module historical/reconcile-sample
 */
import { adaptJsonResult, compareRecords, divergenceQuarantine, summarize } from './reconcile.js';

export const SAMPLE_STATUS = Object.freeze({ JSON_INVALIDO: 'JSON_INVALIDO', JSON_DADO_INVALIDO: 'JSON_DADO_INVALIDO', JSON_SEM_RESULTADO: 'JSON_SEM_RESULTADO', VALIDO: 'VALIDO' });

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
  let j; try { j = adaptJsonResult(text); } catch (e) { return { status: SAMPLE_STATUS.JSON_INVALIDO, entry: { ...s, file: undefined, jsonSha256, status: SAMPLE_STATUS.JSON_INVALIDO, error: e.message }, rows: [], quarantine: null }; }
  const status = classifyJsonContest(j);
  const ctx = { xlsxLastContest: meta.lastContest, xlsxObservedAt: meta.xlsxObservedAt, jsonObservedAt: s.observedAt, jsonSha256, jsonUrl: s.url, lottery: s.lottery };
  if (status === SAMPLE_STATUS.JSON_DADO_INVALIDO) { // concurso inválido ≠ ausência: DADO_INVALIDO explícito
    const rows = compareRecords(null, j, ctx);
    return { status, rows, quarantine: null, entry: { lottery: s.lottery, contest: null, contestLiteral: j.contestField.literal, contestInvalidReason: j.contestField.invalidReason, origin: s.origin, url: s.url, observedAt: s.observedAt, jsonSha256, status, classes: summarize(rows), rows } };
  }
  if (status === SAMPLE_STATUS.JSON_SEM_RESULTADO) return { status, rows: [], quarantine: null, entry: { ...s, file: undefined, jsonSha256, status } };
  const x = xlsxRecords.get(j.contest) ?? null;
  const rows = compareRecords(x, j, ctx);
  const quarantine = x ? divergenceQuarantine(x, j, rows, ctx) : null;
  return { status, rows, quarantine, entry: { lottery: s.lottery, contest: j.contest, origin: s.origin, url: s.url, observedAt: s.observedAt, xlsxObservedAt: ctx.xlsxObservedAt, jsonSha256, xlsxStatus: x ? (x.__quarantined ? 'QUARENTENA' : 'ACEITO') : 'AUSENTE', justification: s.justification, classes: summarize(rows), rows } };
}
