/**
 * Probabilidades de apostas simples e múltiplas (somente matemática exata; sem previsão).
 * Aposta com K números num universo N com n sorteados: X ~ Hipergeométrica(N, K, n).
 * @module math/bets
 */
import { binomial, Fraction } from './bigint.js';
import { hypergeometricDistribution, hypergeometricPmf } from './hypergeometric.js';
import { assertBetSize, getLottery } from '../lotteries/config.js';

/**
 * Quantidade de apostas simples contidas numa aposta múltipla: C(K, n).
 * @param {string} lotteryId @param {number} betSize
 * @returns {bigint}
 */
export function simpleBetsInMultiple(lotteryId, betSize) { const r = assertBetSize(lotteryId, betSize); return binomial(betSize, r.draw); }

/**
 * Distribuição de acertos de uma aposta (simples ou múltipla).
 * @param {string} lotteryId @param {number} [betSize] padrão = aposta mínima
 * @returns {{k:number,count:bigint,total:bigint,p:Fraction,prizeTier:boolean}[]}
 */
export function hitDistribution(lotteryId, betSize) {
  const K = betSize ?? getLottery(lotteryId).minBet;
  const r = assertBetSize(lotteryId, K);
  return hypergeometricDistribution(r.universe, K, r.draw).map(x => ({ ...x, prizeTier: r.prizeTiers.includes(x.k) }));
}

/**
 * P(exatamente k acertos) para a aposta.
 * @param {string} lotteryId @param {number} betSize @param {number} k
 * @returns {Fraction}
 */
export function hitProbability(lotteryId, betSize, k) { const r = assertBetSize(lotteryId, betSize); return hypergeometricPmf(r.universe, betSize, r.draw, k); }

/**
 * Probabilidade por faixa de premiação (regra), como Fraction exata.
 * @param {string} lotteryId @param {number} betSize
 * @returns {{tier:number,p:Fraction}[]}
 */
export function tierProbabilities(lotteryId, betSize) {
  const r = assertBetSize(lotteryId, betSize);
  return r.prizeTiers.map(t => ({ tier: t, p: hypergeometricPmf(r.universe, betSize, r.draw, t) }));
}

/**
 * Probabilidade do prêmio máximo (acertar os n sorteados): C(K,n)/C(N,n).
 * Não se aplica à "faixa 0" da Lotomania (use hitProbability(...,0)).
 * @param {string} lotteryId @param {number} betSize
 * @returns {Fraction}
 */
export function topPrizeProbability(lotteryId, betSize) {
  const r = assertBetSize(lotteryId, betSize);
  return new Fraction(binomial(betSize, r.draw), binomial(r.universe, r.draw));
}

/**
 * Quantas apostas simples internas de uma múltipla acertam exatamente j, dado que a
 * múltipla (K números) acertou h dos n sorteados: C(h,j)·C(K−h, n−j).
 * @param {string} lotteryId @param {number} betSize K @param {number} h acertos da múltipla @param {number} j
 * @returns {bigint}
 */
export function internalSimpleBetsWithHits(lotteryId, betSize, h, j) {
  const r = assertBetSize(lotteryId, betSize);
  if (!Number.isInteger(h) || !Number.isInteger(j) || h < 0 || j < 0 || h > Math.min(betSize, r.draw)) throw new RangeError('h/j inválidos');
  if (j > r.draw) return 0n;
  return binomial(h, j) * binomial(betSize - h, r.draw - j);
}
