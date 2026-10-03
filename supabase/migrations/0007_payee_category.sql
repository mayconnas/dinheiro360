-- ════════════════════════════════════════════════════════════════
-- Gestor Financeiro 360 — Fase 7: Categoria padrão do destinatário
--
-- Objetivo de produto: em vez de categorizar transação a transação, o
-- usuário amarra um DESTINATÁRIO (payee) a uma categoria padrão, e
-- TODAS as transações daquele destinatário — passadas e futuras —
-- ficam naquela categoria automaticamente.
--
--  • gestor360.payees ganha default_category_id (nullable). Quando
--    preenchida:
--     - setPayeeCategory() (src/app/actions/payees.ts) aplica na hora
--       a todas as transações passadas desse payee;
--     - toda transação NOVA (manual/import/Pluggy), ao resolver o
--       payee_id, herda essa categoria automaticamente — ver
--       resolveDefaultCategoryForPayee() em src/lib/data/payees-repo.ts,
--       chamada a partir de addTransaction/importCSV/runPluggySync.
--  • on delete set null: se a categoria referenciada for excluída
--    (deleteCategory em src/app/actions/config.ts), o vínculo do
--    payee cai sozinho — nunca fica apontando para uma categoria
--    inexistente. deleteCategory() já move as transações da categoria
--    para "A revisar" antes de excluir; o default_category_id do payee
--    é responsabilidade separada e some via este ON DELETE SET NULL.
-- ════════════════════════════════════════════════════════════════

alter table gestor360.payees
  add column if not exists default_category_id uuid
    references gestor360.categories(id) on delete set null;

comment on column gestor360.payees.default_category_id is
  'Categoria padrão do destinatário: toda transação dele (passada, ao ser amarrada, e futura, na ingestão) herda esta categoria automaticamente. NULL = sem vínculo automático, categorização segue o fluxo normal (categorizador/regras).';

-- Índice: listPayees/telas que filtram "destinatários já amarrados a
-- uma categoria" (ou joins categoria → payees) se beneficiam; tabela
-- pequena por usuário, mas o índice é barato e evita scan completo.
create index if not exists payees_default_category_idx
  on gestor360.payees(default_category_id)
  where default_category_id is not null;
