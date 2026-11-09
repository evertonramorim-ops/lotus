# LOTUS — Fase 3b.2: Ingestão histórica controlada, reconciliação e preservação

Base: `phase-3a-data-foundation` @ `2218c2b`. Branch: `phase-3b2-historical-import`. Runtime Node 24, ESM, zero dependências.

> Este repositório **não contém dados reais da Caixa**. Fixtures são sintéticas (`SYNTHETIC_DATA_*`). Dados reais ficam fora do git em diretório privado (o script de importação recusa destino dentro de repositório git).

Classificação de conclusões: **A** = verificado por teste/execução; **B** = inferido de evidência estrutural; **C** = hipótese / `RULE_NOT_VERIFIED`.

## 1. Plano de integração / auditoria
- Contratos da 3a reutilizados **sem alteração**: envelope bruto, `createQuarantineEntry`, `buildManifest`/`ManifestLedger`, `validateNumbers`/`validateResultRecord`, `hashJson` (JCS + SHA-256). (A)
- Metadados de coleta ficam num registro separado `lotus.collection` 1.0.0 (ADR-1) em vez de estender o envelope.
- Nenhum teste antigo alterado: baseline 340 → 377 (37 novos). (A)

## 2. Arquitetura
```
bytes XLSX ──captureRaw──► envelope(3a) + lotus.collection
   └─► src/xlsx (ZIP/XML/SST/planilha, com limites)
        └─► historical/extract → normalize (adapters por modalidade)
             └─► validators V01–V10 + V16 (registro) + validateDataset (conjunto)
                  ├─► aceitos → lotus.result (3a)
                  └─► quarentena (3a, motivos agregados por linha, humanDecision=null)
        └─► manifests (encadeados, idempotentes) → FileLedger JSONL write-once
reconcile: JSON servicebus3 × registro XLSX → classes por campo
```
Pipeline determinístico: sem relógio nem aleatoriedade em `src/` (`createdAt`/`runId` são parâmetros). (A)

## 3. Esquema e dicionário de campos
Registro normalizado: `lottery`, `contest` (int), `drawDate` (ISO), `numbers` (ordenados), `tiers[]` (`hits`, `winners` int, `prizeCents` string via BigInt), `economic` (`totalCollected`, `nextPrizeEstimate`, `accumulatedTopTier`, `specialAccumulated` — centavos), `winnerLocations`, `observation`, `source` (sha256 do bruto, planilha, linha). Dinheiro nunca em float. (A)
Relatório de importação: `lotus.import-report` 1.0.0 com contagens, `quarantineReasonCounts`, `annotationCounts`, `coverage` (`completenessClaim: NAO_DECLARADA`).

## 4. Regras de validação (V01–V16)
Cada validador tem `name`, `version`, `rule`. V01 concurso inteiro positivo; V02 data válida; V03 quantidade de dezenas; V04 faixa de dezenas; V05 dezenas únicas; V06 ganhadores inteiro ≥0; V07 valores monetários parseáveis; V08 faixas esperadas para o período (`RULE_NOT_VERIFIED` onde não há norma); V09 '-' tratado como ausência; V10 zero literal anotado; V11 moeda pré-Real anotada; V12 duplicidade idêntica/conflitante; V13 monotonicidade de data (ISOLATED_OUTLIER × PAIR_INVERSION); V14 lacunas de concurso; V15 esquema de colunas (SCHEMA_INESPERADO / ARQUIVO_INCOMPATIVEL); **V16** fórmula em campo mapeado → `FORMULA_EM_CAMPO_HISTORICO` (bloqueante). Detalhes em `src/historical/validators.js`.

## 5. Política de quarentena
Nada é descartado nem corrigido automaticamente. Registro com problema bloqueante vai à quarentena (contrato 3a) com `reviewStatus`, `humanDecision: null` e evidência. Invariante testado: `aceitos + quarentena + duplicados idênticos == normalizados`. (A)

## 6. Preservação do bruto
Bytes originais gravados write-once (`wx`) em `raw/<modalidade>/<sha256>.xlsx` com envelope e registro de coleta; regravação só se idêntico. Ledger JSONL revalidado ao carregar. (A)

## 7. Procedimento de importação local
```
node scripts/importar-historico-fase3b2.mjs --private <DIR_PRIVADO_FORA_DO_GIT> --from-3b1 <dir> [--created-at ISO]
```
Reexecução com mesmo conteúdo → `UNCHANGED_REPLAY`. Mudança → nova sequência encadeada (`chain:previous`).

## 8. Reconciliação XLSX × JSON
```
node scripts/reconciliar-fase3b2.mjs --private <DIR> --plan <plano.json> --fetch --max 50 --delay-ms 6000
```
Limites impostos pelo código (`src/historical/reconcile-fetch.js`): teto absoluto de 50 GET por execução; `--max` só inteiro 1..50; `--delay-ms` só inteiro ≥ 6000; padrões 50/6000; opção inválida recusada antes de qualquer GET. Parada em 403, 429, **primeiro** 5xx, 3xx, erro de rede/timeout e 200 não-JSON; sem retentativa automática. Toda requisição registrada em `request_log.jsonl`.
Classes: `VALOR_INVALIDO` (literal JSON presente mas não interpretável em centavos — nunca tratado como ausência), `EQUIVALENTE`, `DIFERENCA_FORMATACAO`, `DIFERENCA_REPRESENTACAO`, `AUSENTE_EM_UMA_FONTE`, `DIVERGENCIA_REAL`, `DIFERENCA_TEMPORAL`, `SEMANTICA_DESCONHECIDA`.
Tabela de correspondência (`FIELD_CORRESPONDENCE` em `src/historical/reconcile.js`): concurso, data, dezenas, ganhadores/prêmio por faixa, arrecadação e estimativa = `CONFIRMADO_ESTRUTURAL`; acumulado especial e acumulado faixa principal = `HIPOTESE`; ordem de sorteio, `dataProximoConcurso` etc. = `SEM_CORRESPONDENTE`.
Amostras justificadas no plano: primeiro/último concurso, fronteiras de mudança de faixa (Quina 4084/4085, Lotomania 1651–1653), troca de moeda (Quina 28/29, Lotofácil 428/429), anomalia de data (Quina 379–381), reset atípico (Mega 3010), concurso "mais recente".

