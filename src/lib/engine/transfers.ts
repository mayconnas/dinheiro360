// ─────────────────────────────────────────────────────────────
// Camada 2.3 — Detector de Transferência Interna
//
// Problema: quando o usuário move dinheiro ENTRE contas próprias
// (ex: da conta-salário pra corrente, ou um Pix pra si mesmo), a
// ingestão gera UMA SAÍDA (conta origem) + UMA ENTRADA (conta
// destino). Não é receita nem despesa — é o mesmo dinheiro
// circulando — mas o motor de hoje (aggregate.monthTotals) soma as
// duas pontas em income/expense, inflando os KPIs.
//
// Este módulo é só o DETECTOR: dado o array de transações, devolve
// o Set<transactionId> das que são transferência interna. Não
// decide sozinho o que fazer com elas — quem chama (aggregate,
// indicators, projection, dashboard) decide excluí-las de
// receita/despesa mas MANTÊ-LAS no extrato (helpers no fim do
// arquivo fazem isso).
//
// Puro, sem IO. Testável isoladamente.
//
// ─────────────────────────────────────────────────────────────
// Critérios (cada um pode marcar uma transação sozinho — union, não
// precisa combinar todos). Em ordem de confiança:
//
//  (b) operationType === "TRANSFERENCIA_MESMA_INSTITUICAO"
//      Confiança: MUITO ALTA. É o próprio provedor (Pluggy/banco)
//      dizendo que a movimentação é entre contas da mesma
//      instituição — o caso mais inequívoco de transferência interna
//      (ainda que tecnicamente pudesse ser para terceiro na mesma
//      instituição; na prática, combinado com o restante da conta do
//      usuário, é o sinal mais forte disponível).
//
//  (c) operationType === "FOLHA_PAGAMENTO" MAS com texto de
//      auto-transferência do saldo (ex: "Transf Saldo C/sal P/cc",
//      "transferencia c/salario", "c/sal p/cc") na description ou
//      rawDescription.
//      Confiança: ALTA. Distinção crítica documentada abaixo.
//
//  (d) contraparte (counterpartyName) normalizada bate com algum dos
//      `ownerNames` (o próprio usuário) passados por parâmetro.
//      Confiança: ALTA quando há counterpartyName estruturado (vindo
//      da Pluggy — não é parsing de texto livre ambíguo).
//
//  (a) PAR CASADO: uma SAÍDA (conta X) e uma ENTRADA (conta Y, Y≠X,
//      ambas do usuário, ambas em `accountIds`) com o MESMO amount
//      exato, datas a até 2 dias de distância, E ambas com "cara de
//      transferência" (operationType/paymentMethod = pix/
//      transferencia OU texto com "transf"/"rem "/"ted"/"doc").
//      Confiança: ALTA quando casa 1-para-1; para evitar casar
//      coincidências (duas compras de mesmo valor em dias próximos),
//      exige o sinal de transferência OU pix como forma de pagamento
//      — nunca casa só por "mesmo valor, janela curta".
//
// ── (c) distinção salário real vs. auto-transferência do salário ──
// O DEPÓSITO do salário (dinheiro entrando vindo do empregador) NÃO
// é transferência interna — é receita de verdade e precisa continuar
// contando. O que É transferência interna é a movimentação POSTERIOR
// que o próprio banco faz automaticamente, tirando o dinheiro da
// "conta-salário" (conta-poupança/conta-benefício) e botando na
// conta corrente do mesmo cliente. Como diferenciar com os dados que
// temos:
//   • O depósito original do empregador normalmente tem
//     counterpartyName/counterpartyDocument da EMPRESA (CNPJ, 14
//     dígitos) e/ou operationType genérico (PIX, TED, OUTROS) SEM o
//     texto "transf saldo"/"c/sal p/cc".
//   • A auto-transferência tem operationType FOLHA_PAGAMENTO (nome
//     que a Pluggy usa mesmo para essa movimentação de saldo dentro
//     do próprio banco de folha) *e* o texto da description/raw traz
//     "transf saldo", "c/sal", "p/cc" — vocabulário de movimentação
//     de saldo, não de pagamento de salário.
//   Por isso o critério (c) SÓ marca quando o texto bate com o
//   vocabulário de auto-transferência (TRANSF_SALARIO_TEXT_HINTS)
//   E o operationType é FOLHA_PAGAMENTO. FOLHA_PAGAMENTO sozinho
//   (sem esse texto) fica de fora — evita apagar o salário real
//   quando o operationType do depósito também vier marcado assim por
//   algum banco.
//
// Princípio geral do módulo: FALSO NEGATIVO (deixar de marcar uma
// transferência, que continua contando como receita/despesa) é
// preferível a FALSO POSITIVO (marcar uma receita/despesa real como
// transferência, escondendo dinheiro de verdade do usuário). Todo
// critério abaixo foi calibrado para essa assimetria: na dúvida, não
// marca.
// ─────────────────────────────────────────────────────────────

import type { Transaction } from "@/lib/types";

