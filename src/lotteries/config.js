/**
 * Regras estruturais das modalidades (somente regras de jogo).
 * NÃO contém preços nem valores de prêmio: esses dados serão incluídos em fase
 * posterior a partir de fonte oficial da CAIXA, versionados (ver {@link PricingSource}).
 * @module lotteries/config
 */

/**
 * @typedef {Object} LotteryRules
 * @property {string} id
 * @property {string} name
 * @property {number} minNumber menor número do volante
 * @property {number} maxNumber maior número do volante
 * @property {number} universe N (quantidade de números)
 * @property {number} draw n (números sorteados)
 * @property {number} minBet menor quantidade de números apostáveis
 * @property {number} maxBet maior quantidade de números apostáveis
 * @property {number[]} prizeTiers faixas (nº de acertos) que premiam — regra, sem valores
 */

/**
 * Interface (placeholder) para preços/prêmios versionados — SEM valores nesta fase.
 * @typedef {Object} PricingSource
 * @property {string} lotteryId
 * @property {string} sourceUrl URL oficial CAIXA
 * @property {string} collectedAtUtc
 * @property {string} version
 * @property {Record<number,string>} betPriceBRL preço por quantidade de números (string decimal)
 */

/** @type {Readonly<Record<string, Readonly<LotteryRules>>>} */
export const LOTTERIES = Object.freeze({
  megasena: Object.freeze({ id: 'megasena', name: 'Mega-Sena', minNumber: 1, maxNumber: 60, universe: 60, draw: 6, minBet: 6, maxBet: 20, prizeTiers: Object.freeze([4, 5, 6]) }),
  lotofacil: Object.freeze({ id: 'lotofacil', name: 'Lotofácil', minNumber: 1, maxNumber: 25, universe: 25, draw: 15, minBet: 15, maxBet: 20, prizeTiers: Object.freeze([11, 12, 13, 14, 15]) }),
  quina: Object.freeze({ id: 'quina', name: 'Quina', minNumber: 1, maxNumber: 80, universe: 80, draw: 5, minBet: 5, maxBet: 15, prizeTiers: Object.freeze([2, 3, 4, 5]) }),
  lotomania: Object.freeze({ id: 'lotomania', name: 'Lotomania', minNumber: 0, maxNumber: 99, universe: 100, draw: 20, minBet: 50, maxBet: 50, prizeTiers: Object.freeze([0, 15, 16, 17, 18, 19, 20]) }),
});

/** Placeholder: preços/prêmios ainda não carregados (fonte oficial pendente). @type {null} */
export const PRICING = null;

/**
 * Obtém regras, lançando erro para modalidade desconhecida.
 * @param {string} id
 * @returns {Readonly<LotteryRules>}
 */
export function getLottery(id) {
  const r = Object.prototype.hasOwnProperty.call(LOTTERIES, id) ? LOTTERIES[id] : undefined;
  if (!r) throw new RangeError(`modalidade desconhecida: ${id}`);
  return r;
}

/**
 * Lista de tamanhos de aposta permitidos.
 * @param {string} id
 * @returns {number[]}
 */
export function allowedBetSizes(id) { const r = getLottery(id); const a = []; for (let i = r.minBet; i <= r.maxBet; i++) a.push(i); return a; }

/**
 * Valida tamanho de aposta; lança RangeError se inválido.
 * @param {string} id @param {number} size
 * @returns {Readonly<LotteryRules>}
 */
export function assertBetSize(id, size) {
  const r = getLottery(id);
  if (!Number.isInteger(size) || size < r.minBet || size > r.maxBet) throw new RangeError(`${r.name}: aposta de ${size} números inválida (permitido ${r.minBet}..${r.maxBet})`);
  return r;
}
