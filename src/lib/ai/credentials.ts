// ─────────────────────────────────────────────────────────────
// Camada 4 — leitura da credencial de IA ativa do usuário.
// Roda SOMENTE no servidor. Lê gestor360.ai_credentials via cliente
// com sessão do usuário (RLS garante que só a própria linha é visível).
//
// A api_key retornada aqui é para CONSUMO INTERNO (brain.ts -> callProvider).
// NUNCA repasse o retorno desta função para o client/UI. Para exibir
// estado na UI, use a projeção mascarada (ver src/app/actions/ai-settings.ts,
// criado pelo agente da feature de IA).
// ─────────────────────────────────────────────────────────────
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AiProvider } from "./providers";

export interface ActiveCredential {
  provider: AiProvider;
  apiKey: string;
  /** Override de modelo do usuário; null/undefined = usa DEFAULT_MODELS. */
  model: string | null;
}

/**
 * Retorna a credencial de IA ATIVA do usuário logado, ou null se ele não
 * configurou nenhuma (nesse caso o chamador deve cair no fallback da env
 * var ANTHROPIC_API_KEY, mantendo o comportamento atual do app).
 *
 * userId é aceito por clareza de chamada (advisor.ts já resolve o userId
 * para montar o pacote de contexto) mas a consulta em si é sempre
 * escopada pela sessão via RLS — não confie em userId sozinho como
 * filtro de segurança aqui.
 */
export async function getActiveCredential(
  userId: string
): Promise<ActiveCredential | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_credentials")
    .select("provider,api_key,model")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    // Falha de leitura não deve derrubar o app — cai no fallback.
    console.error("[ai/credentials] getActiveCredential falhou:", error);
    return null;
  }
  if (!data) return null;

  return {
    provider: data.provider as AiProvider,
    apiKey: data.api_key as string,
    model: (data.model as string | null) ?? null,
  };
}