export interface DetectTransfersParams {
  /**
   * Nomes do próprio usuário (dono da conta), para casar contra
   * counterpartyName — ex: profile.displayName + variantes vistas em
   * transferências (nome civil completo, ex "Fulano de Tal Souza").
   * Passe quantas variantes tiver; a normalização (sem acento,
   * minúsculo, espaços colapsados) já cobre diferença de
   * maiúsculo/pontuação/acento.
   */
  ownerNames: string[];
  /**
   * ids das contas do usuário elegíveis para o casamento de par (a).
   * Se omitido, usa todas as contas presentes nas transações
   * (accountId não-nulo).
   */
  accountIds?: string[];
  /** Janela máxima (dias) entre saída e entrada para casar um par. Default 2. */
  maxPairDays?: number;
}

export type TransferReason =
  | "par_casado"
  | "mesma_instituicao"
  | "transf_saldo_salario"
  | "contraparte_propria";

export interface TransferMatch {
  transactionId: string;
  reason: TransferReason;
  /** id da transação pareada, quando reason === "par_casado" */
  pairedWith?: string;
}

// ── normalização de texto/nome ──────────────────────────────────

/** minúsculo, sem acento, espaços colapsados — para comparar nomes/textos. */
function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function haystackOf(tx: Transaction): string {
  return normalize(`${tx.description} ${tx.rawDescription}`);
}

// ── critério (c): vocabulário de auto-transferência de salário ──
// Termos que aparecem quando o BANCO move o salário de uma
// conta-salário/poupança pra corrente do mesmo cliente — nunca no
// depósito original do empregador.
const TRANSF_SALARIO_TEXT_HINTS = [
  "transf saldo",
  "transferencia saldo",
  "c/sal p/cc",
  "c/sal", // "transf saldo c/sal p/cc" cobre variações de abreviação
  "p/cc",
  "saldo c sal",
];

function looksLikeSalaryAutoTransfer(tx: Transaction): boolean {
  const h = haystackOf(tx);
  return TRANSF_SALARIO_TEXT_HINTS.some((hint) => h.includes(hint));
}

// ── critério (a): "cara de transferência" (pra casar par) ───────
const TRANSFER_TEXT_HINTS = [
  "transf",
  "ted ",
  "doc ",
  "pix",
  "rem ", // "Rem Fulano de Tal" — remetente, comum em pix enviado
  "envio",
];

function looksLikeTransferSignal(tx: Transaction): boolean {
  const method = normalize(tx.paymentMethod);
  const op = normalize(tx.operationType);
  if (method === "transferencia" || method === "pix") return true;
  if (op.includes("transfer") || op === "pix") return true;
  const h = haystackOf(tx);
  return TRANSFER_TEXT_HINTS.some((hint) => h.includes(hint));
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(`${dateA}T00:00:00Z`).getTime();
  const b = new Date(`${dateB}T00:00:00Z`).getTime();
  return Math.abs(a - b) / 86_400_000;
}

/**
 * Detecta transferências internas entre contas do próprio usuário.
 * Retorna um Map<transactionId, TransferMatch> (facilita depurar
 * qual critério/confiança marcou cada transação); use
 * `internalTransferIds` se só precisar do Set de ids.
 *
 * Não muta `txs`. Ignora transações com accountId nulo (não dá pra
 * saber se são "entre contas do usuário" sem accountId dos dois lados)
 * e transações já marcadas isDuplicate (R3 já as exclui a jusante).
 */
export function detectInternalTransfers(
  txs: Transaction[],
  params: DetectTransfersParams
): Map<string, TransferMatch> {
  const result = new Map<string, TransferMatch>();
  const ownerKeys = new Set(
    params.ownerNames.map(normalize).filter((n) => n.length >= 3)
  );
  const eligibleAccounts = params.accountIds
    ? new Set(params.accountIds)
    : new Set(
        txs.map((t) => t.accountId).filter((id): id is string => !!id)
      );
  const maxPairDays = params.maxPairDays ?? 2;

  const candidates = txs.filter(
    (t) => !t.isDuplicate && t.accountId && eligibleAccounts.has(t.accountId)
  );

  for (const tx of candidates) {
    // (b) operation_type = TRANSFERENCIA_MESMA_INSTITUICAO — indício forte.
    if (normalize(tx.operationType) === "transferencia_mesma_instituicao") {
      result.set(tx.id, { transactionId: tx.id, reason: "mesma_instituicao" });
      continue;
    }

    // (c) FOLHA_PAGAMENTO + texto de auto-transferência de saldo.
    // Deliberadamente NÃO marca FOLHA_PAGAMENTO sozinho (sem o texto)
    // — isso poderia ser o próprio depósito do salário.
    if (
      normalize(tx.operationType) === "folha_pagamento" &&
      looksLikeSalaryAutoTransfer(tx)
    ) {
      result.set(tx.id, {
        transactionId: tx.id,
        reason: "transf_saldo_salario",
      });
      continue;
    }

    // (d) contraparte é o próprio usuário (nome estruturado da Pluggy,
    // não parsing de texto livre — mais confiável).
    if (tx.counterpartyName) {
      const key = normalize(tx.counterpartyName);
      if (key && ownerKeys.has(key)) {
        result.set(tx.id, {
          transactionId: tx.id,
          reason: "contraparte_propria",
        });
        continue;
      }
    }
  }

  // (a) PAR CASADO: saída em conta X + entrada em conta Y (Y≠X),
  // mesmo amount exato, dentro da janela, ambas com sinal de
  // transferência. Só entre transações elegíveis, já ignorando as
  // que caíram fora por accountId nulo/duplicada; NÃO reexamina as
  // que já foram marcadas acima (mas marcar de novo com outro motivo
  // não faz mal — usamos o primeiro motivo encontrado).
  const saidas = candidates.filter(
    (t) => t.type === "saida" && looksLikeTransferSignal(t)
  );
  const entradas = candidates.filter(
    (t) => t.type === "entrada" && looksLikeTransferSignal(t)
  );
  // controla que cada transação só entra em UM par (evita um valor
  // repetido casar em cascata com várias transações do mesmo valor).
  const usedEntradas = new Set<string>();

  for (const saida of saidas) {
    if (result.has(saida.id)) continue; // já marcada por outro critério, não precisa de par
    let bestMatch: Transaction | null = null;
    let bestDelta = Infinity;

    for (const entrada of entradas) {
      if (usedEntradas.has(entrada.id)) continue;
      if (entrada.accountId === saida.accountId) continue; // precisa ser conta diferente
      if (Math.abs(entrada.amount - saida.amount) > 0.005) continue; // mesmo valor exato
      const delta = daysBetween(saida.date, entrada.date);
      if (delta > maxPairDays) continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        bestMatch = entrada;
      }
    }

    if (bestMatch) {
      usedEntradas.add(bestMatch.id);
      result.set(saida.id, {
        transactionId: saida.id,
        reason: "par_casado",
        pairedWith: bestMatch.id,
      });
      result.set(bestMatch.id, {
        transactionId: bestMatch.id,
        reason: "par_casado",
        pairedWith: saida.id,
      });
    }
  }

  return result;
}

