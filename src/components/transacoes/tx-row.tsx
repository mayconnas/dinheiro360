"use client";

import { ArrowLeftRight, Banknote, Building2, Check, ChevronDown, CreditCard, MoreHorizontal, Receipt, Sparkles, Tag, User, Zap } from "lucide-react";
import { cn, formatBRL, formatDate } from "@/lib/utils";
import { resolvePaymentMethod, PAYMENT_METHOD_META, type PaymentMethod } from "@/lib/engine/payment-method";
import type { Category, Transaction } from "@/lib/types";

export interface TxRowSuggestion {
  categoryId: string;
  categoryName: string;
}

export interface TxRowProps {
  tx: Transaction;
  /** Categoria atual da transação (undefined se categoryId é null ou não encontrada). */
  category?: Category;
  /** Nome da conta/banco (accounts.name), resolvido pelo chamador via Map accountId->name. */
  accountName?: string;
  /** Sugestão computada (via computeSuggestions / getSuggestions) para itens a revisar. */
  suggestion?: TxRowSuggestion;
  selected: boolean;
  /**
   * true quando o detector identificou esta transação como transferência
   * entre contas do próprio usuário — regra do CPF (counterpartyDocument
   * == CPF do dono; ver classifyTransactions em
   * src/lib/engine/transfers.ts) — não é receita nem despesa, o mesmo
   * dinheiro circulando. A transação continua na lista normalmente; só
   * ganha o selo "Entre contas" e já saiu do resumo de entradas/saídas
   * calculado por quem chama TxRow.
   */
  isInternalTransfer?: boolean;
  /**
   * true quando é uma COMPRA numa conta de cartão de crédito
   * (classifyTransactions, motivo "compra_no_cartao") — é DÍVIDA
   * acumulando, não despesa no fluxo de caixa; só vira despesa quando a
   * fatura é paga. Ganha o selo "No cartão" e já saiu da despesa do
   * resumo calculado por quem chama TxRow.
   */
  isCardPurchase?: boolean;
  /**
   * true quando é a entrada "Valor Adicionado na Conta" (feature Pix no
   * crédito da Pluggy; classifyTransactions, motivo "pix_no_credito") — é
   * só financiamento (crédito liberado), não é receita real. Ganha o selo
   * "Pix no crédito" e já saiu da receita do resumo calculado por quem
   * chama TxRow.
   */
  isPixOnCredit?: boolean;
  /**
   * true quando é o PAGAMENTO DE FATURA visto do lado da conta (a saída
   * que de fato manda o dinheiro pra pagar o cartão; classifyForViews,
   * motivo "pagamento_fatura_conta" — ver src/lib/engine/transfers.ts,
   * seção "PAGAMENTO DE FATURA — a PONTE"). Conta como despesa no FLUXO
   * DE CAIXA (dinheiro saiu de verdade) mas NÃO no CONTROLE DE GASTOS —
   * as compras que formaram a fatura já foram contadas uma a uma quando
   * aconteceram (marcadas "No cartão"); contar a fatura de novo dobraria
   * o gasto. Ganha o selo "Pagamento de fatura".
   */
  isBillPayment?: boolean;
  /** Mostra a data na linha secundária — usado no agrupamento "Por destinatário". */
  showDate: boolean;
  onToggleSelect: (id: string) => void;
  /** Dispara a abertura do popover/menu de categoria; o chamador decide onde ancorar. */
  onOpenCatMenu: (anchorEl: HTMLElement) => void;
  onAcceptSuggestion: (id: string, categoryId: string) => void;
}

/**
 * CPF/CNPJ mascarado pra exibição discreta na linha (ex CPF "065.***.***-**"
 * ou CNPJ com os 2 primeiros dígitos + asteriscos) — mostra só o suficiente
 * pra reconhecer, sem expor o documento completo numa lista densa.
 * Documentos com formato inesperado (nem 11 nem 14 dígitos) voltam null e
 * a UI simplesmente omite o CPF/CNPJ.
 */
function maskDocument(doc: string): string | null {
  const digits = doc.replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.***.***-**`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.***.***/****-**`;
  }
  return null;
}

/** Cor neutra usada para o "quadrado" de ícone e edge quando a transação está a revisar. */
const REVIEW_COLOR = "#D97706"; // token warning

