-- ════════════════════════════════════════════════════════════════
-- Gestor Financeiro 360 — Fase 9: Plano de Contas hierárquico
--
-- Objetivo de produto: a lista PLANA de categorias vira uma ÁRVORE de
-- profundidade ilimitada (conta → subconta → sub-subconta → ...), no
-- estilo "plano de contas" contábil. Uma transação continua amarrada
-- a UMA categoria (agora = um NÓ da árvore, idealmente uma FOLHA); os
-- totais de um nó-pai são a soma dos lançamentos diretos dele + a
-- soma recursiva dos filhos.
--
-- DECISÃO DE ARQUITETURA: NÃO criamos tabela nova. Evoluímos
-- gestor360.categories em vez de substituí-la, porque `category_id`
-- já é referenciado por transactions, budgets, category_rules,
-- payees.default_category_id e por ~42 arquivos de aplicação
-- (aggregate, budget, indicators, anomalies, recurrences,
-- categorizer, dashboard, IA...). Uma "categoria" passa a ser
-- simplesmente um "nó do plano de contas": toda a modelagem antiga
-- (kind, nature, color, is_system) continua valendo por nó, e nada
-- do código existente quebra — só ganha um `parent_id` opcional para
-- quem quiser montar hierarquia.
--
-- Campos novos:
--   • parent_id  — self-reference nullable. NULL = nó raiz (top-level,
--     comportamento idêntico ao de hoje, onde toda categoria é raiz).
--   • sort_order — ordenação manual dos irmãos dentro de um mesmo pai
--     (a UI de árvore usa isso para permitir reordenar por
--     arrastar/soltar; default 0 = ordena por nome como fallback).
--   • code       — "código de conta" contábil opcional (ex '3.1.2'),
--     só decorativo/organizacional; nunca usado por regra de negócio.
--
-- kind (receita/despesa) do filho DEVE ser igual ao do pai — isso é
-- validado na camada de aplicação (src/app/actions/config.ts,
-- addCategory/updateCategory), não aqui via CHECK, porque um CHECK
-- comparando com outra linha exigiria trigger; a validação em
-- Server Action já cobre o único caminho de escrita (RLS bloqueia
-- acesso direto de outro usuário, e não há client-side direto no
-- Supabase para esta tabela).
--
-- ON DELETE do parent_id: "on delete set null" — se o NÓ-PAI for
-- excluído por algum caminho, os filhos não somem nem quebram a FK;
-- viram raízes (parent_id vira null). Isso é só a rede de segurança
-- no nível do banco; a UX real de exclusão (reparent para o AVÔ, não
-- para raiz solta) é feita explicitamente por deleteCategory() na
-- aplicação ANTES do delete (ver esse arquivo) — o "on delete set
-- null" aqui só entra em cena se algum dia uma categoria for
-- excluída fora desse fluxo (ex.: manutenção manual no banco).
-- ════════════════════════════════════════════════════════════════

alter table gestor360.categories
  add column if not exists parent_id uuid
    references gestor360.categories(id) on delete set null;

alter table gestor360.categories
  add column if not exists sort_order integer not null default 0;

alter table gestor360.categories
  add column if not exists code text;

comment on column gestor360.categories.parent_id is
  'Nó-pai no plano de contas (self-reference). NULL = raiz. Um filho herda o kind (receita/despesa) do pai — validado em src/app/actions/config.ts, não aqui. Transações devem amarrar preferencialmente numa FOLHA, mas o sistema tolera amarrar num nó com filhos (ver src/lib/engine/account-tree.ts).';
comment on column gestor360.categories.sort_order is
  'Ordem manual entre irmãos (mesmo parent_id). Default 0; a UI usa nome como desempate.';
comment on column gestor360.categories.code is
  'Código de conta contábil opcional (ex "3.1.2"), só organizacional/decorativo — nunca usado por regra de negócio.';

-- Índice pelo qual a árvore é montada (todos os filhos de um pai, ou
-- todas as raízes de um usuário quando parent_id is null) — usado por
-- listAccountTree() a cada carregamento da tela de plano de contas.
create index if not exists categories_user_parent_idx
  on gestor360.categories(user_id, parent_id);

-- Impede um nó ser pai de si mesmo diretamente (ciclo de profundidade 1).
-- Ciclos mais profundos (A→B→A) são possíveis de existir apenas se
-- alguém escrever direto no banco por fora da aplicação — a Server
-- Action (updateCategory) valida ancestralidade antes de mover um nó
-- e é o único caminho de escrita do app; este CHECK cobre o caso
-- trivial sem precisar de trigger recursivo.
alter table gestor360.categories drop constraint if exists categories_not_self_parent;
alter table gestor360.categories
  add constraint categories_not_self_parent check (id <> parent_id);

-- ────────────────────────────────────────────────────────────────
-- Dados: as ~11 categorias de sistema existentes NÃO são
-- reparentadas automaticamente por este script. Decisão: elas
-- permanecem como RAÍZES (parent_id null) — exatamente o que já são
-- hoje, então esta migration é 100% aditiva e sem efeito colateral
-- nos dados de quem já usa o app (nenhum total muda, nenhuma tela
-- quebra, nada precisa ser reprocessado).
--
-- Por que não criar aqui 2 raízes "Receitas"/"Despesas" e mover as
-- categorias existentes para baixo delas: isso mudaria a
-- profundidade de TODAS as categorias hoje "de nível 0" para "nível
-- 1" para TODO usuário já cadastrado, de forma silenciosa numa
-- migration — inclusive reordenando/reagrupando uma tela que o
-- usuário já pode ter customizado (cores, nomes). Preferimos que
-- essa reorganização (se o usuário quiser) seja um gesto explícito
-- na UI de plano de contas (arrastar categorias para dentro de novos
-- nós "Receitas"/"Despesas" criados por ele, ou por uma ação
-- dedicada no futuro) — mais seguro e mais transparente do que uma
-- migration de dados silenciosa. Bootstrap de USUÁRIO NOVO (função
-- gestor360.bootstrap_user, migration 0001_schema_gestor360.sql)
-- continua semeando as categorias padrão como raízes; se no futuro
-- quisermos que usuários novos já nasçam com "Receitas"/"Despesas"
-- como raízes-agrupadoras, isso é uma alteração naquela função, não
-- deste script de migração de schema.
-- ════════════════════════════════════════════════════════════════