/**
 * Deriva `ownerNames` (parâmetro do critério "contraparte_propria") a
 * partir do `displayName` do perfil + nomes que aparecem como contraparte
 * TANTO em saídas QUANTO em entradas do próprio usuário (ex "Fulano
 * de Tal Souza" mandando e recebendo Pix pra si mesmo em contas
 * diferentes).
 *
 * Deliberadamente NÃO usa counterpartyName de uma entrada isolada: isso
 * trataria qualquer pessoa que já pagou o usuário uma vez como "o próprio
 * usuário", e futuros pagamentos dela seriam apagados como transferência
 * interna — o falso positivo que este módulo inteiro foi calibrado para
 * evitar (ver cabeçalho do arquivo). Exigir presença nos DOIS lados
 * (pagou E recebeu, mesmo nome normalizado) é um sinal muito mais forte
 * de autotransferência: um terceiro real raramente aparece como pagador
 * E recebedor do usuário com o mesmo nome.
 *
 * Mesmo sem nenhum nome civil disponível, os critérios "par_casado" e
 * "mesma_instituicao" já cobrem a maior parte dos casos reais — esta
 * função só adiciona uma camada extra, sem ser o único caminho de
 * detecção.
 */
export function inferOwnerNames(
  txs: Transaction[],
  displayName: string | null | undefined
): string[] {
  const outgoingCounterparties = new Set(
    txs
      .filter((t) => t.type === "saida" && t.counterpartyName)
      .map((t) => normalize(t.counterpartyName))
  );
  const selfTransferNames = new Set(
    txs
      .filter(
        (t) =>
          t.type === "entrada" &&
          t.counterpartyName &&
          outgoingCounterparties.has(normalize(t.counterpartyName))
      )
      .map((t) => t.counterpartyName as string)
  );
  return [displayName, ...selfTransferNames].filter(
    (n): n is string => !!n && n.trim().length > 0
  );
}

/** Atalho: só o Set<transactionId>, quando o motivo não interessa. */
export function internalTransferIds(
  txs: Transaction[],
  params: DetectTransfersParams
): Set<string> {
  return new Set(detectInternalTransfers(txs, params).keys());
}

/**
 * true se `tx` está marcada como transferência interna no Map/Set
 * pré-computado. Helper de conveniência para filtros em outras
 * camadas (aggregate/indicators/projection) sem cada uma reimportar
 * a lógica de detecção.
 */
export function isInternalTransfer(
  tx: Transaction,
  internalIds: Set<string> | Map<string, TransferMatch>
): boolean {
  return internalIds.has(tx.id);
}

/** Transações "reais" para fins de receita/despesa: exclui duplicatas E transferências internas. */
export function excludingTransfers(
  txs: Transaction[],
  internalIds: Set<string>
): Transaction[] {
  return txs.filter((t) => !t.isDuplicate && !internalIds.has(t.id));
}

export interface CleanTotals {
  income: number;
  expense: number;
  balance: number;
  /** soma do volume movimentado em transferências internas (informativo, não é receita/despesa) */
  transferVolume: number;
}

/**
 * Totais de receita/despesa já EXCLUINDO transferências internas.
 * `txs` deve já vir filtrado pelo período desejado (ex: filterByMonth) —
 * esta função não faz filtro de data, só de transferência/duplicata.
 */
