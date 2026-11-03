/**
 * Normalizador determinístico: envelope bruto → registro canônico `lotus.result`.
 * Formato de entrada aceito nesta fase: "lotus.synthetic-input/1" — formato INTERNO usado apenas
 * pelas fixtures SYNTHETIC_DATA; NÃO é o formato de nenhuma fonte oficial. Campos:
 *   { lottery:string, contest:number|"123", drawDate:"AAAA-MM-DD"|"DD/MM/AAAA", numbers:(number|"07")[] }
 * Transformações: dezenas em texto ("07") → inteiro; ordenação crescente; data DD/MM/AAAA → ISO;
 * concurso em texto de dígitos → inteiro. Nada mais é inferido. Sem relógio, sem aleatoriedade.
 * @module data/normalize
 */
import { RESULT_SCHEMA, RESULT_SCHEMA_VERSION } from './schema.js';
import { rawText, verifyRawEnvelopeDetailed } from './raw.js';
import { createQuarantineEntry } from './quarantine.js';
import { validateResultRecord } from '../validation/result.js';
import { validateResultDataset } from '../validation/dataset.js';
import { issue, isPlainObject } from '../validation/common.js';
import { assertNoDuplicateKeys } from '../integrity/jcs.js';
import { hashJson } from '../integrity/hash.js';

export const PARSER_ID = 'lotus.synthetic-input';
export const PARSER_VERSION = '1.0.0';
const INPUT_FIELDS = ['lottery', 'contest', 'drawDate', 'numbers'];

function toInt(v, path, out, label) {
  if (typeof v === 'number') return v; // tipo/intervalo checados pelo validador
  if (typeof v === 'string' && /^[0-9]{1,6}$/.test(v)) return Number(v);
  out.push(issue('UNPARSEABLE_' + label, path, `valor não reconhecido: ${JSON.stringify(v)}`));
  return undefined;
}

/**
 * Normaliza um envelope bruto.
 * @returns {{status:'accepted', record:object, rawSha256:string, recordSha256:string, parserVersion:string, validation:{valid:true, errors:[]}}
 *          | {status:'quarantined', quarantine:object}}
 */
export function normalizeRaw(env) {
  const q = (stage, reasons, candidate = null) => ({ status: 'quarantined', quarantine: createQuarantineEntry({ rawSha256: env && typeof env.sha256 === 'string' ? env.sha256 : null, stage, reasons, parserVersion: PARSER_VERSION, candidate }) });
  const ver = verifyRawEnvelopeDetailed(env);
  if (!ver.ok) return q('parse', [issue('RAW_INTEGRITY', '$', 'envelope bruto ausente, malformado ou alterado (verificação completa falhou)'), ...ver.errors]);
  let input;
  try { const t = rawText(env); assertNoDuplicateKeys(t); input = JSON.parse(t); } catch (e) { return q('parse', [issue('PARSE_ERROR', '$', String(e.message))]); }
  if (!isPlainObject(input)) return q('parse', [issue('WRONG_TYPE', '$', 'entrada deve ser objeto JSON')]);
  const errs = [];
  for (const k of Object.keys(input)) if (!INPUT_FIELDS.includes(k)) errs.push(issue('UNKNOWN_FIELD', `$.${k}`, `campo não previsto: ${k}`));
  for (const k of INPUT_FIELDS) if (!(k in input)) errs.push(issue('MISSING_FIELD', `$.${k}`, `campo obrigatório ausente: ${k}`));
  if (errs.length) return q('normalize', errs);
  const contest = toInt(input.contest, '$.contest', errs, 'CONTEST');
  let drawDate = input.drawDate;
  if (typeof drawDate === 'string') { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(drawDate); if (m) drawDate = `${m[3]}-${m[2]}-${m[1]}`; }
  let numbers = input.numbers;
  if (Array.isArray(numbers)) {
    numbers = numbers.map((n, i) => toInt(n, `$.numbers[${i}]`, errs, 'NUMBER'));
    if (numbers.every(n => typeof n === 'number')) numbers = numbers.slice().sort((a, b) => a - b);
  }
  if (errs.length) return q('normalize', errs);
  const record = { schema: RESULT_SCHEMA, schemaVersion: RESULT_SCHEMA_VERSION, lottery: input.lottery, contest, drawDate, numbers, provenance: { ...env.provenance } };
  const v = validateResultRecord(record);
  if (!v.valid) return q('validate', v.errors, record);
  return { status: 'accepted', record, rawSha256: env.sha256, recordSha256: hashJson(record), parserVersion: PARSER_VERSION, validation: { valid: true, errors: [] } };
}

/**
 * Processa um lote: todo envelope termina em `accepted` OU em quarentena (accepted+quarantined = entrada).
 * Duplicidades de concurso dentro do lote vão para quarentena no estágio `dataset` (primeira ocorrência mantida).
 */
export function processBatch(envelopes, store) {
  const accepted = []; const quarantined = [];
  for (const env of envelopes) {
    const r = normalizeRaw(env);
    if (r.status === 'accepted') accepted.push(r); else quarantined.push(r.quarantine);
  }
  const ds = validateResultDataset(accepted.map(a => a.record));
  const dupIdx = new Set(ds.errors.filter(e => e.code.startsWith('DUPLICATE_CONTEST')).map(e => e.index));
  const kept = [];
  accepted.forEach((a, i) => {
    if (!dupIdx.has(i)) { kept.push(a); return; }
    const e = ds.errors.find(x => x.index === i);
    quarantined.push(createQuarantineEntry({ rawSha256: a.rawSha256, stage: 'dataset', parserVersion: PARSER_VERSION, candidate: a.record,
      reasons: [issue(e.code, '$', `concurso ${e.key} já presente no lote (índice ${e.firstIndex})`)] }));
  });
  if (store) for (const qe of quarantined) store.add(qe);
  if (kept.length + quarantined.length !== envelopes.length) throw new Error('invariante violada: registro perdido no processamento');
  return { accepted: kept, quarantined, gaps: ds.gaps, warnings: ds.warnings };
}
