# LOTUS — Fase 1: Base Matemática

> Análise matemática exata. **Não há previsão, pontuação de chance nem promessa de vantagem.** Todo sorteio é equiprovável.

Gerado em 2026-10-31 18:59 -03 (UTC-03:00) · Node v24.22.1 · zero dependências de runtime · testes com `node:test`.

## 1. O que foi implementado
- **Motor combinatório BigInt** (`src/math/bigint.js`): `factorial`, `binomial` (C(n,k) exato, valida entradas; k>n → 0), `permutations`, `gcd`, classe `Fraction` (sempre reduzida, imutável; `add/sub/mul/div/compare/equals/inverse`, `toDecimalString(digits)` truncado exato, `toNumber()` com erro relativo ≲ 1e-16).
- **Hipergeométrica exata** (`src/math/hypergeometric.js`): `hypergeometricCount`, `hypergeometricPmf`, `hypergeometricDistribution`, `support`, `expectation` (calculada pela soma), `variance` (E[X²]−E[X]², verificada contra a fórmula fechada).
- **Regras das modalidades** (`src/lotteries/config.js`): Mega-Sena (1–60, sorteia 6, aposta 6–20), Lotofácil (1–25, 15, 15–20), Quina (1–80, 5, 5–15), Lotomania (00–99, 20, 50 fixo); faixas premiadas como *regra* (sem valores). `PRICING = null` + typedef `PricingSource` (placeholder documentado).
- **Apostas** (`src/math/bets.js`): `simpleBetsInMultiple` (C(K,n)), `hitDistribution`, `hitProbability`, `tierProbabilities`, `topPrizeProbability` (C(K,n)/C(N,n)), `internalSimpleBetsWithHits` (C(h,j)·C(K−h,n−j)).
- **Estruturas** (`src/math/structures.js`): `pairCount`, `tripleCount`, `totalCombinations`, `pairsPerDraw`, `triplesPerDraw`.
- `index.js` reexporta tudo. JSDoc em todas as funções.

## 2. Estrutura de arquivos
```
  .gitignore
  docs/fase1-evidencias/tabelas.md
  docs/fase1-evidencias/test-output.txt
  index.js
  package.json
  scripts/gerar-tabelas.mjs
  src/lotteries/config.js
  src/math/bets.js
  src/math/bigint.js
  src/math/hypergeometric.js
  src/math/structures.js
  test/bigint.test.js
  test/hypergeometric.test.js
  test/lotteries.test.js
  test/reference.test.js
```

## 3. Testes executados
Comando: `npm test` (= `node --test test/*.test.js`). Saída bruta: `docs/fase1-evidencias/test-output.txt`.

**Resultado: 88 testes, 88 aprovados, 0 falhas.** Os testes REF06–REF14 reexecutam os 9 testes matemáticos de referência contra a nova implementação (comparando com a função de referência independente). O script original de 14 testes (5 cripto + 9 matemáticos) também foi reexecutado: TODOS OS TESTES PASSARAM.