export function cleanTotals(
  txs: Transaction[],
  internalIds: Set<string>
): CleanTotals {
  let income = 0;
  let expense = 0;
  let transferVolume = 0;

  for (const t of txs) {
    if (t.isDuplicate) continue;
    if (internalIds.has(t.id)) {
      transferVolume += t.amount;
      continue;
    }
    if (t.type === "entrada") income += t.amount;
    else expense += t.amount;
  }

  return { income, expense, balance: income - expense, transferVolume };
}

// ─────────────────────────────────────────────────────────────
// NOVO detector (Camada 2.3.1) — classificação por REGRAS DE NEGÓCIO
// explícitas do usuário (CPF do dono + cartão=dívida + casos especiais
// Pluggy), não mais heurística por nome/par-casado como acima.
//
// Usado por src/lib/data/dashboard.ts e src/lib/engine/context-package.ts
// (painel + IA). As funções antigas acima (detectInternalTransfers,
// inferOwnerNames, internalTransferIds, isInternalTransfer,
// excludingTransfers, cleanTotals) continuam exportadas e INTOCADAS —
// src/app/(app)/transacoes/page.tsx e src/components/transactions-view.tsx
// (fora do escopo deste agente) ainda as chamam. Não remova as funções
// antigas sem migrar essas duas telas primeiro.
//
// Modelo financeiro do usuário: FLUXO DE CAIXA (dinheiro líquido) ≠
// CARTÃO DE CRÉDITO (dívida). Regras (ordem de avaliação abaixo):
//
//  1. Salário (operationType FOLHA_PAGAMENTO) é a ÚNICA evidência do
//     salário real (a conta-salário do banco não está conectada) —
//     PROTEGIDO: sempre conta como receita, nunca é excluído.
//  2. Fatura de cartão paga ou estorno vistos do lado do CARTÃO
//     (pluggyCategory "Credit card payment", ou descrição
//     "Recebido"/"Estorno" numa conta kind="cartao") — movimentação
//     INTERNA do cartão: não é receita nem despesa.
//  3. "Valor Adicionado na Conta" (Pix no crédito da Pluggy) — a
//     ENTRADA é só financiamento (crédito liberado), não receita. A
//     SAÍDA pareada ("Transferência Enviada|<terceiro>") é dinheiro
//     saindo de verdade e cai na regra geral (conta como despesa).
//  4. CARTÃO = DÍVIDA: compra numa conta kind="cartao" não é despesa de
//     fluxo de caixa — é dívida acumulando. Vira despesa quando a
//     FATURA é paga (saída da conta corrente para a operadora — isso já
//     cai sozinho na regra 5/geral: contraparte é a operadora, não o
//     CPF do dono, então conta como despesa normalmente).
//  5. Regra do CPF (transferência entre contas próprias):
//     counterpartyDocument (só dígitos) igual ao CPF do dono ⇒ o
//     próprio usuário mexendo nas contas dele ⇒ não conta como receita
//     nem despesa. Contraparte de terceiro (ou documento ausente) ⇒
//     conta normal — entrada=receita, saída=despesa (regra 1 do
//     usuário: fluxo de caixa é dinheiro líquido real).
// ─────────────────────────────────────────────────────────────

/**
 * CPF do dono das contas, só dígitos (123.456.789-09 → "12345678909").
 * TODO: mover para o perfil/config quando o produto suportar múltiplos
 * usuários com CPFs diferentes — hoje é constante porque só há 1 conjunto
 * de contas real sendo sincronizado.
 */
export const OWNER_DOCUMENTS = ["12345678909"];

export type ClassifyReason =
  | "entre_contas"
  | "compra_no_cartao"
  | "fatura_ou_estorno_cartao"
  | "pix_no_credito"
  | "salario"
  // ── Camada 2.3.2 (ver seção "PAGAMENTO DE FATURA — a PONTE" no fim do
  // arquivo) — aditivos, não produzidos por `classifyTransactions` acima
  // (só por `classifyForViews`/`detectBillPayments`). Consumidores que
  // já fazem `if (reason === "entre_contas") …` continuam funcionando
  // sem alteração; só quem quiser o selo "Pagamento de fatura" precisa
  // tratar estes dois nomes novos.
  | "pagamento_fatura_conta"
  | "pagamento_fatura_cartao";

export interface ClassifyParams {
  /**
   * CPFs (só dígitos) do(s) dono(s) da conta. `Transaction.counterpartyDocument`
   * (normalizado para dígitos aqui dentro — pode chegar com pontuação) igual a
   * um destes ⇒ movimentação ENTRE CONTAS PRÓPRIAS (regra do CPF).
   */
  ownerDocuments: string[];
  /**
   * accountId → `Account.kind`. Usado só para achar contas kind="cartao"
   * (compra no cartão = dívida, não despesa de caixa — regra 4).
   */
  accountKindById: Map<string, string>;
}

export interface ClassifyResult {
  /** ids que NÃO contam como receita no fluxo de caixa. */
  excludeFromIncome: Set<string>;
  /** ids que NÃO contam como despesa no fluxo de caixa. */
  excludeFromExpense: Set<string>;
  /**
   * ids que são COMPRA NO CARTÃO (saída numa conta kind="cartao") — dívida
   * acumulando, não despesa de caixa. Subconjunto informativo: todo id
   * aqui já está também em `excludeFromExpense` (aggregate.monthTotals
   * aceita os três Sets separadamente só para manter o motivo explícito).
   */
  cardPurchase: Set<string>;
  /** motivo de cada id marcado por qualquer um dos Sets acima (selo/depuração). */
  reasons: Map<string, ClassifyReason>;
}

