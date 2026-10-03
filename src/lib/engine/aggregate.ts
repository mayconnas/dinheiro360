// ─────────────────────────────────────────────────────────────
// Helpers de agregação compartilhados pela Camada 3.
// Puros, sem IO.
// ─────────────────────────────────────────────────────────────
import type { Transaction } from "@/lib/types";

/** Chave AAAA-MM de uma data ISO. */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Só transações reais (ignora duplicatas marcadas — R3). */
export function realTransactions(txs: Transaction[]): Transaction[] {
  return txs.filter((t) => !t.isDuplicate);
}

export function filterByMonth(txs: Transaction[], month: string): Transaction[] {
  return realTransactions(txs).filter((t) => monthKey(t.date) === month);
}

export function sumBy(
  txs: Transaction[],
  type: "entrada" | "saida"
): number {
  return txs
    .filter((t) => t.type === type)
    .reduce((acc, t) => acc + t.amount, 0);
}

export interface MonthTotals {
  month: string;
  income: number;
  expense: number;
  balance: number; // income - expense
}

/**
 * Exclusões produzidas por `classifyTransactions`
 * (src/lib/engine/transfers.ts) — o motor de regras de negócio (CPF do
 * dono, cartão=dívida, casos especiais Pluggy). Cada Set é opcional e
 * independente; `monthTotals` só exclui do lado (receita/despesa) a que
 * cada Set se aplica.
 */
export interface MonthTotalsExclusions {
  /** ids (entrada) que não contam como receita. */
  excludeFromIncome?: Set<string>;
  /** ids (saída) que não contam como despesa. */
  excludeFromExpense?: Set<string>;
  /**
   * ids (saída, compra no cartão) que são dívida, não despesa de fluxo de
   * caixa — também excluídos da despesa, junto com `excludeFromExpense`.
   */
  cardPurchase?: Set<string>;
}

/**
 * Totais de receita/despesa do mês. `exclusions`, quando passado (ver
 * classifyTransactions em src/lib/engine/transfers.ts), tira do
 * income/expense as transações que não são receita/despesa REAL de fluxo
 * de caixa: transferência entre contas próprias (regra do CPF), compra no
 * cartão (é dívida — só vira despesa quando a fatura é paga), "valor
 * adicionado" (Pix no crédito, é financiamento) e movimentação interna de
 * fatura/estorno do cartão. Retrocompatível: sem o parâmetro, soma tudo
 * como antes.
 */
export function monthTotals(
  txs: Transaction[],
  month: string,
  exclusions?: MonthTotalsExclusions
): MonthTotals {
  let m = filterByMonth(txs, month);
  if (exclusions) {
    const { excludeFromIncome, excludeFromExpense, cardPurchase } = exclusions;
    m = m.filter((t) => {
      if (t.type === "entrada" && excludeFromIncome?.has(t.id)) return false;
      if (
        t.type === "saida" &&
        (excludeFromExpense?.has(t.id) || cardPurchase?.has(t.id))
      ) {
        return false;
      }
      return true;
    });
  }
  const income = sumBy(m, "entrada");
  const expense = sumBy(m, "saida");
  return { month, income, expense, balance: income - expense };
}

