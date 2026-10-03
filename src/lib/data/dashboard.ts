// ─────────────────────────────────────────────────────────────
// Orquestra o motor de regras para a UI. Roda no servidor.
// Uma função só que carrega o workspace e devolve tudo que as
// telas precisam para o mês corrente.
// ─────────────────────────────────────────────────────────────
import "server-only";
import {
  getAccounts,
  getBudgets,
  getCategories,
  getGoals,
  getProfile,
  getTransactions,
} from "./repository";
import {
  cashflowTotals,
  previousMonths,
  spendingByCategory,
  spendingTotal,
} from "@/lib/engine/aggregate";
import { computeBudget } from "@/lib/engine/budget";
import { projectCashflow } from "@/lib/engine/projection";
import {
  detectRecurrences,
  expectedIncomeRemaining,
} from "@/lib/engine/recurrences";
import { detectAnomalies, type Flag } from "@/lib/engine/anomalies";
import {
  cardDebt,
  buildManualAdjustments,
  computeIndicators,
  overdraftUsage,
  realCashBalance,
  realNetWorth,
  type Indicator,
} from "@/lib/engine/indicators";
import {
  classifyForViews,
  classifyTransactions,
  OWNER_DOCUMENTS,
  type ClassifyResult,
  type ViewClassification,
} from "@/lib/engine/transfers";
import type { BudgetLine } from "@/lib/engine/budget";
import type { Projection } from "@/lib/engine/projection";
import type { Recurrence } from "@/lib/engine/recurrences";
import type {
  Account,
  Budget,
  Category,
  Goal,
  Profile,
  Transaction,
} from "@/lib/types";

// ─────────────────────────────────────────────────────────────
// Visão 360 (bloco "o que TENHO vs o que DEVO" no topo do Painel) —
// leitura instantânea do saldo REAL das contas (accounts.current_balance/
// account_type/institution/credit_*, migration 0010, preenchidos pelo
// sync — ver src/lib/pluggy/sync.ts), NÃO derivada de transações. O KPI
// "Patrimônio líquido" (netBalance abaixo, via realNetWorth em
// src/lib/engine/indicators.ts) usa a MESMA fonte — caixa (bank) +
// investimentos − dívida de cartão (credit) — só que como um número só;
// este bloco expõe a quebra por instituição/cartão/investimento. Não mexe
// em income/expense nem na classificação de transações do motor.
// ─────────────────────────────────────────────────────────────

/** Uma conta dentro de um agrupamento por instituição (coluna "Contas"). */
export interface PatrimonioAccountRow {
  id: string;
  name: string;
  /** current_balance (Pluggy) quando disponível; senão openingBalance. */
  balance: number;
  /** true quando `balance` veio de openingBalance (conta manual/nunca sincronizada — não há current_balance real ainda). */
  isEstimated: boolean;
}

/** Contas agrupadas por instituição (ex. "Mercado Pago", "Bradesco"). Só entram aqui contas com saldo POSITIVO — negativo é cheque especial, ver `PatrimonioOverdraftAccount`. */
export interface PatrimonioBankGroup {
  institution: string;
  total: number;
  accounts: PatrimonioAccountRow[];
}

/**
 * Uma conta bancária NEGATIVA — cheque especial em uso (coluna/bloco
 * "Cheque especial", separado de "Contas bancárias"). `usado` é o valor
 * em módulo (sempre ≥ 0) da dívida, não o saldo com sinal.
 */
export interface PatrimonioOverdraftAccount {
  id: string;
  name: string;
  institution: string;
  /** valor do cheque especial em uso nesta conta (≥ 0 — quanto se deve). */
  usado: number;
  /** true quando o saldo veio de openingBalance (conta manual/nunca sincronizada), não do Pluggy. */
  isEstimated: boolean;
}

/**
 * Bloco "Cheque especial" do Visão 360: soma de TODAS as contas bank com
 * saldo negativo (o dinheiro entrando nelas paga essa dívida antes de
 * virar saldo disponível — ver PatrimonioResumo/overdraftUsage em
 * src/lib/engine/indicators.ts). `total` é sempre ≥ 0.
 */
export interface PatrimonioOverdraft {
  total: number;
  accounts: PatrimonioOverdraftAccount[];
}

/** Um cartão de crédito (coluna "Cartões"). */
export interface PatrimonioCard {
  id: string;
  name: string;
  institution: string;
  last4: string | null;
  brand: string | null;
  /** dívida atual (current_balance da conta CREDIT — positivo = quanto se deve). */
  balance: number;
  limit: number | null;
  dueDate: string | null;
}

