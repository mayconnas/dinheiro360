// ─────────────────────────────────────────────────────────────
// Cliente REST da Pluggy — Open Finance (Fase 4)
// Roda SOMENTE no servidor. Fala direto com a API da Pluggy via
// fetch (sem SDK). Fluxo de auth: POST /auth (clientId+clientSecret)
// devolve uma apiKey valida por ~2h; ela vai no header X-API-KEY
// das chamadas seguintes. Cacheamos a apiKey em memoria do modulo e
// renovamos quando faltam <5min do vencimento.
// ─────────────────────────────────────────────────────────────
import "server-only";

const BASE_URL = process.env.PLUGGY_API_URL || "https://api.pluggy.ai";

// apiKey da Pluggy dura ~2h. Guardamos com uma margem de seguranca.
const API_KEY_TTL_MS = 2 * 60 * 60 * 1000; // 2h
const RENEW_MARGIN_MS = 5 * 60 * 1000; // renova faltando <5min

// ─── Tipos internos (subset dos campos da Pluggy que usamos) ─────
/**
 * GET /accounts. `type` é 'BANK'|'CREDIT'|'INVESTMENT' (a Pluggy pode
 * devolver outros no futuro; tratamos como string livre, ver
 * src/lib/engine/bank-name.ts). `subtype` refina dentro do type (ex
 * 'CHECKING_ACCOUNT'|'SAVINGS_ACCOUNT' p/ BANK, 'CREDIT_CARD' p/
 * CREDIT). `balance` é o saldo real (BANK) ou a dívida atual da
 * fatura (CREDIT, positivo = quanto se deve) — fonte de verdade
 * externa, gravada em accounts.current_balance (migration 0010).
 */
export interface PluggyAccount {
  id: string;
  itemId: string;
  type: string;
  subtype: string;
  name: string;
  marketingName?: string;
  /** agência/conta (BANK) ou dígitos identificadores do cartão (CREDIT). */
  number: string;
  balance: number;
  currencyCode: string;
  /** nome do titular da conta segundo a Pluggy. */
  owner?: string;
  /** CPF/CNPJ do titular (dígitos, com ou sem pontuação conforme a API). */
  taxNumber?: string;
  /**
   * Dados bancários da conta. `transferNumber` começa com o código
   * COMPE do banco (3 primeiros dígitos — ex "323..." = Mercado Pago,
   * "237..." = Bradesco, "260..." = Nubank), a fonte MAIS confiável
   * para identificar a instituição (ver bank-name.ts:cleanInstitution).
   * `closingBalance` é o saldo no fechamento do último período, quando
   * a Pluggy o fornece.
   */
  bankData?: {
    transferNumber?: string | null;
    closingBalance?: number | null;
    [key: string]: unknown;
  } | null;
  /**
   * Presente só para contas CREDIT (cartão de crédito) — a dívida/
   * limite do cartão, ponto de partida do "o que DEVO" do Painel 360.
   */
  creditData?: {
    creditLimit?: number | null;
    availableCreditLimit?: number | null;
    minimumPayment?: number | null;
    /** data de vencimento da fatura atual, ISO. */
    balanceDueDate?: string | null;
    /** bandeira do cartão (ex "VISA","MASTERCARD"). */
    brand?: string | null;
    [key: string]: unknown;
  } | null;
}

/**
 * Documento de uma pessoa/empresa no formato estruturado que a Pluggy
 * usa dentro de paymentData.payer/receiver.documentNumber — NÃO é uma
 * string solta. `type` é "CPF"|"CNPJ" (ou outro valor da API); `value`
 * é os dígitos do documento.
 */
export interface PluggyDocumentNumber {
  type?: string;
  value?: string;
}

export interface PluggyPaymentParty {
  name?: string;
  documentNumber?: PluggyDocumentNumber;
  accountNumber?: string;
  branchNumber?: string;
  bankName?: string;
  bankIspb?: string;
  routingNumber?: string;
  routingNumberISPB?: string;
  accountType?: string;
  [key: string]: unknown;
}

/**
 * Payload COMPLETO de uma transação em GET /v2/transactions. O
 * objetivo aqui é NÃO descartar nenhum campo que a API devolve — a
 * transação inteira é persistida como está em `raw_payload` (ver
 * migration 0006_pluggy_payload.sql), então o fetch precisa trazer
 * tudo, mesmo campos que hoje não temos coluna própria para (por
 * isso o index signature `[key: string]: unknown` no final: cobre
 * qualquer campo novo que a Pluggy adicionar no futuro sem quebrar
 * o parse).
 */
