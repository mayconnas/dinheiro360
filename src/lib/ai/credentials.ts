// ─────────────────────────────────────────────────────────────
// Camada 4 — leitura da credencial de IA ATIVA do usuário (a que
// responde no Gestor). Roda SOMENTE no servidor.
//
// A api_key retornada aqui é para CONSUMO INTERNO (brain.ts -> callProvider).
// NUNCA repasse o retorno desta função para o client/UI — para a UI use
// getAICredentialsStatus (src/app/actions/ai-credentials.ts), mascarado.
// A cifragem/decifragem fica em src/lib/ai/credential-store.ts.
// ─────────────────────────────────────────────────────────────
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { readCredential } from "./credential-store";
import { AI_PROVIDERS, type AiProvider } from "./provider-meta";
import { logger } from "@/lib/observability/logger";

const log = logger.child({ module: "ai-credentials" });

export interface ActiveCredential {
  provider: AiProvider;
  apiKey: string;
  /** Override de modelo do usuário; null/undefined = usa DEFAULT_MODELS. */
  model: string | null;
}

/**
 * Credencial de IA ATIVA do usuário, ou null se não houver (o chamador
 * cai no fallback da env ANTHROPIC_API_KEY). A TypeSafe nunca é "ativa"
 * (CHECK da migration 0011), então nunca aparece aqui.
 */
export async function getActiveCredential(userId: string): Promise<ActiveCredential | null> {
  try {
    const supabase = await createClient();
    const cred = await readCredential(supabase, userId, { active: true });
    if (!cred || !(AI_PROVIDERS as readonly string[]).includes(cred.provider)) return null;
    return { provider: cred.provider as AiProvider, apiKey: cred.apiKey, model: cred.model };
  } catch (e) {
    // Falha de leitura/decifragem não derruba o app — cai no fallback.
    log.error("leitura da credencial ativa falhou", { err: e });
    return null;
  }
}
