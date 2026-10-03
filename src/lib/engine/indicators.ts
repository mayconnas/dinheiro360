// ─────────────────────────────────────────────────────────────
// Camada 3.5 — Indicadores de Saúde Financeira (R16)
// O placar que um gestor de verdade acompanha. Cada um tem faixa
// (bom · atenção · crítico) e tendência. Vira a base do modelo de
// decisão da IA (a "escada de prioridades").
// Puro.
// ─────────────────────────────────────────────────────────────
import type { Account, Transaction } from "@/lib/types";
import {
  filterByMonth,
  mean,
  monthTotals,
  previousMonths,
  realTransactions,
  sumBy,
} from "./aggregate";

export type IndicatorStatus = "bom" | "atencao" | "critico" | "sem_dados";
export type Trend = "subindo" | "estavel" | "caindo" | "sem_dados";

export interface Indicator {
  key: string;
  label: string;
  /** valor numérico bruto (fração, meses ou R$ conforme unit) */
  value: number;
  unit: "percent" | "meses" | "brl" | "ratio";
  status: IndicatorStatus;
  trend: Trend;
  /** explicação curta da faixa, pra UI e pra IA */
  hint: string;
}

/**
 * @deprecated Não é o patrimônio real — soma saldo INICIAL (quase sempre 0
 * em conta sincronizada, já que o sync nunca preenche openingBalance) com
 * entradas/saídas de TODO o histórico de transações, e nunca desconta a
 * dívida do cartão de crédito. Era a causa do bug de mostrar patrimônio
 * positivo com o usuário no vermelho (ver realNetWorth abaixo, que é o que
 * a UI deve usar). Mantida só para não quebrar quem ainda importa; não usada
 * pelo dashboard.
 */
export function netBalance(txs: Transaction[], accounts: Account[]): number {
  const opening = accounts.reduce((a, acc) => a + acc.openingBalance, 0);
  const clean = realTransactions(txs);
  const income = sumBy(clean, "entrada");
  const expense = sumBy(clean, "saida");
  return opening + income - expense;
}

/**
 * @deprecated Mesmo problema de `netBalance` (não desconta dívida de
 * cartão; saldo inicial não é o saldo real). Mantida só por retrocompatibilidade
 * para quem ainda chamar; o dashboard usa `realNetWorth` abaixo.
 */
export function netBalanceFromTotals(
  accounts: Account[],
  totals: { income: number; expense: number }
): number {
  const opening = accounts.reduce((a, acc) => a + acc.openingBalance, 0);
  return opening + totals.income - totals.expense;
}

// ─────────────────────────────────────────────────────────────
// PATRIMÔNIO REAL — a partir do saldo/dívida que a própria Pluggy
// reportou no último sync (Account.currentBalance/accountType,
// migration 0010), não de soma de transações. Mesma regra de bucket
// (accountType ?? deriva de `kind`) e mesmo fallback por conta
// (currentBalance ?? openingBalance quando a conta é manual ou nunca
// sincronizou) que src/lib/data/dashboard.ts:buildPatrimonio usa para
// montar o bloco "Visão 360" — mudou uma, mude a outra.
// ─────────────────────────────────────────────────────────────

/** Bucket real de uma conta: accountType (Pluggy) > derivado de `kind` (legado). */
function accountBucket(a: Account): "bank" | "credit" | "investment" {
  return (
    a.accountType ??
    (a.kind === "cartao" ? "credit" : a.kind === "investimento" ? "investment" : "bank")
  );
}

/**
 * Ajuste manual por conta: soma COM SINAL das transações `origin='manual'`
 * (entrada +, saída −) de cada conta. O saldo que a Pluggy reporta
 * (`currentBalance`) NÃO inclui lançamentos manuais (eles são digitados à
 * mão, não vêm do banco), então para o saldo exibido bater com a realidade
 * de uma conta desconectada/manual, somamos as manuais por cima.
 * Passe o Map<accountId, ajuste> montado em dashboard a partir das tx.
 */
export type ManualBalanceAdjustments = Map<string, number>;

/**
 * Constrói o mapa de ajuste manual (accountId → soma com sinal das tx
 * `origin='manual'`). Transações sem conta (accountId null) são ignoradas
 * — não há saldo pra ajustar.
 */
export function buildManualAdjustments(txs: Transaction[]): ManualBalanceAdjustments {
  const map: ManualBalanceAdjustments = new Map();
  for (const t of txs) {
    if (t.origin !== "manual" || !t.accountId) continue;
    const signed = t.type === "entrada" ? t.amount : -t.amount;
    map.set(t.accountId, (map.get(t.accountId) ?? 0) + signed);
  }
  return map;
}