/** Gasto por categoria num mês. */
export function expenseByCategory(
  txs: Transaction[],
  month: string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of filterByMonth(txs, month)) {
    if (t.type !== "saida") continue;
    const key = t.categoryId ?? "sem_categoria";
    map.set(key, (map.get(key) ?? 0) + t.amount);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────
// DUAS VISÕES (ver src/lib/engine/transfers.ts classifyForViews) —
// versões "por inclusão" das agregações acima: em vez de um Set de
// EXCLUSÃO (MonthTotalsExclusions, legado, mantido intocado acima), estas
// recebem o(s) Set(s) de INCLUSÃO já prontos de `classifyForViews`
// (cashflow.income/expense, spending) e só somam quem está no Set. Mais
// simples de auditar (o Set É a verdade, não "tudo menos o Set") e evita
// reimplementar a lógica de exclusão em cada camada de consumo.
// ─────────────────────────────────────────────────────────────

/**
 * Totais de FLUXO DE CAIXA do mês — dinheiro líquido real que entrou/saiu
 * das contas (recebimentos/salário de um lado; PIX/débito a terceiro +
 * PAGAMENTO DE FATURA do outro). `incomeIds`/`expenseIds` vêm de
 * `classifyForViews(...).cashflow` (transfers.ts); passar os Sets certos
 * é responsabilidade de quem chama — esta função só filtra e soma.
 */
export function cashflowTotals(
  txs: Transaction[],
  month: string,
  sets: { income: ReadonlySet<string>; expense: ReadonlySet<string> }
): MonthTotals {
  let income = 0;
  let expense = 0;
  for (const t of filterByMonth(txs, month)) {
    if (t.type === "entrada" && sets.income.has(t.id)) income += t.amount;
    else if (t.type === "saida" && sets.expense.has(t.id)) expense += t.amount;
  }
  return { month, income, expense, balance: income - expense };
}

export interface SpendingTotal {
  month: string;
  /** soma dos gastos categorizáveis do mês (compras avista + no cartão; SEM pagamento de fatura). */
  total: number;
}

/**
 * Total de CONTROLE DE GASTOS do mês — quanto gastei, por categoria (ver
 * `spendingByCategory` abaixo) somado num único número. `spendingIds` vem
 * de `classifyForViews(...).spending` (transfers.ts).
 */
export function spendingTotal(
  txs: Transaction[],
  month: string,
  spendingIds: ReadonlySet<string>
): SpendingTotal {
  let total = 0;
  for (const t of filterByMonth(txs, month)) {
    if (t.type === "saida" && spendingIds.has(t.id)) total += t.amount;
  }
  return { month, total };
}

/**
 * Gasto por categoria num mês, na visão CONTROLE DE GASTOS — inclui
 * compra no cartão (categorizada individualmente), exclui pagamento de
 * fatura (a ponte — já contado nas compras que a formaram). Mesma forma
 * de `expenseByCategory` acima (chave "sem_categoria" quando sem
 * categoryId), só que filtrado por `spendingIds` em vez de todo `saida`.
 */
export function spendingByCategory(
  txs: Transaction[],
  month: string,
  spendingIds: ReadonlySet<string>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of filterByMonth(txs, month)) {
    if (t.type !== "saida") continue;
    if (!spendingIds.has(t.id)) continue;
    const key = t.categoryId ?? "sem_categoria";
    map.set(key, (map.get(key) ?? 0) + t.amount);
  }
  return map;
}

/** Lista de meses (AAAA-MM) presentes, ordenada desc. */
export function monthsPresent(txs: Transaction[]): string[] {
  const set = new Set(realTransactions(txs).map((t) => monthKey(t.date)));
  return [...set].sort().reverse();
}

/** Os N meses anteriores a `month` (exclusivo), do mais recente ao mais antigo. */
export function previousMonths(month: string, n: number): string[] {
  const [y, m] = month.split("-").map(Number);
  const out: string[] = [];
  let year = y;
  let mon = m;
  for (let i = 0; i < n; i++) {
    mon -= 1;
    if (mon === 0) {
      mon = 12;
      year -= 1;
    }
    out.push(`${year}-${String(mon).padStart(2, "0")}`);
  }
  return out;
}

/** Média de gasto por categoria nos últimos N meses (exclui o mês atual). */
export function avgExpenseByCategory(
  txs: Transaction[],
  currentMonth: string,
  lookback: number
): Map<string, number> {
  const months = previousMonths(currentMonth, lookback);
  const totals = new Map<string, number>();
  for (const month of months) {
    const byCat = expenseByCategory(txs, month);
    for (const [cat, val] of byCat) {
      totals.set(cat, (totals.get(cat) ?? 0) + val);
    }
  }
  const avg = new Map<string, number>();
  const divisor = Math.max(1, months.length);
  for (const [cat, total] of totals) avg.set(cat, total / divisor);
  return avg;
}

export function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function stdDev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance =
    nums.reduce((acc, n) => acc + (n - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

/** Quantos dias tem o mês AAAA-MM. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
