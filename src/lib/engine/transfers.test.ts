import { describe, expect, it } from "vitest";
import {
  classifyForViews,
  classifyTransactions,
  cleanTotals,
  detectBillPayments,
  detectInternalTransfers,
  excludingTransfers,
  inferOwnerNames,
  internalTransferIds,
  isInternalTransfer,
} from "./transfers";
import { FAKE_OWNER_CPF, makeTransaction as tx } from "../../../test/fixtures";

const ownerNames = ["Maria Souza"];

describe("detectInternalTransfers (heurística legada)", () => {
  it("(b) operationType TRANSFERENCIA_MESMA_INSTITUICAO marca sozinho", () => {
    const t = tx({ id: "t1", accountId: "cc", operationType: "TRANSFERENCIA_MESMA_INSTITUICAO" });
    expect(detectInternalTransfers([t], { ownerNames }).get("t1")?.reason).toBe("mesma_instituicao");
  });

  it("(c) FOLHA_PAGAMENTO só marca com texto de auto-transferência de saldo", () => {
    const auto = tx({
      id: "auto",
      accountId: "sal",
      operationType: "FOLHA_PAGAMENTO",
      description: "Transf Saldo C/sal P/cc",
    });
    const deposito = tx({
      id: "dep",
      accountId: "sal",
      type: "entrada",
      operationType: "FOLHA_PAGAMENTO",
      description: "Credito de Salario Empresa X",
      rawDescription: "CREDITO DE SALARIO EMPRESA X",
    });
    const res = detectInternalTransfers([auto, deposito], { ownerNames });
    expect(res.get("auto")?.reason).toBe("transf_saldo_salario");
    expect(res.has("dep")).toBe(false); // salário real continua sendo receita
  });

  it("(d) contraparte com o nome do dono, ignorando acento e caixa", () => {
    const t = tx({ id: "t1", accountId: "cc", type: "entrada", counterpartyName: "MARIA  SOUZA" });
    const res = detectInternalTransfers([t], { ownerNames: ["María Souza"] });
    expect(res.get("t1")?.reason).toBe("contraparte_propria");
  });

  it("(d) ignora nomes de dono com menos de 3 caracteres", () => {
    const t = tx({ id: "t1", accountId: "cc", counterpartyName: "Ma" });
    expect(detectInternalTransfers([t], { ownerNames: ["Ma"] }).size).toBe(0);
  });

  it("(a) casa saída e entrada de mesmo valor, contas diferentes, até 2 dias, com sinal de transferência", () => {
    const saida = tx({ id: "s", accountId: "nubank", date: "2026-07-10", amount: 500, paymentMethod: "pix" });
    const entrada = tx({
      id: "e",
      accountId: "inter",
      date: "2026-07-11",
      amount: 500,
      type: "entrada",
      description: "Pix Recebido",
    });
    const res = detectInternalTransfers([saida, entrada], { ownerNames: [] });
    expect(res.get("s")).toEqual({ transactionId: "s", reason: "par_casado", pairedWith: "e" });
    expect(res.get("e")).toEqual({ transactionId: "e", reason: "par_casado", pairedWith: "s" });
  });

  it("(a) nunca casa só por mesmo valor e data, sem sinal de transferência", () => {
    const compra = tx({ id: "s", accountId: "a", amount: 89.9, description: "Mercado Extra" });
    const reembolso = tx({ id: "e", accountId: "b", amount: 89.9, type: "entrada", description: "Cashback Loja" });
    expect(detectInternalTransfers([compra, reembolso], { ownerNames: [] }).size).toBe(0);
  });

  it("(a) não casa na mesma conta nem fora da janela", () => {
    const s = tx({ id: "s", accountId: "a", date: "2026-07-10", amount: 500, paymentMethod: "pix" });
    const mesmaConta = tx({ id: "e1", accountId: "a", date: "2026-07-10", amount: 500, type: "entrada", paymentMethod: "pix" });
    const longe = tx({ id: "e2", accountId: "b", date: "2026-07-13", amount: 500, type: "entrada", paymentMethod: "pix" });
    expect(detectInternalTransfers([s, mesmaConta, longe], { ownerNames: [] }).size).toBe(0);
    // com janela maior, casa
    expect(detectInternalTransfers([s, longe], { ownerNames: [], maxPairDays: 3 }).size).toBe(2);
  });

  it("(a) escolhe a entrada mais próxima e usa cada entrada em um único par", () => {
    const s1 = tx({ id: "s1", accountId: "a", date: "2026-07-10", amount: 200, paymentMethod: "pix" });
    const s2 = tx({ id: "s2", accountId: "a", date: "2026-07-10", amount: 200, paymentMethod: "pix" });
    const longe = tx({ id: "e-longe", accountId: "b", date: "2026-07-12", amount: 200, type: "entrada", paymentMethod: "pix" });
    const perto = tx({ id: "e-perto", accountId: "b", date: "2026-07-10", amount: 200, type: "entrada", paymentMethod: "pix" });
    const res = detectInternalTransfers([s1, s2, longe, perto], { ownerNames: [] });
    expect(res.get("s1")?.pairedWith).toBe("e-perto");
    expect(res.get("s2")?.pairedWith).toBe("e-longe");
  });

  it("ignora duplicatas, transações sem conta e contas fora de accountIds", () => {
    const dup = tx({ id: "d", accountId: "a", operationType: "TRANSFERENCIA_MESMA_INSTITUICAO", isDuplicate: true });
    const semConta = tx({ id: "n", accountId: null, operationType: "TRANSFERENCIA_MESMA_INSTITUICAO" });
    const outraConta = tx({ id: "o", accountId: "z", operationType: "TRANSFERENCIA_MESMA_INSTITUICAO" });
    const res = detectInternalTransfers([dup, semConta, outraConta], { ownerNames, accountIds: ["a"] });
    expect(res.size).toBe(0);
  });
});

