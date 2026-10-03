// ─────────────────────────────────────────────────────────────
// Camada 1.1 — Conector Open Finance (Pluggy)
// Adaptador da fonte "Open Finance". Como os demais conectores
// (manual, importCSV), cospe RawTransaction[] no formato canonico —
// nada de Pluggy sobe daqui para cima. A busca/HTTP fica em
// src/lib/pluggy/client.ts; aqui e so o MAPEAMENTO puro.
//
// Diretriz do produto: "Todas as informacoes do retorno tem que
// salvar na tabela do banco de dados para depois servir de dados."
// Por isso este conector, alem de extrair os campos uteis (forma de
// pagamento, contraparte, merchant, categoria Pluggy), tambem
// propaga o payload INTEIRO em rawPayload — nada e descartado, mesmo
// campos sem coluna dedicada hoje.
// ─────────────────────────────────────────────────────────────
import type { RawTransaction } from "@/lib/types";
import { mapPluggyPaymentMethod } from "./payment-method";
import { extractPayeeName } from "./payee";

// ─── Formato de entrada (subset dos campos da Pluggy que usamos) ──
// So os campos consumidos pelo mapeamento. type e CREDIT (entrada de
// dinheiro) ou DEBIT (saida) na convencao da Pluggy. `[key: string]:
// unknown` aceita o restante do payload (descriptionRaw, balance,
// status, providerCode, operationType, etc.) sem forcar este arquivo
// a redeclarar o shape completo — ele so precisa nomear o que LE.
export interface PluggyDocumentNumber {
  type?: string;
  value?: string;
}

export interface PluggyPaymentParty {
  name?: string;
  documentNumber?: PluggyDocumentNumber;
  [key: string]: unknown;
}

export interface PluggyTransaction {
  id: string;
  accountId: string;
  amount: number;
  /** ISO ou Date serializada; o normalizador resolve o formato. */
  date: string;
  description: string;
  type: "CREDIT" | "DEBIT";
  category?: string | null;
  categoryId?: string | null;
  /** Tipo de operacao cru da Pluggy (PIX, RESGATE_APLIC_FINANCEIRA, OUTROS...). */
  operationType?: string | null;
  /** Estabelecimento (compras com cartão) — fonte do nome da contraparte. */
  merchant?: {
    name?: string;
    businessName?: string;
    document?: string;
    [key: string]: unknown;
  } | null;
  /** PIX/TED/DOC — payer/receiver, cada um com name + documentNumber estruturado. */
  paymentData?: {
    payer?: PluggyPaymentParty;
    receiver?: PluggyPaymentParty;
    /** forma de pagamento estruturada (ex "PIX", "OTHER", "DEBIT"). */
    paymentMethod?: string;
    [key: string]: unknown;
  } | null;
  /** presenca (nao conteudo) indica compra no cartao de credito. */
  creditCardMetadata?: Record<string, unknown> | null;
  /** status cru da Pluggy: POSTED (efetivado) ou PENDING (a compensar). */
  status?: string | null;
  /** cobre o restante do payload (descriptionRaw, balance, providerCode, etc.). */
  [key: string]: unknown;
}

/**
 * Extrai nome + documento da contraparte a partir dos campos
 * estruturados da Pluggy: para saída usa quem RECEBEU (paymentData.
 * receiver), para entrada usa quem ENVIOU (paymentData.payer). Sem
 * paymentData (compra de cartão, p.ex.), cai para merchant.name/
 * businessName.
 *
 * LIMITAÇÃO REAL da API (plano gratuito MeuPluggy): paymentData.
 * receiver/payer.name vem NULL na quase totalidade dos casos (~16 de
 * 278 amostrados TÊM nome) — mas .documentNumber.value (CPF/CNPJ)
 * costuma vir preenchido bem mais vezes (~105 de 278). Ou seja, a API
 * geralmente entrega o documento sem o nome. Por isso, quando o `name`
 * estruturado vier ausente/vazio, cai para extractPayeeName
 * (src/lib/engine/payee.ts) sobre a DESCRIÇÃO BRUTA da transação —
 * que costuma conter o nome em texto livre (ex.: "Transferência
 * Enviada|Maria Oliveira Santos") mesmo quando o campo estruturado
 * não veio. O documento estruturado (`document`), quando presente, é
 * SEMPRE preservado independente de de onde veio o nome — nunca é
 * substituído pelo fallback textual (que não extrai documento).
 */
