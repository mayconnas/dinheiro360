-- ════════════════════════════════════════════════════════════════
-- Gestor Financeiro 360 — Fase 7: Forma de pagamento REAL (Open Finance)
--
-- Contexto: o badge de "forma de pagamento" (Pix/Crédito/Débito/
-- Boleto/Transferência) hoje é 100% cosmético, inferido por
-- palavras-chave sobre raw_description no cliente (ver
-- src/lib/engine/payment-method.ts:inferPaymentMethod). Em ~56% dos
-- lançamentos (793 de 1411) a raw_description não tem NENHUMA pista
-- ("aiqfome", "Atacadista Mega", "Padaria Popular"), então a
-- heurística devolve null e o badge simplesmente não aparece.
--
-- A API da Pluggy traz a forma de pagamento ESTRUTURADA
-- (paymentData.paymentMethod: PIX/TED/DOC/BOLETO/TRANSFER, e/ou
-- creditCardMetadata quando é fatura de cartão de crédito) — mas
-- esse dado nunca foi capturado nem persistido. Esta migration só
-- abre a coluna; quem passa a preenchê-la é o mapeamento em
-- src/lib/engine/payment-method.ts (mapPluggyPaymentMethod) através
-- do pluggyConnector → normalize → runPluggySync.
--
-- Segue EXATAMENTE as convenções da 0001/0004:
--  1. Tudo em `gestor360.*`.
--  2. Coluna NULLABLE — desconhecida é o padrão (transação manual,
--     CSV, ou lançamento antigo da Pluggy sincronizado antes desta
--     mudança). Quando null, a UI cai para a heurística cosmética
--     sobre rawDescription (inferPaymentMethod); nunca o contrário.
--  3. CHECK no mesmo enum do domínio (src/lib/engine/payment-method.ts
--     PaymentMethod) — trava valor inválido sem exigir NOT NULL.
--  4. Nenhum grant novo: coluna herda RLS + grants já existentes da
--     tabela `transactions` (0001).
-- ════════════════════════════════════════════════════════════════

alter table gestor360.transactions
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('pix','credito','debito','boleto','transferencia'));

comment on column gestor360.transactions.payment_method is
  'Forma de pagamento REAL, vinda estruturada da API Pluggy '
  '(paymentData.paymentMethod mapeado, ou credito quando há '
  'creditCardMetadata) — ver mapPluggyPaymentMethod em '
  'src/lib/engine/payment-method.ts. NULL quando desconhecida '
  '(transação manual/CSV, ou sincronizada antes desta coluna existir): '
  'nesse caso a UI infere um badge best-effort a partir de '
  'rawDescription (inferPaymentMethod), só para exibição.';

-- ════════════════════════════════════════════════════════════════
-- NOTA: NÃO há backfill retroativo nesta migration. Os ~1411
-- lançamentos já importados (a maioria via CSV pobre do Meu Pluggy)
-- não têm de onde vir esse dado estruturado — a única forma de
-- preenchê-los é o usuário RECONECTAR a conta via Open Finance para
-- essas transações serem ressincronizadas com paymentData completo.
-- Novas transações (e reconexões) passam a gravar payment_method a
-- partir da próxima sync após esta migration + o deploy do código
-- que a usa.
-- ════════════════════════════════════════════════════════════════
