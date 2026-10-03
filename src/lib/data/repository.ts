// ─────────────────────────────────────────────────────────────
// Camada 2.1 — Repositório (acesso ao banco).
// Mapeia linhas do Supabase ↔ tipos canônicos. Roda no servidor.
// A RLS garante que só vêm dados do usuário logado.
// ─────────────────────────────────────────────────────────────
import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type {
  Account,
  Budget,
  Category,
  CategoryRule,
  Goal,
  Profile,
  Transaction,
} from "@/lib/types";

// ─── Mapeadores (row → domínio) ───
/* eslint-disable @typescript-eslint/no-explicit-any */
function toTransaction(r: any): Transaction {
  return {
    id: r.id,
    userId: r.user_id,
    date: r.date,
    amount: Number(r.amount),
    type: r.type,
    description: r.description,
    rawDescription: r.raw_description ?? "",
    categoryId: r.category_id,
    accountId: r.account_id,
    payeeId: r.payee_id ?? null,
    paymentMethod: r.payment_method ?? null,
    operationType: r.operation_type ?? null,
    counterpartyName: r.counterparty_name ?? null,
    counterpartyDocument: r.counterparty_document ?? null,
    merchantName: r.merchant_name ?? null,
    pluggyCategory: r.pluggy_category ?? null,
    pluggyCategoryId: r.pluggy_category_id ?? null,
    status: r.status ?? null,
    hasCreditCard: r.has_credit_card ?? null,
    rawPayload: r.raw_payload ?? null,
    origin: r.origin,
    isDuplicate: r.is_duplicate,
    needsReview: r.needs_review,
    createdAt: r.created_at,
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

function toAccount(r: any): Account {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    kind: r.kind,
    openingBalance: Number(r.opening_balance),
    currentBalance: r.current_balance != null ? Number(r.current_balance) : null,
    accountType: r.account_type ?? null,
    institution: r.institution ?? null,
    creditLimit: r.credit_limit != null ? Number(r.credit_limit) : null,
    creditAvailable: r.credit_available != null ? Number(r.credit_available) : null,
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

function toRule(r: any): CategoryRule {
  return {
    id: r.id,
    userId: r.user_id,
    pattern: r.pattern,
    categoryId: r.category_id,
    source: r.source,
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
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Leitura ───
/**
 * Lê transações. `sinceDate` (ISO AAAA-MM-DD), quando presente, limita o
 * resultado a `date >= sinceDate` — evita baixar o histórico inteiro em
 * telas que só precisam dos últimos meses (dashboard, orçamento).
 * ATENÇÃO: para o patrimônio líquido (netBalance), que soma TODAS as
 * transações, use getBalanceTotals() em vez de filtrar por data aqui.
 */
export async function getTransactions(sinceDate?: string): Promise<Transaction[]> {
  const supabase = await createClient();
  let query = supabase
    .from("transactions")
    .select("*")
    .order("date", { ascending: false });
  if (sinceDate) query = query.gte("date", sinceDate);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(toTransaction);
}

/**
 * Soma agregada de TODO o histórico (entradas − saídas), ignorando
 * duplicatas. Colunas mínimas (amount/type/is_duplicate), sem mapear a
 * linha inteira: é muito mais leve que getTransactions() e mantém o
 * patrimônio líquido correto mesmo quando as telas limitam por data.
 */
export async function getBalanceTotals(): Promise<{ income: number; expense: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("amount, type, is_duplicate");
  if (error) throw error;
  let income = 0;
  let expense = 0;
  for (const r of data ?? []) {
    if (r.is_duplicate) continue;
    if (r.type === "entrada") income += Number(r.amount);
    else if (r.type === "saida") expense += Number(r.amount);
  }
  return { income, expense };
}

// Deduplicadas por request (React cache): layout e página costumam pedir
// as mesmas categorias/contas no mesmo render — sem cache, isso vira 2
// queries iguais. Categorias e contas mudam raramente.
export const getCategories = cache(async (): Promise<Category[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("name");
  if (error) throw error;
  return (data ?? []).map(toCategory);
});

export const getAccounts = cache(async (): Promise<Account[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("accounts").select("*").order("name");
  if (error) throw error;
  return (data ?? []).map(toAccount);
});

export async function getBudgets(): Promise<Budget[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("budgets").select("*");
  if (error) throw error;
  return (data ?? []).map(toBudget);
}

export async function getGoals(): Promise<Goal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map(toGoal);
}

export async function getRules(): Promise<CategoryRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("category_rules").select("*");
  if (error) throw error;
  return (data ?? []).map(toRule);
}

// Deduplicado por request: layout (bootstrap) e loadDashboard pedem o
// perfil no mesmo render.
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ? toProfile(data) : null;
});

/**
 * Carrega tudo de uma vez — usado para montar o Pacote de Contexto.
 * `sinceDate` limita as transações por data (repassado a getTransactions).
 */
export async function getWorkspace(sinceDate?: string): Promise<{
  profile: Profile | null;
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  budgets: Budget[];
  goals: Goal[];
  rules: CategoryRule[];
}> {
  const [profile, transactions, categories, accounts, budgets, goals, rules] =
    await Promise.all([
      getProfile(),
      getTransactions(sinceDate),
      getCategories(),
      getAccounts(),
      getBudgets(),
      getGoals(),
      getRules(),
    ]);
  return { profile, transactions, categories, accounts, budgets, goals, rules };
}

/** Monta o mapa de memória (descrição limpa → categoryId) do histórico. */
export function buildMemory(transactions: Transaction[]): Map<string, string> {
  const memory = new Map<string, string>();
  // percorre do mais antigo pro mais novo; o mais recente vence
  const sorted = [...transactions].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  for (const t of sorted) {
    if (t.categoryId && !t.needsReview) {
      memory.set(t.description.toLowerCase(), t.categoryId);
    }
  }
  return memory;
}
