// ─────────────────────────────────────────────────────────────
// Camada 2.1 — Repositório (acesso ao banco).
// Mapeia linhas do Supabase ↔ tipos canônicos. Roda no servidor.
// A RLS garante que só vêm dados do usuário logado.
// ─────────────────────────────────────────────────────────────
import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";
import {
  toAccount,
  toBudget,
  toCategory,
  toGoal,
  toProfile,
  toRule,
  toTransaction,
} from "./mappers";
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

// ─── Leitura ───

/**
 * Colunas que as telas usam — tudo menos `raw_payload`, o JSON bruto da
 * Pluggy (alguns KB por linha, nenhuma tela o lê). Em 2.000+ lançamentos
 * isso é a maior parte do payload que ia do banco para o servidor e do
 * servidor para o navegador a cada revalidação da tela de Transações.
 * Quem precisa do payload (Jev, reprocessamento) seleciona por conta própria.
 */
const TRANSACTION_LIST_COLUMNS =
  "id,user_id,date,amount,type,description,raw_description,category_id,account_id,payee_id,payment_method,operation_type,counterparty_name,counterparty_document,merchant_name,pluggy_category,pluggy_category_id,status,has_credit_card,origin,is_duplicate,needs_review,external_id,created_at";
const TX_PAGE_SIZE = 1000;
/**
 * Lê transações. `sinceDate` (ISO AAAA-MM-DD), quando presente, limita o
 * resultado a `date >= sinceDate` — evita baixar o histórico inteiro em
 * telas que só precisam dos últimos meses (dashboard, orçamento).
 * ATENÇÃO: para o patrimônio líquido (netBalance), que soma TODAS as
 * transações, use getBalanceTotals() em vez de filtrar por data aqui.
 */
export const getTransactions = cache(async (sinceDate?: string): Promise<Transaction[]> => {
  const supabase = await createClient();
  const rows: Tables<"transactions">[] = [];
  // Paginado: o PostgREST corta respostas acima de `max-rows` (1000 por
  // padrão) SEM erro — sem o loop, o histórico some em silêncio quando
  // passa desse tamanho. Ordem estável (date, id) para as páginas não
  // repetirem nem pularem linhas.
  for (let from = 0; ; from += TX_PAGE_SIZE) {
    let query = supabase
      .from("transactions")
      .select(TRANSACTION_LIST_COLUMNS)
      .order("date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + TX_PAGE_SIZE - 1);
    if (sinceDate) query = query.gte("date", sinceDate);
    const { data, error } = await query;
    if (error) throw error;
    // as colunas omitidas (raw_payload) viram null no mapper
    rows.push(...((data ?? []) as Tables<"transactions">[]));
    if (!data || data.length < TX_PAGE_SIZE) break;
  }
  return rows.map((r) => toTransaction(r));
});

/**
 * Soma agregada de TODO o histórico (entradas − saídas), ignorando
 * duplicatas. Colunas mínimas (amount/type/is_duplicate), sem mapear a
 * linha inteira: é muito mais leve que getTransactions() e mantém o
 * patrimônio líquido correto mesmo quando as telas limitam por data.
 */
export async function getBalanceTotals(): Promise<{ income: number; expense: number }> {
  const supabase = await createClient();
  let income = 0;
  let expense = 0;
  // Paginado pelo mesmo motivo de getTransactions: sem o loop, um
  // histórico acima de max-rows somaria só a primeira página e o
  // patrimônio líquido sairia errado sem nenhum erro visível.
  for (let from = 0; ; from += TX_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("amount, type, is_duplicate")
      .order("id", { ascending: true })
      .range(from, from + TX_PAGE_SIZE - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      if (r.is_duplicate) continue;
      if (r.type === "entrada") income += Number(r.amount);
      else if (r.type === "saida") expense += Number(r.amount);
    }
    if (!data || data.length < TX_PAGE_SIZE) break;
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
