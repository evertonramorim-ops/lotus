/**
 * Adaptador `caixa-xlsx-quina` v1.0.0 — histórico XLSX oficial da Quina.
 * Planilha "QUINA", 21 colunas. Faixas 5..2 acertos (faixa 2 sem pagamento em concursos antigos — 3b.1).
 * Concurso 380: data fora da sequência (3b.1) — preservada e enviada à quarentena pelo validador de cronologia.
 * Concursos de 1994 antes do Plano Real: unidade monetária NÃO verificada (não convertida).
 * @module historical/adapters/quina
 */
import { defineAdapter } from './spec.js';
export const QUINA_ADAPTER = defineAdapter({
  adapterId: 'caixa-xlsx-quina', version: '1.0.0', lottery: 'quina', sheetName: 'QUINA', dateHeader: 'Data Sorteio', balls: 5,
  tiers: [5, 4, 3, 2].map(h => ({ hits: h, description: `${h} acertos`, winnersHeader: `Ganhadores ${h} acertos`, prizeHeader: `Rateio ${h} acertos` })),
  locationsHeader: 'Cidade / UF', observationHeader: 'observação',
  economic: [
    { header: 'Acumulado 5 acertos', key: 'accumulatedTopTier', semantics: 'Valor acumulado da faixa principal (relação com campos JSON NÃO confirmada).' },
    { header: 'Arrecadacao Total', key: 'totalCollected', semantics: 'Arrecadação total informada.' },
    { header: 'Estimativa Premio', key: 'nextPrizeEstimate', semantics: 'Estimativa de prêmio do próximo concurso.' },
    { header: 'Acumulado Sorteio Especial Quina de São João', key: 'specialAccumulated', semantics: 'Acumulado para o concurso especial (Quina de São João).' },
  ],
  columnOrder: ['Concurso', 'Data Sorteio', 'Bola1', 'Bola2', 'Bola3', 'Bola4', 'Bola5', 'Ganhadores 5 acertos', 'Cidade / UF', 'Rateio 5 acertos', 'Ganhadores 4 acertos', 'Rateio 4 acertos', 'Ganhadores 3 acertos', 'Rateio 3 acertos', 'Ganhadores 2 acertos', 'Rateio 2 acertos', 'Acumulado 5 acertos', 'Arrecadacao Total', 'Estimativa Premio', 'Acumulado Sorteio Especial Quina de São João', 'observação'],
  notes: ['Cabeçalho "observação" em minúsculas na fonte.'],
});
