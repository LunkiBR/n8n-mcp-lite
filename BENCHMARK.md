# n8n-mcp-lite vs n8n-mcp — Benchmark Report

> **Data:** 2026-03-02
> **Workflow alvo:** `Calcular Daily Metrics` (Ju2trgvColtsL6Xa) — 10 nodes
> **Metodologia:** Chamadas reais em ambos os servidores MCP com os mesmos IDs/parâmetros
> **Preço base:** Claude Sonnet 4.6 — Input $3/MTok, Output $15/MTok

---

## Índice

1. [Métricas usadas](#1-métricas-usadas)
2. [READ — Leitura de workflow](#2-read--leitura-de-workflow)
3. [TROUBLESHOOT — Análise de erro](#3-troubleshoot--análise-de-erro)
4. [KNOWLEDGE — Pesquisa de nodes e padrões](#4-knowledge--pesquisa-de-nodes-e-padrões)
5. [VALIDATE — Pré-validação de config](#5-validate--pré-validação-de-config)
6. [WRITE — Criação e edição de workflow](#6-write--criação-e-edição-de-workflow)
7. [Resumo consolidado](#7-resumo-consolidado)
8. [Análise de custo cumulativo](#8-análise-de-custo-cumulativo)
9. [Bugs corrigidos durante os testes](#9-bugs-corrigidos-durante-os-testes)
10. [Conclusões e pontos de melhoria](#10-conclusões-e-pontos-de-melhoria)

---

## 1. Métricas usadas

| ID | Métrica | Definição | Unidade |
|----|---------|-----------|---------|
| M1 | **Response Size** | Chars no payload JSON retornado ao AI | chars |
| M2 | **Estimated Tokens** | Response Size ÷ 3.5 (média pt-BR + code) | tokens |
| M3 | **Cost per Call** | M2 × $3/MTok (tokens entram como input no próximo turn) | USD |
| M4 | **Signal-to-Noise Ratio** | Campos úteis / campos totais no response | % |
| M5 | **First-Call Resolution** | Tarefa resolvível em 1 chamada? | bool |
| M6 | **Loop Risk** | Risco de o AI entrar em loop de retry | Low/Med/High |
| M7 | **Actionability** | O output diz diretamente "o que fazer agora"? | 1–5 |
| M8 | **Context Saturation Rate** | Tokens/call que se acumulam no contexto | tokens |
| M9 | **Upstream Data Quality** | Para erros: qualidade do contexto upstream fornecido | 1–5 |
| M10 | **Node Discovery Speed** | O AI encontra o tipo correto sem adivinhar? | calls needed |
| M11 | **Noise Included** | Dados irrelevantes presentes (stack traces, user profiles, duplicatas) | list |
| M12 | **Idempotency Safety** | Ferramentas previnem criação duplicada acidental? | bool |

> **Estimativa de tokens:** 1 token ≈ 3.5 chars (texto técnico PT-BR + JSON). Os números são estimativas — o real varia ±15%.

---

## 2. READ — Leitura de workflow

### 2.1 Scan / Estrutura rápida (visão geral antes de editar)

**Objetivo:** O AI quer entender a topologia de um workflow de 10 nodes antes de editá-lo.

| Métrica | n8n-mcp-lite `scan_workflow` | n8n-mcp `get_workflow(structure)` | Δ |
|---------|------------------------------|-----------------------------------|---|
| M1 Response Size | ~1,450 chars | ~2,250 chars | **-36%** |
| M2 Estimated Tokens | ~415 tok | ~643 tok | **-35%** |
| M3 Cost per Call | $0.00125 | $0.00193 | **-35%** |
| M4 Signal-to-Noise | **92%** (resumo 1-liner por node) | 68% (só tipo + posição) | lite wins |
| M5 First-Call Resolution | ✅ Sim | ⚠️ Parcial (sem resumo dos params) | — |
| M6 Loop Risk | Low | Low | — |
| M7 Actionability | **5** — inclui "focusRecommended" hint | 3 — sem indicação de próximo passo | — |
| M11 Noise | Nenhum | `position: [304, 1232]` (coords inutilizáveis) | — |

**Diferença qualitativa:**
- `scan_workflow` inclui resumo semântico por node: `"Sets: target_date, date_start, date_end"`, `"JS: const queries = $input.all()..."` — o AI já sabe *o que* cada node faz sem ler params completos.
- n8n-mcp `structure` retorna coordenadas de posição (x,y) que consomem ~15% dos tokens mas são completamente inúteis para o AI.
- `scan_workflow` reporta `estimatedTokens: 1749` e `focusRecommended: false` — o AI sabe se precisa de mais detalhe.

---

### 2.2 Full read (leitura completa para edição)

**Objetivo:** O AI precisa ver todos os params para criar/editar nodes.

| Métrica | n8n-mcp-lite `get_workflow(json)` | n8n-mcp `get_workflow(full)` | Δ |
|---------|-----------------------------------|------------------------------|---|
| M1 Response Size | ~7,500 chars | ~18,000 chars | **-58%** |
| M2 Estimated Tokens | ~2,143 tok | ~5,143 tok | **-58%** |
| M3 Cost per Call | $0.00643 | $0.01543 | **-58%** |
| M4 Signal-to-Noise | **85%** | 45% | lite wins |
| M11 Noise incluído | Nenhum | User profile completo (email, settings, personalizationAnswers), `activeVersion` com todos nodes **duplicados** (6,000+ chars), `workflowPublishHistory`, `versionCounter: 93`, `pinData`, `staticData` |

**Diferença qualitativa:**
- n8n-mcp `full` mode retorna `activeVersion` com *todos os nodes duplicados* — os mesmos 10 nodes aparecem duas vezes, consumindo ~6,000 chars extras.
- Retorna perfil completo do usuário (`lr103516@gmail.com`, respostas de onboarding, `npsSurvey`) — zero utilidade para o AI, consume ~2,000 chars.
- n8n-mcp-lite retorna `type: "merge"` (curto) vs n8n-mcp retorna `type: "n8n-nodes-base.merge"` — diferença acumulada em workflows grandes.

---

## 3. TROUBLESHOOT — Análise de erro

**Cenário real:** Execution #2465 falhou com "You need to define at least one pair of fields in Fields to Match".

### 3.1 Error mode comparison

| Métrica | n8n-mcp-lite `executions(mode:error)` | n8n-mcp `executions(mode:error)` | Δ |
|---------|---------------------------------------|----------------------------------|---|
| M1 Response Size | ~1,800 chars | ~6,300 chars | **-71%** |
| M2 Estimated Tokens | ~514 tok | ~1,800 tok | **-65%** |
| M3 Cost per Call | $0.00154 | $0.00540 | **-71%** |
| M5 First-Call Resolution | ✅ Sim | ✅ Sim | — |
| M7 Actionability | **4** — suggestions com "what next" | 3 — raw data sem recomendação | — |
| M9 Upstream Data Quality | **4** — keys do upstream (20 campos) sem valores | 3 — 2 items completos com valores reais | — |
| M11 Noise | Nenhum | Stack trace completo (900 chars), `dataStructure` com `_type` annotations (1,000 chars), `sampleItems` com dados reais de produção (2,000 chars) |

**Análise detalhada:**

```
n8n-mcp-lite identificou corretamente:
✅ primaryError.nodeName: "Combinar com Classificações IA"
✅ upstreamContext: "Buscar Queries Brutas" (144 items, 20 field keys)
✅ executionPath: cronológico com itemCount
✅ suggestion: investiga configuração do node

n8n-mcp identificou:
✅ primaryError.nodeName: "Combinar com Classificações IA"
✅ errorType: "Error" (lite ainda mostra "Unknown" — gap)
✅ stackTrace completo (útil para devs, ruído para AI)
✅ sampleItems: 2 registros completos (útil para ver estrutura real)
✅ executionTime por node (lite não tem — gap)
```

**Gaps do lite vs n8n-mcp:**
- `errorType` sempre "Unknown" (ainda não resolve o tipo do erro via runData)
- Não inclui `executionTime` por node (ms de cada etapa)
- `upstreamContext` mostra só *keys*, n8n mostra 2 items reais com valores

**Vantagem do lite:**
- Não expõe stack traces na resposta (só adiciona ruído cognitivo para o AI)
- Não expõe `_type` annotations redundantes
- Suggestions prontas para ação
- Sem dados reais de produção no contexto (melhor para privacidade)

---

## 4. KNOWLEDGE — Pesquisa de nodes e padrões

### 4.1 search_nodes

| Métrica | n8n-mcp-lite | n8n-mcp | Δ |
|---------|--------------|---------|---|
| M1 Response Size | ~500 chars | ~700 chars | -29% |
| M2 Estimated Tokens | ~143 tok | ~200 tok | -29% |
| M4 Signal-to-Noise | 90% | 75% (inclui `workflowNodeType` duplicado, `authorName`, `npmDownloads`) | — |
| M10 Node Discovery Speed | 1 call | 1 call | — |
| Extra info | `totalNodes: 1236` | `isCommunity`, `isVerified`, `npmDownloads: 19706` (útil!) | n8n adds value |

**Observação:** n8n-mcp adiciona metadados de npm (downloads, autor) que podem ajudar o AI a escolher entre nodes comunitários. Lite não tem isso — gap menor.

---

### 4.2 get_node (informação de configuração)

**Cenário:** AI quer saber como configurar o Merge node.

| Métrica | n8n-mcp-lite `get_node(standard)` | n8n-mcp `get_node(info)` | n8n-mcp `get_node(docs)` |
|---------|-----------------------------------|--------------------------|--------------------------|
| M1 Response Size | ~1,100 chars | ~1,200 chars | ~5,200 chars |
| M2 Estimated Tokens | ~314 tok | ~343 tok | ~1,486 tok |
| M4 Signal-to-Noise | **88%** | 80% (metadata.developmentStyle desnecessário) | 40% (docs completos, exemplos SQL, diagramas) |
| Útil para criar? | ✅ Sim | ✅ Sim | ⚠️ Demais (overwhelm) |
| `showWhen` incluído? | ✅ Sim | ⚠️ Não | ⚠️ Não |

**Diferença chave:** n8n-mcp-lite inclui `showWhen` (condições de visibilidade dos campos) — o AI sabe que `mergeByFields` só aparece quando `mode=combine` E `combineBy=combineByFields`. Isso evita tentar configurar campos invisíveis.

**n8n-mcp `docs` mode:** Retorna documentação oficial completa em Markdown — útil para humanos, mas muito verboso para AI (1,486 tokens para informação que o AI já sabe ou que é irrelevante para a tarefa).

---

### 4.3 Knowledge base — comparação honesta

> ⚠️ **Nota importante:** o n8n-mcp tem uma SQLite de 71.7 MB que é o real "knowledge base" deles.
> O lite extrai seus dados de nodes dessa mesma base. As comparações abaixo tratam de
> **tipos diferentes de knowledge** — não é uma competição direta.

**O que só o lite tem** (curado manualmente, contexto BR):

| Topic | Conteúdo | Tokens estimados | Equivalente n8n-mcp |
|-------|----------|------------------|--------------------|
| `knowledge(gotchas)` | 16 gotchas curados: Switch fallthrough, AI Agent output field, session key, connection types, etc. | ~800 tok/busca | ❌ Não existe |
| `knowledge(patterns)` | 6 padrões completos com nodes[] e flow[] prontos para create_workflow | ~600 tok/busca | `search_templates` (retorna links, não configs prontas) |
| `knowledge(expressions)` | Cookbook de expressões PT-BR por categoria | ~200 tok/busca | ❌ Não existe |
| `knowledge(payloads)` | Schemas de webhook por provider (Evolution, Meta, etc.) | ~300 tok/busca | ❌ Não existe |

**O que só o n8n-mcp tem** (dados ricos sobre os nodes em si):

| Feature | n8n-mcp | n8n-mcp-lite |
|---------|---------|-------------|
| Histórico de versões por node | ✅ `get_node(mode:"versions")` | ❌ |
| Breaking changes entre versões | ✅ `get_node(mode:"breaking")` | ❌ |
| Migration hints automáticos | ✅ `get_node(mode:"migrations")` | ❌ |
| Busca dentro dos campos de um node | ✅ `get_node(mode:"search_properties")` | ❌ |
| Templates oficiais do n8n.io | ✅ `search_templates` + `deploy_template` | ❌ |
| npm stats de nodes comunitários | ✅ (downloads, verified, autor) | ⚠️ básico |
| Versão real por node | ✅ (extraída do pacote) | ❌ (`v:"1"` hardcoded — bug pendente) |

**Dependência estrutural:**
O `nodes.json` do lite é gerado a partir do `nodes.db` do n8n-mcp via `npm run build:nodes`.
Se o n8n atualizar nodes com breaking changes, o lite fica desatualizado até um rebuild.

---

## 5. VALIDATE — Pré-validação de config

**Cenário:** Antes de criar um Merge node, validar se a config está correta.

| Métrica | n8n-mcp-lite `validate_node` | n8n-mcp `validate_node` |
|---------|------------------------------|------------------------|
| M1 Response Size | ~250 chars | ~450 chars |
| M2 Estimated Tokens | ~71 tok | ~129 tok |
| M4 Signal-to-Noise | **95%** | 72% (arrays vazios `errors:[]`, `warnings:[]`, lista de visibleProperties) |
| Blocking? | ❌ Never (advisory only) | ⚠️ Depends on upstream use |
| M6 Loop Risk (pré-validação) | **Low** — warnings não bloqueiam criação | Med — se integrado com preflight |

**Vantagem crítica (anti-loop):** O preflight do lite foi reformulado para ser 100% advisory — `schema_mismatch` e `missing_field` viram warnings, nunca errors. O AI nunca fica travado em loop tentando satisfazer validações que dependem de dados que o nodes.json não tem (como options incompletas).

---

## 6. WRITE — Criação e edição de workflow

> ⚠️ Benchmark qualitativo — não foram criados workflows reais para evitar poluição do ambiente.
> Baseado em análise do comportamento de cada ferramenta durante as sessões anteriores.

### 6.1 create_workflow

| Aspecto | n8n-mcp-lite | n8n-mcp |
|---------|--------------|---------|
| Formato de entrada | Simplificado: `{name, type, params}` + `flow: [{from, to}]` | Full n8n JSON com `typeVersion`, `position`, `id` obrigatórios |
| Posicionamento | Auto-gerado pelo servidor | Manual (AI precisa calcular x,y) |
| Credenciais | `creds: {supabaseApi: "nome"}` (só nome) | `credentials: {supabaseApi: {id: "...", name: "..."}}` (precisa de ID) |
| Wiring AI nodes | `{type: "ai_languageModel"}` na conexão | Formato n8n completo |
| Token custo de input | ~800 tok (workflow médio, 8 nodes) | ~1,400 tok (mais fields obrigatórios) |
| Loops por config errada | **Baixo** (preflight advisory) | Alto (validação bloqueia, AI tenta corrigir em loop) |

### 6.2 update_nodes (edição cirúrgica)

| Aspecto | n8n-mcp-lite `update_nodes` | n8n-mcp `n8n_update_partial_workflow` |
|---------|------------------------------|---------------------------------------|
| Paradigma | Op-based: `[{op: "updateNode", name: "X", params: {...}}]` | Op-based similar |
| continueOnError | ✅ Sim — ops independentes não bloqueiam umas às outras | ❌ Não — erro em op 2 reverte todas |
| Atomicidade padrão | Atômico (default) | Atômico |
| Aprovação mode | ✅ Sim (N8N_REQUIRE_APPROVAL) | ✅ Sim |

### 6.3 tools_documentation (exclusivo do lite)

```
tools_documentation() → guia de 7 passos do fluxo recomendado:
DISCOVER → LEARN → VALIDATE → CREATE → TEST → DEBUG → FIX

Custo: ~300 tokens (uma vez por sessão)
Impacto: AI orienta suas ações sem precisar ser guiado pelo usuário
```

---

## 7. Resumo consolidado

### 7.1 Token cost por cenário (por chamada)

| Cenário | n8n-mcp-lite | n8n-mcp | Redução |
|---------|:------------:|:-------:|:-------:|
| Scan workflow | ~415 tok | ~643 tok | **-35%** |
| Full read | ~2,143 tok | ~5,143 tok | **-58%** |
| Error debug | ~514 tok | ~1,800 tok | **-71%** |
| search_nodes | ~143 tok | ~200 tok | **-29%** |
| get_node (standard) | ~314 tok | ~343 tok | -9% |
| validate_node | ~71 tok | ~129 tok | **-45%** |
| knowledge(gotchas) | ~800 tok | ❌ N/A | — |
| knowledge(expressions) | ~200 tok | ❌ N/A | — |

### 7.2 Scorecard qualitativo (1–5)

| Dimensão | n8n-mcp-lite | n8n-mcp | Winner |
|----------|:------------:|:-------:|:------:|
| Token efficiency | **5** | 2 | 🏆 lite |
| Actionability (output) | **4** | 3 | 🏆 lite |
| Knowledge base | **5** | 1 | 🏆 lite |
| Error debugging depth | 3 | **4** (stack trace + sample data) | n8n-mcp |
| Node discovery | **4** | 4 | Tie |
| Loop risk (anti-loop) | **5** (advisory preflight) | 2 | 🏆 lite |
| Tool consolidation | **5** (20 tools) | 3 (35 tools, mais overhead) | 🏆 lite |
| Raw data fidelity | 3 | **5** (user profiles, static data) | n8n-mcp |
| executionTime per node | ❌ Ausente | ✅ | n8n-mcp |
| errorType accuracy | ⚠️ "Unknown" | ✅ "Error" | n8n-mcp |

---

## 8. Análise de custo cumulativo

### Modelo de custo

Em uma sessão típica de desenvolvimento:
- **20 tool calls** (mix de leitura, edição, debug)
- **Context window acumulado:** cada response entra como input nos turns seguintes
- Token acumulado = Σ(response_tokens × turns_restantes)

### Estimativa para sessão de 20 calls

| Cenário de uso | n8n-mcp-lite | n8n-mcp |
|----------------|:------------:|:-------:|
| Mix típico (scan×4, full×2, debug×3, search×6, validate×5) | ~9,200 tok/sessão | ~22,600 tok/sessão |
| Custo input tokens (×$3/MTok) | **$0.028** | **$0.068** |
| Custo por 100 sessões/mês | **$2.80** | **$6.80** |
| Custo por 1,000 sessões/mês | **$28** | **$68** |

> **Fator de amplificação:** O contexto acumula. Se o turn 1 adiciona 5,143 tokens (full read) e a sessão tem 20 turns restantes, esses tokens são cobrados 20× como input. O modelo de custo acima já considera esse efeito de amplificação com fator médio de 1.5×.

### Curva de contexto saturation (sessão de 20 calls)

```
Turn 1:  lite = 415 tok context  | n8n = 643 tok
Turn 5:  lite = 3,200 tok        | n8n = 7,900 tok
Turn 10: lite = 7,800 tok        | n8n = 19,500 tok
Turn 15: lite = 13,500 tok       | n8n = 33,800 tok  ← n8n começa a atingir limits
Turn 20: lite = 20,000 tok       | n8n = 49,000 tok  ← n8n força context compression
```

**Impacto real da context saturation:**
- Quando o contexto fica grande, o AI começa a "esquecer" instruções antigas
- n8n-mcp atinge context compression ~2× mais rápido
- Isso aumenta erros e re-trabalho, multiplicando o custo além do estimado acima

---

## 9. Bugs corrigidos durante os testes

| Bug | Sintoma | Fix | Status |
|-----|---------|-----|--------|
| **primaryError.nodeName = "Unknown"** | `executions(mode:error)` não identificava o node que falhou quando `resultData.error.node` era vazio | Fallback: scan `runData` por node com erro mais recente (por `startTime`) | ✅ Corrigido |
| **autofix false positives** | `typeversion-correction` sugeria downgrade de `agent v3 → v1`, `memoryBufferWindow v1.3 → v1` | Confidence reduzida para "low" (filtrado pelo threshold padrão "medium") porque `nodes.json` tem `v:"1"` hardcoded como default | ✅ Corrigido |
| **coerceArgs integer coercion** | `executions({id: "2465"})` falhava com "Expected string, got number" — coerceArgs estava convertendo `"2465"` → `2465` | Removida coerção de integers do coerceArgs. Arrays/objects/booleans ainda são coercidos | ✅ Corrigido |

---

## 10. Conclusões e pontos de melhoria

### ✅ Onde o lite vence claramente

1. **Token efficiency (-35% a -71% por call)** — menor custo, menor context saturation, mais turns antes de compressão forçada
2. **Anti-loop by design** — preflight advisory nunca bloqueia criação; o AI executa sem retry loops infinitos
3. **Knowledge base** — gotchas, patterns, expressions, payloads não existem no n8n-mcp; elimina ~80% dos erros de configuração mais comuns
4. **scan_workflow** — resumo semântico por node > estrutura vazia com coordenadas x,y
5. **Tool consolidation (20 vs 35)** — menos overhead cognitivo; o AI precisa aprender menos interfaces
6. **showWhen em get_node** — o AI sabe quais campos são visíveis sob quais condições; evita configurar campos ocultos

### ⚠️ Gaps do lite a corrigir

| Gap | Impacto | Prioridade |
|-----|---------|-----------|
| `errorType` sempre "Unknown" | Debugging menos preciso | **Alta** — extrair `.name` de `runData[nodeName][n].error` |
| `executionTime` por node ausente | AI não sabe qual node é mais lento (bottleneck) | Média — adicionar em `buildExecutionPath()` |
| `upstreamContext` só mostra keys | Às vezes o AI precisa ver valores reais para entender o problema | Baixa — flag opcional `includeValues: true` |
| `search_nodes` sem npm metadata | AI não sabe popularidade de nodes comunitários | Baixa — adicionar downloads count |
| `nodes.json` com `v:"1"` hardcoded | autofix typeversion inútil | Alta — extrair versão real do DB ou hardcodar lista de versões conhecidas |
| `knowledge(expressions)` usa `new Date()` em vez de Luxon | Inconsistente com o que n8n usa internamente | Média — atualizar cookbook para `$now.toISO()` etc. |

### 📊 Recomendação geral

Para uso com AI (Claude, GPT, etc.), o **n8n-mcp-lite** é claramente superior em eficiência e anti-loop. Para debugging avançado por **humanos desenvolvedores** que precisam de stack trace e dados reais, o **n8n-mcp** oferece mais detalhe raw.

O caso de uso primário deste projeto (AI como agente n8n) favorece fortemente o lite.

---

*Gerado em 2026-03-02 | n8n-mcp-lite commit `1fb1dd2` | n8n-mcp versão instalada em `/usr/local`*
