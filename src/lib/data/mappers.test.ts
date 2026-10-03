import { describe, expect, it } from "vitest";
import {
  toAccount,
  toCategory,
  toJsonColumn,
  toPaymentMethodColumn,
  toStatusColumn,
  toTransaction,
} from "./mappers";

describe("toTransaction", () => {
  it("aceita linha parcial: colunas não selecionadas viram o padrão do domínio", () => {
    const tx = toTransaction({ id: "t1", date: "2026-07-10", amount: 45.9, type: "saida" }, "u1");
    expect(tx).toMatchObject({
      id: "t1",
      userId: "u1",
      amount: 45.9,
      description: "",
      categoryId: null,
      rawPayload: null,
      needsReview: false,
      origin: "manual",
    });
  });

  it("converte numeric vindo como string do PostgREST", () => {
    const tx = toTransaction({ id: "t1", date: "2026-07-10", amount: "12.50" as unknown as number, type: "entrada" });
    expect(tx.amount).toBe(12.5);
  });
});

describe("toAccount / toCategory", () => {
  it("colunas de saldo ausentes ficam null, não NaN", () => {
    const acc = toAccount({ id: "a1", name: "Carteira", kind: "carteira" });
    expect(acc.currentBalance).toBeNull();
    expect(acc.creditLimit).toBeNull();
    expect(acc.openingBalance).toBe(0);
  });

  it("natureza padrão segue o tipo da categoria", () => {
    expect(toCategory({ id: "c1", name: "Salário", kind: "receita" }).nature).toBe("receita");
    expect(toCategory({ id: "c2", name: "Mercado", kind: "despesa" }).nature).toBe("variavel");
  });
});

describe("fronteira de escrita (CHECKs do banco)", () => {
  it("forma de pagamento fora da lista vira null em vez de erro de banco", () => {
    expect(toPaymentMethodColumn("pix")).toBe("pix");
    expect(toPaymentMethodColumn("WIRE")).toBeNull();
    expect(toPaymentMethodColumn(undefined)).toBeNull();
  });

  it("status só aceita POSTED/PENDING", () => {
    expect(toStatusColumn("POSTED")).toBe("POSTED");
    expect(toStatusColumn("CANCELLED")).toBeNull();
  });

  it("payload ausente vira null", () => {
    expect(toJsonColumn(undefined)).toBeNull();
    expect(toJsonColumn({ a: 1 })).toEqual({ a: 1 });
  });
});
