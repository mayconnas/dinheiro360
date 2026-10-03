import { describe, expect, it } from "vitest";
import { computeBudget, suggestLimits } from "./budget";
import { makeBudget, makeCategory, makeTransaction as tx } from "../../../test/fixtures";

const comida = makeCategory({ id: "comida", name: "Comida fora", color: "#f97316" });
const mercado = makeCategory({ id: "mercado", name: "Mercado" });
const transporte = makeCategory({ id: "transporte", name: "Transporte" });
const lazer = makeCategory({ id: "lazer", name: "Lazer" });
const salario = makeCategory({ id: "salario", name: "Salário", kind: "receita", nature: "receita" });
const categories = [comida, mercado, transporte, lazer, salario];

const month = "2026-07";
const txs = [
  tx({ date: "2026-07-03", amount: 500, categoryId: "comida" }), // teto 400 → estourado
  tx({ date: "2026-07-04", amount: 850, categoryId: "mercado" }), // teto 1000 → 85% alerta
  tx({ date: "2026-07-05", amount: 100, categoryId: "transporte" }), // teto 300 → ok
  tx({ date: "2026-07-06", amount: 60, categoryId: "lazer" }), // sem teto
  tx({ date: "2026-07-07", amount: 5000, categoryId: "salario", type: "entrada" }),
];
const budgets = [
  makeBudget({ categoryId: "comida", limit: 400 }),
  makeBudget({ categoryId: "mercado", limit: 1000 }),
  makeBudget({ categoryId: "transporte", limit: 300 }),
];

describe("computeBudget (R6)", () => {
  const lines = computeBudget(txs, month, budgets, categories);
  const byId = Object.fromEntries(lines.map((l) => [l.categoryId, l]));

  it("classifica cada categoria: estourado ≥100%, alerta ≥80%, ok abaixo, sem_controle sem teto", () => {
    expect(byId.comida.status).toBe("estourado");
    expect(byId.mercado.status).toBe("alerta");
    expect(byId.transporte.status).toBe("ok");
    expect(byId.lazer.status).toBe("sem_controle");
  });

  it("calcula consumido e restante (restante negativo quando estoura)", () => {
    expect(byId.comida.consumed).toBe(1.25);
    expect(byId.comida.remaining).toBe(-100);
    expect(byId.mercado.consumed).toBeCloseTo(0.85);
    expect(byId.lazer.consumed).toBeNull();
    expect(byId.lazer.remaining).toBeNull();
  });

  it("os limiares são inclusivos: exatamente 80% é alerta, exatamente 100% é estourado", () => {
    const exato = [
      tx({ date: "2026-07-01", amount: 80, categoryId: "comida" }),
      tx({ date: "2026-07-01", amount: 100, categoryId: "mercado" }),
    ];
    const res = computeBudget(
      exato,
      month,
      [makeBudget({ categoryId: "comida", limit: 100 }), makeBudget({ categoryId: "mercado", limit: 100 })],
      categories
    );
    expect(res.find((l) => l.categoryId === "comida")?.status).toBe("alerta");
    expect(res.find((l) => l.categoryId === "mercado")?.status).toBe("estourado");
  });

  it("orçamento é só de despesa: categoria de receita nunca entra", () => {
    const withIncomeBudget = computeBudget(
      txs,
      month,
      [...budgets, makeBudget({ categoryId: "salario", limit: 100 })],
      categories
    );
    expect(withIncomeBudget.map((l) => l.categoryId)).not.toContain("salario");
  });

  it("inclui categoria com teto mas sem gasto no mês (gasto 0, status ok)", () => {
    const res = computeBudget([], month, [makeBudget({ categoryId: "comida", limit: 400 })], categories);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ spent: 0, consumed: 0, remaining: 400, status: "ok" });
  });

  it("teto zero ou negativo conta como sem controle", () => {
    const res = computeBudget(txs, month, [makeBudget({ categoryId: "comida", limit: 0 })], categories);
    expect(res.find((l) => l.categoryId === "comida")?.status).toBe("sem_controle");
  });

  it("ordena por gravidade (estourado > alerta > ok > sem_controle) e depois por gasto", () => {
    expect(lines.map((l) => l.categoryId)).toEqual(["comida", "mercado", "transporte", "lazer"]);
  });

  it("usa nome/cor da categoria, com fallback para gasto sem categoria", () => {
    const res = computeBudget([tx({ date: "2026-07-01", amount: 10, categoryId: null })], month, [], categories);
    expect(byId.comida).toMatchObject({ categoryName: "Comida fora", color: "#f97316" });
    expect(res[0]).toMatchObject({ categoryId: "sem_categoria", categoryName: "Sem categoria", color: "#94a3b8" });
  });
});

describe("suggestLimits (R7)", () => {
  it("sugere a média dos 3 meses anteriores, arredondada para cima em múltiplos de 10", () => {
    const hist = [
      tx({ date: "2026-06-10", amount: 410, categoryId: "comida" }),
      tx({ date: "2026-05-10", amount: 380, categoryId: "comida" }),
      tx({ date: "2026-04-10", amount: 400, categoryId: "comida" }),
      tx({ date: "2026-07-10", amount: 5000, categoryId: "comida" }), // mês atual não entra
    ];
    // (410 + 380 + 400) / 3 = 396,67 → 400
    expect(suggestLimits(hist, month).get("comida")).toBe(400);
  });

  it("não sugere nada para categorias sem histórico", () => {
    expect(suggestLimits([tx({ date: "2026-07-01", categoryId: "comida" })], month).size).toBe(0);
  });
});
