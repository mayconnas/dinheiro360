// ─────────────────────────────────────────────────────────────
// Camada 3.2 — Projeção de Fluxo (R8)
// projeção_fim = saldo_atual + receitas_previstas_restantes
//                − (gasto_médio_diário × dias_restantes)
// "Disponível hoje" = (teto_total − já_gasto) ÷ dias_restantes
// Puro; recebe "hoje" por parâmetro (nunca chama Date.now internamente
// para ser determinístico e testável).
// ─────────────────────────────────────────────────────────────
import type { Budget, Transaction } from "@/lib/types";
import { daysInMonth, filterByMonth, sumBy } from "./aggregate";

export interface Projection {
  month: string;
  /** dia atual dentro do mês (1..N) */
  currentDay: number;
  daysInMonth: number;
  daysRemaining: number;
  incomeSoFar: number;
  expenseSoFar: number;
  balanceSoFar: number;
  /** média diária de gasto até aqui */
  avgDailyExpense: number;
  /** receitas ainda esperadas no mês (recorrências futuras) */
  expectedIncomeRemaining: number;
  /** projeção de sobra no fechamento */
  projectedMonthEnd: number;
  /** "verde" se projeta sobra, "vermelho" se déficit */
  signal: "verde" | "vermelho";
  /** quanto ainda dá pra gastar por dia sem furar o orçamento total */
  dailyAllowance: number | null;
}

/**
 * @param today  data ISO "de hoje" (permite testes determinísticos)
 * @param expectedIncomeRemaining  receitas fixas ainda por cair (do detector
 *        de recorrências). Default 0 se não informado.
 */
export function projectCashflow(
  txs: Transaction[],
  month: string,
  today: string,
  budgets: Budget[],
  expectedIncomeRemaining = 0
): Projection {
  const totalDays = daysInMonth(month);
  const todayDay = Number(today.slice(8, 10));
  // se "hoje" não é do mês projetado, assume mês inteiro decorrido
  const inMonth = today.slice(0, 7) === month;
  const currentDay = inMonth ? Math.min(todayDay, totalDays) : totalDays;
  const daysRemaining = Math.max(0, totalDays - currentDay);

  const monthTx = filterByMonth(txs, month);
  const incomeSoFar = sumBy(monthTx, "entrada");
  const expenseSoFar = sumBy(monthTx, "saida");
  const balanceSoFar = incomeSoFar - expenseSoFar;

  const avgDailyExpense = currentDay > 0 ? expenseSoFar / currentDay : 0;
  const projectedExpenseRemaining = avgDailyExpense * daysRemaining;

  const projectedMonthEnd =
    balanceSoFar + expectedIncomeRemaining - projectedExpenseRemaining;

  const totalLimit = budgets.reduce((acc, b) => acc + b.limit, 0);
  const dailyAllowance =
    totalLimit > 0 && daysRemaining > 0
      ? Math.max(0, totalLimit - expenseSoFar) / daysRemaining
      : null;

  return {
    month,
    currentDay,
    daysInMonth: totalDays,
    daysRemaining,
    incomeSoFar,
    expenseSoFar,
    balanceSoFar,
    avgDailyExpense,
    expectedIncomeRemaining,
    projectedMonthEnd,
    signal: projectedMonthEnd >= 0 ? "verde" : "vermelho",
    dailyAllowance,
  };
}
