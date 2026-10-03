// ─────────────────────────────────────────────────────────────
// Camada 4 — repositório de credenciais de IA (gestor360.ai_credentials).
//
// ÚNICO lugar que lê/escreve a coluna api_key. Antes, quatro módulos
// faziam isso por conta própria; agora todos passam por aqui, e a regra
// de segurança vive num ponto só:
//   • escrita: a chave é cifrada (AES-256-GCM, ver secret-box.ts);
//   • leitura: decifra; um valor legado em texto puro é aceito e
//     recifrado na hora ("migração preguiçosa", sem script manual);
//   • a chave em claro nunca sai do servidor — para a UI só existe o
//     resumo mascarado (listCredentialSummaries).
// ─────────────────────────────────────────────────────────────
import "server-only";
import type { DbClient, Tables } from "@/lib/supabase/database.types";
import { decryptSecret, encryptSecret, isEncrypted, maskSecret } from "@/lib/security/secret-box";

export type CredentialProvider = Tables<"ai_credentials">["provider"];

export interface StoredCredential {
  provider: CredentialProvider;
  apiKey: string;
  model: string | null;
  isActive: boolean;
}

export interface CredentialSummary {
  provider: CredentialProvider;
  model: string | null;
  isActive: boolean;
  /** "sk-...3XYZ", ou um aviso quando a chave salva não pôde ser decifrada. */
  maskedKey: string;
  /** false quando a chave existe mas não decifra (chave do servidor trocada). */
  readable: boolean;
}

const aad = (userId: string, provider: CredentialProvider) => `${userId}:${provider}`;

/** Chave em claro de UMA credencial (por provider, ou a ativa do chat). */
export async function readCredential(
  supabase: DbClient,
  userId: string,
  where: { provider: CredentialProvider } | { active: true }
): Promise<StoredCredential | null> {
  let query = supabase
    .from("ai_credentials")
    .select("provider,api_key,model,is_active")
    .eq("user_id", userId);
  query = "provider" in where ? query.eq("provider", where.provider) : query.eq("is_active", true);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const apiKey = decryptSecret(data.api_key, aad(userId, data.provider));
  if (!isEncrypted(data.api_key)) await reencryptLegacy(supabase, userId, data.provider, apiKey);
  return { provider: data.provider, apiKey, model: data.model, isActive: data.is_active };
}

/** Resumo mascarado de todas as credenciais do usuário — o que a UI pode ver. */
export async function listCredentialSummaries(supabase: DbClient, userId: string): Promise<CredentialSummary[]> {
  const { data, error } = await supabase
    .from("ai_credentials")
    .select("provider,api_key,model,is_active")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    try {
      const plain = decryptSecret(row.api_key, aad(userId, row.provider));
      return { provider: row.provider, model: row.model, isActive: row.is_active, maskedKey: maskSecret(plain), readable: true };
    } catch {
      return {
        provider: row.provider,
        model: row.model,
        isActive: row.is_active,
        maskedKey: "ilegível — salve a chave de novo",
        readable: false,
      };
    }
  });
}

/** Grava (upsert por user+provider) a chave CIFRADA. Não mexe em is_active a menos que `isActive` venha. */
export async function writeCredential(
  supabase: DbClient,
  userId: string,
  input: { provider: CredentialProvider; apiKey: string; model: string | null; isActive?: boolean }
): Promise<{ error: { code?: string; message: string } | null }> {
  const { error } = await supabase.from("ai_credentials").upsert(
    {
      user_id: userId,
      provider: input.provider,
      api_key: encryptSecret(input.apiKey, aad(userId, input.provider)),
      model: input.model,
      ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    },
    { onConflict: "user_id,provider" }
  );
  return { error };
}

/** Recifra um valor legado em texto puro. Best-effort: sem a chave do servidor, mantém como está. */
async function reencryptLegacy(
  supabase: DbClient,
  userId: string,
  provider: CredentialProvider,
  plain: string
): Promise<void> {
  try {
    await supabase
      .from("ai_credentials")
      .update({ api_key: encryptSecret(plain, aad(userId, provider)) })
      .eq("user_id", userId)
      .eq("provider", provider);
  } catch (e) {
    console.warn("[credential-store] chave legada ainda em texto puro:", e instanceof Error ? e.message : e);
  }
}