function normalizeDocDigits(doc: string | null | undefined): string {
  return (doc ?? "").replace(/\D/g, "");
}

/**
 * "Recebido"/"Estorno de" no cartão, ou categoria Pluggy "Credit card
 * payment" — pagamento de fatura chegando no cartão, ou estorno de uma
 * compra. É o mesmo cartão do próprio usuário: não é receita (não é
 * dinheiro novo) nem desfaz despesa de caixa (a compra original nunca
 * tinha entrado como despesa — regra 4, cartão é dívida até a fatura
 * ser paga pela conta corrente).
 */
function isFaturaOuEstornoCartao(
  tx: Transaction,
  accountKindById: Map<string, string>
): boolean {
  if (normalize(tx.pluggyCategory) === "credit card payment") return true;
  const h = haystackOf(tx);
  const pareceRecebidoOuEstorno = h.includes("recebido") || h.includes("estorno");
  const emContaCartao =
    !!tx.accountId && accountKindById.get(tx.accountId) === "cartao";
  return pareceRecebidoOuEstorno && emContaCartao;
}

/**
 * "Valor Adicionado na Conta" — feature Pix-no-crédito da Pluggy: a
 * entrada é só financiamento (crédito liberado), nunca dinheiro novo de
 * verdade entrando. A saída pareada ("Transferência Enviada|<terceiro>")
 * não precisa de tratamento especial: já é dinheiro saindo de verdade e
 * cai na regra geral (conta como despesa).
 */
function isPixNoCredito(tx: Transaction): boolean {
  return haystackOf(tx).includes("valor adicionado");
}

/** Compra numa conta kind="cartao" — regra 4 (CARTÃO = DÍVIDA). */
function isCompraNoCartao(
  tx: Transaction,
  accountKindById: Map<string, string>
): boolean {
  if (tx.type !== "saida" || !tx.accountId) return false;
  return accountKindById.get(tx.accountId) === "cartao";
}

/**
 * FOLHA_PAGAMENTO é a única evidência do salário (a conta-salário
 * Bradesco/237 não está conectada) — PROTEGIDO: nunca excluído de
 * receita, mesmo que outro critério pudesse (equivocadamente) marcá-lo.
 */
function isSalarioFolhaPagamento(tx: Transaction): boolean {
  return normalize(tx.operationType) === "folha_pagamento";
}

/**
 * Classifica cada transação em receita/despesa/dívida/interna, segundo as
 * regras de negócio do usuário (ver cabeçalho desta seção). Puro, sem IO.
 *
 * A primeira regra que casar decide (não combina critérios); ordem:
 *   1. salário (FOLHA_PAGAMENTO) → protegido, sempre receita.
 *   2. fatura/estorno do próprio cartão → não é receita nem despesa.
 *   3. "valor adicionado" (Pix no crédito) → não é receita.
 *   4. compra no cartão → dívida, não é despesa de caixa.
 *   5. regra do CPF → contraparte é o próprio dono ⇒ não é receita nem
 *      despesa; contraparte de terceiro (ou documento ausente) ⇒ conta
 *      normal (nenhuma exclusão — não entra em nenhum dos Sets).
 */
export function classifyTransactions(
  txs: Transaction[],
  params: ClassifyParams
): ClassifyResult {
  const ownerDocs = new Set(
    params.ownerDocuments.map(normalizeDocDigits).filter(Boolean)
  );
  const excludeFromIncome = new Set<string>();
  const excludeFromExpense = new Set<string>();
  const cardPurchase = new Set<string>();
  const reasons = new Map<string, ClassifyReason>();

  for (const tx of txs) {
    if (tx.isDuplicate) continue; // R3 já exclui a jusante; nada a classificar aqui

    // 1) Salário — protegido, nunca excluído de receita.
    if (isSalarioFolhaPagamento(tx)) {
      reasons.set(tx.id, "salario");
      continue;
    }

    // 2) Fatura de cartão paga / estorno no próprio cartão — mov. interna.
    if (isFaturaOuEstornoCartao(tx, params.accountKindById)) {
      excludeFromIncome.add(tx.id);
      excludeFromExpense.add(tx.id);
      reasons.set(tx.id, "fatura_ou_estorno_cartao");
      continue;
    }

    // 3) Pix no crédito ("valor adicionado") — a entrada é financiamento.
    if (isPixNoCredito(tx)) {
      excludeFromIncome.add(tx.id);
      reasons.set(tx.id, "pix_no_credito");
      continue;
    }

    // 4) CARTÃO = DÍVIDA — compra no cartão não é despesa de caixa.
    // TODO(quebra por categoria): quando o pagamento da fatura é
    // identificado (saída de conta corrente para a operadora do cartão,
    // capturada pela regra 5 abaixo como despesa normal), o valor hoje
    // entra inteiro numa única categoria. O usuário quer que ele seja
    // QUEBRADO nas categorias das compras (marcadas aqui em
    // `cardPurchase`) que formaram aquela fatura — gancho: cruzar
    // `cardPurchase` + accountId do cartão + janela de fechamento da
    // fatura (creditData.balanceDueDate, quando o agente de Dados
    // capturar esse campo) para ratear o pagamento por categoria. Fora
    // do escopo deste detector — ele só marca a compra como dívida, não
    // faz o rateio da fatura.
    if (isCompraNoCartao(tx, params.accountKindById)) {
      cardPurchase.add(tx.id);
      excludeFromExpense.add(tx.id);
      reasons.set(tx.id, "compra_no_cartao");
      continue;
    }

    // 5) Regra do CPF — transferência entre contas próprias.
    const doc = normalizeDocDigits(tx.counterpartyDocument);
    if (doc && ownerDocs.has(doc)) {
      excludeFromIncome.add(tx.id);
      excludeFromExpense.add(tx.id);
      reasons.set(tx.id, "entre_contas");
      continue;
    }

    // default: nenhuma regra especial casou → entrada=receita, saída=despesa.
  }

  return { excludeFromIncome, excludeFromExpense, cardPurchase, reasons };
}

