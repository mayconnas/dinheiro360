"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Plus, Upload, Search, X, BrainCircuit } from "lucide-react";
import {
  addTransaction,
  importCSV,
  bulkUpdateCategory,
  bulkDeleteTransactions,
  bulkMarkReviewed,
  acceptSuggestion,
  createRuleFromSelection,
  type SuggestionsMap,
} from "@/app/actions/transactions";
import { applyCategoryToPayeeOfTransaction } from "@/app/actions/payees";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Account, Category, Transaction } from "@/lib/types";

import {
  PERIOD_PRESETS,
  filterByPeriod,
  groupByDate,
  groupByPayee,
  periodSummary,
} from "@/lib/transactions/view-helpers";
import { PeriodPicker } from "@/components/transacoes/period-picker";
import { GroupToggle, type GroupMode } from "@/components/transacoes/group-toggle";
import { PeriodSummaryStrip } from "@/components/transacoes/period-summary";
import { ReviewBacklog } from "@/components/transacoes/review-backlog";
import {
  FilterChips,
  type StatusFilter,
  type BankOption,
} from "@/components/transacoes/filter-chips";
import { TxRow } from "@/components/transacoes/tx-row";
import { CategoryMenu } from "@/components/transacoes/category-menu";
import { SelectionBar } from "@/components/transacoes/selection-bar";
import {
  JevCategorizeDialog,
  type JevScope,
  type JevScopeId,
} from "@/components/transacoes/jev-dialog";
import {
  ToastProvider,
  ToastHost,
  useToast,
} from "@/components/transacoes/use-toast";

interface Props {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  /**
   * Sugestões {[transactionId]: {categoryId, categoryName}} para itens a
   * revisar, pré-calculadas no servidor (getSuggestions rodado na page)
   * e passadas por prop. Evita chamar a server action num useEffect no
   * mount (que causaria um flash sem sugestões + round-trip extra) — o
   * custo de calcular já é pago uma vez no render da page, que roda a
   * cada revalidatePath('/transacoes') de qualquer mutação relevante.
   */
  suggestions: SuggestionsMap;
  /**
   * ids classificados por src/lib/engine/transfers.ts classifyTransactions
   * (calculado na page — server component). Arrays (não Set) porque Set
   * não serializa como prop de Server->Client Component; convertidos para
   * Set aqui. NÃO removem nada da lista — só marcam visualmente (selos na
   * TxRow) e descontam do resumo de entradas/saídas do período, para bater
   * com os KPIs do painel (mesmo motor de regras, ver dashboard.ts).
   *
   * `internalTransferIds`: regra do CPF (transferência entre contas
   * próprias) + fatura/estorno interno do cartão — selo "Entre contas".
   */
  internalTransferIds: string[];
  /** Compra no cartão de crédito (dívida, não despesa) — selo "No cartão". */
  cardPurchaseIds: string[];
  /** "Valor adicionado" / Pix no crédito (financiamento, não receita) — selo "Pix no crédito". */
  pixNoCreditoIds: string[];
  /**
   * Pagamento de fatura, lado conta (dinheiro saiu de verdade — conta no
   * fluxo de caixa; NÃO conta no controle de gastos, é a ponte — ver
   * src/lib/engine/transfers.ts classifyForViews) — selo "Pagamento de
   * fatura". Default `[]` para não quebrar chamadores antigos.
   */
  billPaymentIds?: string[];
  /**
   * União de todos os ids acima — pronta para os cálculos de resumo
   * (periodSummary/groupByDate) descontarem dos dois lados (receita e
   * despesa) de uma vez, sem precisar reunir os 3 Sets de novo aqui.
   */
  excludedFromSummaryIds: string[];
  /**
   * Há chave da TypeSafe (do usuário ou TYPESAFE_API_KEY do servidor)?
   * Sem ela, o diálogo "Categorizar com Jev" abre explicando como
   * configurar em vez de enviar.
   */
  jevConfigured?: boolean;
}

/** Sentinel usado pelo dropdown de categoria do FilterChips para representar "A revisar". */
const REVIEW_SENTINEL = "__revisar";

const ROWS_PAGE_SIZE = 60;

export function TransactionsView(props: Props) {
  return (
    <ToastProvider>
      <TransactionsViewInner {...props} />
      <ToastHost />
    </ToastProvider>
  );
}

