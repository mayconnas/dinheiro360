-- ════════════════════════════════════════════════════════════════
-- Gestor Financeiro 360 — Fase 5: Credenciais de IA por usuário
--
-- Estende o schema `gestor360` (0001/0002) com o que a tela de
-- Configuracoes > Inteligencia (IA) precisa. Segue EXATAMENTE as
-- convencoes da 0001/0002:
--  1. Tudo em `gestor360.*` (nunca `public.*`).
--  2. NAO cria trigger em auth.users (schema compartilhado!).
--  3. RLS por dono (user_id = auth.uid()) na tabela do usuario.
--  4. Grants identicos aos da 0001/0002 para anon/authenticated/service_role.
--
-- Novidade desta migration:
--  • gestor360.ai_credentials — 1 linha por (usuario, provider). O
--    usuario pode cadastrar ate 4 credenciais (uma por provider) e
--    marcar UMA delas como ativa (is_active). O brain.ts le a ativa
--    no servidor; se nao houver nenhuma, cai no fallback da env var
--    ANTHROPIC_API_KEY (compatibilidade com o comportamento atual).
-- ════════════════════════════════════════════════════════════════

-- ─── Credenciais de IA (5.1) ───────────────────────────────────
create table if not exists gestor360.ai_credentials (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  provider   text not null check (provider in ('anthropic','openai','gemini','deepseek')),
  -- TRADE-OFF DE SEGURANCA (documentado, nao e descuido):
  -- a chave e gravada em texto puro nesta coluna. A protecao hoje vem de
  -- duas camadas: (1) RLS (user_id = auth.uid()) — cada usuario so
  -- enxerga a propria linha via API publica; (2) a coluna NUNCA e lida
  -- pelo client — so server actions/server components (service role ou
  -- sessao do proprio dono) leem `api_key`, e o valor devolvido pra UI
  -- e sempre mascarado (ver gestor360/src/lib/ai/credentials.ts).
  -- TODO(seguranca): migrar para criptografia em repouso (pgcrypto
  -- pgp_sym_encrypt/decrypt com chave fora do banco, ou Supabase Vault)
  -- quando essa fase entrar no roadmap. Por ora, aceitavel para o MVP.
  api_key    text not null,
  -- modelo default por provider fica no codigo (DEFAULT_MODELS em
  -- src/lib/ai/providers.ts); aqui e opcional, override por usuario.
  model      text,
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 1 credencial por (usuario, provider) — permite upsert direto com
  -- onConflict: "user_id,provider" a partir da server action.
  unique (user_id, provider)
);
create index if not exists ai_credentials_user_idx on gestor360.ai_credentials(user_id);

-- No maximo UM provider ativo por usuario: indice unico parcial em
-- (user_id) valido apenas quando is_active = true. Qualquer tentativa de
-- ativar um segundo provider para o mesmo usuario sem antes desativar o
-- anterior falha na constraint — a server action deve desativar as
-- demais linhas do usuario na mesma transacao antes de ativar a nova
-- (ou usar um UPDATE em duas etapas) para nao esbarrar nela.
create unique index if not exists ai_credentials_one_active_per_user
  on gestor360.ai_credentials(user_id)
  where is_active;

-- ─── updated_at automatico (reusa a funcao criada na 0001) ────
drop trigger if exists ai_credentials_touch on gestor360.ai_credentials;
create trigger ai_credentials_touch before update on gestor360.ai_credentials
  for each row execute function gestor360.touch_updated_at();

-- ════════════════════════════════════════════════════════════════
-- RLS — mesmo padrao da 0001/0002.
-- ════════════════════════════════════════════════════════════════
alter table gestor360.ai_credentials enable row level security;

drop policy if exists ai_credentials_owner on gestor360.ai_credentials;
create policy ai_credentials_owner on gestor360.ai_credentials
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ════════════════════════════════════════════════════════════════
-- Permissoes para os roles do Supabase — identicas as da 0001/0002, para
-- alcancar a tabela nova (grant "all tables" ja pega esta tambem, mas
-- repetimos para deixar a intencao explicita e idempotente).
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
-- NOTA: a api_key so deve ser lida server-side (server actions/server
-- components) usando a sessao do proprio usuario (RLS ja restringe) ou
-- o cliente admin (service_role, que faz bypass de RLS — usar somente
-- quando o userId ja foi resolvido por outra via confiavel). A UI NUNCA
-- recebe o valor de api_key de volta; o server action de leitura projeta
-- apenas provider, is_active, model, updated_at e um sufixo mascarado
-- (ex.: "sk-...ab12") calculado no servidor.
-- ════════════════════════════════════════════════════════════════