Resultado (agregado): 37 GET, todos HTTP 200, 0 bloqueios; 54 amostras; **0 DIVERGENCIA_REAL** (A). Quina 380: JSON traz a mesma data do XLSX — anomalia é da própria fonte, mantida em quarentena para decisão humana (A). Quina faixa 2: XLSX traz zero e JSON omite a faixa antes de 4085 → `SEMANTICA_DESCONHECIDA` (C). 2 `DIFERENCA_TEMPORAL` (concurso mais recente publicado após a coleta do XLSX). Evidência agregada: `docs/fase3b2-evidencias/cobertura-agregada.json`.

## 9. ADRs
- ADR-1: contratos 3a inalterados; coleta em registro separado `lotus.collection`.
- ADR-2: '-' = ausência (não zero); registrado em `DIFERENCA_REPRESENTACAO`.
- ADR-3: zero literal preservado e anotado (`ZERO_LITERAL`), nunca inferido como ausência.
- ADR-4: períodos de faixas sem norma localizada = `RULE_NOT_VERIFIED` (anotação, não rejeição).
- ADR-5: manifestos encadeados e idempotentes (chave de conteúdo).
- ADR-6: classes de reconciliação fechadas; só `DIVERGENCIA_REAL` gera quarentena `DIVERGENCIA_JSON_XLSX`.

## 10. Reprodução
`npm test` (552/552, 0 falhas, 0 skip — 377 de baseline intactos + 32 da 1ª rodada + 7 da auditoria final + 11 da auditoria complementar + 125 da auditoria consolidada); `npm run reprodutibilidade:fase3b2` (2 processos distintos, hashes idênticos); `npm run fixtures:fase3b2 -- --check`.

## 10a. Correções da auditoria (PR #4)

Histórico de HEADs: `3099934` = HEAD inicialmente auditado; `ba1af3e` = 1ª rodada corretiva (itens 1–6); `f7287a9` = auditoria final (itens 7–8); `5e049f1` = auditoria complementar (itens 9–10); `5bc2689` = auditoria consolidada (item 11, seção 10b); `f55363f` = código do fechamento consolidado (item 12, seção 10c); o commit de documentação seguinte é o HEAD atual do PR.

### 1ª rodada corretiva (3099934 → ba1af3e)
1. **Limites da reconciliação (bloqueio).** Lógica extraída para `src/historical/reconcile-fetch.js` com `fetch`/`sleep` injetáveis. `parseFetchOptions` aceita apenas inteiros decimais (`--max` 1..50; `--delay-ms` ≥ 6000) e rejeita negativo, zero, decimal, vazio, NaN, Infinity, exponencial, hex e opção repetida antes de qualquer GET (exit 2). `runControlledFetch` revalida as opções, recusa plano maior que o teto e nunca executa mais que `min(max, 50)` requisições; para no primeiro 403/429/5xx/3xx/erro de rede/não-JSON. A política anterior documentada ("5xx repetido") foi substituída pela mais conservadora (primeiro 5xx). Testes: 9 (inclui propriedade com 200 planos aleatórios).
2. **Fórmulas (bloqueio).** O parser guarda `hasFormula` e `formula {expression, type, sharedIndex, sharedRef}`; a extração e a normalização transportam a informação com a referência da célula. Fórmula em campo mapeado gera `formulaCells` no registro e o validador **V16** bloqueia com `FORMULA_EM_CAMPO_HISTORICO` (evidência: ref, coluna, expressão, valor em cache, tipo). Fórmulas nunca são avaliadas; o valor em cache nunca é aceito; bytes brutos inalterados. Fórmulas em colunas desconhecidas ficam em `extras` com `hasFormula`, `formula`, `cachedValue` e origem. Registros sem fórmula não ganham chave nova (hash estável). `VALIDATORS_VERSION` → 1.1.0. Testes: 9 (dezena, concurso, data, prêmio, ganhadores, econômico, parser, coluna desconhecida, estabilidade).
3. **Vínculo envelope × coleta (bloqueio).** `validateCollectionEnvelopeLink(collection, envelope, lottery)` verifica sha256, envelopeSha256, byteLength, url = provenance.sourceId, collectedAt = provenance.obtainedAt, sourceType = provenance.sourceType e modalidade. Falha → `REJECTED` com `INTEGRIDADE_ORIGEM` (`evidence.linkErrors`), zero aceitos. Testes: 8, com adulteração de URL, horário, tipo, tamanho e modalidade **recalculando `collectionSha256`**.
4. **Literais monetários JSON (melhoria).** `decimalLiteralToCents` devolve `invalidReason` e limita literal (64 caracteres), expoente (|e| ≤ 30) e dígitos do resultado (≤ 30) antes de qualquer potência BigInt. `adaptJsonResult` expõe `economicMoney`/`prizeMoney` com `{present, literal, cents, valid, invalidReason}`; valor presente e inválido → classe `VALOR_INVALIDO`. Testes: 6 (0.125, 1e2, 1.5e-3, 1e400, 1e999999999, extremos, custo).
5. **Pré-Real.** Aceitos anteriores a 01/07/1994 recebem `unidadeMonetariaVerificada: false`; na reconciliação, campos monetários desses concursos nunca geram `DIVERGENCIA_REAL` (comportamento refinado no item 8).
6. **Reimportação real (local, privada).** Nova execução anexada ao ledger (linhas anteriores preservadas). Nenhuma fórmula nos 4 arquivos reais; contagens idênticas (3080/3819/7156+1/2994); Quina 380 continua em quarentena com a data original. Manifestos passaram a sequence 2 apenas pela mudança de versão dos validadores e do flag pré-Real.

