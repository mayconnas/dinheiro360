import { describe, expect, it } from "vitest";
import {
  detectRecurrences,
  expectedExpenseRemaining,
  expectedIncomeRemaining,
  type Recurrence,
} from "./recurrences";
import { makeTransaction as tx } from "../../../test/fixtures";

const netflix = (date: string, amount = 55.9) =>
  tx({ date, amount, description: "Netflix.com", categoryId: "assinaturas" });

describe("detectRecurrences (R10)", () => {
  it("detecta assinatura mensal: mesmo estabelecimento, valor parecido, intervalo ~30 dias", () => {
    const [r] = detectRecurrences(
      [netflix("2026-05-05"), netflix("2026-06-05"), netflix("2026-07-05")],
      "2026-07-20"
    );
    expect(r).toMatchObject({
      label: "Netflix.com",
      categoryId: "assinaturas",
      type: "saida",
      occurrences: 3,
      lastDate: "2026-07-05",
      intervalDays: 31, // média 30,5 arredondada
      nextExpected: "2026-08-05",
      overdue: false,
    });
    expect(r.amount).toBeCloseTo(55.9);
  });

  it("tolera variação de até 15% no valor e calcula o valor médio", () => {
    const [r] = detectRecurrences(
      [
        tx({ date: "2026-05-10", amount: 180, description: "Enel Distribuicao" }),
        tx({ date: "2026-06-10", amount: 200, description: "Enel Distribuicao" }),
      ],
      "2026-06-15"
    );
    expect(r.amount).toBe(190);
  });

  it("não agrupa valores que variam mais de 15%", () => {
    const res = detectRecurrences(
      [
        tx({ date: "2026-05-10", amount: 100, description: "Enel Distribuicao" }),
        tx({ date: "2026-06-10", amount: 130, description: "Enel Distribuicao" }),
      ],
      "2026-06-15"
    );
    expect(res).toEqual([]);
  });

  it("ignora repetições que não têm cara de mensal (ex.: Uber toda semana)", () => {
    const uber = ["2026-07-01", "2026-07-08", "2026-07-15"].map((date) =>
      tx({ date, amount: 25, description: "Uber Trip" })
    );
    expect(detectRecurrences(uber, "2026-07-20")).toEqual([]);
  });

  it("exige ao menos duas ocorrências", () => {
    expect(detectRecurrences([netflix("2026-07-05")], "2026-07-20")).toEqual([]);
  });

  it("não mistura entrada e saída com a mesma descrição e valor", () => {
    const res = detectRecurrences(
      [
        tx({ date: "2026-05-05", amount: 500, description: "Joao Silva", type: "entrada" }),
        tx({ date: "2026-06-05", amount: 500, description: "Joao Silva", type: "saida" }),
      ],
      "2026-06-10"
    );
    expect(res).toEqual([]);
  });

  it("ignora transações duplicadas", () => {
    const res = detectRecurrences(
      [netflix("2026-06-05"), { ...netflix("2026-07-05"), isDuplicate: true }],
      "2026-07-10"
    );
    expect(res).toEqual([]);
  });

  it("marca como atrasada a recorrência que passou mais de 5 dias da data prevista", () => {
    const spotify = (date: string) => tx({ date, amount: 21.9, description: "Spotify" });
    const [r] = detectRecurrences([spotify("2026-04-10"), spotify("2026-05-10")], "2026-06-20");
    expect(r.nextExpected).toBe("2026-06-09");
    expect(r.overdue).toBe(true);
    // dentro da tolerância de 5 dias ainda não é atraso
    const [ok] = detectRecurrences([spotify("2026-04-10"), spotify("2026-05-10")], "2026-06-14");
    expect(ok.overdue).toBe(false);
  });

  it("ordena as recorrências pelo valor, do maior para o menor", () => {
    const salario = (date: string) =>
      tx({ date, amount: 5000, description: "Salario Empresa X", type: "entrada" });
    const res = detectRecurrences(
      [netflix("2026-06-05"), salario("2026-06-05"), netflix("2026-07-05"), salario("2026-07-05")],
      "2026-07-10"
    );
    expect(res.map((r) => r.label)).toEqual(["Salario Empresa X", "Netflix.com"]);
  });
});

describe("receitas/despesas recorrentes ainda esperadas no mês", () => {
  const rec = (o: Partial<Recurrence>): Recurrence => ({
    label: "x",
    categoryId: null,
    amount: 100,
    type: "saida",
    intervalDays: 30,
    occurrences: 3,
    lastDate: "2026-06-10",
    nextExpected: "2026-07-10",
    overdue: false,
    ...o,
  });
  const list = [
    rec({ amount: 55.9 }),
    rec({ amount: 21.9, overdue: true }), // atrasada: não conta
    rec({ amount: 300, nextExpected: "2026-08-01" }), // outro mês
    rec({ amount: 5000, type: "entrada" }),
    rec({ amount: 800, type: "entrada", overdue: true }),
  ];

  it("expectedExpenseRemaining soma só saídas não atrasadas previstas para o mês", () => {
    expect(expectedExpenseRemaining(list, "2026-07")).toBeCloseTo(55.9);
  });

  it("expectedIncomeRemaining soma só entradas não atrasadas previstas para o mês", () => {
    expect(expectedIncomeRemaining(list, "2026-07")).toBe(5000);
  });
});
