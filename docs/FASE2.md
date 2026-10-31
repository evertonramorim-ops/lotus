# LOTUS — Fase 2: Laboratório Estatístico com Dados Sintéticos

> **SYNTHETIC_DATA.** Todos os dados desta fase são **artificiais**, gerados pelo próprio laboratório com semente explícita. Nenhum resultado real da Caixa, nenhuma API externa, nenhum preço ou premiação foi utilizado. Nada aqui é previsão, ranking de dezenas ou promessa de vantagem: sob o modelo, toda combinação é equiprovável e cada dezena tem probabilidade de inclusão exatamente k/N em todo concurso.

Branch: `phase-2-laboratorio-sintetico` (a partir de `main` = `5f38d58d654fd4748c087737b3ad5a92d7525352`). Node ≥ 20, zero dependências, testes com `node:test`. Documento gerado em 2026-10-31 (America/Sao_Paulo, UTC−03:00) com Node v24.22.1.

## 1. Objetivos
Gerar sorteios sintéticos reproduzíveis nas quatro modalidades (Mega-Sena 60/6, Lotofácil 25/15, Quina 80/5, Lotomania 100/20 com aposta de 50) e usá-los para estudar, **sob condições conhecidas**: frequências individuais, distribuição de acertos, distribuições estruturais (soma, paridade, faixas, consecutivos, amplitude, repetição e sobreposição), testes de uniformidade calibrados por Monte Carlo, intervalos de confiança, tamanho de efeito, correções para múltiplas comparações, taxa de falsos positivos, poder estatístico e convergência às expectativas exatas da Fase 1.

## 2. Arquitetura
```
src/lab.js                    API pública da Fase 2 (reexporta os módulos abaixo)
src/sim/prng.js               xoshiro128** + SplitMix64, inteiros limitados por rejeição, sementes derivadas
src/sim/sampler.js            Fisher-Yates parcial, amostrador ponderado (viés artificial), drawStream (gerador), metadados
src/stats/util.js             Wilson, quantil normal (só p/ Wilson), Binomial exata (pmf, teste bilateral, cotas), TVD, JSON canônico
src/stats/frequencies.js      frequências absolutas/relativas/esperadas, desvio, Var teórica, IC, tamanho amostral
src/stats/hits.js             acertos empíricos × hipergeométrica exata (reutiliza src/math/bets.js da Fase 1)
src/stats/structural.js       distribuições estruturais exatas (BigInt) + acumulador em fluxo + referência simulada
src/stats/lotomania.js        simetria exata, P(0)=P(20), E=10, teoria × simulação
src/stats/hypothesis.js       estatísticas globais, distribuição nula por Monte Carlo, p=(b+1)/(B+1), efeito
src/stats/multiple.js         Holm e Benjamini–Hochberg (ajustes monótonos), família documentada
src/stats/power.js            experimentos de falsos positivos e poder (uniforme × enviesado artificial)
src/stats/experiment.js       executor de experimentos com metadados e JSON canônico (sha256)
scripts/experimentos-fase2.mjs  executa os experimentos documentados duas vezes e compara hashes
test/fase2/*.test.js          77 testes da Fase 2 (separados dos 88 da Fase 1 em test/*.test.js)
docs/fase2-evidencias/        RESULTADOS.md, JSONs, reprodutibilidade.json, test-output.txt
```
Módulos da Fase 1 **não foram alterados** (`src/math/*`, `src/lotteries/config.js`, `index.js`, testes da Fase 1). Única alteração em arquivo existente: `package.json` (descrição e scripts `test`, `test:fase1`, `test:fase2`, `experimentos:fase2`) — necessária para executar os testes da Fase 2 no `npm test` e separadamente.

Todo processamento é **em fluxo**: `drawStream` é um gerador JavaScript; os acumuladores (`FrequencyAccumulator`, `HitAccumulator`, `StructuralAccumulator`, `GlobalStatsAccumulator`) recebem um concurso por vez e guardam apenas histogramas (a sobreposição com defasagem L guarda só os L últimos concursos). Limites: `MAX_DRAWS = 10 000 000` concursos por fluxo, `MAX_REPLICATES = 100 000` réplicas MC.

## 3. Funcionamento do gerador
- **PRNG:** xoshiro128** 1.0 (Blackman & Vigna), estado 4×32 bits, período 2^128−1. Semente inteira (Number seguro ou BigInt < 2^64) expandida por **SplitMix64** (duas saídas de 64 bits → quatro palavras de 32 bits). Verificado bit a bit contra a implementação de referência em C (vetores no teste `prng.test.js`). Identificação gravada: `generator = "xoshiro128**/splitmix64"`, `generator_version = "1.0.0"`.
- **Não criptográfico.** Destina-se exclusivamente a simulação estatística reproduzível; não deve ser usado para segurança, chaves ou qualquer sorteio real. `Math.random` não é usado (há teste que verifica o código-fonte).
- **Inteiros limitados sem viés de módulo:** para U[0,n), aceita-se x (uint32) somente se x < L = 2^32 − (2^32 mod n); L é múltiplo de n, logo x mod n é exatamente uniforme. Probabilidade de rejeição < n/2^32.
- **Fisher-Yates parcial (Durstenfeld/Knuth):** para i = 0..k−1, j = i + U[0, N−i), troca pool[i]↔pool[j]; o sorteio é pool[0..k) ordenado. Para qualquer arranjo inicial do pool, cada k-subconjunto tem probabilidade exata 1/C(N,k) — provado nos testes por **enumeração exaustiva** de todas as N!/(N−k)! sequências de escolhas (cada subconjunto aparece exatamente k! vezes). O pool não é reinicializado entre concursos (custo O(k)); como a uniformidade vale para qualquer arranjo inicial, os concursos permanecem independentes e uniformes.
- **Sementes derivadas:** `deriveSeed(semente, rótulo)` = SplitMix64(semente XOR FNV-1a-64(rótulo)); usado para separar fluxos (dados, nula MC, réplicas) de forma determinística.
- **Gerador enviesado (apenas experimental):** amostragem sequencial ponderada sem reposição: a cada passo escolhe-se uma dezena restante com probabilidade w_i/Σ_restantes w. Pesos iguais ⇒ exatamente o modelo uniforme (testado). Viés `single` (peso 1+boost numa dezena) ou `group` (peso `factor` num grupo). Atenção: a probabilidade de inclusão resultante **não** é proporcional a w_i (é a de "successive sampling"); por isso os testes usam apenas cotas inferiores rigorosas (P(incluir) ≥ 1−(1−w/W_max)^k).

## 4. Métodos estatísticos e fórmulas
**Frequências.** Em D concursos, a contagem X_i da dezena i soma D indicadores independentes de Bernoulli(p), p = k/N ⇒ X_i ~ Binomial(D, p), E = D·p, **Var(X_i) = D·p·(1−p)**. Relatório: absoluta, relativa X_i/D, esperada, desvio X_i−E, desvio padronizado (X_i−E)/√Var (apenas escala; nenhuma normalidade é assumida para valores-p), **IC de Wilson (1927)** para a taxa de inclusão, e indicadores de tamanho amostral (contagem esperada por dezena, D mínimo para E ≥ 5, meia-largura aproximada do IC95%). As contagens de dezenas diferentes **não** são independentes (Σ X_i = D·k fixo).

**Acertos.** Aposta fixa de K dezenas; acertos ~ Hipergeométrica(N, K, k): P(h) = C(K,h)·C(N−K,k−h)/C(N,k), obtida da Fase 1 (`hitDistribution`, frações exatas). Compara-se a frequência empírica por faixa, |dif| por faixa, soma das |dif|, **distância de variação total** TVD = ½Σ|f_h − P(h)| e erro acumulado máximo max_h |Σ_{j≤h}(f_j − P(j))| (tipo Kolmogorov). Convergência: tabelas por D ∈ {100, 10³, 10⁴, 10⁵} com TVD·√D (estável ⇒ taxa 1/√D). Todos os tamanhos de aposta válidos são aceitos (testados mínimo e máximo de cada modalidade).