### 2ª rodada corretiva — auditoria final (a partir de ba1af3e)
7. **VALOR_INVALIDO em faixas (bloqueio).** Em `compareRecords`, a verificação `prizeMoney.present && !prizeMoney.valid` passou a ocorrer sempre que a faixa existe no JSON, antes de qualquer `continue` e também quando o XLSX não tem a faixa. A linha `tier[k].prize` recebe `VALOR_INVALIDO` com `jsonLiteral` e `invalidReason`; a ausência no XLSX continua registrada à parte (`tier[k].winners` `SEMANTICA_DESCONHECIDA` ou `AUSENTE_EM_UMA_FONTE`). Valor inválido nunca vira zero, ausência ou `DIVERGENCIA_REAL`. Campos econômicos já verificavam o valor inválido antes de qualquer outra regra; agora também registram `jsonLiteral`/`invalidReason`.
8. **Pré-Real sem equivalência em centavos (bloqueio).** Antes de 01/07/1994, comparações monetárias (prêmio e econômicos) são **sempre** `SEMANTICA_DESCONHECIDA`, mesmo quando os centavos coincidem, com `unidadeMonetariaVerificada: false`, `xlsxLiteral` e `jsonLiteral`. Sem conversão, fator tributário ou 0,7; nunca `DIVERGENCIA_REAL`. Campos não monetários (concurso, data, dezenas) seguem a comparação normal. Testes: 7 em `audit-final-reconcile.test.js` (5 de regressão das faixas + 2 de pré-Real); 5 deles falham no código de ba1af3e e passam no atual.

### Auditoria complementar (a partir de f7287a9)
9. **Validade monetária nas duas fontes (bloqueio).** Antes de qualquer comparação monetária (`tier[k].prize` e `economic.totalCollected`, `nextPrizeEstimate`, `specialAccumulated`, `accumulatedTopTier`), `compareRecords` verifica a célula XLSX (`moneyFromCell` com `absent:false, valid:false`) e o literal JSON. Qualquer lado inválido → `VALOR_INVALIDO` com `invalidSource` = `XLSX` | `JSON` | `AMBOS` e evidência completa: `xlsxLiteral`, `xlsxRef`, `xlsxColumn`, `xlsxValid`, `xlsxInvalidReason`, `jsonLiteral`, `jsonValid`, `jsonInvalidReason` e `invalidReason` (resumo; em `AMBOS`, "XLSX: …; JSON: …"). Nunca `DIVERGENCIA_REAL`, zero ou ausência. Isso torna seguro que o script de reconciliação inclua registros em quarentena. Faixa no XLSX ausente do JSON mantém a linha de faixa inteira e, se o prêmio XLSX for inválido, marca `xlsxPrizeInvalid` com a mesma evidência.
10. **Ganhadores e prêmio independentes (bloqueio).** Removido o `continue` que descartava a faixa inteira quando um dos campos estava ausente. Quando a faixa existe no JSON, `tier[k].winners` e `tier[k].prize` sempre recebem uma linha própria cada.

Classes finais por campo (faixa listada no JSON):

| Situação | winners | prize / econômico |
|---|---|---|
| inválido em alguma fonte | `VALOR_INVALIDO` (`invalidSource:'XLSX'`) | `VALOR_INVALIDO` com `invalidSource` |
| faixa/coluna inexistente no XLSX | `AUSENTE_EM_UMA_FONTE` | `AUSENTE_EM_UMA_FONTE` (ou `VALOR_INVALIDO` se o JSON for inválido) |
| XLSX ausente ("-"/vazio), JSON com valor | `SEMANTICA_DESCONHECIDA` | prêmio: `SEMANTICA_DESCONHECIDA` (ex.: Quina faixa 2 antes de 4085); econômico: `AUSENTE_EM_UMA_FONTE` |
| ausente nas duas fontes / só no JSON ausente | — / `AUSENTE_EM_UMA_FONTE` | `AUSENTE_EM_UMA_FONTE` |
| dois valores válidos, pré-Real | comparação normal | `SEMANTICA_DESCONHECIDA` (`unidadeMonetariaVerificada:false`) |
| dois valores válidos | `EQUIVALENTE` / `DIVERGENCIA_REAL` | `EQUIVALENTE` / `DIVERGENCIA_REAL` (correspondência HIPÓTESE: `SEMANTICA_DESCONHECIDA` quando diferentes) |

