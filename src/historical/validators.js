/**
 * Camada D — VALIDADORES independentes e versionados (`lotus.historical-validators`).
 * V01–V10 e V16 (fórmulas): por registro · V11–V15: por conjunto e esquema (lista completa: V01–V16). Cada problema traz: código (motivo de quarentena),
 * validador/versão, regra aplicada, campo, célula, valor original e interpretado, evidência.
 * Reutiliza validateNumbers (Fase 3a) para quantidade/intervalo/repetição.
 * @module historical/validators
 */
import { LOTTERY_IDS, resultRules } from '../data/schema.js';
import { validateNumbers } from '../validation/result.js';
import { hashJson } from '../integrity/hash.js';
import { canonicalize } from '../integrity/jcs.js';
import { periodFor, TIER_RULES_ID, TIER_RULES_VERSION } from './tier-rules.js';
import { traceMap } from './normalize.js';
import { Q, A } from './codes.js';
import { ABSENCE } from './values.js';

export const VALIDATORS = Object.freeze({
  V01: { name: 'modalidade', version: '1.0.0', rule: 'lottery ∈ {megasena, lotofacil, quina, lotomania} e igual à do adaptador' },
  V02: { name: 'concurso', version: '1.0.0', rule: 'Concurso: célula numérica com inteiro ≥ 1' },
  V03: { name: 'data', version: '1.0.0', rule: 'Data: texto dd/mm/aaaa de calendário gregoriano real (ou serial Excel válido); sem locale; sem correção' },
  V04: { name: 'quantidade-dezenas', version: '1.0.0', rule: 'Mega 6 · Lotofácil 15 · Quina 5 · Lotomania 20 (config Fase 1)' },
  V05: { name: 'intervalo-dezenas', version: '1.0.0', rule: 'Mega 1–60 · Lotofácil 1–25 · Quina 1–80 · Lotomania 0–99' },
  V06: { name: 'dezenas-repetidas', version: '1.0.0', rule: 'Sem dezena repetida no mesmo concurso' },
  V07: { name: 'faixas-por-vigencia', version: '1.0.0', rule: `${TIER_RULES_ID}/${TIER_RULES_VERSION}: faixas presentes devem coincidir com o período; períodos sem ato normativo → RULE_NOT_VERIFIED` },
  V08: { name: 'tipos-monetarios', version: '1.0.0', rule: 'Dinheiro "R$#.###,##" → centavos inteiros; ganhadores inteiro ≥ 0; vazio/"-" = ausência (null), nunca zero' },
  V09: { name: 'obrigatorios', version: '1.0.0', rule: 'Concurso, data, dezenas, faixas e campos econômicos mapeados devem existir (exceto ausência prevista pelo período)' },
  V10: { name: 'integridade-origem', version: '1.0.0', rule: 'rawSha256 do registro = SHA-256 do arquivo bruto; todo campo tipado aponta para célula; adaptador/parser coerentes' },
  V11: { name: 'duplicatas', version: '1.0.0', rule: 'Mesmo concurso: conteúdo canônico idêntico → duplicata registrada (um só concurso); diferente → conflito' },
  V12: { name: 'lacunas', version: '1.0.0', rule: 'Números ausentes entre 1 e o maior concurso presente → CONCURSO_AUSENTE (lacuna não resolvida; não presume erro da fonte)' },
  V13: { name: 'datas-monotonicas', version: '1.0.0', rule: 'Ordenado por concurso, data não pode recuar; outlier isolado vai à quarentena; sem reordenar nem corrigir' },
  V14: { name: 'conflitos', version: '1.0.0', rule: 'Comparação campo a campo entre registros do mesmo concurso (duplicatas ou fontes distintas)' },
  V16: { name: 'formulas', version: '1.0.0', rule: 'Célula com fórmula (<f>) em campo mapeado (concurso, data, dezena, ganhadores, prêmio, econômico, texto) → FORMULA_EM_CAMPO_HISTORICO (bloqueante); fórmula nunca é avaliada e o valor em cache nunca é aceito' },
  V15: { name: 'esquema', version: '1.0.0', rule: 'Cabeçalhos/planilha diferentes da especificação do adaptador → SCHEMA_INESPERADO' },
});
export const VALIDATORS_ID = 'lotus.historical-validators';
export const VALIDATORS_VERSION = '1.1.0';

