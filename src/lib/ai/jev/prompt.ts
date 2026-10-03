// ─────────────────────────────────────────────────────────────
// Camada 4 — TypeSafe Jev: montagem das perguntas (funções puras).
//
// Decisões de desenho, seguindo a doc da TypeSafe:
//  • UMA requisição por lançamento, com `state` contendo só aquele
//    lançamento. O Jev perde precisão quando o state traz detalhe
//    irrelevante ("large state full of irrelevant detail"), então não
//    empacotamos vários lançamentos num state só.
//  • Uma pergunta Choice cujas opções são as categorias FOLHA do mesmo
//    kind (receita p/ entrada, despesa p/ saída), com o caminho
//    completo como nome ("Moradia > Aluguel"). Cada opção leva uma
//    descrição estruturada: o que cobre (para as categorias padrão), o
//    que NÃO cobre quando há uma opção irmã mais específica (not_for) e
//    exemplos do histórico do usuário — é o que separa uma opção da
//    outra ("write descriptions that separate the options").
//  • Uma opção explícita "nenhuma se encaixa", para o modelo poder
//    dizer que não sabe em vez de forçar uma escolha.
//  • Instruções em inglês (idioma principal de treino do Jev); os dados
//    continuam em português, como vêm do banco.
//
// Sem I/O: tudo aqui é determinístico e testável.
// ─────────────────────────────────────────────────────────────
import type { Account, Category, CategoryKind, Transaction } from "@/lib/types";
import {
  buildAccountTree,
  flattenTree,
  getAncestors,
  isLeaf,
} from "@/lib/engine/account-tree";
import { resolvePaymentMethod, type PaymentMethod } from "@/lib/engine/payment-method";
import type { ChoiceAnswer, ChoiceQuestion, TypeSafeJson } from "./client";
import {
  JEV_EXAMPLES_PER_CATEGORY,
  JEV_MAX_CHOICE_OPTIONS,
  tierFor,
  type JevDecision,
} from "./config";

/** Nome da opção "nenhuma categoria se encaixa" (é o que o modelo lê). */
export const NONE_OPTION = "None of these categories";

/** Id da pergunta no request (não é enviado ao modelo). */
export const CATEGORY_QUESTION_ID = "category";

/** "A revisar" é sentinela de "sem categoria", nunca uma resposta válida. */
export function isReviewSentinel(c: Pick<Category, "name">): boolean {
  return c.name.trim().toLowerCase() === "a revisar";
}

/** minúsculas, sem acento, espaços colapsados — para comparar/deduplicar textos. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Opções (categorias) ───

/**
 * O que cada categoria PADRÃO cobre, por nome normalizado. Só entra
 * quando o nome da categoria do usuário bate exatamente — categorias
 * personalizadas dependem do nome + exemplos do histórico.
 */
const CATEGORY_HINTS: Record<string, string> = {
  // receitas
  salario: "Salary, payroll, wages, pro-labore, 13th salary and vacation pay received from an employer",
  "outras receitas": "Miscellaneous income: Pix or transfers received from people, occasional one-off income",
  rendimentos: "Investment income: interest, dividends, yields (rendimentos) from savings or investments",
  investimentos: "Investments: money moved into or out of investments, savings, CDB, funds, stocks",
  reembolso: "Refunds and reimbursements of previous expenses",
  reembolsos: "Refunds and reimbursements of previous expenses",
  freelance: "Payments for freelance or independent work",
  vendas: "Money received from selling products or services",
  // despesas padrão (seed do bootstrap_user)
  moradia: "Housing: rent, condominium fee, home maintenance and repairs",
  "contas fixas": "Recurring household bills: electricity, water, gas, landline, mobile phone plan, internet, pay TV",
  mercado: "Groceries and household supplies: supermarkets, grocery stores, bakeries (padaria), butchers, produce markets, wholesale clubs",
  transporte: "Transportation: fuel and gas stations, Uber/99/taxi, public transit, parking, tolls, car maintenance",
  saude: "Health: pharmacies and drugstores, doctors, dentists, labs and exams, hospitals, health insurance",
  "comida fora": "Eating out: restaurants, bars, snack bars (lanchonete), fast food, coffee shops, ice cream shops, food delivery apps like iFood",
  lazer: "Leisure and entertainment: movies, shows, events, outings, games, hobbies, travel",
  assinaturas: "Subscriptions and digital services: streaming (Netflix, Spotify, Disney+, Prime), apps, software, cloud storage, memberships",
  // despesas comuns em planos personalizados
  alimentacao: "Food in general: groceries, restaurants and food delivery",
  restaurante: "Eating out at restaurants, bars and food delivery",
  restaurantes: "Eating out at restaurants, bars and food delivery",
  supermercado: "Groceries and household supplies at supermarkets and grocery stores",
  educacao: "Education: school, college tuition, courses, books, school supplies",
  vestuario: "Clothing, shoes and accessories",
  roupas: "Clothing, shoes and accessories",
  compras: "General shopping: stores, marketplaces, e-commerce, electronics, home goods",
  pets: "Pets: pet shops, veterinarians, pet food",
  impostos: "Taxes and government fees: IPVA, IPTU, income tax (IR), fines, DARF, licensing",
  "tarifas bancarias": "Bank fees: account maintenance fees, transfer fees, card annual fee, IOF",
  tarifas: "Bank fees: account maintenance fees, transfer fees, card annual fee, IOF",
  "juros e encargos": "Interest, late fees and finance charges on loans, overdraft or credit card",
  emprestimos: "Loan and financing installments",
  seguros: "Insurance premiums: car, home, life insurance",
  viagem: "Travel: flights, hotels, lodging, car rental, travel expenses",
  viagens: "Travel: flights, hotels, lodging, car rental, travel expenses",
  "cuidados pessoais": "Personal care: hair salon, barber, beauty, cosmetics, spa",
  beleza: "Personal care: hair salon, barber, beauty, cosmetics",
  academia: "Gym, fitness and sports memberships",
  presentes: "Gifts for other people",
  doacoes: "Donations, charity and tithes",
  casa: "Home: furniture, appliances, decoration, cleaning and maintenance",
  combustivel: "Fuel at gas stations",
  farmacia: "Pharmacies and drugstores",
  aluguel: "Rent payments",
  condominio: "Condominium fees",
  energia: "Electricity bill",
  luz: "Electricity bill",
  agua: "Water bill",
  internet: "Internet service bill",
  celular: "Mobile phone plan",
  telefone: "Phone bill",
  streaming: "Streaming services: Netflix, Spotify, Disney+, Prime Video, etc.",
  "cartao de credito": "Credit card bill payments",
};

