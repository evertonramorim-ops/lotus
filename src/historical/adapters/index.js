/** Registro dos adaptadores independentes por modalidade. @module historical/adapters */
import { MEGASENA_ADAPTER } from './megasena.js';
import { LOTOFACIL_ADAPTER } from './lotofacil.js';
import { QUINA_ADAPTER } from './quina.js';
import { LOTOMANIA_ADAPTER } from './lotomania.js';
export { MEGASENA_ADAPTER, LOTOFACIL_ADAPTER, QUINA_ADAPTER, LOTOMANIA_ADAPTER };
export const XLSX_ADAPTERS = Object.freeze({ megasena: MEGASENA_ADAPTER, lotofacil: LOTOFACIL_ADAPTER, quina: QUINA_ADAPTER, lotomania: LOTOMANIA_ADAPTER });
export function getXlsxAdapter(lottery) { const a = XLSX_ADAPTERS[lottery]; if (!a) throw new RangeError(`sem adaptador XLSX para: ${lottery}`); return a; }
