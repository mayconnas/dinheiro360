import { describe, expect, it } from "vitest";
import {
  avgExpenseByCategory,
  cashflowTotals,
  daysInMonth,
  expenseByCategory,
  filterByMonth,
  mean,
  monthKey,
  monthTotals,
  monthsPresent,
  previousMonths,
  realTransactions,
  spendingByCategory,
  spendingTotal,
  stdDev,
  sumBy,
} from "./aggregate";
import { makeTransaction as tx } from "../../../test/fixtures";

const julho = [
  tx({ id: "sal", date: "2026-07-05", type: "entrada", amount: 5000, categoryId: "salario" }),
  tx({ id: "ifood", date: "2026-07-06", amount: 80, categoryId: "comida" }),
  tx({ id: "ifood2", date: "2026-07-20", amount: 40, categoryId: "comida" }),
  tx({ id: "mercado", date: "2026-07-21", amount: 300, categoryId: "mercado" }),
  tx({ id: "semcat", date: "2026-07-22", amount: 15, categoryId: null }),
  tx({ id: "dup", date: "2026-07-22", amount: 999, categoryId: "comida", isDuplicate: true }),
];
const junho = [
  tx({ id: "jun-ifood", date: "2026-06-10", amount: 60, categoryId: "comida" }),
  tx({ id: "jun-sal", date: "2026-06-05", type: "entrada", amount: 4800 }),
];

describe("helpers de data", () => {
  it("monthKey extrai AAAA-MM", () => {
    expect(monthKey("2026-07-31")).toBe("2026-07");
  });

  it("previousMonths devolve os N meses anteriores, do mais recente ao mais antigo, virando o ano", () => {
    expect(previousMonths("2026-02", 3)).toEqual(["2026-01", "2025-12", "2025-11"]);
    expect(previousMonths("2026-07", 0)).toEqual([]);
  });

  it("daysInMonth considera ano bissexto", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-07")).toBe(31);
    expect(daysInMonth("2026-09")).toBe(30);
  });
});

describe("filtros e somas", () => {
  it("realTransactions descarta duplicatas marcadas (R3)", () => {
    expect(realTransactions(julho).map((t) => t.id)).not.toContain("dup");
  });

  it("filterByMonth filtra pelo mês e ignora duplicatas", () => {
    const ids = filterByMonth([...julho, ...junho], "2026-07").map((t) => t.id);
    expect(ids).toEqual(["sal", "ifood", "ifood2", "mercado", "semcat"]);
  });

  it("sumBy soma só o tipo pedido", () => {
    expect(sumBy(julho, "entrada")).toBe(5000);
    // sumBy não filtra duplicata: quem chama passa a lista já filtrada
    expect(sumBy(julho, "saida")).toBe(80 + 40 + 300 + 15 + 999);
  });

  it("monthTotals calcula receita, despesa e saldo do mês sem duplicatas", () => {
    expect(monthTotals(julho, "2026-07")).toEqual({
      month: "2026-07",
      income: 5000,
      expense: 435,
      balance: 4565,
    });
  });

  it("monthTotals aplica exclusões só do lado (receita/despesa) a que cada Set se aplica", () => {
    const totals = monthTotals(julho, "2026-07", {
      // "ifood" é saída: estar em excludeFromIncome não deve afetá-la
      excludeFromIncome: new Set(["sal", "ifood"]),
      excludeFromExpense: new Set(["mercado"]),
      cardPurchase: new Set(["ifood2"]),
    });
    expect(totals.income).toBe(0);
    expect(totals.expense).toBe(80 + 15);
  });

  it("expenseByCategory agrupa saídas por categoria, com chave 'sem_categoria'", () => {
    const map = expenseByCategory(julho, "2026-07");
    expect(Object.fromEntries(map)).toEqual({ comida: 120, mercado: 300, sem_categoria: 15 });
  });

  it("monthsPresent lista meses com transações reais, do mais recente ao mais antigo", () => {
    const old = tx({ date: "2025-12-01", isDuplicate: true });
    expect(monthsPresent([...junho, ...julho, old])).toEqual(["2026-07", "2026-06"]);
  });
});

describe("visões por inclusão (fluxo de caixa × controle de gastos)", () => {
  it("cashflowTotals soma só os ids presentes nos Sets, respeitando o tipo", () => {
    const totals = cashflowTotals(julho, "2026-07", {
      income: new Set(["sal", "ifood"]), // ifood é saída: ignorado do lado income
      expense: new Set(["mercado", "dup"]), // dup é duplicata: nunca conta
    });
    expect(totals).toEqual({ month: "2026-07", income: 5000, expense: 300, balance: 4700 });
  });

  it("spendingTotal e spendingByCategory usam o Set de gastos", () => {
    const spending = new Set(["ifood", "ifood2", "semcat", "sal"]);
    expect(spendingTotal(julho, "2026-07", spending)).toEqual({ month: "2026-07", total: 135 });
    expect(Object.fromEntries(spendingByCategory(julho, "2026-07", spending))).toEqual({
      comida: 120,
      sem_categoria: 15,
    });
  });
});

describe("estatística", () => {
  it("avgExpenseByCategory divide pelo número de meses do lookback, inclusive meses vazios", () => {
    const txs = [
      tx({ date: "2026-06-10", amount: 300, categoryId: "comida" }),
      tx({ date: "2026-05-10", amount: 150, categoryId: "comida" }),
      tx({ date: "2026-07-10", amount: 9999, categoryId: "comida" }), // mês atual: fora
    ];
    const avg = avgExpenseByCategory(txs, "2026-07", 3);
    expect(avg.get("comida")).toBe(150); // (300 + 150 + 0) / 3
  });

  it("mean e stdDev (amostral) com casos de borda", () => {
    expect(mean([])).toBe(0);
    expect(mean([2, 4, 6])).toBe(4);
    expect(stdDev([5])).toBe(0);
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });
});