// ─────────────────────────────────────────────────────────────
// Camada 2.3.2 — PAGAMENTO DE FATURA: a PONTE entre as DUAS VISÕES.
//
// O usuário confirmou o modelo exato (ver
// scratchpad/pagamento-fatura-sinais.txt, sinais tirados dos dados reais
// dele — CPF 12345678909):
//
//  1. FLUXO DE CAIXA = dinheiro líquido que entra/sai das CONTAS.
//     Receita: recebimentos/salário. Despesa: PIX/débito p/ terceiros +
//     PAGAMENTO DE FATURA (dinheiro real saindo pra pagar o cartão).
//     EXCLUI: compra no cartão (não moveu dinheiro na hora — é dívida),
//     transferência interna (mesmo CPF).
//
//  2. CONTROLE DE GASTOS = quanto/onde gastei, por categoria. Inclui:
//     compras (débito, Pix p/ loja, E as compras no CARTÃO — já
//     categorizadas individualmente). EXCLUI: PAGAMENTO DE FATURA (as
//     compras que a formaram já foram contadas uma a uma — contar a
//     fatura de novo dobraria o gasto), transferência, receita.
//
//  A FATURA É A PONTE: o pagamento dela entra no FLUXO DE CAIXA (saiu
//  dinheiro de verdade) mas NÃO no CONTROLE DE GASTOS (dobraria as
//  compras já contadas quando aconteceram).
//
// ── Como o pagamento de fatura aparece nos dados (dois lados) ──
//
//  LADO CARTÃO (a entrada que abate a dívida no ledger da própria conta
//  kind="cartao"): `pluggyCategory` === "Credit card payment" (chega com
//  description "Recebido"). Confiança MUITO ALTA — é o próprio Pluggy
//  identificando o lançamento. Não conta em NENHUMA das duas visões: não
//  é receita (não é dinheiro novo, é o mesmo cartão do usuário) nem
//  desfaz despesa (a compra original nunca tinha entrado como despesa de
//  caixa — regra 4 de `classifyTransactions`, cartão é dívida até a
//  fatura ser paga). Isto já era capturado por `isFaturaOuEstornoCartao`
//  (motivo "fatura_ou_estorno_cartao") — `detectBillPayments` abaixo só
//  expõe o mesmo sinal com um nome dedicado (`billPaymentCard`), restrito
//  à conta kind="cartao" (o texto "estorno"/"recebido" fora de uma conta
//  de cartão NÃO entra aqui — só a versão scoped conta como pagamento de
//  fatura de fato).
//
//  LADO CONTA (a saída na conta corrente/poupança/carteira que de fato
//  manda o dinheiro pra pagar a fatura) — qualquer um destes sinais
//  (união, não precisa combinar):
//   (a) `description`/`rawDescription` contém "fatura" (case/acento
//       insensível — ex "de Fatura"). Confiança ALTA.
//   (b) `pluggyCategory` normaliza para "credit card fees" E
//       `operationType` normaliza para "cartao" (ex descrição
//       "Gastos - Docto"). Confiança ALTA — combinação específica vista
//       nos dados reais do usuário.
//   (c) CASAMENTO: mesmo `amount` (± 0,5 centavo) e `date` a até 3 dias
//       de uma transação já marcada `billPaymentCard` (lado cartão),
//       numa conta que NÃO é kind="cartao". Confiança MÉDIA — fallback
//       só para pegar casos sem o texto/categoria explícitos de (a)/(b);
//       nunca casa uma transação que (a)/(b) já marcaram (evita
//       duplicar) nem uma que já esteja em `billPaymentCash` por outro
//       motivo.
//  Esse lado conta como DESPESA no FLUXO DE CAIXA (dinheiro saiu de
//  verdade) e NÃO conta no CONTROLE DE GASTOS.
// ─────────────────────────────────────────────────────────────

