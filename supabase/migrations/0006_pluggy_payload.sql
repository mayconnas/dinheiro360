-- ════════════════════════════════════════════════════════════════
-- Gestor Financeiro 360 — Fase 8: Payload completo da Pluggy
--
-- Contexto: a API /v2/transactions da Pluggy devolve MUITO mais do
-- que o codigo hoje captura. A interface PluggyTransaction (antiga,
-- em src/lib/pluggy/client.ts) so declarava id/accountId/amount/date/
-- description/type/currencyCode/category — TUDO o resto (paymentData
-- completo com payer/receiver/CPF-CNPJ, operationType,
-- creditCardMetadata, merchant, providerCode/Id, balance, status,
-- descriptionRaw, amountInAccountCurrency, createdAt/updatedAt, etc.)
-- era descartado no parse antes mesmo de chegar perto do banco.
--
-- Diretriz do usuario: "Todas as informacoes do retorno tem que
-- salvar na tabela do banco de dados para depois servir de dados."
-- Ou seja, a partir de agora:
--  1. Guardamos o PAYLOAD BRUTO (JSON completo) de cada transacao
--     Pluggy em raw_payload — fonte de verdade, nunca mais perde
--     campo, mesmo que a Pluggy adicione algo novo no futuro que
--     ainda nao tem coluna dedicada.
--  2. Extraimos os campos mais uteis para colunas proprias, para
--     poder filtrar/agrupar/indexar sem ter que fazer parse de JSON
--     toda hora (operation_type, contraparte, merchant, categoria
--     Pluggy).
--
-- payment_method (pix/credito/debito/boleto/transferencia) e a
-- coluna correspondente ao enum PaymentMethod JA FORAM criados pela
-- 0005_payment_method.sql — esta migration NAO recria essa coluna,
-- so complementa com o restante do payload que ainda faltava.
--
-- Segue EXATAMENTE as convencoes da 0001/0004/0005:
--  1. Tudo em `gestor360.*`.
--  2. Todas as colunas NULLABLE — desconhecido/ausente e o padrao
--     (transacao manual, CSV, ou lancamento sincronizado antes desta
--     migration). raw_payload fica null para origin='manual'/'import'.
--  3. CHECK apenas onde ha um enum fechado (nenhum aqui alem do que a
--     0005 ja cobre); os demais campos sao texto livre vindo direto
--     da API.
--  4. Nenhum grant novo: colunas herdam RLS + grants ja existentes da
--     tabela `transactions` (0001). raw_payload (jsonb) tambem herda
--     a mesma RLS por dono (user_id = auth.uid()) — nao ha policy
--     separada por coluna no Postgres, a linha inteira e protegida.
-- ════════════════════════════════════════════════════════════════

-- ─── Payload bruto completo (fonte de verdade) ─────────────────
alter table gestor360.transactions
  add column if not exists raw_payload jsonb;

comment on column gestor360.transactions.raw_payload is
  'Payload COMPLETO da transacao, exatamente como devolvido por '
  'GET /v2/transactions da Pluggy (id, descriptionRaw, currencyCode, '
  'amountInAccountCurrency, balance, providerCode, status, '
  'paymentData completo, operationType/operationTypeAdditionalInfo, '
  'creditCardMetadata, merchant, providerId, order, createdAt, '
  'updatedAt, etc.). Fonte de verdade: nunca mais perder um campo, '
  'mesmo que a API adicione algo novo sem termos coluna dedicada '
  'ainda. NULL para transacoes origin=manual/import (nao vem da '
  'Pluggy).';

-- ─── Forma de pagamento (coluna ja existe — ver 0005) ──────────
-- payment_method text, check (pix|credito|debito|boleto|transferencia),
-- criada em 0005_payment_method.sql. Mantida aqui apenas documentada
-- por completude do payload; NAO recriada.

-- ─── Campos extraidos do payload para consulta direta ──────────
alter table gestor360.transactions
  add column if not exists operation_type text;
comment on column gestor360.transactions.operation_type is
  'operationType cru da Pluggy (ex.: PIX, RESGATE_APLIC_FINANCEIRA, '
  'OPERACAO_CREDITO, OUTROS, ...) — mais granular que payment_method, '
  'usado para futuras regras de categorizacao. NULL quando ausente '
  'no payload ou transacao nao-Pluggy.';

alter table gestor360.transactions
  add column if not exists counterparty_document text;
