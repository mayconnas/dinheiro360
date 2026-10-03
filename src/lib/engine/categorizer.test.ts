import { describe, expect, it } from "vitest";
import {
  DEFAULT_DICTIONARY,
  categorize,
  dictionaryCategoryId,
  ruleFromCorrection,
} from "./categorizer";
import type { Category, CategoryRule } from "@/lib/types";
import { defaultCategories, makeCategory, makeRule } from "../../../test/fixtures";

const cats = defaultCategories();
/** Categorias de despesa, como os chamadores passam para uma saída. */
const despesas: Category[] = Object.values(cats).filter((c) => c.kind === "despesa");
/** Categorias de receita, como os chamadores passam para uma entrada. */
const receitas: Category[] = Object.values(cats).filter((c) => c.kind === "receita");

function run(
  description: string,
  opts: {
    raw?: string;
    categories?: Category[];
    rules?: CategoryRule[];
    memory?: Map<string, string>;
  } = {}
) {
  return categorize({
    description,
    rawDescription: opts.raw ?? description.toUpperCase(),
    categories: opts.categories ?? despesas,
    rules: opts.rules ?? [],
    memory: opts.memory ?? new Map(),
  });
}

describe("categorize — precedência R4", () => {
  it("regra manual vence memória e dicionário", () => {
    const result = run("Ifood Restaurante Sabor", {
      rules: [makeRule({ pattern: "sabor", categoryId: cats.lazer.id })],
      memory: new Map([["ifood restaurante sabor", cats.mercado.id]]),
    });
    expect(result).toEqual({ categoryId: cats.lazer.id, source: "user_rule", needsReview: false });
  });

  it("regra manual vence regra aprendida, mesmo quando a aprendida vem antes na lista", () => {
    const result = run("Uber Trip", {
      rules: [
        makeRule({ pattern: "uber", categoryId: cats.lazer.id, source: "learned" }),
        makeRule({ pattern: "trip", categoryId: cats.transporte.id, source: "manual" }),
      ],
    });
    expect(result.categoryId).toBe(cats.transporte.id);
    expect(result.source).toBe("user_rule");
  });

  it("regra aprendida vence memória e dicionário", () => {
    const result = run("Uber Trip", {
      rules: [makeRule({ pattern: "uber trip", categoryId: cats.lazer.id, source: "learned" })],
      memory: new Map([["uber trip", cats.mercado.id]]),
    });
    expect(result.categoryId).toBe(cats.lazer.id);
    expect(result.source).toBe("user_rule");
  });

  it("regra casa por substring, sem diferenciar maiúsculas, também na descrição bruta", () => {
    const result = run("Pagamento", {
      raw: "PIX ENVIADO ACADEMIA SMARTFIT",
      rules: [makeRule({ pattern: "SmartFit", categoryId: cats.lazer.id })],
    });
    expect(result.categoryId).toBe(cats.lazer.id);
  });

  it("memória vence o dicionário (a descrição limpa já foi categorizada antes)", () => {
    const result = run("Uber", {
      memory: new Map([["uber", cats.lazer.id]]),
    });
    expect(result).toEqual({ categoryId: cats.lazer.id, source: "memory", needsReview: false });
  });

  it("memória é consultada pela descrição limpa em minúsculas", () => {
    const result = run("Joao Silva", { memory: new Map([["joao silva", cats.moradia.id]]) });
    expect(result.categoryId).toBe(cats.moradia.id);
    expect(result.source).toBe("memory");
  });

  it("dicionário embutido categoriza estabelecimentos conhecidos", () => {
    expect(run("Ifood *Restaurante").categoryId).toBe(cats.comidaFora.id);
    expect(run("Uber Trip Help.uber.com").categoryId).toBe(cats.transporte.id);
    expect(run("Netflix.com").categoryId).toBe(cats.assinaturas.id);
    expect(run("Drogasil 123").categoryId).toBe(cats.saude.id);
    expect(run("Supermercado Dia").categoryId).toBe(cats.mercado.id);
    expect(run("Ifood").source).toBe("dictionary");
  });

  it("dicionário funciona para receitas quando a categoria de receita existe", () => {
    const result = run("Credito Salario Empresa X", {
      raw: "CREDITO SALARIO EMPRESA X LTDA",
      categories: receitas,
    });
    expect(result).toEqual({ categoryId: cats.salario.id, source: "dictionary", needsReview: false });
  });

  it("sem nenhum casamento cai no fallback 'A revisar' do mesmo kind, marcando revisão", () => {
    expect(run("Fulano de Tal")).toEqual({
      categoryId: cats.revisarDespesa.id,
      source: "fallback",
      needsReview: true,
    });
    expect(run("Fulano de Tal", { categories: receitas }).categoryId).toBe(cats.revisarReceita.id);
  });

  it("fallback devolve categoryId null quando não existe 'A revisar'", () => {
    const semRevisar = despesas.filter((c) => c.name !== "A revisar");
    expect(run("Fulano de Tal", { categories: semRevisar })).toEqual({
      categoryId: null,
      source: "fallback",
      needsReview: true,
    });
  });
});

