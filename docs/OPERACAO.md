# Operação — Gestor Financeiro 360

Runbook de produção: como o código vira container rodando na VPS, como
evoluir o banco com segurança, como saber se está tudo de pé e como voltar
atrás quando algo dá errado.

> **Regra de ouro:** nenhum segredo entra no repositório. Valores sensíveis
> vivem só nos *secrets* do GitHub e no `.env` da VPS. Este documento cita
> apenas **nomes** de variáveis.

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Variáveis de ambiente](#2-variáveis-de-ambiente)
3. [Configuração inicial (uma vez)](#3-configuração-inicial-uma-vez)
4. [CI](#4-ci)
5. [Deploy](#5-deploy)
6. [Migrations do banco](#6-migrations-do-banco)
7. [Health check e monitoramento](#7-health-check-e-monitoramento)
8. [Logs estruturados](#8-logs-estruturados)
9. [Rollback](#9-rollback)
10. [Chave de criptografia das credenciais de IA](#10-chave-de-criptografia-das-credenciais-de-ia)

---

## 1. Visão geral

```
push / PR ──► CI (.github/workflows/ci.yml)
               ├─ check   : npm ci → typecheck → testes → next build
               ├─ scripts : bash -n + shellcheck em scripts/
               └─ docker  : build da imagem (sem push)

tag v* ou ───► Deploy (.github/workflows/deploy.yml)
execução        ├─ build   : imagem → ghcr.io/<owner>/<repo>:{latest, <sha>, <tag>}
manual          ├─ migrate : scripts/migrate.sh up        (opcional, só manual)
                └─ deploy  : stack.yml → VPS → docker stack deploy
                             └─ espera /api/health = ok com o commit novo
```

| Peça | Onde |
|---|---|
| App (Next.js 15 standalone) | Docker Swarm na VPS, service `<stack>_app`, atrás do Traefik |
| Banco / Auth | Supabase self-hosted, schema `gestor360` |
| Imagens | GitHub Container Registry (`ghcr.io`) |
| Migrations | `supabase/migrations/*.sql`, aplicadas por `scripts/migrate.sh` |

O nome padrão da stack é `dinheiro360` (service `dinheiro360_app`). Ele pode
ser trocado pela variável `STACK_NAME` do repositório.

---

## 2. Variáveis de ambiente

### Runtime (container) — definidas no `.env` da VPS e mapeadas pelo `stack.yml`

| Variável | Obrigatória | Para quê |
|---|---|---|
| `SUPABASE_ANON_KEY` | Sim | Vira `NEXT_PUBLIC_SUPABASE_ANON_KEY` no container (SSR). |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim | Cliente admin (webhook/cron da Pluggy) **e** o check de banco do `/api/health`. Sem ela o health fica `degraded` e o deploy é revertido. |
| `AI_CREDENTIALS_ENCRYPTION_KEY` | Sim | Criptografa as chaves de API dos usuários em repouso. Ver [seção 10](#10-chave-de-criptografia-das-credenciais-de-ia). |
| `PLUGGY_CLIENT_ID` | Sim | Open Finance (Pluggy). |
| `PLUGGY_CLIENT_SECRET` | Sim | Open Finance (Pluggy). |
| `PLUGGY_WEBHOOK_SECRET` | Sim | Valida o webhook da Pluggy. |
| `CRON_SECRET` | Sim | Protege `/api/pluggy/sync` (cron da VPS). |
| `ANTHROPIC_API_KEY` | Não | Chave padrão do servidor para o Gestor (IA). |
| `TYPESAFE_API_KEY` | Não | Chave padrão do servidor para o Jev (TypeSafe). |
| `TYPESAFE_MODEL` | Não | Modelo do Jev. Padrão `jev-latest`. |
| `LOG_LEVEL` | Não | `debug` \| `info` \| `warn` \| `error`. Padrão `info`. |
| `IMAGE` | Não* | Imagem a rodar. Padrão `gestor360:latest` (build local). *O deploy sempre informa. |
| `APP_VERSION` | Não* | Versão exibida no `/api/health`. *O deploy sempre informa. |
| `GIT_SHA` | Não* | Commit exibido no `/api/health`. *O deploy sempre informa. |

`NODE_ENV`, `NEXT_PUBLIC_SUPABASE_URL`, `PLUGGY_WEBHOOK_URL` e
`ANTHROPIC_MODEL` têm valor fixo no próprio `stack.yml`.

### Build (imagem) — `--build-arg`

| Build arg | De onde vem no deploy |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | variável `NEXT_PUBLIC_SUPABASE_URL` do repositório |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | variável `NEXT_PUBLIC_SUPABASE_ANON_KEY` do repositório |
| `GIT_SHA` | `github.sha` |
| `APP_VERSION` | nome da tag (`v1.2.3`) ou `<branch>-<sha curto>` |
| `SOURCE_URL` | URL do repositório (label OCI) |

> As `NEXT_PUBLIC_*` são **embutidas no bundle do navegador** — por isso
> ficam em *variables* (não são segredo: a anon key é pública por design e
> protegida pela RLS).

### Desenvolvimento local

`.env.local` (copiado de `.env.local.example`). Em dev o logger imprime
linhas legíveis e o nível padrão é `debug`.

---

## 3. Configuração inicial (uma vez)

### 3.1 GitHub — variables e secrets

Crie o environment **`production`** em *Settings → Environments* (dá para
exigir aprovação manual antes de cada deploy em *Required reviewers*).

**Variables** (*Settings → Secrets and variables → Actions → Variables*):

| Nome | Obrigatória | Observação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Sim | URL pública do Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sim | anon key do Supabase |
| `APP_URL` | Não | URL pública do app (padrão: o domínio do `stack.yml`) — usada para checar o health após o deploy |
| `STACK_NAME` | Não | Nome da stack no Swarm (padrão `dinheiro360`) |
| `GHCR_PULL_USER` | Não | Usuário dono do `GHCR_PULL_TOKEN` |

**Secrets** (de preferência no environment `production`):

| Nome | Obrigatório | Observação |
|---|---|---|
| `VPS_HOST` | Sim | Host/IP da VPS |
| `VPS_USER` | Sim | Usuário SSH de deploy (precisa estar no grupo `docker`) |
| `VPS_SSH_KEY` | Sim | Chave privada SSH **dedicada ao deploy** |
| `VPS_STACK_DIR` | Sim | Diretório na VPS com o `.env` (o `stack.yml` é enviado pelo workflow) |
| `VPS_SSH_PORT` | Não | Porta SSH (padrão 22) |
| `DATABASE_URL` | Só p/ migrations | Conexão **direta** do Postgres (ver [seção 6](#6-migrations-do-banco)) |
| `GHCR_PULL_TOKEN` | Recomendado | PAT com `read:packages` para a VPS puxar a imagem |

Com a CLI do GitHub:

```bash
gh variable set NEXT_PUBLIC_SUPABASE_URL --body "https://<seu-supabase>"
gh variable set NEXT_PUBLIC_SUPABASE_ANON_KEY --body "<anon-key>"

gh secret set VPS_HOST       --env production
gh secret set VPS_USER       --env production
gh secret set VPS_STACK_DIR  --env production
gh secret set VPS_SSH_KEY    --env production < ~/.ssh/deploy_dinheiro360
gh secret set DATABASE_URL   --env production
```

(Sem `--body`, o `gh` pede o valor no terminal — ele não fica no histórico do shell.)

### 3.2 Pull da imagem na VPS

O deploy faz `docker login ghcr.io` na VPS antes do `docker stack deploy`.
Se `GHCR_PULL_TOKEN` não existir, usa o `GITHUB_TOKEN` do job — que **expira
quando o job termina**. Funciona no deploy, mas se o Swarm precisar puxar a
imagem de novo depois (task reagendada, cache limpo), o pull falha. Escolha um:

- **Pacote público** (natural para um repositório de portfólio): em
  *github.com → seu perfil → Packages → o pacote → Package settings →
  Change visibility → Public*. Nenhum token é necessário para o pull.
- **Pacote privado:** crie um PAT (classic) só com `read:packages` e salve em
  `GHCR_PULL_TOKEN` (e o usuário em `GHCR_PULL_USER`).

### 3.3 VPS

1. Usuário de deploy no grupo `docker`, com a chave pública de
   `VPS_SSH_KEY` em `~/.ssh/authorized_keys`.
2. Diretório `VPS_STACK_DIR` com um arquivo **`.env`** contendo as variáveis
   de runtime da [seção 2](#runtime-container--definidas-no-env-da-vps-e-mapeadas-pelo-stackyml),
   no formato de shell (`NOME=valor`, aspas simples se houver espaço ou `$`):

   ```bash
   chmod 600 .env   # só o dono lê
   ```

   O workflow faz `set -a; . ./.env; set +a` antes do `docker stack deploy`
   (o `docker stack deploy` não lê `.env` sozinho).
3. Se a stack já roda com **outro nome** (ex.: criada à mão antes deste
   pipeline), ou defina `STACK_NAME` com esse nome, ou remova a antiga
   (`docker stack rm <nome-antigo>`) antes do primeiro deploy — duas stacks
   com o mesmo router Traefik (`gestor360`) conflitam.

### 3.4 Banco

Uma vez só, registre no controle de migrations o que já foi aplicado à mão —
ver [6.3](#63-primeira-vez-baseline-do-banco-existente).

---

## 4. CI

Arquivo: `.github/workflows/ci.yml`. Roda em todo push (qualquer branch) e em
todo pull request; um push novo na mesma branch cancela a execução anterior.

| Job | O que faz |
|---|---|
| `check` | Node 22 com cache do npm → `npm ci` → `npm run typecheck` → `npm run test --if-present` → `npm run build` (com `NEXT_PUBLIC_*` fictícias) |
| `scripts` | `bash -n scripts/migrate.sh` e `shellcheck scripts/*.sh` |
| `docker` | Build da imagem de produção com Buildx e cache do GitHub Actions — garante que o `Dockerfile` continua funcionando. Não publica nada. |

Reproduzir localmente:

```bash
npm ci && npm run typecheck && npm run build
docker build -t gestor360:local \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy-anon-key .
```

---

## 5. Deploy

Arquivo: `.github/workflows/deploy.yml`. Nunca roda dois ao mesmo tempo.

### 5.1 Por tag (o caminho normal)

```bash
git tag v1.2.3
git push origin v1.2.3
```

### 5.2 Manual

*Actions → Deploy → Run workflow* (escolha a branch/tag e marque
**run_migrations** se houver migration nova), ou:

```bash
gh workflow run deploy.yml --ref main -f run_migrations=true
```

### 5.3 O que acontece

1. **build** — gera a imagem e publica em `ghcr.io/<owner>/<repo>` com as tags
   `latest`, `<sha curto>` e (se for tag) `v1.2.3`. Labels OCI com repositório,
   commit e versão.
2. **migrate** — só na execução manual com `run_migrations` marcado:
   `scripts/migrate.sh status` e `scripts/migrate.sh up`. Se falhar, o deploy
   **não** acontece.
3. **deploy** — envia o `stack.yml` do commit para `VPS_STACK_DIR`, faz login
   no ghcr.io e roda:

   ```bash
   IMAGE=ghcr.io/<owner>/<repo>:<sha> APP_VERSION=<versão> GIT_SHA=<sha> \
     docker stack deploy -c stack.yml <stack> --with-registry-auth
   ```

   A VPS roda sempre a tag **imutável do sha** — nunca `latest`.
4. **verificação** — consulta `APP_URL/api/health` a cada 10 s, por até 5 min,
   até receber `status: "ok"` **com o `commit` do deploy**. Se não vier, o job
   falha.

No Swarm, `update_config` usa `order: start-first`: a task nova sobe, precisa
ficar *healthy*, e só então a antiga é derrubada (sem downtime). Se a nova não
ficar saudável no período de `monitor`, o Swarm volta sozinho para a versão
anterior (`failure_action: rollback`).

### 5.4 Deploy manual direto na VPS (contingência)

```bash
cd <VPS_STACK_DIR>
set -a; . ./.env; set +a
IMAGE=ghcr.io/<owner>/<repo>:<sha> APP_VERSION=<versão> GIT_SHA=<sha> \
  docker stack deploy -c stack.yml dinheiro360 --with-registry-auth
```

Informe sempre `APP_VERSION` e `GIT_SHA` — o `stack.yml` tem precedência
sobre o que está gravado na imagem.

---

## 6. Migrations do banco

### 6.1 Como funciona

- Os arquivos ficam em `supabase/migrations/`, numerados (`0012_descricao.sql`)
  e aplicados em **ordem lexical**.
- `scripts/migrate.sh` registra cada migration aplicada em
  `gestor360.schema_migrations (version, checksum, applied_at)`.
- Cada arquivo roda numa **única transação** junto com o INSERT do registro:
  ou aplica e registra, ou nada acontece.
- **Drift:** se um arquivo já aplicado for editado (sha256 diferente), o
  script avisa. Migration aplicada não se edita — crie uma nova.
- `supabase/legacy/` guarda a variante antiga em `public.*`; **nunca** é
  aplicada (ver `supabase/legacy/README.md`).

Requisitos: `bash` 4+, `psql` e `DATABASE_URL` com conexão **direta** ao
Postgres (usuário com permissão de DDL no schema `gestor360`, normalmente
`postgres`) — não a URL HTTP do Supabase.

### 6.2 Comandos

```bash
export DATABASE_URL='postgresql://<usuario>:<senha>@<host>:5432/postgres'

scripts/migrate.sh status                    # aplicadas, pendentes e drift
scripts/migrate.sh up                        # aplica as pendentes
scripts/migrate.sh baseline <versão>         # marca até <versão> como aplicadas, sem executar
```

### 6.3 Primeira vez: baseline do banco existente

O banco de produção já recebeu as migrations `0001` a `0011` à mão. Antes do
primeiro `up`, registre-as **sem executar**:

```bash
scripts/migrate.sh baseline 0011_typesafe_jev
scripts/migrate.sh status    # tudo [x], nada pendente
```

> Confira antes que a `0011_typesafe_jev` foi mesmo aplicada no banco. Se não
> foi, faça o baseline até `0010_account_balances` e rode `up` em seguida.

### 6.4 Escrevendo uma migration nova

- Próximo número livre: `0012_<descricao>.sql`.
- Preferir SQL **idempotente** (`if not exists`, `create or replace`).
- **Não** usar `BEGIN`/`COMMIT` — o runner já envolve tudo numa transação.
- **Não** usar `CREATE INDEX CONCURRENTLY` (não roda dentro de transação).
- As migrations rodam **antes** da versão nova subir, enquanto a antiga ainda
  atende: precisam ser compatíveis com o código em produção (adicionar coluna
  com default: ok; renomear/remover: em dois deploys — *expand/contract*).

### 6.5 Rede

O job `migrate` roda num runner do GitHub, então `DATABASE_URL` precisa ser
alcançável pela internet. Se a porta do Postgres não for exposta (o
recomendado), rode as migrations da sua máquina por um túnel SSH até a VPS e
aponte `DATABASE_URL` para a porta local do túnel — e faça o deploy sem
`run_migrations`.

---

## 7. Health check e monitoramento

### 7.1 Endpoint

`GET /api/health` — público, sem sessão, `Cache-Control: no-store`.

```json
{
  "status": "ok",
  "version": "v1.2.3",
  "commit": "3f9c2a1…",
  "uptimeSeconds": 5321,
  "checks": {
    "database": { "ok": true, "latencyMs": 12 }
  }
}
```

| HTTP | `status` | Quando |
|---|---|---|
| 200 | `ok` | Todos os checks passaram |
| 503 | `degraded` | O banco não respondeu em 3 s, a consulta falhou ou `SUPABASE_SERVICE_ROLE_KEY` não está configurada |

O check de banco faz um `HEAD` com `count` em `gestor360.categories` via
service role. A resposta nunca traz mensagem crua de erro — o detalhe vai
para o log (`module: "health"`).

### 7.2 Quem consulta

- **Docker / Swarm:** `HEALTHCHECK` no `Dockerfile` e `healthcheck` no
  `stack.yml` usam a sonda de *liveness*, `/api/health?probe=live` (a cada
  30 s, timeout 5 s, 3 falhas seguidas, 30 s de carência na subida). Ela só
  confirma que o processo Node responde — de propósito não consulta o banco:
  se o Supabase cair, reiniciar o container não resolve nada, e uma sonda
  dependente do banco faria o Swarm reciclar o app em loop. Task *unhealthy*
  é substituída pelo Swarm, e um deploy cuja task nova não fica *healthy* é
  revertido.
- **Workflow de deploy:** espera `ok` com o commit novo.
- **Traefik:** mantém o health check próprio em `/login`.

### 7.3 Monitor externo

Aponte um monitor para `https://<seu-dominio>/api/health`:

- **Uptime Kuma:** tipo *HTTP(s) – Keyword*, palavra-chave `"status":"ok"`,
  intervalo 60 s, 2–3 tentativas antes de alertar.
- **UptimeRobot:** tipo *Keyword*, keyword `"status":"ok"`, alertar quando
  *não existir*.

Usar a palavra-chave (e não só o código HTTP) também pega respostas
inesperadas de proxy.

### 7.4 Comandos úteis na VPS

```bash
docker service ps dinheiro360_app                  # tasks, estado e erros
docker inspect --format '{{json .State.Health}}' \
  $(docker ps -q -f name=dinheiro360_app) | jq     # últimas execuções do healthcheck
```

---

## 8. Logs estruturados

O app usa `src/lib/observability/logger.ts` (sem dependências):

- **Produção:** uma linha JSON por evento —
  `{"time","level","msg","module",...contexto,"err":{"name","message","stack","cause"}}`.
- **Desenvolvimento:** uma linha legível (`HH:MM:SS.mmm INFO  [módulo] msg chave=valor`).
- **Nível:** `LOG_LEVEL` (`debug` | `info` | `warn` | `error`).
- **Redação:** valores de chaves que casam com
  `api_key|token|secret|password|authorization|cookie` viram `[REDACTED]`
  em qualquer profundidade.

```ts
import { logger } from "@/lib/observability/logger";

const log = logger.child({ module: "pluggy-sync" });
log.info("sync concluída", { itemId, transacoes: 42 });
log.error("falha no webhook", { err, itemId });
```

Consultando na VPS (`--raw` tira o prefixo da task; `fromjson?` ignora linhas
que não são JSON, como o banner do Next):

```bash
# acompanhar ao vivo
docker service logs dinheiro360_app --raw -f | jq -R 'fromjson? // .'

# só erros da última hora
docker service logs dinheiro360_app --raw --since 1h \
  | jq -cR 'fromjson? | select(.level == "error")'

# eventos de um módulo
docker service logs dinheiro360_app --raw --since 24h \
  | jq -cR 'fromjson? | select(.module == "pluggy-sync") | {time, level, msg}'
```

Para mais detalhe temporariamente: `LOG_LEVEL=debug` no `.env` da VPS e
redeploy (ou `docker service update --env-add LOG_LEVEL=debug dinheiro360_app`
— volta ao valor do `stack.yml` no próximo deploy).

---

## 9. Rollback

### Automático

Se a task nova não ficar *healthy* durante o deploy, o Swarm reverte sozinho
(`update_config.failure_action: rollback`). O job de deploy falha e mostra o
último status do `/api/health`.

### Manual — voltar uma versão

```bash
docker service rollback dinheiro360_app
docker service ps dinheiro360_app
curl -s https://<seu-dominio>/api/health | jq '{status, version, commit}'
```

`docker service rollback` volta para a especificação **anterior** do service
(um passo).

### Manual — ir para uma versão específica

- Pelo GitHub: *Actions → Deploy → Run workflow* escolhendo a **tag** antiga
  (sem `run_migrations`).
- Pela VPS, com uma imagem já publicada:

  ```bash
  docker service update --with-registry-auth \
    --image ghcr.io/<owner>/<repo>:<sha-anterior> dinheiro360_app
  ```

  (O próximo `docker stack deploy` volta a usar o que vier em `IMAGE`.)

### E o banco?

Migrations **não** são revertidas automaticamente. Como elas são escritas
para serem compatíveis com a versão anterior do código
([6.4](#64-escrevendo-uma-migration-nova)), o rollback do app normalmente não
exige nada no banco. Se exigir, a correção é uma **migration nova**.

---

## 10. Chave de criptografia das credenciais de IA

`AI_CREDENTIALS_ENCRYPTION_KEY` cifra (AES-256) as chaves de API que os
usuários salvam em *Configurações → Inteligência (IA)*. É uma chave de
**32 bytes em base64**:

```bash
openssl rand -base64 32
```

1. Gere uma vez e adicione ao `.env` da VPS
   (`AI_CREDENTIALS_ENCRYPTION_KEY=<valor>`).
2. Guarde uma cópia num cofre de senhas — **sem ela, as chaves já salvas não
   podem ser lidas**.
3. Trocar a chave invalida todas as credenciais salvas (os usuários precisarão
   cadastrá-las de novo).
4. Nunca commitar, nunca logar, nunca reutilizar entre ambientes. (A redação
   do logger cobre nomes como `api_key`, `token` e `secret`, mas **não** um
   campo chamado `encryptionKey` — não conte com ela para isso.)
