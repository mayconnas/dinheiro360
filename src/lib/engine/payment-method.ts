// ─────────────────────────────────────────────────────────────
// Forma de pagamento — duas fontes, em ordem de confiança:
//
// 1) mapPluggyPaymentMethod — mapeia o campo ESTRUTURADO que a API
//    Pluggy devolve (paymentData.paymentMethod / creditCardMetadata)
//    para o nosso enum. Fonte de verdade; usada no momento da sync
//    (src/lib/engine/pluggy.ts) e persistida em
//    transactions.payment_method (migration 0005).
//
// 2) inferPaymentMethod — heurística cosmética por palavras-chave
//    sobre rawDescription, para transações sem payment_method
//    persistido (manuais, CSV, ou sincronizadas antes da 0005).
//    PRECISÃO > cobertura: só classifica quando a pista é forte.
//    ~793 dos 1411 lançamentos atuais vieram de CSV pobre do Meu
//    Pluggy e genuinamente não têm nenhuma pista textual — para
//    esses o badge fica ausente (retorna null) até o usuário
//    reconectar via Open Finance, que é a solução real (fonte 1).
//
// Ambas puras, client-safe.
// ─────────────────────────────────────────────────────────────

export type PaymentMethod =
  | "pix"
  | "credito"
  | "debito"
  | "boleto"
  | "transferencia";

interface PaymentMethodMeta {
  label: string;
  /** cor neutra, compatível com badges do app (usada via style inline) */
  color: string;
}

export const PAYMENT_METHOD_META: Record<PaymentMethod, PaymentMethodMeta> = {
  pix: { label: "Pix", color: "#14B8A6" },
  credito: { label: "Crédito", color: "#7C3AED" },
  debito: { label: "Débito", color: "#2563EB" },
  boleto: { label: "Boleto", color: "#64748B" },
  transferencia: { label: "Transf.", color: "#0891B2" },
};

/** maiúsculo + sem acento, para comparação estável independente de fonte. */
function normalizeForMatch(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos (marcas de combinação)
    .toUpperCase();
}

// ─────────────────────────────────────────────────────────────
// Fonte 1 (confiável): mapeia o dado ESTRUTURADO da API Pluggy.
// ─────────────────────────────────────────────────────────────

export interface PluggyPaymentInfo {
  /** paymentData?.paymentMethod bruto da Pluggy (ex "PIX", "OTHER", "DEBIT"). */
  paymentMethod?: string | null;
  /** true quando a transação trouxe creditCardMetadata (fatura de cartão). */
  hasCreditCardMetadata?: boolean;
  /**
   * operationType cru da Pluggy (ex "PIX", "TED", "DOC",
   * "TRANSFERENCIA", "RESGATE_APLIC_FINANCEIRA", "OPERACAO_CREDITO",
   * "OUTROS"). Usado como segunda pista quando paymentMethod é "OTHER"
   * ou ausente — mais granular, mas também mais livre/inconsistente
   * entre bancos, por isso só entra depois de paymentMethod.
   */
  operationType?: string | null;
  /**
   * CREDIT/DEBIT da Pluggy = entrada/saída do extrato, NÃO forma de
   * pagamento. Aceito aqui só por completude da assinatura, mas
   * DELIBERADAMENTE não usado para chutar débito/crédito — ver nota
   * abaixo. Mantido opcional para não forçar call sites a passá-lo.
   */
  type?: "CREDIT" | "DEBIT";
}

/**
 * Mapeia o dado estruturado da Pluggy para o nosso enum. Baseado na
 * distribuição real observada (amostra de 291 transações): paymentMethod
 * PIX=37, OTHER=81, DEBIT=1, ausente=172; creditCardMetadata presente
 * em 184 (as compras de cartão). Ordem de decisão:
 *
 *  1. creditCardMetadata presente → sempre "credito" (é fatura de
 *     cartão de crédito, indiscutível — independe de paymentMethod).
 *  2. paymentData.paymentMethod estruturado:
 *       "PIX"                        → "pix"
 *       "DEBIT"                      → "debito"
 *       "BOLETO"                     → "boleto"
 *       "TED"/"DOC"/"TRANSFER"       → "transferencia"
 *       "OTHER" ou ausente           → cai pro passo 3 (não chuta)
 *  3. Sem pista de paymentMethod, tenta operationType (mais livre,
 *     mas ainda estruturado): "PIX" → pix; "TED"/"DOC"/
 *     "TRANSFERENCIA"/"TRANSFER" → transferencia; "BOLETO" → boleto.
 *     Operações de investimento (RESGATE_APLIC_FINANCEIRA,
 *     OPERACAO_CREDITO/DEBITO no sentido de aplicação, etc.) e
 *     "OUTROS" deliberadamente NÃO mapeiam para forma de pagamento —
 *     não é isso que esses rótulos significam.
 *  4. Nenhuma pista → null (melhor omitir o badge que errar).
 *
 * NÃO usa `type` (CREDIT/DEBIT do extrato) como fallback: esse campo
 * descreve entrada/saída do extrato bancário, não a forma de
 * pagamento — uma "entrada" (CREDIT) pode ser um PIX recebido, um
 * TED, um estorno... chutar "credito" ali seria inventar dado, o que
 * o produto pediu explicitamente para evitar.
 */