const mk = (vid, code, blocking, message, extra = {}) => ({ code, blocking, validatorId: vid, validatorVersion: VALIDATORS[vid].version, rule: VALIDATORS[vid].rule, message, ...extra });

/**
 * Validação por registro. @returns {{issues:object[], annotations:object[], blocking:boolean, ruleStatus:string}}
 */
export function validateRecord(rec, ctx) {
  const issues = []; const ann = [];
  // V16 — fórmula em campo mapeado: bloqueia (valor em cache não é prova do resultado)
  for (const f of rec.formulaCells ?? []) issues.push(mk('V16', Q.FORMULA_EM_CAMPO_HISTORICO, true, `fórmula em ${f.column} (${f.ref}); valor em cache não aceito`, { field: f.column, ref: f.ref, originalValue: f.cachedValue, evidence: { ref: f.ref, column: f.column, kind: f.kind, expression: f.expression, formulaType: f.formulaType, cachedValue: f.cachedValue, cachedType: f.cachedType } }));
  // V01
  if (!LOTTERY_IDS.includes(rec.lottery) || rec.lottery !== ctx.adapter.lottery) issues.push(mk('V01', Q.MODALIDADE_INVALIDA, true, `modalidade ${rec.lottery}`, { field: 'lottery', originalValue: rec.lottery }));
  // V02
  const cf = rec.contestField;
  if (cf.absent) issues.push(mk('V09', Q.CAMPO_OBRIGATORIO_AUSENTE, true, 'concurso ausente', { field: 'contest', ref: cf.ref, originalValue: cf.raw }));
  else if (!cf.valid) issues.push(mk('V02', cf.raw !== null && /^[0-9]+$/.test(String(cf.raw)) ? Q.CONCURSO_INVALIDO : Q.CELULA_TIPO_INVALIDO, true, cf.invalidReason || 'concurso inválido', { field: 'contest', ref: cf.ref, originalValue: cf.raw }));
  // V03
  const df = rec.drawDateField;
  if (df.absent) issues.push(mk('V09', Q.CAMPO_OBRIGATORIO_AUSENTE, true, 'data ausente', { field: 'drawDate', ref: df.ref, originalValue: df.raw }));
  else if (!df.valid) issues.push(mk('V03', df.representation ? Q.DATA_INVALIDA : Q.CELULA_TIPO_INVALIDO, true, df.invalidReason || 'data inválida', { field: 'drawDate', ref: df.ref, originalValue: df.raw }));
  // V04–V06 (dezenas)
  const badBalls = rec.numberFields.filter(b => !b.absent && !b.valid);
  const absentBalls = rec.numberFields.filter(b => b.absent);
  for (const b of badBalls) issues.push(mk('V08', Q.CELULA_TIPO_INVALIDO, true, `dezena não inteira (${b.invalidReason})`, { field: b.column, ref: b.ref, originalValue: b.raw }));
  if (absentBalls.length) issues.push(mk('V04', Q.QUANTIDADE_DEZENAS_INCORRETA, true, `${absentBalls.length} dezena(s) ausente(s)`, { field: 'numbers', refs: absentBalls.map(b => b.ref), originalValue: absentBalls.map(b => b.raw) }));
  if (rec.numbers && LOTTERY_IDS.includes(rec.lottery)) {
    const r = resultRules(rec.lottery);
    for (const e of validateNumbers(rec.lottery, rec.numbers)) {
      if (e.code === 'COUNT_MISMATCH') issues.push(mk('V04', Q.QUANTIDADE_DEZENAS_INCORRETA, true, e.message, { field: 'numbers', originalValue: rec.numbersAsListed }));
      else if (e.code === 'OUT_OF_RANGE') { const i = Number(/\[(\d+)\]/.exec(e.path)[1]); const val = rec.numbers[i]; const f = rec.numberFields.find(b => b.value === val); issues.push(mk('V05', Q.DEZENA_FORA_DO_INTERVALO, true, e.message, { field: f?.column, ref: f?.ref, originalValue: f?.raw, interpretedValue: val, expected: `${r.minNumber}..${r.maxNumber}` })); }
      else if (e.code === 'DUPLICATE_NUMBER' && !issues.some(x => x.code === Q.DEZENA_REPETIDA)) { const dupVals = rec.numbers.filter((v, k, a) => a.indexOf(v) !== k); issues.push(mk('V06', Q.DEZENA_REPETIDA, true, e.message, { field: 'numbers', refs: rec.numberFields.filter(b => dupVals.includes(b.value)).map(b => b.ref), interpretedValue: dupVals })); }
    }
    if (rec.numbersAsListed.every((v, k, a) => k === 0 || a[k - 1] < v)) ann.push({ code: A.ORDER_NOT_AVAILABLE, message: 'dezenas listadas em ordem crescente; ordem de extração indisponível no XLSX' });
    else ann.push({ code: A.ORDER_NOT_AVAILABLE, message: 'dezenas listadas fora de ordem crescente; ainda assim NÃO se presume que seja a ordem de extração' });
  }
  // V07 faixas por período
  let ruleStatus = 'NOT_EVALUATED';
  if (Number.isSafeInteger(rec.contest)) {
    const p = periodFor(rec.lottery, rec.contest);
    const present = rec.prizeTiers.filter(t => !(t.winners.absenceReason === ABSENCE.DASH && (t.prize.absenceReason === ABSENCE.DASH || t.prize.absent))).map(t => t.hits);
    if (!p) { ruleStatus = 'NO_PERIOD'; issues.push(mk('V07', Q.REGRA_HISTORICA_NAO_VERIFICADA, true, 'nenhum período de faixas cobre este concurso', { field: 'prizeTiers', interpretedValue: present })); }
    else {
      const same = canonicalize([...present].sort((a, b) => a - b)) === canonicalize([...p.presentTiers].sort((a, b) => a - b));
      if (!same) { ruleStatus = 'STRUCTURE_NOT_EXPECTED'; issues.push(mk('V07', Q.REGRA_HISTORICA_NAO_VERIFICADA, true, `faixas presentes ${present.join(',')} ≠ período ${p.from}–${p.to ?? '…'} (${p.presentTiers.join(',')})`, { field: 'prizeTiers', interpretedValue: present, expected: p.presentTiers, evidence: { period: p } })); }
      else { ruleStatus = p.status; ann.push({ code: A.RULE_NOT_VERIFIED, message: `estrutura de faixas coincide com período observado ${p.from}–${p.to ?? '…'}; ato normativo não verificado` }); }
      for (const t of rec.prizeTiers) if (!p.presentTiers.includes(t.hits) && (t.winners.absent || t.prize.absent)) ann.push({ code: A.ABSENT_BY_PERIOD_RULE, message: `faixa ${t.description} ausente (${t.winners.absenceReason}) — prevista pelo período observado`, refs: [t.winners.ref, t.prize.ref] });
    }
    // V08/V09 nas faixas
    for (const t of rec.prizeTiers) {
      const expected = p ? p.presentTiers.includes(t.hits) : true;
      for (const [fld, f] of [['winners', t.winners], ['prize', t.prize]]) {
        if (!f.valid) issues.push(mk('V08', fld === 'prize' ? Q.VALOR_MONETARIO_INVALIDO : Q.CELULA_TIPO_INVALIDO, true, `${f.column}: ${f.invalidReason}`, { field: `tier${t.tier}.${fld}`, ref: f.ref, originalValue: f.raw }));
        else if (f.absent && expected) issues.push(mk('V09', f.absenceReason === ABSENCE.DASH ? Q.REGRA_HISTORICA_NAO_VERIFICADA : Q.CAMPO_OBRIGATORIO_AUSENTE, true, `${f.column} ausente (${f.absenceReason}) em faixa prevista para o período`, { field: `tier${t.tier}.${fld}`, ref: f.ref, originalValue: f.raw }));
      }
    }
  }
  // V08/V09 econômicos
  for (const [k, m] of Object.entries(rec.economic)) {
    if (!m.valid) issues.push(mk('V08', Q.VALOR_MONETARIO_INVALIDO, true, `${m.column}: ${m.invalidReason}`, { field: `economic.${k}`, ref: m.ref, originalValue: m.raw }));
    else if (m.absent && m.absenceReason !== ABSENCE.DASH) issues.push(mk('V09', Q.CAMPO_OBRIGATORIO_AUSENTE, true, `${m.column} ausente (${m.absenceReason})`, { field: `economic.${k}`, ref: m.ref, originalValue: m.raw }));
  }
  if (rec.economic.totalCollected && rec.economic.totalCollected.cents === '0') ann.push({ code: A.ZERO_LITERAL_SEMANTICS_UNVERIFIED, message: 'Arrecadação = R$0,00 literal da fonte; mantido como 0 (não convertido em null); semântica de "não informado" não verificada', ref: rec.economic.totalCollected.ref });
  if (rec.drawDate && rec.drawDate < '1994-07-01') ann.push({ code: A.CURRENCY_PRE_REAL_NOT_VERIFIED, message: 'concurso anterior a 01/07/1994 (Plano Real): unidade monetária NÃO verificada; valores não convertidos' });
  // V10
  if (rec.source.rawSha256 !== ctx.rawSha256) issues.push(mk('V10', Q.INTEGRIDADE_ORIGEM, true, 'rawSha256 do registro difere do arquivo bruto', { field: 'source.rawSha256', originalValue: rec.source.rawSha256, expected: ctx.rawSha256 }));
  if (rec.source.adapterId !== ctx.adapter.adapterId || rec.source.adapterVersion !== ctx.adapter.version) issues.push(mk('V10', Q.INTEGRIDADE_ORIGEM, true, 'adaptador divergente'));
  for (const [fld, ref] of Object.entries(traceMap(rec))) if (ref !== null && !/^[A-Z]{1,3}[1-9][0-9]*$/.test(ref)) issues.push(mk('V10', Q.INTEGRIDADE_ORIGEM, true, `referência inválida em ${fld}`));
  return { issues, annotations: ann, blocking: issues.some(i => i.blocking), ruleStatus };
}