export interface BillPaymentDetection {
  /**
   * ids do LADO CONTA — a saída de uma conta não-cartão que paga a
   * fatura. Despesa REAL no fluxo de caixa; NÃO é gasto categorizável no
   * controle de gastos (a fatura é a ponte — ver cabeçalho da seção).
   */
  billPaymentCash: Set<string>;
  /**
   * ids do LADO CARTÃO — a entrada "Recebido" que abate a dívida no
   * ledger da própria conta de cartão. Não conta em NENHUMA das duas
   * visões.
   */
  billPaymentCard: Set<string>;
}

/** `pluggyCategory` normalizado do lançamento que abate a dívida no cartão ("Recebido"). */
const BILL_PAYMENT_CARD_CATEGORY = "credit card payment";
/** `pluggyCategory` normalizado do sinal (b) do lado conta (combinado com operationType). */
const BILL_PAYMENT_ACCOUNT_CATEGORY = "credit card fees";
/** `operationType` normalizado exigido junto com BILL_PAYMENT_ACCOUNT_CATEGORY (sinal b). */
const BILL_PAYMENT_ACCOUNT_OPERATION = "cartao";
/** Janela (dias) do casamento por valor+data do sinal (c) — "data próxima" nos dados reais gira em torno de 3 dias. */
const BILL_PAYMENT_PAIR_MAX_DAYS = 3;

function isCartaoAccount(
  tx: Transaction,
  accountKindById: Map<string, string>
): boolean {
  return !!tx.accountId && accountKindById.get(tx.accountId) === "cartao";
}

/** Sinal (a): texto "fatura" na descrição (limpa ou crua). */
function looksLikeFaturaText(tx: Transaction): boolean {
  return haystackOf(tx).includes("fatura");
}

/** Sinal (b): categoria Pluggy "Credit card fees" + operationType "CARTAO". */
function looksLikeCartaoFeesAccountSignal(tx: Transaction): boolean {
  return (
    normalize(tx.pluggyCategory) === BILL_PAYMENT_ACCOUNT_CATEGORY &&
    normalize(tx.operationType) === BILL_PAYMENT_ACCOUNT_OPERATION
  );
}

/**
 * Detecta as DUAS PONTAS do pagamento de fatura (ver cabeçalho da seção
 * acima para os sinais). Puro, sem IO. Não muta `txs`.
 *
 * Não decide sozinho em qual visão cada lado entra — quem chama
 * (`classifyForViews` abaixo, ou qualquer outro consumidor) decide.
 * Ignora transações duplicadas (`isDuplicate`) — R3 já as exclui a
 * jusante.
 */
export function detectBillPayments(
  txs: Transaction[],
  accountKindById: Map<string, string>
): BillPaymentDetection {
  const billPaymentCard = new Set<string>();
  const cardSideEvents: { id: string; amount: number; date: string }[] = [];

  for (const tx of txs) {
    if (tx.isDuplicate) continue;
    if (tx.type !== "entrada") continue; // "Recebido" no cartão é sempre entrada
    if (!isCartaoAccount(tx, accountKindById)) continue;
    if (normalize(tx.pluggyCategory) !== BILL_PAYMENT_CARD_CATEGORY) continue;
    billPaymentCard.add(tx.id);
    cardSideEvents.push({ id: tx.id, amount: tx.amount, date: tx.date });
  }

  const billPaymentCash = new Set<string>();

  // Sinais (a)/(b): diretos, sobre cada saída fora de conta de cartão.
  for (const tx of txs) {
    if (tx.isDuplicate) continue;
    if (tx.type !== "saida") continue;
    if (isCartaoAccount(tx, accountKindById)) continue; // saída em cartão é compra, não pagamento
    if (looksLikeFaturaText(tx) || looksLikeCartaoFeesAccountSignal(tx)) {
      billPaymentCash.add(tx.id);
    }
  }

  // Sinal (c): casamento por valor+data — só para o lado cartão que ainda
  // não achou par via (a)/(b), e só contra saídas ainda não marcadas (o
  // check `billPaymentCash.has(tx.id)` dentro do loop impede que um
  // segundo evento de cartão "roube" uma saída que um evento anterior já
  // casou).
  for (const card of cardSideEvents) {
    let best: Transaction | null = null;
    let bestDelta = Infinity;
    for (const tx of txs) {
      if (tx.isDuplicate || tx.type !== "saida") continue;
      if (isCartaoAccount(tx, accountKindById)) continue;
      if (billPaymentCash.has(tx.id)) continue; // já casado por (a)/(b) ou por outro evento de cartão
      if (Math.abs(tx.amount - card.amount) > 0.005) continue;
      const delta = daysBetween(tx.date, card.date);
      if (delta > BILL_PAYMENT_PAIR_MAX_DAYS) continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = tx;
      }
    }
    if (best) billPaymentCash.add(best.id);
  }

  return { billPaymentCash, billPaymentCard };
}

// ── As DUAS VISÕES, prontas para consumo (aggregate/dashboard/IA) ──

