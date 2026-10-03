-- ════════════════════════════════════════════════════════════════
-- Gestor Financeiro 360 — Fase 11: integração TypeSafe (Jev)
--
-- O Jev (https://docs.typesafe.ai) é um modelo "System One": não
-- conversa, só toma decisões estruturadas (Choice/Score/Noul). Aqui
-- ele é usado para CATEGORIZAR lançamentos — a tela de Transações
-- manda cada lançamento + a lista de categorias (receita p/ entradas,
-- despesa p/ saídas) e recebe a categoria escolhida, a distribuição de
-- probabilidades e a confiança.
--
-- A chave do usuário reaproveita gestor360.ai_credentials (mesma RLS,
-- mesmo mascaramento, mesma regra de "api_key nunca volta pro client"),
-- com provider = 'typesafe'. Como o Jev NÃO é um LLM de chat, a linha
-- da TypeSafe nunca pode ser a credencial "ativa" — o slot ativo
-- (índice ai_credentials_one_active_per_user) continua sendo só do
-- provedor que responde no Gestor (IA). O CHECK abaixo garante isso no
-- banco, além da validação nas server actions.
--
-- Idempotente: pode rodar mais de uma vez.
-- ════════════════════════════════════════════════════════════════

-- 1) Troca o CHECK de provider (criado inline na 0003, sem nome
--    explícito) por um que aceita 'typesafe'. Procura pelo conteúdo em
--    vez de confiar no nome gerado pelo Postgres.
do $$
declare
  r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'gestor360.ai_credentials'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%provider%'
       and pg_get_constraintdef(oid) ilike '%anthropic%'
  loop
    execute format('alter table gestor360.ai_credentials drop constraint %I', r.conname);
  end loop;
end $$;

alter table gestor360.ai_credentials
  add constraint ai_credentials_provider_check
  check (provider in ('anthropic','openai','gemini','deepseek','typesafe'));

-- 2) A credencial da TypeSafe nunca ocupa o slot "ativo" do chat.
alter table gestor360.ai_credentials
  drop constraint if exists ai_credentials_typesafe_never_active;
alter table gestor360.ai_credentials
  add constraint ai_credentials_typesafe_never_active
  check (provider <> 'typesafe' or is_active = false);

comment on column gestor360.ai_credentials.provider is
  'anthropic|openai|gemini|deepseek = LLM do Gestor (IA); typesafe = Jev (categorização), nunca ativo.';
