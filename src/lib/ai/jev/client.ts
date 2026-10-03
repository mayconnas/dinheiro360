// ─────────────────────────────────────────────────────────────
// Camada 4 — cliente HTTP da TypeSafe (System One API).
//
//   POST {base}/v1/systemone   { state, model, questions } → { model, answers, usage }
//   GET  {base}/v1/models      → { models: [{ name, description, release_date }] }
//
// fetch puro (mesmo padrão de src/lib/pluggy/client.ts e
// src/lib/ai/providers.ts), com o que a doc pede para chamadas diretas:
// timeout por tentativa e retry com backoff exponencial em 429/529
// (e 5xx/erros de rede), respeitando o header retry-after.
//
// Roda SOMENTE no servidor: recebe a api_key em texto puro.
// ─────────────────────────────────────────────────────────────
import "server-only";

const LABEL = "TypeSafe";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 3;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);

function baseUrl(): string {
  return (process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai").replace(/\/+$/, "");
}

// ─── Tipos do wire format (docs.typesafe.ai/api) ───

/** Texto, objeto ou array — instructions/criteria aceitam estrutura JSON. */
export type TypeSafeJson =
  | string
  | number
  | boolean
  | null
  | TypeSafeJson[]
  | { [key: string]: TypeSafeJson };

export interface ChoiceQuestion {
  type: "choice";
  instructions: TypeSafeJson;
  /** opção → descrição (null quando o nome basta). Máx. 255 opções. */
  criteria: Record<string, TypeSafeJson>;
}

export interface NoulQuestion {
  type: "noul";
  instructions: TypeSafeJson;
  criteria?: { true?: TypeSafeJson; false?: TypeSafeJson };
}

export type Question = ChoiceQuestion | NoulQuestion;

export interface SystemOneRequest {
  state: TypeSafeJson;
  model: string;
  questions: Record<string, Question>;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export type Answer = ChoiceAnswer | NoulAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

export interface TypeSafeModel {
  name: string;
  description: string;
  release_date: string;
}

/** Erro com status HTTP, pra quem chama distinguir chave inválida (aborta tudo) de falha pontual. */
export class TypeSafeError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "TypeSafeError";
    this.status = status;
  }
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

// ─── API pública ───

export async function systemOne(
  apiKey: string,
  body: SystemOneRequest,
  opts: { timeoutMs?: number; maxRetries?: number } = {}
): Promise<SystemOneResponse> {
  const data = await request<SystemOneResponse>(apiKey, "/v1/systemone", {
    method: "POST",
    body: JSON.stringify(body),
  }, opts);
  if (!data || typeof data !== "object" || !data.answers) {
    throw new TypeSafeError(`${LABEL}: resposta inesperada da API (sem "answers").`, null);
  }
  return data;
}

/** Lista os modelos da conta. Não consome tokens — usado para validar a chave. */
export async function listModels(apiKey: string): Promise<TypeSafeModel[]> {
  const data = await request<{ models?: TypeSafeModel[] }>(apiKey, "/v1/models", { method: "GET" }, {
    maxRetries: 1,
  });
  return Array.isArray(data?.models) ? data.models : [];
}

// ─── Internos ───

async function request<T>(
  apiKey: string,
  path: string,
  init: { method: "GET" | "POST"; body?: string },
  opts: { timeoutMs?: number; maxRetries?: number }
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  let lastError: TypeSafeError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl()}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      lastError = new TypeSafeError(
        timedOut
          ? `${LABEL}: a API não respondeu em ${Math.round(timeoutMs / 1000)}s.`
          : `${LABEL}: falha ao conectar (${e instanceof Error ? e.message : String(e)}).`,
        null
      );
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw lastError;
    }

    if (res.ok) return (await res.json()) as T;

    const body = await safeReadBody(res);
    lastError = new TypeSafeError(httpErrorMessage(res.status, body), res.status);
    if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
      await sleep(backoffMs(attempt, res.headers.get("retry-after")));
      continue;
    }
    throw lastError;
  }
  // inalcançável (o loop sempre retorna ou lança), mas mantém o TS feliz
  throw lastError ?? new TypeSafeError(`${LABEL}: erro desconhecido.`, null);
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const base = 500 * 2 ** attempt; // 0,5s · 1s · 2s …
  return base + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function httpErrorMessage(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return `${LABEL}: chave de API inválida ou sem permissão (HTTP ${status}). Verifique a chave em Configurações > Inteligência (IA).`;
  }
  if (status === 429) {
    return `${LABEL}: limite de requisições atingido (HTTP 429). Tente novamente em instantes.`;
  }
  if (status === 529) {
    return `${LABEL}: serviço temporariamente sobrecarregado (HTTP 529). Tente novamente em instantes.`;
  }
  if (status === 422) {
    return `${LABEL}: requisição recusada pela API (HTTP 422). ${body}`.trim();
  }
  return `${LABEL}: erro ao chamar a API (HTTP ${status}). ${body}`.trim();
}