/**
 * Opções amplas × opções específicas que disputam os mesmos lançamentos.
 * Quando a específica também está entre as opções, a ampla ganha um
 * `not_for` apontando para ela — o Jev lê os critérios ao pé da letra, e
 * duas opções reivindicando a mesma coisa dividem a probabilidade.
 */
const MORE_SPECIFIC: Record<string, string[]> = {
  "outras receitas": ["rendimentos", "investimentos", "reembolso", "reembolsos", "freelance", "vendas"],
  moradia: ["aluguel", "condominio", "casa"],
  "contas fixas": ["energia", "luz", "agua", "internet", "celular", "telefone"],
  transporte: ["combustivel"],
  saude: ["farmacia", "academia"],
  lazer: ["viagem", "viagens", "streaming"],
  assinaturas: ["streaming"],
  alimentacao: ["mercado", "supermercado", "restaurante", "restaurantes", "comida fora"],
  compras: ["vestuario", "roupas", "casa", "pets"],
};

const NATURE_LABELS: Partial<Record<Category["nature"], string>> = {
  fixa: "fixed recurring expense",
  variavel: "variable everyday expense",
  discricionaria: "discretionary (optional) expense",
};

export interface CategoryOptionSet {
  kind: CategoryKind;
  /** criteria da pergunta Choice: nome da opção → descrição estruturada (ou null). */
  criteria: Record<string, TypeSafeJson>;
  /** nome da opção → id da categoria (null = opção "nenhuma"). */
  idByKey: Map<string, string | null>;
  /** id da categoria → nome da opção (caminho legível). */
  keyById: Map<string, string>;
  /** Número de categorias válidas (sem contar a opção "nenhuma"). */
  categoryCount: number;
  /** Categorias que ficaram de fora pelo limite de opções da API. */
  dropped: number;
}

/**
 * Monta as opções da pergunta para um kind. Só entram categorias FOLHA
 * do kind (uma categoria-pai com filhos é um agrupamento — oferecer pai
 * e filho juntos só dividiria a probabilidade entre os dois e derrubaria
 * a confiança sem motivo). "A revisar" nunca entra.
 */