Em pré-Real, linhas monetárias de ausência/invalidade conservam sua classe e recebem `unidadeMonetariaVerificada:false`. Equivalência ou divergência só existe com dois valores válidos e comparáveis. Testes: 11 em `audit-complementar-reconcile.test.js`, dos quais 10 falham no código de f7287a9 (o 11º é regressão das correções anteriores). Dois asserts de `audit-final-reconcile.test.js` (regressão 4) foram ajustados porque descreviam a omissão corrigida: (a) ganhadores válidos com prêmio ausente passam de `SEMANTICA_DESCONHECIDA` a `EQUIVALENTE`, e a linha do prêmio passa a existir (`SEMANTICA_DESCONHECIDA`); (b) faixa só no JSON passa de uma linha `tier[3]` a `tier[3].winners` + `tier[3].prize`, ambas `AUSENTE_EM_UMA_FONTE`. As demais garantias dos 7 testes ficaram intactas.
Reconciliação offline sobre o JSON arquivado (0 requisições): contagem de classes idêntica à rodada anterior. Nas 54 amostras reais nenhum caso se enquadra nos novos cenários.

Observação: o comentário da 1ª linha de `test/fase3b2/import-validation.test.js` ainda cita "V01–V15"; ele pertence aos 377 testes de baseline, que não podem ser editados, e por isso foi mantido.

Limitações preservadas: Quina 380 permanece em quarentena, data não alterada; a coincidência XLSX × JSON **não** prova que a data esteja correta.

## 10b. Auditoria consolidada da reconciliação (a partir de 5e049f1) — reconciliação 1.1.0

11. Redesenho único de `adaptJsonResult`/`compareRecords` (`src/historical/reconcile.js`), e no script de reconciliação o tratamento de concurso JSON inválido. Os itens 7–10 foram mantidos: os testes anteriores passam sem nenhuma alteração.

**Taxonomia (classes de campo)**

| Classe | Semântica |
|---|---|
| `EQUIVALENTE` | dois valores válidos e iguais. Se monetário: regime `POS_REAL` estabelecido |
| `DIVERGENCIA_REAL` | dois valores válidos e diferentes (correspondência CONFIRMADA). Se monetário: regime `POS_REAL`. Única classe que gera quarentena |
| `AUSENTE_EM_UMA_FONTE` | sem valor em ao menos uma fonte e nenhum lado inválido (inclui ausente nas duas; nota explica) |
| `SEMANTICA_DESCONHECIDA` | não há conclusão possível: regime monetário pré-Real/desconhecido, correspondência HIPÓTESE com valores diferentes, XLSX "-" com JSON listando a faixa (ex.: Quina faixa 2 antes de 4085), faixa não listada pelo JSON, estrutura de faixas JSON inutilizável |
| `VALOR_INVALIDO` | **somente monetário**: valor presente mas não interpretável em ≥1 fonte |
| `DADO_INVALIDO` | **estrutural**: concurso, data, dezenas, ganhadores, ordem do sorteio, estrutura de `listaRateioPremio` (não-lista, descrição não mapeada, faixa duplicada, faixa não prevista em `src/lotteries/config.js`) |
| `DIFERENCA_FORMATACAO` | mesmo valor, texto diferente (data d/m/aaaa, espaços) |
| `DIFERENCA_REPRESENTACAO` | representações distintas da mesma informação (faixa "-" no XLSX × não listada; texto × lista) |
| `DIFERENCA_TEMPORAL` | concurso posterior ao último do XLSX |

**Prioridade por campo:** inválido (`VALOR_INVALIDO`/`DADO_INVALIDO`) > ausência > semântica desconhecida (regime, hipótese, estrutura) > comparação. Uma invalidade nunca é escondida por ausência ou por regime. Toda linha inválida tem `invalidSource` (`XLSX`|`JSON`|`AMBOS`) e evidência por fonte: `xlsxPresent`, `xlsxValid`, `xlsxLiteral`, `xlsxRef`, `xlsxColumn`, `xlsxInvalidReason`, `jsonPresent`, `jsonValid`, `jsonLiteral`, `jsonInvalidReason`, `invalidReason`. Regra de presença/validade: ausente → `present:false, valid:null`; válido → `true/true`; inválido → `true/false`.

**Validação estrutural JSON:**
- `numero`: inteiro seguro > 0. Motivos: `NEGATIVO`, `MENOR_QUE_1`, `NAO_INTEIRO`, `TIPO_NAO_NUMERICO`, `FORA_DO_INTEIRO_SEGURO`. Concurso inválido → `DADO_INVALIDO`, e no script status `JSON_DADO_INVALIDO` em vez de ausência.
- `dataApuracao`: ausente/nula, válida, malformada/inexistente (`DATA_MALFORMADA_OU_INEXISTENTE`) ou tipo incorreto (`TIPO_NAO_TEXTO`).
- `listaDezenas`/`dezenasSorteadasOrdemSorteio`: itens preservados, sem `NaN`. Validadas tipo, vazio, inteiro, quantidade = `draw`, intervalo `minNumber..maxNumber` e duplicatas, pelas regras de `src/lotteries/config.js`.
- `numeroDeGanhadores`: inteiro seguro ≥ 0.
- `listaRateioPremio`: ausente/nula → linha `AUSENTE` e faixas sem lado JSON. Não-lista → `DADO_INVALIDO` e faixas `SEMANTICA_DESCONHECIDA`. Entradas não mapeadas/duplicadas/não previstas → linha `DADO_INVALIDO` com elementos originais preservados. Faixa duplicada → `DADO_INVALIDO` nos dois campos (precedência por campo refinada na seção 10c). Com entradas não mapeadas, a falta de uma faixa não é conclusiva (`SEMANTICA_DESCONHECIDA`).

