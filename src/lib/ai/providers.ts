// ─────────────────────────────────────────────────────────────
// Camada 4 — abstração de provedores de IA.
// Ponto único que sabe falar HTTP com cada provedor suportado e
// normaliza a resposta em {text, model}. Roda SOMENTE no servidor.
//
// Anthropic usa o SDK oficial (já era dependência do projeto); os
// demais (OpenAI, Gemini, DeepSeek) usam fetch direto — todos têm
// APIs HTTP simples o suficiente para não justificar mais 3 SDKs.
// ─────────────────────────────────────────────────────────────
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Tipo/constantes de provedor vivem em provider-meta.ts (sem
// "server-only") para poderem ser importados por componentes client.
// Re-exportados aqui para não quebrar quem já importava daqui
// (brain.ts, credentials.ts, etc.).
export {
  type AiProvider,
  AI_PROVIDERS,
  DEFAULT_MODELS,
  PROVIDER_LABELS,
} from "./provider-meta";
import { DEFAULT_MODELS, type AiProvider } from "./provider-meta";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CallProviderInput {
  provider: AiProvider;
  apiKey: string;
  /** Se omitido/vazio, usa DEFAULT_MODELS[provider]. */
  model?: string | null;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

export interface ProviderResult {
  text: string;
  model: string;
}

/**
 * Chamada única e normalizada a qualquer provedor suportado.
 * Lança Error com mensagem amigável em falha de rede/HTTP/formato —
 * quem chama (brain.ts) decide como exibir/logar.
 */
export async function callProvider(
  input: CallProviderInput
): Promise<ProviderResult> {
  const model = input.model?.trim() || DEFAULT_MODELS[input.provider];
  const maxTokens = input.maxTokens ?? 2000;

  switch (input.provider) {
    case "anthropic":
      return callAnthropic({ ...input, model, maxTokens });
    case "openai":
      return callOpenAI({ ...input, model, maxTokens });
    case "deepseek":
      return callDeepSeek({ ...input, model, maxTokens });
    case "gemini":
      return callGemini({ ...input, model, maxTokens });
    default: {
      const _exhaustive: never = input.provider;
      throw new Error(`Provedor de IA desconhecido: ${_exhaustive}`);
    }
  }
}

// ─── Anthropic ──────────────────────────────────────────────
async function callAnthropic(
  input: CallProviderInput & { model: string; maxTokens: number }
): Promise<ProviderResult> {
  try {
    const client = new Anthropic({ apiKey: input.apiKey });
    const message = await client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens,
      thinking: { type: "adaptive" },
      system: input.system,
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });
    if (message.stop_reason === "refusal") {
      return {
        text: "Não consegui processar essa solicitação. Reformule a pergunta e tente de novo.",
        model: message.model,
      };
    }
    const parts: string[] = [];
    for (const block of message.content) {
      if (block.type === "text") parts.push(block.text);
    }
    return { text: parts.join("").trim(), model: message.model };
  } catch (e) {
    throw new Error(friendlyError("Anthropic", e));
  }
}

// ─── OpenAI ─────────────────────────────────────────────────
async function callOpenAI(
  input: CallProviderInput & { model: string; maxTokens: number }
): Promise<ProviderResult> {
  return callOpenAiCompatible({
    ...input,
    url: "https://api.openai.com/v1/chat/completions",
    providerLabel: "OpenAI",
  });
}

// ─── DeepSeek (API compatível com o formato da OpenAI) ───────
async function callDeepSeek(
  input: CallProviderInput & { model: string; maxTokens: number }
): Promise<ProviderResult> {
  return callOpenAiCompatible({
    ...input,
    url: "https://api.deepseek.com/chat/completions",
    providerLabel: "DeepSeek",
  });
}

async function callOpenAiCompatible(
  input: CallProviderInput & {
    model: string;
    maxTokens: number;
    url: string;
    providerLabel: string;
  }
): Promise<ProviderResult> {
  try {
    const res = await fetch(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxTokens,
        messages: [
          { role: "system", content: input.system },
          ...input.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });

    if (!res.ok) {
      const body = await safeReadBody(res);
      throw new Error(httpErrorMessage(input.providerLabel, res.status, body));
    }

    const data = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    return { text, model: data.model ?? input.model };
  } catch (e) {
    throw new Error(friendlyError(input.providerLabel, e));
  }
}

// ─── Gemini (Google Generative Language API) ─────────────────
async function callGemini(
  input: CallProviderInput & { model: string; maxTokens: number }
): Promise<ProviderResult> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      input.model
    )}:generateContent?key=${encodeURIComponent(input.apiKey)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: input.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: input.maxTokens },
      }),
    });

    if (!res.ok) {
      const body = await safeReadBody(res);
      throw new Error(httpErrorMessage("Gemini", res.status, body));
    }

    const data = (await res.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
      }[];
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    return { text, model: input.model };
  } catch (e) {
    throw new Error(friendlyError("Gemini", e));
  }
}

// ─── Helpers de erro ──────────────────────────────────────────
async function safeReadBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function httpErrorMessage(
  providerLabel: string,
  status: number,
  body: string
): string {
  if (status === 401 || status === 403) {
    return `${providerLabel}: chave de API inválida ou sem permissão (HTTP ${status}). Verifique a chave em Configurações > Inteligência (IA).`;
  }
  if (status === 429) {
    return `${providerLabel}: limite de uso/requisições atingido (HTTP 429). Tente novamente em instantes.`;
  }
  return `${providerLabel}: erro ao chamar a API (HTTP ${status}). ${body}`.trim();
}

function friendlyError(providerLabel: string, e: unknown): string {
  if (e instanceof Error && e.message.startsWith(`${providerLabel}:`)) {
    return e.message;
  }
  const detail = e instanceof Error ? e.message : String(e);
  return `${providerLabel}: falha ao conectar (${detail}).`;
}
