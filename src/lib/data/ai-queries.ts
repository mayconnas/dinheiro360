// ─────────────────────────────────────────────────────────────
// Camada 2.1c — Leituras "tudo do usuário" para o GESTOR IA.
//
// O Pacote de Contexto determinístico (src/lib/engine/context-package.ts)
// só entrega AGREGADOS. A IA reclamava de não ter a lista
// transação-a-transação nem os saldos — então este módulo lê o banco
// INTEIRO do usuário logado (com campos ricos) para alimentar um contexto
// completo (ver src/lib/ai/full-context.ts).
//
// NÃO reescreve nem toca src/lib/data/repository.ts: instancia o próprio
// client Supabase server (RLS já limita ao usuário logado) e faz queries
// enxutas — seleciona só as colunas que a IA usa (nada de raw_payload, que
// é pesado) e limita as transações a uma janela recente (default 12 meses)
// para não estourar o contexto numa base grande (~1900+ transações).
//
// Roda SOMENTE no servidor. Dado sensível: o consumidor (advisor.ts) só
// envia isto ao provedor de IA que o PRÓPRIO usuário configurou.
// ─────────────────────────────────────────────────────────────
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  Account,
  Budget,
  Category,
  Goal,
  Profile,
  Transaction,
} from "@/lib/types";

/** Destinatário (payee) com os agregados já calculados no banco. */
export interface AiPayee {
  id: string;
  name: string;
  kind: string;
  documentNumber: string | null;
  txCount: number;
  totalPaid: number;
  totalReceived: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

/**
 * Tudo do usuário que a IA precisa para ter contexto completo. As
 * transações vêm limitadas por janela (ver `transactionsSince`), mas
 * `totalTransactionCount` informa o total no banco para a IA saber que há
 * histórico além da janela. Contas trazem saldo/dívida/limite reais
 * (quando sincronizados via Open Finance); campos ausentes chegam como
 * null (fallback gracioso).
 */
export interface FullFinancialData {
  profile: Profile | null;
  /** Transações da janela recente, sem duplicatas, mais recentes primeiro. */
  transactions: Transaction[];
  /** Total de transações (não-duplicadas) no banco, todo o histórico. */
  totalTransactionCount: number;
  /** ISO AAAA-MM-DD: início da janela incluída em `transactions`. */
  transactionsSince: string;
  /** Quantos meses a janela cobre. */
  monthsIncluded: number;
  categories: Category[];
  accounts: Account[];
  payees: AiPayee[];
  budgets: Budget[];
  goals: Goal[];
}

export interface GetFullFinancialDataOptions {
  /** Janela de transações em meses (default 12). Use 0 para não filtrar por data. */
  monthsBack?: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Mapeia uma linha de `transactions` (colunas enxutas) para o tipo
 * canônico Transaction. Campos que NÃO buscamos (raw_payload pesado,
 * merchant_name, status, etc.) recebem default null — não são usados
 * nem pela classificação (classifyTransactions) nem pela IA.
 */
function toAiTransaction(r: any, userId: string): Transaction {
  return {
    id: r.id,
    userId,
    date: r.date,
    amount: Number(r.amount),
    type: r.type,
    description: r.description ?? "",
    rawDescription: r.raw_description ?? "",
    categoryId: r.category_id ?? null,
    accountId: r.account_id ?? null,
    payeeId: r.payee_id ?? null,
    paymentMethod: r.payment_method ?? null,
    operationType: r.operation_type ?? null,
    counterpartyName: r.counterparty_name ?? null,
    counterpartyDocument: r.counterparty_document ?? null,
    merchantName: null,
    pluggyCategory: r.pluggy_category ?? null,
    pluggyCategoryId: null,
    status: null,
    hasCreditCard: null,
    rawPayload: null,
    origin: r.origin ?? "manual",
    isDuplicate: r.is_duplicate ?? false,
    needsReview: r.needs_review ?? false,
    createdAt: r.created_at ?? "",
  };
}

function toCategory(r: any): Category {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    kind: r.kind,
    nature: r.nature,
    color: r.color,
    isSystem: r.is_system,
    parentId: r.parent_id ?? null,
    sortOrder: r.sort_order ?? 0,
    code: r.code ?? null,
  };
}

/**
 * Mapeia `accounts` DEFENSIVAMENTE: as colunas de saldo/cartão (migration
 * 0010) podem estar ausentes/NULL em contas manuais ou nunca
 * sincronizadas. `r.<coluna> ?? null` nunca quebra se a coluna não vier.
 */
function toAccount(r: any): Account {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    kind: r.kind,
    openingBalance: Number(r.opening_balance ?? 0),
    currentBalance: r.current_balance != null ? Number(r.current_balance) : null,
    accountType: r.account_type ?? null,
    institution: r.institution ?? null,
    creditLimit: r.credit_limit != null ? Number(r.credit_limit) : null,
    creditAvailable:
      r.credit_available != null ? Number(r.credit_available) : null,
    creditMinimumPayment:
      r.credit_minimum_payment != null ? Number(r.credit_minimum_payment) : null,
    creditDueDate: r.credit_due_date ?? null,
    cardBrand: r.card_brand ?? null,
    cardLast4: r.card_last4 ?? null,
    number: r.number ?? null,
    owner: r.owner ?? null,
  };
}