function TransactionsViewInner({
  transactions,
  categories,
  accounts,
  suggestions,
  internalTransferIds,
  cardPurchaseIds,
  pixNoCreditoIds,
  billPaymentIds = [],
  excludedFromSummaryIds,
  jevConfigured = false,
}: Props) {
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  // Sets (não arrays) só para lookup O(1) por linha/resumo — recalculados só
  // quando a prop muda (revalidatePath da page recalcula no servidor).
  const internalIdSet = useMemo(
    () => new Set(internalTransferIds),
    [internalTransferIds]
  );
  const cardPurchaseIdSet = useMemo(() => new Set(cardPurchaseIds), [cardPurchaseIds]);
  const pixNoCreditoIdSet = useMemo(() => new Set(pixNoCreditoIds), [pixNoCreditoIds]);
  const billPaymentIdSet = useMemo(() => new Set(billPaymentIds), [billPaymentIds]);
  // Usado só para os totais (periodSummary/groupByDate) — une os 3 Sets
  // acima, já pronto pelo servidor via combinedExclusionIds.
  const excludedIdSet = useMemo(
    () => new Set(excludedFromSummaryIds),
    [excludedFromSummaryIds]
  );

  // "Hoje" calculado uma única vez por render do componente (não a cada
  // helper) — todos os helpers puros recebem `today` por parâmetro.
  const today = useMemo(() => new Date(), []);
  const presets = useMemo(() => PERIOD_PRESETS(today), [today]);

  const [period, setPeriod] = useState(() => presets.mes_atual);
  const [groupMode, setGroupMode] = useState<GroupMode>("data");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todas");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [bankFilter, setBankFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(ROWS_PAGE_SIZE);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [catMenu, setCatMenu] = useState<
    | { mode: "single"; txId: string; anchor: HTMLElement }
    | { mode: "bulk"; anchor: HTMLElement }
    | null
  >(null);
  const selectionBarRef = useRef<HTMLDivElement>(null);
  const [jevOpen, setJevOpen] = useState(false);
  const [jevInitialScope, setJevInitialScope] = useState<JevScopeId>("revisar");

  // ─── Pré-cálculos globais (independem do período) ───
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  // accountId -> nome da conta/banco (ex "Conta Corrente", "Carteira"),
  // pra TxRow mostrar de qual conta veio a transação sem cada linha
  // precisar carregar/receber a lista inteira de accounts.
  const accountNameById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts]
  );
  const receitaCats = useMemo(() => categories.filter((c) => c.kind === "receita"), [categories]);
  const despesaCats = useMemo(() => categories.filter((c) => c.kind === "despesa"), [categories]);
  const revisarCategoryId = useMemo(
    () => categories.find((c) => c.name.toLowerCase() === "a revisar")?.id ?? null,
    [categories]
  );

  function isReview(t: Transaction): boolean {
    return t.needsReview || (revisarCategoryId !== null && t.categoryId === revisarCategoryId);
  }

  // ─── Filtro por período ───
  const inPeriod = useMemo(
    () => filterByPeriod(transactions, period.from, period.to),
    [transactions, period]
  );

  const summary = useMemo(
    () => periodSummary(inPeriod, excludedIdSet),
    [inPeriod, excludedIdSet]
  );
  const reviewCount = useMemo(() => inPeriod.filter(isReview).length, [inPeriod, revisarCategoryId]);

  // ─── Contagens para os chips (sobre o período, antes do filtro de busca) ───
  const statusCounts = useMemo(() => {
    let revisar = 0;
    let entradas = 0;
    let saidas = 0;
    for (const t of inPeriod) {
      if (isReview(t)) revisar++;
      if (t.type === "entrada") entradas++;
      else saidas++;
    }
    return { todas: inPeriod.length, revisar, entradas, saidas };
  }, [inPeriod, revisarCategoryId]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of inPeriod) {
      if (!t.categoryId) continue;
      counts[t.categoryId] = (counts[t.categoryId] ?? 0) + 1;
    }
    return counts;
  }, [inPeriod]);

  // ─── Bancos/contas para o filtro (só os que têm lançamento no período) ───
  const bankCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of inPeriod) {
      if (!t.accountId) continue;
      counts[t.accountId] = (counts[t.accountId] ?? 0) + 1;
    }
    return counts;
  }, [inPeriod]);

  const bankOptions = useMemo<BankOption[]>(() => {
    const candidates = accounts.filter((a) => (bankCounts[a.id] ?? 0) > 0);

    // Grupo pro dropdown (conta bancária | cartão | investimento). Prefere
    // `accountType` (migration 0010, deriva do `type` da Pluggy); cai para
    // `kind`, que já existia antes e já distinguia cartão ('cartao') de
    // conta corrente/poupança/carteira — por isso a separação funciona
    // mesmo se a migration 0010 ainda não tiver rodado.
    function groupOf(a: (typeof accounts)[number]): NonNullable<BankOption["group"]> {
      if (a.accountType === "credit") return "cartao";
      if (a.accountType === "investment") return "investimento";
      if (a.accountType === "bank") return "conta";
      if (a.kind === "cartao") return "cartao";
      if (a.kind === "investimento") return "investimento";
      return "conta";
    }

    // Rótulo base: `institution` (nome limpo do banco/emissor, migration
    // 0010 — ex "Mercado Pago" em vez de "Nu Pagamentos S.A.") quando
    // disponível; senão o `name` cru de sempre. Fallback gracioso: se a
    // migration não rodou, `institution` vem `null`/`undefined` e cai pro
    // `name`, sem quebrar nada.
    function baseLabel(a: (typeof accounts)[number]): string {
      return (a.institution && a.institution.trim()) || a.name;
    }

    // Quantas contas com o MESMO rótulo caem em grupos DIFERENTES (ex
    // "Mercado Pago" existindo como conta corrente E como cartão) — só
    // nesse caso desambigua com "· Conta"/"· Cartão"; um rótulo que só
    // aparece num grupo fica limpo, sem sufixo.
    const groupsByLabel = new Map<string, Set<string>>();
    for (const a of candidates) {
      const label = baseLabel(a);
      const set = groupsByLabel.get(label) ?? new Set<string>();
      set.add(groupOf(a));
      groupsByLabel.set(label, set);
    }
    const GROUP_SUFFIX: Record<NonNullable<BankOption["group"]>, string> = {
      conta: "Conta",
      cartao: "Cartão",
      investimento: "Investimento",
      outra: "Outra",
    };

    return candidates
      .map((a) => {
        const group = groupOf(a);
        const label = baseLabel(a);
        let name = label;
        // Cartão: acrescenta os últimos 4 dígitos (ex "gold ****6163") pra
        // diferenciar cartões do mesmo emissor/produto entre si.
        if (group === "cartao" && a.cardLast4) name = `${name} ****${a.cardLast4}`;
        // Mesmo rótulo em grupos diferentes (conta + cartão do mesmo banco)
        // -> desambigua em vez de mostrar duas opções com nome idêntico.
        if ((groupsByLabel.get(label)?.size ?? 0) > 1) {
          name = `${name} · ${GROUP_SUFFIX[group]}`;
        }
        return { id: a.id, name, group };
      })
      .sort((x, y) => (bankCounts[y.id] ?? 0) - (bankCounts[x.id] ?? 0));
  }, [accounts, bankCounts]);

  // ─── Aplica filtros de status + categoria + busca ───
  const filtered = useMemo(() => {
    let list = inPeriod;

    if (statusFilter === "revisar") list = list.filter(isReview);
    else if (statusFilter === "entradas") list = list.filter((t) => t.type === "entrada");
    else if (statusFilter === "saidas") list = list.filter((t) => t.type === "saida");

    if (categoryFilter === REVIEW_SENTINEL) list = list.filter(isReview);
    else if (categoryFilter) list = list.filter((t) => t.categoryId === categoryFilter);

    if (bankFilter) list = list.filter((t) => t.accountId === bankFilter);

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.description.toLowerCase().includes(q) ||
          t.rawDescription.toLowerCase().includes(q) ||
          String(t.amount).includes(q)
      );
    }

    return list;
  }, [inPeriod, statusFilter, categoryFilter, bankFilter, query, revisarCategoryId]);

  // ─── Agrupamento (só sobre os itens filtrados) ───
  const dateGroups = useMemo(
    () => (groupMode === "data" ? groupByDate(filtered, today, excludedIdSet) : []),
    [groupMode, filtered, today, excludedIdSet]
  );
  const payeeGroups = useMemo(
    () => (groupMode === "destinatario" ? groupByPayee(filtered) : []),
    [groupMode, filtered]
  );

  // ─── Paginação: achata os grupos em uma sequência de "linhas visíveis",
  // cortando em `visible` itens no total para não renderizar milhares de
  // linhas de uma vez (há ~1400 transações). "Carregar mais" avança o
  // corte; trocar filtro/período/busca reseta para ROWS_PAGE_SIZE. ───
  const totalFilteredCount = filtered.length;

  const visibleDateGroups = useMemo(() => {
    if (groupMode !== "data") return [];
    let budget = visible;
    const out: typeof dateGroups = [];
    for (const g of dateGroups) {
      if (budget <= 0) break;
      const items = g.items.slice(0, budget);
      out.push({ ...g, items });
      budget -= items.length;
    }
    return out;
  }, [groupMode, dateGroups, visible]);

  const visiblePayeeGroups = useMemo(() => {
    if (groupMode !== "destinatario") return [];
    let budget = visible;
    const out: typeof payeeGroups = [];
    for (const g of payeeGroups) {
      if (budget <= 0) break;
      // trunca só os itens renderizados; `count` mantém o total real do
      // grupo (não o nº de itens exibidos) para não subestimar no header.
      const items = g.items.slice(0, budget);
      out.push({ ...g, items });
      budget -= items.length;
    }
    return out;
  }, [groupMode, payeeGroups, visible]);

  const shownCount = useMemo(() => Math.min(visible, totalFilteredCount), [visible, totalFilteredCount]);

  function resetPagination() {
    setVisible(ROWS_PAGE_SIZE);
  }

  function handlePeriodChange(from: string, to: string) {
    setPeriod({ from, to });
    resetPagination();
  }
  function handleStatusChange(s: StatusFilter) {
    setStatusFilter(s);
    resetPagination();
  }
  function handleCategoryChange(c: string | null) {
    setCategoryFilter(c);
    resetPagination();
  }
  function handleBankChange(b: string | null) {
    setBankFilter(b);
    resetPagination();
  }
  function handleQueryChange(q: string) {
    setQuery(q);
    resetPagination();
  }
  function handleGroupModeChange(g: GroupMode) {
    setGroupMode(g);
    resetPagination();
  }

  // ─── Seleção ───
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  const visibleIds = useMemo(() => {
    const ids: string[] = [];
    if (groupMode === "data") {
      for (const g of visibleDateGroups) for (const t of g.items) ids.push(t.id);
    } else {
      for (const g of visiblePayeeGroups) for (const t of g.items) ids.push(t.id);
    }
    return ids;
  }, [groupMode, visibleDateGroups, visiblePayeeGroups]);

  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }

  const txById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);
  const selectionSum = useMemo(() => {
    let sum = 0;
    for (const id of selected) {
      const t = txById.get(id);
      if (!t) continue;
      sum += t.type === "entrada" ? t.amount : -t.amount;
    }
    return sum;
  }, [selected, txById]);

  // ─── Ações (todas via startTransition + toast) ───
  function runAction(fn: () => Promise<{ ok: boolean; error?: string; count?: number }>, successMsg: (count: number) => string) {
    startTransition(async () => {
      try {
        const result = await fn();
        if (result.ok) {
          showToast(successMsg(result.count ?? 0), { variant: "success" });
          clearSelection();
        } else {
          showToast(result.error ?? "Ocorreu um erro.", { variant: "error" });
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Ocorreu um erro.", { variant: "error" });
      }
    });
  }

  function handleAcceptSuggestion(id: string, categoryId: string) {
    startTransition(async () => {
      try {
        const result = await acceptSuggestion(id, categoryId);
        if (result.ok) {
          showToast("Sugestão aplicada.", { variant: "success" });
        } else {
          showToast(result.error ?? "Erro ao aplicar sugestão.", { variant: "error" });
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Erro ao aplicar sugestão.", { variant: "error" });
      }
    });
  }

  function handleApplyAllSuggestions() {
    const assignments = inPeriod
      .filter((t) => isReview(t) && suggestions[t.id])
      .map((t) => ({ id: t.id, categoryId: suggestions[t.id].categoryId }));
    if (assignments.length === 0) {
      showToast("Nenhuma sugestão disponível para este período.", { variant: "default" });
      return;
    }
    runAction(
      () => bulkMarkReviewed(assignments),
      (n) => `${n} lançamento${n === 1 ? "" : "s"} atualizado${n === 1 ? "" : "s"} com a sugestão.`
    );
  }

  function handleBulkPick(categoryId: string, applyToPayee: boolean) {
    if (!catMenu) return;
    if (catMenu.mode === "single") {
      if (applyToPayee) {
        // Gatilho "aplicar a todo o destinatário": categoriza a
        // transação E, em cascata, todas as outras (passadas e
        // futuras via default_category_id) do mesmo destinatário —
        // ver applyCategoryToPayeeOfTransaction em src/app/actions/payees.ts.
        startTransition(async () => {
          try {
            const result = await applyCategoryToPayeeOfTransaction(catMenu.txId, categoryId);
            if (result.ok) {
              const n = result.appliedCount;
              showToast(
                `${n} lançamento${n === 1 ? "" : "s"} de ${result.payeeName ?? "destinatário"} categorizado${n === 1 ? "" : "s"}.`,
                { variant: "success" }
              );
              clearSelection();
            } else {
              showToast(result.error ?? "Erro ao categorizar destinatário.", { variant: "error" });
            }
          } catch (e) {
            showToast(e instanceof Error ? e.message : "Erro ao categorizar destinatário.", { variant: "error" });
          }
        });
      } else {
        runAction(
          () => bulkUpdateCategory([catMenu.txId], categoryId),
          () => "Categoria atualizada."
        );
      }
    } else {
      const ids = [...selected];
      runAction(
        () => bulkUpdateCategory(ids, categoryId),
        (n) => `${n} lançamento${n === 1 ? "" : "s"} categorizado${n === 1 ? "" : "s"}.`
      );
    }
    setCatMenu(null);
  }

  function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Excluir ${ids.length} lançamento${ids.length === 1 ? "" : "s"}? Essa ação não pode ser desfeita.`)) {
      return;
    }
    runAction(
      () => bulkDeleteTransactions(ids),
      (n) => `${n} lançamento${n === 1 ? "" : "s"} excluído${n === 1 ? "" : "s"}.`
    );
  }

  function handleBulkMarkReviewed() {
    const ids = [...selected];
    const assignments = ids
      .map((id) => {
        const s = suggestions[id];
        return s ? { id, categoryId: s.categoryId } : null;
      })
      .filter((a): a is { id: string; categoryId: string } => a !== null);
    if (assignments.length === 0) {
      showToast("Nenhum item selecionado tem sugestão disponível.", { variant: "default" });
      return;
    }
    runAction(
      () => bulkMarkReviewed(assignments),
      (n) => `${n} lançamento${n === 1 ? "" : "s"} marcado${n === 1 ? "" : "s"} como revisado.`
    );
  }

  function handleCreateRule() {
    const ids = [...selected];
    if (ids.length === 0) return;
    // usa a categoria do primeiro item selecionado com categoria definida
    const firstWithCat = ids.map((id) => txById.get(id)).find((t) => t?.categoryId);
    if (!firstWithCat?.categoryId) {
      showToast("Selecione itens já categorizados para criar uma regra.", { variant: "default" });
      return;
    }
    runAction(
      () => createRuleFromSelection(ids, firstWithCat.categoryId as string),
      (n) => `${n} regra${n === 1 ? "" : "s"} criada${n === 1 ? "" : "s"}.`
    );
  }

  function openSingleCatMenu(txId: string, anchor: HTMLElement) {
    setCatMenu({ mode: "single", txId, anchor });
  }
  function openBulkCatMenu(anchor: HTMLElement) {
    setCatMenu({ mode: "bulk", anchor });
  }

  const menuCategories = useMemo(() => {
    if (!catMenu) return categories;
    if (catMenu.mode === "single") {
      const t = txById.get(catMenu.txId);
      if (!t) return categories;
      return t.type === "entrada" ? receitaCats : despesaCats;
    }
    // bulk: usa o tipo predominante da seleção; se misto, todas as categorias
    const types = new Set([...selected].map((id) => txById.get(id)?.type).filter(Boolean));
    if (types.size === 1) {
      return types.has("entrada") ? receitaCats : despesaCats;
    }
    return categories;
  }, [catMenu, categories, receitaCats, despesaCats, txById, selected]);

  const menuSuggestion = useMemo(() => {
    if (!catMenu || catMenu.mode !== "single") return undefined;
    return suggestions[catMenu.txId];
  }, [catMenu, suggestions]);

  // Nome exibido no checkbox "Aplicar a todo(a) <nome>" do CategoryMenu
  // — usa a descrição já normalizada da transação (o mesmo texto que a
  // TxRow mostra como título), disponível sem round-trip extra. O nome
  // "oficial" do payee (payees.name) só é resolvido no servidor dentro
  // de applyCategoryToPayeeOfTransaction e usado no toast de confirmação.
  const menuPayeeName = useMemo(() => {
    if (!catMenu || catMenu.mode !== "single") return undefined;
    const t = txById.get(catMenu.txId);
    return t?.description?.trim() || undefined;
  }, [catMenu, txById]);

  // ─── Jev (TypeSafe) — escopos oferecidos no diálogo "Categorizar com Jev" ───
  const jevScopes = useMemo<JevScope[]>(() => {
    const scopes: JevScope[] = [
      {
        id: "revisar",
        label: "A revisar no período",
        hint: "Lançamentos sem categoria ou marcados como “A revisar”.",
        ids: inPeriod.filter(isReview).map((t) => t.id),
      },
      {
        id: "periodo",
        label: "Todas do período",
        hint: "Recategoriza tudo do período — o Jev mostra onde discorda da categoria atual.",
        ids: inPeriod.map((t) => t.id),
      },
    ];
    const filtersActive =
      statusFilter !== "todas" || categoryFilter !== null || bankFilter !== null || query.trim() !== "";
    if (filtersActive) {
      scopes.push({
        id: "filtradas",
        label: "Filtro atual",
        hint: "Só o que aparece na lista com os filtros e a busca aplicados.",
        ids: filtered.map((t) => t.id),
      });
    }
    if (selected.size > 0) {
      scopes.push({
        id: "selecionadas",
        label: "Selecionadas",
        hint: "Os lançamentos marcados na lista.",
        ids: [...selected],
      });
    }
    return scopes;
  }, [inPeriod, filtered, selected, statusFilter, categoryFilter, bankFilter, query, revisarCategoryId]);

  // Transferências entre contas próprias + pagamentos de fatura: não são
  // receita nem despesa — o diálogo oferece pular por padrão.
  const jevInternalIds = useMemo(
    () => new Set([...internalTransferIds, ...billPaymentIds]),
    [internalTransferIds, billPaymentIds]
  );

  function openJev(preferred: JevScopeId) {
    const hasItems = (id: JevScopeId) => (jevScopes.find((s) => s.id === id)?.ids.length ?? 0) > 0;
    const scope = hasItems(preferred)
      ? preferred
      : jevScopes.find((s) => s.ids.length > 0)?.id ?? preferred;
    setJevInitialScope(scope);
    setJevOpen(true);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Transações</h1>
          <p className="text-muted-foreground">
            {transactions.length} lançamentos no total
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => openJev(reviewCount > 0 ? "revisar" : "periodo")}
            title="Categorizar lançamentos com o Jev (TypeSafe)"
          >
            <BrainCircuit className="h-4 w-4" />
            Categorizar com Jev
          </Button>
          <ImportDialog />
          <AddDialog categories={categories} accounts={accounts} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker
          from={period.from}
          to={period.to}
          today={today}
          onChange={(from, to) => handlePeriodChange(from, to)}
        />
        <GroupToggle value={groupMode} onChange={handleGroupModeChange} />
      </div>

      <PeriodSummaryStrip summary={summary} />

      <ReviewBacklog
        count={reviewCount}
        onApplyAll={handleApplyAllSuggestions}
        onCategorizeWithJev={() => openJev("revisar")}
        pending={pending}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips
          counts={statusCounts}
          categories={categories}
          categoryCounts={categoryCounts}
          activeStatus={statusFilter}
          activeCategory={categoryFilter}
          onStatus={handleStatusChange}
          onCategory={handleCategoryChange}
          banks={bankOptions}
          bankCounts={bankCounts}
          activeBank={bankFilter}
          onBank={handleBankChange}
        />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por descrição ou valor…"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          className="pl-9"
        />
        {query && (
          <button
            type="button"
            onClick={() => handleQueryChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Limpar busca"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {totalFilteredCount === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              Nenhuma transação encontrada.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={allVisibleSelected}
                  onClick={toggleSelectAllVisible}
                  className={cn(
                    "flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-[6px] border-[1.8px] border-input bg-background transition-colors hover:border-primary",
                    allVisibleSelected && "border-primary bg-primary"
                  )}
                  aria-label={allVisibleSelected ? "Desmarcar todos" : "Selecionar todos visíveis"}
                >
                  {allVisibleSelected && (
                    <svg viewBox="0 0 24 24" className="h-3 w-3 text-primary-foreground" fill="none" stroke="currentColor" strokeWidth={3.5}>
                      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <span className="text-xs font-semibold text-muted-foreground">
                  Selecionar todos os visíveis
                </span>
              </div>

              {groupMode === "data"
                ? visibleDateGroups.map((g) => (
                    <div key={g.dateISO}>
                      <div className="flex items-center justify-between bg-muted/40 px-4 py-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-bold">{g.label.primary}</span>
                          {g.label.secondary && (
                            <span className="text-xs text-muted-foreground">{g.label.secondary}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs font-semibold tabular-nums">
                          {g.income > 0 && (
                            <span className="text-success">+{formatBRLShort(g.income)}</span>
                          )}
                          {g.expense > 0 && (
                            <span className="text-destructive">−{formatBRLShort(g.expense)}</span>
                          )}
                        </div>
                      </div>
                      {g.items.map((t) => (
                        <TxRow
                          key={t.id}
                          tx={t}
                          category={t.categoryId ? catById.get(t.categoryId) : undefined}
                          accountName={t.accountId ? accountNameById.get(t.accountId) : undefined}
                          suggestion={suggestions[t.id]}
                          selected={selected.has(t.id)}
                          isInternalTransfer={internalIdSet.has(t.id)}
                          isCardPurchase={cardPurchaseIdSet.has(t.id)}
                          isPixOnCredit={pixNoCreditoIdSet.has(t.id)}
                          isBillPayment={billPaymentIdSet.has(t.id)}
                          showDate={false}
                          onToggleSelect={toggleSelect}
                          onOpenCatMenu={(anchor) => openSingleCatMenu(t.id, anchor)}
                          onAcceptSuggestion={handleAcceptSuggestion}
                        />
                      ))}
                    </div>
                  ))
                : visiblePayeeGroups.map((g) => (
                    <div key={g.payee}>
                      <div className="flex items-center gap-2.5 bg-muted/40 px-4 py-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                          {g.initials}
                        </span>
                        <span className="truncate text-sm font-bold">{g.payee}</span>
                        <span className="text-xs text-muted-foreground">
                          · {g.count} lançamento{g.count === 1 ? "" : "s"}
                        </span>
                        <span
                          className={cn(
                            "ml-auto text-xs font-semibold tabular-nums",
                            g.net >= 0 ? "text-success" : "text-destructive"
                          )}
                        >
                          {g.net >= 0 ? "+" : "−"}
                          {formatBRLShort(Math.abs(g.net))}
                        </span>
                      </div>
                      {g.items.map((t) => (
                        <TxRow
                          key={t.id}
                          tx={t}
                          category={t.categoryId ? catById.get(t.categoryId) : undefined}
                          accountName={t.accountId ? accountNameById.get(t.accountId) : undefined}
                          suggestion={suggestions[t.id]}
                          selected={selected.has(t.id)}
                          isInternalTransfer={internalIdSet.has(t.id)}
                          isCardPurchase={cardPurchaseIdSet.has(t.id)}
                          isPixOnCredit={pixNoCreditoIdSet.has(t.id)}
                          isBillPayment={billPaymentIdSet.has(t.id)}
                          showDate
                          onToggleSelect={toggleSelect}
                          onOpenCatMenu={(anchor) => openSingleCatMenu(t.id, anchor)}
                          onAcceptSuggestion={handleAcceptSuggestion}
                        />
                      ))}
                    </div>
                  ))}
            </>
          )}
        </CardContent>
      </Card>

      {shownCount < totalFilteredCount && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setVisible((v) => v + ROWS_PAGE_SIZE)}>
            Carregar mais ({totalFilteredCount - shownCount} restantes)
          </Button>
        </div>
      )}

      <CategoryMenu
        categories={menuCategories}
        suggestion={menuSuggestion}
        multiCount={catMenu?.mode === "bulk" ? selected.size : undefined}
        payeeName={menuPayeeName}
        onPick={handleBulkPick}
        onCreateRule={catMenu?.mode === "bulk" ? handleCreateRule : undefined}
        open={catMenu !== null}
        onClose={() => setCatMenu(null)}
        anchor={catMenu?.anchor ?? null}
      />

      <JevCategorizeDialog
        open={jevOpen}
        onOpenChange={setJevOpen}
        initialScope={jevInitialScope}
        scopes={jevScopes}
        configured={jevConfigured}
        transactionsById={txById}
        categories={categories}
        internalIds={jevInternalIds}
        onApplied={clearSelection}
      />

      <div ref={selectionBarRef}>
        <SelectionBar
          count={selected.size}
          sum={selectionSum}
          onCategorize={() => {
            // âncora: SelectionBar não repassa o elemento clicado, então
            // ancoramos no wrapper da própria barra (fixa no rodapé) —
            // o CategoryMenu já sabe inverter para cima quando não cabe
            // embaixo (ver useLayoutEffect em category-menu.tsx).
            openBulkCatMenu(selectionBarRef.current ?? document.body);
          }}
          onCategorizeWithJev={() => openJev("selecionadas")}
          onCreateRule={handleCreateRule}
          onMarkReviewed={handleBulkMarkReviewed}
          onDelete={handleBulkDelete}
          onClear={clearSelection}
        />
      </div>
    </div>
  );
}

/** Formata em BRL compacto para os totais de cada grupo (sem casas se inteiro redondo não é necessário — mantém padrão formatBRL). */
function formatBRLShort(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(value);
}

function AddDialog({
  categories,
  accounts,
}: {
  categories: Category[];
  accounts: Account[];
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"entrada" | "saida">("saida");
  const [categoryId, setCategoryId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const today = new Date().toISOString().slice(0, 10);
  const relevantCats = categories.filter((c) =>
    type === "entrada" ? c.kind === "receita" : c.kind === "despesa"
  );

  function onSubmit(formData: FormData) {
    setError(null);
    const amount = parseFloat(
      String(formData.get("amount")).replace(",", ".")
    );
    if (isNaN(amount) || amount <= 0) {
      setError("Informe um valor válido.");
      return;
    }
    startTransition(async () => {
      try {
        await addTransaction({
          date: String(formData.get("date")),
          amount,
          type,
          description: String(formData.get("description")),
          categoryId: categoryId || null,
          accountId: accountId || null,
        });
        setOpen(false);
        setCategoryId("");
        setAccountId("");
        showToast("Transação adicionada.", { variant: "success" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao salvar.";
        setError(msg);
        showToast(msg, { variant: "error" });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Nova transação
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova transação</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={type === "saida" ? "default" : "outline"}
              onClick={() => {
                setType("saida");
                setCategoryId("");
              }}
            >
              Saída
            </Button>
            <Button
              type="button"
              variant={type === "entrada" ? "default" : "outline"}
              onClick={() => {
                setType("entrada");
                setCategoryId("");
              }}
            >
              Entrada
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Input
              id="description"
              name="description"
              placeholder="Ex: Mercado, Salário…"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="amount">Valor (R$)</Label>
              <Input
                id="amount"
                name="amount"
                inputMode="decimal"
                placeholder="0,00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Data</Label>
              <Input id="date" name="date" type="date" defaultValue={today} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Categoria (opcional — o sistema sugere)</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Deixar o sistema categorizar" />
              </SelectTrigger>
              <SelectContent>
                {relevantCats.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {accounts.length > 0 && (
            <div className="space-y-2">
              <Label>Conta (opcional)</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar conta" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  function onImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      startTransition(async () => {
        try {
          const r = await importCSV(text);
          const parts = [`${r.inserted} importadas`];
          if (r.skipped > 0) parts.push(`${r.skipped} duplicadas ignoradas`);
          if (r.errors.length > 0) parts.push(`${r.errors.length} com erro`);
          setResult(parts.join(" · "));
          showToast(parts.join(" · "), { variant: "success" });
          if (fileRef.current) fileRef.current.value = "";
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Erro na importação.";
          setResult(msg);
          showToast(msg, { variant: "error" });
        }
      });
    };
    reader.readAsText(file, "utf-8");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="h-4 w-4" />
          Importar CSV
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar extrato (CSV)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Exporte o extrato do seu banco ou do Meu Pluggy em CSV. O sistema
            reconhece as colunas <strong>Data</strong>, <strong>Valor</strong> e{" "}
            <strong>Descrição</strong>, remove duplicatas e categoriza sozinho.
          </p>
          <Input ref={fileRef} type="file" accept=".csv,text/csv" />
          {result && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">{result}</p>
          )}
          <DialogFooter>
            <Button onClick={onImport} disabled={pending} className="w-full">
              {pending ? "Importando…" : "Importar"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