| # | Teste | Resultado |
|---:|---|---|
| 1 | C(60,6)=50063860 | ✅ PASS |
| 2 | C(25,15)=3268760 | ✅ PASS |
| 3 | C(80,5)=24040016 | ✅ PASS |
| 4 | C(100,20)=535983370403809682970 | ✅ PASS |
| 5 | C(100,50) = n!/(k!(n-k)!) independente | ✅ PASS |
| 6 | C(n,0)=C(n,n)=1 para n=0..100 | ✅ PASS |
| 7 | C(n,k)=0 quando k>n | ✅ PASS |
| 8 | simetria C(n,k)=C(n,n-k) e Pascal, n<=80 | ✅ PASS |
| 9 | binomial vs fórmula fatorial para n<=60 todos k | ✅ PASS |
| 10 | binomial aceita bigint | ✅ PASS |
| 11 | entradas inválidas lançam erro | ✅ PASS |
| 12 | factorial(0)=factorial(1)=1 | ✅ PASS |
| 13 | 25! = 15511210043330985984000000 | ✅ PASS |
| 14 | 20! = 2432902008176640000 | ✅ PASS |
| 15 | permutations P(10,3)=720, P(n,n)=n!, k>n=0 | ✅ PASS |
| 16 | gcd | ✅ PASS |
| 17 | Fraction reduz e normaliza sinal | ✅ PASS |
| 18 | Fraction add/sub/mul/div/compare/equals | ✅ PASS |
| 19 | toDecimalString truncado e controlado | ✅ PASS |
| 20 | toNumber precisão relativa < 1e-15 | ✅ PASS |
| 21 | força bruta N=10,K=3,n=3: contagens = enumeração | ✅ PASS |
| 22 | força bruta N=10,K=4,n=3: contagens = enumeração | ✅ PASS |
| 23 | força bruta N=10,K=7,n=3: contagens = enumeração | ✅ PASS |
| 24 | força bruta N=12,K=5,n=4: contagens = enumeração | ✅ PASS |
| 25 | força bruta N=9,K=9,n=4: contagens = enumeração | ✅ PASS |
| 26 | força bruta N=8,K=0,n=3: contagens = enumeração | ✅ PASS |
| 27 | força bruta N=11,K=6,n=6: contagens = enumeração | ✅ PASS |
| 28 | suporte e P=0 fora do suporte | ✅ PASS |
| 29 | variância = fórmula fechada (vários casos) | ✅ PASS |
| 30 | parâmetros inválidos lançam | ✅ PASS |
| 31 | soma da distribuição=1 para todo K,n com N=20 | ✅ PASS |
| 32 | megasena aposta 6: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 33 | megasena aposta 7: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 34 | megasena aposta 8: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 35 | megasena aposta 9: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 36 | megasena aposta 10: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 37 | megasena aposta 11: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 38 | megasena aposta 12: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 39 | megasena aposta 13: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 40 | megasena aposta 14: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 41 | megasena aposta 15: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 42 | megasena aposta 16: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 43 | megasena aposta 17: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 44 | megasena aposta 18: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 45 | megasena aposta 19: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 46 | megasena aposta 20: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 47 | megasena: rejeita tamanhos inválidos | ✅ PASS |
| 48 | lotofacil aposta 15: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 49 | lotofacil aposta 16: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 50 | lotofacil aposta 17: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 51 | lotofacil aposta 18: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 52 | lotofacil aposta 19: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 53 | lotofacil aposta 20: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 54 | lotofacil: rejeita tamanhos inválidos | ✅ PASS |
| 55 | quina aposta 5: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 56 | quina aposta 6: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 57 | quina aposta 7: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 58 | quina aposta 8: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 59 | quina aposta 9: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 60 | quina aposta 10: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 61 | quina aposta 11: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 62 | quina aposta 12: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 63 | quina aposta 13: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 64 | quina aposta 14: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 65 | quina aposta 15: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 66 | quina: rejeita tamanhos inválidos | ✅ PASS |
| 67 | lotomania aposta 50: soma=1, E=Kn/N, suporte, fora=0 | ✅ PASS |
| 68 | lotomania: rejeita tamanhos inválidos | ✅ PASS |
| 69 | modalidade desconhecida e protótipo | ✅ PASS |
| 70 | regras: sem preços (placeholder null) e objetos congelados | ✅ PASS |
| 71 | Mega simples: 1 em 50063860 | ✅ PASS |
| 72 | Mega 7 números: 7 jogos, 1 em 7151980 | ✅ PASS |
| 73 | Mega 15 números: C(15,6)=5005 jogos, prob=5005/50063860 | ✅ PASS |
| 74 | Mega 20: C(20,6)=38760 | ✅ PASS |
| 75 | Lotofácil simples 1/3268760; 16 números 16 jogos → 2/408595 | ✅ PASS |
| 76 | Quina simples 1/24040016 | ✅ PASS |
| 77 | Lotomania P(20)=P(0)=148/1683150111 | ✅ PASS |
| 78 | Lotomania simetria P(k)=P(20-k), soma=1, E=10 | ✅ PASS |
| 79 | pares/trincas vs fórmula independente N(N-1)/2, N(N-1)(N-2)/6 | ✅ PASS |
| 80 | REF06 C(60,6) | ✅ PASS |
| 81 | REF07 C(25,15) | ✅ PASS |
| 82 | REF08 C(80,5) | ✅ PASS |
| 83 | REF09 pares/trincas Mega | ✅ PASS |
| 84 | REF10 P(X=0)=P(X=20) | ✅ PASS |
| 85 | REF11 simetria k=0..20 | ✅ PASS |
| 86 | REF12 soma = 1 (Vandermonde) | ✅ PASS |
| 87 | REF13 E(X)=10 | ✅ PASS |
| 88 | REF14 decimal 30 casas de P(20) | ✅ PASS |

Os testes de força bruta enumeram todas as combinações de universos pequenos (ex.: N=10, n=3) e confirmam contagem a contagem a fórmula hipergeométrica.