**Estruturais (exatas, BigInt, sem normalidade):**
- soma: programação dinâmica do nº de k-subconjuntos com soma s;
- paridade: nº de pares ~ Hipergeométrica(N, #pares, k);
- faixas (10 dezenas; 5 na Lotofácil): nº na faixa ~ Hipergeométrica(N, tamanho, k);
- consecutivos (nº de pares adjacentes j): C(k−1, j)·C(N−k+1, k−j);
- amplitude a = máx − mín: (N−a)·C(a−1, k−2);
- repetição entre concursos consecutivos e sobreposição com defasagem L: Hipergeométrica(N, k, k), média k²/N.
As fórmulas são verificadas contra enumeração por força bruta em universos pequenos. Há também a **referência por simulação** do próprio modelo uniforme (`simulatedStructuralReference`, semente independente) e a TVD observado × referência simulada.

**Testes de uniformidade.** Estatísticas: (1) Pearson das frequências X = Σ(O_i − E)²/E; (2) Pearson do nº de pares por concurso vs. hipergeométrica exata; (3) Pearson da repetição entre consecutivos vs. Hipergeométrica(N,k,k); (4) |média das somas − E[soma]|. **Não se usa a tabela qui-quadrado**: dentro de cada concurso as k dezenas são sorteadas sem reposição, as contagens são negativamente dependentes e, sob H0, E[X] = N(1−p) = **N − k** (não N − 1). A distribuição nula é obtida por Monte Carlo reproduzindo exatamente o mecanismo (Fisher-Yates parcial), com B réplicas de D concursos: **p = (b+1)/(B+1)**, b = #{T_sim ≥ T_obs} (empates contam). Esse estimador é conservador: P_H0(p ≤ α) ≤ α para α múltiplo de 1/(B+1). **Resolução:** o menor valor-p possível é 1/(B+1) (B=99 → 0,01; B=999 → 0,001); não é possível declarar p menor que isso. Também se reporta IC de Wilson para b/B (incerteza do MC). **Tamanho de efeito:** V = √(X/(D·k·(N−1))) (análogo ao V de Cramér) e excesso normalizado (X − (N−k))/(N−k). α é configurável.

**Múltiplas comparações.** Holm (1979): p̃_(i) = max_{j≤i} min(1,(m−j+1)p_(j)) — controla FWER sob qualquer dependência. Benjamini–Hochberg (1995): p̃_(i) = min_{j≥i} min(1, m·p_(j)/j) — controla FDR sob independência/PRDS. Ambos monótonos e idênticos a `p.adjust` do R (verificado em exemplos calculados à mão). `adjustFamily` registra nome da família, rótulo **exploratório/confirmatório**, m, p originais, ajustados, critérios e nº de rejeições; todas as hipóteses executadas entram (sem seleção). Famílias usadas: **global** (as 4 estatísticas acima, por conjunto de dados) e **por dezena** (N testes binomiais bilaterais exatos, X_i ~ Binomial(D, k/N), método de mínima verossimilhança como `binom.test`).

**Poder e falsos positivos.** Para cada cenário: R conjuntos de D concursos; taxa de rejeição por estatística, por família (sem correção, Holm, BH), detecção da(s) dezena(s)-alvo e rejeições de dezenas não-alvo; IC de Wilson de cada taxa. `nullMode: 'shared'` usa uma única nula MC por (modalidade, D) — cada valor-p continua marginalmente válido, mas as R réplicas ficam condicionalmente dependentes da mesma referência (usado no script, por desempenho); `'per_rep'` gera nula nova por réplica (réplicas independentes; usado nos testes de calibração/FPR).

## 5. Hipóteses
- **H0:** os sorteios são produzidos por um mecanismo uniforme, independente entre concursos e sem reposição dentro de cada concurso.
- **H1:** os dados apresentam algum desvio em relação ao modelo uniforme especificado.
Cada estatística é sensível a desvios específicos (frequência, paridade, dependência serial, soma); nenhuma é sensível a todos.

## 6. Reprodutibilidade
Cada experimento (`runExperiment`) registra: `experiment_id` (sha256 dos parâmetros canônicos), `data_kind: "SYNTHETIC_DATA"`, tipo, modalidade, nº de concursos, semente, gerador e versão, `stats_module_version` (2.0.0), parâmetros completos, hipóteses, α, nº de réplicas MC e resultados. A serialização é canônica (chaves ordenadas, números com 12 algarismos significativos, sem carimbo de tempo) ⇒ **mesmos parâmetros + mesma semente ⇒ JSON byte a byte idêntico** (testado para todos os tipos e modalidades). O script `scripts/experimentos-fase2.mjs` executa todos os experimentos documentados **duas vezes em processos separados** e compara o sha256 de cada um dos 54 arquivos; o resultado fica em `docs/fase2-evidencias/reprodutibilidade.json`. **Correção (revisão complementar):** `reprodutibilidade.json` registra **exatamente 2 execuções** (run1/run2, sha256 agregado `c9e41f64…eceb2`). Uma terceira execução em cópia independente (`/tmp/lotus-fresh`) foi mencionada no relatório anterior mas não foi registrada nesse arquivo; ver §15.6 para o que é e o que não é verificável dela.

## 7. Exemplos de execução
```sh
npm test                    # Fase 1 (88) + Fase 2 (77)
npm run test:fase1          # apenas os 88 testes da Fase 1
npm run test:fase2          # apenas os 77 testes da Fase 2
node scripts/experimentos-fase2.mjs              # experimentos 2×, compara hashes, grava docs/fase2-evidencias/
node scripts/experimentos-fase2.mjs --out /tmp/x # uma execução em diretório escolhido
```
```js
import { runExperiment, serializeExperiment, drawStream, FrequencyAccumulator, frequencyReport } from './src/lab.js';
const e = runExperiment({ type: 'uniformity', lottery: 'megasena', seed: 42, draws: 1000, B: 999, alpha: 0.05 });
console.log(e.data_kind, serializeExperiment(e).sha256);           // SYNTHETIC_DATA <hash estável>
const acc = new FrequencyAccumulator('quina');
for (const d of drawStream({ lottery: 'quina', seed: 7, draws: 100000 })) acc.add(d); // fluxo
console.log(frequencyReport(acc).sample_size);
runExperiment({ type: 'error_rates', lottery: 'lotofacil', seed: 1, draws: 500, reps: 100, B: 99, alphas: [0.05],
  bias: { type: 'single', number: 7, boost: 0.25 } });           // viés ARTIFICIAL
```

## 8. Interpretação dos resultados
- Um valor-p é P_H0(estatística ≥ observada): mede **compatibilidade dos dados com o modelo**, não a probabilidade de H0 ser verdadeira e **muito menos a probabilidade de uma dezena sair no próximo concurso**. Sob H0, concursos são independentes: a probabilidade de inclusão de qualquer dezena no próximo concurso é k/N **independentemente** de qualquer frequência passada, desvio ou valor-p. Uma dezena com contagem acima do esperado não está "quente" nem "devida"; desvios são flutuação amostral de ordem √(D·p(1−p)).
- Com α = 0,05 e H0 verdadeira, ≈5% dos testes rejeitam por acaso. Com N testes por dezena sem correção, quase sempre alguma dezena "dá significativo" (medido: 69%–99% a α=0,05). Por isso as correções são obrigatórias e a família deve ser declarada antes.
- Exemplo real deste laboratório: no teste de uniformidade da Quina (D=1000, dados **uniformes** sintéticos), `sum_mean_absdev` deu p = 0,012 (Holm 0,048) — um **falso positivo** esperado em ≈α das execuções. Não significa nada sobre a Quina nem sobre os dados.
- Ausência de detecção **não prova** uniformidade perfeita (o poder pode ser baixo); uma detecção em dados sintéticos **não comprova** qualquer irregularidade em sorteios reais.
- Sob viés artificial com k fixo, aumentar o peso de algumas dezenas **reduz** a inclusão das demais; por isso "rejeições de não-alvo" sob H1 (até 53% na Lotofácil com viés de grupo) não são falsos positivos no sentido estrito: essas dezenas de fato mudaram de probabilidade.

## 9. Dados sintéticos × dados reais
Esta fase usa **exclusivamente** dados gerados pelo laboratório, marcados `SYNTHETIC_DATA` em todo objeto, JSON e relatório. Os resultados descrevem o comportamento **dos métodos** quando o modelo gerador é conhecido; não descrevem sorteios reais, não foram comparados com eles e não podem ser apresentados como evidência sobre eles. Uso de dados reais depende de fase posterior autorizada.

## 10. Limitações
- **Poder estatístico:** desvios pequenos exigem amostras enormes. Ex. (Seção 2 de RESULTADOS.md): Mega-Sena com boost 0,25 numa dezena tem detecção (Holm, α=0,05) de 0% com D=100, 10% com D=500 e 51% com D=2000; Quina com boost 0,1 fica ≤4% mesmo com D=2000. Desvios com a mesma frequência marginal (ex.: dependência entre pares de dezenas) não são capturados pelas estatísticas implementadas.
- **Monte Carlo:** valor-p com resolução 1/(B+1) e erro de MC (reportado via IC de Wilson de b/B); B pequeno reduz poder. Com `nullMode: 'shared'`, as taxas medidas nas R réplicas dependem da mesma nula (variabilidade extra não refletida no IC).
- **IC de Wilson** é um intervalo de cobertura aproximada (baseado no escore), não exato; os testes automatizados usam cotas **exatas** da binomial.
- Teste binomial por dezena e BH: as contagens por dezena são negativamente dependentes; Holm é válido sob qualquer dependência, a garantia formal do BH (independência/PRDS) não é assegurada aqui — tratado como exploratório.
- O amostrador enviesado é um cenário artificial único (successive sampling); outros mecanismos de viés podem ter poder diferente.
- `toNumber()` das frações exatas tem erro relativo ≲1e-16; JSON arredonda para 12 algarismos significativos.
- Desempenho medido (geração em fluxo, 200 mil concursos): ≈0,4 µs (Mega-Sena, Quina) a ≈1,7 µs (Lotomania) por concurso; os experimentos documentados levam ≈20 s por execução (Node v24.22.1 nesta máquina).

## 11. Testes e tolerâncias
77 testes da Fase 2 nas 18 categorias exigidas (o número entre colchetes no nome indica a categoria), todos com sementes fixas e **determinísticos**. Tolerâncias: cada contagem que, sob o modelo correto, segue Binomial(n, p) é comparada com cotas **exatas** [lo, hi] tais que P(fora) ≤ δ/m, com união de Boole sobre as m células ⇒ probabilidade total de falha de um gerador correto ≤ δ = 10⁻⁶ (sem aproximação normal). Médias limitadas usam Hoeffding. Calibração MC: com réplicas independentes, #{p ≤ α} é estocasticamente ≤ Binomial(R, α) e exige-se ≤ cota superior exata. Poder: cotas inferiores rigorosas da probabilidade de inclusão sob o viés implicam valores-p binomiais muito abaixo de α/N.

## 12. Referências
- Blackman, D.; Vigna, S. (2021). Scrambled linear pseudorandom number generators. *ACM TOMS* 47(4). (xoshiro128**)
- Steele, G.; Lea, D.; Flood, C. (2014). Fast splittable pseudorandom number generators. *OOPSLA*. (SplitMix64)
- Fisher, R. A.; Yates, F. (1938). *Statistical Tables*; Durstenfeld, R. (1964), Algorithm 235; Knuth, D. E. *TAOCP* vol. 2, §3.4.2.
- Lemire, D. (2019). Fast random integer generation in an interval. *ACM TOMACS* 29(1). (rejeição sem viés)
- Wilson, E. B. (1927). Probable inference, the law of succession, and statistical inference. *JASA* 22.
- Davison, A. C.; Hinkley, D. V. (1997). *Bootstrap Methods and their Application*. Cambridge. (p=(1+b)/(B+1))
- North, B. V.; Curtis, D.; Sham, P. C. (2002). A note on the calculation of empirical P values from Monte Carlo procedures. *AJHG* 71.
- Phipson, B.; Smyth, G. K. (2010). Permutation p-values should never be zero. *SAGMB* 9(1).
- Holm, S. (1979). A simple sequentially rejective multiple test procedure. *Scand. J. Statist.* 6.
- Benjamini, Y.; Hochberg, Y. (1995). Controlling the false discovery rate. *JRSS B* 57.
- Hoeffding, W. (1963). Probability inequalities for sums of bounded random variables. *JASA* 58.
- Wasserstein, R. L.; Lazar, N. A. (2016). The ASA statement on p-values. *Am. Stat.* 70.

## 13. Resultados dos experimentos (resumo)
Tabelas completas em `docs/fase2-evidencias/experimentos/RESULTADOS.md` (+ 53 JSONs).

> **Atenção — `nullMode: 'shared'`.** As tabelas de FPR e poder em `experimentos/` (seções 1–3 de RESULTADOS.md, inclusive o viés de grupo, que usou o padrão `shared`) reutilizam UMA distribuição nula MC por (modalidade, D) em todas as réplicas: as réplicas são **condicionalmente dependentes** e essas taxas/ICs **não são estimativas sobre réplicas independentes**. Foram mantidas inalteradas como registro histórico. As estimativas com réplicas independentes estão na §15 (`nullMode: 'per_rep'`). Reprodutibilidade em `docs/fase2-evidencias/reprodutibilidade.json`.

## 14. Resultados individuais dos testes
Saída bruta (TAP, com versão do Node e data): `docs/fase2-evidencias/test-output.txt`.

### Fase 1 — 88 testes (88 passaram)

| # | Teste | Resultado |
|---|---|---|
| 1 | C(60,6)=50063860 | ✅ passou |
| 2 | C(25,15)=3268760 | ✅ passou |
| 3 | C(80,5)=24040016 | ✅ passou |
| 4 | C(100,20)=535983370403809682970 | ✅ passou |
| 5 | C(100,50) = n!/(k!(n-k)!) independente | ✅ passou |
| 6 | C(n,0)=C(n,n)=1 para n=0..100 | ✅ passou |
| 7 | C(n,k)=0 quando k>n | ✅ passou |
| 8 | simetria C(n,k)=C(n,n-k) e Pascal, n<=80 | ✅ passou |
| 9 | binomial vs fórmula fatorial para n<=60 todos k | ✅ passou |
| 10 | binomial aceita bigint | ✅ passou |
| 11 | entradas inválidas lançam erro | ✅ passou |
| 12 | factorial(0)=factorial(1)=1 | ✅ passou |
| 13 | 25! = 15511210043330985984000000 | ✅ passou |
| 14 | 20! = 2432902008176640000 | ✅ passou |
| 15 | permutations P(10,3)=720, P(n,n)=n!, k>n=0 | ✅ passou |
| 16 | gcd | ✅ passou |
| 17 | Fraction reduz e normaliza sinal | ✅ passou |
| 18 | Fraction add/sub/mul/div/compare/equals | ✅ passou |
| 19 | toDecimalString truncado e controlado | ✅ passou |
| 20 | toNumber precisão relativa < 1e-15 | ✅ passou |
| 21 | força bruta N=10,K=3,n=3: contagens = enumeração | ✅ passou |
| 22 | força bruta N=10,K=4,n=3: contagens = enumeração | ✅ passou |
| 23 | força bruta N=10,K=7,n=3: contagens = enumeração | ✅ passou |
| 24 | força bruta N=12,K=5,n=4: contagens = enumeração | ✅ passou |
| 25 | força bruta N=9,K=9,n=4: contagens = enumeração | ✅ passou |
| 26 | força bruta N=8,K=0,n=3: contagens = enumeração | ✅ passou |
| 27 | força bruta N=11,K=6,n=6: contagens = enumeração | ✅ passou |
| 28 | suporte e P=0 fora do suporte | ✅ passou |
| 29 | variância = fórmula fechada (vários casos) | ✅ passou |
| 30 | parâmetros inválidos lançam | ✅ passou |
| 31 | soma da distribuição=1 para todo K,n com N=20 | ✅ passou |
| 32 | megasena aposta 6: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 33 | megasena aposta 7: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 34 | megasena aposta 8: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 35 | megasena aposta 9: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 36 | megasena aposta 10: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 37 | megasena aposta 11: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 38 | megasena aposta 12: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 39 | megasena aposta 13: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 40 | megasena aposta 14: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 41 | megasena aposta 15: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 42 | megasena aposta 16: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 43 | megasena aposta 17: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 44 | megasena aposta 18: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 45 | megasena aposta 19: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 46 | megasena aposta 20: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 47 | megasena: rejeita tamanhos inválidos | ✅ passou |
| 48 | lotofacil aposta 15: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 49 | lotofacil aposta 16: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 50 | lotofacil aposta 17: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 51 | lotofacil aposta 18: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 52 | lotofacil aposta 19: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 53 | lotofacil aposta 20: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 54 | lotofacil: rejeita tamanhos inválidos | ✅ passou |
| 55 | quina aposta 5: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 56 | quina aposta 6: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 57 | quina aposta 7: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 58 | quina aposta 8: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 59 | quina aposta 9: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 60 | quina aposta 10: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 61 | quina aposta 11: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 62 | quina aposta 12: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 63 | quina aposta 13: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 64 | quina aposta 14: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 65 | quina aposta 15: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 66 | quina: rejeita tamanhos inválidos | ✅ passou |
| 67 | lotomania aposta 50: soma=1, E=Kn/N, suporte, fora=0 | ✅ passou |
| 68 | lotomania: rejeita tamanhos inválidos | ✅ passou |
| 69 | modalidade desconhecida e protótipo | ✅ passou |
| 70 | regras: sem preços (placeholder null) e objetos congelados | ✅ passou |
| 71 | Mega simples: 1 em 50063860 | ✅ passou |
| 72 | Mega 7 números: 7 jogos, 1 em 7151980 | ✅ passou |
| 73 | Mega 15 números: C(15,6)=5005 jogos, prob=5005/50063860 | ✅ passou |
| 74 | Mega 20: C(20,6)=38760 | ✅ passou |
| 75 | Lotofácil simples 1/3268760; 16 números 16 jogos → 2/408595 | ✅ passou |
| 76 | Quina simples 1/24040016 | ✅ passou |
| 77 | Lotomania P(20)=P(0)=148/1683150111 | ✅ passou |
| 78 | Lotomania simetria P(k)=P(20-k), soma=1, E=10 | ✅ passou |
| 79 | pares/trincas vs fórmula independente N(N-1)/2, N(N-1)(N-2)/6 | ✅ passou |
| 80 | REF06 C(60,6) | ✅ passou |
| 81 | REF07 C(25,15) | ✅ passou |
| 82 | REF08 C(80,5) | ✅ passou |
| 83 | REF09 pares/trincas Mega | ✅ passou |
| 84 | REF10 P(X=0)=P(X=20) | ✅ passou |
| 85 | REF11 simetria k=0..20 | ✅ passou |
| 86 | REF12 soma = 1 (Vandermonde) | ✅ passou |
| 87 | REF13 E(X)=10 | ✅ passou |
| 88 | REF14 decimal 30 casas de P(20) | ✅ passou |

### Fase 2 — 77 testes (77 passaram)

| # | Teste | Resultado |
|---|---|---|
| 1 | [6] megasena: frequências — soma exata, p=k/N, Var=Dp(1−p), cotas binomiais exatas por dezena, IC Wilson | ✅ passou |
| 2 | [7] megasena: distribuição de acertos empírica vs hipergeométrica exata (Fase 1), tamanhos de aposta 6,20 | ✅ passou |
| 3 | [8] megasena: convergência — TVD de acertos e desvio máximo de frequência dentro de cotas exatas que encolhem com D | ✅ passou |
| 4 | [9] megasena: distribuições estruturais (soma, paridade, faixas, consecutivos, amplitude) vs exatas | ✅ passou |
| 5 | [10] megasena: repetição entre concursos consecutivos ~ hipergeométrica(N,k,k) (pares disjuntos ⇒ independência) | ✅ passou |
| 6 | [6] lotofacil: frequências — soma exata, p=k/N, Var=Dp(1−p), cotas binomiais exatas por dezena, IC Wilson | ✅ passou |
| 7 | [7] lotofacil: distribuição de acertos empírica vs hipergeométrica exata (Fase 1), tamanhos de aposta 15,20 | ✅ passou |
| 8 | [8] lotofacil: convergência — TVD de acertos e desvio máximo de frequência dentro de cotas exatas que encolhem com D | ✅ passou |
| 9 | [9] lotofacil: distribuições estruturais (soma, paridade, faixas, consecutivos, amplitude) vs exatas | ✅ passou |
| 10 | [10] lotofacil: repetição entre concursos consecutivos ~ hipergeométrica(N,k,k) (pares disjuntos ⇒ independência) | ✅ passou |
| 11 | [6] quina: frequências — soma exata, p=k/N, Var=Dp(1−p), cotas binomiais exatas por dezena, IC Wilson | ✅ passou |
| 12 | [7] quina: distribuição de acertos empírica vs hipergeométrica exata (Fase 1), tamanhos de aposta 5,15 | ✅ passou |
| 13 | [8] quina: convergência — TVD de acertos e desvio máximo de frequência dentro de cotas exatas que encolhem com D | ✅ passou |
| 14 | [9] quina: distribuições estruturais (soma, paridade, faixas, consecutivos, amplitude) vs exatas | ✅ passou |
| 15 | [10] quina: repetição entre concursos consecutivos ~ hipergeométrica(N,k,k) (pares disjuntos ⇒ independência) | ✅ passou |
| 16 | [6] lotomania: frequências — soma exata, p=k/N, Var=Dp(1−p), cotas binomiais exatas por dezena, IC Wilson | ✅ passou |
| 17 | [7] lotomania: distribuição de acertos empírica vs hipergeométrica exata (Fase 1), tamanhos de aposta 50 | ✅ passou |
| 18 | [8] lotomania: convergência — TVD de acertos e desvio máximo de frequência dentro de cotas exatas que encolhem com D | ✅ passou |
| 19 | [9] lotomania: distribuições estruturais (soma, paridade, faixas, consecutivos, amplitude) vs exatas | ✅ passou |
| 20 | [10] lotomania: repetição entre concursos consecutivos ~ hipergeométrica(N,k,k) (pares disjuntos ⇒ independência) | ✅ passou |
| 21 | [9] fórmulas estruturais exatas = enumeração por força bruta (N=10,k=4 e N=12,k=5, início 1 e 0) | ✅ passou |
| 22 | [17] megasena: mesmo spec+semente ⇒ JSON byte a byte idêntico (uniformity, error_rates, convergence); semente diferente ⇒ diferente | ✅ passou |
| 23 | [17] lotofacil: mesmo spec+semente ⇒ JSON byte a byte idêntico (uniformity, error_rates, convergence); semente diferente ⇒ diferente | ✅ passou |
| 24 | [17] quina: mesmo spec+semente ⇒ JSON byte a byte idêntico (uniformity, error_rates, convergence); semente diferente ⇒ diferente | ✅ passou |
| 25 | [17] lotomania: mesmo spec+semente ⇒ JSON byte a byte idêntico (uniformity, error_rates, convergence); semente diferente ⇒ diferente | ✅ passou |
| 26 | [18] entradas inválidas lançam erro | ✅ passou |
| 27 | [18] desempenho: fluxo preguiçoso (10 milhões declarados, 5 consumidos) e 200 mil concursos em < 15 s | ✅ passou |
| 28 | [12] fórmula p=(b+1)/(B+1), resolução 1/(B+1), nunca zero | ✅ passou |
| 29 | [12] megasena: sob H0 os valores-p MC são (super)uniformes — R=200 conjuntos, B=99, nulas independentes | ✅ passou |
| 30 | [12] lotofacil: sob H0 os valores-p MC são (super)uniformes — R=200 conjuntos, B=99, nulas independentes | ✅ passou |
| 31 | [12] quina: sob H0 os valores-p MC são (super)uniformes — R=200 conjuntos, B=99, nulas independentes | ✅ passou |
| 32 | [12] lotomania: sob H0 os valores-p MC são (super)uniformes — R=200 conjuntos, B=99, nulas independentes | ✅ passou |
| 33 | [12] E_H0[X_Pearson] = N − k (não N − 1): média MC próxima | ✅ passou |
| 34 | [12] uniformityTest: estrutura, tamanho de efeito, alpha configurável, sem tabela qui-quadrado | ✅ passou |
| 35 | [13] Holm: exemplos calculados à mão (= p.adjust(method="holm") do R) | ✅ passou |
| 36 | [14] Benjamini–Hochberg: exemplos calculados à mão (= p.adjust(method="BH") do R) | ✅ passou |
| 37 | [13][14] família documentada: m, p originais e ajustados, rótulo exploratório/confirmatório, sem seleção | ✅ passou |
| 38 | [11] Lotomania exata: suporte 0..20, P(k)=P(20−k) para todo k, P(0)=P(20), E=10 (frações exatas) | ✅ passou |
| 39 | [11] Lotomania simulada (60000 concursos): cada faixa 0..20 dentro de cotas exatas; simetria empírica e média | ✅ passou |
| 40 | [11] experimento lotomania reprodutível e restrito à Lotomania | ✅ passou |
| 41 | [15] megasena: FPR sob H0 — Holm controla FWER na família por dezena; sem correção a taxa familiar é maior | ✅ passou |
| 42 | [16] megasena: poder sob viés artificial forte (peso 3 em uma dezena) ≈ 1 e maior que sob viés fraco | ✅ passou |
| 43 | [16] megasena: amostrador ponderado — pesos iguais ⇒ uniforme; peso maior ⇒ inclusão maior; sem duplicatas | ✅ passou |
| 44 | [15] lotofacil: FPR sob H0 — Holm controla FWER na família por dezena; sem correção a taxa familiar é maior | ✅ passou |
| 45 | [16] lotofacil: poder sob viés artificial forte (peso 3 em uma dezena) ≈ 1 e maior que sob viés fraco | ✅ passou |
| 46 | [16] lotofacil: amostrador ponderado — pesos iguais ⇒ uniforme; peso maior ⇒ inclusão maior; sem duplicatas | ✅ passou |
| 47 | [15] quina: FPR sob H0 — Holm controla FWER na família por dezena; sem correção a taxa familiar é maior | ✅ passou |
| 48 | [16] quina: poder sob viés artificial forte (peso 3 em uma dezena) ≈ 1 e maior que sob viés fraco | ✅ passou |
| 49 | [16] quina: amostrador ponderado — pesos iguais ⇒ uniforme; peso maior ⇒ inclusão maior; sem duplicatas | ✅ passou |
| 50 | [15] lotomania: FPR sob H0 — Holm controla FWER na família por dezena; sem correção a taxa familiar é maior | ✅ passou |
| 51 | [16] lotomania: poder sob viés artificial forte (peso 3 em uma dezena) ≈ 1 e maior que sob viés fraco | ✅ passou |
| 52 | [16] lotomania: amostrador ponderado — pesos iguais ⇒ uniforme; peso maior ⇒ inclusão maior; sem duplicatas | ✅ passou |
| 53 | [1] vetor conhecido xoshiro128** (estado {1,2,3,4}) = implementação de referência em C | ✅ passou |
| 54 | [1] semeadura SplitMix64 = referência em C (sementes 0, 42, 20261031) | ✅ passou |
| 55 | [1] megasena: mesma semente ⇒ mesma sequência de concursos | ✅ passou |
| 56 | [2] megasena: sementes diferentes ⇒ sequências diferentes | ✅ passou |
| 57 | [1] lotofacil: mesma semente ⇒ mesma sequência de concursos | ✅ passou |
| 58 | [2] lotofacil: sementes diferentes ⇒ sequências diferentes | ✅ passou |
| 59 | [1] quina: mesma semente ⇒ mesma sequência de concursos | ✅ passou |
| 60 | [2] quina: sementes diferentes ⇒ sequências diferentes | ✅ passou |
| 61 | [1] lotomania: mesma semente ⇒ mesma sequência de concursos | ✅ passou |
| 62 | [2] lotomania: sementes diferentes ⇒ sequências diferentes | ✅ passou |
| 63 | [2] sementes derivadas por rótulo são distintas e determinísticas | ✅ passou |
| 64 | rejeição sem viés de módulo: L = 2^32 − (2^32 mod n) é múltiplo de n e valores ≥ L são rejeitados | ✅ passou |
| 65 | uniformInt e nextFloat dentro dos limites | ✅ passou |
| 66 | Math.random não é usado nos módulos da Fase 2 | ✅ passou |
| 67 | [3] uniformidade EXATA do Fisher-Yates parcial N=6,k=2 (enumeração de todas as N!/(N−k)! escolhas) | ✅ passou |
| 68 | [3] uniformidade EXATA do Fisher-Yates parcial N=7,k=3 (enumeração de todas as N!/(N−k)! escolhas) | ✅ passou |
| 69 | [3] uniformidade EXATA do Fisher-Yates parcial N=8,k=4 (enumeração de todas as N!/(N−k)! escolhas) | ✅ passou |
| 70 | [3] uniformidade EXATA do Fisher-Yates parcial N=5,k=5 (enumeração de todas as N!/(N−k)! escolhas) | ✅ passou |
| 71 | [3] uniformidade EXATA do Fisher-Yates parcial N=6,k=1 (enumeração de todas as N!/(N−k)! escolhas) | ✅ passou |
| 72 | [3] uniformidade estatística N=6,k=2 com PRNG real: 15 subconjuntos, cotas binomiais exatas | ✅ passou |
| 73 | [4][5] megasena: sem duplicatas, ordenado, dentro do universo, tamanho exato (20000 concursos) | ✅ passou |
| 74 | [4][5] lotofacil: sem duplicatas, ordenado, dentro do universo, tamanho exato (20000 concursos) | ✅ passou |
| 75 | [4][5] quina: sem duplicatas, ordenado, dentro do universo, tamanho exato (20000 concursos) | ✅ passou |
| 76 | [4][5] lotomania: sem duplicatas, ordenado, dentro do universo, tamanho exato (20000 concursos) | ✅ passou |
| 77 | [5] limites oficiais das 4 modalidades | ✅ passou |

## 15. Revisão complementar — FPR e poder com `nullMode: 'per_rep'` (SYNTHETIC_DATA)

**Motivo.** A bateria original (§13) usou `nullMode: 'shared'`. Esta bateria nova usa `nullMode: 'per_rep'`: cada réplica i gera seus dados com `deriveSeed(seed, "data:i")` e sua PRÓPRIA nula MC com `deriveSeed(seed, "null:i")` ⇒ réplicas independentes; IC95% de Wilson sobre R réplicas independentes. A implementação de `per_rep` em `src/stats/power.js` já existia e foi revisada sem defeitos; **nenhum código de `src/` foi alterado**. Foram acrescentados 3 testes (`test/fase2/per-rep.test.js`: registro de `null_mode` e rejeição de modo inválido; nulas distintas por réplica; determinismo).

**Script:** `scripts/experimentos-fase2-per-rep.mjs` → `docs/fase2-evidencias/experimentos-per-rep/` (44 JSONs + `RESULTADOS-per-rep.md`; todos com `data_kind: "SYNTHETIC_DATA"` e `null_mode: "per_rep"`). Semente-mestre **20261101** (diferente da bateria shared, 20261031). α ∈ {0.01, 0.05, 0.1}.

| Bateria | D | R | B | grade |
|---|---|---|---|---|
| FPR (H0, uniforme) | 500 | 200 | 199 | 4 modalidades |
| Poder, viés em 1 dezena (alvo = minNumber+6, peso 1+boost) | 100, 500, 2000 | 100 | 99 | boost 0.1, 0.25, 0.5 — **mesma grade da bateria shared, sem redução** |
| Poder, viés de grupo (primeira faixa: 10 dezenas; Lotofácil 5; peso 1.2) | 2000 | 100 | 99 | 4 modalidades |

Tempo: ≈520 s por execução (Node v24.22.1). **BH é EXPLORATÓRIO** (controla FDR, não FWER); a decisão confirmatória usa Holm.

### 15.1. Taxa de falsos positivos sob H0 (gerador uniforme)

D=500, R=200, B=199. Família global = 4 testes MC; família por dezena = N testes binomiais exatos. **BH = EXPLORATÓRIO** (controla FDR, não FWER).

| Modalidade | α | freq_pearson | parity | repetition | sum | global s/ correção | global Holm | global BH (EXPLORATÓRIO) | por dezena s/ correção | por dezena Holm | por dezena BH (EXPLORATÓRIO) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| megasena | 0.01 | 0.005 [0.001; 0.028] | 0.015 [0.005; 0.043] | 0.010 [0.003; 0.036] | 0.010 [0.003; 0.036] | 0.040 [0.020; 0.077] | 0.000 [0.000; 0.019] | 0.000 [0.000; 0.019] | 0.400 [0.335; 0.469] | 0.005 [0.001; 0.028] | 0.005 [0.001; 0.028] |
| megasena | 0.05 | 0.065 [0.038; 0.108] | 0.065 [0.038; 0.108] | 0.035 [0.017; 0.070] | 0.055 [0.031; 0.096] | 0.205 [0.155; 0.266] | 0.040 [0.020; 0.077] | 0.040 [0.020; 0.077] | 0.940 [0.898; 0.965] | 0.040 [0.020; 0.077] | 0.040 [0.020; 0.077] |
| megasena | 0.1 | 0.105 [0.070; 0.155] | 0.090 [0.058; 0.138] | 0.090 [0.058; 0.138] | 0.140 [0.099; 0.195] | 0.365 [0.301; 0.434] | 0.130 [0.090; 0.184] | 0.130 [0.090; 0.184] | 1.000 [0.981; 1.000] | 0.100 [0.066; 0.149] | 0.100 [0.066; 0.149] |
| lotofacil | 0.01 | 0.015 [0.005; 0.043] | 0.005 [0.001; 0.028] | 0.010 [0.003; 0.036] | 0.010 [0.003; 0.036] | 0.040 [0.020; 0.077] | 0.000 [0.000; 0.019] | 0.000 [0.000; 0.019] | 0.200 [0.150; 0.261] | 0.015 [0.005; 0.043] | 0.015 [0.005; 0.043] |
| lotofacil | 0.05 | 0.055 [0.031; 0.096] | 0.050 [0.027; 0.090] | 0.050 [0.027; 0.090] | 0.025 [0.011; 0.057] | 0.160 [0.116; 0.217] | 0.040 [0.020; 0.077] | 0.040 [0.020; 0.077] | 0.755 [0.691; 0.809] | 0.050 [0.027; 0.090] | 0.050 [0.027; 0.090] |
| lotofacil | 0.1 | 0.105 [0.070; 0.155] | 0.095 [0.062; 0.144] | 0.110 [0.074; 0.161] | 0.070 [0.042; 0.114] | 0.335 [0.273; 0.403] | 0.085 [0.054; 0.132] | 0.085 [0.054; 0.132] | 0.930 [0.886; 0.958] | 0.095 [0.062; 0.144] | 0.095 [0.062; 0.144] |
| quina | 0.01 | 0.010 [0.003; 0.036] | 0.015 [0.005; 0.043] | 0.020 [0.008; 0.050] | 0.015 [0.005; 0.043] | 0.060 [0.035; 0.102] | 0.000 [0.000; 0.019] | 0.000 [0.000; 0.019] | 0.525 [0.456; 0.593] | 0.000 [0.000; 0.019] | 0.000 [0.000; 0.019] |
| quina | 0.05 | 0.055 [0.031; 0.096] | 0.060 [0.035; 0.102] | 0.075 [0.046; 0.120] | 0.055 [0.031; 0.096] | 0.235 [0.182; 0.298] | 0.060 [0.035; 0.102] | 0.060 [0.035; 0.102] | 0.980 [0.950; 0.992] | 0.045 [0.024; 0.083] | 0.045 [0.024; 0.083] |
| quina | 0.1 | 0.080 [0.050; 0.126] | 0.115 [0.078; 0.167] | 0.120 [0.082; 0.172] | 0.095 [0.062; 0.144] | 0.370 [0.306; 0.439] | 0.135 [0.094; 0.189] | 0.135 [0.094; 0.189] | 1.000 [0.981; 1.000] | 0.085 [0.054; 0.132] | 0.090 [0.058; 0.138] |
| lotomania | 0.01 | 0.010 [0.003; 0.036] | 0.010 [0.003; 0.036] | 0.010 [0.003; 0.036] | 0.000 [0.000; 0.019] | 0.030 [0.014; 0.064] | 0.000 [0.000; 0.019] | 0.000 [0.000; 0.019] | 0.605 [0.536; 0.670] | 0.005 [0.001; 0.028] | 0.005 [0.001; 0.028] |
| lotomania | 0.05 | 0.065 [0.038; 0.108] | 0.050 [0.027; 0.090] | 0.035 [0.017; 0.070] | 0.030 [0.014; 0.064] | 0.170 [0.124; 0.228] | 0.030 [0.014; 0.064] | 0.030 [0.014; 0.064] | 0.980 [0.950; 0.992] | 0.045 [0.024; 0.083] | 0.045 [0.024; 0.083] |
| lotomania | 0.1 | 0.115 [0.078; 0.167] | 0.075 [0.046; 0.120] | 0.080 [0.050; 0.126] | 0.060 [0.035; 0.102] | 0.295 [0.236; 0.362] | 0.075 [0.046; 0.120] | 0.080 [0.050; 0.126] | 1.000 [0.981; 1.000] | 0.080 [0.050; 0.126] | 0.095 [0.062; 0.144] |

### 15.2. Poder sob viés ARTIFICIAL em uma dezena (alvo = minNumber+6, peso 1+boost)

R=100, B=99, D ∈ {100, 500, 2000}, boost ∈ {0.1, 0.25, 0.5} (mesma grade da bateria shared). "freq MC" = Pearson global calibrado por MC (nula por réplica); "alvo Holm/BH" = dezena enviesada rejeitada na família por dezena; "falso Holm" = alguma dezena não enviesada rejeitada (Holm).

| Modalidade | D | boost | α | freq MC | alvo Holm | alvo BH (EXPLORATÓRIO) | falso (não-alvo) Holm |
|---|---|---|---|---|---|---|---|
| megasena | 100 | 0.1 | 0.01 | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] |
| megasena | 100 | 0.1 | 0.05 | 0.010 [0.002; 0.054] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.010 [0.002; 0.054] |
| megasena | 100 | 0.25 | 0.01 | 0.000 [0.000; 0.037] | 0.010 [0.002; 0.054] | 0.010 [0.002; 0.054] | 0.000 [0.000; 0.037] |
| megasena | 100 | 0.25 | 0.05 | 0.010 [0.002; 0.054] | 0.010 [0.002; 0.054] | 0.010 [0.002; 0.054] | 0.000 [0.000; 0.037] |
| megasena | 100 | 0.5 | 0.01 | 0.010 [0.002; 0.054] | 0.020 [0.006; 0.070] | 0.020 [0.006; 0.070] | 0.000 [0.000; 0.037] |
| megasena | 100 | 0.5 | 0.05 | 0.090 [0.048; 0.162] | 0.020 [0.006; 0.070] | 0.030 [0.010; 0.085] | 0.020 [0.006; 0.070] |
| megasena | 500 | 0.1 | 0.01 | 0.030 [0.010; 0.085] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.010 [0.002; 0.054] |
| megasena | 500 | 0.1 | 0.05 | 0.060 [0.028; 0.125] | 0.000 [0.000; 0.037] | 0.010 [0.002; 0.054] | 0.040 [0.016; 0.098] |
| megasena | 500 | 0.25 | 0.01 | 0.030 [0.010; 0.085] | 0.020 [0.006; 0.070] | 0.020 [0.006; 0.070] | 0.000 [0.000; 0.037] |
| megasena | 500 | 0.25 | 0.05 | 0.050 [0.022; 0.112] | 0.050 [0.022; 0.112] | 0.050 [0.022; 0.112] | 0.030 [0.010; 0.085] |
| megasena | 500 | 0.5 | 0.01 | 0.090 [0.048; 0.162] | 0.250 [0.175; 0.343] | 0.250 [0.175; 0.343] | 0.000 [0.000; 0.037] |
| megasena | 500 | 0.5 | 0.05 | 0.200 [0.133; 0.289] | 0.410 [0.319; 0.508] | 0.410 [0.319; 0.508] | 0.020 [0.006; 0.070] |
| megasena | 2000 | 0.1 | 0.01 | 0.010 [0.002; 0.054] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] |
| megasena | 2000 | 0.1 | 0.05 | 0.050 [0.022; 0.112] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.020 [0.006; 0.070] |
| megasena | 2000 | 0.25 | 0.01 | 0.060 [0.028; 0.125] | 0.260 [0.184; 0.354] | 0.260 [0.184; 0.354] | 0.010 [0.002; 0.054] |
| megasena | 2000 | 0.25 | 0.05 | 0.160 [0.101; 0.244] | 0.380 [0.291; 0.478] | 0.380 [0.291; 0.478] | 0.010 [0.002; 0.054] |
| megasena | 2000 | 0.5 | 0.01 | 0.720 [0.625; 0.799] | 0.990 [0.946; 0.998] | 0.990 [0.946; 0.998] | 0.000 [0.000; 0.037] |
| megasena | 2000 | 0.5 | 0.05 | 0.830 [0.745; 0.891] | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 0.040 [0.016; 0.098] |
| lotofacil | 100 | 0.1 | 0.01 | 0.010 [0.002; 0.054] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] |
| lotofacil | 100 | 0.1 | 0.05 | 0.040 [0.016; 0.098] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.010 [0.002; 0.054] |
| lotofacil | 100 | 0.25 | 0.01 | 0.010 [0.002; 0.054] | 0.030 [0.010; 0.085] | 0.030 [0.010; 0.085] | 0.000 [0.000; 0.037] |
| lotofacil | 100 | 0.25 | 0.05 | 0.070 [0.034; 0.137] | 0.050 [0.022; 0.112] | 0.050 [0.022; 0.112] | 0.020 [0.006; 0.070] |
| lotofacil | 100 | 0.5 | 0.01 | 0.080 [0.041; 0.150] | 0.170 [0.109; 0.255] | 0.170 [0.109; 0.255] | 0.010 [0.002; 0.054] |
| lotofacil | 100 | 0.5 | 0.05 | 0.270 [0.193; 0.364] | 0.350 [0.264; 0.447] | 0.350 [0.264; 0.447] | 0.020 [0.006; 0.070] |
| lotofacil | 500 | 0.1 | 0.01 | 0.010 [0.002; 0.054] | 0.030 [0.010; 0.085] | 0.030 [0.010; 0.085] | 0.000 [0.000; 0.037] |
| lotofacil | 500 | 0.1 | 0.05 | 0.060 [0.028; 0.125] | 0.030 [0.010; 0.085] | 0.040 [0.016; 0.098] | 0.060 [0.028; 0.125] |
| lotofacil | 500 | 0.25 | 0.01 | 0.130 [0.078; 0.210] | 0.410 [0.319; 0.508] | 0.410 [0.319; 0.508] | 0.000 [0.000; 0.037] |
| lotofacil | 500 | 0.25 | 0.05 | 0.410 [0.319; 0.508] | 0.590 [0.492; 0.681] | 0.590 [0.492; 0.681] | 0.010 [0.002; 0.054] |
| lotofacil | 500 | 0.5 | 0.01 | 0.940 [0.875; 0.972] | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 0.000 [0.000; 0.037] |
| lotofacil | 500 | 0.5 | 0.05 | 0.990 [0.946; 0.998] | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 0.030 [0.010; 0.085] |
| lotofacil | 2000 | 0.1 | 0.01 | 0.160 [0.101; 0.244] | 0.310 [0.228; 0.406] | 0.320 [0.237; 0.417] | 0.010 [0.002; 0.054] |
| lotofacil | 2000 | 0.1 | 0.05 | 0.340 [0.255; 0.437] | 0.490 [0.394; 0.587] | 0.490 [0.394; 0.587] | 0.060 [0.028; 0.125] |
| lotofacil | 2000 | 0.25 | 0.01 | 0.990 [0.946; 0.998] | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 0.030 [0.010; 0.085] |
| lotofacil | 2000 | 0.25 | 0.05 | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 0.050 [0.022; 0.112] |
| lotofacil | 2000 | 0.5 | 0.01 | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 0.060 [0.028; 0.125] |
| lotofacil | 2000 | 0.5 | 0.05 | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 0.140 [0.085; 0.221] |
| quina | 100 | 0.1 | 0.01 | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.010 [0.002; 0.054] |
| quina | 100 | 0.1 | 0.05 | 0.030 [0.010; 0.085] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.040 [0.016; 0.098] |
| quina | 100 | 0.25 | 0.01 | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] |
| quina | 100 | 0.25 | 0.05 | 0.020 [0.006; 0.070] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.020 [0.006; 0.070] |
| quina | 100 | 0.5 | 0.01 | 0.010 [0.002; 0.054] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] |
| quina | 100 | 0.5 | 0.05 | 0.030 [0.010; 0.085] | 0.030 [0.010; 0.085] | 0.030 [0.010; 0.085] | 0.050 [0.022; 0.112] |
| quina | 500 | 0.1 | 0.01 | 0.020 [0.006; 0.070] | 0.010 [0.002; 0.054] | 0.010 [0.002; 0.054] | 0.000 [0.000; 0.037] |
| quina | 500 | 0.1 | 0.05 | 0.080 [0.041; 0.150] | 0.010 [0.002; 0.054] | 0.010 [0.002; 0.054] | 0.060 [0.028; 0.125] |
| quina | 500 | 0.25 | 0.01 | 0.030 [0.010; 0.085] | 0.020 [0.006; 0.070] | 0.020 [0.006; 0.070] | 0.000 [0.000; 0.037] |
| quina | 500 | 0.25 | 0.05 | 0.100 [0.055; 0.174] | 0.050 [0.022; 0.112] | 0.050 [0.022; 0.112] | 0.050 [0.022; 0.112] |
| quina | 500 | 0.5 | 0.01 | 0.070 [0.034; 0.137] | 0.110 [0.063; 0.186] | 0.110 [0.063; 0.186] | 0.020 [0.006; 0.070] |
| quina | 500 | 0.5 | 0.05 | 0.200 [0.133; 0.289] | 0.190 [0.125; 0.278] | 0.230 [0.158; 0.322] | 0.040 [0.016; 0.098] |
| quina | 2000 | 0.1 | 0.01 | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.010 [0.002; 0.054] |
| quina | 2000 | 0.1 | 0.05 | 0.050 [0.022; 0.112] | 0.020 [0.006; 0.070] | 0.020 [0.006; 0.070] | 0.030 [0.010; 0.085] |
| quina | 2000 | 0.25 | 0.01 | 0.040 [0.016; 0.098] | 0.140 [0.085; 0.221] | 0.140 [0.085; 0.221] | 0.020 [0.006; 0.070] |
| quina | 2000 | 0.25 | 0.05 | 0.120 [0.070; 0.198] | 0.280 [0.201; 0.375] | 0.300 [0.219; 0.396] | 0.050 [0.022; 0.112] |
| quina | 2000 | 0.5 | 0.01 | 0.390 [0.300; 0.488] | 0.910 [0.838; 0.952] | 0.910 [0.838; 0.952] | 0.030 [0.010; 0.085] |
| quina | 2000 | 0.5 | 0.05 | 0.640 [0.542; 0.727] | 0.940 [0.875; 0.972] | 0.940 [0.875; 0.972] | 0.050 [0.022; 0.112] |
| lotomania | 100 | 0.1 | 0.01 | 0.010 [0.002; 0.054] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] |
| lotomania | 100 | 0.1 | 0.05 | 0.050 [0.022; 0.112] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.100 [0.055; 0.174] |
| lotomania | 100 | 0.25 | 0.01 | 0.010 [0.002; 0.054] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] |
| lotomania | 100 | 0.25 | 0.05 | 0.070 [0.034; 0.137] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.090 [0.048; 0.162] |
| lotomania | 100 | 0.5 | 0.01 | 0.020 [0.006; 0.070] | 0.030 [0.010; 0.085] | 0.030 [0.010; 0.085] | 0.000 [0.000; 0.037] |
| lotomania | 100 | 0.5 | 0.05 | 0.100 [0.055; 0.174] | 0.050 [0.022; 0.112] | 0.050 [0.022; 0.112] | 0.070 [0.034; 0.137] |
| lotomania | 500 | 0.1 | 0.01 | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] |
| lotomania | 500 | 0.1 | 0.05 | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.000 [0.000; 0.037] | 0.050 [0.022; 0.112] |
| lotomania | 500 | 0.25 | 0.01 | 0.020 [0.006; 0.070] | 0.060 [0.028; 0.125] | 0.060 [0.028; 0.125] | 0.000 [0.000; 0.037] |
| lotomania | 500 | 0.25 | 0.05 | 0.120 [0.070; 0.198] | 0.120 [0.070; 0.198] | 0.120 [0.070; 0.198] | 0.040 [0.016; 0.098] |
| lotomania | 500 | 0.5 | 0.01 | 0.210 [0.142; 0.300] | 0.730 [0.636; 0.807] | 0.730 [0.636; 0.807] | 0.000 [0.000; 0.037] |
| lotomania | 500 | 0.5 | 0.05 | 0.390 [0.300; 0.488] | 0.850 [0.767; 0.907] | 0.850 [0.767; 0.907] | 0.020 [0.006; 0.070] |
| lotomania | 2000 | 0.1 | 0.01 | 0.010 [0.002; 0.054] | 0.020 [0.006; 0.070] | 0.020 [0.006; 0.070] | 0.010 [0.002; 0.054] |
| lotomania | 2000 | 0.1 | 0.05 | 0.090 [0.048; 0.162] | 0.050 [0.022; 0.112] | 0.060 [0.028; 0.125] | 0.040 [0.016; 0.098] |
| lotomania | 2000 | 0.25 | 0.01 | 0.220 [0.150; 0.311] | 0.780 [0.689; 0.850] | 0.780 [0.689; 0.850] | 0.010 [0.002; 0.054] |
| lotomania | 2000 | 0.25 | 0.05 | 0.470 [0.375; 0.567] | 0.900 [0.826; 0.945] | 0.900 [0.826; 0.945] | 0.040 [0.016; 0.098] |
| lotomania | 2000 | 0.5 | 0.01 | 0.970 [0.915; 0.990] | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 0.020 [0.006; 0.070] |
| lotomania | 2000 | 0.5 | 0.05 | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 0.080 [0.041; 0.150] |