function extractCounterparty(
  tx: PluggyTransaction,
  type: "entrada" | "saida"
): { name?: string; document?: string } {
  const side =
    type === "saida" ? tx.paymentData?.receiver : tx.paymentData?.payer;

  // documento estruturado: preferimos payer/receiver; sem eles, o do
  // merchant (compra de cartão). Preservado à parte do nome — o
  // fallback textual abaixo nunca despacha um documento.
  const document = side?.documentNumber?.value || tx.merchant?.document;

  if (side?.name && side.name.trim()) {
    return { name: side.name, document };
  }
  if (tx.merchant?.name || tx.merchant?.businessName) {
    return {
      name: tx.merchant.name || tx.merchant.businessName,
      document,
    };
  }

  // API não trouxe nome estruturado (nem payer/receiver nem
  // merchant): tenta extrair da descrição bruta (rawDescription) —
  // é onde o nome real costuma aparecer em texto livre neste plano
  // da API. Sem counterpartyName aqui (é exatamente o que falta),
  // então extractPayeeName cai direto para o parsing de texto.
  const fromText = extractPayeeName({
    rawDescription: tx.description,
    type,
  });
  if (fromText) {
    return { name: fromText, document };
  }

  return { document };
}

/**
 * Conector Open Finance: mapeia uma transacao da Pluggy para a
 * RawTransaction canonica. CREDIT => entrada, DEBIT => saida.
 * O externalId (tx.id) e propagado para dedupe/idempotencia (R3).
 *
 * Alem dos campos ja existentes (contraparte), agora extrai:
 *  - paymentMethod: via mapPluggyPaymentMethod (creditCardMetadata +
 *    paymentData.paymentMethod + operationType como fallback — ver
 *    src/lib/engine/payment-method.ts para o mapeamento completo).
 *  - operationType: cru, propagado sem transformação.
 *  - merchantName: merchant.name/businessName (distinto de
 *    counterpartyName — merchant é sempre estabelecimento).
 *  - pluggyCategory/pluggyCategoryId: taxonomia própria da Pluggy.
 *  - status: cru da Pluggy (POSTED/PENDING).
 *  - hasCreditCard: presença (não conteúdo) de creditCardMetadata —
 *    mesmo sinal usado por mapPluggyPaymentMethod, agora também
 *    persistido como coluna própria (ver migration 0008).
 *  - rawPayload: a transação Pluggy INTEIRA, sem pick de campos —
 *    fonte de verdade persistida em transactions.raw_payload.
 */
export function pluggyConnector(tx: PluggyTransaction): RawTransaction {
  const type = tx.type === "CREDIT" ? "entrada" : "saida";
  const counterparty = extractCounterparty(tx, type);
  const hasCreditCard = tx.creditCardMetadata != null;
  const paymentMethod = mapPluggyPaymentMethod({
    paymentMethod: tx.paymentData?.paymentMethod,
    hasCreditCardMetadata: hasCreditCard,
    operationType: tx.operationType,
    type: tx.type,
  });
  const merchantName = tx.merchant?.name || tx.merchant?.businessName || null;

  return {
    externalId: tx.id,
    date: tx.date,
    amount: tx.amount,
    type,
    description: tx.description,
    account: tx.accountId,
    origin: "open_finance",
    counterpartyName: counterparty.name,
    counterpartyDocument: counterparty.document,
    paymentMethod,
    operationType: tx.operationType ?? null,
    merchantName,
    pluggyCategory: tx.category ?? null,
    pluggyCategoryId: tx.categoryId ?? null,
    status: tx.status ?? null,
    hasCreditCard,
    rawPayload: tx,
  };
}

export function pluggyConnectorMany(txs: PluggyTransaction[]): RawTransaction[] {
  return txs.map(pluggyConnector);
}