/**
 * Saldo/dívida real de UMA conta.
 *
 * IMPORTANTE (evita dupla contagem): quando a Pluggy reporta um saldo
 * (`currentBalance`), ELE é a fonte da verdade — é o saldo real do banco,
 * que já reflete TODAS as movimentações que o banco processou, mesmo as
 * que por acaso faltaram na nossa lista de transações. Então NÃO somamos o
 * ajuste manual por cima: uma transação manual que preenche um buraco da
 * lista já está embutida nesse saldo; somá-la de novo contaria duas vezes.
 *
 * O ajuste manual (`adj`) só entra quando a conta NÃO tem saldo do Pluggy
 * (conta puramente manual ou que nunca sincronizou) — aí o saldo é
 * openingBalance + as manuais. Para uma conta desconectada com saldo
 * defasado, o caminho certo é reconectar no Pluggy (ou editar o saldo),
 * não empilhar manuais sobre um saldo que já as contém.
 */
function accountBalance(a: Account, adj?: ManualBalanceAdjustments): number {
  if (a.currentBalance != null) return a.currentBalance;
  return a.openingBalance + (adj?.get(a.id) ?? 0);
}

/**
 * Saldo em caixa: soma SÓ dos saldos POSITIVOS das contas correntes/
 * poupança/carteira (accountType='bank'). É LIQUIDEZ — dinheiro de
 * verdade que o usuário tem disponível agora, sem descontar dívida de
 * cartão.
 *
 * IMPORTANTE: uma conta bank com saldo NEGATIVO não é "caixa negativo" —
 * é cheque especial em uso (uma dívida cara, ver `overdraftUsage`
 * abaixo). Somar esse negativo aqui escondia a dívida dentro do saldo em
 * caixa (ex.: Mercado Pago +185,04 e Bradesco −27,15 viravam "caixa
 * 157,89", como se o usuário tivesse 157,89 disponíveis — na real ele tem
 * 185,04 e deve 27,15 de cheque especial). Por isso filtramos > 0: contas
 * negativas ficam de fora daqui e entram em `overdraftUsage`.
 */
export function realCashBalance(accounts: Account[], adj?: ManualBalanceAdjustments): number {
  return accounts
    .filter((a) => accountBucket(a) === "bank")
    .reduce((sum, a) => sum + Math.max(accountBalance(a, adj), 0), 0);
}

/**
 * Cheque especial em uso: soma, em módulo, dos saldos NEGATIVOS das
 * contas bank (accountType='bank'). Quando uma conta corrente fica
 * negativa, o banco está cobrindo o buraco com cheque especial — uma
 * dívida cara, não "caixa menor". Esta função devolve quanto dessa
 * dívida está em uso agora (valor sempre ≥ 0).
 *
 * Não temos (ainda) o LIMITE do cheque especial — a coluna não existe no
 * schema e a conexão Pluggy do Bradesco está morta — então só expomos o
 * usado, não um "% do limite" como fazemos para cartão de crédito
 * (`PatrimonioCartoes`/`cardUtilizationPct`).
 */
export function overdraftUsage(accounts: Account[], adj?: ManualBalanceAdjustments): number {
  return accounts
    .filter((a) => accountBucket(a) === "bank")
    .reduce((sum, a) => sum + Math.max(-accountBalance(a, adj), 0), 0);
}

/** Soma dos saldos de investimento (accountType='investment'). */
export function investmentBalance(accounts: Account[], adj?: ManualBalanceAdjustments): number {
  return accounts
    .filter((a) => accountBucket(a) === "investment")
    .reduce((sum, a) => sum + accountBalance(a, adj), 0);
}

/** Dívida atual dos cartões de crédito (soma de currentBalance das contas accountType='credit'). */
export function cardDebt(accounts: Account[], adj?: ManualBalanceAdjustments): number {
  return accounts
    .filter((a) => accountBucket(a) === "credit")
    .reduce((sum, a) => sum + accountBalance(a, adj), 0);
}

/**
 * PATRIMÔNIO LÍQUIDO REAL — o número que o KPI "Patrimônio líquido" deve
 * mostrar: caixa (só saldos bank positivos) + investimentos − dívida de
 * cartão − cheque especial em uso. Pode (e deve) dar negativo quando o
 * usuário deve mais do que tem — não trave em 0.
 *
 * Antes de `realCashBalance` passar a filtrar só os positivos, o saldo
 * negativo de uma conta em cheque especial já entrava (com sinal) na soma
 * de `realCashBalance`, então este total batia sozinho. Agora que
 * `realCashBalance` só soma o dinheiro de verdade, subtraímos
 * `overdraftUsage` aqui por fora — o resultado final é idêntico (é a
 * mesma dívida, só que agora nomeada/mostrada separado em vez de
 * escondida dentro do caixa). Substitui netBalance/netBalanceFromTotals
 * no dashboard.
 *
 * Exemplo real (2026-07): Mercado Pago +185,04, Bradesco +6,84, Bradesco
 * −27,15 (cheque especial), cartões −2.382,48 →
 * realCashBalance = 191,88; overdraftUsage = 27,15 →
 * realNetWorth = 191,88 + 0 − 2.382,48 − 27,15 = −2.217,75 (igual ao
 * valor de antes da mudança — só a apresentação mudou).
 */
