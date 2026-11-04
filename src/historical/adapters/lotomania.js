/**
 * Adaptador `caixa-xlsx-lotomania` v1.0.0 — histórico XLSX oficial da Lotomania.
 * Planilha "LOTOMANIA", 41 colunas. Faixas 20,19,18,17,16,15 e "Nenhum Número" (0 acertos).
 * Células "-" (tipadas como número na fonte) na faixa 15 = faixa inexistente no período (3b.1: concursos 1–1652).
 * Dezenas 00–99 (texto "00" preservado no bruto).
 * @module historical/adapters/lotomania
 */
import { defineAdapter } from './spec.js';
export const LOTOMANIA_ADAPTER = defineAdapter({
  adapterId: 'caixa-xlsx-lotomania', version: '1.0.0', lottery: 'lotomania', sheetName: 'LOTOMANIA', dateHeader: 'Data Sorteio', balls: 20,
  tiers: [...[20, 19, 18, 17, 16, 15].map(h => ({ hits: h, description: `${h} acertos`, winnersHeader: `Ganhadores ${h} acertos`, prizeHeader: `Rateio ${h} acertos` })),
    { hits: 0, description: '0 acertos', winnersHeader: 'Ganhadores Nenhum Número', prizeHeader: 'Rateio Nenhum Número' }],
  locationsHeader: 'Cidade / UF', observationHeader: 'Observação',
  economic: [
    { header: 'Acumulado 20 acertos', key: 'accumulatedTopTier', semantics: 'Valor acumulado da faixa principal (relação com campos JSON NÃO confirmada).' },
    { header: 'Arrecadação Total', key: 'totalCollected', semantics: 'Arrecadação total informada.' },
    { header: 'Estimativa Prêmio', key: 'nextPrizeEstimate', semantics: 'Estimativa de prêmio do próximo concurso.' },
  ],
  columnOrder: ['Concurso', 'Data Sorteio', ...Array.from({ length: 20 }, (_, i) => `Bola${i + 1}`), 'Ganhadores 20 acertos', 'Cidade / UF', 'Rateio 20 acertos', 'Ganhadores 19 acertos', 'Rateio 19 acertos', 'Ganhadores 18 acertos', 'Rateio 18 acertos', 'Ganhadores 17 acertos', 'Rateio 17 acertos', 'Ganhadores 16 acertos', 'Rateio 16 acertos', 'Ganhadores 15 acertos', 'Rateio 15 acertos', 'Ganhadores Nenhum Número', 'Rateio Nenhum Número', 'Acumulado 20 acertos', 'Arrecadação Total', 'Estimativa Prêmio', 'Observação'],
  notes: ['Sem coluna de acumulado especial.'],
});
