"use server";

// ─────────────────────────────────────────────────────────────
// Server actions da aba "Inteligência (IA)" em Configurações.
// Lê/escreve gestor360.ai_credentials (migration 0003_ai_credentials.sql).
//
// Regra inegociável: a api_key NUNCA volta pro client. saveAICredential
// recebe a chave e grava; toda leitura pra UI (getAICredentialsStatus)
// devolve só metadados + um sufixo mascarado calculado aqui no servidor.
//
// Defesa em profundidade: mesmo com RLS (user_id = auth.uid()) já
// restringindo as linhas visíveis, toda query abaixo também filtra
// .eq("user_id", userId) explicitamente — se um dia o cliente usado
// aqui virar o admin (service_role, que faz bypass de RLS), o filtro
// continua garantindo isolamento por usuário.
// ─────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/auth/session";
import { listCredentialSummaries, writeCredential } from "@/lib/ai/credential-store";
import { aiProvider, apiKey as apiKeySchema, modelName, parseInput } from "@/lib/validation";
import { z } from "zod";

const SaveInput = z.object({ provider: aiProvider, apiKey: apiKeySchema, model: modelName });
import { AI_PROVIDERS, type AiProvider } from "@/lib/ai/provider-meta";


function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Upsert da credencial de um provider. Não mexe em `is_active` — usar
 * setActiveProvider() pra isso (mantém as duas responsabilidades
 * separadas e evita ativar sem querer ao só trocar a chave/modelo).
 */
export async function saveAICredential(input: {
  provider: string;
  apiKey: string;
  model?: string | null;
}): Promise<ActionResult> {
  try {
    if (!input?.apiKey?.trim()) return { ok: false, error: "Informe a chave de API." };
    const { provider, apiKey, model } = parseInput(SaveInput, input);

    const userId = await requireUserId();
    const supabase = await createClient();

    // Se o usuário ainda não tem NENHUM provider ativo, este passa a ser o
    // ativo automaticamente — senão a chave ficaria salva porém "inerte" e o
    // Gestor diria "nenhuma chave configurada" mesmo com a chave no banco
    // (UX confusa). Quando já existe um ativo, respeita-o (não rouba o ativo
    // ao só cadastrar/editar outra chave); trocar de ativo é via setActiveProvider.
    const { count: activeCount } = await supabase
      .from("ai_credentials")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_active", true);
    const activateThis = (activeCount ?? 0) === 0;

    const { error } = await writeCredential(supabase, userId, {
      provider,
      apiKey,
      model,
      ...(activateThis ? { isActive: true } : {}),
    });

    if (error) throw new Error(error.message);

    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Erro ao salvar a chave.",
    };
  }
}

/**
 * Marca `provider` como o único ativo do usuário: desativa as demais
 * linhas primeiro, depois ativa a escolhida — nessa ordem, pra nunca
 * esbarrar no índice único parcial `ai_credentials_one_active_per_user`
 * (no máximo 1 linha com is_active=true por usuário).
 */
export async function setActiveProvider(provider: string): Promise<ActionResult> {
  try {
    if (!isAiProvider(provider)) {
      return { ok: false, error: "Provedor de IA inválido." };
    }

    const userId = await requireUserId();
    const supabase = await createClient();

    // 1) desativa tudo que estiver ativo hoje (exceto a linha alvo, que
    //    já entra desativada nesse update se por acaso já fosse a ativa —
    //    sem problema, ela é reativada no passo 2).
    const { error: deactivateError } = await supabase
      .from("ai_credentials")
      .update({ is_active: false })
      .eq("user_id", userId)
      .eq("is_active", true);
    if (deactivateError) throw new Error(deactivateError.message);

    // 2) ativa a linha do provider escolhido.
    const { data, error: activateError } = await supabase
      .from("ai_credentials")
      .update({ is_active: true })
      .eq("user_id", userId)
      .eq("provider", provider)
      .select("id")
      .maybeSingle();
    if (activateError) throw new Error(activateError.message);
    if (!data) {
      return {
        ok: false,
        error: "Cadastre uma chave para este provedor antes de ativá-lo.",
      };
    }

    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Erro ao ativar o provedor.",
    };
  }
}

/** Remove a credencial cadastrada de um provider (se o usuário desativar antes ou não, tanto faz — DELETE não exige is_active=false). */
export async function removeAICredential(provider: string): Promise<ActionResult> {
  try {
    if (!isAiProvider(provider)) {
      return { ok: false, error: "Provedor de IA inválido." };
    }

    const userId = await requireUserId();
    const supabase = await createClient();

    const { error } = await supabase
      .from("ai_credentials")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider);
    if (error) throw new Error(error.message);

    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Erro ao remover a chave.",
    };
  }
}

export interface AICredentialStatus {
  provider: AiProvider;
  configured: boolean;
  active: boolean;
  model: string | null;
  maskedKey: string | null;
}

/**
 * Projeção segura pra UI: uma linha por provider suportado (mesmo os
 * não cadastrados ainda), nunca a api_key inteira.
 */
export async function getAICredentialsStatus(): Promise<{
  ok: boolean;
  data: AICredentialStatus[];
  error?: string;
}> {
  try {
    const userId = await requireUserId();
    const supabase = await createClient();

    const rows = new Map(
      (await listCredentialSummaries(supabase, userId)).map((row) => [row.provider, row])
    );

    const status: AICredentialStatus[] = AI_PROVIDERS.map((provider) => {
      const row = rows.get(provider);
      if (!row) {
        return { provider, configured: false, active: false, model: null, maskedKey: null };
      }
      return {
        provider,
        configured: true,
        active: row.isActive,
        model: row.model,
        maskedKey: row.maskedKey,
      };
    });

    return { ok: true, data: status };
  } catch (e) {
    return {
      ok: false,
      data: AI_PROVIDERS.map((provider) => ({
        provider,
        configured: false,
        active: false,
        model: null,
        maskedKey: null,
      })),
      error: e instanceof Error ? e.message : "Erro ao carregar as credenciais.",
    };
  }
}