export interface PluggyTransaction {
  id: string;
  accountId: string;
  amount: number;
  /** valor convertido pra moeda da conta, quando difere de `amount`. */
  amountInAccountCurrency?: number | null;
  date: string;
  description: string;
  /** descrição bruta, antes de qualquer normalização da própria Pluggy. */
  descriptionRaw?: string | null;
  type: "CREDIT" | "DEBIT";
  currencyCode: string;
  category: string | null;
  categoryId?: string | null;
  /** saldo da conta logo após esta transação, quando disponível. */
  balance?: number | null;
  /** status de liquidação ("POSTED", "PENDING", etc.). */
  status?: string | null;
  /** código do provedor bancário para esta transação específica. */
  providerCode?: string | null;
  providerId?: string | null;
  /** número de ordem/sequência dentro do extrato, quando fornecido. */
  order?: number | null;
  /**
   * Tipo de operação bancária, cru da Pluggy (ex "PIX",
   * "RESGATE_APLIC_FINANCEIRA", "OPERACAO_CREDITO", "OUTROS"). Mais
   * granular que `paymentData.paymentMethod` — usado para extrair
   * operation_type (ver src/lib/engine/pluggy.ts).
   */
  operationType?: string | null;
  operationTypeAdditionalInfo?: string | null;
  /**
   * Presente em compras com estabelecimento identificado (cartão).
   * Fonte mais confiável do nome da contraparte quando não é PIX/TED.
   */
  merchant?: {
    name?: string;
    businessName?: string;
    document?: string;
    [key: string]: unknown;
  } | null;
  /**
   * Presente em PIX/TED/DOC — payer (quem enviou) e receiver (quem
   * recebeu). Cada lado traz name + documentNumber (CPF/CNPJ,
   * estruturado como {type,value}) quando disponível. É a fonte mais
   * confiável do nome da contraparte: não depende de parsing de string.
   *
   * `paymentMethod` é a forma de pagamento REAL e ESTRUTURADA que a
   * Pluggy identificou (ex "PIX", "TED", "DOC", "BOLETO", "TRANSFER",
   * "OTHER") — a fonte de verdade para o badge, em vez da heurística
   * por palavras-chave sobre `description` (ver src/lib/engine/
   * payment-method.ts:mapPluggyPaymentMethod).
   */
  paymentData?: {
    payer?: PluggyPaymentParty;
    receiver?: PluggyPaymentParty;
    paymentMethod?: string;
    reason?: string;
    receiverReferenceId?: string;
    referenceNumber?: string;
    boletoMetadata?: Record<string, unknown> | null;
    [key: string]: unknown;
  } | null;
  /**
   * Presente quando a transação é de FATURA DE CARTÃO DE CRÉDITO.
   * Só a presença do campo (não seu conteúdo) já indica "crédito" —
   * não confundir com `type` (CREDIT/DEBIT), que é entrada/saída do
   * extrato, não forma de pagamento. Conteúdo tipado como bag
   * genérico: variam por bandeira/emissor e não descartamos nada.
   */
  creditCardMetadata?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  /** cobre qualquer campo novo que a API adicionar sem coluna dedicada. */
  [key: string]: unknown;
}

export interface PluggyItem {
  id: string;
  connector: { id: number; name: string };
  status: string;
  executionStatus: string;
  consentExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PageResponse<T> {
  results: T[];
  page: number;
  total: number;
  totalPages: number;
}

export interface CreateConnectTokenOptions {
  /** id do usuario no nosso app — a Pluggy propaga no webhook. */
  clientUserId?: string;
  /** URL que a Pluggy chama nos eventos deste item. */
  webhookUrl?: string;
  /** para reconexao/atualizacao de um item existente. */
  itemId?: string;
}

/**
 * connectorId do conector "MeuPluggy" (id=200, isSandbox=false,
 * type=PERSONAL_BANK). É o proxy GRATUITO dos bancos que o usuário já
 * conectou em meu.pluggy.ai — não exige o acesso pago a "dados reais".
 * NOTA: o filtro de conectores vai no WIDGET (prop connectorIds), NÃO
 * no /connect_token (que só aceita clientUserId/webhookUrl/itemId).
 */
export const MEU_PLUGGY_CONNECTOR_ID = 200;

export interface GetTransactionsOptions {
  /**
   * Filtra pelo tempo de INGESTÃO da Pluggy (createdAtFrom), não pela data
   * da transação. Isso é o que o Securo faz — usar `from`/`dateFrom` (data
   * da transação) perde lançamentos backdated (fatura de cartão datada no
   * fechamento, merchants que liquidam semanas depois). ISO AAAA-MM-DD.
   */
  createdAtFrom?: string;
}

// ─── Cache da apiKey em memoria do modulo ────────────────────────
let cachedApiKey: string | null = null;
let cachedApiKeyExpiresAt = 0;

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET não configuradas. " +
        "Adicione ao seu .env.local (obtenha em meu.pluggy.ai)."
    );
  }
  return { clientId, clientSecret };
}

