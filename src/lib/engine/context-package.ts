// ─────────────────────────────────────────────────────────────
// O Pacote de Contexto — a fronteira entre o mundo dos números
// (camada 3) e o mundo da linguagem (camada 4).
//
// Regra: só número JÁ CALCULADO, formato compacto, ZERO extrato bruto.
// É o único que a IA "lê" antes de decidir. Montado exclusivamente a
// partir das saídas do motor de regras (determinístico).
// ─────────────────────────────────────────────────────────────
import type {
  Account,
  Budget,
  Category,
  Goal,
  Profile,
  Transaction,
} from "@/lib/types";
import { monthLabel } from "@/lib/utils";
import {
  cashflowTotals,
  daysInMonth,
  previousMonths,
  spendingByCategory,
  spendingTotal,
} from "./aggregate";
import { computeBudget } from "./budget";
import { projectCashflow } from "./projection";
import {
  detectRecurrences,
  expectedIncomeRemaining,
  expectedExpenseRemaining,
} from "./recurrences";
import { detectAnomalies } from "./anomalies";
import { computeIndicators, criticalIndicator } from "./indicators";
import { classifyForViews, classifyTransactions, OWNER_DOCUMENTS } from "./transfers";

// ─── Formato do Pacote (o "contrato" com a IA) ────────────────
export interface ContextPackage {
  perfil: {
    renda_media: number;
    tipo: string;
    dependentes: number;
    escada_prioridades: string[];
  };
  mes_atual: {
    referencia: string; // "julho de 2026"
    /** FLUXO DE CAIXA: dinheiro real que entrou no mês (recebimentos/salário). */
    receitas: number;
    /** FLUXO DE CAIXA: dinheiro real que saiu no mês (PIX/débito a terceiro + pagamento de fatura). */
    despesas: number;
    /** receitas − despesas (fluxo de caixa). */
    sobra: number;
    /**
     * CONTROLE DE GASTOS: quanto foi gasto no mês, por categoria — inclui
     * compra no cartão (categorizada individualmente), EXCLUI o pagamento
     * da fatura (as compras que a formaram já entram aqui uma a uma;
     * contar a fatura de novo dobraria). Ver `top_categorias` abaixo para
     * a quebra por categoria deste número. Tipicamente DIFERENTE de
     * `despesas` acima — os dois medem coisas diferentes de propósito
     * (dinheiro que saiu x onde foi gasto), não é um erro de conta.
     */
    gasto_categorizado: number;
    dias_restantes: number;
  };
  projecao: {
    fechamento_projetado: number;
    sinal: "verde" | "vermelho";
    disponivel_por_dia: number | null;
  };
  indicadores: {
    indicador: string;
    valor: number;
    unidade: string;
    status: string;
    tendencia: string;
  }[];
  degrau_atual: string;
  top_categorias: {
    categoria: string;
    gasto: number;
    percentual_do_total: number;
    vs_media: number | null; // fração: +0.3 = 30% acima
  }[];
  flags: {
    tipo: string;
    severidade: string;
    titulo: string;
    detalhe: string;
    valor?: number;
  }[];
  orcamento: {
    categoria: string;
    gasto: number;
    teto: number | null;
    consumido: number | null;
    status: string;
  }[];
  recorrencias: {
    descricao: string;
    valor: number;
    tipo: string;
    proxima: string;
    atrasada: boolean;
  }[];
  metas: {
    nome: string;
    alvo: number;
    atual: number;
    prazo: string | null;
    no_ritmo: boolean;
  }[];
  historico: {
    mes: string;
    receitas: number;
    despesas: number;
    sobra: number;
  }[];
}

export interface BuildContextInput {
  profile: Profile;
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  budgets: Budget[];
  goals: Goal[];
  month: string; // AAAA-MM
  today: string; // AAAA-MM-DD
}

/**
 * Monta o Pacote de Contexto rodando todo o motor de regras.
 * Este é o ÚNICO ponto que a camada 4 deve consumir para ganhar números.
 */