## 4. Resultados-chave
| Item | Valor exato |
|---|---|
| Mega-Sena C(60,6) | 50.063.860 |
| Lotofácil C(25,15) | 3.268.760 |
| Quina C(80,5) | 24.040.016 |
| Lotomania C(100,20) | 535.983.370.403.809.682.970 |
| Mega pares / trincas | 1.770 / 34.220 |
| Mega 7 números | 7 jogos; 1 em 7.151.980 |
| Mega 15 números | 5.005 jogos; 5005/50063860 = 1/10002.77… |
| Lotofácil 16 números | 16 jogos; 2/408595 (1 em 204.297,5) |
| Lotomania P(20)=P(0) | 148/1683150111 (1 em ≈ 11.372.635,9) |
| Lotomania E(X) | 10 (exato) |

## 5. Distribuições exatas — aposta simples

### Mega-Sena — aposta de 6 números (N=60, n=6)

| Acertos | Combinações favoráveis | P exata (reduzida) | Decimal (25 casas, truncado) | 1 em X (X=1/P, 2 casas, truncado) | Faixa premiada (regra) |
|---:|---:|---|---|---:|:---:|
| 0 | 25.827.165 | 737919/1430396 | 0.5158844124284463882728978 | 1.93 |  |
| 1 | 18.975.060 | 948753/2503193 | 0.3790171193351851015882514 | 2.63 |  |
| 2 | 4.743.765 | 948753/10012772 | 0.0947542798337962753970628 | 10.55 |  |
| 3 | 496.080 | 24804/2503193 | 0.0099089442963447085382549 | 100.91 |  |
| 4 | 21.465 | 4293/10012772 | 0.0004287523974379921963668 | 2332.34 | sim |
| 5 | 324 | 81/12515965 | 0.0000064717343009508256055 | 154518.08 | sim |
| 6 | 1 | 1/50063860 | 0.0000000199744885831815605 | 50063860.00 | sim |

### Lotofácil — aposta de 15 números (N=25, n=15)

| Acertos | Combinações favoráveis | P exata (reduzida) | Decimal (25 casas, truncado) | 1 em X (X=1/P, 2 casas, truncado) | Faixa premiada (regra) |
|---:|---:|---|---|---:|:---:|
| 0 | 0 | 0 | 0.0000000000000000000000000 | — |  |
| 1 | 0 | 0 | 0.0000000000000000000000000 | — |  |
| 2 | 0 | 0 | 0.0000000000000000000000000 | — |  |
| 3 | 0 | 0 | 0.0000000000000000000000000 | — |  |
| 4 | 0 | 0 | 0.0000000000000000000000000 | — |  |
| 5 | 3.003 | 273/297160 | 0.0009186969982501009557140 | 1088.49 |  |
| 6 | 50.050 | 455/29716 | 0.0153116166375016825952348 | 65.30 |  |
| 7 | 289.575 | 5265/59432 | 0.0885886391169740207295732 | 11.28 |  |
| 8 | 772.200 | 1755/7429 | 0.2362363709785973886121954 | 4.23 |  |
| 9 | 1.051.050 | 9555/29716 | 0.3215439493875353344999326 | 3.10 |  |
| 10 | 756.756 | 17199/74290 | 0.2315116435590254408399515 | 4.31 |  |
| 11 | 286.650 | 28665/326876 | 0.0876938043784187275908907 | 11.40 | sim |
| 12 | 54.600 | 1365/81719 | 0.0167035817863654719220744 | 59.86 | sim |
| 13 | 4.725 | 945/653752 | 0.0014455022699739350701795 | 691.80 | sim |
| 14 | 150 | 15/326876 | 0.0000458889609515534942914 | 21791.73 | sim |
| 15 | 1 | 1/3268760 | 0.0000003059264063436899619 | 3268760.00 | sim |

### Quina — aposta de 5 números (N=80, n=5)

| Acertos | Combinações favoráveis | P exata (reduzida) | Decimal (25 casas, truncado) | 1 em X (X=1/P, 2 casas, truncado) | Faixa premiada (regra) |
|---:|---:|---|---|---:|:---:|
| 0 | 17.259.390 | 8629695/12020008 | 0.7179441977076887136847163 | 1.39 |  |
| 1 | 6.077.250 | 3038625/12020008 | 0.2527972527139748991847592 | 3.95 |  |
| 2 | 675.250 | 337625/12020008 | 0.0280885836348860999094176 | 35.60 | sim |
| 3 | 27.750 | 13875/12020008 | 0.0011543253548583328729897 | 866.30 | sim |
| 4 | 375 | 375/24040016 | 0.0000155989912818693631485 | 64106.70 | sim |
| 5 | 1 | 1/24040016 | 0.0000000415973100849849683 | 24040016.00 | sim |