Os mesmos critérios valem para o lado XLSX, inclusive registros em quarentena: data inválida, dezenas inválidas/duplicadas/fora do intervalo e ganhadores inválidos → `DADO_INVALIDO` com origem XLSX.

**Faixas:** para cada faixa da união XLSX ∪ JSON há sempre `tier[k].winners` e `tier[k].prize` próprias. Faixa no XLSX e ausente do JSON mantém ainda a linha de listagem `tier[k]` (`DIFERENCA_REPRESENTACAO`/`SEMANTICA_DESCONHECIDA`, semântica documentada e testes de baseline). Ela não substitui as linhas por campo.

**Regime monetário** (`monetaryRegime`, das duas datas válidas):

| Datas XLSX / JSON | Regime |
|---|---|
| válidas, iguais, < 1994-07-01 | `PRE_REAL_NAO_VERIFICADA` |
| válidas, iguais, ≥ 1994-07-01 | `POS_REAL` |
| ausente/inválida em qualquer lado | `REGIME_MONETARIO_DESCONHECIDO` |
| válidas e diferentes (ou em lados opostos de 01/07/1994) | `REGIME_MONETARIO_DESCONHECIDO` |

Apenas em `POS_REAL` dois valores válidos podem ser `EQUIVALENTE`/`DIVERGENCIA_REAL`. Nos demais regimes eles ficam em `SEMANTICA_DESCONHECIDA`, com literais, datas (`xlsxDrawDate`, `jsonDrawDate`), `monetaryRegime`, `monetaryRegimeReason` e `unidadeMonetariaVerificada:false`. Ausência/invalidade mantêm a classe e recebem os mesmos marcadores. Não há fator 0,7, conversão ou imposto.

Testes: 125 em `audit-consolidada-reconcile.test.js` (matriz monetária 1–10, matriz econômica 4 campos × 4 estados XLSX × 6 estados JSON, estruturais, quarentena, regime e propriedade global com PRNG semeado em 400 iterações). Contra o código de 5e049f1, 71 falham. Os 54 que passam lá são sobretudo combinações econômicas já corretas e casos de comparação válida. Reconciliação offline: classes de 1.0.0 preservadas; as faixas só no XLSX passam a ter linhas por campo (+14 `AUSENTE_EM_UMA_FONTE`, +16 `SEMANTICA_DESCONHECIDA`); 0 inválidos e 0 divergências reais nas amostras reais.

## 10c. Fechamento consolidado da auditoria de reconciliação (a partir de 5bc2689) — reconciliação 1.2.0

12. Revisão única da família "faixas e evidências" em `src/historical/reconcile.js`, extração da classificação do script para `src/historical/reconcile-sample.js` e 15 testes novos em `test/fase3b2/audit-fechamento-reconcile.test.js`. Commit de código: `f55363f`. Nenhum arquivo de teste anterior foi alterado.

**União completa XLSX ∪ JSON.** `adaptJsonResult` passa a expor `tierEntries` (todas as entradas mapeadas, inclusive duplicadas e não previstas, com índice, descrição, literal de `faixa`, ganhadores, prêmio e o elemento original). `tierList.duplicates[]` guarda, além de `hits` e `indexes`, `entries` com índice e elemento original de cada entrada, antes de qualquer exclusão. A união usa as faixas do XLSX e TODAS as faixas de `tierEntries`. Uma faixa duplicada que só existe no JSON não desaparece mais (antes, só entrava na união se também existisse no XLSX). A lista `unrecognized` do resumo `json:listaRateioPremio` passa a considerar também as entradas duplicadas.

**Faixa duplicada: precedência por campo** (`tier[k].winners` e `tier[k].prize` independentes):

| Situação no campo | Classe | `invalidSource` |
|---|---|---|
| prêmio presente e monetariamente inválido (XLSX e/ou qualquer entrada JSON) | `VALOR_INVALIDO` | só o(s) lado(s) com valor inválido |
| ganhadores presentes e inválidos (XLSX e/ou qualquer entrada JSON) | `DADO_INVALIDO` | só o(s) lado(s) com valor inválido |
| valores individualmente válidos, ao menos uma entrada JSON com o campo | `DADO_INVALIDO` (`FAIXA_DUPLICADA_ASSOCIACAO_AMBIGUA`) | `JSON` |
| nenhuma entrada JSON traz o campo | `AUSENTE_EM_UMA_FONTE` | — |

`AMBOS` só aparece quando o valor do XLSX e o de ao menos uma entrada JSON são inválidos naquele campo. A ambiguidade estrutural fica registrada à parte, em `jsonTierIssue {source:'JSON', reasons:['FAIXA_DUPLICADA', …], indexes}`, e nunca apaga a validade individual: `jsonEntries[]` traz, por entrada, `index`, `description`, `faixa`, `hits`, `element` e, para ganhadores e prêmio, `present`, `literal`, `valid` e `invalidReason`. `jsonInvalidReason` identifica a entrada (ex.: `[6] FRACAO_ALEM_DE_CENTAVOS`). A faixa duplicada nunca produz `DIVERGENCIA_REAL`.