export function buildContextPackage(
  input: BuildContextInput
): ContextPackage {
  const {
    profile,
    transactions,
    categories,
    accounts,
    budgets,
    goals,
    month,
    today,
  } = input;

  const catById = new Map(categories.map((c) => [c.id, c]));
  const fixedCategoryIds = new Set(
    categories.filter((c) => c.nature === "fixa").map((c) => c.id)
  );
  const discretionaryCategoryIds = new Set(
    categories.filter((c) => c.nature === "discricionaria").map((c) => c.id)
  );

  // Classifica cada transação segundo as regras de negócio do usuário (CPF
  // do dono, cartão=dívida, casos especiais Pluggy) — ver
  // src/lib/engine/transfers.ts classifyTransactions. Transferência entre
  // contas próprias, compra no cartão (dívida) e movimentação interna do
  // cartão não são receita nem despesa REAL de fluxo de caixa. A IA só
  // enxerga números já calculados (nunca o extrato bruto), então é crítico
  // que "receitas"/"despesas" aqui já venham sem esse ruído: senão o
  // diagnóstico e os conselhos partem de um "recebi X" que nunca aconteceu
  // de verdade, ou de uma dívida de cartão contada como gasto do mês.
  const accountKindById = new Map(accounts.map((a) => [a.id, a.kind]));
  const classification = classifyTransactions(transactions, {
    ownerDocuments: OWNER_DOCUMENTS,
    accountKindById,
  });
  const cleanTransactions = transactions.filter((t) => {
    if (t.type === "entrada" && classification.excludeFromIncome.has(t.id)) {
      return false;
    }
    if (
      t.type === "saida" &&
      (classification.excludeFromExpense.has(t.id) ||
        classification.cardPurchase.has(t.id))
    ) {
      return false;
    }
    return true;
  });

  // As DUAS VISÕES que a IA precisa entender (ver
  // src/lib/engine/transfers.ts classifyForViews — "PAGAMENTO DE FATURA,
  // a PONTE"): FLUXO DE CAIXA (`mes_atual.receitas/despesas`, dinheiro
  // líquido real — inclui pagamento de fatura) x CONTROLE DE GASTOS
  // (`mes_atual.gasto_categorizado` + `top_categorias`, quanto/onde foi
  // gasto por categoria — inclui compra no cartão, EXCLUI pagamento de
  // fatura pra não dobrar as compras que já a formaram).
  const viewClassification = classifyForViews(transactions, {
    ownerDocuments: OWNER_DOCUMENTS,
    accountKindById,
  });

  // ─── Motor de regras ───
  const recurrences = detectRecurrences(cleanTransactions, today);
  const fixedDebtMonthly = expectedExpenseRemaining(recurrences, month);
  const incomeRemaining = expectedIncomeRemaining(recurrences, month);

  // FLUXO DE CAIXA (dinheiro líquido real) — Sets de INCLUSÃO de
  // `viewClassification.cashflow` (ver aggregate.cashflowTotals).
  const totals = cashflowTotals(transactions, month, viewClassification.cashflow);
  // CONTROLE DE GASTOS (quanto/onde gastei) — Set de INCLUSÃO de
  // `viewClassification.spending` (ver aggregate.spendingTotal).
  const gastoCategorizado = spendingTotal(transactions, month, viewClassification.spending);
  const projection = projectCashflow(
    cleanTransactions,
    month,
    today,
    budgets,
    incomeRemaining
  );
  const budgetLines = computeBudget(cleanTransactions, month, budgets, categories);
  const flags = detectAnomalies(cleanTransactions, month, categories, recurrences);
  const indicators = computeIndicators({
    txs: cleanTransactions,
    accounts,
    month,
    monthlyIncome: profile.monthlyIncome,
    fixedDebtMonthly,
    fixedCategoryIds,
    discretionaryCategoryIds,
  });
  const critical = criticalIndicator(indicators);

  // ─── Top categorias (com comparação vs média) ───
  // CONTROLE DE GASTOS, não fluxo de caixa: usa `viewClassification.spending`
  // (compra à vista/PIX a terceiro + compra no cartão categorizada; SEM
  // pagamento de fatura) — é a pergunta "onde eu gastei", que o pagamento
  // de fatura (um lançamento só, "operadora do cartão") só atrapalharia.
  const byCat = spendingByCategory(transactions, month, viewClassification.spending);
  const totalGastoCategorizado = gastoCategorizado.total || 1;
  const avgMonths = previousMonths(month, 3);
  const topCategorias = [...byCat.entries()]
    .filter(([id]) => catById.get(id)?.kind !== "receita")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id, gasto]) => {
      const name = catById.get(id)?.name ?? "Sem categoria";
      // média das mesmas categorias
      const avgVals = avgMonths.map(
        (m) => spendingByCategory(transactions, m, viewClassification.spending).get(id) ?? 0
      );
      const avg =
        avgVals.length > 0
          ? avgVals.reduce((a, b) => a + b, 0) / avgVals.length
          : 0;
      return {
        categoria: name,
        gasto: round2(gasto),
        percentual_do_total: round2(gasto / totalGastoCategorizado),
        vs_media: avg > 0 ? round2((gasto - avg) / avg) : null,
      };
    });

  // ─── Metas com avaliação de ritmo ───
  const metas = goals.map((g) => ({
    nome: g.name,
    alvo: g.targetAmount,
    atual: g.currentAmount,
    prazo: g.deadline,
    no_ritmo: isGoalOnTrack(g, today),
  }));

  // ─── Histórico dos últimos 6 meses ───
  const historico = previousMonths(month, 6)
    .reverse()
    .concat(month)
    .map((m) => {
      const t = cashflowTotals(transactions, m, viewClassification.cashflow);
      return {
        mes: m,
        receitas: round2(t.income),
        despesas: round2(t.expense),
        sobra: round2(t.balance),
      };
    });

  return {
    perfil: {
      renda_media: profile.monthlyIncome,
      tipo: profile.employmentType,
      dependentes: profile.dependents,
      escada_prioridades: profile.priorityLadder,
    },
    mes_atual: {
      referencia: monthLabel(month),
      receitas: round2(totals.income),
      despesas: round2(totals.expense),
      sobra: round2(totals.balance),
      gasto_categorizado: round2(gastoCategorizado.total),
      dias_restantes: Math.max(0, daysInMonth(month) - projection.currentDay),
    },
    projecao: {
      fechamento_projetado: round2(projection.projectedMonthEnd),
      sinal: projection.signal,
      disponivel_por_dia:
        projection.dailyAllowance === null
          ? null
          : round2(projection.dailyAllowance),
    },
    indicadores: indicators.map((i) => ({
      indicador: i.label,
      valor: round2(i.value),
      unidade: i.unit,
      status: i.status,
      tendencia: i.trend,
    })),
    degrau_atual: ladderStep(critical, profile.priorityLadder),
    top_categorias: topCategorias,
    flags: flags.map((f) => ({
      tipo: f.kind,
      severidade: f.severity,
      titulo: f.title,
      detalhe: f.detail,
      valor: f.amount !== undefined ? round2(f.amount) : undefined,
    })),
    orcamento: budgetLines.slice(0, 10).map((b) => ({
      categoria: b.categoryName,
      gasto: round2(b.spent),
      teto: b.limit,
      consumido: b.consumed === null ? null : round2(b.consumed),
      status: b.status,
    })),
    recorrencias: recurrences.slice(0, 12).map((r) => ({
      descricao: r.label,
      valor: round2(r.amount),
      tipo: r.type,
      proxima: r.nextExpected,
      atrasada: r.overdue,
    })),
    metas,
    historico,
  };
}

// ─── Modelo de decisão: mapeia o indicador crítico ao degrau ───
function ladderStep(critical: ReturnType<typeof criticalIndicator>, ladder: string[]): string {
  if (!critical) return ladder[ladder.length - 1] ?? "Otimizar e investir";
  const map: Record<string, number> = {
    tendencia_fluxo: 0,
    taxa_poupanca: 0,
    reserva_emergencia: 1,
    comprometimento_renda: 2,
    peso_custos_fixos: 3,
    gasto_discricionario: 3,
  };
  const idx = map[critical.key] ?? ladder.length - 1;
  return ladder[Math.min(idx, ladder.length - 1)] ?? "Otimizar e investir";
}

function isGoalOnTrack(goal: Goal, today: string): boolean {
  if (goal.targetAmount <= 0) return true;
  if (goal.currentAmount >= goal.targetAmount) return true;
  if (!goal.deadline) return true; // sem prazo, não cobra ritmo
  // ritmo linear: fração do tempo decorrido vs fração acumulada
  const start = new Date(goal.deadline);
  void start;
  const progress = goal.currentAmount / goal.targetAmount;
  // heurística simples: se já juntou >0 e o prazo é futuro, considera no ritmo
  return progress > 0 && goal.deadline >= today;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
