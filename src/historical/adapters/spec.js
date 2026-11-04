/**
 * Construtor de especificação de adaptador XLSX (cada modalidade tem o SEU arquivo e versão).
 * Mapeamento por TEXTO EXATO do cabeçalho (linha 1). Cabeçalho diferente = coluna desconhecida
 * (preservada em extras + alerta SCHEMA_INESPERADO); obrigatório ausente = arquivo incompatível.
 * @module historical/adapters/spec
 */
export const FIELD_KINDS = Object.freeze(['contest', 'drawDate', 'ball', 'tierWinners', 'tierPrize', 'economic', 'text']);

/**
 * @param {{adapterId:string, version:string, lottery:string, sheetName:string, dateHeader:string,
 *  balls:number, tiers:{hits:number, description:string, winnersHeader:string, prizeHeader:string}[],
 *  locationsHeader:string, economic:{header:string, key:string, semantics:string}[], observationHeader:string,
 *  columnOrder:string[], notes:string[]}} p
 */
export function defineAdapter(p) {
  const columns = [
    { header: 'Concurso', kind: 'contest', type: 'n:int', required: true, semantics: 'Número do concurso.' },
    { header: p.dateHeader, kind: 'drawDate', type: 'str:dd/mm/aaaa', required: true, semantics: 'Data do sorteio (texto dd/mm/aaaa; interpretado sem locale).' },
    ...Array.from({ length: p.balls }, (_, i) => ({ header: `Bola${i + 1}`, kind: 'ball', index: i, type: 'n:int', required: true, semantics: `Dezena ${i + 1} conforme listada na planilha (as planilhas trazem ordem CRESCENTE; NÃO é ordem de extração).` })),
    ...p.tiers.flatMap((t, k) => [
      { header: t.winnersHeader, kind: 'tierWinners', tier: k + 1, hits: t.hits, type: 'n:int|"-"', required: true, semantics: `Quantidade de APOSTAS ganhadoras (não pessoas) na faixa "${t.description}". "-" = faixa inexistente no período (ausência, nunca zero).` },
      { header: t.prizeHeader, kind: 'tierPrize', tier: k + 1, hits: t.hits, type: 'str:R$|"-"', required: true, semantics: `Valor do prêmio por aposta ganhadora informado pela fonte na faixa "${t.description}" (natureza bruta/líquida NÃO verificada; nenhum ajuste tributário).` },
    ]),
    { header: p.locationsHeader, kind: 'text', key: 'winnerLocations', type: 'str|vazio', required: false, semantics: 'Texto livre "CIDADE/UF; …" da faixa principal (preservado sem interpretação).' },
    ...p.economic.map(e => ({ header: e.header, kind: 'economic', key: e.key, type: 'str:R$', required: true, semantics: e.semantics })),
    { header: p.observationHeader, kind: 'text', key: 'observation', type: 'str|vazio', required: false, semantics: 'Observação livre da fonte (preservada sem interpretação).' },
  ];
  const headers = new Set(columns.map(c => c.header));
  if (headers.size !== columns.length) throw new Error(`adaptador ${p.adapterId}: cabeçalho repetido na especificação`);
  for (const h of p.columnOrder) if (!headers.has(h)) throw new Error(`adaptador ${p.adapterId}: columnOrder cita coluna não mapeada: ${h}`);
  if (p.columnOrder.length !== columns.length) throw new Error(`adaptador ${p.adapterId}: columnOrder incompleto`);
  return Object.freeze({
    adapterId: p.adapterId, version: p.version, lottery: p.lottery, sheetName: p.sheetName, headerRow: 1,
    balls: p.balls, tiers: Object.freeze(p.tiers.map((t, k) => Object.freeze({ tier: k + 1, ...t }))),
    columns: Object.freeze(columns.map(c => Object.freeze(c))), columnOrder: Object.freeze([...p.columnOrder]),
    ignoredColumns: Object.freeze([]), // nenhuma coluna conhecida é ignorada; desconhecidas vão para extras
    orderAvailable: false, notes: Object.freeze([...(p.notes || [])]),
  });
}
