# LOTUS

Aplicativo (pt-BR) de **análise matemática** das loterias da CAIXA. **Não faz previsões** nem atribui "chances" a números.

## Estado
Fase 1 — base matemática (BigInt exato, hipergeométrica, apostas simples/múltiplas). Ver `docs/FASE1.md`.

## Uso
```js
import { topPrizeProbability, hitDistribution } from './index.js';
topPrizeProbability('megasena', 7).toString(); // "1/7151980"
```
## Testes
`npm test` (Node ≥ 20, sem dependências).

## Segurança
Nenhum segredo/chave privada deve ser versionado (ver `.gitignore`).
