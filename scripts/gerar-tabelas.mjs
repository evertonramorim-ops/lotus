// Gera tabelas Markdown das distribuições exatas (aposta simples de cada modalidade).
import { LOTTERIES, hitDistribution, Fraction } from '../index.js';
const fmt = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
for (const r of Object.values(LOTTERIES)) {
  const K = r.minBet; console.log(`\n### ${r.name} — aposta de ${K} números (N=${r.universe}, n=${r.draw})\n`);
  console.log('| Acertos | Combinações favoráveis | P exata (reduzida) | Decimal (25 casas, truncado) | 1 em X (X=1/P, 2 casas, truncado) | Faixa premiada (regra) |\n|---:|---:|---|---|---:|:---:|');
  for (const x of hitDistribution(r.id, K)) console.log(`| ${x.k} | ${fmt(x.count.toString())} | ${x.p} | ${x.p.toDecimalString(25)} | ${x.p.isZero() ? '—' : x.p.inverse().toDecimalString(2)} | ${x.prizeTier ? 'sim' : ''} |`);
}