export interface ViewClassification {
  /** FLUXO DE CAIXA — dinheiro líquido real que entrou/saiu das contas. */
  cashflow: {
    /** ids (entrada) que contam como receita real. */
    income: Set<string>;
    /**
     * ids (saída) que contam como despesa real — PIX/débito p/ terceiro
     * + PAGAMENTO DE FATURA (lado conta). NÃO inclui compra no cartão
     * nem o lado-cartão do pagamento nem transferência interna.
     */
    expense: Set<string>;
  };
  /**
   * CONTROLE DE GASTOS — ids (saída) que contam como gasto
   * categorizável: PIX/débito p/ terceiro + compra no cartão. NÃO
   * inclui pagamento de fatura (nenhum lado — é a ponte, já contado nas
   * compras), transferência interna, nem receita.
   */
  spending: Set<string>;
  /**
   * Motivo de cada id classificado por qualquer regra (herda
   * `classifyTransactions.reasons` + adiciona "pagamento_fatura_conta"/
   * "pagamento_fatura_cartao" para as transações só identificadas aqui).
   * Usado para selos/depuração (ex "Pagamento de fatura" na TxRow).
   */
  reasons: Map<string, ClassifyReason>;
  /** Resultado do motor de regras legado (retrocompat — ver `classifyTransactions`). */
  legacy: ClassifyResult;
  /** As duas pontas do pagamento de fatura, cruas (ver `detectBillPayments`). */
  billPayments: BillPaymentDetection;
}

/**
 * Classifica cada transação nas DUAS VISÕES que o usuário pediu (ver
 * cabeçalho da seção "PAGAMENTO DE FATURA — a PONTE" acima):
 *   - `cashflow.income`/`cashflow.expense` — dinheiro líquido real.
 *   - `spending` — quanto/onde gastei, por categoria.
 *
 * Constrói em cima de `classifyTransactions` (CPF do dono, cartão=dívida,
 * salário protegido, fatura/estorno vista do lado cartão — INTOCADO, ver
 * comentário no topo daquela seção) + `detectBillPayments` (a ponte).
 * Retrocompat: `result.legacy` é exatamente o `ClassifyResult` de sempre
 * — quem já usa `excludeFromIncome`/`excludeFromExpense`/`cardPurchase`
 * continua funcionando sem mudar nada.
 *
 * Mapeamento (para quem for conferir contra a tabela de sinais do
 * usuário):
 *   entrada, não excluída (legacy)         → cashflow.income
 *   saída "normal" (não excluída, não é
 *     compra no cartão, não é pagamento
 *     de fatura)                           → cashflow.expense E spending
 *   saída = compra no cartão               → spending SÓ (dívida, fora do fluxo de caixa)
 *   saída = pagamento de fatura (lado conta) → cashflow.expense SÓ (a ponte, fora do controle de gastos)
 *   entrada/saída = pagamento de fatura (lado cartão) → nenhuma das duas visões
 *   entrada/saída = transferência interna (CPF) → nenhuma das duas visões
 *   entrada = "valor adicionado" (Pix no crédito) → nenhuma das duas visões (financiamento)
 */
export function classifyForViews(
  txs: Transaction[],
  params: ClassifyParams
): ViewClassification {
  const legacy = classifyTransactions(txs, params);
  const billPayments = detectBillPayments(txs, params.accountKindById);

  const reasons = new Map<string, ClassifyReason>(legacy.reasons);
  for (const id of billPayments.billPaymentCash) {
    if (!reasons.has(id)) reasons.set(id, "pagamento_fatura_conta");
  }
  for (const id of billPayments.billPaymentCard) {
    // Na prática já vem com "fatura_ou_estorno_cartao" de `legacy` (mesmo
    // sinal, ver comentário de `detectBillPayments`) — isto é só uma rede
    // de segurança caso os dois detectores um dia divirjam no critério.
    if (!reasons.has(id)) reasons.set(id, "pagamento_fatura_cartao");
  }

  const income = new Set<string>();
  const expense = new Set<string>();
  const spending = new Set<string>();

  for (const tx of txs) {
    if (tx.isDuplicate) continue;

    if (tx.type === "entrada") {
      // Receita real: qualquer entrada que o motor legado não excluiu
      // (salário, recebimento de terceiro). Pagamento de fatura lado
      // cartão, transferência interna e "valor adicionado" já vêm
      // excluídos por `classifyTransactions` — nenhuma entrada de
      // pagamento de fatura sobrevive a este filtro.
      if (!legacy.excludeFromIncome.has(tx.id)) {
        income.add(tx.id);
      }
      continue;
    }

    // saída
    if (billPayments.billPaymentCash.has(tx.id)) {
      // A PONTE: dinheiro saiu de verdade (conta no fluxo de caixa), mas
      // as compras que formaram a fatura já foram contadas uma a uma
      // (não conta no controle de gastos — contar de novo dobraria).
      expense.add(tx.id);
      continue;
    }

    if (legacy.cardPurchase.has(tx.id)) {
      // Compra no cartão: não moveu dinheiro agora (fora do fluxo de
      // caixa), mas é gasto categorizável de verdade (conta no controle
      // de gastos).
      spending.add(tx.id);
      continue;
    }

    if (legacy.excludeFromExpense.has(tx.id)) {
      // Transferência interna (CPF) ou movimentação interna do próprio
      // cartão (raro em saída) — não conta em nenhuma das duas visões.
      continue;
    }

    // saída "normal": PIX/débito pra terceiro — conta nas duas visões.
    expense.add(tx.id);
    spending.add(tx.id);
  }

  return { cashflow: { income, expense }, spending, reasons, legacy, billPayments };
}