describe("inferOwnerNames", () => {
  it("só considera dono quem aparece como contraparte em saída E em entrada", () => {
    const txs = [
      tx({ type: "saida", counterpartyName: "Maria Souza Lima" }),
      tx({ type: "entrada", counterpartyName: "MARIA SOUZA LIMA" }),
      tx({ type: "entrada", counterpartyName: "Joao Cliente" }), // só pagou o usuário
    ];
    expect(inferOwnerNames(txs, "Maria")).toEqual(["Maria", "MARIA SOUZA LIMA"]);
  });

  it("descarta displayName vazio", () => {
    expect(inferOwnerNames([], "  ")).toEqual([]);
    expect(inferOwnerNames([], null)).toEqual([]);
  });
});

describe("helpers legados de exclusão", () => {
  const sal = tx({ id: "sal", type: "entrada", amount: 5000 });
  const transf = tx({ id: "transf", type: "saida", amount: 1000 });
  const ifood = tx({ id: "ifood", type: "saida", amount: 80 });
  const dup = tx({ id: "dup", type: "saida", amount: 80, isDuplicate: true });
  const ids = new Set(["transf"]);

  it("internalTransferIds e isInternalTransfer", () => {
    const t = tx({ id: "t", accountId: "a", operationType: "TRANSFERENCIA_MESMA_INSTITUICAO" });
    const set = internalTransferIds([t], { ownerNames: [] });
    expect([...set]).toEqual(["t"]);
    expect(isInternalTransfer(t, set)).toBe(true);
    expect(isInternalTransfer(ifood, set)).toBe(false);
  });

  it("excludingTransfers remove transferências e duplicatas", () => {
    expect(excludingTransfers([sal, transf, ifood, dup], ids).map((t) => t.id)).toEqual(["sal", "ifood"]);
  });

  it("cleanTotals separa o volume transferido de receita/despesa", () => {
    expect(cleanTotals([sal, transf, ifood, dup], ids)).toEqual({
      income: 5000,
      expense: 80,
      balance: 4920,
      transferVolume: 1000,
    });
  });
});

