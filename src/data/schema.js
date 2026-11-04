/**
 * Esquemas canônicos da Fase 3a (nomes INTERNOS do LOTUS; não são contratos oficiais da CAIXA).
 * O mapeamento a partir de qualquer fonte real será definido e validado na Fase 3b.
 *
 * A. Resultado do concurso (`lotus.result` v1.0.0) — somente o que foi sorteado:
 *    { schema, schemaVersion, lottery, contest, drawDate:"AAAA-MM-DD", numbers:int[] (ordem crescente), provenance }
 * B. Dados econômicos (`lotus.economic` v1.0.0, status MODELO NÃO CONFIRMADO) — separado do resultado:
 *    { schema, schemaVersion, modelStatus:"UNCONFIRMED_INTERNAL_MODEL", lottery, contest,
 *      tiers:[{ hits, winners, prizePerWinnerCents }], totalCollectedCents|null, provenance }
 *    Valores monetários em centavos como STRING de dígitos (evita ponto flutuante).
 * Proveniência (`provenance`): { sourceType, sourceId, obtainedAt (ISO UTC fornecido), note }
 * O ESTADO DE VALIDAÇÃO não faz parte do conteúdo hasheado do registro: fica no envelope de
 * processamento (ver normalize.js), pois depende da versão do validador, não do dado.
 * @module data/schema
 */
import { LOTTERIES, getLottery } from '../lotteries/config.js';

export const RESULT_SCHEMA = 'lotus.result';
export const RESULT_SCHEMA_VERSION = '1.0.0';
export const ECONOMIC_SCHEMA = 'lotus.economic';
export const ECONOMIC_SCHEMA_VERSION = '1.0.0';
export const ECONOMIC_MODEL_STATUS = 'UNCONFIRMED_INTERNAL_MODEL';
export const RAW_SCHEMA = 'lotus.raw';
export const RAW_SCHEMA_VERSION = '1.0.0';
export const CORRECTION_SCHEMA = 'lotus.correction';
export const CORRECTION_SCHEMA_VERSION = '1.0.0';

/**
 * Tipos de fonte aceitos. Na Fase 3a apenas SYNTHETIC_DATA é usado; os demais existem para a 3b
 * e NÃO implicam que alguma fonte real tenha sido avaliada.
 */
export const SOURCE_TYPES = Object.freeze(['SYNTHETIC_DATA', 'MANUAL_ENTRY', 'EXTERNAL_UNVERIFIED']);

/** Modalidades suportadas — reutiliza src/lotteries/config.js (Fase 1) sem duplicar universos. */
export const LOTTERY_IDS = Object.freeze(Object.keys(LOTTERIES));

/**
 * Regras de RESULTADO derivadas da config da Fase 1: quantidade sorteada e intervalo.
 * @param {string} id
 * @returns {{id:string, name:string, draw:number, minNumber:number, maxNumber:number, prizeTiers:readonly number[]}}
 */
export function resultRules(id) {
  const r = getLottery(id);
  return { id: r.id, name: r.name, draw: r.draw, minNumber: r.minNumber, maxNumber: r.maxNumber, prizeTiers: r.prizeTiers };
}

export const RESULT_FIELDS = Object.freeze(['schema', 'schemaVersion', 'lottery', 'contest', 'drawDate', 'numbers', 'provenance']);
export const PROVENANCE_FIELDS = Object.freeze(['sourceType', 'sourceId', 'obtainedAt', 'note']);
export const ECONOMIC_FIELDS = Object.freeze(['schema', 'schemaVersion', 'modelStatus', 'lottery', 'contest', 'tiers', 'totalCollectedCents', 'provenance']);
export const TIER_FIELDS = Object.freeze(['hits', 'winners', 'prizePerWinnerCents']);
