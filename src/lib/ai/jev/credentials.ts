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
import { readCredential } from "@/lib/ai/credential-store";
import { JEV_DEFAULT_MODEL } from "./config";
import { logger } from "@/lib/observability/logger";

const log = logger.child({ module: "jev-credentials" });

export const TYPESAFE_PROVIDER = "typesafe" as const;

export interface TypeSafeCredential {
  apiKey: string;
  model: string;
  source: "user" | "env";
}

export async function getTypeSafeCredential(userId: string): Promise<TypeSafeCredential | null> {
  try {
    const supabase = await createClient();
    const cred = await readCredential(supabase, userId, { provider: TYPESAFE_PROVIDER });
    if (cred) return { apiKey: cred.apiKey, model: cred.model?.trim() || envModel(), source: "user" };
  } catch (e) {
    // Falha de leitura/decifragem não derruba a tela — cai no fallback da env.
    log.error("leitura da credencial TypeSafe falhou", { err: e });
  }

  const envKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!envKey) return null;
  return { apiKey: envKey, model: envModel(), source: "env" };
}

function envModel(): string {
  return process.env.TYPESAFE_MODEL?.trim() || JEV_DEFAULT_MODEL;
}
