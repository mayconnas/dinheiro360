-- ════════════════════════════════════════════════════════════════
-- Gestor Financeiro 360 — Schema ISOLADO em `gestor360`
--
-- Variante da 0001 para rodar num Supabase COMPARTILHADO (a VPS ja tem
-- outros projetos em `public`, `bolao`, `leads`, `repetly`). Tudo do
-- Gestor 360 vive em `gestor360`, sem tocar em nenhum outro schema.
--
-- Diferencas vs. a 0001 original:
--  1. Todas as tabelas em `gestor360.*` (nao `public.*`).
--  2. NAO cria trigger em auth.users (compartilhado!). O bootstrap de
--     novo usuario vira a funcao gestor360.bootstrap_user(), chamada
--     pelo app no primeiro login — sem efeito colateral nos outros apps.
--  3. `gestor360` exposto na API do PostgREST exige adicionar o schema
--     ao PGRST_DB_SCHEMAS do Supabase (ver nota no fim). Ate la, o acesso
--     e via service_role / SQL direto.
-- ════════════════════════════════════════════════════════════════

create schema if not exists gestor360;
create extension if not exists "pgcrypto" with schema extensions;

-- ─── Perfil (2.4) ─────────────────────────────────────────────
create table if not exists gestor360.profiles (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  monthly_income  numeric(14,2) not null default 0,
  employment_type text not null default 'clt' check (employment_type in ('clt','autonomo','misto')),
  dependents      integer not null default 0,
  priority_ladder text[] not null default array[
    'Sair do vermelho','Construir reserva','Matar dívida cara','Otimizar e investir'
  ],
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─── Contas (2.3) ─────────────────────────────────────────────
create table if not exists gestor360.accounts (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  kind            text not null default 'corrente'
                    check (kind in ('corrente','poupanca','carteira','investimento','cartao')),
  opening_balance numeric(14,2) not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists accounts_user_idx on gestor360.accounts(user_id);

-- ─── Categorias (2.2 / 2.4) ───────────────────────────────────
create table if not exists gestor360.categories (
  id        uuid primary key default extensions.gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  name      text not null,
  kind      text not null default 'despesa' check (kind in ('receita','despesa')),
  nature    text not null default 'variavel'
              check (nature in ('fixa','variavel','discricionaria','receita')),
  color     text not null default '#64748b',
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists categories_user_idx on gestor360.categories(user_id);

-- ─── Regras de categorizacao (2.2 — R4/R5) ────────────────────
create table if not exists gestor360.category_rules (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  pattern     text not null,
  category_id uuid not null references gestor360.categories(id) on delete cascade,
  source      text not null default 'manual' check (source in ('manual','learned')),
  created_at  timestamptz not null default now()
);
create index if not exists category_rules_user_idx on gestor360.category_rules(user_id);

-- ─── Transacoes (2.1 — fonte da verdade) ──────────────────────
create table if not exists gestor360.transactions (
  id               uuid primary key default extensions.gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  date             date not null,
  amount           numeric(14,2) not null check (amount >= 0),
  type             text not null check (type in ('entrada','saida')),
  description      text not null,
  raw_description  text not null default '',
  category_id      uuid references gestor360.categories(id) on delete set null,
  account_id       uuid references gestor360.accounts(id) on delete set null,
  origin           text not null default 'manual'
                     check (origin in ('manual','import','open_finance')),
  is_duplicate     boolean not null default false,
  needs_review     boolean not null default false,
  external_id      text,
  created_at       timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on gestor360.transactions(user_id, date desc);
create index if not exists transactions_user_cat_idx  on gestor360.transactions(user_id, category_id);
create unique index if not exists transactions_external_uidx
  on gestor360.transactions(user_id, origin, external_id)
  where external_id is not null;

-- ─── Orcamento (3.1) ──────────────────────────────────────────
create table if not exists gestor360.budgets (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references gestor360.categories(id) on delete cascade,
  monthly_limit numeric(14,2) not null check (monthly_limit >= 0),
  created_at  timestamptz not null default now(),
  unique (user_id, category_id)
);
create index if not exists budgets_user_idx on gestor360.budgets(user_id);

-- ─── Metas (2.4 / 4.4) ────────────────────────────────────────
create table if not exists gestor360.goals (
  id             uuid primary key default extensions.gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null,
  target_amount  numeric(14,2) not null check (target_amount >= 0),
  current_amount numeric(14,2) not null default 0,
  deadline       date,
  created_at     timestamptz not null default now()
);
create index if not exists goals_user_idx on gestor360.goals(user_id);

-- ─── updated_at automatico ────────────────────────────────────
create or replace function gestor360.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_touch on gestor360.profiles;
create trigger profiles_touch before update on gestor360.profiles
  for each row execute function gestor360.touch_updated_at();

-- ════════════════════════════════════════════════════════════════
-- RLS — cada usuario so ve o que e dele (isolado neste schema).
-- ════════════════════════════════════════════════════════════════
alter table gestor360.profiles       enable row level security;
alter table gestor360.accounts       enable row level security;
alter table gestor360.categories     enable row level security;
alter table gestor360.category_rules enable row level security;
alter table gestor360.transactions   enable row level security;
alter table gestor360.budgets        enable row level security;
alter table gestor360.goals          enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','accounts','categories','category_rules','transactions','budgets','goals'
  ] loop
    execute format('drop policy if exists %I_owner on gestor360.%I;', t, t);
    execute format($f$
      create policy %I_owner on gestor360.%I
        for all using (user_id = auth.uid()) with check (user_id = auth.uid());
    $f$, t, t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════
-- Bootstrap de novo usuario — SEM trigger em auth.users (compartilhado).
-- O app chama gestor360.bootstrap_user() no primeiro login do usuario.
-- Idempotente: se ja existe perfil, nao faz nada.
-- ════════════════════════════════════════════════════════════════
create or replace function gestor360.bootstrap_user(p_display_name text default null)
returns void
language plpgsql
security definer set search_path = gestor360, public, extensions
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sem usuario autenticado'; end if;
  if exists (select 1 from gestor360.profiles where user_id = uid) then return; end if;

  insert into gestor360.profiles (user_id, display_name)
  values (uid, coalesce(p_display_name, 'Você'));

  insert into gestor360.accounts (user_id, name, kind) values
    (uid, 'Conta Corrente', 'corrente'),
    (uid, 'Carteira', 'carteira');

  insert into gestor360.categories (user_id, name, kind, nature, color, is_system) values
    (uid, 'Salário',        'receita','receita',       '#10b981', true),
    (uid, 'Outras receitas','receita','receita',       '#22c55e', true),
    (uid, 'Moradia',        'despesa','fixa',          '#6366f1', true),
    (uid, 'Contas fixas',   'despesa','fixa',          '#8b5cf6', true),
    (uid, 'Mercado',        'despesa','variavel',      '#f59e0b', true),
    (uid, 'Transporte',     'despesa','variavel',      '#06b6d4', true),
    (uid, 'Saúde',          'despesa','variavel',      '#ef4444', true),
    (uid, 'Comida fora',    'despesa','discricionaria','#f97316', true),
    (uid, 'Lazer',          'despesa','discricionaria','#ec4899', true),
    (uid, 'Assinaturas',    'despesa','discricionaria','#a855f7', true),
    (uid, 'A revisar',      'despesa','variavel',      '#94a3b8', true);
end;
$$;

-- Permissoes para os roles do Supabase acessarem o schema via API.
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
-- NOTA (pos-migration): para o app acessar `gestor360` via API REST do
-- Supabase, o schema precisa entrar em PGRST_DB_SCHEMAS (hoje tipicamente
-- "public,storage,graphql_public"). Isso e config do container, tratada
-- fora deste SQL. Ate la, o acesso e via service_role/SQL direto.
-- ════════════════════════════════════════════════════════════════
