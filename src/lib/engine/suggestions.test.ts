import { describe, expect, it } from "vitest";
import { computeSuggestions } from "./suggestions";
import { defaultCategories, makeRule, makeTransaction as tx } from "../../../test/fixtures";

const cats = defaultCategories();
const categories = Object.values(cats);

describe("computeSuggestions", () => {
  it("sugere a categoria do dicionário para itens em 'A revisar'", () => {
    const t = tx({ id: "t1", description: "Uber Trip", categoryId: cats.revisarDespesa.id, needsReview: true });
    const res = computeSuggestions([t], categories, [], new Map());
    expect(res.get("t1")).toEqual({ categoryId: cats.transporte.id, categoryName: "Transporte" });
  });

  it("não sugere quando o categorizador cai no fallback", () => {
    const t = tx({ id: "t1", description: "Fulano de Tal", categoryId: cats.revisarDespesa.id });
    expect(computeSuggestions([t], categories, [], new Map()).size).toBe(0);
  });

  it("não sugere a categoria que a transação já tem", () => {
    const t = tx({ id: "t1", description: "Ifood", categoryId: cats.comidaFora.id });
    expect(computeSuggestions([t], categories, [], new Map()).size).toBe(0);
  });

  it("filtra as categorias pelo kind da transação (entrada → receita)", () => {
    const entrada = tx({ id: "e", type: "entrada", description: "Salario Empresa X", categoryId: null });
    const res = computeSuggestions([entrada], categories, [], new Map());
    expect(res.get("e")?.categoryId).toBe(cats.salario.id);
    // uma regra apontando para despesa não vale para a entrada
    const regraDespesa = makeRule({ pattern: "joao", categoryId: cats.moradia.id });
    const pix = tx({ id: "p", type: "entrada", description: "Joao Silva" });
    expect(computeSuggestions([pix], categories, [regraDespesa], new Map()).has("p")).toBe(false);
  });

  it("usa regras e memória do usuário", () => {
    const t1 = tx({ id: "t1", description: "Academia Smartfit" });
    const t2 = tx({ id: "t2", description: "Dona Maria Diarista" });
    const res = computeSuggestions(
      [t1, t2],
      categories,
      [makeRule({ pattern: "smartfit", categoryId: cats.lazer.id })],
      new Map([["dona maria diarista", cats.moradia.id]])
    );
    expect(res.get("t1")?.categoryName).toBe("Lazer");
    expect(res.get("t2")?.categoryName).toBe("Moradia");
  });
});
