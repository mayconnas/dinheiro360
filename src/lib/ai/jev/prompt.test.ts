import { describe, expect, it } from "vitest";
import {
  CATEGORY_QUESTION_ID,
  NONE_OPTION,
  buildCategoryOptions,
  buildCategoryQuestion,
  buildExamplesByCategory,
  buildTransactionState,
  interpretCategoryAnswer,
  isReviewSentinel,
  normalizeText,
  type JevTransactionInput,
} from "./prompt";
import type { ChoiceAnswer, TypeSafeJson } from "./client";
import { makeCategory } from "../../../../test/fixtures";

const desp = (id: string, name: string, extra: Parameters<typeof makeCategory>[0] = {}) =>
  makeCategory({ id, name, kind: "despesa", nature: "variavel", ...extra });
const rec = (id: string, name: string, extra: Parameters<typeof makeCategory>[0] = {}) =>
  makeCategory({ id, name, kind: "receita", nature: "receita", ...extra });

/** Descrição estruturada de uma opção (o teste sabe que é um objeto). */
function describeOption(value: TypeSafeJson | undefined): Record<string, TypeSafeJson> {
  expect(value).toBeTypeOf("object");
  return value as Record<string, TypeSafeJson>;
}

describe("helpers de texto", () => {
  it("normalizeText remove acento, caixa e espaços extras", () => {
    expect(normalizeText("  Saúde   e  Bem-Estar ")).toBe("saude e bem-estar");
  });

  it("isReviewSentinel reconhece 'A revisar' em qualquer caixa", () => {
    expect(isReviewSentinel({ name: " a REVISAR " })).toBe(true);
    expect(isReviewSentinel({ name: "Revisar depois" })).toBe(false);
  });
});

