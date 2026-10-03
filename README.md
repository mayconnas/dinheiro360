# Gestor Financeiro 360

Uma **gestão financeira 360**, como ter um gestor pessoal cuidando do seu dinheiro — alguém que não só mostra o que está acontecendo, mas diagnostica, aconselha, projeta e cobra.

O princípio que sustenta tudo é simples: **separar o que _calcula_ do que _aconselha_**. Toda conta crítica — saldo, orçamento, projeção, indicadores — é determinística: código puro, sem IA, sem margem para erro (camadas 1 a 3). O "gestor" (a IA, camada 4) **não faz conta** — ele lê os números já calculados e decide o que fazer com eles, em linguagem natural. Assim você ganha o melhor dos dois lados: **números confiáveis + conselho inteligente**, sem o risco de a IA inventar um valor.

---

## Stack

- **Next.js 15** (App Router) + **React 19**
- **TypeScript**
- **Tailwind CSS** + **shadcn/ui** (Radix UI + `lucide-react`)
- **Supabase** — Postgres + Auth + Row Level Security (RLS)
- **Anthropic Claude API** (`@anthropic-ai/sdk`) — o cérebro/IA da camada 4
- Extras: `recharts` (gráficos), `zod` (validação), `date-fns`

---

## Arquitetura em 5 camadas

O sistema é uma esteira: o dado entra, é limpo e guardado, passa pelas regras, é interpretado pelo cérebro e sai como ação. **A informação só sobe** — cada camada só conhece a de baixo.

1. **Ingestão** — puxa o dado de qualquer fonte (manual, CSV, e no futuro Open Finance), normaliza formato/sinal/data/moeda e deduplica lançamentos repetidos entre fontes.
2. **Núcleo de Dados** — a fonte da verdade. Guarda todas as transações, categoriza cada lançamento (e aprende com suas correções), mantém contas, saldos e o perfil/configuração.
3. **Motor de Regras** (determinístico) — onde mora a matemática. Orçamento, projeção de fluxo, detector de anomalias, detector de recorrências e os indicadores de saúde financeira. Zero IA.
4. **Cérebro / IA** (o gestor) — consome o **Pacote de Contexto** (resumo estruturado dos números já calculados) e produz diagnóstico, prescrição e respostas em linguagem natural.
5. **Saída** — alertas, relatórios e interface: onde tudo aparece.

A fronteira entre o mundo dos números (camada 3) e o mundo da linguagem (camada 4) é o **Pacote de Contexto**: um resumo estruturado, nunca o dado bruto.

> Para o detalhamento módulo a módulo, as regras de negócio e as decisões técnicas, veja [`arquitetura-gestor-financeiro.md`](./arquitetura-gestor-financeiro.md).

---

## Como começar

### 1. Pré-requisitos

- **Node.js 18+** (o projeto foi construído sobre o Node 24)
- Uma conta no **Supabase** (o plano gratuito basta)
- Uma chave da **Anthropic Claude API**

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar o Supabase

1. Crie um projeto em [app.supabase.com](https://app.supabase.com).
2. Em **Settings → API**, copie a **URL do projeto** e a **anon key**.
3. Abra o **SQL Editor** do Supabase e rode o arquivo [`supabase/migrations/0001_schema.sql`](./supabase/migrations/0001_schema.sql).

   Esse script cria as tabelas, ativa o **Row Level Security** (cada usuário só enxerga os próprios dados) e instala o **trigger** que, a cada novo usuário, cria automaticamente o perfil, as contas e as categorias padrão.

### 4. Configurar as variáveis de ambiente

Copie o exemplo e preencha os valores:

```bash
cp .env.local.example .env.local
```

| Variável | Obrigatória | Descrição |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Sim | URL do seu projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sim | Chave pública (anon) do Supabase |
| `ANTHROPIC_API_KEY` | Sim | Chave da Anthropic Claude API |
| `ANTHROPIC_MODEL` | Não | Modelo do gestor. Padrão: `claude-sonnet-5`. Para maior qualidade, use `claude-opus-4-8`. |
| `TYPESAFE_API_KEY` | Não | Chave padrão da [TypeSafe](https://docs.typesafe.ai) para o botão **Categorizar com Jev** (Transações). Cada usuário também pode salvar a própria em Configurações > Inteligência (IA) — exige a migration `0011_typesafe_jev.sql`. |
| `TYPESAFE_MODEL` | Não | Modelo do Jev. Padrão: `jev-latest`. Fixe uma versão (ex `jev-1.13.0`) para respostas estáveis. |

### 5. Rodar em desenvolvimento

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

### 6. Criar conta e começar

Crie sua conta na tela de cadastro. O trigger do Supabase já deixa perfil, contas e categorias padrão prontos — daí é só **começar a registrar transações**.

---

## Scripts disponíveis

| Script | O que faz |
|---|---|
| `npm run dev` | Sobe o servidor de desenvolvimento (`next dev`) |
| `npm run build` | Gera o build de produção (`next build`) |
| `npm run start` | Roda o build de produção (`next start`) |
| `npm run lint` | Verifica o código com o ESLint (`next lint`) |
| `npm run typecheck` | Checa os tipos sem emitir arquivos (`tsc --noEmit`) |

---

## Como funciona a IA

A IA **nunca faz conta**. Ela recebe pronto o **Pacote de Contexto** — um resumo estruturado dos números que o motor de regras (camadas 2 e 3) já calculou: resumo do mês, top categorias, indicadores de saúde, orçamento, projeção, flags de anomalia e metas. Extrato bruto nunca entra.

Sobre esse pacote, o gestor raciocina dentro de uma **escada de prioridades financeiras**, como um consultor que segue um método — não uma lista de insights soltos:

1. **Sair do vermelho** — se a sobra é negativa, cortar discricionário até o fluxo virar positivo. Nada mais importa antes disso.
2. **Construir reserva** — com reserva abaixo de 3 meses, acumular até 3–6 meses antes de qualquer investimento.
3. **Matar dívida cara** — comprometimento alto ou juros altos vêm antes de investir.
4. **Otimizar e investir** — com o básico resolvido, subir a taxa de poupança e alocar.

A IA lê o placar, identifica em que degrau você está (o indicador mais crítico manda) e gera prescrições ranqueadas pelo impacto naquele degrau. E toda afirmação numérica **cita a base** ("com base no seu gasto de R$680…"); se o número não veio no pacote, ela não usa. Isso elimina a alucinação numérica.

---

## Roadmap

Esta versão cobre as **Fases 1 a 3** da arquitetura:

- **Fase 1 — Base:** registrar e ver transações.
- **Fase 2 — Contas:** o sistema calcula e projeta (orçamento, projeção de fluxo, anomalias, recorrências, indicadores).
- **Fase 3 — Gestor:** a IA diagnostica, prescreve e responde, alimentada pelo Pacote de Contexto.

A **Fase 4 — Autonomia** (ingestão automática via **Open Finance / Meu Pluggy**) fica para depois. **Hoje a ingestão é manual + importação de CSV** — o caminho até a automação é incremental e não mexe em nenhuma camada acima da ingestão.
