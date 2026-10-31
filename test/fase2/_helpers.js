// Utilitários de teste da Fase 2 (DADOS SINTÉTICOS).
// Tolerâncias: cotas EXATAS da Binomial (sem aproximação normal) + desigualdade de Boole (união).
// Se cada uma de m contagens satisfaz P(fora de [lo,hi]) ≤ δ/m, a chance de QUALQUER falha sob o
// modelo correto é ≤ δ. Usamos δ = 1e-6: um gerador correto falharia com probabilidade ≤ 1e-6 para
// uma semente arbitrária; com semente fixa o resultado é determinístico (sem testes instáveis).
import assert from 'node:assert/strict';
import { binomialBounds } from '../../src/lab.js';
export const DELTA = 1e-6;
export const LOTTERY_IDS = ['megasena', 'lotofacil', 'quina', 'lotomania'];
/** Verifica cada célula: contagem ~ Binomial(n, probs[i]) dentro das cotas exatas. Retorna cota da TVD. */
export function assertCells(counts, probs, n, delta = DELTA, label = '') {
  const m = probs.filter(p => p > 0).length; let tvBound = 0;
  probs.forEach((p, i) => {
    const c = counts[i] ?? 0;
    if (p === 0) { assert.equal(c, 0, `${label} célula ${i} fora do suporte`); return; }
    const { lo, hi } = binomialBounds(n, p, delta / m);
    assert.ok(c >= lo && c <= hi, `${label} célula ${i}: ${c} ∉ [${lo},${hi}] (n=${n}, p=${p})`);
    tvBound += Math.max(Math.abs(lo / n - p), Math.abs(hi / n - p));
  });
  return tvBound / 2;
}
