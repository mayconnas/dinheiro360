# Mapa da arquitetura

Como o Gestor Financeiro 360 funciona de ponta a ponta: quem fala com quem, como o Supabase é usado, por onde entram os lançamentos do banco, onde a IA participa e como o código chega à produção. Os diagramas são Mermaid e refletem o código deste repositório.

- [1. Visão geral](#1-visão-geral)
- [2. Ciclo de uma requisição](#2-ciclo-de-uma-requisição)
- [3. Supabase por dentro](#3-supabase-por-dentro)
- [4. Open Finance (Pluggy)](#4-open-finance-pluggy)
- [5. A esteira de um lançamento](#5-a-esteira-de-um-lançamento)
- [6. Inteligência artificial](#6-inteligência-artificial)
- [7. CI/CD e deploy](#7-cicd-e-deploy)
- [8. Stacks](#8-stacks)

---

## 1. Visão geral

```mermaid
flowchart TB
    U(["Usuário · navegador"])

    subgraph VPS["VPS · Docker Swarm"]
        T["Traefik<br/>HTTPS + Let's Encrypt"]
        subgraph APP["Container Next.js 15"]
            direction LR
            MW["Middleware<br/>sessão e rotas protegidas"]
            RSC["Server Components<br/>páginas"]
            SA["Server Actions<br/>escritas validadas"]
            API["Route Handlers<br/>/api/pluggy/* · /api/health"]
        end
        LIB["Núcleo · src/lib<br/>motor de regras · dados · IA"]
        CRON["Cron da VPS"]
    end

    subgraph SB["Supabase · self-hosted"]
        direction LR
        AUTH["Auth<br/>GoTrue"]
        REST["PostgREST"] --> PG[("Postgres<br/>schema gestor360<br/>RLS por usuário")]
    end

    subgraph EXT["Serviços externos"]
        direction LR
        PLG["Pluggy<br/>Open Finance"]
        LLM["Anthropic · OpenAI<br/>Google · DeepSeek"]
        TS["TypeSafe<br/>modelo Jev"]
    end

    U -->|"HTTPS"| T
    T --> MW --> RSC & SA
    T --> API
    RSC & SA & API --> LIB
    MW -.->|"valida o JWT"| AUTH
    LIB -->|"JWT do usuário<br/>ou service_role"| REST
    LIB --> PLG & LLM & TS
    PLG -->|"webhook"| API
    CRON -->|"CRON_SECRET"| API
    U -.->|"widget Pluggy Connect"| PLG
```

O app é um único container Next.js. O navegador nunca fala com o banco diretamente: páginas e ações rodam no servidor, que consulta o Supabase com o token do usuário logado. A RLS do Postgres garante que cada pessoa só enxergue as próprias linhas. Só os endpoints chamados por máquinas (webhook e cron da Pluggy, health check) usam a chave `service_role`.

---

## 2. Ciclo de uma requisição

```mermaid
sequenceDiagram
    autonumber
    participant N as Navegador
    participant M as Middleware
    participant A as Supabase Auth
    participant P as Página (Server Component)
    participant R as Repositório + mappers
    participant DB as PostgREST + Postgres
    participant S as Server Action

    N->>M: GET /transacoes (cookie de sessão)
    M->>A: getUser() valida o JWT
    A-->>M: usuário válido (cookie renovado)
    M->>P: segue a requisição
    P->>R: getTransactions() com cache por request
    R->>DB: SELECT paginado com o JWT
    DB-->>R: só linhas com user_id = auth.uid() (RLS)
    R-->>P: tipos do domínio + motor de regras
    P-->>N: HTML/RSC renderizado no servidor

    N->>S: ação do usuário, ex.: categorizar
    S->>S: zod valida a entrada
    S->>A: requireSession()
    S->>DB: guarda de posse (a categoria é do usuário?)
    S->>DB: UPDATE filtrado por id e user_id
    S-->>N: revalidatePath() devolve a tela atualizada
```

Toda escrita passa pela mesma sequência: validar a entrada (Server Actions são endpoints HTTP públicos), confirmar a sessão, conferir a posse do que é referenciado e só então gravar. Depois, `revalidatePath` faz o Next renderizar a página de novo com os dados atualizados, sem estado duplicado no navegador.

---

## 3. Supabase por dentro

### Três formas de acesso

```mermaid
flowchart TB
    subgraph USO["Quem acessa o banco e como"]
        direction LR
        U1["Páginas e Server Actions<br/>anon key + JWT do usuário"]
        U2["Webhook, cron e health<br/>service_role"]
        U3["Primeiro login<br/>RPC bootstrap_user"]
    end

    RLS{"RLS<br/>user_id = auth.uid()"}
    PG[("schema gestor360")]

    U1 --> RLS --> PG
    U2 -->|"ignora a RLS: o código resolve<br/>item_id → user_id antes de gravar"| PG
    U3 -->|"security definer: cria perfil,<br/>contas e categorias padrão"| PG
```

| Acesso | Chave | Onde | Isolamento |
|---|---|---|---|
| Usuário logado | anon + JWT da sessão | Server Components, Server Actions | RLS + filtro explícito por `user_id` + guardas de posse |
| Sistema | `service_role` | `/api/pluggy/webhook`, `/api/pluggy/sync`, `/api/pluggy/reprocess`, `/api/health` | O código resolve o dono pelo `pluggy_items` e filtra por `user_id` |
| Bootstrap | função `security definer` | layout autenticado, no 1º acesso | A função usa `auth.uid()` e é idempotente |

Os clientes são tipados com o esquema real (`src/lib/supabase/database.types.ts`), então toda query é checada pelo TypeScript. As chaves de API que os usuários salvam ficam cifradas com AES-256-GCM antes de chegar ao banco (`src/lib/security/secret-box.ts`).

### Modelo de dados

```mermaid
erDiagram
    AUTH_USERS ||--|| PROFILES : "1 perfil"
    AUTH_USERS ||--o{ ACCOUNTS : "tem"
    AUTH_USERS ||--o{ CATEGORIES : "tem"
    AUTH_USERS ||--o{ TRANSACTIONS : "tem"
    AUTH_USERS ||--o{ PLUGGY_ITEMS : "conecta"
    AUTH_USERS ||--o{ AI_CREDENTIALS : "salva"
    CATEGORIES ||--o{ CATEGORIES : "subcategoria"
    CATEGORIES ||--o{ TRANSACTIONS : "classifica"
    CATEGORIES ||--o{ CATEGORY_RULES : "destino da regra"
    CATEGORIES ||--o{ BUDGETS : "teto mensal"
    ACCOUNTS ||--o{ TRANSACTIONS : "origem"
    PAYEES ||--o{ TRANSACTIONS : "contraparte"
    CATEGORIES ||--o{ PAYEES : "categoria padrão"
    AUTH_USERS ||--o{ GOALS : "persegue"

    TRANSACTIONS {
        uuid id PK
        uuid user_id FK
        date date
        numeric amount "sempre positivo"
        text type "entrada | saida"
        text description "limpa pelo normalizador"
        uuid category_id FK
        uuid account_id FK
        uuid payee_id FK
        text origin "manual | import | open_finance"
        boolean needs_review
        jsonb raw_payload "transação Pluggy inteira"
    }
    CATEGORIES {
        uuid id PK
        text name
        text kind "receita | despesa"
        text nature "fixa | variavel | discricionaria"
        uuid parent_id FK "plano de contas em árvore"
    }
    CATEGORY_RULES {
        text pattern "substring da descrição"
        text source "manual | learned"
    }
    AI_CREDENTIALS {
        text provider "anthropic | openai | gemini | deepseek | typesafe"
        text api_key "cifrada AES-256-GCM"
        boolean is_active "um ativo por usuário"
    }
    PLUGGY_ITEMS {
        text item_id "conexão com o banco"
        timestamptz last_synced_at
    }
```

As migrations ficam em `supabase/migrations` e são aplicadas por `scripts/migrate.sh`, que registra cada arquivo com checksum em `gestor360.schema_migrations`.

---

## 4. Open Finance (Pluggy)

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuário
    participant APP as App (servidor)
    participant PL as Pluggy
    participant DB as Supabase

    rect rgba(20,147,106,0.12)
    Note over U,DB: Conectar um banco
    U->>APP: clica em Conectar banco
    APP->>PL: createConnectToken (CLIENT_SECRET fica no servidor)
    PL-->>U: token de 30 min para o widget Pluggy Connect
    U->>PL: escolhe o banco e autoriza o consentimento
    PL-->>APP: itemId
    APP->>DB: upsert em pluggy_items
    APP->>PL: primeira sincronização (até 12 meses)
    end

    rect rgba(194,124,14,0.12)
    Note over U,DB: Novos lançamentos, sem o usuário abrir o app
    PL->>APP: POST /api/pluggy/webhook (header secreto)
    APP->>DB: dedup por eventId (pluggy_webhook_events)
    APP->>DB: resolve item_id para user_id (pluggy_items)
    APP->>PL: busca contas e transações novas
    APP->>DB: grava pela esteira da seção 5
    end

    Note over APP: Rede de segurança: o cron da VPS chama /api/pluggy/sync<br/>com CRON_SECRET e ressincroniza os itens atrasados
```

---

## 5. A esteira de um lançamento

```mermaid
flowchart TD
    SRC["Pluggy · CSV · lançamento manual"] --> CON["Conector<br/>formato canônico"]
    CON --> NOR["Normalizador<br/>data ISO, valor positivo + tipo,<br/>descrição sem ruído de extrato"]
    NOR --> DED{"Duplicata?<br/>mesmo tipo, valor,<br/>data ±3 dias, descrição"}
    DED -->|sim| X["descarta"]
    DED -->|não| PAY["Destinatário<br/>quem pagou ou recebeu"]
    PAY --> C1{"Destinatário tem<br/>categoria padrão?"}
    C1 -->|não| C2{"Regra sua<br/>manual › aprendida"}
    C2 -->|não| C3{"Memória<br/>mesma descrição"}
    C3 -->|não| C4{"Dicionário<br/>iFood, Uber, Netflix…"}
    C4 -->|não| REV["A revisar"]
    C1 & C2 & C3 & C4 -->|sim| DB[("transactions")]
    REV --> DB
    DB --> MOT["Motor de regras<br/>orçamento · projeção · anomalias<br/>recorrências · indicadores · transferências"]
    MOT --> TELAS["Painel, Orçamento, Metas…"]
    REV -.->|"opcional"| JEV["Jev sugere a categoria<br/>você revisa e aplica"]
    JEV -.->|"escolha sólida vira regra"| C2
```

Regras e memória só valem para categorias do mesmo tipo do lançamento: receita para entrada, despesa para saída. Tudo até o banco é código determinístico e testado (`src/lib/engine`, 99% de cobertura).

---

## 6. Inteligência artificial

```mermaid
flowchart LR
    subgraph G["Gestor: diagnóstico e chat"]
        direction TB
        MOT["Motor de regras"] --> PKG["Pacote de contexto<br/>resumo dos números,<br/>nunca o extrato"]
        PKG --> BR["brain.ts<br/>escada de prioridades"]
        CS1["Credencial ativa do usuário<br/>decifrada no servidor"] --> BR
        BR --> PRV{"Provedor"}
        PRV --> P1["Anthropic"] & P2["OpenAI"] & P3["Google"] & P4["DeepSeek"]
    end

    subgraph J["Jev: categorização"]
        direction TB
        TX["Tela de Transações<br/>escopo: a revisar · período ·<br/>filtro · seleção"] --> CW["categorizeWithJev<br/>lotes de 12"]
        CW --> Q["1 pergunta Choice por lançamento<br/>opções = suas categorias do mesmo tipo"]
        Q --> API["api.typesafe.ai"]
        API --> DEC["categoria + probabilidades<br/>+ confiança"]
        DEC --> RV["Revisão no diálogo<br/>alta e média já marcadas"]
        RV --> AP["applyJevDecisions<br/>valida posse e tipo,<br/>aprende regras sem ambiguidade"]
    end
```

A IA nunca faz conta. O Gestor recebe números já calculados e cita a base de cada afirmação. O Jev recebe um lançamento por vez, só com os campos úteis, e nada é gravado antes de você aplicar.

---

## 7. CI/CD e deploy

```mermaid
flowchart LR
    DEV["git push"] --> CI

    subgraph CI["CI · a cada push"]
        direction TB
        C1["npm ci"] --> C2["typecheck"] --> C3["ESLint<br/>zero avisos"] --> C4["Vitest<br/>+ cobertura"] --> C5["next build"]
        C5 --> C6["build da imagem Docker"]
        C7["shellcheck dos scripts"]
    end

    TAG["tag v* ou disparo manual"] --> D1

    subgraph CD["Deploy"]
        direction TB
        D1["Build e push<br/>ghcr.io"] --> D2["Migrations<br/>scripts/migrate.sh up<br/>(opcional)"]
        D2 --> D3["SSH na VPS<br/>docker stack deploy"]
        D3 --> D4{"/api/health<br/>responde ok<br/>com o commit novo?"}
        D4 -->|sim| OK["no ar"]
        D4 -->|não| RB["Swarm reverte<br/>para a versão anterior"]
    end
```

O container tem duas sondas: `/api/health?probe=live` (o processo responde, usada pelo Swarm) e `/api/health` (inclui o banco, usada pelo deploy e por monitores externos). Assim, uma queda do Supabase não faz o orquestrador reiniciar o app em loop. Passo a passo de operação em [`OPERACAO.md`](./OPERACAO.md).

---

## 8. Stacks

| Camada | Tecnologia | Versão | Papel |
|---|---|---|---|
| Framework | Next.js (App Router, Server Actions) | 15.5 | Páginas renderizadas no servidor, ações e API num só deploy |
| UI | React | 19 | Interface |
| | Tailwind CSS + Radix UI (shadcn/ui) + lucide-react | 3.4 | Estilo, componentes acessíveis e ícones |
| | Recharts + Chart.js | 2.15 / 4.5 | Gráficos do painel |
| Linguagem | TypeScript (modo estrito) | 5.9 | Tipos de ponta a ponta, inclusive do banco |
| Validação | zod | 3.25 | Entrada de todas as Server Actions |
| Banco e login | Supabase: Postgres + Auth (GoTrue) + PostgREST | self-hosted | Dados, sessão e RLS |
| | @supabase/supabase-js + @supabase/ssr | 2.117 / 0.12 | Clientes tipados no servidor e no navegador |
| Open Finance | Pluggy (API + widget react-pluggy-connect) | 2.12 | Contas e transações dos bancos |
| IA | Anthropic SDK, OpenAI, Google Gemini, DeepSeek | — | Gestor: diagnóstico e chat (o usuário escolhe o provedor) |
| | TypeSafe Jev | jev-latest | Categorização com probabilidade e confiança |
| Segurança | AES-256-GCM (node:crypto) | — | Chaves de API cifradas em repouso |
| Qualidade | Vitest + cobertura v8 | 3.2 | 363 testes do motor, IA, validação e cifragem |
| | ESLint (regras do Next) | 9 | Zero avisos no CI |
| Infra | Docker (multi-stage, Node 22 Alpine) + Docker Swarm | — | Imagem enxuta e deploy com rollback |
| | Traefik | — | HTTPS e roteamento na VPS |
| | GitHub Actions + GHCR | — | CI, build e publicação da imagem, deploy por SSH |
| Observabilidade | Logger JSON próprio + `/api/health` | — | Logs estruturados com segredos redigidos e sondas de saúde |
