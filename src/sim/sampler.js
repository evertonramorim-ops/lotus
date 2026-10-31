/**
 * Amostragem de sorteios SINTÉTICOS (SYNTHETIC_DATA).
 * - Uniforme: Fisher-Yates parcial (Durstenfeld/Knuth, Algoritmo P), sem reposição.
 * - Enviesado (apenas experimental): amostragem sequencial ponderada sem reposição.
 * Processamento em fluxo via geradores (não armazena todos os concursos).
 * @module sim/sampler
 */
import { getLottery } from '../lotteries/config.js';
import { createRng, deriveSeed, normalizeSeed, GENERATOR_ID, GENERATOR_VERSION } from './prng.js';

export const DATA_KIND = 'SYNTHETIC_DATA';
export const MAX_DRAWS = 10_000_000;

/**
 * Núcleo do Fisher-Yates parcial com fonte de índices injetável (permite prova exaustiva).
 * Para i=0..k-1: j = i + U[0, N−i); troca pool[i]↔pool[j]. Retorna pool[0..k).
 * Para QUALQUER arranjo inicial de pool, cada k-subconjunto sai com probabilidade 1/C(N,k).
 * @param {Int32Array|number[]} pool permutação de 0..N-1 (modificada in-place)
 * @param {number} k @param {(m:number)=>number} randIndex inteiro uniforme em [0,m)
 * @returns {number[]} índices sorteados (ordem de sorteio)
 */
export function partialFisherYates(pool, k, randIndex) {
  const N = pool.length; const out = new Array(k);
  for (let i = 0; i < k; i++) { const j = i + randIndex(N - i); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; out[i] = pool[i]; }
  return out;
}

/** @param {number} N @param {number} k */
function checkNk(N, k) {
  if (!Number.isInteger(N) || N < 1 || N > 1_000_000) throw new RangeError('N inválido');
  if (!Number.isInteger(k) || k < 0 || k > N) throw new RangeError('k deve ser inteiro em [0,N]');
}

/**
 * Amostrador uniforme reutilizável sobre universo genérico {offset..offset+N-1}.
 * @param {import('./prng.js').Xoshiro128ss} rng @param {number} N @param {number} k @param {number} [offset=0]
 * @returns {() => number[]} função que devolve um sorteio ORDENADO crescente
 */
export function uniformSampler(rng, N, k, offset = 0) {
  checkNk(N, k);
  const pool = new Int32Array(N); for (let i = 0; i < N; i++) pool[i] = i;
  const ri = m => rng.uniformInt(m);
  return () => partialFisherYates(pool, k, ri).map(x => x + offset).sort((a, b) => a - b);
}

/**
 * Amostrador ENVIESADO artificial (cenário experimental, não hipótese sobre sorteios reais).
 * Amostragem sequencial ponderada sem reposição: a cada passo escolhe um índice restante com
 * probabilidade w_i / Σ_{restantes} w (algoritmo de "successive sampling"). Pesos iguais ⇒ uniforme.
 * @param {import('./prng.js').Xoshiro128ss} rng @param {number[]} weights pesos > 0, comprimento N
 * @param {number} k @param {number} [offset=0]
 */
export function weightedSampler(rng, weights, k, offset = 0) {
  const N = weights.length; checkNk(N, k);
  for (const w of weights) if (!(Number.isFinite(w) && w > 0)) throw new RangeError('pesos devem ser finitos e > 0');
  const w0 = Float64Array.from(weights);
  return () => {
    const w = w0.slice(); let total = 0; for (let i = 0; i < N; i++) total += w[i];
    const out = [];
    for (let s = 0; s < k; s++) {
      let u = rng.nextFloat() * total, idx = -1;
      for (let i = 0; i < N; i++) { if (w[i] === 0) continue; idx = i; u -= w[i]; if (u < 0) break; }
      out.push(idx + offset); total -= w[idx]; w[idx] = 0;
      if (s % 8 === 7) { total = 0; for (let i = 0; i < N; i++) total += w[i]; } // recompensação de erro de arredondamento
    }
    return out.sort((a, b) => a - b);
  };
}

/**
 * Pesos para viés artificial.
 * @param {string} lotteryId
 * @param {{type:'none'}|{type:'single',number:number,boost:number}|{type:'group',numbers:number[],factor:number}} bias
 *   single: peso da dezena = 1+boost; group: peso das dezenas do grupo = factor.
 */
export function biasWeights(lotteryId, bias) {
  const r = getLottery(lotteryId); const w = new Array(r.universe).fill(1);
  if (!bias || bias.type === 'none') return w;
  const idx = n => { if (!Number.isInteger(n) || n < r.minNumber || n > r.maxNumber) throw new RangeError(`dezena fora do universo: ${n}`); return n - r.minNumber; };
  if (bias.type === 'single') { if (!(bias.boost > -1)) throw new RangeError('boost deve ser > -1'); w[idx(bias.number)] = 1 + bias.boost; }
  else if (bias.type === 'group') { if (!(bias.factor > 0)) throw new RangeError('factor deve ser > 0'); for (const n of bias.numbers) w[idx(n)] = bias.factor; }
  else throw new RangeError('tipo de viés desconhecido');
  return w;
}

/** @param {number} draws */
export function checkDraws(draws) { if (!Number.isInteger(draws) || draws < 1 || draws > MAX_DRAWS) throw new RangeError(`quantidade de concursos deve ser inteiro em [1, ${MAX_DRAWS}]`); }

/**
 * Fluxo de concursos sintéticos de uma modalidade.
 * @param {{lottery:string, seed:number|bigint, draws:number, bias?:object}} opts
 * @returns {Generator<number[]>} cada item: dezenas ordenadas (numeração oficial da modalidade)
 */
export function* drawStream({ lottery, seed, draws, bias }) {
  const r = getLottery(lottery); checkDraws(draws);
  const rng = createRng(seed);
  const next = bias && bias.type !== 'none' ? weightedSampler(rng, biasWeights(lottery, bias), r.draw, r.minNumber) : uniformSampler(rng, r.universe, r.draw, r.minNumber);
  for (let i = 0; i < draws; i++) yield next();
}

/** Metadados de uma simulação. */
export function simulationMetadata({ lottery, seed, draws, bias }) {
  const r = getLottery(lottery);
  return { data_kind: DATA_KIND, lottery: r.id, universe: r.universe, numbers_per_draw: r.draw, draws, seed: normalizeSeed(seed).toString(), generator: GENERATOR_ID, generator_version: GENERATOR_VERSION, bias: bias ?? { type: 'none' } };
}

export { deriveSeed };
