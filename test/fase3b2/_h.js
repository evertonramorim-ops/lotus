// SYNTHETIC_DATA — utilitários de teste da Fase 3b.2.
import { captureRaw, importXlsx } from '../../src/historical/importer.js';
import { syntheticWorkbook, SYNTH_META } from './_xlsx-writer.js';
export function imp(lottery, opt = {}, bytes = null) {
  const b = bytes ?? syntheticWorkbook(lottery, opt);
  const { envelope, collection } = captureRaw(b, { ...SYNTH_META(lottery, opt.name ?? 't'), lottery });
  return { ...importXlsx({ envelope, collection, lottery, limits: opt.limits }), envelope, collection, bytes: b };
}
/** Altera célula (linha de dados i, cabeçalho h) via mutate. */
export const setCell = (i, h, v) => ({ header, rows }) => { rows[i][header.indexOf(h)] = v; return { header, rows }; };
export const chain = (...fs) => d => fs.reduce((acc, f) => f(acc), d);
export const reasons = r => r.quarantine.flatMap(q => q.reasons.map(x => x.code));
