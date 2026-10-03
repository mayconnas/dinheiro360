import { describe, expect, it } from "vitest";
import { projectCashflow } from "./projection";
import { makeBudget, makeTransaction as tx } from "../../../test/fixtures";

const month = "2026-07"; // 31 dias
const txs = [
  tx({ date: "2026-07-05", type: "entrada", amount: 3000 }),
  tx({ date: "2026-07-06", amount: 400 }),
  tx({ date: "2026-07-09", amount: 600 }),
  tx({ date: "2026-07-09", amount: 5000, isDuplicate: true }), // ignorada
  tx({ date: "2026-06-30", amount: 999 }), // outro mês
];

describe("projectCashflow (R8)", () => {
  it("projeta o fechamento: saldo atual + receitas previstas − gasto médio diário × dias restantes", () => {
    const p = projectCashflow(txs, month, "2026-07-10", [], 500);
    expect(p).toMatchObject({
      currentDay: 10,
      daysInMonth: 31,
      daysRemaining: 21,
      incomeSoFar: 3000,
      expenseSoFar: 1000,
      balanceSoFar: 2000,
      avgDailyExpense: 100,
      expectedIncomeRemaining: 500,
    });
    // 2000 + 500 − 100 × 21 = 400
    expect(p.projectedMonthEnd).toBe(400);
    expect(p.signal).toBe("verde");
  });

  it("sinaliza vermelho quando a projeção é de déficit", () => {
    const p = projectCashflow(txs, month, "2026-07-10", []);
    // 2000 − 2100 = −100
    expect(p.projectedMonthEnd).toBe(-100);
    expect(p.signal).toBe("vermelho");
  });

  it("projeção exatamente zero conta como verde", () => {
    const p = projectCashflow(txs, month, "2026-07-10", [], 100);
    expect(p.projectedMonthEnd).toBe(0);
    expect(p.signal).toBe("verde");
  });

  it("calcula o disponível por dia a partir do teto total de orçamento", () => {
    const budgets = [makeBudget({ categoryId: "a", limit: 2000 }), makeBudget({ categoryId: "b", limit: 1150 })];
    const p = projectCashflow(txs, month, "2026-07-10", budgets);
    // (3150 − 1000) / 21
    expect(p.dailyAllowance).toBeCloseTo(2150 / 21);
  });

  it("disponível por dia nunca fica negativo quando o teto já estourou", () => {
    const p = projectCashflow(txs, month, "2026-07-10", [makeBudget({ categoryId: "a", limit: 500 })]);
    expect(p.dailyAllowance).toBe(0);
  });

  it("sem orçamento, o disponível por dia é null", () => {
    expect(projectCashflow(txs, month, "2026-07-10", []).dailyAllowance).toBeNull();
  });

  it("quando 'hoje' é de outro mês, considera o mês inteiro decorrido", () => {
    const p = projectCashflow(txs, month, "2026-08-02", [makeBudget({ categoryId: "a", limit: 5000 })]);
    expect(p.currentDay).toBe(31);
    expect(p.daysRemaining).toBe(0);
    expect(p.projectedMonthEnd).toBe(p.balanceSoFar);
    expect(p.dailyAllowance).toBeNull(); // sem dias restantes
  });

  it("no último dia do mês não projeta gasto adicional", () => {
    const p = projectCashflow(txs, month, "2026-07-31", []);
    expect(p.daysRemaining).toBe(0);
    expect(p.projectedMonthEnd).toBe(2000);
  });

  it("mês sem transações projeta zero", () => {
    const p = projectCashflow([], "2026-02", "2026-02-14", []);
    expect(p).toMatchObject({ daysInMonth: 28, daysRemaining: 14, avgDailyExpense: 0, projectedMonthEnd: 0 });
  });
});
