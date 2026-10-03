-- ════════════════════════════════════════════════════════════════
-- Gestor Financeiro 360 — Fase 4: Open Finance via Pluggy
--
-- Estende o schema `gestor360` (0001) com o que a integracao Pluggy
-- precisa. Segue EXATAMENTE as convencoes da 0001:
--  1. Tudo em `gestor360.*` (nunca `public.*`).
--  2. NAO cria trigger em auth.users (schema compartilhado!).
--  3. RLS por dono (user_id = auth.uid()) nas tabelas do usuario.
--  4. Grants identicos aos da 0001 para anon/authenticated/service_role.
--
-- Novidades desta migration:
--  • gestor360.pluggy_items — 1 linha por conexao (Item) do usuario.
--  • gestor360.accounts ganha pluggy_account_id / pluggy_item_id.
--  • gestor360.pluggy_webhook_events — log de eventos p/ idempotencia,
--    RLS habilitado SEM policy (deny-all a clientes; so service_role
--    escreve, via bypass de RLS do service role no backend).
-- ════════════════════════════════════════════════════════════════

-- ─── Itens Pluggy (conexoes Open Finance) ─────────────────────
-- Um "Item" na Pluggy e uma conexao a uma instituicao (banco). Cada
-- usuario pode ter varios. O item_id e a chave que o webhook usa para
-- resolver item -> user, por isso ha um indice UNICO GLOBAL em item_id.
create table if not exists gestor360.pluggy_items (
  id                 uuid primary key default extensions.gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  item_id            text not null,
  connector_name     text,
  status             text,
  consent_expires_at timestamptz,
  last_synced_at     timestamptz,
  created_at         timestamptz not null default now(),
  unique (user_id, item_id)
);
create index if not exists pluggy_items_user_idx on gestor360.pluggy_items(user_id);
-- Indice UNICO GLOBAL em item_id: o webhook chega sem sessao de usuario e
-- precisa resolver item_id -> user_id de forma inequivoca.
create unique index if not exists pluggy_items_item_uidx on gestor360.pluggy_items(item_id);

-- ─── Vinculo das contas locais com as contas/itens da Pluggy ──
-- Adiciona rastreio da origem Pluggy nas contas ja existentes (0001).
alter table gestor360.accounts add column if not exists pluggy_account_id text;
alter table gestor360.accounts add column if not exists pluggy_item_id    text;
create index if not exists accounts_pluggy_account_idx on gestor360.accounts(pluggy_account_id);
create index if not exists accounts_pluggy_item_idx    on gestor360.accounts(pluggy_item_id);

-- ─── Eventos de webhook (idempotencia) ────────────────────────
-- A Pluggy pode reenviar o mesmo evento. Gravamos event_id UNICO e
-- ignoramos duplicatas. Sem RLS policy: apenas o service_role (que faz
-- bypass de RLS) escreve/le; clientes anon/authenticated ficam sem acesso.
create table if not exists gestor360.pluggy_webhook_events (
  id          uuid primary key default extensions.gen_random_uuid(),
  event_id    text not null unique,
  event       text not null,
  item_id     text,
  payload     jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create index if not exists pluggy_webhook_events_item_idx on gestor360.pluggy_webhook_events(item_id);

-- ════════════════════════════════════════════════════════════════
-- RLS — mesmo padrao da 0001.
-- ════════════════════════════════════════════════════════════════
alter table gestor360.pluggy_items          enable row level security;
-- Deny-all a clientes: RLS habilitado e NENHUMA policy criada.
-- So o service_role (usado no backend do webhook/sync) enxerga.
alter table gestor360.pluggy_webhook_events enable row level security;

drop policy if exists pluggy_items_owner on gestor360.pluggy_items;
create policy pluggy_items_owner on gestor360.pluggy_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ════════════════════════════════════════════════════════════════
-- Permissoes para os roles do Supabase — identicas as da 0001, para
-- alcancar as tabelas novas (grant "all tables" ja pega estas tambem,
-- mas repetimos para deixar a intencao explicita e idempotente).
-- ════════════════════════════════════════════════════════════════
grant usage on schema gestor360 to anon, authenticated, service_role;
grant all on all tables in schema gestor360 to anon, authenticated, service_role;
grant all on all routines in schema gestor360 to anon, authenticated, service_role;
grant all on all sequences in schema gestor360 to anon, authenticated, service_role;
alter default privileges in schema gestor360
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema gestor360
  grant all on routines to anon, authenticated, service_role;
alter default privileges in schema gestor360
  grant all on sequences to anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════
-- NOTA: o RLS deny-all em pluggy_webhook_events depende do backend usar
-- a service_role key (que faz BYPASS de RLS) para inserir/consultar os
-- eventos. Clientes anon/authenticated recebem grant de tabela mas nao
-- passam pelo RLS (sem policy => nenhuma linha visivel/gravavel).
-- ════════════════════════════════════════════════════════════════
