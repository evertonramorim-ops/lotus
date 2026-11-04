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
`npm test` (416/416, 0 falhas, 0 skip — 377 de baseline intactos + 32 da 1ª rodada + 7 da auditoria final); `npm run reprodutibilidade:fase3b2` (2 processos distintos, hashes idênticos); `npm run fixtures:fase3b2 -- --check`.

## 10a. Correções da auditoria (PR #4)

Histórico de HEADs: `3099934` = HEAD inicialmente auditado; `ba1af3e` = HEAD da 1ª rodada corretiva (itens 1–6 abaixo); a 2ª rodada (auditoria final, itens 7–8) é o HEAD atual do PR.

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

Observação: o comentário da 1ª linha de `test/fase3b2/import-validation.test.js` ainda cita "V01–V15"; ele pertence aos 377 testes de baseline, que não podem ser editados, e por isso foi mantido.

Limitações preservadas: Quina 380 permanece em quarentena, data não alterada; a coincidência XLSX × JSON **não** prova que a data esteja correta.

## 11. Limitações e riscos
- Completude do histórico não é declarada; XLSX é fonte única oficial disponível, JSON é amostral.
- Semântica de campos econômicos parcialmente hipotética.
- Endpoint público pode mudar/bloquear; nenhum contorno é feito.

## 12. Pendências
Originais DOU de regras históricas; regras pré-2025 por modalidade; fator 0,7 e limiares; divergência de limite de apostas múltiplas da Mega entre Portaria e produto; semântica dos campos econômicos; Quina faixa 2 antes de 4085; tratamento de moeda pré-Real; decisão humana sobre Quina 380.
