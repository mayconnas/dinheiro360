import { describe, expect, it } from "vitest";
import {
  PERIOD_PRESETS,
  combinedExclusionIds,
  filterByPeriod,
  formatRange,
  groupByDate,
  groupByPayee,
  periodSummary,
} from "./view-helpers";
import { makeTransaction as tx } from "../../../test/fixtures";

/** "Hoje" local, sem fuso: 15/07/2026. */
const today = new Date(2026, 6, 15);

describe("PERIOD_PRESETS", () => {
  it("calcula os seis presets a partir do 'hoje' informado", () => {
    expect(PERIOD_PRESETS(today)).toEqual({
      mes_atual: { from: "2026-07-01", to: "2026-07-15" },
      mes_inteiro: { from: "2026-07-01", to: "2026-07-31" },
      mes_passado: { from: "2026-06-01", to: "2026-06-30" },
      ult7: { from: "2026-07-09", to: "2026-07-15" },
      ult30: { from: "2026-06-16", to: "2026-07-15" },
      ano: { from: "2026-01-01", to: "2026-07-15" },
    });
  });

  it("vira o ano no 'mês passado' de janeiro e atravessa meses nos últimos 7 dias", () => {
    expect(PERIOD_PRESETS(new Date(2026, 0, 10)).mes_passado).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(PERIOD_PRESETS(new Date(2026, 2, 3)).ult7).toEqual({ from: "2026-02-25", to: "2026-03-03" });
  });

  it("mês inteiro de fevereiro em ano bissexto termina no dia 29", () => {
    expect(PERIOD_PRESETS(new Date(2028, 1, 10)).mes_inteiro.to).toBe("2028-02-29");
  });
});

describe("filterByPeriod", () => {
  it("inclui as duas pontas do intervalo", () => {
    const txs = ["2026-06-30", "2026-07-01", "2026-07-15", "2026-07-16"].map((date) => tx({ id: date, date }));
    expect(filterByPeriod(txs, "2026-07-01", "2026-07-15").map((t) => t.id)).toEqual(["2026-07-01", "2026-07-15"]);
  });
});

describe("formatRange", () => {
  it("mesmo mês, meses diferentes no mesmo ano e anos diferentes", () => {
    expect(formatRange("2026-07-01", "2026-07-20")).toBe("1–20 jul 2026");
    expect(formatRange("2026-06-28", "2026-07-03")).toBe("28 jun – 3 jul 2026");
    expect(formatRange("2025-12-28", "2026-01-03")).toBe("28 dez 2025 – 3 jan 2026");
  });
});

describe("groupByDate", () => {
  const txs = [
    tx({ id: "a", date: "2026-07-13", amount: 50 }),
    tx({ id: "b", date: "2026-07-15", amount: 30 }),
    tx({ id: "c", date: "2026-07-15", amount: 1000, type: "entrada" }),
    tx({ id: "d", date: "2026-07-14", amount: 200 }),
    tx({ id: "transf", date: "2026-07-15", amount: 500 }),
  ];

  it("agrupa por dia, do mais recente ao mais antigo, com rótulos Hoje/Ontem", () => {
    const groups = groupByDate(txs, today);
    expect(groups.map((g) => [g.dateISO, g.label.primary, g.label.secondary])).toEqual([
      ["2026-07-15", "Hoje", "15 jul"],
      ["2026-07-14", "Ontem", "14 jul"],
      ["2026-07-13", "13 jul", ""],
    ]);
  });

  it("soma entradas e saídas do dia (positivas) e exclui ids internos das somas, mas não da lista", () => {
    const [hoje] = groupByDate(txs, today, new Set(["transf"]));
    expect(hoje.income).toBe(1000);
    expect(hoje.expense).toBe(30);
    expect(hoje.items.map((t) => t.id)).toContain("transf");
  });
});