describe("classifyTransactions (regras de negócio)", () => {
  const kinds = new Map([
    ["cc", "corrente"],
    ["cartao", "cartao"],
  ]);
  const params = { ownerDocuments: [FAKE_OWNER_CPF], accountKindById: kinds };

  it("1) salário FOLHA_PAGAMENTO é protegido, mesmo com CPF do dono", () => {
    const sal = tx({
      id: "sal",
      type: "entrada",
      accountId: "cc",
      operationType: "FOLHA_PAGAMENTO",
      counterpartyDocument: FAKE_OWNER_CPF,
    });
    const res = classifyTransactions([sal], params);
    expect(res.reasons.get("sal")).toBe("salario");
    expect(res.excludeFromIncome.has("sal")).toBe(false);
  });

  it("2) pagamento de fatura/estorno no cartão sai das duas pontas", () => {
    const recebido = tx({ id: "r", type: "entrada", accountId: "cartao", description: "Recebido" });
    const pluggy = tx({ id: "p", type: "entrada", accountId: "cc", pluggyCategory: "Credit Card Payment" });
    const res = classifyTransactions([recebido, pluggy], params);
    for (const id of ["r", "p"]) {
      expect(res.excludeFromIncome.has(id)).toBe(true);
      expect(res.excludeFromExpense.has(id)).toBe(true);
      expect(res.reasons.get(id)).toBe("fatura_ou_estorno_cartao");
    }
  });

  it("2) 'Estorno' fora de conta de cartão não é movimentação interna", () => {
    const estorno = tx({ id: "e", type: "entrada", accountId: "cc", description: "Estorno Compra Loja" });
    expect(classifyTransactions([estorno], params).reasons.has("e")).toBe(false);
  });

  it("3) 'Valor adicionado na conta' (Pix no crédito) não é receita", () => {
    const t = tx({ id: "v", type: "entrada", accountId: "cc", description: "Valor Adicionado na Conta" });
    const res = classifyTransactions([t], params);
    expect(res.excludeFromIncome.has("v")).toBe(true);
    expect(res.excludeFromExpense.has("v")).toBe(false);
    expect(res.reasons.get("v")).toBe("pix_no_credito");
  });

  it("4) compra no cartão é dívida: fora da despesa de caixa e marcada como cardPurchase", () => {
    const t = tx({ id: "c", type: "saida", accountId: "cartao", description: "Ifood" });
    const res = classifyTransactions([t], params);
    expect(res.cardPurchase.has("c")).toBe(true);
    expect(res.excludeFromExpense.has("c")).toBe(true);
    expect(res.reasons.get("c")).toBe("compra_no_cartao");
  });

  it("5) regra do CPF: contraparte com o documento do dono (com pontuação) é entre contas", () => {
    const t = tx({ id: "t", accountId: "cc", counterpartyDocument: "123.456.789-09" });
    const res = classifyTransactions([t], params);
    expect(res.reasons.get("t")).toBe("entre_contas");
    expect(res.excludeFromIncome.has("t")).toBe(true);
    expect(res.excludeFromExpense.has("t")).toBe(true);
  });

  it("terceiros e transações sem documento contam normalmente; duplicatas são ignoradas", () => {
    const terceiro = tx({ id: "t", accountId: "cc", counterpartyDocument: "98765432100" });
    const semDoc = tx({ id: "s", accountId: "cc" });
    const dup = tx({ id: "d", accountId: "cartao", isDuplicate: true });
    const res = classifyTransactions([terceiro, semDoc, dup], params);
    expect(res.reasons.size).toBe(0);
    expect(res.excludeFromExpense.size).toBe(0);
  });
});

describe("detectBillPayments (a ponte entre as duas visões)", () => {
  const kinds = new Map([
    ["cc", "corrente"],
    ["cartao", "cartao"],
  ]);

  it("lado cartão: entrada 'Credit card payment' numa conta de cartão", () => {
    const card = tx({ id: "card", type: "entrada", accountId: "cartao", pluggyCategory: "Credit card payment" });
    const naoCartao = tx({ id: "x", type: "entrada", accountId: "cc", pluggyCategory: "Credit card payment" });
    const res = detectBillPayments([card, naoCartao], kinds);
    expect([...res.billPaymentCard]).toEqual(["card"]);
  });

  it("lado conta (a): saída com 'fatura' no texto, sem distinguir acento/caixa", () => {
    const t = tx({ id: "f", accountId: "cc", description: "Pagamento de FATURA Nubank" });
    expect(detectBillPayments([t], kinds).billPaymentCash.has("f")).toBe(true);
  });

  it("lado conta (b): categoria 'Credit card fees' + operationType CARTAO", () => {
    const t = tx({ id: "g", accountId: "cc", description: "Gastos - Docto", pluggyCategory: "Credit card fees", operationType: "CARTAO" });
    const soCategoria = tx({ id: "h", accountId: "cc", pluggyCategory: "Credit card fees" });
    const res = detectBillPayments([t, soCategoria], kinds);
    expect(res.billPaymentCash.has("g")).toBe(true);
    expect(res.billPaymentCash.has("h")).toBe(false);
  });

  it("lado conta (c): casa por valor e data (até 3 dias) com o lado cartão, escolhendo a mais próxima", () => {
    const card = tx({ id: "card", type: "entrada", accountId: "cartao", date: "2026-07-10", amount: 1234.56, pluggyCategory: "Credit card payment" });
    const longe = tx({ id: "longe", accountId: "cc", date: "2026-07-13", amount: 1234.56, description: "Debito Automatico" });
    const perto = tx({ id: "perto", accountId: "cc", date: "2026-07-09", amount: 1234.56, description: "Debito Automatico" });
    const foraJanela = tx({ id: "fora", accountId: "cc", date: "2026-07-20", amount: 1234.56 });
    const res = detectBillPayments([card, longe, perto, foraJanela], kinds);
    expect([...res.billPaymentCash]).toEqual(["perto"]);
  });

  it("saída numa conta de cartão nunca é pagamento de fatura (é compra)", () => {
    const t = tx({ id: "c", accountId: "cartao", description: "Fatura Loja Parcelada" });
    expect(detectBillPayments([t], kinds).billPaymentCash.size).toBe(0);
  });
});