/**
 * Devolve uma apiKey valida, renovando via POST /auth quando o cache
 * expirou ou esta perto de expirar. clientId/clientSecret -> apiKey.
 */
export async function getApiKey(): Promise<string> {
  const now = Date.now();
  if (cachedApiKey && now < cachedApiKeyExpiresAt - RENEW_MARGIN_MS) {
    return cachedApiKey;
  }

  const { clientId, clientSecret } = getCredentials();
  const res = await fetch(`${BASE_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!res.ok) {
    throw new Error(
      `Pluggy /auth falhou (${res.status}): ${await safeBody(res)}`
    );
  }
  const data = (await res.json()) as { apiKey: string };
  cachedApiKey = data.apiKey;
  cachedApiKeyExpiresAt = now + API_KEY_TTL_MS;
  return cachedApiKey;
}

/** fetch autenticado (injeta X-API-KEY) com tratamento de erro uniforme. */
async function pluggyFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const apiKey = await getApiKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    throw new Error(
      `Pluggy ${init.method || "GET"} ${path} falhou (${res.status}): ${await safeBody(res)}`
    );
  }
  return (await res.json()) as T;
}

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<sem corpo>";
  }
}

/**
 * POST /connect_token — token de curta duracao para abrir o widget
 * Pluggy Connect no cliente. Devolve accessToken.
 */
export async function createConnectToken(
  opts: CreateConnectTokenOptions = {}
): Promise<string> {
  const { itemId, ...options } = opts;
  const body: Record<string, unknown> = { options };
  if (itemId) body.itemId = itemId;

  const data = await pluggyFetch<{ accessToken: string }>("/connect_token", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data.accessToken;
}

/** GET /items/{id} — estado da conexao (status, consentimento, etc.). */
export async function getItem(itemId: string): Promise<PluggyItem> {
  return pluggyFetch<PluggyItem>(`/items/${encodeURIComponent(itemId)}`);
}

/** GET /accounts?itemId= — contas de um item. */
export async function getAccounts(itemId: string): Promise<PluggyAccount[]> {
  const data = await pluggyFetch<PageResponse<PluggyAccount>>(
    `/accounts?itemId=${encodeURIComponent(itemId)}`
  );
  return data.results;
}

/** Resposta do /v2/transactions: paginacao por CURSOR. */
interface CursorResponse<T> {
  results: T[];
  /** query string pronta da proxima pagina (ex "?accountId=..&after=..") ou null */
  next: string | null;
}

/**
 * GET /v2/transactions?accountId= — transacoes de uma conta, com
 * paginacao por CURSOR (o /transactions antigo por `page` foi
 * DESATIVADO pela Pluggy, retorna 410). Percorre todas as paginas
 * seguindo o campo `next` ate ele vir null.
 */
export async function getTransactions(
  accountId: string,
  opts: GetTransactionsOptions = {}
): Promise<PluggyTransaction[]> {
  // primeira pagina: monta a query; as seguintes usam o `next` retornado.
  // O /v2/transactions só aceita accountId, createdAtFrom, to (e o cursor
  // `after`). Enviar `pageSize` ou `from` retorna 400
  // ("property X should not exist"). Páginas são fixas de 500.
  const first = new URLSearchParams();
  first.set("accountId", accountId);
  if (opts.createdAtFrom) first.set("createdAtFrom", opts.createdAtFrom);

  const all: PluggyTransaction[] = [];
  let query: string | null = `?${first.toString()}`;

  while (query) {
    const data: CursorResponse<PluggyTransaction> = await pluggyFetch<
      CursorResponse<PluggyTransaction>
    >(`/v2/transactions${query}`);
    all.push(...data.results);
    // `next` ja vem como query string pronta (com o cursor `after`).
    query = data.next ?? null;
  }

  return all;
}

/** DELETE /items/{id} — remove a conexao (revoga consentimento). */
export async function deleteItem(itemId: string): Promise<void> {
  await pluggyFetch<unknown>(`/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
}