**Faixa não prevista para a modalidade** (ex.: Mega-Sena "2 acertos"): as linhas por campo recebem `jsonTierIssue` com `FAIXA_NAO_PREVISTA_NA_MODALIDADE`, além de `jsonEntries` com índice, descrição, literais e validade. Valores inválidos seguem a precedência acima (`VALOR_INVALIDO`/`DADO_INVALIDO`, origem `JSON`). Para valores **válidos** de faixa não prevista presente só no JSON, a classe era `AUSENTE_EM_UMA_FONTE` neste commit. **Resolvido na seção 10d** (regra 2.1 da auditoria integral): `SEMANTICA_DESCONHECIDA`, com as 3 expectativas antigas e a de `tier[2].prize` atualizadas e justificadas.

**Rastreabilidade das dezenas.** Em linha inválida de `numbers`, a evidência passa a transportar `xlsxRefs` (todas as células Bola1..BolaN), `xlsxCells` (`side`, `index`, `ref`, `column`, `raw`, `value`, `absent`, `valid`) e `xlsxInvalidCells`, com as células relevantes e o motivo de cada uma: `CELULA_AUSENTE` (+ `absenceReason`), `CELULA_INVALIDA` (+ `cellInvalidReason`), `FORA_DO_INTERVALO_min_max` (+ `value`) ou `DEZENA_DUPLICADA` (+ `duplicateIndexes`). Do lado JSON, `jsonInvalidItems` traz `index`, `literal` e motivo de cada item. O motivo agregado (`xlsxInvalidReason`/`jsonInvalidReason`) não mudou.

**Caminho do script.** `classifyJsonContest(j)` devolve `JSON_DADO_INVALIDO` (concurso presente e inválido), `JSON_SEM_RESULTADO` (ausente ou nulo) ou `VALIDO`. `reconcileSample({sample, text, jsonSha256, xlsxRecords, meta})` devolve `{status, entry, rows, quarantine}` e trata também `JSON_INVALIDO` (texto não-JSON). As duas funções são puras: não leem disco nem rede. `scripts/reconciliar-fase3b2.mjs` só lê os arquivos, calcula o SHA-256 e delega a decisão. Os testes não precisam da pasta privada.

**Matriz de testes (15):** 1 faixa não prevista só no JSON · 2 duplicada só no JSON (prevista e não prevista) · 3 duplicada nas duas fontes · 4 duplicada com prêmio JSON inválido numa entrada · 5 duplicada com prêmio XLSX inválido · 6 duplicada com ganhadores inválidos (JSON e XLSX) · 7 só uma fonte inválida · 8 ambas inválidas (`AMBOS`) · 9 células exatas em dezenas duplicadas · 10 células exatas fora do intervalo, ausentes ou inválidas, e itens JSON · 11 classificação do script · 12 linha legada `tier[k]` + duas linhas por campo. Invariantes: divergência válida em `POS_REAL` preservada e hipótese econômica nunca diverge; pré-Real intacto em faixa duplicada; propriedade com PRNG semeado (300 iterações): toda faixa da união tem exatamente uma linha `winners` e uma `prize`, inválido/ausente/duplicado nunca diverge, `AMBOS` só com os dois lados inválidos. **Falha-antes:** contra o `reconcile.js` de `5bc2689`, 11 dos 15 falham. Passam lá os casos 7 e 12 e os dois invariantes, que são guardas de regressão.

**Preservação:** `git diff 5bc2689 f55363f -- test/` só mostra o arquivo novo. Os 427 testes anteriores (377 + 32 + 7 + 11) e os 125 da auditoria consolidada estão byte-idênticos. Hashes sintéticos inalterados. Reconciliação offline das 54 amostras já arquivadas, sem rede (`unshare -rn`) e sem nova requisição: 2097 linhas, todas com a mesma classe por campo que na 1.1.0 (`AUSENTE_EM_UMA_FONTE` 1169, `EQUIVALENTE` 850, `SEMANTICA_DESCONHECIDA` 45, `DIFERENCA_REPRESENTACAO` 30, `DIFERENCA_TEMPORAL` 2, `DIFERENCA_FORMATACAO` 1; 0 inválidos, 0 divergências reais). As amostras reais não têm faixa duplicada nem faixa não prevista. `request_log.jsonl` continua com 37 linhas.

## 10d. Auditoria integral e fechamento técnico (a partir de f8f970d) — reconciliação 2.0.0

Commits de código: `3785165` (blocos 2, 3 e 7), `4153e40` (bloco 4), `8b368e8` (bloco 5), `c900c94` (bloco 6), `2c7b2dd` (bloco 8). Nenhuma requisição nova à CAIXA (`request_log.jsonl` segue com 37 linhas); importação real **não** reexecutada; amostra privada não alterada; Quina 380 segue em quarentena.

**Bloco 2 — reconciliação.** Classificação de faixa por `tierStatus` (regra consultada registrada em `tierRule` de **toda** linha de faixa: `ruleSet`, período, `verificationStatus`, `configPrizeTiers`, motivo):

| Situação da faixa | Classe |
|---|---|
| prevista (período verificado que a inclui; ou configuração atual, sem período verificado) | comparação normal (ausência real numa fonte → `AUSENTE_EM_UMA_FONTE`) |
| proibida por período **verificado** | `DADO_INVALIDO` (nenhum período atual é verificado: todos `RULE_NOT_VERIFIED`) |
| fora da configuração atual sem regra histórica comprovada | `SEMANTICA_DESCONHECIDA` (`FAIXA_FORA_DA_CONFIGURACAO_ATUAL_SEM_REGRA_HISTORICA_COMPROVADA`) |
| acertos > dezenas sorteadas | `DADO_INVALIDO` (impossibilidade matemática, separada da incerteza histórica) |
| prêmio inválido / ganhadores inválidos | `VALOR_INVALIDO` / `DADO_INVALIDO` (o valor prevalece) |

