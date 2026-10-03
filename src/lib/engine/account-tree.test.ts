import { describe, expect, it } from "vitest";
import {
  aggregateTree,
  buildAccountTree,
  depth,
  flattenTree,
  getAncestors,
  getDescendants,
  isLeaf,
  selfAndDescendants,
} from "./account-tree";
import { makeCategory } from "../../../test/fixtures";

// Moradia
// ├── Aluguel
// └── Contas da casa
//     ├── Energia
//     └── Água
// Transporte
const moradia = makeCategory({ id: "moradia", name: "Moradia", sortOrder: 1 });
const aluguel = makeCategory({ id: "aluguel", name: "Aluguel", parentId: "moradia" });
const contas = makeCategory({ id: "contas", name: "Contas da casa", parentId: "moradia" });
const energia = makeCategory({ id: "energia", name: "Energia", parentId: "contas" });
const agua = makeCategory({ id: "agua", name: "Água", parentId: "contas" });
const transporte = makeCategory({ id: "transporte", name: "Transporte", sortOrder: 0 });
const plano = [energia, agua, moradia, aluguel, contas, transporte];

describe("buildAccountTree", () => {
  const tree = buildAccountTree(plano);

  it("monta raízes ordenadas por sortOrder e filhos por nome (pt-BR)", () => {
    expect(tree.roots.map((n) => n.category.id)).toEqual(["transporte", "moradia"]);
    expect(tree.byId.get("moradia")!.children.map((n) => n.category.id)).toEqual(["aluguel", "contas"]);
    // "Água" ordena antes de "Energia" mesmo com acento
    expect(tree.byId.get("contas")!.children.map((n) => n.category.id)).toEqual(["agua", "energia"]);
  });

  it("calcula a profundidade a partir da raiz", () => {
    expect(depth(tree.byId.get("moradia")!)).toBe(0);
    expect(depth(tree.byId.get("contas")!)).toBe(1);
    expect(depth(tree.byId.get("energia")!)).toBe(2);
  });

  it("identifica folhas", () => {
    expect(isLeaf(tree.byId.get("energia")!)).toBe(true);
    expect(isLeaf(tree.byId.get("contas")!)).toBe(false);
  });

  it("trata como raiz a categoria cujo pai não existe", () => {
    const orfa = makeCategory({ id: "orfa", name: "Órfã", parentId: "apagada" });
    const t = buildAccountTree([orfa]);
    expect(t.roots.map((n) => n.category.id)).toEqual(["orfa"]);
    expect(t.brokenCycleIds).toEqual([]);
  });

  it("neutraliza ciclos (A → B → A) sem travar, registrando os ids cortados", () => {
    const a = makeCategory({ id: "a", name: "A", parentId: "b" });
    const b = makeCategory({ id: "b", name: "B", parentId: "a" });
    const t = buildAccountTree([a, b]);
    expect(t.brokenCycleIds.length).toBeGreaterThan(0);
    expect(t.roots.length).toBeGreaterThan(0);
    // todo nó continua alcançável a partir das raízes
    expect(flattenTree(t).map((n) => n.category.id).sort()).toEqual(["a", "b"]);
  });

  it("não muta a lista de categorias recebida", () => {
    const input = [...plano];
    buildAccountTree(input);
    expect(input).toEqual(plano);
  });
});

describe("navegação e agregação", () => {
  const tree = buildAccountTree(plano);

  it("flattenTree percorre em pré-ordem (pai antes dos filhos)", () => {
    expect(flattenTree(tree).map((n) => n.category.id)).toEqual([
      "transporte",
      "moradia",
      "aluguel",
      "contas",
      "agua",
      "energia",
    ]);
  });

  it("getDescendants e selfAndDescendants", () => {
    expect(getDescendants(tree, "moradia").sort()).toEqual(["agua", "aluguel", "contas", "energia"]);
    expect(getDescendants(tree, "energia")).toEqual([]);
    expect(getDescendants(tree, "inexistente")).toEqual([]);
    expect(selfAndDescendants(tree, "contas")).toEqual(["contas", "agua", "energia"]);
  });

  it("getAncestors sobe do pai imediato até a raiz", () => {
    expect(getAncestors(tree, "energia")).toEqual(["contas", "moradia"]);
    expect(getAncestors(tree, "moradia")).toEqual([]);
  });

  it("aggregateTree soma lançamentos diretos com os de todos os descendentes", () => {
    const totals = aggregateTree(
      tree,
      new Map([
        ["aluguel", 1800],
        ["energia", 250],
        ["agua", 90],
        ["contas", 10], // lançamento amarrado direto num nó com filhos é tolerado
      ])
    );
    expect(totals.get("contas")).toEqual({ direct: 10, total: 350 });
    expect(totals.get("moradia")).toEqual({ direct: 0, total: 2150 });
    expect(totals.get("transporte")).toEqual({ direct: 0, total: 0 });
    expect(totals.size).toBe(plano.length);
  });
});
