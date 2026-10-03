-- ════════════════════════════════════════════════════════════════
-- Gestor Financeiro 360 — Fase 9: Mais campos extraídos do payload
-- Pluggy (status + indicador de cartão de crédito)
--
-- Contexto: transactions.raw_payload (jsonb, ver 0006) já guarda o
-- JSON COMPLETO devolvido por GET /v2/transactions — nada é
-- descartado. Mas dois campos úteis para filtro/consulta direta
-- ainda só existem dentro do JSON, sem coluna própria:
--
--  • status ("POSTED"/"PENDING" na Pluggy) — permite filtrar
--    lançamentos ainda não efetivados sem abrir o JSON.
--  • creditCardMetadata != null — indica que a transação é de
--    fatura de cartão de crédito. Já é usado hoje só em memória por
--    mapPluggyPaymentMethod (src/lib/engine/payment-method.ts) para
--    decidir payment_method='credito', mas o sinal cru em si nunca
--    virou coluna — não dá pra, por exemplo, filtrar "todas as
--    transações de cartão de crédito" sem reconstituir essa lógica.
--
-- Segue EXATAMENTE as convenções da 0001/0004/0005/0006:
--  1. Tudo em `gestor360.*`.
--  2. Colunas NULLABLE — desconhecido/ausente é o padrão (transação
--     manual, CSV, ou lançamento sincronizado antes desta migration).
--  3. CHECK apenas no enum fechado que a própria Pluggy documenta
--     (status). has_credit_card é boolean simples, sem CHECK.
--  4. Nenhum grant novo: colunas herdam RLS + grants já existentes
--     da tabela `transactions` (0001).
--
-- payment_method, operation_type e counterparty_document JÁ EXISTEM
-- (0005/0006) — esta migration NÃO as recria, só complementa.
-- ════════════════════════════════════════════════════════════════

-- ─── Status do lançamento na Pluggy (POSTED/PENDING) ───────────
alter table gestor360.transactions
  add column if not exists status text
    check (status is null or status in ('POSTED', 'PENDING'));

comment on column gestor360.transactions.status is
  'status cru da Pluggy: POSTED (lançamento efetivado/compensado) ou '
  'PENDING (ainda pendente/a compensar, comum em compras de cartão '
  'recém-feitas). NULL quando a API não trouxe o campo ou transação '
  'não-Pluggy (manual/import). Ver tx.status em '
  'src/lib/engine/pluggy.ts.';

-- ─── Indicador de fatura de cartão de crédito ──────────────────
alter table gestor360.transactions
  add column if not exists has_credit_card boolean;

comment on column gestor360.transactions.has_credit_card is
  'true quando o payload da Pluggy trouxe creditCardMetadata '
  '(transação é de fatura de cartão de crédito), false quando o '
  'payload Pluggy trouxe a transação sem creditCardMetadata, NULL '
  'para transação não-Pluggy (manual/import) ou sincronizada antes '
  'desta coluna existir. Mesmo sinal já usado por '
  'mapPluggyPaymentMethod (src/lib/engine/payment-method.ts) para '
  'decidir payment_method=''credito'', agora também persistido como '
  'coluna própria para filtro/agrupamento direto sem reconstituir '
  'essa lógica.';

-- ════════════════════════════════════════════════════════════════
-- NOTA: esta migration SÓ abre as colunas. Como nas anteriores
-- (0005/0006), quem preenche é o código (pluggyConnector →
-- normalize → sync/reprocess) a partir da próxima sincronização.
-- Lançamentos já importados só ganham os novos campos via o
-- reprocessamento retroativo (rota /api/pluggy/reprocess, Bearer
-- CRON_SECRET, casando por external_id — ver
-- src/lib/pluggy/reprocess.ts), disparado manualmente, não por
-- esta migration.
-- ════════════════════════════════════════════════════════════════
