import { describe, expect, it } from "vitest";
import { buildContextPackage } from "./context-package";
import { OWNER_DOCUMENTS } from "./transfers";
import {
  makeAccount,
  makeBudget,
  makeCategory,
  makeGoal,
  makeProfile,
  makeTransaction as tx,
} from "../../../test/fixtures";

const accounts = [
  makeAccount({ id: "cc", name: "Conta Inter", kind: "corrente" }),
  makeAccount({ id: "cartao", name: "Nubank", kind: "cartao" }),
];
const categories = [
  makeCategory({ id: "moradia", name: "Moradia", nature: "fixa" }),
  makeCategory({ id: "mercado", name: "Mercado", nature: "variavel" }),
  makeCategory({ id: "comida", name: "Comida fora", nature: "discricionaria" }),
  makeCategory({ id: "salario", name: "Salário", kind: "receita", nature: "receita" }),
];
const transactions = [
  // junho
  tx({ id: "sal-jun", date: "2026-06-05", type: "entrada", amount: 5000, accountId: "cc", categoryId: "salario", description: "Salario Empresa X" }),
  tx({ id: "alug-jun", date: "2026-06-06", amount: 1800, accountId: "cc", categoryId: "moradia", description: "Aluguel Apto" }),
  tx({ id: "merc-jun", date: "2026-06-12", amount: 300, accountId: "cc", categoryId: "mercado", description: "Supermercado Dia" }),
  // julho
  tx({ id: "sal", date: "2026-07-05", type: "entrada", amount: 5000, accountId: "cc", categoryId: "salario", description: "Salario Empresa X" }),
  tx({
    id: "alug",
    date: "2026-07-06",
    amount: 1800,
    accountId: "cc",
    categoryId: "moradia",
    description: "Aluguel Apto",
    rawDescription: "PIX ENVIADO IMOBILIARIA XPTO 0099887766",
  }),
  tx({ id: "ifood", date: "2026-07-08", amount: 120, accountId: "cartao", categoryId: "comida", description: "Ifood" }),
  tx({ id: "fatura", date: "2026-07-10", amount: 300, accountId: "cc", description: "Pagamento de Fatura" }),
  tx({ id: "merc", date: "2026-07-12", amount: 400, accountId: "cc", categoryId: "mercado", description: "Supermercado Dia" }),
  tx({ id: "proprio", date: "2026-07-13", amount: 1000, accountId: "cc", counterpartyDocument: OWNER_DOCUMENTS[0], description: "Pix Para Mim" }),
];

const pkg = buildContextPackage({
  profile: makeProfile({ monthlyIncome: 5000, employmentType: "clt", dependents: 1 }),
  transactions,
  categories,
  accounts,
  budgets: [makeBudget({ categoryId: "mercado", limit: 500 })],
  goals: [
    makeGoal({ name: "Viagem", targetAmount: 10_000, currentAmount: 2_000, deadline: "2027-01-01" }),
    makeGoal({ name: "Carro", targetAmount: 30_000, currentAmount: 0, deadline: "2027-12-31" }),
    makeGoal({ name: "Curso", targetAmount: 2_000, currentAmount: 500, deadline: "2026-06-01" }),
    makeGoal({ name: "Sem prazo", targetAmount: 1_000, currentAmount: 0, deadline: null }),
    makeGoal({ name: "Concluída", targetAmount: 1_000, currentAmount: 1_000, deadline: "2026-01-01" }),
  ],
  month: "2026-07",
  today: "2026-07-15",
});

describe("buildContextPackage — o contrato com a IA", () => {
  it("perfil vem do Profile", () => {
    expect(pkg.perfil).toEqual({
      renda_media: 5000,
      tipo: "clt",
      dependentes: 1,
      escada_prioridades: makeProfile().priorityLadder,
    });
  });

  it("fluxo de caixa do mês exclui compra no cartão e transferência para o CPF do dono, mas inclui a fatura", () => {
    expect(pkg.mes_atual).toEqual({
      referencia: "julho de 2026",
      receitas: 5000,
      despesas: 1800 + 300 + 400,
      sobra: 2500,
      gasto_categorizado: 1800 + 120 + 400, // compras (inclusive no cartão), sem a fatura
      dias_restantes: 16,
    });
  });

  it("top categorias vêm do controle de gastos, com percentual e comparação com a média", () => {
    expect(pkg.top_categorias).toEqual([
      { categoria: "Moradia", gasto: 1800, percentual_do_total: 0.78, vs_media: 2 }, // média 600
      { categoria: "Mercado", gasto: 400, percentual_do_total: 0.17, vs_media: 3 }, // média 100
      { categoria: "Comida fora", gasto: 120, percentual_do_total: 0.05, vs_media: null }, // sem histórico
    ]);
  });

  it("histórico traz 7 meses em ordem cronológica terminando no mês atual", () => {
    expect(pkg.historico.map((h) => h.mes)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
    ]);
    expect(pkg.historico[5]).toEqual({ mes: "2026-06", receitas: 5000, despesas: 2100, sobra: 2900 });
  });

  it("projeção usa o gasto médio diário do fluxo de caixa", () => {
    // 2500 − (2500 / 15) × 16 = −166,67
    expect(pkg.projecao).toEqual({ fechamento_projetado: -166.67, sinal: "vermelho", disponivel_por_dia: 0 });
  });

  it("orçamento traz status e consumo arredondados", () => {
    expect(pkg.orcamento[0]).toEqual({ categoria: "Mercado", gasto: 400, teto: 500, consumido: 0.8, status: "alerta" });
  });

  it("indicadores e degrau da escada: reserva crítica leva ao degrau 'Montar a reserva'", () => {
    expect(pkg.indicadores).toHaveLength(6);
    const reserva = pkg.indicadores.find((i) => i.indicador === "Reserva de emergência");
    expect(reserva?.status).toBe("critico");
    expect(pkg.degrau_atual).toBe("Montar a reserva");
  });

  it("recorrências e flags derivados do motor de regras", () => {
    expect(pkg.recorrencias.map((r) => [r.descricao, r.tipo, r.proxima])).toEqual([
      ["Salario Empresa X", "entrada", "2026-08-04"],
      ["Aluguel Apto", "saida", "2026-08-05"],
    ]);
    const titulos = pkg.flags.map((f) => f.titulo);
    expect(titulos).toContain("Moradia acima do normal");
    expect(titulos).toContain("Cobrança recorrente nova: Aluguel Apto");
  });

  it("metas: avalia ritmo (com prazo futuro e progresso > 0, sem prazo, ou concluída)", () => {
    expect(Object.fromEntries(pkg.metas.map((m) => [m.nome, m.no_ritmo]))).toEqual({
      Viagem: true,
      Carro: false,
      Curso: false,
      "Sem prazo": true,
      "Concluída": true,
    });
  });

  it("nunca vaza extrato bruto nem documentos para a IA", () => {
    const json = JSON.stringify(pkg);
    expect(json).not.toContain("IMOBILIARIA XPTO");
    expect(json).not.toContain(OWNER_DOCUMENTS[0]);
  });
});