`descricaoFaixa`: `^(\d+) acertos?$`, no máximo 15 dígitos e inteiro seguro (sem conversão imprecisa), motivos `DESCRICAO_FAIXA_AUSENTE|_TIPO_NAO_TEXTO|_NAO_RECONHECIDA|ACERTOS_FORA_DO_INTEIRO_SEGURO`; a entrada é preservada em `unmapped` com o elemento fiel. `faixa`: estado `AUSENTE|NULO|PRESENTE`, tipo, literal, validade e motivo; sem intervalo inventado. Duplicatas: comportamento da 10c mantido (ganhadores e prêmio separados; `AMBOS` só com os dois lados inválidos; nenhuma entrada some). `dezenasSorteadasOrdemSorteio`: tipo, quantidade, inteiro seguro, intervalo e duplicata; conjunto diferente de `listaDezenas` → `DADO_INVALIDO` `ORDEM_INCONSISTENTE_COM_LISTA_DEZENAS` (com `onlyInDrawOrder`/`onlyInListaDezenas`); sequência original preservada em `jsonSequence`; Lotomania "00" aceito.

**Bloco 3 — validação independente do JSON (adaptador 2.0.0).** Sem registro XLSX (`x = null`) o JSON é validado por inteiro (rótulo `<registro inexistente no XLSX>`), inclusive com concurso ausente, nulo ou inválido, mapa vazio e concurso posterior. `reconcileSample` distingue `JSON_INVALIDO` (sintaxe/tamanho, `errorKind`) de `JSON_SCHEMA_INVALIDO` (raiz `null`/array/texto/número/booleano, `JsonSchemaError`) e registra `contestState` (`AUSENTE`/`NULO`). O marcador numérico é privado (`WeakSet`): `{"$number":"…"}` do JSON externo é objeto comum (inválido onde se espera número). `maxBytes` conta bytes UTF-8 reais. Campos conhecidos com tipo errado (`tipoJogo`, `observacao`, `listaMunicipioUFGanhadores`, listas, dinheiro) → `DADO_INVALIDO`/`VALOR_INVALIDO`, nunca ausência; sem esquema de elemento inventado. Correspondência `HIPOTESE` → sempre `SEMANTICA_DESCONHECIDA` (`numericCoincidence`/`literalCoincidence` registrados à parte).

**Bloco 4 — importação.** V11 1.1.0: só linhas **elegíveis** (sem problema bloqueante) disputam o concurso; decisão pelo conteúdo completo (`fullContent`: valores, fórmulas, valor e tipo em cache, estado de cada campo, validade); linha inválida nunca descarta a válida e recebe `duplicateContext` na evidência; conflito real entre elegíveis continua `CONCURSO_DUPLICADO_CONFLITANTE`; resultado independente da ordem física. Extração 1.1.0: cabeçalho **mapeado** duplicado → `DUPLICATE_MAPPED_HEADER` bloqueante (`REJECTED`; antes a 2ª coluna era ignorada em silêncio); desconhecido duplicado segue em `extras`. V12 1.1.0: lacunas em intervalos `[{from,to,count}]` (`lotus.gap-ranges/1.0.0`) calculados em O(registros), uma quarentena por intervalo, `expandGapRanges` com limite explícito (`RangeError` acima dele).

**Bloco 5 — manifestos.** `verifyModalityManifest(manifest, imp, collection, rawBytes, {previous | expectedPreviousRootHash, expectedDatasetId, expectedDataSchemaVersion, expectedSequence})` verifica o **conteúdo** via `verifyManifestDetailed`: bytes do XLSX (e coerência com a coleta), coleta, relatório, quarentena, duplicatas e cada registro aceito com hash recalculado de `record`; IDs, kinds, faltantes e extras; `datasetId`, `dataSchemaVersion`, `sequence`; `chain:previous` contra o anterior ou o rootHash esperado. Sem bytes, ou `sequence > 1` sem referência → falha. `scripts/verificar-manifestos-fase3b2.mjs` faz a verificação real somente leitura.

