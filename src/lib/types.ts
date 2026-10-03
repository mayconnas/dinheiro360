// ─────────────────────────────────────────────────────────────
// Tipos de domínio — o "idioma" único que todas as camadas falam.
// A transação canônica (R1/R2) é a fronteira: nenhum dado bruto
// de fonte sobe daqui para cima.
// ─────────────────────────────────────────────────────────────

export type TransactionType = "entrada" | "saida";

export type TransactionOrigin = "manual" | "import" | "open_finance";

/**
 * Forma de pagamento REAL, vinda estruturada da API Pluggy — ver
 * src/lib/engine/payment-method.ts (tipo PaymentMethod +
 * mapPluggyPaymentMethod). Usa `string` aqui (não o enum estrito)
 * pra não criar dependência circular de src/lib/types.ts →
 * src/lib/engine/*; os valores possíveis são os mesmos
 * ('pix'|'credito'|'debito'|'boleto'|'transferencia'), garantidos
 * pelo CHECK da coluna (migration 0005). null/undefined = desconhecida
 * (a UI cai para a heurística inferPaymentMethod sobre rawDescription).
 */
export type PaymentMethodValue = string;

/** Formato canônico de uma transação (após ingestão + normalização). */
export interface Transaction {
  id: string;
  userId: string;
  /** ISO AAAA-MM-DD */
  date: string;
  /** sempre positivo; o sinal vive em `type` (R2) */
  amount: number;
  type: TransactionType;
  /** descrição limpa, pós-normalizador */
  description: string;
  /** descrição original da fonte, mantida para auditoria/aprendizado */
  rawDescription: string;
  categoryId: string | null;
  accountId: string | null;
  /** Destinatário/contraparte vinculado (gestor360.payees) — ver src/lib/engine/payee.ts */
  payeeId: string | null;
  /**
   * Forma de pagamento REAL vinda estruturada da API Pluggy (ver
   * PaymentMethodValue acima). null = desconhecida — a UI cai para a
   * heurística cosmética sobre rawDescription (inferPaymentMethod).
   */
  paymentMethod: PaymentMethodValue | null;
  /**
   * operationType cru da Pluggy (ex "PIX", "RESGATE_APLIC_FINANCEIRA",
   * "OPERACAO_CREDITO", "OUTROS"). null para origin != open_finance ou
   * quando a API não trouxe o campo.
   */
  operationType: string | null;
  /** Nome da contraparte desta transação específica (payer/receiver/merchant). */
  counterpartyName: string | null;
  /** CPF/CNPJ (apenas dígitos) da contraparte desta transação. */
  counterpartyDocument: string | null;
  /** merchant.name/businessName — presente em compras no cartão. */
  merchantName: string | null;
  /** category (texto) devolvido pela própria Pluggy. */
  pluggyCategory: string | null;
  /** categoryId (id estável da taxonomia) devolvido pela própria Pluggy. */
  pluggyCategoryId: string | null;
  /**
   * status cru da Pluggy: "POSTED" (efetivado) ou "PENDING" (a
   * compensar). null para origin != open_finance ou quando a API não
   * trouxe o campo. Ver migration 0008_more_payload_fields.sql.
   */
  status: string | null;
  /**
   * true quando o payload trouxe creditCardMetadata (transação é de
   * fatura de cartão de crédito). null para origin=manual/import ou
   * sincronizada antes desta coluna existir. Mesmo sinal usado por
   * mapPluggyPaymentMethod para decidir paymentMethod='credito'. Ver
   * migration 0008_more_payload_fields.sql.
   */
  hasCreditCard: boolean | null;
  /**
   * Payload COMPLETO da transação, exatamente como devolvido pela API
   * Pluggy (GET /v2/transactions) — fonte de verdade, nunca perde
   * campo mesmo que a API adicione algo sem termos coluna dedicada.
   * null para origin=manual/import. Ver migration 0006_pluggy_payload.sql.
   */
  rawPayload: unknown | null;
  origin: TransactionOrigin;
  /** marcada pelo deduplicador (R3) — não conta no saldo */
  isDuplicate: boolean;
  /** true quando o categorizador ainda não teve confiança */
  needsReview: boolean;
  createdAt: string;
}

/** Entrada crua de um conector, antes do normalizador. */
export interface RawTransaction {
  externalId?: string;
  date: string;
  /** pode vir negativo/positivo; o normalizador resolve o sinal */
  amount: number;
  type?: TransactionType;
  description: string;
  account?: string;
  origin: TransactionOrigin;
  /**
   * Nome da contraparte quando a fonte já entrega isso estruturado
   * (Pluggy paymentData.payer/receiver.name ou merchant.name/
   * businessName). Opcional — quando ausente, o extrator de payee
   * cai para parsing de `description`/rawDescription.
   */
  counterpartyName?: string;
  /** CPF/CNPJ da contraparte, quando a fonte estrutura isso (Pluggy). */
  counterpartyDocument?: string;
  /**
   * Forma de pagamento REAL vinda estruturada da fonte (Pluggy) — ver
   * PaymentMethodValue/mapPluggyPaymentMethod. undefined/null quando a
   * fonte não estrutura isso (manual, CSV).
   */
  paymentMethod?: PaymentMethodValue | null;
  /** operationType cru da Pluggy — ver Transaction.operationType acima. */
  operationType?: string | null;
  /** merchant.name/businessName — ver Transaction.merchantName acima. */
  merchantName?: string | null;
  /** category (texto) devolvido pela própria Pluggy. */
  pluggyCategory?: string | null;
  /** categoryId da taxonomia própria da Pluggy. */
  pluggyCategoryId?: string | null;
  /** status cru da Pluggy (POSTED/PENDING) — ver Transaction.status acima. */
  status?: string | null;
  /** presença de creditCardMetadata — ver Transaction.hasCreditCard acima. */
  hasCreditCard?: boolean | null;
  /** Payload COMPLETO da transação de origem — ver Transaction.rawPayload acima. */
  rawPayload?: unknown | null;
}