export function buildCategoryOptions(
  categories: Category[],
  kind: CategoryKind,
  examplesByCategoryId: Map<string, string[]>
): CategoryOptionSet {
  const sameKind = categories.filter((c) => c.kind === kind && !isReviewSentinel(c));
  const tree = buildAccountTree(sameKind);
  const leaves = flattenTree(tree)
    .filter(isLeaf)
    .map((node) => node.category);

  const pathOf = (c: Category): string => {
    const names = getAncestors(tree, c.id)
      .map((id) => tree.byId.get(id)?.category.name.trim())
      .filter((n): n is string => Boolean(n))
      .reverse();
    return [...names, c.name.trim()].join(" > ");
  };

  // Acima do limite da API, mantém as mais usadas (mais exemplos no histórico).
  const maxCategories = JEV_MAX_CHOICE_OPTIONS - 1; // reserva 1 para NONE_OPTION
  const ranked = [...leaves].sort(
    (a, b) =>
      (examplesByCategoryId.get(b.id)?.length ?? 0) - (examplesByCategoryId.get(a.id)?.length ?? 0)
  );
  const kept = ranked.slice(0, maxCategories);
  const dropped = ranked.length - kept.length;

  const withPath = kept
    .map((c) => ({ c, path: pathOf(c) }))
    .sort((a, b) => a.path.localeCompare(b.path, "pt-BR"));

  const criteria: Record<string, TypeSafeJson> = {};
  const idByKey = new Map<string, string | null>();
  const keyById = new Map<string, string>();

  // nome normalizado da folha → caminhos das opções com esse nome (para o not_for)
  const pathsByName = new Map<string, string[]>();
  for (const { c, path } of withPath) {
    const norm = normalizeText(c.name);
    pathsByName.set(norm, [...(pathsByName.get(norm) ?? []), path]);
  }

  for (const { c, path } of withPath) {
    // nomes podem repetir (sem UNIQUE no banco) — desambigua a chave
    let key = path;
    for (let n = 2; idByKey.has(key) || key === NONE_OPTION; n++) key = `${path} (${n})`;

    const description: { [k: string]: TypeSafeJson } = {};
    const name = normalizeText(c.name);
    const hint = CATEGORY_HINTS[name];
    if (hint) description.covers = hint;
    const specific = (MORE_SPECIFIC[name] ?? []).flatMap((n) => pathsByName.get(n) ?? []);
    if (specific.length > 0) {
      description.not_for = `Transactions that fit a more specific option: ${specific.join(", ")}`;
    }
    const nature = NATURE_LABELS[c.nature];
    if (kind === "despesa" && nature) description.type = nature;
    const examples = examplesByCategoryId.get(c.id) ?? [];
    if (examples.length > 0) description.examples = examples;

    criteria[key] = Object.keys(description).length > 0 ? description : null;
    idByKey.set(key, c.id);
    keyById.set(c.id, key);
  }

  criteria[NONE_OPTION] = {
    covers: "Use only when none of the other categories reasonably fits this transaction.",
  };
  idByKey.set(NONE_OPTION, null);

  return { kind, criteria, idByKey, keyById, categoryCount: withPath.length, dropped };
}

/**
 * Exemplos do histórico por categoria: os nomes mais frequentes
 * (estabelecimento ou descrição) de lançamentos que o usuário já
 * categorizou. `rows` deve vir do mais recente para o mais antigo —
 * em empate de frequência, o mais recente ganha.
 */
export function buildExamplesByCategory(
  rows: { description: string | null; merchantName: string | null; categoryId: string | null }[],
  perCategory: number = JEV_EXAMPLES_PER_CATEGORY
): Map<string, string[]> {
  const stats = new Map<string, Map<string, { label: string; count: number; order: number }>>();
  rows.forEach((r, order) => {
    if (!r.categoryId) return;
    const label = (r.merchantName?.trim() || r.description?.trim() || "").slice(0, 48);
    if (label.length < 2) return;
    const norm = normalizeText(label);
    let byLabel = stats.get(r.categoryId);
    if (!byLabel) stats.set(r.categoryId, (byLabel = new Map()));
    const entry = byLabel.get(norm);
    if (entry) entry.count++;
    else byLabel.set(norm, { label, count: 1, order });
  });

  const out = new Map<string, string[]>();
  for (const [categoryId, byLabel] of stats) {
    const top = [...byLabel.values()]
      .sort((a, b) => b.count - a.count || a.order - b.order)
      .slice(0, perCategory)
      .map((e) => e.label);
    out.set(categoryId, top);
  }
  return out;
}

// ─── State (o lançamento) ───

const PAYMENT_METHOD_TEXT: Record<PaymentMethod, string> = {
  pix: "Pix",
  credito: "credit card",
  debito: "debit card",
  boleto: "boleto (bank slip)",
  transferencia: "bank transfer (TED/DOC)",
};

