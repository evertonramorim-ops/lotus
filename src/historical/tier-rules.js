/**
 * Estruturas de faixas por PERÍODO (versão `lotus.tier-periods` 1.0.0).
 * IMPORTANTE (classe C/B): estes períodos foram OBSERVADOS nos próprios dados (relatório 3b.1),
 * não em atos normativos históricos. Por isso TODO período tem status RULE_NOT_VERIFIED.
 * Uso: um registro cuja estrutura de faixas (faixas presentes = não marcadas com "-") coincide com a
 * estrutura do período é aceito com anotação RULE_NOT_VERIFIED; estrutura não prevista para o
 * período → quarentena REGRA_HISTORICA_NAO_VERIFICADA. Nada é inferido retroativamente.
 * @module historical/tier-rules
 */
export const TIER_RULES_ID = 'lotus.tier-periods';
export const TIER_RULES_VERSION = '1.0.0';
const NV = 'RULE_NOT_VERIFIED';
export const TIER_PERIODS = Object.freeze({
  megasena: [{ from: 1, to: null, presentTiers: [6, 5, 4], status: NV, evidence: '3b.1: XLSX e JSON com 3 faixas nas amostras; ato normativo histórico não obtido.' }],
  lotofacil: [{ from: 1, to: null, presentTiers: [15, 14, 13, 12, 11], status: NV, evidence: '3b.1: 5 faixas nas amostras.' }],
  quina: [{ from: 1, to: null, presentTiers: [5, 4, 3, 2], status: NV, evidence: '3b.1: XLSX traz 4 colunas de faixa em todo o histórico; JSON do concurso 1 lista 3 faixas e a faixa 2 só passa a pagar no c.4085 (observado). Diferença XLSX×JSON tratada na reconciliação.' }],
  lotomania: [
    { from: 1, to: 1652, presentTiers: [20, 19, 18, 17, 16, 0], status: NV, evidence: '3b.1: faixa 15 com "-" nos concursos 1–1652 (XLSX) e ausente no JSON.' },
    { from: 1653, to: null, presentTiers: [20, 19, 18, 17, 16, 15, 0], status: NV, evidence: '3b.1: faixa 15 presente a partir do 1653 (observado; ato normativo não obtido).' },
  ],
});
export function periodFor(lottery, contest) {
  const list = TIER_PERIODS[lottery] || [];
  return list.find(p => contest >= p.from && (p.to === null || contest <= p.to)) ?? null;
}