export function TxRow({
  tx,
  category,
  accountName,
  suggestion,
  selected,
  isInternalTransfer = false,
  isCardPurchase = false,
  isPixOnCredit = false,
  isBillPayment = false,
  showDate,
  onToggleSelect,
  onOpenCatMenu,
  onAcceptSuggestion,
}: TxRowProps) {
  const needsReview = tx.needsReview || !category;
  const edgeColor = needsReview ? REVIEW_COLOR : category?.color ?? "#94a3b8";
  const catoColor = needsReview ? REVIEW_COLOR : category?.color ?? "#94a3b8";

  // Fonte 1 (confiável): payment_method REAL, vindo estruturado da API
  // Pluggy (ver src/lib/engine/payment-method.ts). Só cai para a
  // heurística cosmética sobre rawDescription quando a transação não
  // tem o dado real persistido (manual/CSV, ou sync anterior à 0005/
  // 0006 — resolvido pelo botão "Reprocessar dados do Open Finance"
  // em Conexões).
  const method = resolvePaymentMethod(tx);
  const methodMeta = method && method in PAYMENT_METHOD_META ? PAYMENT_METHOD_META[method as PaymentMethod] : null;

  const isIncome = tx.type === "entrada";

  // Remetente/contraparte: nome real (payer/receiver/merchant da Pluggy,
  // ou extraído do texto da descrição — ver extractCounterparty em
  // src/lib/engine/pluggy.ts) + CPF/CNPJ mascarado quando houver. Em
  // transações sem esse dado (antigas, manuais), simplesmente omite —
  // sem "—" poluindo a linha.
  const counterpartyName = tx.counterpartyName?.trim() || null;
  const counterpartyDoc = tx.counterpartyDocument ? maskDocument(tx.counterpartyDocument) : null;

  return (
    <div
      data-id={tx.id}
      className={cn(
        "group relative flex items-center gap-3.5 border-b border-border py-3 pl-0 pr-4 transition-colors last:border-b-0 hover:bg-muted/40",
        selected && "bg-primary/5"
      )}
    >
      {/* edge colorido */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] rounded-r-sm"
        style={{ background: edgeColor }}
      />

      {/* checkbox de seleção */}
      <div className="pl-4">
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? "Desmarcar transação" : "Selecionar transação"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(tx.id);
          }}
          className={cn(
            "flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-[6px] border-[1.8px] border-input bg-background transition-colors hover:border-primary",
            selected && "border-primary bg-primary"
          )}
        >
          {selected && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3.5} />}
        </button>
      </div>

      {/* quadrado de categoria */}
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] text-white"
        style={{ background: catoColor }}
      >
        {needsReview ? (
          <Sparkles className="h-4.5 w-4.5" strokeWidth={2} />
        ) : (
          <Tag className="h-4.5 w-4.5" strokeWidth={2} />
        )}
      </div>

      {/* nome + linha secundária */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="truncate">{tx.description}</span>
          {tx.origin !== "manual" && (
            <span
              title={tx.origin === "import" ? "Importado" : "Open Finance"}
              className="shrink-0 text-muted-foreground/70"
            >
              <Zap className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
          )}
          {isInternalTransfer && (
            <span
              title="Transferência entre contas próprias — não conta como receita nem despesa"
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
            >
              <ArrowLeftRight className="h-3 w-3" strokeWidth={2.4} />
              Entre contas
            </span>
          )}
          {isCardPurchase && (
            <span
              title="Compra no cartão de crédito — conta no controle de gastos (categorizada); não é despesa de fluxo de caixa até a fatura ser paga"
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
            >
              <CreditCard className="h-3 w-3" strokeWidth={2.4} />
              No cartão
            </span>
          )}
          {isBillPayment && (
            <span
              title="Pagamento de fatura — dinheiro saiu de verdade (conta no fluxo de caixa), mas as compras que formaram a fatura já foram contadas uma a uma (não conta de novo no controle de gastos)"
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
            >
              <Receipt className="h-3 w-3" strokeWidth={2.4} />
              Pagamento de fatura
            </span>
          )}
          {isPixOnCredit && (
            <span
              title="Valor adicionado na conta (Pix no crédito) — é financiamento, não receita"
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
            >
              <Banknote className="h-3 w-3" strokeWidth={2.4} />
              Pix no crédito
            </span>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground/80">
          {methodMeta && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{
                background: `${methodMeta.color}1F`,
                color: methodMeta.color,
              }}
            >
              {methodMeta.label}
            </span>
          )}
          {accountName && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground/70">
              <Building2 className="h-3 w-3" strokeWidth={2.2} />
              {accountName}
            </span>
          )}
          {counterpartyName && (
            <span className="inline-flex min-w-0 shrink-0 items-center gap-0.5 text-muted-foreground/70">
              <User className="h-3 w-3 shrink-0" strokeWidth={2.2} />
              <span className="max-w-[160px] truncate">{counterpartyName}</span>
              {counterpartyDoc && (
                <span className="whitespace-nowrap text-muted-foreground/50">
                  · {tx.counterpartyDocument?.replace(/\D/g, "").length === 14 ? "CNPJ" : "CPF"} {counterpartyDoc}
                </span>
              )}
            </span>
          )}
          <span className="min-w-0 truncate">
            {showDate && (
              <span className="font-semibold text-muted-foreground">
                {formatDate(tx.date)} ·{" "}
              </span>
            )}
            {tx.rawDescription}
          </span>
        </div>
      </div>

      {/* controle de categoria */}
      <div className="flex shrink-0 items-center gap-1.5">
        {category ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenCatMenu(e.currentTarget);
            }}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-[filter] hover:brightness-95"
            style={{ background: `${category.color}1F`, color: category.color }}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: category.color }}
            />
            {category.name}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </button>
        ) : suggestion ? (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenCatMenu(e.currentTarget);
              }}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] border-dashed border-warning px-3 py-1.5 text-[12.5px] font-semibold text-warning"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {suggestion.categoryName}?
              <ChevronDown className="h-3 w-3 opacity-50" />
            </button>
            <button
              type="button"
              title="Aceitar sugestão"
              onClick={(e) => {
                e.stopPropagation();
                onAcceptSuggestion(tx.id, suggestion.categoryId);
              }}
              className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-success text-success-foreground shadow-sm transition-transform hover:scale-105"
            >
              <Check className="h-4 w-4" strokeWidth={3} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenCatMenu(e.currentTarget);
            }}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-muted px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground"
          >
            <Tag className="h-3.5 w-3.5" />
            Categorizar
            <ChevronDown className="h-3 w-3 opacity-50" />
          </button>
        )}
      </div>

      {/* valor */}
      <div
        className={cn(
          "w-28 shrink-0 text-right text-[14.5px] font-bold tabular",
          isIncome ? "text-success" : "text-foreground"
        )}
      >
        {isIncome ? "+" : "−"}
        {formatBRL(tx.amount)}
      </div>

      {/* mais opções */}
      <button
        type="button"
        aria-label="Mais opções"
        onClick={(e) => {
          e.stopPropagation();
          onOpenCatMenu(e.currentTarget);
        }}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