**Bloco 6 — parser XLSX 1.1.0.** `readRels` valida `Id`, `Type`, `Target`, `TargetMode`; Id duplicado; elemento inesperado; alvo inválido (esquema, `//`, `\`, `?`, `#`, diretório) ou fora do pacote (inclusive absoluto com `..`). Relações ambíguas (2+ `officeDocument`/`sharedStrings`); planilhas com nome, `r:id`, `sheetId` ou parte repetidos; `[Content_Types].xml` com Override/Default duplicados, conflitantes ou inválidos. **Toda** parte `.rels` do pacote é validada: relação externa em qualquer parte → `XLSX_EXTERNAL_REL`, **sem exceção permitida**. Nenhuma exceção nativa escapa de `parseXlsx` (`XLSX_ESTRUTURA_INESPERADA`).

**Bloco 7 — plano, caminhos e HTTP.** `validatePlan` roda antes de qualquer GET (chaves exatas `lottery`/`contest`/`justification`; modalidade permitida; `contest` null ou inteiro seguro > 0; justificativa de 1–500 caracteres sem controle; item repetido recusado; cópias congeladas). `safeRelativePath`/`safeJoin` recusam `..`, absoluto, `\`, NUL, `:` e segmento vazio; amostras do log só com URL validada e caminho no subdiretório previsto (linha adulterada → `rejectedLogLines`, nunca lida). Corpo HTTP limitado a `MAX_BODY_BYTES` (= limite do parser JSON) por `Content-Length` e por leitura em fluxo → parada `RESPOSTA_GRANDE_DEMAIS`, corpo descartado.

**Bloco 8 — testes.** 59 testes novos em `audit-integral-{reconcile,fetch-paths,import,manifest,xlsx,invariantes}.test.js` (sintéticos, offline, 4 modalidades, PRNG semeado + Fisher–Yates; o `sort(() => rnd() - 0.5)` antigo foi substituído). Falha-antes contra `f8f970d`: 49 de 59. Os 13 invariantes têm um teste cada.

**Testes antigos com expectativa alterada** (justificativa no próprio teste, marcador `[3b.2-integral …]`): `audit-complementar` 9; `audit-final` regressões 3 e 4; `audit-consolidada` `listaRateioPremio` (`tier[2].prize`) — regra 2.1 (faixa fora da configuração sem regra comprovada não é ausência). `audit-consolidada` econômico `accumulatedTopTier`/`specialAccumulated` "XLSX valido × JSON valido" — regra 3.5. `audit-fechamento` 1, 2, 10, 11 — formas de evidência (motivo renomeado, estado/tipo, serialização fiel, JSON sem concurso validado). `import-validation` V12 — formato de lacunas. `manifest-preservation` (2 testes) — `res.bytes` não existia e a adulteração era só do hash declarado. Fases anteriores (base 3a, baseline): nenhum teste alterado.

**Versões** (só mudanças incompatíveis): reconciliação 1.2.0 → **2.0.0** e adaptador JSON 1.0.0 → **2.0.0** (classes e formato de evidência mudaram); validadores 1.1.0 → **1.2.0** (V11 e V12 1.1.0); relatório de importação 1.0.0 → **2.0.0** (`coverage.missing` → `missingRanges` + `missingCount`); extração 1.0.0 → **1.1.0**; parser XLSX 1.0.0 → **1.1.0**. Inalterados: `lotus.historical-draw` 1.0.0 (registro aceito), `lotus.manifest` 1.0.0, regras de faixa 1.0.0. Manifestos existentes não foram tocados; uma reimportação geraria `sequence 3` (mudariam o relatório — versão, `coverage`, `ignoredParts`, tags de validadores/parser — e, em cada registro aceito, somente `source.parserVersion` 1.0.0 → 1.1.0; as células lidas são idênticas e os dados reais não têm duplicatas, lacunas nem alertas de esquema, logo nenhuma classificação de importação mudaria), o que **não** foi feito.

**Execução final** (clone limpo, `unshare -rn`, Node v24.22.1, npm 11.21.1): `npm test` 626/626, 0 skip; reprodutibilidade idêntica em 2 processos (logical `6ac44b89…5b51`, run root `a25cfe76…e465`; mudaram em relação a `7ca43692…`/`4602d296…` pelas versões e campos novos); fixtures idênticas. Manifestos reais: 12/12 verificados contra o conteúdo (3 execuções × 4 modalidades; sequence 2 encadeada ao 1). Parser 1.1.0 nos 4 XLSX reais: células idênticas ao 1.0.0; nenhuma relação externa.

**Reconciliação offline 2.0.0** (54 amostras arquivadas, rede desabilitada): 2097 → 2175 linhas. EQUIVALENTE 850 → 736 · AUSENTE 1169 → 1274 · SEMANTICA 45 → 155 · REPRESENTACAO 30 → 7 · TEMPORAL 2 · FORMATACAO 1 · DIVERGENCIA/VALOR_INVALIDO/DADO_INVALIDO 0. Mudanças: `specialAccumulated` EQUIVALENTE → SEMANTICA (38) e `accumulatedTopTier` (49) — HIPOTESE; `winnerLocations` REPRESENTACAO → SEMANTICA (23) e EQUIVALENTE → AUSENTE (29, ambos vazios); 78 linhas novas nas 2 amostras sem registro XLSX (Lotofácil 3820, Quina 7158), agora validadas por inteiro (76 AUSENTE, 2 EQUIVALENTE). Nenhuma linha removida; nenhuma faixa fora da configuração; as 54 ordens de sorteio coerentes com `listaDezenas`. Estados: ACEITO 51 · AUSENTE 2 · QUARENTENA 1 (Quina 380).

## 11. Limitações e riscos
- Completude do histórico não é declarada; XLSX é fonte única oficial disponível, JSON é amostral.
- Semântica de campos econômicos parcialmente hipotética.
- Endpoint público pode mudar/bloquear; nenhum contorno é feito.

## 12. Pendências
Originais DOU de regras históricas; regras pré-2025 por modalidade; fator 0,7 e limiares; divergência de limite de apostas múltiplas da Mega entre Portaria e produto; semântica dos campos econômicos; Quina faixa 2 antes de 4085; tratamento de moeda pré-Real; decisão humana sobre Quina 380; regras históricas **verificadas** de faixas por período (enquanto todos os períodos forem `RULE_NOT_VERIFIED`, faixas fora da configuração atual permanecem `SEMANTICA_DESCONHECIDA`, seção 10d); decisão sobre reimportar com os novos formatos (geraria manifestos sequence 3). A contradição da seção 10c foi resolvida na 10d.
