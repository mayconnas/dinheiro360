// ─────────────────────────────────────────────────────────────
// Camada 4 — Contexto COMPLETO para o GESTOR IA.
//
// O Pacote de Contexto determinístico (context-package.ts) só entrega
// AGREGADOS. A IA reclamava: "não tenho a lista transação-a-transação
// (só vejo agregados por categoria/flags/recorrências)". Este módulo
// monta o contexto RICO que faltava: a lista transação-a-transação (com
// contraparte, CPF, categoria, banco, forma de pagamento, operationType),
// os saldos reais das contas, a dívida/limite dos cartões, os
// destinatários cadastrados, a árvore do plano de contas, orçamentos e
// metas — TUDO organizado e enxuto para o modelo consumir.
//
// CLASSIFICAÇÃO POR INJEÇÃO DE DEPENDÊNCIA: para os TOTAIS
// (receita/despesa/gasto) saírem certos, cada transação precisa ser
// classificada nas DUAS VISÕES que o usuário pediu — FLUXO DE CAIXA
// (dinheiro líquido real) x CONTROLE DE GASTOS (quanto/onde gastei, por
// categoria), com o PAGAMENTO DE FATURA como a ponte entre as duas (conta
// no fluxo de caixa, não no controle de gastos — ver o cabeçalho da seção
// "PAGAMENTO DE FATURA" em src/lib/engine/transfers.ts para os sinais).
// Essa classificação vem de classifyForViews (src/lib/engine/transfers.ts),
// mas ESTE módulo NÃO a importa: recebe o resultado por parâmetro
// (interface estrutural TxClassification abaixo, deliberadamente achatada
// — sem os objetos aninhados de ViewClassification — pra não acoplar ao
// shape exato do motor). Assim continua puro/testável e não quebra se
// transfers.ts ainda estiver sendo alterado — quem injeta é o advisor
// (src/app/actions/advisor.ts), adaptando `classifyForViews(...)` pra este
// shape.
//
// Puro, sem IO.
// ─────────────────────────────────────────────────────────────
import type {
  Account,
  Budget,
  Category,
  Goal,
  Profile,
  Transaction,
} from "@/lib/types";
import type { AiPayee, FullFinancialData } from "@/lib/data/ai-queries";
import { monthLabel } from "@/lib/utils";

/**
 * O que buildFullContext precisa da classificação das DUAS VISÕES
 * (subconjunto estrutural achatado de ViewClassification de
 * src/lib/engine/transfers.ts classifyForViews). Usa Readonly* para
 * aceitar diretamente os Sets/Map produzidos pelo motor sem acoplar ao
 * módulo — o advisor adapta `classifyForViews(...)` pra este shape.
 */
export interface TxClassification {
  /** FLUXO DE CAIXA: ids (entrada) que contam como receita real. */
  cashflowIncome: ReadonlySet<string>;
  /**
   * FLUXO DE CAIXA: ids (saída) que contam como despesa real — PIX/débito
   * a terceiro + pagamento de fatura (lado conta). NÃO inclui compra no
   * cartão.
   */
  cashflowExpense: ReadonlySet<string>;
  /**
   * CONTROLE DE GASTOS: ids (saída) que contam como gasto categorizável —
   * PIX/débito a terceiro + compra no cartão. NÃO inclui pagamento de
   * fatura (a ponte — já contado nas compras que a formaram).
   */
  spending: ReadonlySet<string>;
  /** ids de compra no cartão — subconjunto informativo de `spending` (fora do fluxo de caixa; é dívida até a fatura ser paga). */
  cardPurchase: ReadonlySet<string>;
  /** ids do pagamento de fatura, lado conta — subconjunto informativo de `cashflowExpense` (fora de `spending`; é a ponte). */
  billPaymentCash: ReadonlySet<string>;
  /** motivo por id (entre_contas, compra_no_cartao, salario, pagamento_fatura_conta, ...), opcional. */
  reasons?: ReadonlyMap<string, string>;
}

export interface BuildFullContextOptions {
  /** ISO AAAA-MM-DD de "hoje". */
  today: string;
  /** AAAA-MM do mês corrente. */
  month: string;
  /** CPFs (só dígitos) do dono — para explicar a regra de transferência interna. */
  ownerDocuments: string[];
}