### 15.3. Poder sob viés ARTIFICIAL de grupo (primeira faixa, peso 1.2, D=2000, R=100, B=99)

| Modalidade | grupo | α | freq MC | algum alvo Holm | algum alvo BH (EXPLORATÓRIO) | falso (não-alvo) Holm |
|---|---|---|---|---|---|---|
| megasena | 1–10 | 0.01 | 0.950 [0.888; 0.978] | 0.500 [0.404; 0.596] | 0.530 [0.433; 0.625] | 0.000 [0.000; 0.037] |
| megasena | 1–10 | 0.05 | 1.000 [0.963; 1.000] | 0.740 [0.646; 0.816] | 0.770 [0.678; 0.842] | 0.070 [0.034; 0.137] |
| lotofacil | 1–5 | 0.01 | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 0.250 [0.175; 0.343] |
| lotofacil | 1–5 | 0.05 | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 0.620 [0.522; 0.709] |
| quina | 1–10 | 0.01 | 0.530 [0.433; 0.625] | 0.250 [0.175; 0.343] | 0.250 [0.175; 0.343] | 0.010 [0.002; 0.054] |
| quina | 1–10 | 0.05 | 0.830 [0.745; 0.891] | 0.500 [0.404; 0.596] | 0.500 [0.404; 0.596] | 0.020 [0.006; 0.070] |
| lotomania | 0–9 | 0.01 | 1.000 [0.963; 1.000] | 0.990 [0.946; 0.998] | 0.990 [0.946; 0.998] | 0.010 [0.002; 0.054] |
| lotomania | 0–9 | 0.05 | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 1.000 [0.963; 1.000] | 0.090 [0.048; 0.162] |

