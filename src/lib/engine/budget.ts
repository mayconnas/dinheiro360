// ─────────────────────────────────────────────────────────────
// Camada 3.1 — Orçamento (R6/R7)
// Status por categoria: gasto, teto, % consumido, restante.
// Alerta em 80%, estouro em 100%. Sem teto = "sem controle".
// Teto sugerido = média dos últimos 3 meses.
// Puro.
// ─────────────────────────────────────────────────────────────
import type { Budget, Category, Transaction } from "@/lib/types";
import {
  avgExpenseByCategory,
  expenseByCategory,
} from "./aggregate";

export type BudgetStatus = "ok" | "alerta" | "estourado" | "sem_controle";

export interface BudgetLine {
  categoryId: string;
  categoryName: string;
  color: string;
  spent: number;
  limit: number | null;
  /** fração 0..1+ do teto consumido (null se sem teto) */
  consumed: number | null;
  remaining: number | null;
  status: BudgetStatus;
}

const ALERT_THRESHOLD = 0.8; // R6
const OVER_THRESHOLD = 1.0; // R6

export function computeBudget(
  txs: Transaction[],
  month: string,
  budgets: Budget[],
  categories: Category[]
): BudgetLine[] {
  const spentByCat = expenseByCategory(txs, month);
  const budgetByCat = new Map(budgets.map((b) => [b.categoryId, b.limit]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  // toda categoria de despesa com gasto OU com teto entra na lista
  const catIds = new Set<string>([
    ...spentByCat.keys(),
    ...budgetByCat.keys(),
  ]);

  const lines: BudgetLine[] = [];
  for (const id of catIds) {
    const cat = catById.get(id);
    if (cat && cat.kind === "receita") continue; // orçamento é de despesa
    const spent = spentByCat.get(id) ?? 0;
    const limit = budgetByCat.get(id) ?? null;

    let status: BudgetStatus;
    let consumed: number | null = null;
    let remaining: number | null = null;

    if (limit === null || limit <= 0) {
      status = "sem_controle";
    } else {
      consumed = spent / limit;
      remaining = limit - spent;
      if (consumed >= OVER_THRESHOLD) status = "estourado";
      else if (consumed >= ALERT_THRESHOLD) status = "alerta";
      else status = "ok";
    }

    lines.push({
      categoryId: id,
      categoryName: cat?.name ?? "Sem categoria",
      color: cat?.color ?? "#94a3b8",
      spent,
      limit,
      consumed,
      remaining,
      status,
    });
  }

  // ordena: estourado > alerta > ok > sem_controle, depois por gasto desc
  const rank: Record<BudgetStatus, number> = {
    estourado: 0,
    alerta: 1,
    ok: 2,
    sem_controle: 3,
  };
  return lines.sort(
    (a, b) => rank[a.status] - rank[b.status] || b.spent - a.spent
  );
}

/** R7 — teto sugerido = média dos últimos 3 meses da categoria. */
export function suggestLimits(
  txs: Transaction[],
  month: string
): Map<string, number> {
  const avg = avgExpenseByCategory(txs, month, 3);
  const suggestions = new Map<string, number>();
  for (const [cat, value] of avg) {
    if (value > 0) {
      // arredonda pra cima em múltiplos de 10 pra ficar "limpo"
      suggestions.set(cat, Math.ceil(value / 10) * 10);
    }
  }
  return suggestions;
}