/** Uma conta de investimento (coluna "Investimentos"). */
export interface PatrimonioInvestment {
  id: string;
  name: string;
  institution: string;
  balance: number;
}

export interface PatrimonioSummary {
  /** Soma SÓ das contas bank com saldo POSITIVO — dinheiro de verdade disponível. Negativo (cheque especial) fica em `overdraft`, não aqui. */
  bankTotal: number;
  bankGroups: PatrimonioBankGroup[];
  /** Cheque especial em uso: contas bank com saldo negativo, mostradas como dívida separada do saldo em caixa (ver comentário de PatrimonioOverdraft). */
  overdraft: PatrimonioOverdraft;
  cardDebtTotal: number;
  /**
   * Soma dos limites SÓ dos cartões que trazem creditLimit da Pluggy — se
   * algum cartão não tiver o dado, o total fica subestimado (e
   * cardUtilizationPct, super-estimado). É a melhor informação disponível.
   */
  cardLimitTotal: number;
  /** dívida total / limite total; null quando nenhum cartão tem limite conhecido (evita dividir por zero). */
  cardUtilizationPct: number | null;
  cards: PatrimonioCard[];
  investmentsTotal: number;
  investments: PatrimonioInvestment[];
}

/**
 * Monta o bloco "Visão 360" a partir das contas já carregadas
 * (getAccounts()) — sem query adicional. Fallback: contas manuais ou
 * ainda não ressincronizadas pelo sync novo (accountType/currentBalance
 * null) caem pelo `kind` legado (corrente/poupanca/carteira→bank,
 * cartao→credit, investimento→investment) e usam openingBalance como
 * melhor estimativa disponível (isEstimated=true nas linhas de banco),
 * para a conta não sumir do painel enquanto o próximo sync não roda.
 */
function buildPatrimonio(
  accounts: Account[],
  manualAdj?: Map<string, number>
): PatrimonioSummary {
  const bankGroupsMap = new Map<string, PatrimonioBankGroup>();
  const overdraftAccounts: PatrimonioOverdraftAccount[] = [];
  const cards: PatrimonioCard[] = [];
  const investments: PatrimonioInvestment[] = [];

  for (const a of accounts) {
    const bucket: "bank" | "credit" | "investment" =
      a.accountType ??
      (a.kind === "cartao" ? "credit" : a.kind === "investimento" ? "investment" : "bank");
    const institution = a.institution ?? a.name;
    // Mesma regra de indicators.accountBalance (evita dupla contagem): o
    // saldo do Pluggy já reflete tudo; o ajuste manual só entra quando NÃO
    // há saldo do Pluggy (conta puramente manual/nunca sincronizada).
    const hasPluggyBalance = a.currentBalance != null;
    const adj = hasPluggyBalance ? 0 : (manualAdj?.get(a.id) ?? 0);
    const isEstimated = !hasPluggyBalance;
    const balance = (a.currentBalance ?? a.openingBalance) + adj;

    if (bucket === "credit") {
      cards.push({
        id: a.id,
        name: a.name,
        institution,
        last4: a.cardLast4 ?? null,
        brand: a.cardBrand ?? null,
        balance,
        limit: a.creditLimit ?? null,
        dueDate: a.creditDueDate ?? null,
      });
      continue;
    }

    if (bucket === "investment") {
      investments.push({ id: a.id, name: a.name, institution, balance });
      continue;
    }

    // bucket === "bank" — saldo negativo é cheque especial em uso (uma
    // dívida), não caixa: separa daqui em vez de somar junto com o
    // positivo (ver overdraftUsage em src/lib/engine/indicators.ts).
    if (balance < 0) {
      overdraftAccounts.push({
        id: a.id,
        name: a.name,
        institution,
        usado: -balance,
        isEstimated,
      });
      continue;
    }

    const row: PatrimonioAccountRow = { id: a.id, name: a.name, balance, isEstimated };
    const existing = bankGroupsMap.get(institution);
    if (existing) {
      existing.total += balance;
      existing.accounts.push(row);
    } else {
      bankGroupsMap.set(institution, { institution, total: balance, accounts: [row] });
    }
  }

  const bankGroups = [...bankGroupsMap.values()].sort((x, y) => y.total - x.total);
  const bankTotal = bankGroups.reduce((sum, g) => sum + g.total, 0);

  overdraftAccounts.sort((x, y) => y.usado - x.usado);
  const overdraftTotal = overdraftAccounts.reduce((sum, o) => sum + o.usado, 0);

  cards.sort((x, y) => y.balance - x.balance);
  const cardDebtTotal = cards.reduce((sum, c) => sum + c.balance, 0);
  const cardLimitTotal = cards.reduce((sum, c) => sum + (c.limit ?? 0), 0);
  const cardUtilizationPct = cardLimitTotal > 0 ? cardDebtTotal / cardLimitTotal : null;

  investments.sort((x, y) => y.balance - x.balance);
  const investmentsTotal = investments.reduce((sum, i) => sum + i.balance, 0);

  return {
    bankTotal,
    bankGroups,
    overdraft: { total: overdraftTotal, accounts: overdraftAccounts },
    cardDebtTotal,
    cardLimitTotal,
    cardUtilizationPct,
    cards,
    investmentsTotal,
    investments,
  };
}

