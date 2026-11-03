# LOTUS

Aplicativo (pt-BR) de **análise matemática** das loterias da CAIXA. **Não é ferramenta de previsão**: não prevê resultados nem atribui "chances" especiais a números — sob o modelo, toda combinação é equiprovável.

## Estado
- **Fase 1 — base matemática: concluída.** BigInt exato, hipergeométrica, apostas simples/múltiplas, regras das 4 modalidades (sem preços: `PRICING = null`). Ver `docs/FASE1.md`.
- **Fase 2 — laboratório estatístico com dados SINTÉTICOS: concluída** (PR #1). Gerador reproduzível, frequências, acertos, estruturas, testes de uniformidade Monte Carlo, Holm/BH, falsos positivos e poder (`nullMode` shared e per_rep). Todos os dados são artificiais (`SYNTHETIC_DATA`). Ver `docs/FASE2.md`.
- **Fase 3 — infraestrutura e dados reais: não iniciada.** Nenhum dado real da Caixa, GitHub Actions, assinatura, interface ou integração com Blogger existe ainda.

## Uso
```js
import { topPrizeProbability, hitDistribution } from './index.js';
topPrizeProbability('megasena', 7).toString(); // "1/7151980"
import { runExperiment } from './src/lab.js'; // laboratório sintético (Fase 2)
```

## Testes
`npm test` (Node ≥ 20, sem dependências): **168 testes** — 88 da Fase 1 (`npm run test:fase1`) + 80 da Fase 2 (`npm run test:fase2`).

## Segurança
Nenhum segredo/chave privada deve ser versionado (ver `.gitignore`).