comment on column gestor360.transactions.counterparty_document is
  'CPF (11 digitos) ou CNPJ (14 digitos) da contraparte da transacao, '
  'extraido de paymentData.receiver.documentNumber.value (transacao '
  'DEBIT/saida) ou paymentData.payer.documentNumber.value (transacao '
  'CREDIT/entrada). Apenas digitos, sem mascara. NULL quando a API '
  'nao trouxe o dado ou transacao nao-Pluggy.';

alter table gestor360.transactions
  add column if not exists counterparty_name text;
comment on column gestor360.transactions.counterparty_name is
  'Nome da contraparte quando a API traz estruturado: '
  'paymentData.receiver.name / paymentData.payer.name, com fallback '
  'para merchant.name quando nao ha payer/receiver (ex.: compra no '
  'cartao). Ver tambem gestor360.payees (0004) para o catalogo '
  'deduplicado — esta coluna e o valor cru desta transacao '
  'especifica. NULL quando ausente ou transacao nao-Pluggy.';

alter table gestor360.transactions
  add column if not exists merchant_name text;
comment on column gestor360.transactions.merchant_name is
  'merchant.name (ou merchant.businessName como fallback) do payload '
  'Pluggy — presente principalmente em compras no cartao de credito '
  '(creditCardMetadata != null). Distinto de counterparty_name: um '
  'merchant e sempre um estabelecimento, nao uma pessoa fisica. NULL '
  'quando a transacao nao tem merchant ou nao e da Pluggy.';

alter table gestor360.transactions
  add column if not exists pluggy_category text;
comment on column gestor360.transactions.pluggy_category is
  'category (texto legivel) devolvido pela Pluggy para a transacao '
  '— categorizacao automatica da propria Pluggy, independente da '
  'category_id interna do Gestor 360 (gestor360.categories). Util '
  'como sinal para melhorar/auditar a categorizacao futura. NULL '
  'quando ausente ou transacao nao-Pluggy.';

alter table gestor360.transactions
  add column if not exists pluggy_category_id text;
comment on column gestor360.transactions.pluggy_category_id is
  'categoryId (identificador estavel da taxonomia da Pluggy) '
  'correspondente a pluggy_category — preferir este campo para '
  'joins/agrupamentos programaticos, ja que o texto de category pode '
  'variar entre idiomas/versoes da API. NULL quando ausente ou '
  'transacao nao-Pluggy.';

-- ════════════════════════════════════════════════════════════════
-- Indices: nenhum novo por enquanto. Um indice GIN em raw_payload
-- (ex.: `create index ... using gin (raw_payload jsonb_path_ops)`)
-- pode ser adicionado depois SE/QUANDO houver necessidade real de
-- filtrar/buscar dentro do JSON no banco — hoje o consumo e via
-- colunas extraidas (operation_type, counterparty_*, merchant_name,
-- pluggy_category*) ou leitura do payload inteiro no app, entao o
-- indice pagaria custo de escrita sem beneficio medido. Reavaliar
-- se surgir uma query real com `where raw_payload @> ...` /
-- `raw_payload -> ... ` em ponto quente.
-- ════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- RLS / grants: nenhuma mudanca necessaria. Todas as colunas acima
-- pertencem a gestor360.transactions, que ja tem RLS por dono
-- (transactions_owner, criada na 0001) e os grants padrao do schema
-- (anon/authenticated/service_role) — coluna nova numa tabela
-- existente herda a mesma policy de linha automaticamente no
-- Postgres/RLS (nao ha "RLS por coluna").
-- ════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- NOTA: esta migration SO abre as colunas. Dois trabalhos separados
-- ficam para os proximos agentes:
--  1. Codigo (client.ts/pluggy.ts/normalizer.ts/sync.ts) passa a
--     capturar+propagar+persistir todos esses campos em toda NOVA
--     sincronizacao a partir de agora.
--  2. Um RE-SYNC/backfill (server action disparada por botao, NUNCA
--     rodado direto no banco por este agente) re-busca as ~1411
--     transacoes ja importadas na API /v2/transactions e preenche
--     estas colunas + raw_payload nos registros existentes, casando
--     por external_id (chave ja usada para nao duplicar, ver indice
--     unico transactions_external_uidx da 0001). Nao ha necessidade
--     de o usuario reconectar a conta — o item Pluggy ja esta ATIVO
--     (status UPDATED) e a API historica continua acessivel.
-- ════════════════════════════════════════════════════════════════