/** Uma linha do ranking "Controle de Gastos" por categoria (ver `DashboardData.spending`). */
export interface DashboardSpendingCategory {
  /** id da categoria, ou "sem_categoria" quando a transação não está categorizada. */
  categoryId: string;
  categoryName: string;
  color: string;
  total: number;
}

export interface DashboardData {
  month: string;
  today: string;
  /** Mês corrente real (AAAA-MM) — teto de navegação pro seletor de mês. */
  currentMonth: string;
  /**
   * true quando `month` é um mês anterior ao mês corrente (já fechado).
   * A UI usa essa flag para trocar "projeção de fechamento" por "resultado
   * realizado" — não faz sentido projetar o futuro de um mês que já passou.
   */
  isClosedMonth: boolean;
  profile: Profile | null;
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  budgets: Budget[];
  goals: Goal[];
  totals: { income: number; expense: number; balance: number };
  /**
   * PATRIMÔNIO LÍQUIDO REAL (realNetWorth): caixa + investimentos − dívida
   * de cartão, a partir do saldo que a Pluggy reportou no último sync
   * (accounts.current_balance). Pode ser negativo — e deve mostrar assim
   * quando o usuário deve mais do que tem. NÃO é "sobra do mês" (isso é
   * `totals.balance`/`cashflow.balance`, um FLUXO); é uma FOTO do que
   * sobraria se o usuário zerasse tudo hoje.
   */
  netBalance: number;
  /**
   * Saldo em caixa real (realCashBalance): soma SÓ dos saldos POSITIVOS
   * das contas banco/carteira, sem descontar dívida de cartão. É
   * liquidez — dinheiro de verdade que dá pra sacar/gastar agora. NÃO
   * inclui cheque especial (contas negativas) — isso é `overdraftUsage`
   * abaixo, uma dívida separada.
   */
  cashBalance: number;
  /** Dívida atual dos cartões de crédito (cardDebt): soma do current_balance das contas accountType='credit'. */
  cardDebt: number;
  /**
   * Cheque especial em uso (overdraftUsage): soma, em módulo, dos saldos
   * NEGATIVOS das contas accountType='bank'. É dívida cara, não caixa
   * negativo — o dinheiro que entra nessas contas paga o cheque especial
   * antes de virar saldo disponível. `realNetWorth`/`netBalance` acima já
   * desconta este valor; exposto aqui para a UI mostrá-lo separado do
   * saldo em caixa (ver `patrimonio.overdraft` para o detalhe por conta).
   */
  overdraftUsage: number;
  projection: Projection;
  budgetLines: BudgetLine[];
  flags: Flag[];
  indicators: Indicator[];
  recurrences: Recurrence[];
  history: { month: string; income: number; expense: number; balance: number }[];
  /**
   * ids das transações classificadas como transferência ENTRE CONTAS
   * PRÓPRIAS pela regra do CPF (motivo "entre_contas" em
   * `classification.reasons` — ver src/lib/engine/transfers.ts
   * classifyTransactions). `transactions` continua trazendo TODAS as
   * transações (nada some do extrato) — a UI usa este Set só para marcar
   * visualmente ("Entre contas") e, quando fizer resumos próprios de
   * período, descontar do income/expense do mesmo jeito que o painel já
   * faz. Para os outros motivos (compra no cartão, fatura/estorno do
   * cartão, Pix no crédito), use `classification` abaixo.
   */
  internalTransferIds: Set<string>;
  /**
   * Resultado completo do motor de classificação (ver
   * src/lib/engine/transfers.ts classifyTransactions): quais ids não
   * contam como receita/despesa e por quê (`reasons`), e quais são compra
   * no cartão (`cardPurchase` — dívida, não despesa de fluxo de caixa).
   * `totals`/`history` acima já vêm calculados com esta classificação
   * aplicada; exposto aqui para telas que precisem do detalhe (selos,
   * quebra por categoria da fatura, etc).
   */
  classification: ClassifyResult;
  /**
   * As DUAS VISÕES de despesa que o usuário pediu (ver
   * src/lib/engine/transfers.ts classifyForViews — seção "PAGAMENTO DE
   * FATURA — a PONTE"):
   *
   *  - FLUXO DE CAIXA (`cashflow`): dinheiro líquido real que entrou/saiu
   *    das contas no mês. `cashflow.income`/`cashflow.expense`/
   *    `cashflow.balance` são numericamente IGUAIS a `totals` acima
   *    (mesmo cálculo — `totals` fica só por retrocompat de quem já lê
   *    esse nome; novo código deveria preferir `cashflow`). Despesa
   *    inclui PIX/débito a terceiro E o pagamento da fatura (dinheiro
   *    realmente saiu); NÃO inclui compra no cartão (não moveu dinheiro
   *    na hora) nem transferência entre contas próprias.
   *
   *  - CONTROLE DE GASTOS (`spending`): quanto/onde foi gasto, por
   *    categoria. Inclui compra no cartão (categorizada individualmente)
   *    e compra à vista/PIX a terceiro; EXCLUI o pagamento da fatura (as
   *    compras que a formaram já foram contadas uma a uma — contar a
   *    fatura de novo dobraria o gasto), transferência interna e
   *    receita. `byCategory` vem ordenado do maior gasto pro menor.
   */
  cashflow: { income: number; expense: number; balance: number };
  spending: { total: number; byCategory: DashboardSpendingCategory[] };
  /**
   * Resultado completo das duas visões (ver `classifyForViews` em
   * src/lib/engine/transfers.ts) — os Sets de ids por trás de `cashflow`/
   * `spending` acima, mais `billPayments` (as duas pontas do pagamento de
   * fatura) e `reasons` (motivo por id, para selos como "Pagamento de
   * fatura" na TxRow). `classification` acima continua disponível
   * (retrocompat); prefira `viewClassification` em código novo — ela
   * também expõe o legado em `viewClassification.legacy`.
   */
  viewClassification: ViewClassification;
  /**
   * Bloco "Visão 360" (o que TENHO vs o que DEVO) do topo do Painel — ver
   * comentário acima de PatrimonioSummary. Derivado só de `accounts`
   * (saldo real reportado pela Pluggy), independente de `totals`/
   * `netBalance`/`classification`.
   */
  patrimonio: PatrimonioSummary;
}

