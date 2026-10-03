// ─────────────────────────────────────────────────────────────
// Camada 4 — o Cérebro / IA (o gestor)
// Consome o Pacote de Contexto e produz gestão em linguagem natural
// via chamada ao modelo de IA configurado pelo usuário (ou, na
// ausência de credencial própria, ao Claude via ANTHROPIC_API_KEY da
// env — comportamento padrão de compatibilidade). Roda SOMENTE no
// servidor.
// ─────────────────────────────────────────────────────────────
import "server-only";
import type { ContextPackage } from "@/lib/engine/context-package";
import { SYSTEM_PROMPT, DIAGNOSIS_TASK, dataBlock } from "./prompts";
import { callProvider, type AiProvider, type ChatMessage } from "./providers";
import { getActiveCredential } from "./credentials";

const ENV_FALLBACK_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export interface BrainResult {
  text: string;
  model: string;
}

interface ResolvedCredential {
  provider: AiProvider;
  apiKey: string;
  model: string | null;
}

/**
 * Resolve qual credencial usar para chamar a IA:
 * 1. Credencial ativa do usuário no banco (gestor360.ai_credentials), se houver.
 * 2. Fallback: ANTHROPIC_API_KEY da env (comportamento anterior a esta feature).
 * Lança erro claro se nenhuma das duas estiver disponível.
 */
async function resolveCredential(userId?: string): Promise<ResolvedCredential> {
  if (userId) {
    const active = await getActiveCredential(userId);
    if (active) {
      return {
        provider: active.provider,
        apiKey: active.apiKey,
        model: active.model,
      };
    }
  }

  const envKey = process.env.ANTHROPIC_API_KEY;
  if (!envKey) {
    throw new Error(
      "Nenhuma chave de IA configurada. Configure a sua em Configurações > Inteligência (IA), ou defina ANTHROPIC_API_KEY no .env.local (veja .env.local.example)."
    );
  }
  return { provider: "anthropic", apiKey: envKey, model: ENV_FALLBACK_MODEL };
}

/**
 * Diagnóstico + Prescrição + Acompanhamento (4.1/4.2/4.4).
 * Uma passada só: a IA lê o pacote e devolve o texto estruturado.
 *
 * @param userId opcional — quando informado, tenta usar a credencial de
 * IA ativa do usuário no banco antes de cair no fallback da env var.
 * @param richContext opcional — o Contexto Completo (lista
 * transação-a-transação + saldos, ver src/lib/ai/full-context.ts). Quando
 * ausente, a IA opera só com o Pacote de Contexto determinístico (compat).
 */
export async function diagnose(
  pkg: ContextPackage,
  userId?: string,
  richContext?: string
): Promise<BrainResult> {
  const cred = await resolveCredential(userId);
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `${dataBlock(pkg, richContext)}\n\n${DIAGNOSIS_TASK}`,
    },
  ];
  return callProvider({
    provider: cred.provider,
    apiKey: cred.apiKey,
    model: cred.model,
    system: SYSTEM_PROMPT,
    messages,
    maxTokens: 2000,
  });
}

/**
 * Consultor Q&A (4.3) — o usuário pergunta, a IA responde com os
 * números dele. Recebe o histórico da conversa para manter contexto.
 *
 * @param userId opcional — mesma resolução de credencial do diagnose().
 * @param richContext opcional — o Contexto Completo (ver diagnose acima).
 */
export async function consult(
  pkg: ContextPackage,
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  userId?: string,
  richContext?: string
): Promise<BrainResult> {
  const cred = await resolveCredential(userId);

  // ORDEM É CRÍTICA: a API exige que a conversa TERMINE com uma mensagem
  // do usuário. Então: (1) o bloco de dados entra como o 1º turno do
  // usuário; (2) o histórico do diálogo no meio; (3) a PERGUNTA ATUAL por
  // ÚLTIMO. Antes, a pergunta era embutida no pacote (no início) e o
  // histórico terminava com um `assistant` — a API rejeitava com
  // "conversation must end with a user message".
  const messages: ChatMessage[] = [
    { role: "user", content: dataBlock(pkg, richContext) },
  ];
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: "user", content: question });

  return callProvider({
    provider: cred.provider,
    apiKey: cred.apiKey,
    model: cred.model,
    system: SYSTEM_PROMPT,
    messages,
    maxTokens: 1500,
  });
}