const ACCOUNT_KIND_TEXT: Record<string, string> = {
  corrente: "checking account",
  poupanca: "savings account",
  carteira: "cash wallet",
  investimento: "investment account",
  cartao: "credit card",
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Campos do lançamento que o Jev recebe (o resto — datas, ids, flags — não ajuda a categorizar). */
export type JevTransactionInput = Pick<
  Transaction,
  | "type"
  | "amount"
  | "description"
  | "rawDescription"
  | "rawPayload"
  | "merchantName"
  | "counterpartyName"
  | "counterpartyDocument"
  | "paymentMethod"
  | "pluggyCategory"
>;

export interface TransactionStateContext {
  account?: Pick<Account, "name" | "kind" | "institution"> | null;
  /** Nome do destinatário (payees.name), quando existir. */
  payeeName?: string | null;
}

/**
 * Descreve UM lançamento para o Jev, só com os campos que ajudam a
 * decidir a categoria. Campos vazios ou repetidos (mesmo texto em dois
 * campos) são omitidos — texto duplicado é ruído no state.
 */
export function buildTransactionState(
  tx: JevTransactionInput,
  ctx: TransactionStateContext = {}
): { transaction: { [k: string]: TypeSafeJson } } {
  const seen = new Set<string>();
  const out: { [k: string]: TypeSafeJson } = {};
  const put = (key: string, value: string | null | undefined) => {
    const v = value?.trim();
    if (!v) return;
    const norm = normalizeText(v);
    if (seen.has(norm)) return;
    seen.add(norm);
    out[key] = v;
  };

  out.direction = tx.type === "saida" ? "money out (expense)" : "money in (income)";
  put("description", tx.description);
  put("bank_statement_text", tx.rawDescription);

  const payload = asRecord(tx.rawPayload);
  put("bank_statement_detail", asString(payload?.descriptionRaw));
  put("merchant", tx.merchantName);
  put("merchant_legal_name", asString(asRecord(payload?.merchant)?.businessName));

  const counterparty = tx.counterpartyName?.trim();
  if (counterparty && !seen.has(normalizeText(counterparty))) {
    const digits = (tx.counterpartyDocument ?? "").replace(/\D/g, "");
    const who = digits.length === 11 ? "person" : digits.length === 14 ? "company" : null;
    put("counterparty", who ? `${counterparty} (${who})` : counterparty);
    seen.add(normalizeText(counterparty));
  }
  put("payee", ctx.payeeName);
  put("payment_note", asString(asRecord(payload?.paymentData)?.reason));

  const method = resolvePaymentMethod({
    paymentMethod: tx.paymentMethod,
    rawDescription: tx.rawDescription,
  });
  if (method) out.payment_method = PAYMENT_METHOD_TEXT[method];

  if (tx.pluggyCategory?.trim()) out.bank_suggested_category = tx.pluggyCategory.trim();
  out.amount = brl.format(tx.amount);

  if (ctx.account) {
    const kind = ACCOUNT_KIND_TEXT[ctx.account.kind] ?? null;
    const parts = [ctx.account.name, ctx.account.institution, kind].filter(
      (p): p is string => Boolean(p && p.trim())
    );
    const unique = [...new Map(parts.map((p) => [normalizeText(p), p])).values()];
    if (unique.length > 0) out.account = unique.join(" · ");
  }

  return { transaction: out };
}

// ─── Pergunta e interpretação ───

export function buildCategoryQuestion(options: CategoryOptionSet): ChoiceQuestion {
  const which = options.kind === "despesa" ? "expense" : "income";
  return {
    type: "choice",
    instructions: {
      question: `Which of the user's ${which} categories should \`transaction\` be filed under?`,
      context:
        "Personal finance app in Brazil. Transaction texts are Brazilian Portuguese bank statement descriptions; merchant names are often abbreviated or truncated.",
      how_to_decide:
        "Pick the category this user would file the transaction under. Options may say what they cover, what they do not cover, and list examples of transactions previously filed there (some were filed automatically, so treat them as hints). The transaction's own details decide. Choose the none option only when no category reasonably fits.",
    },
    criteria: options.criteria,
  };
}

/** Converte a resposta Choice em decisão (ids de categoria, faixa de confiança, alternativas). */
export function interpretCategoryAnswer(
  transactionId: string,
  answer: ChoiceAnswer,
  options: CategoryOptionSet
): JevDecision {
  const confidence = clamp01(answer.confidence);
  const probability = clamp01(answer.probabilities?.[answer.choice] ?? 0);

  const alternatives = Object.entries(answer.probabilities ?? {})
    .filter(([key, p]) => key !== answer.choice && p >= 0.05)
    .map(([key, p]) => ({ categoryId: options.idByKey.get(key), probability: clamp01(p) }))
    .filter((a): a is { categoryId: string; probability: number } => typeof a.categoryId === "string")
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);

  if (!options.idByKey.has(answer.choice)) {
    return {
      transactionId,
      categoryId: null,
      probability: 0,
      confidence: 0,
      tier: "nenhuma",
      alternatives,
      error: "O Jev devolveu uma opção que não estava na lista.",
    };
  }

  const categoryId = options.idByKey.get(answer.choice) ?? null;
  return {
    transactionId,
    categoryId,
    probability,
    confidence,
    tier: tierFor(confidence, categoryId !== null),
    alternatives,
  };
}

// ─── helpers ───

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