function nowRefs(): { today: string; month: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return { today: `${y}-${m}-${day}`, month: `${y}-${m}` };
}

/**
 * Data (ISO AAAA-MM-DD) do primeiro dia do mês que fica `months` meses
 * antes de `anchorMonth` (AAAA-MM). Usada para não baixar histórico antigo
 * inútil — ancorada no mês selecionado (não em "hoje"), senão navegar pro
 * passado no painel ficaria sem transações pra mostrar.
 */
function isoMonthsAgo(anchorMonth: string, months: number): string {
  const [y, m] = anchorMonth.split("-").map(Number);
  // Date com dia 1 evita estourar o mês (ex: dia 31 + subtrair mês).
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - months);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

/**
 * @param month  mês selecionado (AAAA-MM) a exibir no painel. Se omitido,
 *        usa o mês corrente (nowRefs). `today` continua sendo sempre a
 *        data real de hoje — nunca é recalculada a partir de `month`.
 */
export async function loadDashboard(month?: string): Promise<DashboardData> {
  const refs = nowRefs();
  const today = refs.today;
  // Nunca aceita mês futuro (defesa contra ?mes= manipulado na URL — a UI
  // já impede isso no seletor, mas a função pura não deve confiar nisso).
  // Cai pro mês corrente nesse caso.
  const selectedMonth = month && month <= refs.month ? month : refs.month;
  const isClosedMonth = selectedMonth < refs.month;

  // O dashboard só olha para janelas curtas: histórico de 6 meses
  // (previousMonths(selectedMonth, 5) + mês selecionado), média de 3 meses
  // e detecção de recorrências mensais. Baixar 6 meses cobre tudo isso sem
  // trazer o histórico inteiro. A janela é ancorada no mês SELECIONADO (não
  // em hoje), pra navegar pro passado continuar trazendo as transações
  // certas. O patrimônio líquido NÃO depende dessa janela nem de nenhuma
  // transação — vem do saldo real das contas (realNetWorth sobre
  // `accounts`, calculado mais abaixo), por isso não precisa de query à
  // parte para o histórico inteiro.
  const sinceDate = isoMonthsAgo(selectedMonth, 6);

  // getRules foi removido do caminho do dashboard: loadDashboard não usa.
  const [profile, transactions, categories, accounts, budgets, goals] =
    await Promise.all([
      getProfile(),
      getTransactions(sinceDate),
      getCategories(),
      getAccounts(),
      getBudgets(),
      getGoals(),
    ]);
  const ws = { profile, transactions, categories, accounts, budgets, goals };

  // Classifica cada transação segundo as regras de negócio do usuário
  // (CPF do dono, cartão=dívida, casos especiais Pluggy) ANTES de
  // qualquer agregação — ver src/lib/engine/transfers.ts
  // classifyTransactions. accountKindById é só accountId→kind, para achar
  // contas kind="cartao" (compra no cartão = dívida, regra 4).
  const accountKindById = new Map(ws.accounts.map((a) => [a.id, a.kind]));
  const classification = classifyTransactions(ws.transactions, {
    ownerDocuments: OWNER_DOCUMENTS,
    accountKindById,
  });
  // As DUAS VISÕES (FLUXO DE CAIXA x CONTROLE DE GASTOS) — ver
  // src/lib/engine/transfers.ts classifyForViews. Construído em cima do
  // mesmo `classifyTransactions` acima (não reclassifica do zero) + a
  // detecção do pagamento de fatura (a ponte entre as duas visões).
  const viewClassification = classifyForViews(ws.transactions, {
    ownerDocuments: OWNER_DOCUMENTS,
    accountKindById,
  });
  // Lista "limpa" (sem as transações excluídas de receita/despesa) usada
  // só para os cálculos que não sabem lidar com Sets de exclusão
  // (indicadores, projeção, orçamento, anomalias, recorrências).
  // `ws.transactions` (completa) continua indo para a UI — extrato,
  // gráficos de composição e listas recentes — nada some de lá, só ganham
  // a marcação visual via `classification.reasons`.
  const cleanTransactions = ws.transactions.filter((t) => {
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

  const fixedCategoryIds = new Set(
    ws.categories.filter((c) => c.nature === "fixa").map((c) => c.id)
  );
  const discretionaryCategoryIds = new Set(
    ws.categories.filter((c) => c.nature === "discricionaria").map((c) => c.id)
  );

  const recurrences = detectRecurrences(cleanTransactions, today);
  // Num mês fechado não há "receita ainda por cair" — o mês já acabou.
  // Zerar aqui evita que uma recorrência esperada em relação a HOJE (que
  // já é de outro mês) vaze pra projeção de um mês passado.
  const incomeRemaining = isClosedMonth
    ? 0
    : expectedIncomeRemaining(recurrences, selectedMonth);
  const fixedDebtMonthly = recurrences
    .filter(
      (r) =>
        r.type === "saida" &&
        r.nextExpected.slice(0, 7) === selectedMonth &&
        !r.overdue
    )
    .reduce((a, r) => a + r.amount, 0);

  // totals = FLUXO DE CAIXA do mês, pelos Sets de INCLUSÃO de
  // `viewClassification.cashflow` (ver aggregate.cashflowTotals). Nome
  // `totals` mantido por retrocompat (era o único número antes das duas
  // visões existirem); numericamente idêntico ao novo `cashflow` abaixo.
  const totals = cashflowTotals(
    ws.transactions,
    selectedMonth,
    viewClassification.cashflow
  );
  // CONTROLE DE GASTOS do mês: total + por categoria (nome/cor
  // resolvidos aqui pra já entregar pronto pra UI, sem outro Map de
  // lookup em quem consome DashboardData).
  const categoryById = new Map(ws.categories.map((c) => [c.id, c]));
  const spendingTotalThisMonth = spendingTotal(
    ws.transactions,
    selectedMonth,
    viewClassification.spending
  );
  const spendingByCategoryThisMonth = [
    ...spendingByCategory(ws.transactions, selectedMonth, viewClassification.spending),
  ]
    .map(([categoryId, total]) => {
      const cat = categoryId === "sem_categoria" ? undefined : categoryById.get(categoryId);
      return {
        categoryId,
        categoryName: cat?.name ?? "Sem categoria",
        color: cat?.color ?? "#94a3b8",
        total,
      };
    })
    .sort((a, b) => b.total - a.total);
  // Patrimônio líquido REAL: caixa + investimentos − dívida de cartão, a
  // partir do saldo que a própria Pluggy reportou no último sync
  // (Account.currentBalance/accountType) — não soma de transações. Ver
  // src/lib/engine/indicators.ts (realNetWorth/realCashBalance/cardDebt).
  // Ajuste manual por conta: lançamentos `origin='manual'` (que a Pluggy
  // não reporta no saldo) somam/subtraem do saldo exibido — assim contas
  // desconectadas (ex.: Bradesco, cuja conexão morreu no Meu Pluggy) ficam
  // corretas conforme o usuário lança à mão. Ver indicators.buildManualAdjustments.
  const manualAdj = buildManualAdjustments(ws.transactions);
  const cashBalance = realCashBalance(ws.accounts, manualAdj);
  const cardDebtTotal = cardDebt(ws.accounts, manualAdj);
  const overdraftTotal = overdraftUsage(ws.accounts, manualAdj);
  const net = realNetWorth(ws.accounts, manualAdj);
  // projectCashflow recebe sempre o "hoje" real (nunca inventado). Quando
  // `today` cai fora de `selectedMonth` (mês fechado), a própria função já
  // trata isso como "mês inteiro decorrido": currentDay = totalDays e
  // daysRemaining = 0 — ou seja, a "projeção" vira o resultado 100%
  // realizado do mês, sem imaginar dias futuros que já passaram. Por isso
  // não é preciso recalcular projection separadamente para meses fechados;
  // só zeramos expectedIncomeRemaining acima e a UI usa isClosedMonth para
  // trocar o rótulo de "projeção" por "fechado".
  const projection = projectCashflow(
    cleanTransactions,
    selectedMonth,
    today,
    ws.budgets,
    incomeRemaining
  );
  const budgetLines = computeBudget(
    cleanTransactions,
    selectedMonth,
    ws.budgets,
    ws.categories
  );
  const flags = detectAnomalies(
    cleanTransactions,
    selectedMonth,
    ws.categories,
    recurrences
  );
  const indicators = computeIndicators({
    txs: cleanTransactions,
    accounts: ws.accounts,
    month: selectedMonth,
    monthlyIncome: ws.profile?.monthlyIncome ?? 0,
    fixedDebtMonthly,
    fixedCategoryIds,
    discretionaryCategoryIds,
    // Reserva de emergência mede LIQUIDEZ (caixa), não patrimônio líquido
    // com dívida descontada — ver comentário em IndicatorInputs.
    cashBalanceOverride: cashBalance,
  });

  const history = previousMonths(selectedMonth, 5)
    .reverse()
    .concat(selectedMonth)
    .map((m) => {
      const t = cashflowTotals(ws.transactions, m, viewClassification.cashflow);
      return {
        month: m,
        income: t.income,
        expense: t.expense,
        balance: t.balance,
      };
    });

  return {
    month: selectedMonth,
    today,
    currentMonth: refs.month,
    isClosedMonth,
    profile: ws.profile,
    transactions: ws.transactions,
    categories: ws.categories,
    accounts: ws.accounts,
    budgets: ws.budgets,
    goals: ws.goals,
    totals: {
      income: totals.income,
      expense: totals.expense,
      balance: totals.balance,
    },
    netBalance: net,
    cashBalance,
    cardDebt: cardDebtTotal,
    overdraftUsage: overdraftTotal,
    projection,
    budgetLines,
    flags,
    indicators,
    recurrences,
    history,
    internalTransferIds: new Set(
      [...classification.reasons]
        .filter(([, reason]) => reason === "entre_contas")
        .map(([id]) => id)
    ),
    classification,
    cashflow: {
      income: totals.income,
      expense: totals.expense,
      balance: totals.balance,
    },
    spending: {
      total: spendingTotalThisMonth.total,
      byCategory: spendingByCategoryThisMonth,
    },
    viewClassification,
    patrimonio: buildPatrimonio(ws.accounts, manualAdj),
  };
}