// ── formatação ────────────────────────────────────────────────
function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function clip(s: string | null | undefined, max: number): string {
  if (!s) return "";
  const t = s.replace(/[\t\r\n|]+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function fmtDoc(doc: string | null): string {
  const digits = (doc ?? "").replace(/\D/g, "");
  if (digits.length === 11) return `CPF ${digits}`;
  if (digits.length === 14) return `CNPJ ${digits}`;
  return digits ? `doc ${digits}` : "";
}

// ── selo das DUAS VISÕES por transação ─────────────────────────
/**
 * Traduz a classificação numa etiqueta legível que diz à IA em qual(is)
 * das DUAS VISÕES a transação conta — FLUXO DE CAIXA (dinheiro real) x
 * CONTROLE DE GASTOS (onde foi gasto) — e por quê. É o que impede a IA de
 * chamar transferência interna de "receita recorrente", compra no cartão
 * de "despesa do mês" (ela é GASTO, não despesa de caixa — só vira
 * despesa de caixa quando a fatura é paga), ou o pagamento da fatura de
 * "mais um gasto" (ele já foi contado nas compras que o formaram).
 *
 * Invariante usada aqui (garantida por classifyForViews): toda saída em
 * `cashflowExpense` que NÃO é pagamento de fatura também está em
 * `spending` — por isso o `reason === "pagamento_fatura_conta"` precisa
 * ser checado ANTES de `cashflowExpense`, mas a ordem das duas checagens
 * seguintes (cashflowExpense / spending) não tem ambiguidade.
 */
function fluxoFlag(tx: Transaction, cls: TxClassification): string {
  const reason = cls.reasons?.get(tx.id);

  if (tx.type === "entrada") {
    if (cls.cashflowIncome.has(tx.id)) {
      return reason === "salario" ? "RECEITA(salário)" : "RECEITA";
    }
    if (reason === "entre_contas") return "TRANSF_INTERNA";
    if (reason === "fatura_ou_estorno_cartao" || reason === "pagamento_fatura_cartao") {
      return "CARTAO_INTERNO";
    }
    if (reason === "pix_no_credito") return "CREDITO_NAO_RECEITA";
    return "NAO_RECEITA";
  }

  // saída
  if (reason === "pagamento_fatura_conta") return "PAGAMENTO_FATURA";
  if (cls.cashflowExpense.has(tx.id)) return "DESPESA";
  if (cls.spending.has(tx.id)) return "COMPRA_CARTAO_DIVIDA";
  if (reason === "entre_contas") return "TRANSF_INTERNA";
  if (reason === "fatura_ou_estorno_cartao") return "CARTAO_INTERNO";
  return "NAO_DESPESA";
}

// ── árvore de categorias (plano de contas) ────────────────────
function buildCategoryTreeText(categories: Category[]): string {
  const byParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    const key = c.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  for (const list of byParent.values()) {
    list.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt-BR")
    );
  }

  const lines: string[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    for (const c of children) {
      if (seen.has(c.id)) continue; // proteção contra ciclo
      seen.add(c.id);
      const indent = "  ".repeat(depth);
      lines.push(`${indent}- ${c.name} [${c.kind}/${c.nature}]`);
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  // categorias órfãs (parentId aponta para inexistente) — não perder
  for (const c of categories) {
    if (!seen.has(c.id)) {
      lines.push(`- ${c.name} [${c.kind}/${c.nature}]`);
    }
  }
  return lines.join("\n");
}

// ── seção de contas / saldos / cartões ────────────────────────
function buildAccountsSection(accounts: Account[]): string {
  if (accounts.length === 0) return "Nenhuma conta cadastrada.";

  const lines: string[] = [];
  let totalDisponivel = 0;
  let totalDividaCartao = 0;
  let algumSaldoConhecido = false;

  for (const a of accounts) {
    const isCartao = a.kind === "cartao" || a.accountType === "credit";
    const banco = a.institution ? ` (${a.institution})` : "";
    const partes: string[] = [];

    if (isCartao) {
      if (a.currentBalance != null) {
        totalDividaCartao += a.currentBalance;
        algumSaldoConhecido = true;
        partes.push(`dívida atual=R$ ${money(a.currentBalance)}`);
      } else {
        partes.push("dívida não sincronizada");
      }
      if (a.creditLimit != null) partes.push(`limite=R$ ${money(a.creditLimit)}`);
      if (a.creditAvailable != null)
        partes.push(`disponível=R$ ${money(a.creditAvailable)}`);
      if (a.creditMinimumPayment != null)
        partes.push(`mínimo=R$ ${money(a.creditMinimumPayment)}`);
      if (a.creditDueDate) partes.push(`vence=${a.creditDueDate}`);
      if (a.cardBrand) partes.push(a.cardBrand);
      if (a.cardLast4) partes.push(`final ${a.cardLast4}`);
    } else {
      if (a.currentBalance != null) {
        totalDisponivel += a.currentBalance;
        algumSaldoConhecido = true;
        partes.push(`saldo=R$ ${money(a.currentBalance)}`);
      } else {
        partes.push("saldo não sincronizado");
      }
    }

    lines.push(`- ${a.name}${banco} [${a.kind}]: ${partes.join(", ")}`);
  }

  const resumo: string[] = [];
  if (algumSaldoConhecido) {
    resumo.push(
      `TENHO (saldo em contas não-cartão): R$ ${money(totalDisponivel)}`
    );
    resumo.push(`DEVO (dívida somada dos cartões): R$ ${money(totalDividaCartao)}`);
    resumo.push(
      `Patrimônio líquido aproximado (TENHO − DEVO): R$ ${money(
        totalDisponivel - totalDividaCartao
      )}`
    );
  } else {
    resumo.push(
      "Saldos reais não sincronizados (conta manual ou sem Open Finance) — use as transações para estimar."
    );
  }

  return `${lines.join("\n")}\n\n${resumo.join("\n")}`;
}

// ── quebra mensal com classificação correta ───────────────────
function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

function previousMonths(month: string, n: number): string[] {
  const [y, m] = month.split("-").map(Number);
  const out: string[] = [];
  let year = y;
  let mon = m;
  for (let i = 0; i < n; i++) {
    out.push(`${year}-${String(mon).padStart(2, "0")}`);
    mon -= 1;
    if (mon === 0) {
      mon = 12;
      year -= 1;
    }
  }
  return out;
}

interface MonthAgg {
  /** FLUXO DE CAIXA: dinheiro real que entrou. */
  receita: number;
  /** FLUXO DE CAIXA: dinheiro real que saiu (inclui pagamento de fatura). */
  despesaFluxoCaixa: number;
  /** CONTROLE DE GASTOS: onde foi gasto (compra à vista/PIX + compra no cartão; SEM pagamento de fatura). */
  gastoCategorizado: number;
  /** subconjunto informativo de `gastoCategorizado`: só a parte que foi compra no cartão (dívida nova). */
  dividaCartaoNova: number;
  /** subconjunto informativo de `despesaFluxoCaixa`: só a parte que foi pagamento de fatura (a ponte). */
  pagamentoFatura: number;
  transferInterna: number;
}

function buildMonthlyBreakdown(
  txs: Transaction[],
  cls: TxClassification,
  month: string,
  monthsBack: number
): string {
  const wanted = new Set(previousMonths(month, Math.min(Math.max(monthsBack, 1), 12)));
  const agg = new Map<string, MonthAgg>();
  for (const mk of wanted) {
    agg.set(mk, {
      receita: 0,
      despesaFluxoCaixa: 0,
      gastoCategorizado: 0,
      dividaCartaoNova: 0,
      pagamentoFatura: 0,
      transferInterna: 0,
    });
  }

  for (const t of txs) {
    const mk = monthKeyOf(t.date);
    const a = agg.get(mk);
    if (!a) continue;
    const reason = cls.reasons?.get(t.id);
    const isCard = cls.cardPurchase.has(t.id);
    const isBillCash = cls.billPaymentCash.has(t.id);

    if (t.type === "entrada") {
      if (cls.cashflowIncome.has(t.id)) a.receita += t.amount;
      else if (reason === "entre_contas") a.transferInterna += t.amount;
      continue;
    }
    // saída
    if (cls.cashflowExpense.has(t.id)) a.despesaFluxoCaixa += t.amount;
    if (cls.spending.has(t.id)) a.gastoCategorizado += t.amount;
    if (isCard) a.dividaCartaoNova += t.amount;
    if (isBillCash) a.pagamentoFatura += t.amount;
    if (reason === "entre_contas") a.transferInterna += t.amount;
  }

  const header =
    "mês\treceita_real\tdespesa_fluxo_caixa\tsobra_fluxo_caixa\tgasto_categorizado\tnova_dívida_cartão\tpagamento_fatura\tvol_transf_interna";
  const rows = [...wanted]
    .sort()
    .reverse()
    .map((mk) => {
      const a = agg.get(mk)!;
      return `${mk}\t${money(a.receita)}\t${money(a.despesaFluxoCaixa)}\t${money(
        a.receita - a.despesaFluxoCaixa
      )}\t${money(a.gastoCategorizado)}\t${money(a.dividaCartaoNova)}\t${money(
        a.pagamentoFatura
      )}\t${money(a.transferInterna)}`;
    });
  return `${header}\n${rows.join("\n")}`;
}

// ── tabela transação-a-transação ──────────────────────────────
function buildTransactionTable(
  txs: Transaction[],
  cls: TxClassification,
  catById: Map<string, Category>,
  accById: Map<string, Account>
): string {
  const header =
    "data\tvalor\tfluxo\tcategoria\tconta\tforma\toperacao\tcontraparte\tdescricao";
  const rows = txs.map((t) => {
    const sign = t.type === "saida" ? -1 : 1;
    const valor = money(sign * t.amount);
    const flag = fluxoFlag(t, cls);
    const cat = t.categoryId ? catById.get(t.categoryId)?.name ?? "?" : "—";
    const acc = t.accountId
      ? (() => {
          const a = accById.get(t.accountId!);
          if (!a) return "?";
          return a.institution ? `${a.name}/${a.institution}` : a.name;
        })()
      : "—";
    const forma = t.paymentMethod ?? "—";
    const op = t.operationType ?? "—";
    const doc = fmtDoc(t.counterpartyDocument);
    const contraparte = [clip(t.counterpartyName, 32), doc]
      .filter(Boolean)
      .join(" ");
    const rev = t.needsReview ? " (a revisar)" : "";
    return `${t.date}\t${valor}\t${flag}\t${clip(cat, 28)}\t${clip(
      acc,
      28
    )}\t${forma}\t${op}\t${contraparte || "—"}\t${clip(t.description, 48)}${rev}`;
  });
  return `${header}\n${rows.join("\n")}`;
}

// ── destinatários ─────────────────────────────────────────────
function buildPayeesSection(payees: AiPayee[], limit: number): string {
  if (payees.length === 0) return "Nenhum destinatário cadastrado.";
  const sorted = [...payees].sort(
    (a, b) => b.totalPaid + b.totalReceived - (a.totalPaid + a.totalReceived)
  );
  const top = sorted.slice(0, limit);
  const header = "nome\ttipo\tdoc\tnº_tx\ttotal_pago\ttotal_recebido\túltima_vez";
  const rows = top.map((p) => {
    const doc = fmtDoc(p.documentNumber);
    return `${clip(p.name, 40)}\t${p.kind}\t${doc || "—"}\t${p.txCount}\t${money(
      p.totalPaid
    )}\t${money(p.totalReceived)}\t${p.lastSeen ?? "—"}`;
  });
  const nota =
    payees.length > limit
      ? `\n(+${payees.length - limit} destinatários menos relevantes omitidos)`
      : "";
  return `${header}\n${rows.join("\n")}${nota}`;
}

// ── orçamentos e metas ────────────────────────────────────────
function buildBudgetsSection(
  budgets: Budget[],
  catById: Map<string, Category>
): string {
  if (budgets.length === 0) return "Nenhum orçamento definido.";
  return budgets
    .map((b) => {
      const cat = catById.get(b.categoryId)?.name ?? "?";
      return `- ${cat}: teto R$ ${money(b.limit)}/mês`;
    })
    .join("\n");
}

function buildGoalsSection(goals: Goal[]): string {
  if (goals.length === 0) return "Nenhuma meta cadastrada.";
  return goals
    .map((g) => {
      const prazo = g.deadline ? `, prazo ${g.deadline}` : "";
      const pct =
        g.targetAmount > 0
          ? ` (${Math.round((g.currentAmount / g.targetAmount) * 100)}%)`
          : "";
      return `- ${g.name}: R$ ${money(g.currentAmount)} de R$ ${money(
        g.targetAmount
      )}${pct}${prazo}`;
    })
    .join("\n");
}

function buildProfileSection(profile: Profile | null): string {
  if (!profile) return "Perfil não preenchido.";
  return [
    `- Nome: ${profile.displayName ?? "—"}`,
    `- Renda mensal declarada: R$ ${money(profile.monthlyIncome)}`,
    `- Vínculo: ${profile.employmentType}`,
    `- Dependentes: ${profile.dependents}`,
    `- Escada de prioridades: ${profile.priorityLadder.join(" > ") || "—"}`,
  ].join("\n");
}

/**
 * Monta o contexto COMPLETO (texto organizado) para a IA a partir dos
 * dados brutos (getFullFinancialData) + a classificação injetada. É um
 * SUPERCONJUNTO do que o pacote determinístico oferecia: além dos
 * agregados (quebra mensal já classificada), traz a lista
 * transação-a-transação, os saldos, os cartões, os destinatários, o plano
 * de contas, os orçamentos e as metas.
 */
export function buildFullContext(
  data: FullFinancialData,
  classification: TxClassification,
  opts: BuildFullContextOptions
): string {
  const catById = new Map(data.categories.map((c) => [c.id, c]));
  const accById = new Map(data.accounts.map((a) => [a.id, a]));

  const ownerDocs = opts.ownerDocuments.join(", ") || "(nenhum configurado)";

  const legenda = `LEGENDA DA COLUNA "fluxo" (classificação já pronta nas DUAS VISÕES — respeite-a):
Existem DUAS visões de despesa neste app, e elas medem coisas DIFERENTES de propósito (não é erro de conta os totais não baterem entre si):
  (1) FLUXO DE CAIXA = dinheiro líquido que entrou/saiu das contas de verdade.
  (2) CONTROLE DE GASTOS = quanto/onde foi gasto, por categoria.
  O PAGAMENTO DE FATURA é a PONTE: conta no fluxo de caixa (o dinheiro saiu de verdade da conta) mas NÃO no controle de gastos (as compras que formaram aquela fatura já foram contadas uma a uma quando aconteceram — contar a fatura de novo dobraria o gasto).
- RECEITA: entrada de dinheiro REAL (conta como receita — só existe no fluxo de caixa). "RECEITA(salário)" é o salário (protegido).
- DESPESA: saída de dinheiro REAL (conta no FLUXO DE CAIXA). PIX/débito a um terceiro conta TAMBÉM no controle de gastos; não distinga os dois nesta coluna — se quiser saber se uma DESPESA também é gasto categorizado, ela é, exceto quando a linha também aparece somada em "pagamento_fatura" na quebra mensal.
- PAGAMENTO_FATURA: a saída da conta corrente que paga a fatura do cartão. Conta no FLUXO DE CAIXA (dinheiro saiu) — NUNCA no controle de gastos (a ponte; ver acima). NÃO some isso com COMPRA_CARTAO_DIVIDA do mesmo período, senão as compras da fatura contam 2x.
- COMPRA_CARTAO_DIVIDA: compra no cartão de crédito. Conta no CONTROLE DE GASTOS (categorizada), mas NÃO no fluxo de caixa do mês da compra — não moveu dinheiro na hora, é dívida até a fatura ser paga (aí vira PAGAMENTO_FATURA, acima).
- TRANSF_INTERNA: transferência ENTRE CONTAS DO PRÓPRIO USUÁRIO (contraparte com o CPF do dono: ${ownerDocs}). NÃO conta em NENHUMA das duas visões — é o mesmo dinheiro circulando. NUNCA trate como "receita recorrente" nem como gasto.
- CARTAO_INTERNO: pagamento/estorno de fatura visto do lado do CARTÃO (a entrada "Recebido" que abate a dívida no ledger do próprio cartão) — movimentação interna, não conta em nenhuma visão.
- CREDITO_NAO_RECEITA: "valor adicionado" (Pix no crédito) — é financiamento (crédito liberado), não dinheiro novo; não conta em nenhuma visão.
- NAO_RECEITA / NAO_DESPESA: excluído das duas visões por outra regra.

A "quebra mensal" logo abaixo já soma cada visão separada (colunas despesa_fluxo_caixa x gasto_categorizado) — prefira essas colunas a somar você mesma(o) a partir da tabela transação-a-transação.`;

  const cobertura = `Transações incluídas: ${data.transactions.length} (janela dos últimos ${data.monthsIncluded} meses, desde ${data.transactionsSince}). Total no banco (todo o histórico): ${data.totalTransactionCount}. Valores em R$; na coluna "valor", entradas são positivas e saídas negativas.`;

  return `# CONTEXTO FINANCEIRO COMPLETO DO USUÁRIO
Mês de referência: ${monthLabel(opts.month)} (hoje: ${opts.today}).
Você AGORA TEM acesso à lista transação-a-transação e aos saldos — não está mais limitado a agregados. Use estes dados para fundamentar o diagnóstico e as respostas. ${cobertura}

## Perfil
${buildProfileSection(data.profile)}

## Saldos das contas e cartões
${buildAccountsSection(data.accounts)}

## Quebra mensal (fluxo de caixa E controle de gastos, já classificados — ver legenda abaixo)
\`\`\`tsv
${buildMonthlyBreakdown(data.transactions, classification, opts.month, data.monthsIncluded)}
\`\`\`

## Plano de contas (árvore de categorias)
${buildCategoryTreeText(data.categories)}

## Orçamentos (tetos mensais)
${buildBudgetsSection(data.budgets, catById)}

## Metas
${buildGoalsSection(data.goals)}

## Destinatários cadastrados (com totais históricos)
\`\`\`tsv
${buildPayeesSection(data.payees, 60)}
\`\`\`

## Transações (uma a uma)
${legenda}

\`\`\`tsv
${buildTransactionTable(data.transactions, classification, catById, accById)}
\`\`\`
`;
}
