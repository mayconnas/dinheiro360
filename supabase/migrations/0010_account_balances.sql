-- ════════════════════════════════════════════════════════════════
-- Gestor Financeiro 360 — Fase 10: saldos/limites reais da conta
--
-- Objetivo de produto: o Painel 360 (visão TENHO vs DEVO) precisa do
-- saldo REAL de cada conta e da dívida REAL de cada cartão, vindos
-- direto da Pluggy — hoje gestor360.accounts só guarda
-- opening_balance (sempre gravado como 0 pelo sync) e não distingue
-- "conta banco" de "cartão de crédito" além do `kind` livre. Sem
-- isso, "o que TENHO" (saldo bancos + investimentos) e "o que DEVO"
-- (fatura dos cartões) não têm de onde vir.
--
-- Este script é 100% ADITIVO: só acrescenta colunas nullable a uma
-- tabela existente. Nenhum dado é migrado/recalculado aqui — quem
-- preenche os campos novos é o PRÓXIMO sync de cada conta (ver
-- upsert de conta em src/lib/pluggy/sync.ts); linhas existentes ficam
-- com os campos novos NULL até o usuário rodar um sync (fora do
-- escopo desta migration — não reprocessamos automaticamente).
--
-- Campos novos:
--   • current_balance          — saldo/dívida REAL da conta na
--     Pluggy no momento do último sync (accounts.balance da API).
--     Para conta BANK é o saldo disponível; para CREDIT é a dívida
--     atual da fatura (positivo = quanto se deve). NÃO confundir com
--     opening_balance (saldo inicial informado manualmente, usado
--     como ponto de partida para o saldo DERIVADO das transações) —
--     current_balance é a fonte de verdade externa, current_balance
--     e opening_balance podem divergir e isso é esperado/normal.
--   • account_type              — 'bank'|'credit'|'investment',
--     derivado do `type` da Pluggy (BANK/CREDIT/INVESTMENT). Mais
--     granular que `kind` (que é uma taxonomia própria do produto,
--     livre para conta manual) — account_type só existe para conta
--     sincronizada via Open Finance.
--   • institution                — nome LIMPO do banco/emissor (ex
--     "Mercado Pago", "Bradesco", "Nubank"), derivado por
--     src/lib/engine/bank-name.ts:cleanInstitution. Existe para
--     permitir agrupar/filtrar por banco sem repetir a heurística de
--     limpeza de nome toda vez que a tela renderiza.
--   • credit_limit, credit_available, credit_minimum_payment,
--     credit_due_date, card_brand — espelham creditData da Pluggy
--     (creditLimit, availableCreditLimit, minimumPayment,
--     balanceDueDate, brand). NULL para conta que não é cartão.
--   • card_last4                — últimos 4 dígitos do cartão,
--     derivados de accounts.number quando account_type='credit'.
--   • number                    — número bruto da Pluggy: agência/
--     conta (conta banco) ou dígitos identificadores do cartão.
--   • owner                     — nome do titular da conta segundo a
--     Pluggy (accounts.owner) — informativo, não usado por regra de
--     negócio (o CPF do dono para a regra de transferência interna é
--     uma constante fixa no código, ver src/lib/engine/transfers.ts).
--
-- account_type usa CHECK (não enum Postgres) para ficar consistente
-- com o padrão já usado em `kind`/`origin`/etc no resto do schema
-- (ver migrations 0001/0005) — simples de alterar via migration
-- aditiva se a Pluggy introduzir um novo `type` no futuro.
-- ════════════════════════════════════════════════════════════════

alter table gestor360.accounts
  add column if not exists current_balance numeric(14,2);

alter table gestor360.accounts
  add column if not exists account_type text
    check (account_type is null or account_type in ('bank','credit','investment'));

alter table gestor360.accounts
  add column if not exists institution text;

alter table gestor360.accounts
  add column if not exists credit_limit numeric(14,2);

alter table gestor360.accounts
  add column if not exists credit_available numeric(14,2);

alter table gestor360.accounts
  add column if not exists credit_minimum_payment numeric(14,2);

alter table gestor360.accounts
  add column if not exists credit_due_date date;

alter table gestor360.accounts
  add column if not exists card_brand text;

alter table gestor360.accounts
  add column if not exists card_last4 text;

alter table gestor360.accounts
  add column if not exists number text;

alter table gestor360.accounts
  add column if not exists owner text;

comment on column gestor360.accounts.current_balance is
  'Saldo/dívida REAL da conta segundo a Pluggy (accounts.balance da API) no momento do último sync. Conta BANK = saldo disponível; conta CREDIT = dívida atual da fatura (positivo = quanto se deve). Distinto de opening_balance (saldo inicial manual, ponto de partida do saldo derivado das transações). NULL até o próximo sync preencher (aditivo, não retroativo).';
comment on column gestor360.accounts.account_type is
  'bank|credit|investment — derivado do `type` da Pluggy (BANK/CREDIT/INVESTMENT). Mais granular que `kind` (taxonomia livre do produto, também usada por conta manual). NULL para conta manual/nunca sincronizada.';
comment on column gestor360.accounts.institution is
  'Nome LIMPO do banco/emissor (ex "Mercado Pago","Bradesco","Nubank"), derivado por src/lib/engine/bank-name.ts:cleanInstitution a partir do código COMPE (bankData.transferNumber) ou do nome/marketingName da conta. Só para exibição/agrupamento — nunca usado em cálculo de saldo/dívida.';
comment on column gestor360.accounts.credit_limit is
  'Limite total do cartão (creditData.creditLimit da Pluggy). NULL se account_type != credit.';
comment on column gestor360.accounts.credit_available is
  'Limite disponível do cartão (creditData.availableCreditLimit da Pluggy). NULL se account_type != credit.';
comment on column gestor360.accounts.credit_minimum_payment is
  'Valor mínimo da fatura atual (creditData.minimumPayment da Pluggy). NULL se account_type != credit.';
comment on column gestor360.accounts.credit_due_date is
  'Data de vencimento da fatura atual (creditData.balanceDueDate da Pluggy). NULL se account_type != credit.';
comment on column gestor360.accounts.card_brand is
  'Bandeira do cartão (creditData.brand da Pluggy, ex "VISA","MASTERCARD"). NULL se account_type != credit.';
comment on column gestor360.accounts.card_last4 is
  'Últimos 4 dígitos do cartão, derivados de accounts.number quando account_type=credit. NULL se account_type != credit.';
comment on column gestor360.accounts.number is
  'Número bruto da Pluggy: agência/conta (conta banco) ou dígitos identificadores do cartão. Puramente informativo/exibição.';
comment on column gestor360.accounts.owner is
  'Nome do titular da conta segundo a Pluggy (accounts.owner da API). Informativo — NÃO é usado pela regra de transferência interna (CPF do dono é constante fixa no código, ver src/lib/engine/transfers.ts).';

-- Índice usado pelo filtro/agrupamento "por banco" (ex.: listConnections
-- em src/app/actions/pluggy.ts, e futura tela de painel 360).
create index if not exists accounts_user_institution_idx
  on gestor360.accounts(user_id, institution);
