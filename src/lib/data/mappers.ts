// ─────────────────────────────────────────────────────────────
// Camada 2.1 — Mapeadores linha do banco → tipos do domínio.
//
// Fonte única: antes havia cópias de toCategory/toAccount/... em
// repository.ts, ai-queries.ts, pluggy/sync.ts e actions/config.ts.
//
// Aceitam linhas PARCIAIS (`select` com só algumas colunas, como as
// queries enxutas da IA): colunas ausentes viram o default do domínio
// (null / 0 / false), nunca `undefined`. As colunas obrigatórias de cada
// tipo continuam exigidas pelo TypeScript.
//
// Funções puras, sem I/O e sem `server-only` — testáveis isoladamente.
// ─────────────────────────────────────────────────────────────
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import type {
  Account,
  Budget,
  Category,
  CategoryRule,
  Goal,
  Profile,
  Transaction,
} from "@/lib/types";

type TableName = keyof Database["gestor360"]["Tables"];

/** Linha parcial de `T` que ainda traz as colunas `K` (as indispensáveis). */
type RowWith<T extends TableName, K extends keyof Tables<T>> = Partial<Tables<T>> & Pick<Tables<T>, K>;

const num = (v: number | string | null | undefined, fallback = 0): number =>
  v === null || v === undefined ? fallback : Number(v);
const numOrNull = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

export function toTransaction(
  r: RowWith<"transactions", "id" | "date" | "amount" | "type">,
  /** user_id quando a query não o selecionou (as queries da IA já filtram por ele). */
  userId?: string
): Transaction {
  return {
    id: r.id,
    userId: r.user_id ?? userId ?? "",
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
    merchantName: r.merchant_name ?? null,
    pluggyCategory: r.pluggy_category ?? null,
    pluggyCategoryId: r.pluggy_category_id ?? null,
    status: r.status ?? null,
    hasCreditCard: r.has_credit_card ?? null,
    rawPayload: r.raw_payload ?? null,
    origin: r.origin ?? "manual",
    isDuplicate: r.is_duplicate ?? false,
    needsReview: r.needs_review ?? false,
    createdAt: r.created_at ?? "",
  };
}

export function toCategory(r: RowWith<"categories", "id" | "name" | "kind">): Category {
  return {
    id: r.id,
    userId: r.user_id ?? "",
    name: r.name,
    kind: r.kind,
    nature: r.nature ?? (r.kind === "receita" ? "receita" : "variavel"),
    color: r.color ?? "#64748b",
    isSystem: r.is_system ?? false,
    parentId: r.parent_id ?? null,
    sortOrder: r.sort_order ?? 0,
    code: r.code ?? null,
  };
}

/** Defensivo: as colunas de saldo/cartão (migration 0010) ficam NULL em contas manuais ou nunca sincronizadas. */
export function toAccount(r: RowWith<"accounts", "id" | "name" | "kind">): Account {
  return {
    id: r.id,
    userId: r.user_id ?? "",
    name: r.name,
    kind: r.kind,
    openingBalance: num(r.opening_balance),
    currentBalance: numOrNull(r.current_balance),
    accountType: r.account_type ?? null,
    institution: r.institution ?? null,
    creditLimit: numOrNull(r.credit_limit),
    creditAvailable: numOrNull(r.credit_available),
    creditMinimumPayment: numOrNull(r.credit_minimum_payment),
    creditDueDate: r.credit_due_date ?? null,
    cardBrand: r.card_brand ?? null,
    cardLast4: r.card_last4 ?? null,
    number: r.number ?? null,
    owner: r.owner ?? null,
  };
}

export function toBudget(r: RowWith<"budgets", "id" | "category_id" | "monthly_limit">): Budget {
  return {
    id: r.id,
    userId: r.user_id ?? "",
    categoryId: r.category_id,
    limit: Number(r.monthly_limit),
  };
}

export function toGoal(r: RowWith<"goals", "id" | "name" | "target_amount">): Goal {
  return {
    id: r.id,
    userId: r.user_id ?? "",
    name: r.name,
    targetAmount: Number(r.target_amount),
    currentAmount: num(r.current_amount),
    deadline: r.deadline ?? null,
  };
}

export function toRule(r: RowWith<"category_rules", "id" | "pattern" | "category_id">): CategoryRule {
  return {
    id: r.id,
    userId: r.user_id ?? "",
    pattern: r.pattern,
    categoryId: r.category_id,
    source: r.source ?? "manual",
  };
}

export function toProfile(r: RowWith<"profiles", "user_id">): Profile {
  return {
    userId: r.user_id,
    displayName: r.display_name ?? null,
    monthlyIncome: num(r.monthly_income),
    employmentType: r.employment_type ?? "clt",
    dependents: r.dependents ?? 0,
    priorityLadder: r.priority_ladder ?? [],
  };
}

// ─── Domínio → colunas (fronteira de escrita) ───
// Dados externos (payload da Pluggy, CSV) chegam como string livre; o
// banco tem CHECKs com valores fechados. Estes conversores estreitam o
// valor ANTES do insert — valor fora da lista vira null, não erro de banco.

const PAYMENT_METHODS = ["pix", "credito", "debito", "boleto", "transferencia"] as const;
const TX_STATUSES = ["POSTED", "PENDING"] as const;

export function toPaymentMethodColumn(v: string | null | undefined): Tables<"transactions">["payment_method"] {
  return v && (PAYMENT_METHODS as readonly string[]).includes(v)
    ? (v as (typeof PAYMENT_METHODS)[number])
    : null;
}

export function toStatusColumn(v: string | null | undefined): Tables<"transactions">["status"] {
  return v && (TX_STATUSES as readonly string[]).includes(v) ? (v as (typeof TX_STATUSES)[number]) : null;
}

/** Payload de API externa → coluna jsonb (já veio de JSON.parse, então é JSON válido). */
export function toJsonColumn(v: unknown): Json | null {
  return v === undefined || v === null ? null : (v as Json);
}