export function realNetWorth(accounts: Account[], adj?: ManualBalanceAdjustments): number {
  return (
    realCashBalance(accounts, adj) +
    investmentBalance(accounts, adj) -
    cardDebt(accounts, adj) -
    overdraftUsage(accounts, adj)
  );
}

/** Despesa mensal média nos últimos `n` meses (default 3). */
function avgMonthlyExpense(txs: Transaction[], month: string, n = 3): number {
  const months = previousMonths(month, n).concat(month);
  const values = months.map((m) => monthTotals(txs, m).expense);
  const nonZero = values.filter((v) => v > 0);
  return nonZero.length ? mean(nonZero) : 0;
}

function rangeStatus(
  value: number,
  good: number,
  warn: number,
  higherIsBetter: boolean
): IndicatorStatus {
  if (higherIsBetter) {
    if (value >= good) return "bom";
    if (value >= warn) return "atencao";
    return "critico";
  } else {
    if (value <= good) return "bom";
    if (value <= warn) return "atencao";
    return "critico";
  }
}

/** Tendência a partir de uma série temporal (mais antigo → mais novo). */
export function trendFromSeries(series: number[]): Trend {
  const valid = series.filter((n) => Number.isFinite(n));
  if (valid.length < 2) return "sem_dados";
  const first = valid[0];
  const last = valid[valid.length - 1];
  if (first === 0 && last === 0) return "estavel";
  const delta = last - first;
  const base = Math.abs(first) || 1;
  const rel = delta / base;
  if (rel > 0.05) return "subindo";
  if (rel < -0.05) return "caindo";
  return "estavel";
}

export interface IndicatorInputs {
  txs: Transaction[];
  accounts: Account[];
  month: string;
  monthlyIncome: number;
  /** soma das parcelas/dívidas fixas mensais (do detector de recorrências) */
  fixedDebtMonthly?: number;
  /** ids de categorias marcadas como despesa fixa */
  fixedCategoryIds?: Set<string>;
  /** ids de categorias discricionárias (lazer, comida fora, assinaturas) */
  discretionaryCategoryIds?: Set<string>;
  /**
   * Saldo em CAIXA real (realCashBalance sobre Account.currentBalance) para
   * o indicador "Reserva de emergência". Reserva de emergência mede
   * LIQUIDEZ — quantos meses de despesa o dinheiro disponível cobre — não
   * patrimônio líquido: um patrimônio líquido negativo (dívida de cartão
   * maior que o caixa) não deveria zerar/negativar a reserva, que é sobre
   * o caixa. Preferível a `netBalanceOverride`. Sem nenhum dos dois, cai
   * para `netBalance(txs, accounts)` (comportamento antigo, baseado em
   * transações).
   */
  cashBalanceOverride?: number;
  /**
   * @deprecated usar `cashBalanceOverride`. Mantido só como fallback para
   * quem ainda não migrou — reserva de emergência deveria olhar caixa
   * (liquidez), não patrimônio líquido (que desconta dívida de cartão).
   */
  netBalanceOverride?: number;
}

/** Taxa de poupança de um mês = (receitas − despesas) / receitas. */
function savingsRate(txs: Transaction[], month: string, fallbackIncome: number): number {
  const t = monthTotals(txs, month);
  const income = t.income > 0 ? t.income : fallbackIncome;
  if (income <= 0) return 0;
  return (income - t.expense) / income;
}