### Lotomania — aposta de 50 números (N=100, n=20)

| Acertos | Combinações favoráveis | P exata (reduzida) | Decimal (25 casas, truncado) | 1 em X (X=1/P, 2 casas, truncado) | Faixa premiada (regra) |
|---:|---:|---|---|---:|:---:|
| 0 | 47.129.212.243.960 | 148/1683150111 | 0.0000000879303628551999067 | 11372635.88 | sim |
| 1 | 1.520.297.169.160.000 | 148000/52177653441 | 0.0000028364633179096744117 | 352551.71 |  |
| 2 | 22.115.572.882.624.375 | 4305875/104355306882 | 0.0000412616773277172949591 | 24235.56 |  |
| 3 | 193.008.636.066.540.000 | 68894000/191318062617 | 0.0003601019112237145741888 | 2776.99 |  |
| 4 | 1.133.925.736.890.922.500 | 404752250/191318062617 | 0.0021155987284393231233595 | 472.67 |  |
| 5 | 4.768.967.670.581.251.200 | 1702272320/191318062617 | 0.0088976037950362389645293 | 112.38 |  |
| 6 | 14.903.023.970.566.410.000 | 5319601000/191318062617 | 0.0278050118594882467641541 | 35.96 |  |
| 7 | 35.445.029.984.049.840.000 | 1150184000/17392551147 | 0.0661308390171612355471775 | 15.12 |  |
| 8 | 65.176.880.793.039.015.000 | 2114976500/17392551147 | 0.1216024309558984561541850 | 8.22 |  |
| 9 | 93.587.316.010.517.560.000 | 9110668000/52177653441 | 0.1746086188084695780675477 | 5.72 |  |
| 10 | 105.519.698.801.858.548.900 | 10272278170/52177653441 | 0.1968712177065494492711600 | 5.07 |  |
| 11 | 93.587.316.010.517.560.000 | 9110668000/52177653441 | 0.1746086188084695780675477 | 5.72 |  |
| 12 | 65.176.880.793.039.015.000 | 2114976500/17392551147 | 0.1216024309558984561541850 | 8.22 |  |
| 13 | 35.445.029.984.049.840.000 | 1150184000/17392551147 | 0.0661308390171612355471775 | 15.12 |  |
| 14 | 14.903.023.970.566.410.000 | 5319601000/191318062617 | 0.0278050118594882467641541 | 35.96 |  |
| 15 | 4.768.967.670.581.251.200 | 1702272320/191318062617 | 0.0088976037950362389645293 | 112.38 | sim |
| 16 | 1.133.925.736.890.922.500 | 404752250/191318062617 | 0.0021155987284393231233595 | 472.67 | sim |
| 17 | 193.008.636.066.540.000 | 68894000/191318062617 | 0.0003601019112237145741888 | 2776.99 | sim |
| 18 | 22.115.572.882.624.375 | 4305875/104355306882 | 0.0000412616773277172949591 | 24235.56 | sim |
| 19 | 1.520.297.169.160.000 | 148000/52177653441 | 0.0000028364633179096744117 | 352551.71 | sim |
| 20 | 47.129.212.243.960 | 148/1683150111 | 0.0000000879303628551999067 | 11372635.88 | sim |

## 6. Limitações
- **Preços e valores de prêmio não incluídos**: aguardam fonte oficial CAIXA, versionada (interface `PricingSource`, `PRICING=null`). Nenhum valor fictício foi usado.
- Faixas premiadas foram codificadas como regra (nº de acertos); devem ser reconfirmadas contra a fonte oficial na fase de dados.
- `toDecimalString` **trunca** (não arredonda); `toNumber` é aproximação double (~15–16 dígitos significativos), só para exibição.
- Probabilidades consideram apenas um concurso e o sorteio uniforme; não tratam rateio, acumulação, Teimosinha, bolão ou Mês da Sorte/Time do Coração.
- Os 5 testes criptográficos (ECDSA/JCS/SRI) não fazem parte da Fase 1; apenas foram reexecutados pelo script original.
- Sem interface, sem laboratório estatístico (Fase 2), sem push para GitHub (repositório só local).

## 7. Critério de aprovação
Todos os 88 testes automatizados passaram (0 falhas) e o script de referência de 14 testes passou. **A Fase 1 cumpre os critérios de aprovação**: fórmulas exatas, limites, casos extremos, simetria da Lotomania e validação cruzada por força bruta verificados.