describe("classifyForViews (fluxo de caixa × controle de gastos)", () => {
  const kinds = new Map([
    ["cc", "corrente"],
    ["cartao", "cartao"],
  ]);
  const txs = [
    tx({ id: "salario", type: "entrada", accountId: "cc", amount: 5000, operationType: "FOLHA_PAGAMENTO" }),
    tx({ id: "pix-terceiro", accountId: "cc", amount: 120, description: "Pix Enviado Joao Silva" }),
    tx({ id: "compra-cartao", accountId: "cartao", amount: 89.9, description: "Ifood" }),
    tx({ id: "fatura-conta", accountId: "cc", amount: 89.9, description: "Pagamento de Fatura" }),
    tx({ id: "fatura-cartao", type: "entrada", accountId: "cartao", amount: 89.9, pluggyCategory: "Credit card payment", description: "Recebido" }),
    tx({ id: "entre-contas", accountId: "cc", amount: 1000, counterpartyDocument: FAKE_OWNER_CPF }),
    tx({ id: "valor-adicionado", type: "entrada", accountId: "cc", amount: 300, description: "Valor Adicionado na Conta" }),
    tx({ id: "dup", accountId: "cc", amount: 120, isDuplicate: true }),
  ];
  const views = classifyForViews(txs, { ownerDocuments: [FAKE_OWNER_CPF], accountKindById: kinds });

  it("fluxo de caixa: receita real e despesa real (inclui pagamento de fatura, exclui compra no cartão)", () => {
    expect([...views.cashflow.income]).toEqual(["salario"]);
    expect([...views.cashflow.expense].sort()).toEqual(["fatura-conta", "pix-terceiro"]);
  });

  it("controle de gastos: inclui compra no cartão e exclui o pagamento da fatura", () => {
    expect([...views.spending].sort()).toEqual(["compra-cartao", "pix-terceiro"]);
  });

  it("anota o motivo de cada lançamento especial", () => {
    expect(views.reasons.get("fatura-conta")).toBe("pagamento_fatura_conta");
    expect(views.reasons.get("fatura-cartao")).toBe("fatura_ou_estorno_cartao");
    expect(views.reasons.get("compra-cartao")).toBe("compra_no_cartao");
    expect(views.reasons.get("entre-contas")).toBe("entre_contas");
    expect(views.reasons.get("salario")).toBe("salario");
  });

  it("a fatura não é contada duas vezes: gasto = compras; caixa = pagamento", () => {
    const amount = (ids: Set<string>) => txs.filter((t) => ids.has(t.id)).reduce((a, t) => a + t.amount, 0);
    expect(amount(views.spending)).toBeCloseTo(120 + 89.9);
    expect(amount(views.cashflow.expense)).toBeCloseTo(120 + 89.9);
  });

  it("expõe o resultado legado intacto para retrocompatibilidade", () => {
    expect(views.legacy.cardPurchase.has("compra-cartao")).toBe(true);
    expect(views.billPayments.billPaymentCard.has("fatura-cartao")).toBe(true);
  });
});
