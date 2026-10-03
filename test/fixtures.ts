// ─────────────────────────────────────────────────────────────
// Fábricas tipadas de fixtures para os testes do motor de regras.
// Cada builder devolve um objeto COMPLETO do tipo real de
// src/lib/types.ts, com defaults neutros; o teste só sobrescreve o
// que importa para o cenário — deixa explícito o que está sendo testado.
// ─────────────────────────────────────────────────────────────
import type {
  Account,
  Budget,
  Category,
  CategoryRule,
  Goal,
  Profile,
  Transaction,
} from "@/lib/types";

export const USER_ID = "user-1";

/** CPF fictício (só dígitos) usado como "dono das contas" nos testes. */
export const FAKE_OWNER_CPF = "12345678909";

let seq = 0;
/** Id único e legível para fixtures (ex "tx-7"). */
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function makeCategory(overrides: Partial<Category> = {}): Category {
  const id = overrides.id ?? nextId("cat");
  return {
    id,
    userId: USER_ID,
    name: overrides.name ?? id,
    kind: "despesa",
    nature: "variavel",
    color: "#64748b",
    isSystem: false,
    parentId: null,
    sortOrder: 0,
    code: null,
    ...overrides,
  };
}

export function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const description = overrides.description ?? "Lançamento";
  return {
    id: overrides.id ?? nextId("tx"),
    userId: USER_ID,
    date: "2026-07-10",
    amount: 100,
    type: "saida",
    description,
    rawDescription: overrides.rawDescription ?? description.toUpperCase(),
    categoryId: null,
    accountId: null,
    payeeId: null,
    paymentMethod: null,
    operationType: null,
    counterpartyName: null,
    counterpartyDocument: null,
    merchantName: null,
    pluggyCategory: null,
    pluggyCategoryId: null,
    status: null,
    hasCreditCard: null,
    rawPayload: null,
    origin: "open_finance",
    isDuplicate: false,
    needsReview: false,
    createdAt: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? nextId("acc"),
    userId: USER_ID,
    name: "Conta corrente",
    kind: "corrente",
    openingBalance: 0,
    currentBalance: null,
    accountType: null,
    institution: null,
    ...overrides,
  };
}

export function makeRule(overrides: Partial<CategoryRule> & Pick<CategoryRule, "pattern" | "categoryId">): CategoryRule {
  return {
    id: overrides.id ?? nextId("rule"),
    userId: USER_ID,
    source: "manual",
    ...overrides,
  };
}

export function makeBudget(overrides: Partial<Budget> & Pick<Budget, "categoryId" | "limit">): Budget {
  return {
    id: overrides.id ?? nextId("budget"),
    userId: USER_ID,
    ...overrides,
  };
}

export function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: overrides.id ?? nextId("goal"),
    userId: USER_ID,
    name: "Reserva de emergência",
    targetAmount: 10_000,
    currentAmount: 0,
    deadline: null,
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    userId: USER_ID,
    displayName: "Maria Souza",
    monthlyIncome: 5_000,
    employmentType: "clt",
    dependents: 0,
    priorityLadder: [
      "Parar de sangrar",
      "Montar a reserva",
      "Quitar dívidas caras",
      "Enxugar custos",
      "Otimizar e investir",
    ],
    ...overrides,
  };
}

/**
 * Plano de categorias padrão (o seed do bootstrap_user), com ids
 * estáveis para os testes referenciarem diretamente.
 */
export function defaultCategories(): Record<string, Category> {
  const d = (id: string, name: string, nature: Category["nature"] = "variavel") =>
    makeCategory({ id, name, kind: "despesa", nature });
  const r = (id: string, name: string) =>
    makeCategory({ id, name, kind: "receita", nature: "receita" });
  return {
    comidaFora: d("cat-comida-fora", "Comida fora", "discricionaria"),
    transporte: d("cat-transporte", "Transporte"),
    mercado: d("cat-mercado", "Mercado"),
    saude: d("cat-saude", "Saúde"),
    moradia: d("cat-moradia", "Moradia", "fixa"),
    contasFixas: d("cat-contas-fixas", "Contas fixas", "fixa"),
    assinaturas: d("cat-assinaturas", "Assinaturas", "discricionaria"),
    lazer: d("cat-lazer", "Lazer", "discricionaria"),
    revisarDespesa: d("cat-revisar-despesa", "A revisar"),
    salario: r("cat-salario", "Salário"),
    outrasReceitas: r("cat-outras-receitas", "Outras receitas"),
    revisarReceita: r("cat-revisar-receita", "A revisar"),
  };
}
