import { describe, expect, it } from "vitest";
import { pluggyConnector, pluggyConnectorMany, type PluggyTransaction } from "./pluggy";
import { normalize } from "./normalizer";

function pluggyTx(overrides: Partial<PluggyTransaction> = {}): PluggyTransaction {
  return {
    id: "pluggy-1",
    accountId: "acc-nubank",
    amount: -45.9,
    date: "2026-07-05T03:00:00.000Z",
    description: "IFOOD *RESTAURANTE",
    type: "DEBIT",
    ...overrides,
  };
}

describe("pluggyConnector (Pluggy → RawTransaction canônica)", () => {
  it("mapeia DEBIT para saída e CREDIT para entrada, propagando ids e origem", () => {
    const saida = pluggyConnector(pluggyTx());
    expect(saida).toMatchObject({
      externalId: "pluggy-1",
      account: "acc-nubank",
      date: "2026-07-05T03:00:00.000Z",
      amount: -45.9,
      type: "saida",
      description: "IFOOD *RESTAURANTE",
      origin: "open_finance",
    });
    expect(pluggyConnector(pluggyTx({ type: "CREDIT", amount: 3000 })).type).toBe("entrada");
  });

  it("compra no cartão: crédito, merchant como contraparte e hasCreditCard", () => {
    const raw = pluggyConnector(
      pluggyTx({
        creditCardMetadata: { installmentNumber: 1 },
        merchant: { name: "IFOOD", businessName: "IFOOD.COM AGENCIA DE RESTAURANTES ONLINE S.A.", document: "14380200000121" },
        category: "Food delivery",
        categoryId: "07010000",
        status: "POSTED",
      })
    );
    expect(raw).toMatchObject({
      paymentMethod: "credito",
      hasCreditCard: true,
      counterpartyName: "IFOOD",
      counterpartyDocument: "14380200000121",
      merchantName: "IFOOD",
      pluggyCategory: "Food delivery",
      pluggyCategoryId: "07010000",
      status: "POSTED",
    });
  });

  it("Pix enviado: contraparte é o RECEBEDOR (receiver)", () => {
    const raw = pluggyConnector(
      pluggyTx({
        description: "PIX ENVIADO",
        operationType: "PIX",
        paymentData: {
          paymentMethod: "PIX",
          payer: { name: "Maria Souza", documentNumber: { type: "CPF", value: "11111111111" } },
          receiver: { name: "Joao Silva", documentNumber: { type: "CPF", value: "22222222222" } },
        },
      })
    );
    expect(raw).toMatchObject({
      paymentMethod: "pix",
      operationType: "PIX",
      counterpartyName: "Joao Silva",
      counterpartyDocument: "22222222222",
      hasCreditCard: false,
      merchantName: null,
    });
  });

  it("Pix recebido: contraparte é o PAGADOR (payer)", () => {
    const raw = pluggyConnector(
      pluggyTx({
        type: "CREDIT",
        amount: 250,
        paymentData: {
          payer: { name: "Carlos Lima", documentNumber: { value: "33333333333" } },
          receiver: { name: "Maria Souza" },
        },
      })
    );
    expect(raw.counterpartyName).toBe("Carlos Lima");
    expect(raw.counterpartyDocument).toBe("33333333333");
  });

  it("sem nome estruturado, extrai o nome da descrição mas preserva o documento estruturado", () => {
    const raw = pluggyConnector(
      pluggyTx({
        description: "PIX ENVIADO JOAO PEREIRA",
        paymentData: { receiver: { documentNumber: { value: "44444444444" } } },
      })
    );
    expect(raw.counterpartyName).toBe("Joao Pereira");
    expect(raw.counterpartyDocument).toBe("44444444444");
  });

  it("sem nenhuma pista de nome, contraparte fica indefinida", () => {
    const raw = pluggyConnector(pluggyTx({ description: "PIX RECEBIDO", type: "CREDIT" }));
    expect(raw.counterpartyName).toBeUndefined();
    expect(raw.counterpartyDocument).toBeUndefined();
  });

  it("campos opcionais ausentes viram null, e o payload inteiro é preservado", () => {
    const original = pluggyTx({ descriptionRaw: "IFD*IFOOD 0800", balance: 1234.5 });
    const raw = pluggyConnector(original);
    expect(raw).toMatchObject({
      paymentMethod: null,
      operationType: null,
      merchantName: null,
      pluggyCategory: null,
      pluggyCategoryId: null,
      status: null,
    });
    expect(raw.rawPayload).toBe(original);
  });

  it("encadeia com o normalizador: valor positivo, data ISO e descrição limpa", () => {
    const n = normalize(pluggyConnector(pluggyTx({ date: "2026-07-05" })));
    expect(n).toMatchObject({ date: "2026-07-05", amount: 45.9, type: "saida", description: "Ifood Restaurante" });
  });

  it("pluggyConnectorMany mapeia a lista inteira", () => {
    const out = pluggyConnectorMany([pluggyTx({ id: "a" }), pluggyTx({ id: "b", type: "CREDIT" })]);
    expect(out.map((r) => [r.externalId, r.type])).toEqual([
      ["a", "saida"],
      ["b", "entrada"],
    ]);
  });
});