describe("categorize — filtro por kind", () => {
  it("ignora regra cuja categoria não está entre as categorias do kind", () => {
    // Regra aprendida numa saída ("Joao Silva" → Moradia) não pode
    // categorizar uma ENTRADA com a mesma descrição como despesa.
    const result = run("Joao Silva", {
      categories: receitas,
      rules: [makeRule({ pattern: "joao silva", categoryId: cats.moradia.id, source: "learned" })],
    });
    expect(result.categoryId).toBe(cats.revisarReceita.id);
    expect(result.source).toBe("fallback");
  });

  it("pula a regra de outro kind e usa a próxima regra válida", () => {
    const result = run("Joao Silva", {
      categories: receitas,
      rules: [
        makeRule({ pattern: "joao", categoryId: cats.moradia.id }),
        makeRule({ pattern: "silva", categoryId: cats.outrasReceitas.id }),
      ],
    });
    expect(result.categoryId).toBe(cats.outrasReceitas.id);
  });

  it("ignora memória que aponta para categoria de outro kind e segue para o dicionário", () => {
    const result = run("Uber", {
      categories: despesas,
      memory: new Map([["uber", cats.salario.id]]),
    });
    expect(result.categoryId).toBe(cats.transporte.id);
    expect(result.source).toBe("dictionary");
  });

  it("dicionário só devolve categorias presentes na lista do kind", () => {
    // "salario" mapeia para Salário (receita) — numa saída não existe.
    const result = run("Adiantamento Salario", { categories: despesas });
    expect(result.source).toBe("fallback");
  });

  it("não muta a lista de regras recebida ao ordenar manual antes de learned", () => {
    const rules = [
      makeRule({ pattern: "x", categoryId: cats.lazer.id, source: "learned" }),
      makeRule({ pattern: "y", categoryId: cats.lazer.id, source: "manual" }),
    ];
    const snapshot = rules.map((r) => r.id);
    run("Nada", { rules });
    expect(rules.map((r) => r.id)).toEqual(snapshot);
  });
});

describe("dictionaryCategoryId", () => {
  it("devolve a primeira entrada do dicionário cuja categoria existe", () => {
    // "uber eats" casa "uber" (Transporte) antes de qualquer outra entrada
    expect(dictionaryCategoryId("Uber Eats", "UBER EATS", despesas)).toBe(cats.transporte.id);
  });

  it("pula entradas cuja categoria não existe e tenta as seguintes", () => {
    const semComidaFora = despesas.filter((c) => c.id !== cats.comidaFora.id);
    // "Ifood Mercado": ifood → Comida fora (ausente) → segue até "mercado"
    expect(dictionaryCategoryId("Ifood Mercado", "", semComidaFora)).toBe(cats.mercado.id);
  });

  it("casa o nome da categoria sem diferenciar maiúsculas", () => {
    const custom = [makeCategory({ id: "c1", name: "COMIDA FORA" })];
    expect(dictionaryCategoryId("Ifood", "", custom)).toBe("c1");
  });

  it("devolve null quando nada casa", () => {
    expect(dictionaryCategoryId("Joao Silva", "PIX JOAO SILVA", despesas)).toBeNull();
  });

  it("reconhece o falso positivo documentado: 'mercado' dentro de MERCADOLIVRE", () => {
    // é exatamente para isso que a função é exportada: o chamador
    // descobre que a categoria veio só de uma substring do dicionário.
    expect(dictionaryCategoryId("Mercadolivre", "MERCADOLIVRE*LOJA", despesas)).toBe(cats.mercado.id);
  });

  it("todas as entradas do dicionário estão em minúsculas (o haystack é minúsculo)", () => {
    for (const entry of DEFAULT_DICTIONARY) expect(entry.match).toBe(entry.match.toLowerCase());
  });

  // BUG: o haystack só é convertido para minúsculas, sem remover acentos,
  // e as entradas do dicionário estão sem acento ("salario", "farmacia",
  // "condominio"...). Descrições acentuadas — comuns em extratos de
  // fintechs — não casam.
  it.fails("casa descrições acentuadas como 'Salário' e 'Farmácia' (BUG: acentos não são removidos)", () => {
    expect(dictionaryCategoryId("Salário", "SALÁRIO EMPRESA X", receitas)).toBe(cats.salario.id);
    expect(dictionaryCategoryId("Farmácia São João", "", despesas)).toBe(cats.saude.id);
  });

  // BUG: casamento por substring sem fronteira de palavra — "posto"
  // dentro de "IMPOSTO" vira Transporte; "tim" dentro de "ESTIMATIVA"
  // vira Contas fixas.
  it.fails("não casa entradas curtas no meio de outra palavra (BUG: 'imposto' → Transporte)", () => {
    expect(dictionaryCategoryId("Pagamento Imposto Renda", "", despesas)).toBeNull();
  });
});

describe("ruleFromCorrection (R5)", () => {
  it("usa a descrição limpa (aparada) como padrão da regra", () => {
    expect(ruleFromCorrection("  Padaria Pao Quente  ", "cat-x")).toEqual({
      pattern: "Padaria Pao Quente",
      categoryId: "cat-x",
    });
  });

  it("recusa padrões com menos de 3 caracteres", () => {
    expect(ruleFromCorrection("99", "cat-x")).toBeNull();
    expect(ruleFromCorrection("   ab  ", "cat-x")).toBeNull();
    expect(ruleFromCorrection("abc", "cat-x")).not.toBeNull();
  });

  it("a regra gerada acerta sozinha na próxima ocorrência", () => {
    const learned = ruleFromCorrection("Joao Silva", cats.moradia.id)!;
    const result = run("Joao Silva", {
      rules: [makeRule({ ...learned, source: "learned" })],
    });
    expect(result.categoryId).toBe(cats.moradia.id);
    expect(result.needsReview).toBe(false);
  });
});