describe("buildCategoryOptions", () => {
  const categories = [
    desp("moradia", "Moradia", { nature: "fixa" }),
    desp("aluguel", "Aluguel", { parentId: "moradia", nature: "fixa" }),
    desp("condominio", "Condomínio", { parentId: "moradia", nature: "fixa" }),
    desp("transporte", "Transporte"),
    desp("revisar", "A revisar"),
    rec("salario", "Salário"),
  ];

  it("oferece só folhas do kind, com o caminho 'Pai > Filho', sem 'A revisar', e a opção 'nenhuma' por último", () => {
    const opts = buildCategoryOptions(categories, "despesa", new Map());
    expect(Object.keys(opts.criteria)).toEqual([
      "Moradia > Aluguel",
      "Moradia > Condomínio",
      "Transporte",
      NONE_OPTION,
    ]);
    expect(opts.kind).toBe("despesa");
    expect(opts.categoryCount).toBe(3);
    expect(opts.dropped).toBe(0);
  });

  it("mapeia chave ↔ id nos dois sentidos, com a opção 'nenhuma' apontando para null", () => {
    const opts = buildCategoryOptions(categories, "despesa", new Map());
    expect(opts.idByKey.get("Moradia > Aluguel")).toBe("aluguel");
    expect(opts.idByKey.get(NONE_OPTION)).toBeNull();
    expect(opts.keyById.get("condominio")).toBe("Moradia > Condomínio");
    expect(opts.keyById.has("moradia")).toBe(false); // pai não é opção
  });

  it("filtra pelo kind pedido", () => {
    const opts = buildCategoryOptions(categories, "receita", new Map());
    expect(Object.keys(opts.criteria)).toEqual(["Salário", NONE_OPTION]);
  });

  it("descreve cada opção: o que cobre (categorias padrão), tipo de despesa e exemplos do histórico", () => {
    const opts = buildCategoryOptions(categories, "despesa", new Map([["transporte", ["Uber", "Posto Ipiranga"]]]));
    const transporte = describeOption(opts.criteria["Transporte"]);
    expect(transporte.covers).toMatch(/Uber\/99\/taxi/);
    expect(transporte.type).toBe("variable everyday expense");
    expect(transporte.examples).toEqual(["Uber", "Posto Ipiranga"]);
    expect(describeOption(opts.criteria["Moradia > Aluguel"]).type).toBe("fixed recurring expense");
  });

  it("receita personalizada, sem dica nem exemplos, fica com descrição null", () => {
    const opts = buildCategoryOptions([rec("bicos", "Bicos")], "receita", new Map());
    expect(opts.criteria["Bicos"]).toBeNull();
  });

  it("desambigua nomes repetidos com sufixo numérico", () => {
    const opts = buildCategoryOptions([desp("m1", "Mercado"), desp("m2", "Mercado")], "despesa", new Map());
    expect(Object.keys(opts.criteria)).toEqual(["Mercado", "Mercado (2)", NONE_OPTION]);
    expect(new Set([opts.idByKey.get("Mercado"), opts.idByKey.get("Mercado (2)")])).toEqual(new Set(["m1", "m2"]));
  });

  it("uma categoria chamada como a opção 'nenhuma' não a sobrescreve", () => {
    const opts = buildCategoryOptions([desp("x", NONE_OPTION)], "despesa", new Map());
    expect(opts.idByKey.get(NONE_OPTION)).toBeNull();
    expect(opts.idByKey.get(`${NONE_OPTION} (2)`)).toBe("x");
  });

  it("opção ampla ganha not_for quando a específica também está entre as opções", () => {
    const opts = buildCategoryOptions([desp("saude", "Saúde"), desp("farmacia", "Farmácia")], "despesa", new Map());
    expect(describeOption(opts.criteria["Saúde"]).not_for).toBe(
      "Transactions that fit a more specific option: Farmácia"
    );
    expect(describeOption(opts.criteria["Farmácia"]).not_for).toBeUndefined();

    const semEspecifica = buildCategoryOptions([desp("saude", "Saúde")], "despesa", new Map());
    expect(describeOption(semEspecifica.criteria["Saúde"]).not_for).toBeUndefined();
  });

  it("not_for usa o caminho completo da opção específica", () => {
    const opts = buildCategoryOptions(
      [
        desp("lazer", "Lazer"),
        desp("pessoal", "Pessoal"),
        desp("viagem", "Viagem", { parentId: "pessoal" }),
      ],
      "despesa",
      new Map()
    );
    expect(describeOption(opts.criteria["Lazer"]).not_for).toContain("Pessoal > Viagem");
  });

  it("acima de 255 opções, mantém as categorias mais usadas e informa quantas ficaram de fora", () => {
    const many = Array.from({ length: 300 }, (_, i) => desp(`c${i}`, `Categoria ${String(i).padStart(3, "0")}`));
    const examples = new Map([
      ["c299", ["a", "b", "c"]],
      ["c298", ["a"]],
    ]);
    const opts = buildCategoryOptions(many, "despesa", examples);
    expect(Object.keys(opts.criteria)).toHaveLength(255); // 254 categorias + "nenhuma"
    expect(opts.categoryCount).toBe(254);
    expect(opts.dropped).toBe(46);
    expect(opts.keyById.has("c299")).toBe(true);
    expect(opts.keyById.has("c298")).toBe(true);
    expect(Object.keys(opts.criteria).at(-1)).toBe(NONE_OPTION);
  });
});

describe("buildExamplesByCategory", () => {
  it("lista os nomes mais frequentes por categoria, preferindo o merchant à descrição", () => {
    const rows = [
      { description: "Ifood *Rest", merchantName: "IFOOD", categoryId: "comida" },
      { description: "Burger King", merchantName: null, categoryId: "comida" },
      { description: "Ifood *Outro", merchantName: "ifood", categoryId: "comida" },
      { description: "Uber Trip", merchantName: null, categoryId: "transporte" },
    ];
    const ex = buildExamplesByCategory(rows);
    expect(ex.get("comida")).toEqual(["IFOOD", "Burger King"]); // IFOOD 2×, depois Burger King
    expect(ex.get("transporte")).toEqual(["Uber Trip"]);
  });

  it("em empate de frequência, o mais recente (primeiro da lista) ganha; respeita o limite por categoria", () => {
    const rows = ["Padaria A", "Padaria B", "Padaria C"].map((d) => ({
      description: d,
      merchantName: null,
      categoryId: "comida",
    }));
    expect(buildExamplesByCategory(rows, 2).get("comida")).toEqual(["Padaria A", "Padaria B"]);
  });

  it("ignora linhas sem categoria ou com rótulo curto demais, e corta rótulos em 48 caracteres", () => {
    const longo = "X".repeat(60);
    const ex = buildExamplesByCategory([
      { description: "Sem categoria", merchantName: null, categoryId: null },
      { description: "A", merchantName: " ", categoryId: "c" },
      { description: longo, merchantName: null, categoryId: "c" },
    ]);
    expect([...ex.keys()]).toEqual(["c"]);
    expect(ex.get("c")).toEqual(["X".repeat(48)]);
  });
});

