import { describe, expect, it } from "vitest";
import {
  cleanDescription,
  isNoiseOnlyDescription,
  normalize,
  normalizeMany,
  toISODate,
} from "./normalizer";
import type { RawTransaction } from "@/lib/types";

describe("toISODate", () => {
  it("mantém datas que já estão em ISO", () => {
    expect(toISODate("2026-07-05")).toBe("2026-07-05");
  });

  it("converte o formato brasileiro DD/MM/AAAA com /, - ou .", () => {
    expect(toISODate("05/07/2026")).toBe("2026-07-05");
    expect(toISODate("05-07-2026")).toBe("2026-07-05");
    expect(toISODate("05.07.2026")).toBe("2026-07-05");
  });

  it("converte DD/MM/AA assumindo o século 2000", () => {
    expect(toISODate("31/12/25")).toBe("2025-12-31");
  });

  it("converte AAAA/MM/DD", () => {
    expect(toISODate("2026/07/05")).toBe("2026-07-05");
    expect(toISODate("2026.07.05")).toBe("2026-07-05");
  });

  it("apara espaços antes de interpretar", () => {
    expect(toISODate("  05/07/2026 ")).toBe("2026-07-05");
  });

  it("cai no Date do JS para formatos textuais", () => {
    expect(toISODate("July 5, 2026")).toBe("2026-07-05");
  });

  it("devolve o texto como veio quando não consegue interpretar", () => {
    expect(toISODate("ontem")).toBe("ontem");
  });
});

describe("cleanDescription", () => {
  it("remove ruído de extrato (PIX ENVIADO, COMPRA CARTAO, asteriscos, nº do cartão)", () => {
    expect(cleanDescription("PIX ENVIADO JOAO SILVA")).toBe("Joao Silva");
    expect(cleanDescription("COMPRA CARTAO 1234 IFOOD *RESTAURANTE")).toBe("Ifood Restaurante");
    expect(cleanDescription("TED 00012345 MARIA SOUZA")).toBe("Maria Souza");
  });

  it("aplica Title Case mantendo palavras de até 2 letras em minúsculas", () => {
    expect(cleanDescription("PADARIA DO ZE")).toBe("Padaria do ze");
    expect(cleanDescription("posto de gasolina ipiranga")).toBe("Posto de Gasolina Ipiranga");
  });

  it("colapsa espaços e remove separadores nas pontas", () => {
    expect(cleanDescription("  -  UBER   TRIP  :  ")).toBe("Uber Trip");
  });

  it("nunca devolve vazio: se tudo era ruído, devolve o original aparado", () => {
    expect(cleanDescription("  PIX RECEBIDO  ")).toBe("PIX RECEBIDO");
    expect(cleanDescription("COMPRA CARTAO 1234")).toBe("COMPRA CARTAO 1234");
  });

  it("mantém números curtos (até 3 dígitos) que fazem parte do nome", () => {
    expect(cleanDescription("99 POP 123")).toBe("99 Pop 123");
  });
});

describe("isNoiseOnlyDescription", () => {
  it.each([
    "PIX RECEBIDO",
    "TED RECEBIDA",
    "PAGAMENTO DE BOLETO",
    "Compra no débito",
    "Transferência enviada pelo Pix",
    "COMPRA CARTAO 1234",
    "",
  ])("'%s' é só ruído (não identifica ninguém)", (text) => {
    expect(isNoiseOnlyDescription(text)).toBe(true);
  });

  it.each(["PIX RECEBIDO JOAO SILVA", "Amazon", "PAGAMENTO DE BOLETO ENEL", "Uber"])(
    "'%s' identifica uma contraparte",
    (text) => {
      expect(isNoiseOnlyDescription(text)).toBe(false);
    }
  );

  it("exige ao menos uma palavra de 3+ letras fora da lista de genéricas", () => {
    expect(isNoiseOnlyDescription("PIX JO")).toBe(true);
    expect(isNoiseOnlyDescription("PIX 999")).toBe(true);
    expect(isNoiseOnlyDescription("PIX JOE")).toBe(false);
  });
});

describe("normalize", () => {
  const base: RawTransaction = {
    date: "05/07/2026",
    amount: -45.9,
    description: "  COMPRA CARTAO IFOOD *RESTAURANTE  ",
    origin: "import",
  };

  it("deduz 'saida' de valor negativo e guarda o valor sempre positivo (R2)", () => {
    const n = normalize(base);
    expect(n.type).toBe("saida");
    expect(n.amount).toBe(45.9);
  });

  it("deduz 'entrada' de valor positivo", () => {
    const n = normalize({ ...base, amount: 3500, description: "SALARIO EMPRESA X" });
    expect(n.type).toBe("entrada");
    expect(n.amount).toBe(3500);
  });

  it("respeita o tipo explícito da fonte, mesmo com sinal contrário", () => {
    const n = normalize({ ...base, amount: 45.9, type: "saida" });
    expect(n.type).toBe("saida");
    const estorno = normalize({ ...base, amount: -20, type: "entrada" });
    expect(estorno.type).toBe("entrada");
    expect(estorno.amount).toBe(20);
  });

  it("normaliza data e descrição e preserva a descrição bruta aparada", () => {
    const n = normalize(base);
    expect(n.date).toBe("2026-07-05");
    expect(n.description).toBe("Ifood Restaurante");
    expect(n.rawDescription).toBe("COMPRA CARTAO IFOOD *RESTAURANTE");
  });

  it("propaga os campos estruturados da fonte sem transformá-los", () => {
    const payload = { id: "p1" };
    const n = normalize({
      ...base,
      externalId: "ext-1",
      counterpartyName: "Restaurante Sabor",
      counterpartyDocument: "12345678000199",
      paymentMethod: "credito",
      operationType: "OUTROS",
      merchantName: "IFOOD",
      pluggyCategory: "Food delivery",
      pluggyCategoryId: "07010000",
      status: "POSTED",
      hasCreditCard: true,
      rawPayload: payload,
    });
    expect(n).toMatchObject({
      externalId: "ext-1",
      counterpartyName: "Restaurante Sabor",
      counterpartyDocument: "12345678000199",
      paymentMethod: "credito",
      operationType: "OUTROS",
      merchantName: "IFOOD",
      pluggyCategory: "Food delivery",
      pluggyCategoryId: "07010000",
      status: "POSTED",
      hasCreditCard: true,
    });
    expect(n.rawPayload).toBe(payload);
  });

  it("normalizeMany aplica normalize a cada item, preservando a ordem", () => {
    const out = normalizeMany([base, { ...base, amount: 10, description: "PIX RECEBIDO MARIA" }]);
    expect(out.map((t) => [t.type, t.description])).toEqual([
      ["saida", "Ifood Restaurante"],
      ["entrada", "Maria"],
    ]);
  });
});
