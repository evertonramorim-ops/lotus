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
             └─► validators V01–V15 (registro) + validateDataset (conjunto)
                  ├─► aceitos → lotus.result (3a)
                  └─► quarentena (3a, motivos agregados por linha, humanDecision=null)
        └─► manifests (encadeados, idempotentes) → FileLedger JSONL write-once
reconcile: JSON servicebus3 × registro XLSX → classes por campo
```
Pipeline determinístico: sem relógio nem aleatoriedade em `src/` (`createdAt`/`runId` são parâmetros). (A)

## 3. Esquema e dicionário de campos
Registro normalizado: `lottery`, `contest` (int), `drawDate` (ISO), `numbers` (ordenados), `tiers[]` (`hits`, `winners` int, `prizeCents` string via BigInt), `economic` (`totalCollected`, `nextPrizeEstimate`, `accumulatedTopTier`, `specialAccumulated` — centavos), `winnerLocations`, `observation`, `source` (sha256 do bruto, planilha, linha). Dinheiro nunca em float. (A)
Relatório de importação: `lotus.import-report` 1.0.0 com contagens, `quarantineReasonCounts`, `annotationCounts`, `coverage` (`completenessClaim: NAO_DECLARADA`).

## 4. Regras de validação (V01–V15)
Cada validador tem `name`, `version`, `rule`. V01 concurso inteiro positivo; V02 data válida; V03 quantidade de dezenas; V04 faixa de dezenas; V05 dezenas únicas; V06 ganhadores inteiro ≥0; V07 valores monetários parseáveis; V08 faixas esperadas para o período (`RULE_NOT_VERIFIED` onde não há norma); V09 '-' tratado como ausência; V10 zero literal anotado; V11 moeda pré-Real anotada; V12 duplicidade idêntica/conflitante; V13 monotonicidade de data (ISOLATED_OUTLIER × PAIR_INVERSION); V14 lacunas de concurso; V15 esquema de colunas (SCHEMA_INESPERADO / ARQUIVO_INCOMPATIVEL). Detalhes em `src/historical/validators.js`.

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
Limite rígido ≤50 GET, intervalo ≥6 s, toda requisição registrada em `request_log.jsonl`, parada em 403/429/resposta não-JSON.
Classes: `EQUIVALENTE`, `DIFERENCA_FORMATACAO`, `DIFERENCA_REPRESENTACAO`, `AUSENTE_EM_UMA_FONTE`, `DIVERGENCIA_REAL`, `DIFERENCA_TEMPORAL`, `SEMANTICA_DESCONHECIDA`.
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
`npm test` (377/377, 0 falhas, 0 skip); `npm run reprodutibilidade:fase3b2` (2 processos distintos, hashes idênticos); `npm run fixtures:fase3b2 -- --check`.

## 11. Limitações e riscos
- Completude do histórico não é declarada; XLSX é fonte única oficial disponível, JSON é amostral.
- Semântica de campos econômicos parcialmente hipotética.
- Endpoint público pode mudar/bloquear; nenhum contorno é feito.

## 12. Pendências
Originais DOU de regras históricas; regras pré-2025 por modalidade; fator 0,7 e limiares; divergência de limite de apostas múltiplas da Mega entre Portaria e produto; semântica dos campos econômicos; Quina faixa 2 antes de 4085; tratamento de moeda pré-Real; decisão humana sobre Quina 380.
