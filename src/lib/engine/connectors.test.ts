import { describe, expect, it } from "vitest";
import { importCSVConnector, manualConnector, parseAmount } from "./connectors";

describe("manualConnector", () => {
  it("devolve a RawTransaction canônica com origem manual", () => {
    expect(
      manualConnector({ date: "2026-07-10", amount: 35, type: "saida", description: "Padaria", account: "carteira" })
    ).toEqual({
      date: "2026-07-10",
      amount: 35,
      type: "saida",
      description: "Padaria",
      account: "carteira",
      origin: "manual",
    });
  });
});

describe("parseAmount", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1234.56", 1234.56],
    ["45,90", 45.9],
    ["R$ 1.234,56", 1234.56],
    ["-45,90", -45.9],
    ["R$ -45,90", -45.9],
    ["(45,90)", -45.9],
    ["100", 100],
  ])("'%s' → %s", (raw, expected) => {
    expect(parseAmount(raw)).toBeCloseTo(expected);
  });

  it("devolve NaN para vazio ou texto", () => {
    expect(parseAmount("   ")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
  });

  // Regressão (corrigido) (connectors.ts:92-102): só com pontos e sem vírgula, o valor é
  // lido como decimal en-US — "1.234.567" (milhar pt-BR) vira 1,234.
  // Mais de um ponto sem vírgula só pode ser separador de milhar.
  it("lê '1.234.567' como 1234567", () => {
    expect(parseAmount("1.234.567")).toBe(1234567);
  });
});

describe("importCSVConnector", () => {
  it("lê CSV pt-BR com ponto-e-vírgula, valores com vírgula e sinal deduzido depois", () => {
    const csv = [
      "Data;Descrição;Valor",
      "05/07/2026;IFOOD *RESTAURANTE;-45,90",
      "06/07/2026;PIX RECEBIDO JOAO SILVA;1.200,00",
    ].join("\n");
    const { transactions, errors } = importCSVConnector(csv);
    expect(errors).toEqual([]);
    expect(transactions).toEqual([
      { date: "05/07/2026", amount: -45.9, type: undefined, description: "IFOOD *RESTAURANTE", origin: "import" },
      { date: "06/07/2026", amount: 1200, type: undefined, description: "PIX RECEBIDO JOAO SILVA", origin: "import" },
    ]);
  });

  it("lê CSV com vírgula, aspas (inclusive aspas escapadas) e CRLF", () => {
    const csv =
      'date,description,amount\r\n2026-07-05,"Mercado Extra, unidade ""Centro""",-152.30\r\n2026-07-06,Uber,-23.5\r\n';
    const { transactions } = importCSVConnector(csv);
    expect(transactions.map((t) => [t.description, t.amount])).toEqual([
      ['Mercado Extra, unidade "Centro"', -152.3],
      ["Uber", -23.5],
    ]);
  });

  it("reconhece a coluna de tipo (entrada/saída, crédito/débito, C/D)", () => {
    const csv = [
      "Data;Histórico;Valor;Tipo",
      "01/07/2026;Salario;5000,00;Crédito",
      "02/07/2026;Aluguel;1800,00;Débito",
      "03/07/2026;Reembolso;50,00;C",
      "04/07/2026;Netflix;55,90;D",
      "05/07/2026;Outro;10,00;?",
    ].join("\n");
    const types = importCSVConnector(csv).transactions.map((t) => t.type);
    expect(types).toEqual(["entrada", "saida", "entrada", "saida", undefined]);
  });

  it("usa 'Sem descrição' quando não há coluna ou valor de descrição", () => {
    const { transactions } = importCSVConnector("Data;Valor\n05/07/2026;-45,90\n");
    expect(transactions[0].description).toBe("Sem descrição");
  });

  it("reporta linhas com valor inválido e pula linhas incompletas ou em branco", () => {
    const csv = ["Data;Descrição;Valor", "05/07/2026;Uber;abc", ";Sem data;10,00", "", "07/07/2026;Padaria;-12,00"].join(
      "\n"
    );
    const { transactions, errors } = importCSVConnector(csv);
    expect(transactions.map((t) => t.description)).toEqual(["Padaria"]);
    expect(errors).toEqual(['Linha 2: valor inválido "abc".']);
  });

  it("recusa arquivo sem cabeçalho de data e valor", () => {
    expect(importCSVConnector("Nome;Idade\nAna;30").errors[0]).toMatch(/Não encontrei as colunas de data e valor/);
  });

  it("recusa arquivo vazio ou só com cabeçalho", () => {
    expect(importCSVConnector("").errors).toEqual(["Arquivo vazio ou sem cabeçalho."]);
    expect(importCSVConnector("Data;Valor\n").errors).toEqual(["Arquivo vazio ou sem cabeçalho."]);
  });
});