export function computeIndicators(input: IndicatorInputs): Indicator[] {
  const {
    txs,
    accounts,
    month,
    monthlyIncome,
    fixedDebtMonthly = 0,
    fixedCategoryIds,
    discretionaryCategoryIds,
    cashBalanceOverride,
    netBalanceOverride,
  } = input;

  const current = monthTotals(txs, month);
  const income = current.income > 0 ? current.income : monthlyIncome;
  // Reserva de emergência = liquidez, não patrimônio líquido — ver comentário
  // de `cashBalanceOverride` acima.
  const cashForReserve =
    cashBalanceOverride ?? netBalanceOverride ?? netBalance(txs, accounts);
  const avgExpense = avgMonthlyExpense(txs, month);

  const last3 = previousMonths(month, 3).concat(month); // antigo → novo (após reverse)
  const monthsAsc = [...last3].reverse();

  const indicators: Indicator[] = [];

  // 1. Taxa de poupança — bom ≥20%, atenção 10–20%, crítico <10%
  const savings = savingsRate(txs, month, monthlyIncome);
  indicators.push({
    key: "taxa_poupanca",
    label: "Taxa de poupança",
    value: savings,
    unit: "percent",
    status: rangeStatus(savings, 0.2, 0.1, true),
    trend: trendFromSeries(
      monthsAsc.map((m) => savingsRate(txs, m, monthlyIncome))
    ),
    hint: "Bom ≥20% · atenção 10–20% · crítico <10%. É o que constrói os 100k.",
  });

  // 2. Reserva de emergência — saldo em CAIXA ÷ despesa média (meses).
  // Deliberadamente usa liquidez (cashForReserve), não patrimônio líquido:
  // dívida de cartão não deveria fazer a reserva "sumir" — ela mede quanto
  // dinheiro disponível cobre quantos meses de despesa.
  const reserve = avgExpense > 0 ? cashForReserve / avgExpense : 0;
  indicators.push({
    key: "reserva_emergencia",
    label: "Reserva de emergência",
    value: reserve,
    unit: "meses",
    status:
      avgExpense === 0 ? "sem_dados" : rangeStatus(reserve, 6, 3, true),
    trend: "sem_dados",
    hint: "Bom ≥6 meses · atenção 3–6 · crítico <3. Mede caixa disponível, não patrimônio líquido.",
  });

  // 3. Comprometimento de renda — (parcelas + dívidas fixas) ÷ receita
  const commitment = income > 0 ? fixedDebtMonthly / income : 0;
  indicators.push({
    key: "comprometimento_renda",
    label: "Comprometimento de renda",
    value: commitment,
    unit: "percent",
    status:
      fixedDebtMonthly === 0
        ? "bom"
        : rangeStatus(commitment, 0.3, 0.5, false),
    trend: "sem_dados",
    hint: "Bom <30% · atenção 30–50% · crítico >50%.",
  });

  // 4. Peso dos custos fixos — despesas fixas ÷ receita
  const fixedExpense = fixedCategoryIds
    ? filterByMonth(txs, month)
        .filter((t) => t.type === "saida" && t.categoryId && fixedCategoryIds.has(t.categoryId))
        .reduce((a, t) => a + t.amount, 0)
    : 0;
  const fixedWeight = income > 0 ? fixedExpense / income : 0;
  indicators.push({
    key: "peso_custos_fixos",
    label: "Peso dos custos fixos",
    value: fixedWeight,
    unit: "percent",
    status: fixedCategoryIds ? rangeStatus(fixedWeight, 0.5, 0.65, false) : "sem_dados",
    trend: "sem_dados",
    hint: "Quanto menor, mais folga pra reagir (referência: <50%).",
  });

  // 5. Gasto discricionário — (lazer + comida fora + assinaturas) ÷ receita
  const discretionary = discretionaryCategoryIds
    ? filterByMonth(txs, month)
        .filter(
          (t) =>
            t.type === "saida" &&
            t.categoryId &&
            discretionaryCategoryIds.has(t.categoryId)
        )
        .reduce((a, t) => a + t.amount, 0)
    : 0;
  const discRatio = income > 0 ? discretionary / income : 0;
  indicators.push({
    key: "gasto_discricionario",
    label: "Gasto discricionário",
    value: discRatio,
    unit: "percent",
    status: discretionaryCategoryIds
      ? rangeStatus(discRatio, 0.2, 0.35, false)
      : "sem_dados",
    trend: "sem_dados",
    hint: "É o que dá pra cortar rápido quando aperta.",
  });

  // 6. Tendência de fluxo — direção da sobra nos últimos 3 meses
  const balanceSeries = monthsAsc.map((m) => monthTotals(txs, m).balance);
  indicators.push({
    key: "tendencia_fluxo",
    label: "Tendência de fluxo",
    value: balanceSeries[balanceSeries.length - 1] ?? 0,
    unit: "brl",
    status: "sem_dados",
    trend: trendFromSeries(balanceSeries),
    hint: "Direção da sobra mês a mês.",
  });

  return indicators;
}

/** Índice do degrau da escada de prioridades (o indicador mais crítico manda). */
export function criticalIndicator(indicators: Indicator[]): Indicator | null {
  const order = ["critico", "atencao", "bom", "sem_dados"] as const;
  for (const status of order) {
    const found = indicators.find((i) => i.status === status);
    if (status === "critico" || status === "atencao") return found ?? null;
  }
  return null;
}