describe("groupByPayee", () => {
  it("agrupa pelo destinatário cadastrado quando há payeeId com nome, senão pela descrição", () => {
    const txs = [
      tx({ id: "1", description: "MARIA", payeeId: "p-maria", amount: 100, date: "2026-07-01" }),
      tx({ id: "2", description: "Maria", payeeId: "p-maria", amount: 50, date: "2026-07-05" }),
      tx({ id: "3", description: "Uber Trip", amount: 30 }),
      tx({ id: "4", description: "Uber Trip", amount: 20 }),
      tx({ id: "5", description: "Sem Nome", payeeId: "p-sem-nome", amount: 10 }), // payeeId sem nome no mapa
    ];
    const groups = groupByPayee(txs, new Map([["p-maria", "Maria Oliveira"]]));
    expect(groups.map((g) => [g.payee, g.count])).toEqual([
      ["Maria Oliveira", 2],
      ["Uber Trip", 2],
      ["Sem Nome", 1],
    ]);
    // itens do grupo do mais recente ao mais antigo
    expect(groups[0].items.map((t) => t.id)).toEqual(["2", "1"]);
  });

  it("calcula o saldo líquido (entradas − saídas) e ordena por movimentação absoluta", () => {
    const txs = [
      tx({ description: "Joao Silva", type: "entrada", amount: 300 }),
      tx({ description: "Joao Silva", type: "saida", amount: 300 }),
      tx({ description: "Mercado Dia", amount: 500 }),
    ];
    const groups = groupByPayee(txs);
    // Joao movimentou 600 (líquido 0); Mercado movimentou 500
    expect(groups.map((g) => [g.payee, g.net])).toEqual([
      ["Joao Silva", 0],
      ["Mercado Dia", -500],
    ]);
  });

  it("gera iniciais com até duas palavras", () => {
    const groups = groupByPayee([
      tx({ description: "Joao Silva Santos", amount: 3 }),
      tx({ description: "ifood", amount: 2 }),
      tx({ description: "***", amount: 1 }),
    ]);
    expect(groups.map((g) => g.initials)).toEqual(["JS", "I", "•"]);
  });

  // Regressão (corrigido) (view-helpers.ts:219): `.replace(/[^A-Z0-9]/g, "")` apaga letras
  // acentuadas — "Érica Souza" vira só "S" e "Ângela" vira "•". Nomes
  // brasileiros com inicial acentuada perdem o avatar. Sugestão: filtrar
  // com /[^\p{Lu}\p{N}]/gu.
  it("mantém iniciais acentuadas como em 'Érica Souza'", () => {
    const [g] = groupByPayee([tx({ description: "Érica Souza" })]);
    expect(g.initials).toBe("ÉS");
  });
});

describe("periodSummary", () => {
  const txs = [
    tx({ id: "sal", type: "entrada", amount: 5000 }),
    tx({ id: "ifood", amount: 60 }),
    tx({ id: "uber", amount: 40 }),
    tx({ id: "transf", amount: 1000 }),
    tx({ id: "valor-adicionado", type: "entrada", amount: 300 }),
  ];

  it("soma tudo quando não há exclusões", () => {
    expect(periodSummary(txs)).toEqual({ income: 5300, expense: 1100, balance: 4200, count: 5, avgSpend: 1100 / 3 });
  });

  it("exclui os ids informados de receita/despesa/média, mas continua contando todos os lançamentos", () => {
    expect(periodSummary(txs, new Set(["transf", "valor-adicionado"]))).toEqual({
      income: 5000,
      expense: 100,
      balance: 4900,
      count: 5,
      avgSpend: 50,
    });
  });

  it("período sem saídas tem gasto médio zero", () => {
    expect(periodSummary([]).avgSpend).toBe(0);
  });
});

describe("combinedExclusionIds", () => {
  it("une os três Sets da classificação", () => {
    const ids = combinedExclusionIds({
      excludeFromIncome: new Set(["a", "b"]),
      excludeFromExpense: new Set(["b", "c"]),
      cardPurchase: new Set(["d"]),
    });
    expect([...ids].sort()).toEqual(["a", "b", "c", "d"]);
  });
});
