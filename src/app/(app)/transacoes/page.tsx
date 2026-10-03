import {
  getTransactions,
  getCategories,
  getAccounts,
} from "@/lib/data/repository";
import { getSuggestions } from "@/app/actions/transactions";
import { getJevStatus } from "@/app/actions/jev";
import { TransactionsView } from "@/components/transactions-view";
import {
  classifyTransactions,
  detectBillPayments,
  OWNER_DOCUMENTS,
  type ClassifyReason,
} from "@/lib/engine/transfers";
import { combinedExclusionIds } from "@/lib/transactions/view-helpers";

export default async function TransacoesPage() {
  // A lista de transações mostra o histórico completo, então NÃO limita
  // por data. Sugestões (itens "a revisar") são pré-calculadas aqui no
  // servidor e passadas por prop — evita um round-trip client (useEffect +
  // server action no mount) e o flash de "sem sugestão" no primeiro
  // render. Esse cálculo já roda de graça a cada revalidatePath('/transacoes')
  // disparado pelas mutações da tela.
  const [transactions, categories, accounts, suggestions, jevStatus] = await Promise.all([
    getTransactions(),
    getCategories(),
    getAccounts(),
    getSuggestions(),
    // Só o booleano "configurado" chega ao client (a chave nunca sai do servidor).
    getJevStatus(),
  ]);

  // Mesmo motor de regras usado no painel (ver src/lib/data/dashboard.ts
  // classifyTransactions) — para que o resumo do período aqui bata com os
  // KPIs do painel: regra do CPF (transferência entre contas próprias),
  // cartão=dívida, salário protegido, "valor adicionado"/fatura de cartão.
  // Antes desta troca a tela usava um detector antigo, só por nome/heurística
  // (internalTransferIds/detectInternalTransfers), que não sabia nada sobre
  // cartão=dívida nem sobre os casos especiais da Pluggy — os totais aqui
  // podiam divergir dos KPIs do painel. As transações continuam TODAS na
  // lista (nada some); só ganham a marcação visual e saem do resumo de
  // entradas/saídas.
  const accountKindById = new Map(accounts.map((a) => [a.id, a.kind]));
  const classification = classifyTransactions(transactions, {
    ownerDocuments: OWNER_DOCUMENTS,
    accountKindById,
  });
  function idsWithReason(reason: ClassifyReason): string[] {
    const out: string[] = [];
    for (const [id, r] of classification.reasons) {
      if (r === reason) out.push(id);
    }
    return out;
  }
  // "Entre contas" na TxRow cobre tanto a regra do CPF quanto a fatura/
  // estorno interno do cartão — os dois são "não é receita nem despesa,
  // é o próprio dinheiro/cartão do usuário circulando"; não há selo
  // dedicado para o 2º caso ainda, então cai no mesmo rótulo genérico.
  const internalTransferIds = [
    ...idsWithReason("entre_contas"),
    ...idsWithReason("fatura_ou_estorno_cartao"),
  ];

  // Pagamento de fatura, lado conta — a PONTE entre as duas visões (fluxo
  // de caixa x controle de gastos; ver src/lib/engine/transfers.ts, seção
  // "PAGAMENTO DE FATURA"). Continua contando como despesa no resumo do
  // período acima (é dinheiro real saindo — por isso NÃO entra em
  // `combinedExclusionIds`); só ganha o selo "Pagamento de fatura" na
  // TxRow, pra deixar claro que aquele valor já foi categorizado nas
  // compras do cartão que formaram a fatura, e não deve ser somado de
  // novo mentalmente ao olhar a lista.
  const billPaymentIds = [
    ...detectBillPayments(transactions, accountKindById).billPaymentCash,
  ];

  return (
    <TransactionsView
      transactions={transactions}
      categories={categories}
      accounts={accounts}
      suggestions={suggestions}
      internalTransferIds={internalTransferIds}
      cardPurchaseIds={[...classification.cardPurchase]}
      pixNoCreditoIds={idsWithReason("pix_no_credito")}
      billPaymentIds={billPaymentIds}
      excludedFromSummaryIds={[...combinedExclusionIds(classification)]}
      jevConfigured={jevStatus.data.configured}
    />
  );
}
