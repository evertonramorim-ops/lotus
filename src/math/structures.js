/**
 * Contagem de estruturas combinatórias do volante.
 * @module math/structures
 */
import { binomial } from './bigint.js';
import { getLottery } from '../lotteries/config.js';

/** Total de pares possíveis C(N,2). @param {string} id @returns {bigint} */
export function pairCount(id) { return binomial(getLottery(id).universe, 2); }
/** Total de trincas possíveis C(N,3). @param {string} id @returns {bigint} */
export function tripleCount(id) { return binomial(getLottery(id).universe, 3); }
/** Total de jogos simples possíveis C(N,n). @param {string} id @returns {bigint} */
export function totalCombinations(id) { const r = getLottery(id); return binomial(r.universe, r.draw); }
/** Pares contidos em um único sorteio C(n,2). @param {string} id @returns {bigint} */
export function pairsPerDraw(id) { return binomial(getLottery(id).draw, 2); }
/** Trincas contidas em um único sorteio C(n,3). @param {string} id @returns {bigint} */
export function triplesPerDraw(id) { return binomial(getLottery(id).draw, 3); }
