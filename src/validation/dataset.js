/**
 * Validação de CONJUNTO de registros de resultado (mesma ou várias modalidades).
 * - Duplicidade de concurso (lottery+contest): idêntica (mesmo hash) ou CONFLITANTE (hash diferente) → erro.
 * - Lacunas na numeração: apenas REPORTADAS (info), não são erro automático (o conjunto pode ser parcial).
 * - Datas fora de ordem em relação ao número do concurso: aviso.
 * @module validation/dataset
 */
import { hashJson } from '../integrity/hash.js';
import { validateResultRecord } from './result.js';

/**
 * @param {object[]} records
 * @returns {{valid:boolean, errors:object[], warnings:object[], gaps:Record<string,{from:number,to:number}[]>, perRecord:{index:number,valid:boolean,errors:object[]}[]}}
 */
export function validateResultDataset(records) {
  if (!Array.isArray(records)) throw new TypeError('records deve ser array');
  const errors = []; const warnings = []; const gaps = {}; const perRecord = [];
  /** @type {Map<string, {index:number, hash:string}>} */ const byKey = new Map();
  /** @type {Map<string, {contest:number, drawDate:string}[]>} */ const byLottery = new Map();
  records.forEach((r, index) => {
    const v = validateResultRecord(r);
    perRecord.push({ index, valid: v.valid, errors: v.errors });
    if (!v.valid) { errors.push({ code: 'INVALID_RECORD', index, detail: v.errors.map(e => e.code) }); return; }
    const key = `${r.lottery}#${r.contest}`; const h = hashJson(r);
    const prev = byKey.get(key);
    if (prev) {
      errors.push({ code: prev.hash === h ? 'DUPLICATE_CONTEST_IDENTICAL' : 'DUPLICATE_CONTEST_CONFLICT', index, firstIndex: prev.index, key });
      return;
    }
    byKey.set(key, { index, hash: h });
    if (!byLottery.has(r.lottery)) byLottery.set(r.lottery, []);
    byLottery.get(r.lottery).push({ contest: r.contest, drawDate: r.drawDate });
  });
  for (const [lot, list] of byLottery) {
    list.sort((a, b) => a.contest - b.contest);
    const g = [];
    for (let i = 1; i < list.length; i++) {
      if (list[i].contest > list[i - 1].contest + 1) g.push({ from: list[i - 1].contest + 1, to: list[i].contest - 1 });
      if (list[i].drawDate < list[i - 1].drawDate) warnings.push({ code: 'DATE_ORDER', lottery: lot, contest: list[i].contest });
    }
    if (g.length) gaps[lot] = g;
  }
  return { valid: errors.length === 0, errors, warnings, gaps, perRecord };
}