describe("buildTransactionState", () => {
  const base: JevTransactionInput = {
    type: "saida",
    amount: 45.9,
    description: "Ifood",
    rawDescription: "IFOOD",
    rawPayload: null,
    merchantName: null,
    counterpartyName: null,
    counterpartyDocument: null,
    paymentMethod: null,
    pluggyCategory: null,
  };

  it("descreve direção e valor e omite textos repetidos (mesmo texto em dois campos)", () => {
    const { transaction } = buildTransactionState(base);
    expect(transaction.direction).toBe("money out (expense)");
    expect(transaction.description).toBe("Ifood");
    expect(transaction).not.toHaveProperty("bank_statement_text");
    expect(transaction.amount).toMatch(/^R\$\s45,90$/);
  });

  it("entrada é descrita como dinheiro entrando", () => {
    expect(buildTransactionState({ ...base, type: "entrada" }).transaction.direction).toBe("money in (income)");
  });

  it("inclui detalhes úteis do payload da Pluggy, merchant e categoria sugerida pelo banco", () => {
    const { transaction } = buildTransactionState({
      ...base,
      rawDescription: "IFD*IFOOD 0800",
      merchantName: "IFOOD",
      pluggyCategory: " Food delivery ",
      paymentMethod: "credito",
      rawPayload: {
        descriptionRaw: "IFD*IFOOD.COM AGENCIA",
        merchant: { businessName: "IFOOD.COM AGENCIA DE RESTAURANTES ONLINE S.A." },
        paymentData: { reason: "pedido 123" },
      },
    });
    expect(transaction).toMatchObject({
      description: "Ifood",
      bank_statement_text: "IFD*IFOOD 0800",
      bank_statement_detail: "IFD*IFOOD.COM AGENCIA",
      merchant_legal_name: "IFOOD.COM AGENCIA DE RESTAURANTES ONLINE S.A.",
      payment_note: "pedido 123",
      payment_method: "credit card",
      bank_suggested_category: "Food delivery",
    });
    // "IFOOD" (merchant) repete "Ifood" (descrição) → omitido
    expect(transaction).not.toHaveProperty("merchant");
  });

  it("identifica a contraparte como pessoa (CPF) ou empresa (CNPJ)", () => {
    const pessoa = buildTransactionState({
      ...base,
      description: "Pix Enviado",
      counterpartyName: "Joao Silva",
      counterpartyDocument: "123.456.789-09",
    }).transaction;
    expect(pessoa.counterparty).toBe("Joao Silva (person)");
    const empresa = buildTransactionState({
      ...base,
      counterpartyName: "Padaria Pao Quente",
      counterpartyDocument: "12345678000199",
    }).transaction;
    expect(empresa.counterparty).toBe("Padaria Pao Quente (company)");
    const semDoc = buildTransactionState({ ...base, counterpartyName: "Fulano" }).transaction;
    expect(semDoc.counterparty).toBe("Fulano");
  });

  it("omite a contraparte quando ela repete outro campo, e não repete o payee", () => {
    const { transaction } = buildTransactionState(
      { ...base, counterpartyName: "IFOOD", counterpartyDocument: "12345678000199" },
      { payeeName: "ifood" }
    );
    expect(transaction).not.toHaveProperty("counterparty");
    expect(transaction).not.toHaveProperty("payee");
  });

  it("infere a forma de pagamento pela descrição quando não há valor persistido", () => {
    const { transaction } = buildTransactionState({ ...base, description: "Joao", rawDescription: "PIX ENVIADO JOAO" });
    expect(transaction.payment_method).toBe("Pix");
  });

  it("descreve a conta sem repetir nome e instituição", () => {
    const { transaction } = buildTransactionState(base, {
      account: { name: "Nubank", institution: "Nubank", kind: "cartao" },
      payeeName: "Restaurante Sabor",
    });
    expect(transaction.account).toBe("Nubank · credit card");
    expect(transaction.payee).toBe("Restaurante Sabor");
  });
});

