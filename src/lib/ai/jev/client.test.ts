import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TypeSafeError, listModels, systemOne, type SystemOneRequest, type SystemOneResponse } from "./client";

const BASE = "https://typesafe.test";

const request: SystemOneRequest = {
  state: { transaction: { description: "Ifood", amount: "R$ 45,90" } },
  model: "jev-latest",
  questions: {
    category: {
      type: "choice",
      instructions: "Which category?",
      criteria: { "Comida fora": null, "None of these categories": null },
    },
  },
};

const okBody: SystemOneResponse = {
  model: "jev-1.13.0",
  answers: {
    category: {
      type: "choice",
      choice: "Comida fora",
      probabilities: { "Comida fora": 0.9, "None of these categories": 0.1 },
      confidence: 0.85,
    },
  },
  usage: { input_tokens: 321, output_tokens: 1 },
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** Resposta de erro; retry-after "0" mantém os retries instantâneos no teste. */
function httpError(status: number, body = "", retryAfter: string | null = "0"): Response {
  return new Response(body, { status, headers: retryAfter === null ? {} : { "retry-after": retryAfter } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  // barra final de propósito: o cliente deve normalizá-la
  vi.stubEnv("TYPESAFE_BASE_URL", `${BASE}/`);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("systemOne", () => {
  it("faz POST em {base}/v1/systemone com Bearer, JSON e devolve a resposta", async () => {
    fetchMock.mockResolvedValueOnce(json(okBody));

    const res = await systemOne("sk-test-123", request);

    expect(res).toEqual(okBody);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/v1/systemone`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer sk-test-123",
      "Content-Type": "application/json",
    });
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init?.body));
    expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
    expect(body).toEqual(request);
  });

  it("usa a URL padrão da TypeSafe quando TYPESAFE_BASE_URL não está definida", async () => {
    vi.stubEnv("TYPESAFE_BASE_URL", "");
    fetchMock.mockResolvedValueOnce(json(okBody));
    await systemOne("sk", request);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.typesafe.ai/v1/systemone");
  });

  it("em 429 espera e tenta de novo, até dar certo", async () => {
    fetchMock
      .mockResolvedValueOnce(httpError(429))
      .mockResolvedValueOnce(httpError(529))
      .mockResolvedValueOnce(json(okBody));

    await expect(systemOne("sk", request)).resolves.toEqual(okBody);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("respeita o header retry-after (em segundos) antes de tentar de novo", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(httpError(429, "", "2")).mockResolvedValueOnce(json(okBody));

    const pending = systemOne("sk", request);
    await vi.advanceTimersByTimeAsync(1_900);
    expect(fetchMock).toHaveBeenCalledTimes(1); // ainda esperando
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toEqual(okBody);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("esgota as tentativas em 5xx e lança o último erro com status", async () => {
    fetchMock.mockImplementation(async () => httpError(503, "upstream down"));

    const err = await systemOne("sk", request, { maxRetries: 2 }).catch((e: unknown) => e);

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(err).toBeInstanceOf(TypeSafeError);
    expect((err as TypeSafeError).status).toBe(503);
    expect((err as TypeSafeError).message).toBe("TypeSafe: erro ao chamar a API (HTTP 503). upstream down");
  });

  it("401 é erro de autenticação, com mensagem em pt-BR, e não tenta de novo", async () => {
    fetchMock.mockResolvedValue(httpError(401, "invalid key"));

    const err = (await systemOne("sk-ruim", request).catch((e: unknown) => e)) as TypeSafeError;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(TypeSafeError);
    expect(err.name).toBe("TypeSafeError");
    expect(err.isAuthError).toBe(true);
    expect(err.message).toContain("chave de API inválida ou sem permissão (HTTP 401)");
  });

  it("403 também é erro de autenticação", async () => {
    fetchMock.mockResolvedValue(httpError(403));
    const err = (await systemOne("sk", request).catch((e: unknown) => e)) as TypeSafeError;
    expect(err.isAuthError).toBe(true);
  });

  it("422 (requisição recusada) não tenta de novo e inclui o corpo da resposta", async () => {
    fetchMock.mockResolvedValue(httpError(422, '{"detail":"too many options"}'));

    const err = (await systemOne("sk", request).catch((e: unknown) => e)) as TypeSafeError;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err.status).toBe(422);
    expect(err.isAuthError).toBe(false);
    expect(err.message).toBe('TypeSafe: requisição recusada pela API (HTTP 422). {"detail":"too many options"}');
  });

  it("429 esgotado vira mensagem amigável de limite de requisições", async () => {
    fetchMock.mockImplementation(async () => httpError(429));
    await expect(systemOne("sk", request, { maxRetries: 1 })).rejects.toThrow(
      "TypeSafe: limite de requisições atingido (HTTP 429). Tente novamente em instantes."
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("timeout vira mensagem amigável com o tempo limite em segundos", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));

    const err = (await systemOne("sk", request, { timeoutMs: 5_000, maxRetries: 0 }).catch(
      (e: unknown) => e
    )) as TypeSafeError;

    expect(err).toBeInstanceOf(TypeSafeError);
    expect(err.status).toBeNull();
    expect(err.message).toBe("TypeSafe: a API não respondeu em 5s.");
  });

  it("erro de rede vira mensagem amigável e é tentado de novo com backoff", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(json(okBody));

    const pending = systemOne("sk", request);
    await vi.advanceTimersByTimeAsync(1_000); // backoff da 1ª tentativa: 500ms + jitter < 750ms
    await expect(pending).resolves.toEqual(okBody);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("erro de rede persistente lança a mensagem de falha de conexão", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(systemOne("sk", request, { maxRetries: 0 })).rejects.toThrow(
      "TypeSafe: falha ao conectar (fetch failed)."
    );
  });

  it("resposta sem 'answers' é tratada como erro", async () => {
    fetchMock.mockResolvedValueOnce(json({ model: "jev-1.13.0" }));
    const err = (await systemOne("sk", request).catch((e: unknown) => e)) as TypeSafeError;
    expect(err).toBeInstanceOf(TypeSafeError);
    expect(err.status).toBeNull();
    expect(err.message).toBe('TypeSafe: resposta inesperada da API (sem "answers").');
  });
});

describe("listModels", () => {
  const models = [{ name: "jev-1.13.0", description: "Jev flagship", release_date: "2026-08-01" }];

  it("faz GET em {base}/v1/models, sem corpo nem Content-Type, e devolve a lista", async () => {
    fetchMock.mockResolvedValueOnce(json({ models }));

    await expect(listModels("sk-test")).resolves.toEqual(models);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/v1/models`);
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toEqual({ Authorization: "Bearer sk-test" });
  });

  it("devolve lista vazia quando a resposta não traz 'models'", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await expect(listModels("sk")).resolves.toEqual([]);
  });

  it("tenta no máximo uma vez a mais em erro transitório", async () => {
    fetchMock.mockImplementation(async () => httpError(500));
    await expect(listModels("sk")).rejects.toBeInstanceOf(TypeSafeError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("chave inválida é reportada como erro de autenticação", async () => {
    fetchMock.mockResolvedValueOnce(httpError(401));
    const err = (await listModels("sk").catch((e: unknown) => e)) as TypeSafeError;
    expect(err.isAuthError).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