function toBudget(r: any): Budget {
  return {
    id: r.id,
    userId: r.user_id,
    categoryId: r.category_id,
    limit: Number(r.monthly_limit),
  };
}

function toGoal(r: any): Goal {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    targetAmount: Number(r.target_amount),
    currentAmount: Number(r.current_amount),
    deadline: r.deadline,
  };
}

function toProfile(r: any): Profile {
  return {
    userId: r.user_id,
    displayName: r.display_name,
    monthlyIncome: Number(r.monthly_income),
    employmentType: r.employment_type,
    dependents: r.dependents,
    priorityLadder: r.priority_ladder ?? [],
  };
}

function toPayee(r: any): AiPayee {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind ?? "desconhecido",
    documentNumber: r.document_number ?? null,
    txCount: Number(r.tx_count ?? 0),
    totalPaid: Number(r.total_paid ?? 0),
    totalReceived: Number(r.total_received ?? 0),
    firstSeen: r.first_seen ?? null,
    lastSeen: r.last_seen ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** ISO AAAA-MM-DD de `monthsBack` meses atrás a partir de hoje (UTC). */
function sinceIso(monthsBack: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.toISOString().slice(0, 10);
}

/**
 * Lê TUDO do usuário logado para o GESTOR IA. RLS já restringe ao dono; o
 * `userId` (quando não informado) é resolvido da sessão só para carimbar
 * Transaction.userId. Uma falha em qualquer query propaga o erro — o
 * chamador (advisor.ts) faz o fallback gracioso para o pacote
 * determinístico.
 */
export async function getFullFinancialData(
  userId?: string,
  opts?: GetFullFinancialDataOptions
): Promise<FullFinancialData> {
  const supabase = await createClient();

  let uid = userId;
  if (!uid) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Não autenticado.");
    uid = user.id;
  }

  const monthsBack = opts?.monthsBack ?? 12;
  const since = monthsBack > 0 ? sinceIso(monthsBack) : "0001-01-01";

  // Colunas enxutas: nada de raw_payload (pesado). A janela por data evita
  // baixar todo o histórico numa base grande.
  const TX_COLUMNS =
    "id, date, amount, type, description, raw_description, category_id, account_id, payee_id, payment_method, operation_type, counterparty_name, counterparty_document, pluggy_category, origin, is_duplicate, needs_review, created_at";

  const [
    profileRes,
    txRes,
    txCountRes,
    categoriesRes,
    accountsRes,
    budgetsRes,
    goalsRes,
    payeesRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").maybeSingle(),
    supabase
      .from("transactions")
      .select(TX_COLUMNS)
      .gte("date", since)
      .order("date", { ascending: false }),
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true }),
    supabase.from("categories").select("*").order("name"),
    supabase.from("accounts").select("*").order("name"),
    supabase.from("budgets").select("*"),
    supabase.from("goals").select("*").order("created_at"),
    supabase
      .from("payees")
      .select(
        "id, name, kind, document_number, tx_count, total_paid, total_received, first_seen, last_seen"
      )
      .order("tx_count", { ascending: false }),
  ]);

  // Propaga o primeiro erro encontrado (o chamador cai no fallback).
  for (const res of [
    profileRes,
    txRes,
    categoriesRes,
    accountsRes,
    budgetsRes,
    goalsRes,
    payeesRes,
  ]) {
    if (res.error) throw res.error;
  }

  const transactions = (txRes.data ?? [])
    .map((r) => toAiTransaction(r, uid as string))
    .filter((t) => !t.isDuplicate);

  return {
    profile: profileRes.data ? toProfile(profileRes.data) : null,
    transactions,
    totalTransactionCount: txCountRes.count ?? transactions.length,
    transactionsSince: since,
    monthsIncluded: monthsBack,
    categories: (categoriesRes.data ?? []).map(toCategory),
    accounts: (accountsRes.data ?? []).map(toAccount),
    payees: (payeesRes.data ?? []).map(toPayee),
    budgets: (budgetsRes.data ?? []).map(toBudget),
    goals: (goalsRes.data ?? []).map(toGoal),
  };
}