describe("buildCategoryQuestion", () => {
  it("monta uma pergunta Choice com as opções e instruções para o kind", () => {
    const opts = buildCategoryOptions([desp("t", "Transporte")], "despesa", new Map());
    const q = buildCategoryQuestion(opts);
    expect(q.type).toBe("choice");
    expect(q.criteria).toBe(opts.criteria);
    expect(JSON.stringify(q.instructions)).toContain("expense categories");
    const qReceita = buildCategoryQuestion(buildCategoryOptions([rec("s", "Salário")], "receita", new Map()));
    expect(JSON.stringify(qReceita.instructions)).toContain("income categories");
    expect(CATEGORY_QUESTION_ID).toBe("category");
  });
});

describe("interpretCategoryAnswer", () => {
  const opts = buildCategoryOptions(
    [desp("comida", "Comida fora"), desp("mercado", "Mercado"), desp("lazer", "Lazer"), desp("saude", "Saúde"), desp("transp", "Transporte")],
    "despesa",
    new Map()
  );
  const answer = (o: Partial<ChoiceAnswer>): ChoiceAnswer => ({
    type: "choice",
    choice: "Comida fora",
    probabilities: {},
    confidence: 0.8,
    ...o,
  });

  it("converte a opção escolhida em categoria, com probabilidade, confiança e faixa", () => {
    const d = interpretCategoryAnswer("tx-1", answer({ probabilities: { "Comida fora": 0.82 } }), opts);
    expect(d).toEqual({
      transactionId: "tx-1",
      categoryId: "comida",
      probability: 0.82,
      confidence: 0.8,
      tier: "alta",
      alternatives: [],
    });
  });

  it("lista até 3 alternativas com ≥5%, da mais provável para a menos, sem a opção 'nenhuma'", () => {
    const d = interpretCategoryAnswer(
      "tx-1",
      answer({
        confidence: 0.5,
        probabilities: {
          "Comida fora": 0.5,
          Mercado: 0.2,
          [NONE_OPTION]: 0.15,
          Lazer: 0.06,
          Saúde: 0.05,
          Transporte: 0.04,
          "Opção fantasma": 0.3,
        },
      }),
      opts
    );
    expect(d.tier).toBe("media");
    expect(d.alternatives).toEqual([
      { categoryId: "mercado", probability: 0.2 },
      { categoryId: "lazer", probability: 0.06 },
      { categoryId: "saude", probability: 0.05 },
    ]);
  });

  it("a opção 'nenhuma' vira categoria null e faixa 'nenhuma', sem erro", () => {
    const d = interpretCategoryAnswer("tx-1", answer({ choice: NONE_OPTION, probabilities: { [NONE_OPTION]: 0.9 } }), opts);
    expect(d.categoryId).toBeNull();
    expect(d.tier).toBe("nenhuma");
    expect(d.probability).toBe(0.9);
    expect(d.error).toBeUndefined();
  });

  it("opção fora da lista vira erro, sem categoria nem confiança", () => {
    const d = interpretCategoryAnswer("tx-1", answer({ choice: "Inventada", probabilities: { Inventada: 1 } }), opts);
    expect(d).toMatchObject({
      categoryId: null,
      probability: 0,
      confidence: 0,
      tier: "nenhuma",
      error: "O Jev devolveu uma opção que não estava na lista.",
    });
  });

  it("limita confiança e probabilidade ao intervalo 0–1 e trata valores inválidos como 0", () => {
    const alto = interpretCategoryAnswer("t", answer({ confidence: 1.4, probabilities: { "Comida fora": 2 } }), opts);
    expect(alto.confidence).toBe(1);
    expect(alto.probability).toBe(1);
    const invalido = interpretCategoryAnswer("t", answer({ confidence: Number.NaN }), opts);
    expect(invalido.confidence).toBe(0);
    expect(invalido.probability).toBe(0);
    expect(invalido.tier).toBe("baixa");
  });
});
