/**
 * Adaptador `caixa-xlsx-megasena` v1.0.0 — histórico XLSX oficial da Mega-Sena.
 * Fonte documentada: relatório 3b.1 (GET servicebus3…/api/resultados/download?modalidade=Mega-Sena).
 * Planilha "MEGA SENA", 20 colunas, linha 1 = cabeçalho, 1 linha por concurso.
 * @module historical/adapters/megasena
 */
import { defineAdapter } from './spec.js';
export const MEGASENA_ADAPTER = defineAdapter({
  adapterId: 'caixa-xlsx-megasena', version: '1.0.0', lottery: 'megasena', sheetName: 'MEGA SENA', dateHeader: 'Data do Sorteio', balls: 6,
  tiers: [6, 5, 4].map(h => ({ hits: h, description: `${h} acertos`, winnersHeader: `Ganhadores ${h} acertos`, prizeHeader: `Rateio ${h} acertos` })),
  locationsHeader: 'Cidade / UF', observationHeader: 'Observação',
  economic: [
    { header: 'Acumulado 6 acertos', key: 'accumulatedTopTier', semantics: 'Valor acumulado da faixa principal informado na linha (relação exata com campos JSON valorAcumuladoProximoConcurso/valorAcumuladoConcurso_0_5 NÃO confirmada).' },
    { header: 'Arrecadação Total', key: 'totalCollected', semantics: 'Arrecadação total informada (R$0,00 em concursos antigos: zero literal da fonte, semântica de "não informado" NÃO confirmada).' },
    { header: 'Estimativa prêmio', key: 'nextPrizeEstimate', semantics: 'Estimativa de prêmio do próximo concurso informada.' },
    { header: 'Acumulado Sorteio Especial Mega da Virada', key: 'specialAccumulated', semantics: 'Acumulado para o concurso especial (Mega da Virada).' },
  ],
  columnOrder: ['Concurso', 'Data do Sorteio', 'Bola1', 'Bola2', 'Bola3', 'Bola4', 'Bola5', 'Bola6', 'Ganhadores 6 acertos', 'Cidade / UF', 'Rateio 6 acertos', 'Ganhadores 5 acertos', 'Rateio 5 acertos', 'Ganhadores 4 acertos', 'Rateio 4 acertos', 'Acumulado 6 acertos', 'Arrecadação Total', 'Estimativa prêmio', 'Acumulado Sorteio Especial Mega da Virada', 'Observação'],
  notes: ['Dezenas em ordem crescente: ordem de extração indisponível no XLSX (orderAvailable=false).'],
});
