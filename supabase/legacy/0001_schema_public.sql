-- ════════════════════════════════════════════════════════════════
-- Gestor Financeiro 360 — Schema (Camada 2: Núcleo de Dados / Persistência)
--
-- Rode este arquivo no SQL Editor do Supabase (uma vez).
-- Tudo aqui é multiusuário e protegido por Row Level Security:
-- cada linha carrega user_id e as políticas garantem que um usuário
-- só enxerga os próprios dados.
-- ════════════════════════════════════════════════════════════════

-- ─── Extensões ────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── Perfil (2.4) ─────────────────────────────────────────────
create table if not exists public.profiles (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  monthly_income  numeric(14,2) not null default 0,
  employment_type text not null default 'clt' check (employment_type in ('clt','autonomo','misto')),
  dependents      integer not null default 0,
  priority_ladder text[] not null default array[
    'Sair do vermelho',
    'Construir reserva',
    'Matar dívida cara',
    'Otimizar e investir'
  ],
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─── Contas (2.3) ─────────────────────────────────────────────
create table if not exists public.accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  kind            text not null default 'corrente'
                    check (kind in ('corrente','poupanca','carteira','investimento','cartao')),
  opening_balance numeric(14,2) not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists accounts_user_idx on public.accounts(user_id);

-- ─── Categorias (2.2 / 2.4) ───────────────────────────────────
create table if not exists public.categories (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  name      text not null,
  kind      text not null default 'despesa' check (kind in ('receita','despesa')),
  nature    text not null default 'variavel'
              check (nature in ('fixa','variavel','discricionaria','receita')),
  color     text not null default '#64748b',
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists categories_user_idx on public.categories(user_id);

-- ─── Regras de categorização (2.2 — R4/R5) ────────────────────
create table if not exists public.category_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  pattern     text not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  source      text not null default 'manual' check (source in ('manual','learned')),
  created_at  timestamptz not null default now()
);
create index if not exists category_rules_user_idx on public.category_rules(user_id);

-- ─── Transações (2.1 — a fonte da verdade) ────────────────────
create table if not exists public.transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  date             date not null,
  amount           numeric(14,2) not null check (amount >= 0), -- R2: sempre positivo
  type             text not null check (type in ('entrada','saida')),
  description      text not null,
  raw_description  text not null default '',
  category_id      uuid references public.categories(id) on delete set null,
  account_id       uuid references public.accounts(id) on delete set null,
  origin           text not null default 'manual'
                     check (origin in ('manual','import','open_finance')), -- R1
  is_duplicate     boolean not null default false, -- R3
  needs_review     boolean not null default false,
  external_id      text, -- id na fonte, ajuda o deduplicador
  created_at       timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on public.transactions(user_id, date desc);
create index if not exists transactions_user_cat_idx  on public.transactions(user_id, category_id);
create unique index if not exists transactions_external_uidx
  on public.transactions(user_id, origin, external_id)
  where external_id is not null;

-- ─── Orçamento (3.1) ──────────────────────────────────────────
create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  monthly_limit numeric(14,2) not null check (monthly_limit >= 0),
  created_at  timestamptz not null default now(),
  unique (user_id, category_id)
);
create index if not exists budgets_user_idx on public.budgets(user_id);

-- ─── Metas (2.4 / 4.4) ────────────────────────────────────────
create table if not exists public.goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null,
  target_amount  numeric(14,2) not null check (target_amount >= 0),
  current_amount numeric(14,2) not null default 0,
  deadline       date,
  created_at     timestamptz not null default now()
);
create index if not exists goals_user_idx on public.goals(user_id);

-- ─── updated_at automático no perfil ──────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ════════════════════════════════════════════════════════════════
-- Row Level Security — cada usuário só vê o que é dele.
-- ════════════════════════════════════════════════════════════════
alter table public.profiles       enable row level security;
alter table public.accounts       enable row level security;
alter table public.categories     enable row level security;
alter table public.category_rules enable row level security;
alter table public.transactions   enable row level security;
alter table public.budgets        enable row level security;
alter table public.goals          enable row level security;

-- Macro: uma política "dono" (select/insert/update/delete) por tabela.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','accounts','categories','category_rules',
    'transactions','budgets','goals'
  ] loop
    execute format('drop policy if exists %I_owner on public.%I;', t, t);
    -- profiles usa user_id como PK; as demais também têm user_id.
    execute format($f$
      create policy %I_owner on public.%I
        for all
        using (user_id = auth.uid())
        with check (user_id = auth.uid());
    $f$, t, t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════
-- Bootstrap de um novo usuário: cria perfil + categorias/contas padrão
-- assim que o usuário confirma o cadastro. Roda com privilégios do
-- dono da função (security definer), então ignora RLS na criação.
-- ════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (user_id) do nothing;

  insert into public.accounts (user_id, name, kind) values
    (new.id, 'Conta Corrente', 'corrente'),
    (new.id, 'Carteira', 'carteira');

  insert into public.categories (user_id, name, kind, nature, color, is_system) values
    (new.id, 'Salário',        'receita','receita',       '#10b981', true),
    (new.id, 'Outras receitas','receita','receita',       '#22c55e', true),
    (new.id, 'Moradia',        'despesa','fixa',          '#6366f1', true),
    (new.id, 'Contas fixas',   'despesa','fixa',          '#8b5cf6', true),
    (new.id, 'Mercado',        'despesa','variavel',      '#f59e0b', true),
    (new.id, 'Transporte',     'despesa','variavel',      '#06b6d4', true),
    (new.id, 'Saúde',          'despesa','variavel',      '#ef4444', true),
    (new.id, 'Comida fora',    'despesa','discricionaria','#f97316', true),
    (new.id, 'Lazer',          'despesa','discricionaria','#ec4899', true),
    (new.id, 'Assinaturas',    'despesa','discricionaria','#a855f7', true),
    (new.id, 'A revisar',      'despesa','variavel',      '#94a3b8', true);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
