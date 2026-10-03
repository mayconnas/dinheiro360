-- ════════════════════════════════════════════════════════════════
-- Gestor Financeiro 360 — Fase 6: Cadastro de Destinatários (Payees)
--
-- Estende o schema `gestor360` (0001/0002/0003) com o catálogo de
-- "com quem o usuário transaciona" — pessoas, empresas e
-- estabelecimentos. Segue EXATAMENTE as convenções da 0001:
--  1. Tudo em `gestor360.*` (nunca `public.*`).
--  2. NAO cria trigger em auth.users (schema compartilhado!).
--  3. RLS por dono (user_id = auth.uid()) na tabela do usuário.
--  4. Grants idênticos às demais para anon/authenticated/service_role.
--
-- Novidades desta migration:
--  • gestor360.payees — 1 linha por contraparte distinta do usuário
--    (pessoa/empresa/estabelecimento). Idempotência via UNIQUE
--    (user_id, normalized_name): o "verifique se já existe, se não
--    existir crie" do produto vira um upsert onConflict nessa chave.
--  • gestor360.transactions ganha payee_id (nullable, SET NULL on
--    delete) — o vínculo transação → destinatário.
-- ════════════════════════════════════════════════════════════════

-- ─── Destinatários / Contrapartes ──────────────────────────────
create table if not exists gestor360.payees (
  id               uuid primary key default extensions.gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  -- nome de exibição (Title Case / como veio da fonte mais confiável)
  name             text not null,
  -- chave de dedup: minúsculo, sem acento, sem ruído (ver
  -- src/lib/engine/payee.ts:normalizePayeeName). NUNCA vazio.
  normalized_name  text not null,
  -- CPF (11 dígitos) ou CNPJ (14 dígitos) quando veio do
  -- paymentData da Pluggy (payer/receiver.documentNumber).
  document_number  text,
  kind             text not null default 'desconhecido'
                     check (kind in ('pessoa','empresa','estabelecimento','desconhecido')),
  first_seen       date,
  last_seen        date,
  tx_count         integer not null default 0,
  total_paid       numeric(14,2) not null default 0,
  total_received   numeric(14,2) not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- idempotência: "verifique se já existe" = upsert onConflict
  -- "user_id,normalized_name".
  unique (user_id, normalized_name)
);
create index if not exists payees_user_idx on gestor360.payees(user_id);
create index if not exists payees_user_last_seen_idx on gestor360.payees(user_id, last_seen desc);

-- ─── Vínculo transação → destinatário ──────────────────────────
alter table gestor360.transactions
  add column if not exists payee_id uuid references gestor360.payees(id) on delete set null;
create index if not exists transactions_payee_idx on gestor360.transactions(payee_id);

-- ─── updated_at automático (reusa a função criada na 0001) ─────
drop trigger if exists payees_touch on gestor360.payees;
create trigger payees_touch before update on gestor360.payees
  for each row execute function gestor360.touch_updated_at();

-- ════════════════════════════════════════════════════════════════
-- RLS — mesmo padrão da 0001/0002/0003.
-- ════════════════════════════════════════════════════════════════
alter table gestor360.payees enable row level security;

drop policy if exists payees_owner on gestor360.payees;
create policy payees_owner on gestor360.payees
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ════════════════════════════════════════════════════════════════
-- Permissões para os roles do Supabase — idênticas às demais, para
-- alcançar a tabela nova (grant "all tables" já pega esta também, mas
-- repetimos para deixar a intenção explícita e idempotente).
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
-- NOTA: o backfill retroativo (~1411 transações já importadas) roda
-- via server action (backfillPayees(), disparada por botão na UI),
-- NUNCA direto no banco de produção por este agente. Toda nova
-- transação (manual/CSV/Pluggy) passa a resolver/criar o payee no
-- momento da inserção — ver src/lib/engine/payee.ts para o
-- extrator/normalizador puro usado nos dois caminhos.
-- ════════════════════════════════════════════════════════════════
