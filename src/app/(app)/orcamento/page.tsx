import {
  getTransactions,
  getBudgets,
  getCategories,
} from "@/lib/data/repository";
import { computeBudget, suggestLimits } from "@/lib/engine/budget";
import { BudgetView } from "@/components/budget-view";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Primeiro dia do mês `months` meses atrás (ISO AAAA-MM-DD). */
function isoMonthsAgo(months: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default async function OrcamentoPage() {
  const month = currentMonth();

  // A tela só precisa de transactions + budgets + categories. O orçamento
  // olha o mês atual e a sugestão usa média de 3 meses, então 6 meses de
  // histórico cobrem tudo sem baixar o passado inteiro.
  const [transactions, budgets, categories] = await Promise.all([
    getTransactions(isoMonthsAgo(6)),
    getBudgets(),
    getCategories(),
  ]);
  const ws = { transactions, budgets, categories };

  const lines = computeBudget(ws.transactions, month, ws.budgets, ws.categories);

  // sugestões: categorias com média nos últimos 3 meses e SEM teto ainda
  const budgetedIds = new Set(ws.budgets.map((b) => b.categoryId));
  const catById = new Map(ws.categories.map((c) => [c.id, c]));
  const suggested = suggestLimits(ws.transactions, month);
  const suggestions = [...suggested.entries()]
    .filter(([catId]) => !budgetedIds.has(catId) && catById.get(catId)?.kind !== "receita")
    .map(([catId, value]) => ({
      categoryId: catId,
      categoryName: catById.get(catId)?.name ?? "Sem categoria",
      suggested: value,
    }))
    .slice(0, 8);

  return <BudgetView lines={lines} suggestions={suggestions} />;
}
