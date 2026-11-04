/**
 * Adaptador `caixa-xlsx-lotofacil` v1.0.0 — histórico XLSX oficial da Lotofácil.
 * Planilha "LOTOFÁCIL", 33 colunas. Faixas 15..11 acertos.
 * @module historical/adapters/lotofacil
 */
import { defineAdapter } from './spec.js';
export const LOTOFACIL_ADAPTER = defineAdapter({
  adapterId: 'caixa-xlsx-lotofacil', version: '1.0.0', lottery: 'lotofacil', sheetName: 'LOTOFÁCIL', dateHeader: 'Data Sorteio', balls: 15,
  tiers: [15, 14, 13, 12, 11].map(h => ({ hits: h, description: `${h} acertos`, winnersHeader: `Ganhadores ${h} acertos`, prizeHeader: `Rateio ${h} acertos` })),
  locationsHeader: 'Cidade / UF', observationHeader: 'Observação',
  economic: [
    { header: 'Acumulado 15 acertos', key: 'accumulatedTopTier', semantics: 'Valor acumulado da faixa principal (relação com campos JSON NÃO confirmada).' },
    { header: 'Arrecadacao Total', key: 'totalCollected', semantics: 'Arrecadação total informada (cabeçalho sem acento na fonte).' },
    { header: 'Estimativa Prêmio', key: 'nextPrizeEstimate', semantics: 'Estimativa de prêmio do próximo concurso.' },
    { header: 'Acumulado sorteio especial Lotofácil da Independência', key: 'specialAccumulated', semantics: 'Acumulado para o concurso especial (Lotofácil da Independência).' },
  ],
  columnOrder: ['Concurso', 'Data Sorteio', ...Array.from({ length: 15 }, (_, i) => `Bola${i + 1}`), 'Ganhadores 15 acertos', 'Cidade / UF', 'Rateio 15 acertos', 'Ganhadores 14 acertos', 'Rateio 14 acertos', 'Ganhadores 13 acertos', 'Rateio 13 acertos', 'Ganhadores 12 acertos', 'Rateio 12 acertos', 'Ganhadores 11 acertos', 'Rateio 11 acertos', 'Acumulado 15 acertos', 'Arrecadacao Total', 'Estimativa Prêmio', 'Acumulado sorteio especial Lotofácil da Independência', 'Observação'],
  notes: ['Prêmios fixos de 13/12/11 acertos mudaram ao longo do tempo (3b.1); valores são registrados como informados, sem regra de validação de valor.'],
});