Nota: resolução do valor-p MC = 1/(B+1). Todos os números referem-se a dados SINTÉTICOS.

### 15.4. Leitura e comparação com a bateria `shared`
- **FPR com réplicas independentes:** sem correção, a família global (4 testes) rejeita em 16–24% a α=0.05 e a família por dezena (N testes) em 76–98% — inflação esperada por multiplicidade. Com Holm, as taxas familiares a α=0.05 ficam entre 0.030 e 0.060 (global) e 0.040 e 0.050 (por dezena), todos os IC95% contendo 0.05; a α=0.01 e 0.1 o comportamento é análogo (IC contém α ou está abaixo).
- **Comparação a α=0.05 (shared → per_rep):** global Holm: Mega 0.015→0.040, Lotofácil 0.050→0.040, Quina 0.035→0.060, Lotomania 0.070→0.030; por dezena Holm: 0.050→0.040, 0.030→0.050, 0.055→0.045, 0.020→0.045. As conclusões qualitativas (Holm controla a FWER; sem correção há inflação) se mantêm; os números shared exibiam dispersão extra entre modalidades coerente com a dependência da nula comum e **não devem ser lidos como estimativas independentes**. (A família por dezena usa testes binomiais exatos, que não dependem da nula MC; a diferença ali é só de semente.)
- **Poder:** cresce com D e boost; o teste por dezena (Holm) detecta o alvo com mais poder que o Pearson global (ex.: Mega-Sena D=2000, boost 0.5: 1.000 vs 0.830 a α=0.05).
- **"Falso (não-alvo)" no viés de grupo:** com pesos maiores num grupo, as dezenas fora do grupo ficam com probabilidade de inclusão MENOR que k/N, logo H0 também é falsa para elas; essa coluna não é uma taxa de falso positivo (explica 0.62 na Lotofácil, onde 5 de 25 dezenas recebem peso). No viés de 1 dezena o efeito sobre as demais é pequeno, mas também não nulo.

