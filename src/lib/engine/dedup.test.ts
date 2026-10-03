import { describe, expect, it } from "vitest";
import {
  ORIGIN_RANK,
  dedupeAgainstExisting,
  dedupeWithinBatch,
  descriptionSimilarity,
  isSameTransaction,
} from "./dedup";
import type { NormalizedTransaction } from "./normalizer";

function norm(overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  const description = overrides.description ?? "Ifood Restaurante";
  return {
    date: "2026-07-10",
    amount: 45.9,
    type: "saida",
    description,
    rawDescription: description.toUpperCase(),
    ...overrides,
  };
}

describe("descriptionSimilarity (Jaccard sobre palavras)", () => {
  it("é 1 para textos iguais ignorando caixa e pontuação", () => {
    expect(descriptionSimilarity("Uber *Trip", "UBER TRIP")).toBe(1);
  });

  it("calcula interseção sobre união dos tokens", () => {
    // {mercado, extra} ∩ {mercado, extra, centro} = 2 / 3
    expect(descriptionSimilarity("Mercado Extra", "Mercado Extra Centro")).toBeCloseTo(2 / 3);
  });

  it("ignora tokens de 1 caractere", () => {
    expect(descriptionSimilarity("Padaria X", "Padaria Y")).toBe(1);
  });

  it("dois textos vazios são idênticos; vazio contra não-vazio é 0", () => {
    expect(descriptionSimilarity("", "")).toBe(1);
    expect(descriptionSimilarity("", "Uber")).toBe(0);
  });

  it("é 0 quando não há palavras em comum", () => {
    expect(descriptionSimilarity("Netflix", "Spotify")).toBe(0);
  });
});

describe("isSameTransaction", () => {
  const a = { date: "2026-07-10", amount: 45.9, description: "Ifood Restaurante" };

  it("considera duplicata: mesmo valor, data dentro da janela e descrição similar", () => {
    expect(isSameTransaction(a, { ...a, date: "2026-07-13" })).toBe(true);
  });

  it("rejeita fora da janela de 3 dias (padrão)", () => {
    expect(isSameTransaction(a, { ...a, date: "2026-07-14" })).toBe(false);
  });

  it("aceita janela customizada", () => {
    expect(isSameTransaction(a, { ...a, date: "2026-07-14" }, 5)).toBe(true);
  });

  it("calcula a janela atravessando a virada de mês", () => {
    expect(isSameTransaction({ ...a, date: "2026-06-29" }, { ...a, date: "2026-07-01" })).toBe(true);
  });

  it("rejeita valores diferentes além de meio centavo", () => {
    expect(isSameTransaction(a, { ...a, amount: 45.91 })).toBe(false);
    expect(isSameTransaction(a, { ...a, amount: 45.904 })).toBe(true);
  });

  it("rejeita descrições pouco similares (abaixo de 0,72)", () => {
    // 2/3 ≈ 0,67 < 0,72
    expect(isSameTransaction(a, { ...a, description: "Ifood Restaurante Sabor" })).toBe(false);
    // 3/4 = 0,75 ≥ 0,72
    expect(
      isSameTransaction(
        { ...a, description: "Ifood Restaurante Sabor Caseiro" },
        { ...a, description: "Ifood Restaurante Sabor" }
      )
    ).toBe(true);
  });
});

describe("dedupeAgainstExisting", () => {
  it("separa o que já existe (skipped) do que é novo (toInsert)", () => {
    const existing = [{ date: "2026-07-10", amount: 45.9, description: "Ifood Restaurante" }];
    const repetida = norm({ date: "2026-07-11" });
    const nova = norm({ description: "Uber Trip", amount: 23.5 });
    const result = dedupeAgainstExisting([repetida, nova], existing);
    expect(result.skipped).toEqual([repetida]);
    expect(result.toInsert).toEqual([nova]);
  });

  it("sem histórico, tudo entra", () => {
    const incoming = [norm(), norm({ description: "Uber" })];
    expect(dedupeAgainstExisting(incoming, []).toInsert).toHaveLength(2);
  });

  // BUG: a comparação ignora `type`. Um Pix ENVIADO e um Pix RECEBIDO do
  // mesmo valor para a mesma pessoa limpam para a mesma descrição
  // ("Joao Silva"), então a devolução (entrada) é descartada como
  // duplicata da saída — o dinheiro some do extrato.
  it.fails("não trata como duplicata uma entrada e uma saída de mesmo valor (BUG: ignora type)", () => {
    const existing = [{ date: "2026-07-10", amount: 50, description: "Joao Silva", type: "saida" as const }];
    const devolucao = norm({ date: "2026-07-11", amount: 50, description: "Joao Silva", type: "entrada" });
    expect(dedupeAgainstExisting([devolucao], existing).toInsert).toEqual([devolucao]);
  });
});

describe("dedupeWithinBatch", () => {
  it("mantém só a primeira ocorrência de cada transação repetida no lote", () => {
    const first = norm({ date: "2026-07-10" });
    const repeated = norm({ date: "2026-07-12" });
    const other = norm({ description: "Netflix", amount: 55.9 });
    expect(dedupeWithinBatch([first, repeated, other])).toEqual([first, other]);
  });

  it("não junta compras iguais em dias distantes (ex.: assinatura mensal)", () => {
    const jul = norm({ date: "2026-07-05", description: "Netflix", amount: 55.9 });
    const ago = norm({ date: "2026-08-05", description: "Netflix", amount: 55.9 });
    expect(dedupeWithinBatch([jul, ago])).toHaveLength(2);
  });
});

describe("ORIGIN_RANK (R1)", () => {
  it("fonte automática tem prioridade sobre importação e manual", () => {
    expect(ORIGIN_RANK.open_finance).toBeGreaterThan(ORIGIN_RANK.import);
    expect(ORIGIN_RANK.import).toBeGreaterThan(ORIGIN_RANK.manual);
  });
});