export type CategoryKind = "receita" | "despesa";

export type CategoryNature = "fixa" | "variavel" | "discricionaria" | "receita";

export interface Category {
  id: string;
  userId: string;
  name: string;
  kind: CategoryKind;
  /** classificação usada pelos indicadores de saúde (3.5) */
  nature: CategoryNature;
  color: string;
  isSystem: boolean;
  /**
   * Nó-pai no plano de contas (migration 0009). `null` = raiz.
   * Aditivo: todo código pré-existente que ignora este campo continua
   * tratando toda categoria como uma "folha solta" — correto, porque
   * uma categoria sem filhos SE COMPORTA como sempre se comportou.
   * Ver src/lib/engine/account-tree.ts para agregação hierárquica.
   */
  parentId: string | null;
  /** Ordem manual entre irmãos (mesmo parentId); nome é o desempate. */
  sortOrder: number;
  /** Código de conta contábil opcional (ex "3.1.2"), só decorativo. */
  code?: string | null;
}

export type AccountKind = "corrente" | "poupanca" | "carteira" | "investimento" | "cartao";

/** 'bank'|'credit'|'investment' — deriva do `type` da Pluggy (migration 0010). */
export type AccountType = "bank" | "credit" | "investment";

export interface Account {
  id: string;
  userId: string;
  name: string;
  kind: AccountKind;
  /** saldo inicial informado; o saldo real deriva das transações */
  openingBalance: number;
  /**
   * Saldo/dívida REAL da conta segundo a Pluggy (accounts.current_balance,
   * migration 0010) no momento do último sync. Conta BANK = saldo
   * disponível; conta CREDIT = dívida atual da fatura (positivo =
   * quanto se deve). Distinto de `openingBalance` (saldo inicial
   * manual). `null`/`undefined` = conta manual ou nunca sincronizada.
   */
  currentBalance?: number | null;
  /** Deriva do `type` da Pluggy — mais granular que `kind`. `null` para conta manual. */
  accountType?: AccountType | null;
  /**
   * Nome LIMPO do banco/emissor (ex "Mercado Pago", "Bradesco",
   * "Nubank") — ver src/lib/engine/bank-name.ts:cleanInstitution.
   * `null` para conta manual/nunca sincronizada.
   */
  institution?: string | null;
  /** Limite total do cartão (creditData.creditLimit). `null` se não for cartão. */
  creditLimit?: number | null;
  /** Limite disponível do cartão (creditData.availableCreditLimit). `null` se não for cartão. */
  creditAvailable?: number | null;
  /** Valor mínimo da fatura atual (creditData.minimumPayment). `null` se não for cartão. */
  creditMinimumPayment?: number | null;
  /** Data de vencimento da fatura atual (creditData.balanceDueDate), ISO AAAA-MM-DD. `null` se não for cartão. */
  creditDueDate?: string | null;
  /** Bandeira do cartão (creditData.brand, ex "VISA"/"MASTERCARD"). `null` se não for cartão. */
  cardBrand?: string | null;
  /** Últimos 4 dígitos do cartão, derivados de `number`. `null` se não for cartão. */
  cardLast4?: string | null;
  /** Número bruto da Pluggy: agência/conta (banco) ou dígitos do cartão. `null` para conta manual. */
  number?: string | null;
  /** Nome do titular da conta segundo a Pluggy. `null` para conta manual. */
  owner?: string | null;
}

export interface Budget {
  id: string;
  userId: string;
  categoryId: string;
  /** teto mensal em R$ */
  limit: number;
}

export type GoalStatus = "no_ritmo" | "atrasada" | "concluida";

export interface Goal {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  /** ISO AAAA-MM-DD ou null */
  deadline: string | null;
}

export type EmploymentType = "clt" | "autonomo" | "misto";

export interface Profile {
  userId: string;
  displayName: string | null;
  monthlyIncome: number;
  employmentType: EmploymentType;
  dependents: number;
  /** escada de prioridades configurável (4 / modelo de decisão) */
  priorityLadder: string[];
}

/**
 * Regra de categorização aprendida (R4/R5). Precedência:
 * regra do usuário → memória → dicionário → "a revisar".
 */
export interface CategoryRule {
  id: string;
  userId: string;
  /** substring, case-insensitive, aplicada sobre a descrição */
  pattern: string;
  categoryId: string;
  /** manual = criada pelo usuário; learned = derivada de correção */
  source: "manual" | "learned";
}
