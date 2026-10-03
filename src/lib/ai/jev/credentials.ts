// ─────────────────────────────────────────────────────────────
// Camada 4 — credencial da TypeSafe (Jev). Roda SOMENTE no servidor.
//
// Ordem: 1) chave própria do usuário em gestor360.ai_credentials
// (provider = 'typesafe', migration 0011); 2) fallback da env var
// TYPESAFE_API_KEY (+ TYPESAFE_MODEL), no mesmo espírito do
// ANTHROPIC_API_KEY em src/lib/ai/brain.ts.
//
// A linha 'typesafe' nunca é is_active (CHECK da 0011), então
// getActiveCredential() — que alimenta o chat do Gestor — nunca a vê.
//
// A api_key retornada aqui é para CONSUMO INTERNO. Nunca repasse para
// o client; para a UI use getJevStatus() (mascarado).
// ─────────────────────────────────────────────────────────────
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { JEV_DEFAULT_MODEL } from "./config";

export const TYPESAFE_PROVIDER = "typesafe";

export interface TypeSafeCredential {
  apiKey: string;
  model: string;
  source: "user" | "env";
}

export async function getTypeSafeCredential(userId: string): Promise<TypeSafeCredential | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_credentials")
    .select("api_key,model")
    .eq("user_id", userId)
    .eq("provider", TYPESAFE_PROVIDER)
    .maybeSingle();

  if (error) {
    // Falha de leitura não derruba a tela — cai no fallback da env.
    console.error("[ai/jev] getTypeSafeCredential falhou:", error.message);
  } else if (data?.api_key) {
    return {
      apiKey: String(data.api_key),
      model: (data.model as string | null)?.trim() || envModel(),
      source: "user",
    };
  }

  const envKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!envKey) return null;
  return { apiKey: envKey, model: envModel(), source: "env" };
}

function envModel(): string {
  return process.env.TYPESAFE_MODEL?.trim() || JEV_DEFAULT_MODEL;
}
