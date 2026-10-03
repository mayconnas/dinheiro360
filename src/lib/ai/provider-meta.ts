// ─────────────────────────────────────────────────────────────
// Metadados de provedores de IA — tipo, lista, modelos default e
// rótulos amigáveis. SEM "server-only": este arquivo não toca em SDK
// nem em chave nenhuma, só dados estáticos, então pode ser importado
// tanto por código server (server actions, src/lib/ai/*) quanto por
// componentes client (ex.: src/components/configuracoes/ai-keys-section.tsx,
// que precisa de PROVIDER_LABELS/DEFAULT_MODELS pra montar a UI).
//
// src/lib/ai/providers.ts (que É server-only, por causa do SDK da
// Anthropic e das chamadas HTTP com a api_key) re-exporta tudo daqui
// pra manter os imports existentes (brain.ts, credentials.ts,
// ai-credentials.ts) funcionando sem mudança.
// ─────────────────────────────────────────────────────────────

export type AiProvider = "anthropic" | "openai" | "gemini" | "deepseek";

export const AI_PROVIDERS: AiProvider[] = [
  "anthropic",
  "openai",
  "gemini",
  "deepseek",
];

/** Modelo padrão usado quando o usuário não define um override. */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5",
  gemini: "gemini-2.0-flash",
  deepseek: "deepseek-chat",
};

/** Rótulos amigáveis para a UI (settings/credenciais). */
export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  gemini: "Google (Gemini)",
  deepseek: "DeepSeek",
};