/** Conteúdo canônico (sem localização física) usado para duplicata/conflito. */
export function canonicalContent(rec) {
  const m = x => ({ cents: x.cents, raw: x.raw, absent: x.absent });
  return {
    lottery: rec.lottery, contest: rec.contest, drawDate: rec.drawDate, drawDateRaw: rec.drawDateField.raw, numbers: rec.numbers, numbersAsListed: rec.numbersAsListed,
    prizeTiers: rec.prizeTiers.map(t => ({ hits: t.hits, winners: { value: t.winners.value, raw: t.winners.raw, absent: t.winners.absent }, prize: m(t.prize) })),
    economic: Object.fromEntries(Object.entries(rec.economic).map(([k, v]) => [k, m(v)])),
    winnerLocations: rec.winnerLocations.text, observation: rec.observation.text,
    extras: rec.extras.map(e => ({ header: e.header, raw: e.raw, text: e.text })),
  };
}

/** V14 — diferença campo a campo entre dois objetos JSON (caminhos folha). */
export function fieldDiff(a, b, path = '$', out = []) {
  const isObj = v => v !== null && typeof v === 'object';
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) fieldDiff(a[k], b[k], Array.isArray(a) ? `${path}[${k}]` : `${path}.${k}`, out);
  } else if (canonicalize(a === undefined ? null : a) !== canonicalize(b === undefined ? null : b) || (a === undefined) !== (b === undefined)) out.push({ path, a: a === undefined ? '<ausente>' : a, b: b === undefined ? '<ausente>' : b });
  return out;
}