### 15.5. Reprodutibilidade da bateria `per_rep`
Duas execuções em processos Node separados (spawn, em paralelo, diretórios temporários distintos), 45 arquivos idênticos byte a byte — `docs/fase2-evidencias/reprodutibilidade-per-rep.json`:
- run1 sha256 agregado: `b0c09c2d73a1eda4d8c4fdd219724aa3569dfbef367dd608806fbd49a54c00a8`
- run2 sha256 agregado: `b0c09c2d73a1eda4d8c4fdd219724aa3569dfbef367dd608806fbd49a54c00a8`

### 15.6. Verdade sobre a "terceira execução" da bateria `shared`
`reprodutibilidade.json` registra **2 execuções** e não foi alterado. Na revisão complementar foi encontrado o diretório `/tmp/fresh-exp` (54 arquivos, mtime 2026-10-31 19:41:50 −03:00), presumivelmente gerado por `scripts/experimentos-fase2.mjs --out` a partir do clone `/tmp/lotus-fresh` (HEAD 119832977a589d6d99ae7a2241d4ff5565304949). Os sha256 recalculados agora dos 54 arquivos coincidem todos com run1, agregado `c9e41f64eb09a90f30826bc5cf615fe8fc96e92a3c7e1ea5b125bef8552eceb2` — registro em `docs/fase2-evidencias/terceira-execucao-verificacao.json`. **Limite:** os arquivos e hashes são verificáveis, mas não há log que prove o comando/procedência; portanto a evidência formal é: 2 execuções registradas + 1 saída adicional com hashes idênticos verificada a posteriori.

### 15.7. Testes
Suíte completa: 168 testes, 168 passaram (Fase 1: 88; Fase 2: 77 originais + 3 novos `per_rep`). Saída bruta: `docs/fase2-evidencias/test-output-complementar.txt` (o `test-output.txt` original foi preservado).