export function mapPluggyPaymentMethod(
  info: PluggyPaymentInfo
): PaymentMethod | null {
  if (info.hasCreditCardMetadata) return "credito";

  const method = normalizeForMatch(info.paymentMethod || "");
  if (method && method !== "OTHER") {
    if (method.includes("PIX")) return "pix";
    if (method.includes("BOLETO")) return "boleto";
    if (method === "DEBIT" || method.includes("DEBITO")) return "debito";
    if (
      hasWord(method, "TED") ||
      hasWord(method, "DOC") ||
      method.includes("TRANSFER") // cobre TRANSFER, TRANSFERENCIA, WIRE_TRANSFER etc.
    )
      return "transferencia";
  }

  // paymentMethod ausente ou "OTHER": tenta a segunda pista estruturada.
  const op = normalizeForMatch(info.operationType || "");
  if (op) {
    if (op.includes("PIX")) return "pix";
    if (op.includes("BOLETO")) return "boleto";
    if (hasWord(op, "TED") || hasWord(op, "DOC") || op.includes("TRANSFER"))
      return "transferencia";
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Fonte 2 (heurística): só para quando a fonte 1 não existe.
// ─────────────────────────────────────────────────────────────

/**
 * Heurística por palavras-chave sobre a descrição bruta (raw).
 * Retorna null quando não dá pra inferir com confiança — nesse caso
 * a UI simplesmente não mostra o badge (correto não mostrar errado).
 *
 * Case/acento-insensível: normaliza para MAIÚSCULO sem diacríticos
 * antes de comparar, então "Transferência", "TRANSFERENCIA" e
 * "transferência" batem igual.
 *
 * Deliberadamente NÃO classifica (retorna null):
 *  - "aplicação"/"resgate"/"rendimento" — são natureza de operação de
 *    investimento, não forma de pagamento.
 *  - "saque" — ambíguo (pode ser débito ou saque em espécie sem
 *    forma de pagamento associada); melhor omitir que errar.
 *  - bandeiras de cartão isoladas ("visa"/"master"/"elo") sem outra
 *    pista — aparecem tanto em débito quanto crédito, então por si
 *    só não classificam com confiança.
 */
/**
 * Sigla como palavra inteira: "DOC" casa "PIX/DOC" e "TED_DOC", mas não
 * "PADARIA DOCE"; "TED" não casa "ACCEPTED". Texto já em maiúsculas.
 */
function hasWord(text: string, w: string): boolean {
  return new RegExp(`(?<![A-Z0-9])${w}(?![A-Z0-9])`).test(text);
}

export function inferPaymentMethod(rawDescription: string): PaymentMethod | null {
  const s = normalizeForMatch(rawDescription);
  if (!s.trim()) return null;

  if (s.includes("PIX")) return "pix";
  if (s.includes("BOLETO")) return "boleto";
  if (
    hasWord(s, "TED") ||
    hasWord(s, "DOC") ||
    s.includes("TRANSFERENCIA") ||
    s.includes("TRANSFERENCIA ENVIADA") ||
    s.includes("TRANSFERENCIA RECEBIDA")
  )
    return "transferencia";
  if (
    s.includes("CARTAO DE CREDITO") ||
    s.includes("CARTAO DE CRÉDITO") ||
    s.includes("FATURA CARTAO") ||
    s.includes("FATURA DO CARTAO") ||
    s.includes("CREDITO")
  )
    return "credito";
  if (s.includes("CARTAO DE DEBITO") || s.includes("DEBITO")) return "debito";

  return null;
}

// ─────────────────────────────────────────────────────────────
// Resolução final para a UI: combina as duas fontes acima na ordem
// de confiança correta. Ponto único usado por qualquer componente
// que precise exibir o badge de forma de pagamento — evita que cada
// call site reimplemente o `??` (e evite regressão silenciosa se um
// novo local esquecer de checar o campo real primeiro).
// ─────────────────────────────────────────────────────────────

export interface PaymentMethodSource {
  /** transactions.payment_method já persistido (fonte 1, estruturada). */
  paymentMethod?: PaymentMethod | string | null;
  /** descrição bruta, usada só se paymentMethod estiver ausente (fonte 2). */
  rawDescription?: string | null;
}

/**
 * Forma de pagamento a exibir: o campo real persistido
 * (`payment_method`, preenchido pela sync/backfill a partir do dado
 * estruturado da Pluggy) quando existir; caso contrário cai para a
 * heurística por palavras-chave sobre `rawDescription`.
 */
export function resolvePaymentMethod(
  tx: PaymentMethodSource
): PaymentMethod | null {
  const real = tx.paymentMethod;
  if (real && real in PAYMENT_METHOD_META) {
    return real as PaymentMethod;
  }
  return inferPaymentMethod(tx.rawDescription ?? "");
}