/**
 * V11–V15 sobre o conjunto. @param {{rec:object, row:number}[]} items registros normalizados com resultado individual
 * @returns {{duplicatesIdentical:object[], conflicts:object[], gaps:object[], dateAnomalies:object[], contestsPresent:number[]}}
 */
export function validateDataset(items, lottery) {
  const groups = new Map();
  for (const it of items) if (Number.isSafeInteger(it.rec.contest)) { if (!groups.has(it.rec.contest)) groups.set(it.rec.contest, []); groups.get(it.rec.contest).push(it); }
  const duplicatesIdentical = []; const conflicts = [];
  for (const [contest, list] of groups) {
    if (list.length < 2) continue;
    const hashes = list.map(it => hashJson(canonicalContent(it.rec)));
    if (hashes.every(h => h === hashes[0])) duplicatesIdentical.push({ contest, keptRow: list[0].rec.source.row, duplicateRows: list.slice(1).map(it => it.rec.source.row), canonicalSha256: hashes[0], validatorId: 'V11', validatorVersion: VALIDATORS.V11.version });
    else conflicts.push({ contest, rows: list.map(it => it.rec.source.row), canonicalSha256: hashes, diffs: list.slice(1).map(it => ({ rowA: list[0].rec.source.row, rowB: it.rec.source.row, fields: fieldDiff(canonicalContent(list[0].rec), canonicalContent(it.rec)) })), validatorId: 'V11+V14', validatorVersion: VALIDATORS.V14.version });
  }
  const present = [...groups.keys()].sort((a, b) => a - b);
  const gaps = [];
  if (present.length) { const set = new Set(present); for (let c = 1; c <= present[present.length - 1]; c++) if (!set.has(c)) gaps.push(c); }
  // V13: uma data por concurso (primeira ocorrência), apenas datas válidas
  const seq = present.map(c => ({ contest: c, date: groups.get(c)[0].rec.drawDate, row: groups.get(c)[0].rec.source.row, ref: groups.get(c)[0].rec.drawDateField.ref, raw: groups.get(c)[0].rec.drawDateField.raw })).filter(x => x.date);
  const outliers = new Set(); const dateAnomalies = [];
  for (let i = 0; i < seq.length; i++) {
    const p = seq[i - 1], c = seq[i], n = seq[i + 1];
    const okPrev = !p || p.date <= c.date, okNext = !n || c.date <= n.date;
    if (okPrev && okNext) continue;
    if (p && n && p.date <= n.date) { outliers.add(i); dateAnomalies.push({ contest: c.contest, row: c.row, ref: c.ref, raw: c.raw, interpreted: c.date, previous: p ? { contest: p.contest, date: p.date } : null, next: n ? { contest: n.contest, date: n.date } : null, classification: 'ISOLATED_OUTLIER', validatorId: 'V13', validatorVersion: VALIDATORS.V13.version }); }
  }
  for (let i = 1; i < seq.length; i++) {
    if (seq[i - 1].date <= seq[i].date || outliers.has(i) || outliers.has(i - 1)) continue;
    for (const k of [i - 1, i]) if (!dateAnomalies.some(d => d.contest === seq[k].contest)) dateAnomalies.push({ contest: seq[k].contest, row: seq[k].row, ref: seq[k].ref, raw: seq[k].raw, interpreted: seq[k].date, pair: [seq[i - 1].contest, seq[i].contest], classification: 'PAIR_INVERSION', validatorId: 'V13', validatorVersion: VALIDATORS.V13.version });
  }
  void lottery;
  return { duplicatesIdentical, conflicts, gaps, dateAnomalies, contestsPresent: present };
}

/** V15 — alertas de esquema → motivo SCHEMA_INESPERADO (um por arquivo). */
export function schemaIssues(schemaAnalysis) {
  if (!schemaAnalysis.schemaChanged && !schemaAnalysis.blocking) return [];
  return [mk('V15', schemaAnalysis.blocking ? Q.ARQUIVO_INCOMPATIVEL : Q.SCHEMA_INESPERADO, !!schemaAnalysis.blocking, 'estrutura da planilha difere da especificação do adaptador', { evidence: { alerts: schemaAnalysis.alerts } })];
}
